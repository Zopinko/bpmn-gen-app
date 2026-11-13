from __future__ import annotations

import base64
import hmac
import os
import re
import secrets
from time import time

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
import pyotp
import qrcode
from qrcode.image.svg import SvgPathImage

from auth.db import get_connection
from auth.security import digest_token, expires_in, to_iso_z, utcnow


def encryption_key() -> Fernet:
    try:
        return Fernet(os.environ.get("ADMIN_MFA_ENCRYPTION_KEY", "").strip().encode())
    except (ValueError, TypeError):
        raise HTTPException(503, "Admin MFA configuration is unavailable.") from None


def _active_elevation(conn, session_hash: str) -> str | None:
    row = conn.execute(
        """SELECT expires_at FROM admin_mfa_elevations
           WHERE session_hash = ? AND expires_at > ?""",
        (session_hash, to_iso_z(utcnow())),
    ).fetchone()
    return row["expires_at"] if row else None


def status(user_id: str, session_hash: str) -> tuple[bool, str | None]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT enabled_at FROM admin_mfa WHERE user_id = ?", (user_id,)
        ).fetchone()
        enrolled = row is not None and row["enabled_at"] is not None
        return enrolled, _active_elevation(conn, session_hash) if enrolled else None


def is_unlocked(user_id: str, session_hash: str) -> bool:
    try:
        encryption_key()
    except HTTPException:
        return False
    return status(user_id, session_hash)[1] is not None


def record_attempt(user_id: str) -> None:
    now = int(time())
    with get_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT window_start, attempts FROM admin_mfa_attempts WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row and row["window_start"] > now - 300:
            if row["attempts"] >= 8:
                raise HTTPException(429, "Too many attempts. Try again in a few minutes.")
            conn.execute(
                "UPDATE admin_mfa_attempts SET attempts = attempts + 1 WHERE user_id = ?", (user_id,)
            )
        else:
            conn.execute(
                """INSERT INTO admin_mfa_attempts (user_id, window_start, attempts) VALUES (?, ?, 1)
                   ON CONFLICT (user_id) DO UPDATE SET window_start = excluded.window_start, attempts = 1""",
                (user_id, now),
            )


def start_setup(user_id: str, email: str, session_hash: str) -> dict[str, str]:
    key = encryption_key()
    secret = pyotp.random_base32()
    ciphertext = key.encrypt(f"{user_id}:{secret}".encode()).decode()
    uri = pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="BPMN.GEN")
    qr = qrcode.make(uri, image_factory=SvgPathImage).to_string()
    with get_connection() as conn:
        result = conn.execute(
            """INSERT INTO admin_mfa (user_id, secret_ciphertext, pending_session_hash, pending_expires_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext = excluded.secret_ciphertext,
                   pending_session_hash = excluded.pending_session_hash,
                   pending_expires_at = excluded.pending_expires_at
               WHERE admin_mfa.enabled_at IS NULL""",
            (user_id, ciphertext, session_hash, expires_in(600)),
        )
        if not result.rowcount:
            raise HTTPException(409, "Admin MFA is already configured.")
    return {
        "manual_key": secret,
        "qr_data_url": "data:image/svg+xml;base64," + base64.b64encode(qr).decode(),
    }


def _matching_counter(row, key: Fernet, code: str) -> int | None:
    if not re.fullmatch(r"[0-9]{6}", code):
        return None
    try:
        owner, secret = key.decrypt(row["secret_ciphertext"].encode()).decode().split(":", 1)
    except (InvalidToken, ValueError):
        raise HTTPException(503, "Admin MFA configuration is unavailable.") from None
    if owner != row["user_id"]:
        raise HTTPException(503, "Admin MFA configuration is unavailable.")
    totp = pyotp.TOTP(secret)
    current = int(time()) // totp.interval
    previous = row["last_counter"]
    for counter in (current, current - 1, current + 1):
        if (previous is None or counter > previous) and hmac.compare_digest(
            totp.generate_otp(counter), code
        ):
            return counter
    return None


def _elevate(conn, session_hash: str) -> str:
    expires_at = expires_in(900)
    conn.execute(
        """INSERT INTO admin_mfa_elevations (session_hash, expires_at) VALUES (?, ?)
           ON CONFLICT (session_hash) DO UPDATE SET expires_at = excluded.expires_at""",
        (session_hash, expires_at),
    )
    return expires_at


def confirm_setup(user_id: str, session_hash: str, code: str) -> list[str]:
    key = encryption_key()
    with get_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM admin_mfa WHERE user_id = ?", (user_id,)).fetchone()
        now = to_iso_z(utcnow())
        if (
            row is None or row["enabled_at"] or row["pending_session_hash"] != session_hash
            or row["pending_expires_at"] <= now
        ):
            raise HTTPException(409, "Start admin MFA setup again.")
        counter = _matching_counter(row, key, code)
        if counter is None:
            raise HTTPException(403, "Invalid or already used code.")
        codes = [secrets.token_hex(16) for _ in range(8)]
        conn.executemany(
            "INSERT INTO admin_mfa_recovery (user_id, code_hash) VALUES (?, ?)",
            [(user_id, digest_token(value)) for value in codes],
        )
        conn.execute(
            """UPDATE admin_mfa SET enabled_at = ?, last_counter = ?, pending_session_hash = NULL,
               pending_expires_at = NULL WHERE user_id = ?""",
            (now, counter, user_id),
        )
        _elevate(conn, session_hash)
    return codes


def unlock(user_id: str, session_hash: str, code: str) -> str:
    key = encryption_key()
    with get_connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM admin_mfa WHERE user_id = ?", (user_id,)).fetchone()
        if row is None or row["enabled_at"] is None:
            raise HTTPException(409, "Configure admin MFA first.")
        counter = _matching_counter(row, key, code)
        if counter is not None:
            conn.execute("UPDATE admin_mfa SET last_counter = ? WHERE user_id = ?", (counter, user_id))
        else:
            removed = conn.execute(
                "DELETE FROM admin_mfa_recovery WHERE user_id = ? AND code_hash = ?",
                (user_id, digest_token(code.lower())),
            )
            if not removed.rowcount:
                raise HTTPException(403, "Invalid or already used code.")
        return _elevate(conn, session_hash)
