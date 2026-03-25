from __future__ import annotations

from dataclasses import dataclass
import logging
import secrets
from uuid import uuid4

from auth.db import get_connection
from auth.email_service import send_password_reset_email
from auth.security import (
    digest_token,
    expires_in,
    from_iso_z,
    hash_password,
    make_org_invite_public_token,
    new_session_token,
    parse_org_invite_public_token,
    to_iso_z,
    utcnow,
    verify_password,
)
from core.auth_config import get_auth_config
from services.org_model_storage import delete_org_storage
from services.project_notes_storage import delete_project_notes


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


def change_password(user_id: str, current_password: str, new_password: str) -> None:
    if not current_password:
        raise ValueError("Aktualne heslo je povinne.")
    if not _validate_password(new_password):
        raise ValueError("Heslo musi mat aspon 8 znakov.")
    with get_connection() as conn:
        row = conn.execute(
            "SELECT password_hash FROM users WHERE id = ? LIMIT 1",
            (user_id,),
        ).fetchone()
        if not row:
            raise ValueError("Pouzivatel neexistuje.")
        if not verify_password(row["password_hash"], current_password):
            raise ValueError("Aktualne heslo nie je spravne.")

        now_iso = to_iso_z(utcnow())
        conn.execute(
            """
            UPDATE users
            SET password_hash = ?, updated_at = ?
            WHERE id = ?
            """,
            (hash_password(new_password), now_iso, user_id),
        )
        conn.commit()


def request_password_reset(email: str) -> None:
    normalized_email = normalize_email(email)
    cfg = get_auth_config()
    if not _validate_email(normalized_email):
        return

    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, email FROM users WHERE email = ? LIMIT 1",
            (normalized_email,),
        ).fetchone()
        if not row:
            return
        reset_token = secrets.token_urlsafe(48)
        reset_token_hash = digest_token(reset_token)
        expires_at = expires_in(cfg.password_reset_ttl_seconds)
        now = to_iso_z(utcnow())
        conn.execute(
            """
            UPDATE users
            SET password_reset_token_hash = ?, password_reset_expires_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (reset_token_hash, expires_at, now, row["id"]),
        )
        conn.commit()

    base_url = cfg.password_reset_url_base.rstrip("/")
    reset_link = f"{base_url}?token={reset_token}"
    send_password_reset_email(row["email"], reset_link)


def confirm_password_reset(token: str, new_password: str) -> None:
    cleaned_token = (token or "").strip()
    if not cleaned_token:
        raise ValueError("Reset token je povinny.")
    if not _validate_password(new_password):
        raise ValueError("Heslo musi mat aspon 8 znakov.")

    token_hash = digest_token(cleaned_token)
    now = utcnow()
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, password_hash, password_reset_expires_at
            FROM users
            WHERE password_reset_token_hash = ?
            LIMIT 1
            """,
            (token_hash,),
        ).fetchone()
        if not row:
            raise ValueError("Reset link je neplatny alebo expirovany.")

        expires_at = row["password_reset_expires_at"]
        if not expires_at or from_iso_z(expires_at) <= now:
            conn.execute(
                """
                UPDATE users
                SET password_reset_token_hash = NULL, password_reset_expires_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (to_iso_z(now), row["id"]),
            )
            conn.commit()
            raise ValueError("Reset link je neplatny alebo expirovany.")

        if verify_password(row["password_hash"], new_password):
            raise ValueError("Nove heslo sa musi lisit od povodneho.")

        password_hash = hash_password(new_password)
        now_iso = to_iso_z(now)
        conn.execute(
            """
            UPDATE users
            SET password_hash = ?,
                password_reset_token_hash = NULL,
                password_reset_expires_at = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (password_hash, now_iso, row["id"]),
        )
        conn.execute(
            """
            UPDATE auth_sessions
            SET revoked_at = ?
            WHERE user_id = ? AND revoked_at IS NULL
            """,
            (now_iso, row["id"]),
        )
        conn.commit()


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
    owned_org = get_user_owned_org(user_id)
    if owned_org:
        raise ValueError("Uz mas svoju organizaciu. Mozes vlastnit iba jednu organizaciu.")
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
            "role": normalize_org_role(row["role"]),
            "org_created_at": row["org_created_at"],
            "member_created_at": row["member_created_at"],
        }
        for row in rows
    ]


