from __future__ import annotations

from contextlib import closing
from email.errors import MessageError
import logging
from sqlite3 import Connection
from urllib.parse import urlencode, urlsplit, urlunsplit

from auth import email_service
from auth.db import get_connection
from auth.security import expires_in, make_email_verification_token, make_org_invite_public_token, to_iso_z, utcnow
from core.auth_config import get_auth_config


logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 5
LEASE_SECONDS = 300


def queue_auth_email(conn: Connection, user_id: str, kind: str, verification_id: str | None = None) -> None:
    if email_service.smtp_email_enabled():
        conn.execute(
            """
            INSERT INTO auth_email_outbox(user_id, kind, verification_id, available_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, verification_id) WHERE verification_id IS NOT NULL DO NOTHING
            """,
            (user_id, kind, verification_id, to_iso_z(utcnow())),
        )


def queue_org_invite_email(conn: Connection, invite_id: str, language: str) -> None:
    conn.execute(
        "INSERT INTO auth_email_outbox(kind, invite_id, language, available_at) VALUES ('organization_invite', ?, ?, ?)",
        (invite_id, language, to_iso_z(utcnow())),
    )


def queue_org_access_notice(conn: Connection, user_id: str, org_id: str, notice_type: str) -> None:
    if email_service.smtp_email_enabled():
        conn.execute(
            """
            INSERT INTO auth_email_outbox(user_id, kind, notice_type, notice_org_name, available_at)
            SELECT ?, 'organization_notice', ?, name, ? FROM organizations WHERE id = ?
            """,
            (user_id, notice_type, to_iso_z(utcnow()), org_id),
        )


def _frontend_link(route: str, token: str) -> str:
    base = urlsplit(get_auth_config().password_reset_url_base)
    directory = base.path.rstrip("/").rpartition("/")[0]
    return urlunsplit((base.scheme, base.netloc, f"{directory}/{route}", "", urlencode({"token": token})))


def deliver_next_auth_email() -> bool:
    with closing(get_connection()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        now = to_iso_z(utcnow())
        job = conn.execute(
            """
            SELECT o.id, o.kind, o.verification_id, o.attempts, u.email,
                   o.notice_type, o.notice_org_name,
                   COALESCE(o.language, u.language) AS language,
                   v.verification_id AS current_verification_id, v.expires_at,
                   i.id AS invite_id, i.recipient_email, i.expires_at AS invite_expires_at,
                   i.revoked_at, i.used_at, org.name AS org_name, inviter.email AS inviter_email
            FROM auth_email_outbox o
            LEFT JOIN users u ON u.id = o.user_id
            LEFT JOIN email_verifications v ON v.user_id = o.user_id
            LEFT JOIN organization_invites i ON i.id = o.invite_id
            LEFT JOIN organizations org ON org.id = i.organization_id
            LEFT JOIN users inviter ON inviter.id = i.created_by_user_id
            WHERE o.available_at <= ?
            ORDER BY o.available_at, o.id
            LIMIT 1
            """,
            (now,),
        ).fetchone()
        if not job:
            return False
        attempts = job["attempts"] + 1
        conn.execute(
            "UPDATE auth_email_outbox SET attempts = ?, available_at = ? WHERE id = ?",
            (attempts, expires_in(LEASE_SECONDS), job["id"]),
        )

    retry_at = None
    try:
        if attempts <= MAX_ATTEMPTS:
            if job["kind"] == "password_changed":
                email_service.send_password_changed_email(job["email"], job["language"])
            elif job["kind"] == "organization_notice":
                email_service.send_org_access_notice(
                    job["email"], job["notice_org_name"], job["notice_type"], job["language"],
                )
            elif job["kind"] == "organization_invite":
                if not job["revoked_at"] and not job["used_at"] and job["invite_expires_at"] > now:
                    email_service.send_organization_invite(
                        job["recipient_email"], _frontend_link("join-org", make_org_invite_public_token(job["invite_id"])),
                        job["org_name"], job["inviter_email"], job["language"],
                    )
            elif job["verification_id"] == job["current_verification_id"] and job["expires_at"] > now:
                email_service.send_email_verification(
                    job["email"], _frontend_link("verify-email", make_email_verification_token(job["verification_id"])),
                    job["language"],
                )
    except (OSError, RuntimeError, ValueError, MessageError) as exc:
        if attempts < MAX_ATTEMPTS:
            retry_at = expires_in(30 * 2 ** (attempts - 1))
        logger.warning(
            "Auth email delivery failed: kind=%s attempt=%s error=%s retry=%s",
            job["kind"], attempts, type(exc).__name__, retry_at is not None,
        )

    with closing(get_connection()) as conn, conn:
        if retry_at:
            conn.execute(
                "UPDATE auth_email_outbox SET available_at = ? WHERE id = ? AND attempts = ?",
                (retry_at, job["id"], attempts),
            )
        else:
            conn.execute("DELETE FROM auth_email_outbox WHERE id = ? AND attempts = ?", (job["id"], attempts))
    return True
