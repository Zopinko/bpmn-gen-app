from __future__ import annotations

from contextlib import closing
from datetime import timedelta
from hmac import compare_digest
from sqlite3 import Connection
from uuid import uuid4

from auth.db import get_connection
from auth.email_outbox import queue_auth_email
from auth.security import from_iso_z, make_email_verification_token, to_iso_z, utcnow


VERIFICATION_TTL = timedelta(hours=24)
RESEND_COOLDOWN = timedelta(minutes=1)


def queue_email_verification(conn: Connection, user_id: str) -> None:
    now = utcnow()
    current = conn.execute(
        "SELECT verification_id, expires_at, requested_at FROM email_verifications WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if current and now - from_iso_z(current["requested_at"]) < RESEND_COOLDOWN:
        return
    if current and from_iso_z(current["expires_at"]) > now:
        verification_id, expires_at = current["verification_id"], current["expires_at"]
    else:
        verification_id, expires_at = str(uuid4()), to_iso_z(now + VERIFICATION_TTL)

    conn.execute(
        """
        INSERT INTO email_verifications(user_id, verification_id, expires_at, requested_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET verification_id = excluded.verification_id,
            expires_at = excluded.expires_at, requested_at = excluded.requested_at
        """,
        (user_id, verification_id, expires_at, to_iso_z(now)),
    )
    queue_auth_email(conn, user_id, "verify_email", verification_id)


def request_email_verification(email: str) -> None:
    with closing(get_connection()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        user = conn.execute(
            "SELECT id FROM users WHERE email = ? AND email_verified_at IS NULL",
            (email.strip().lower(),),
        ).fetchone()
        if user:
            queue_email_verification(conn, user["id"])


def verify_email(token: str) -> None:
    invalid_link = "Email verification link is invalid or expired."
    verification_id, _, signature = token.partition(".")
    if len(verification_id) != 36 or len(signature) != 43 or not token.isascii():
        raise ValueError(invalid_link)
    if not compare_digest(token, make_email_verification_token(verification_id)):
        raise ValueError(invalid_link)
    with closing(get_connection()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        now = to_iso_z(utcnow())
        updated = conn.execute(
            """
            UPDATE users SET email_verified_at = ?, updated_at = ?
            WHERE email_verified_at IS NULL AND id = (
                SELECT user_id FROM email_verifications WHERE verification_id = ? AND expires_at > ?
            )
            """,
            (now, now, verification_id, now),
        )
        if not updated.rowcount:
            raise ValueError(invalid_link)
        conn.execute("DELETE FROM email_verifications WHERE verification_id = ?", (verification_id,))
        conn.execute("DELETE FROM auth_email_outbox WHERE verification_id = ?", (verification_id,))