def get_user_owned_org(user_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT o.id, o.name, m.role
            FROM organization_members m
            JOIN organizations o ON o.id = m.organization_id
            WHERE m.user_id = ? AND LOWER(m.role) IN ('owner', 'admin')
            ORDER BY o.created_at DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
    if not row:
        return None
    return {"id": row["id"], "name": row["name"], "role": normalize_org_role(row["role"])}


def get_user_primary_org(user_id: str) -> dict | None:
    with get_connection() as conn:
        owner = conn.execute(
            """
            SELECT o.id, o.name, m.role
            FROM organization_members m
            JOIN organizations o ON o.id = m.organization_id
            WHERE m.user_id = ? AND LOWER(m.role) IN ('owner', 'admin')
            ORDER BY o.created_at DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        if owner:
            return {"id": owner["id"], "name": owner["name"], "role": normalize_org_role(owner["role"])}
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
    return {"id": member["id"], "name": member["name"], "role": normalize_org_role(member["role"])}


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
    return normalize_org_role(row["role"]) if row else None


def find_user_id_by_email(email: str) -> str | None:
    normalized_email = normalize_email(email)
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE email = ? LIMIT 1",
            (normalized_email,),
        ).fetchone()
    return row["id"] if row else None


def add_org_member(user_id: str, org_id: str, role: str) -> None:
    normalized_role = normalize_org_role(role)
    if normalized_role not in {"owner", "member", "viewer"}:
        raise ValueError("Neplatna rola clena organizacie.")
    now = to_iso_z(utcnow())
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO organization_members(id, organization_id, user_id, role, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (str(uuid4()), org_id, user_id, normalized_role, now),
        )
        conn.commit()


def count_org_owners(org_id: str) -> int:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS owner_count
            FROM organization_members
            WHERE organization_id = ? AND LOWER(role) IN ('owner', 'admin')
            """,
            (org_id,),
        ).fetchone()
    return int(row["owner_count"] or 0) if row else 0


def list_org_members(org_id: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT u.email, m.role
            FROM organization_members m
            JOIN users u ON u.id = m.user_id
            WHERE m.organization_id = ?
            ORDER BY u.email ASC
            """,
            (org_id,),
        ).fetchall()
    return [{"email": row["email"], "role": normalize_org_role(row["role"])} for row in rows]


def update_org_member_role_by_email(org_id: str, email: str, role: str) -> dict:
    normalized_email = normalize_email(email)
    normalized_role = normalize_org_role(role)
    if not normalized_email:
        raise ValueError("Email je povinny.")
    if normalized_role not in {"owner", "member", "viewer"}:
        raise ValueError("Neplatna rola clena organizacie.")
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT m.id AS membership_id, m.role AS role, u.email AS email
            FROM organization_members m
            JOIN users u ON u.id = m.user_id
            WHERE m.organization_id = ? AND u.email = ?
            LIMIT 1
            """,
            (org_id, normalized_email),
        ).fetchone()
        if not row:
            raise LookupError("Pouzivatel nie je clenom organizacie.")
        current_role = normalize_org_role(row["role"])
        if current_role == normalized_role:
            return {"email": row["email"], "role": current_role, "updated": False}
        if current_role == "owner" and normalized_role != "owner" and count_org_owners(org_id) <= 1:
            raise ValueError("V organizacii musi vzdy ostat aspon jeden owner.")
        conn.execute(
            "UPDATE organization_members SET role = ? WHERE id = ?",
            (normalized_role, row["membership_id"]),
        )
        conn.commit()
    return {"email": row["email"], "role": normalized_role, "updated": True}


def remove_org_member_by_email(org_id: str, email: str) -> dict:
    normalized_email = normalize_email(email)
    if not normalized_email:
        raise ValueError("Email je povinny.")
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT m.id AS membership_id, m.role AS role, u.email AS email
            FROM organization_members m
            JOIN users u ON u.id = m.user_id
            WHERE m.organization_id = ? AND u.email = ?
            LIMIT 1
            """,
            (org_id, normalized_email),
        ).fetchone()
        if not row:
            raise LookupError("Pouzivatel nie je clenom organizacie.")
        role = normalize_org_role(row["role"])
        if role == "owner" and count_org_owners(org_id) <= 1:
            raise ValueError("Posledneho ownera organizacie nie je mozne odstranit.")
        conn.execute(
            "DELETE FROM organization_members WHERE id = ?",
            (row["membership_id"],),
        )
        conn.commit()
    return {"email": row["email"], "removed": True}


def get_org_by_id(org_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, name
            FROM organizations
            WHERE id = ?
            LIMIT 1
            """,
            (org_id,),
        ).fetchone()
    if not row:
        return None
    return {"id": row["id"], "name": row["name"]}


