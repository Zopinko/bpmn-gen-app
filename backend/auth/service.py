from __future__ import annotations

from dataclasses import dataclass
import logging
from uuid import uuid4

from auth.db import get_connection
from auth.security import (
    digest_token,
    expires_in,
    from_iso_z,
    hash_password,
    new_session_token,
    to_iso_z,
    utcnow,
    verify_password,
)
from core.auth_config import get_auth_config


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str
    role: str
    email_verified_at: str | None
    created_at: str


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _validate_email(email: str) -> bool:
    return "@" in email and "." in email.split("@")[-1]


def _validate_password(password: str) -> bool:
    return len(password) >= 8


def register_user(email: str, password: str) -> AuthUser:
    normalized_email = normalize_email(email)
    if not _validate_email(normalized_email):
        raise ValueError("Email ma neplatny format.")
    if not _validate_password(password):
        raise ValueError("Heslo musi mat aspon 8 znakov.")

    now = to_iso_z(utcnow())
    user_id = str(uuid4())
    password_hash = hash_password(password)
    with get_connection() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE email = ?",
            (normalized_email,),
        ).fetchone()
        if existing:
            raise ValueError("Pouzivatel s tymto emailom uz existuje.")
        conn.execute(
            """
            INSERT INTO users(id, email, password_hash, email_verified_at, role, created_at, updated_at, last_login_at)
            VALUES (?, ?, ?, NULL, 'user', ?, ?, NULL)
            """,
            (user_id, normalized_email, password_hash, now, now),
        )
        conn.commit()
    return AuthUser(
        id=user_id,
        email=normalized_email,
        role="user",
        email_verified_at=None,
        created_at=now,
    )


def authenticate_user(email: str, password: str) -> AuthUser | None:
    normalized_email = normalize_email(email)
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, email, password_hash, role, email_verified_at, created_at
            FROM users
            WHERE email = ?
            """,
            (normalized_email,),
        ).fetchone()
    if not row:
        return None
    if not verify_password(row["password_hash"], password):
        return None
    return AuthUser(
        id=row["id"],
        email=row["email"],
        role=row["role"],
        email_verified_at=row["email_verified_at"],
        created_at=row["created_at"],
    )


def update_last_login(user_id: str) -> None:
    now = to_iso_z(utcnow())
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
            (now, now, user_id),
        )
        conn.commit()


def create_session_for_user(user_id: str, ip_address: str | None, user_agent: str | None) -> str:
    cfg = get_auth_config()
    session_token = new_session_token()
    session_hash = digest_token(session_token)
    now = to_iso_z(utcnow())
    expires_at = expires_in(cfg.session_ttl_seconds)
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO auth_sessions(
                id, user_id, session_id_hash, expires_at, revoked_at, created_at, last_seen_at, ip_address, user_agent
            )
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
            """,
            (str(uuid4()), user_id, session_hash, expires_at, now, now, ip_address, user_agent),
        )
        conn.commit()
    return session_token


def revoke_session(session_token: str) -> None:
    now = to_iso_z(utcnow())
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE auth_sessions
            SET revoked_at = ?
            WHERE session_id_hash = ? AND revoked_at IS NULL
            """,
            (now, digest_token(session_token)),
        )
        conn.commit()


def find_user_by_session(session_token: str) -> AuthUser | None:
    now = utcnow()
    token_hash = digest_token(session_token)
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT
                s.id AS session_id,
                s.expires_at AS expires_at,
                s.revoked_at AS revoked_at,
                u.id AS user_id,
                u.email AS email,
                u.role AS role,
                u.email_verified_at AS email_verified_at,
                u.created_at AS created_at
            FROM auth_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.session_id_hash = ?
            """,
            (token_hash,),
        ).fetchone()
        if not row:
            return None
        if row["revoked_at"]:
            return None
        if from_iso_z(row["expires_at"]) <= now:
            return None
        conn.execute(
            "UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?",
            (to_iso_z(now), row["session_id"]),
        )
        conn.commit()

    return AuthUser(
        id=row["user_id"],
        email=row["email"],
        role=row["role"],
        email_verified_at=row["email_verified_at"],
        created_at=row["created_at"],
    )


def create_org_with_owner(name: str, user_id: str) -> dict:
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("Nazov organizacie je povinny.")
    now = to_iso_z(utcnow())
    org_id = str(uuid4())
    membership_id = str(uuid4())
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO organizations(id, name, created_at, created_by_user_id)
            VALUES (?, ?, ?, ?)
            """,
            (org_id, cleaned, now, user_id),
        )
        conn.execute(
            """
            INSERT INTO organization_members(id, organization_id, user_id, role, created_at)
            VALUES (?, ?, ?, 'owner', ?)
            """,
            (membership_id, org_id, user_id, now),
        )
        conn.commit()
    logger.info("Created org %s by user %s", org_id, user_id)
    return {"id": org_id, "name": cleaned}


def get_user_orgs(user_id: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT o.id, o.name, m.role, o.created_at AS org_created_at, m.created_at AS member_created_at
            FROM organization_members m
            JOIN organizations o ON o.id = m.organization_id
            WHERE m.user_id = ?
            ORDER BY o.created_at DESC
            """,
            (user_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "role": row["role"],
            "org_created_at": row["org_created_at"],
            "member_created_at": row["member_created_at"],
        }
        for row in rows
    ]


def get_user_primary_org(user_id: str) -> dict | None:
    with get_connection() as conn:
        owner = conn.execute(
            """
            SELECT o.id, o.name, m.role
            FROM organization_members m
            JOIN organizations o ON o.id = m.organization_id
            WHERE m.user_id = ? AND m.role = 'owner'
            ORDER BY o.created_at DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        if owner:
            return {"id": owner["id"], "name": owner["name"], "role": owner["role"]}
        member = conn.execute(
            """
            SELECT o.id, o.name, m.role
            FROM organization_members m
            JOIN organizations o ON o.id = m.organization_id
            WHERE m.user_id = ?
            ORDER BY o.created_at ASC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
    if not member:
        return None
    return {"id": member["id"], "name": member["name"], "role": member["role"]}


def is_user_member_of_org(user_id: str, org_id: str) -> bool:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT 1
            FROM organization_members
            WHERE user_id = ? AND organization_id = ?
            LIMIT 1
            """,
            (user_id, org_id),
        ).fetchone()
    return row is not None


def get_user_org_role(user_id: str, org_id: str) -> str | None:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT role
            FROM organization_members
            WHERE user_id = ? AND organization_id = ?
            LIMIT 1
            """,
            (user_id, org_id),
        ).fetchone()
    return row["role"] if row else None
logger = logging.getLogger(__name__)
