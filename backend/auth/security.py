from __future__ import annotations

from datetime import datetime, timedelta, timezone
import base64
import hashlib
import hmac
import secrets

try:
    from argon2 import PasswordHasher
    from argon2.exceptions import InvalidHash, VerifyMismatchError

    _ARGON2_HASHER: PasswordHasher | None = PasswordHasher()
    _ARGON2_AVAILABLE = True
except ModuleNotFoundError:  # pragma: no cover - depends on runtime env
    _ARGON2_HASHER = None
    _ARGON2_AVAILABLE = False


_PBKDF2_ITERATIONS = 210_000


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def from_iso_z(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def hash_password(password: str) -> str:
    if _ARGON2_AVAILABLE and _ARGON2_HASHER is not None:
        return _ARGON2_HASHER.hash(password)
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    salt_b64 = base64.b64encode(salt).decode("ascii")
    digest_b64 = base64.b64encode(digest).decode("ascii")
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt_b64}${digest_b64}"


def verify_password(password_hash: str, password: str) -> bool:
    if password_hash.startswith("pbkdf2_sha256$"):
        try:
            _, iterations, salt_b64, digest_b64 = password_hash.split("$", 3)
            salt = base64.b64decode(salt_b64.encode("ascii"))
            expected = base64.b64decode(digest_b64.encode("ascii"))
            calculated = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                salt,
                int(iterations),
            )
            return hmac.compare_digest(calculated, expected)
        except Exception:
            return False
    if not _ARGON2_AVAILABLE or _ARGON2_HASHER is None:
        return False
    try:
        return _ARGON2_HASHER.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHash):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(48)


def digest_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def expires_in(seconds: int) -> str:
    return to_iso_z(utcnow() + timedelta(seconds=seconds))