def delete_org_by_owner(org_id: str, user_id: str) -> dict:
    role = get_user_org_role(user_id, org_id)
    if role != "owner":
        raise PermissionError("Pouzivatel nema pravo upravovat organizaciu.")

    org = get_org_by_id(org_id)
    if not org:
        raise LookupError("Organizacia neexistuje.")

    with get_connection() as conn:
        conn.execute("DELETE FROM organizations WHERE id = ?", (org_id,))
        conn.commit()

    delete_org_storage(org_id)
    delete_project_notes(org_id)
    logger.info("Deleted org %s by user %s", org_id, user_id)
    return {"id": org_id, "name": org["name"], "deleted": True}


def _row_value(row: dict | None, key: str):
    if not row:
        return None
    if isinstance(row, dict):
        return row.get(key)
    try:
        return row[key]
    except Exception:
        return None


def _invite_status_from_row(row: dict | None, now=None) -> str:
    if not row:
        return "missing"
    if _row_value(row, "revoked_at"):
        return "revoked"
    if _row_value(row, "used_at"):
        return "used"
    expires_at = _row_value(row, "expires_at")
    if expires_at:
        current = now or utcnow()
        try:
            if from_iso_z(expires_at) <= current:
                return "expired"
        except Exception:
            return "expired"
    return "active"


def _serialize_org_invite(row: dict | None) -> dict | None:
    if not row:
        return None
    stored_token = _row_value(row, "token")
    public_token = stored_token
    if isinstance(stored_token, str):
        token_value = stored_token.strip()
        if len(token_value) == 64 and all(ch in "0123456789abcdef" for ch in token_value.lower()):
            public_token = make_org_invite_public_token(str(_row_value(row, "id") or ""))
    return {
        "id": _row_value(row, "id"),
        "organization_id": _row_value(row, "organization_id"),
        "token": public_token,
        "created_by_user_id": _row_value(row, "created_by_user_id"),
        "created_at": _row_value(row, "created_at"),
        "expires_at": _row_value(row, "expires_at"),
        "revoked_at": _row_value(row, "revoked_at"),
        "used_at": _row_value(row, "used_at"),
        "used_by_user_id": _row_value(row, "used_by_user_id"),
        "status": _invite_status_from_row(row),
    }


def get_latest_org_invite(org_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, organization_id, token, created_by_user_id, created_at, expires_at, revoked_at, used_at, used_by_user_id
            FROM organization_invites
            WHERE organization_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (org_id,),
        ).fetchone()
    return _serialize_org_invite(row)


def get_active_org_invite(org_id: str) -> dict | None:
    latest = get_latest_org_invite(org_id)
    if not latest:
        return None
    return latest if latest.get("status") == "active" else None


def create_org_invite(org_id: str, created_by_user_id: str) -> dict:
    cfg = get_auth_config()
    now = to_iso_z(utcnow())
    expires_at = expires_in(cfg.org_invite_ttl_seconds)
    invite_id = str(uuid4())
    public_token = make_org_invite_public_token(invite_id)
    stored_token = digest_token(public_token)
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO organization_invites(
                id, organization_id, token, created_by_user_id, created_at, expires_at, revoked_at, used_at, used_by_user_id
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
            """,
            (invite_id, org_id, stored_token, created_by_user_id, now, expires_at),
        )
        conn.commit()
    return _serialize_org_invite(
        {
            "id": invite_id,
            "organization_id": org_id,
            "token": stored_token,
            "created_by_user_id": created_by_user_id,
            "created_at": now,
            "expires_at": expires_at,
            "revoked_at": None,
            "used_at": None,
            "used_by_user_id": None,
        }
    )


def revoke_active_org_invites(org_id: str) -> None:
    now = to_iso_z(utcnow())
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE organization_invites
            SET revoked_at = ?
            WHERE organization_id = ?
              AND revoked_at IS NULL
              AND used_at IS NULL
              AND (expires_at IS NULL OR expires_at > ?)
            """,
            (now, org_id, now),
        )
        conn.commit()


def get_or_create_org_invite(org_id: str, created_by_user_id: str) -> dict:
    existing = get_active_org_invite(org_id)
    if existing:
        return existing
    return create_org_invite(org_id, created_by_user_id)


def regenerate_org_invite(org_id: str, created_by_user_id: str) -> dict:
    revoke_active_org_invites(org_id)
    return create_org_invite(org_id, created_by_user_id)


def accept_org_invite(token: str, user_id: str) -> dict:
    cleaned = (token or "").strip()
    if not cleaned:
        raise ValueError("Pozývací link je neplatný.")
    now_dt = utcnow()
    now_iso = to_iso_z(now_dt)
    with get_connection() as conn:
        invite_id = parse_org_invite_public_token(cleaned)
        if invite_id:
            invite = conn.execute(
                """
                SELECT i.id, i.organization_id, i.token, i.created_at, i.expires_at, i.revoked_at, i.used_at, i.used_by_user_id, o.name
                FROM organization_invites i
                JOIN organizations o ON o.id = i.organization_id
                WHERE i.id = ?
                LIMIT 1
                """,
                (invite_id,),
            ).fetchone()
        else:
            invite = conn.execute(
                """
                SELECT i.id, i.organization_id, i.token, i.created_at, i.expires_at, i.revoked_at, i.used_at, i.used_by_user_id, o.name
                FROM organization_invites i
                JOIN organizations o ON o.id = i.organization_id
                WHERE i.token = ?
                LIMIT 1
                """,
                (cleaned,),
            ).fetchone()
        if not invite:
            raise ValueError("Pozývací link je neplatný.")
        invite_row = {
            "id": invite["id"],
            "organization_id": invite["organization_id"],
            "token": invite["token"],
            "created_at": invite["created_at"],
            "expires_at": invite["expires_at"],
            "revoked_at": invite["revoked_at"],
            "used_at": invite["used_at"],
            "used_by_user_id": invite["used_by_user_id"],
        }
        invite_status = _invite_status_from_row(invite_row, now_dt)
        if invite_status == "expired":
            raise ValueError("Pozývací link už vypršal.")
        if invite_status == "revoked":
            raise ValueError("Pozývací link bol zrušený.")
        if invite_status == "used":
            raise ValueError("Pozývací link už bol použitý.")

        existing = conn.execute(
            """
            SELECT role
            FROM organization_members
            WHERE organization_id = ? AND user_id = ?
            LIMIT 1
            """,
            (invite["organization_id"], user_id),
        ).fetchone()

        updated = conn.execute(
            """
            UPDATE organization_invites
            SET used_at = ?, used_by_user_id = ?
            WHERE id = ?
              AND used_at IS NULL
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > ?)
            """,
            (now_iso, user_id, invite["id"], now_iso),
        )
        if updated.rowcount == 0:
            raise ValueError("Pozývací link už bol použitý.")

        if existing:
            conn.commit()
            return {
                "org": {"id": invite["organization_id"], "name": invite["name"]},
                "membership": {"role": normalize_org_role(existing["role"]), "already_member": True},
                "invite": {"status": "used", "used_at": now_iso, "used_by_user_id": user_id},
            }

        conn.execute(
            """
            INSERT INTO organization_members(id, organization_id, user_id, role, created_at)
            VALUES (?, ?, ?, 'member', ?)
            """,
            (str(uuid4()), invite["organization_id"], user_id, now_iso),
        )
        conn.commit()
    return {
        "org": {"id": invite["organization_id"], "name": invite["name"]},
        "membership": {"role": "member", "already_member": False},
        "invite": {"status": "used", "used_at": now_iso, "used_by_user_id": user_id},
    }

def normalize_org_role(role: str | None) -> str:
    cleaned = str(role or "").strip().lower()
    if cleaned == "admin":
        return "owner"
    return cleaned


def resolve_accessible_org_id(user_id: str, org_id: str | None) -> str:
    cleaned_org_id = str(org_id or "").strip()
    if cleaned_org_id:
        if not is_user_member_of_org(user_id, cleaned_org_id):
            raise PermissionError("Pouzivatel nema pristup k organizacii.")
        return cleaned_org_id

    orgs = get_user_orgs(user_id)
    if not orgs:
        raise LookupError("Pouzivatel nema organizaciu.")
    if len(orgs) == 1:
        return str(orgs[0]["id"])
    raise ValueError("Vyber aktivnu organizaciu.")
logger = logging.getLogger(__name__)

