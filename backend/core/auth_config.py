from __future__ import annotations

from dataclasses import dataclass
import os


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None:
        return default
    value = value.strip()
    return value or default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _is_production() -> bool:
    return _env("APP_ENV", "development").lower() in {"prod", "production"}


def _required_env_in_production(name: str) -> str | None:
    raw = os.getenv(name)
    if raw is not None:
        value = raw.strip()
        if value:
            return value
    if _is_production():
        raise RuntimeError(f"{name} must be configured when APP_ENV is production.")
    return None


@dataclass(frozen=True)
class AuthConfig:
    app_env: str
    is_production: bool
    cors_allowed_origins: list[str]
    cors_allow_credentials: bool
    cookie_name: str
    cookie_domain: str | None
    cookie_samesite: str
    cookie_secure: bool
    cookie_httponly: bool
    session_ttl_seconds: int
    require_verified_email: bool
    auth_db_path: str
    password_reset_ttl_seconds: int
    password_reset_url_base: str
    org_invite_ttl_seconds: int


def get_auth_config() -> AuthConfig:
    is_prod = _is_production()
    env = _env("APP_ENV", "development").lower()

    dev_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    prod_default_origins = [
        "https://app.bpmngen.com",
        "https://www.bpmngen.com",
        "https://bpmngen.com",
        "https://bpmn-gen-frontend.onrender.com",
    ]
    allowed_origins = _split_csv(_required_env_in_production("CORS_ALLOW_ORIGINS"))
    if not allowed_origins:
        allowed_origins = prod_default_origins if is_prod else dev_origins

    cookie_secure_default = "true" if is_prod else "false"
    cookie_secure = _env("SESSION_COOKIE_SECURE", cookie_secure_default).lower() == "true"
    cookie_samesite_default = "none" if is_prod else "lax"
    cookie_samesite = _env("SESSION_COOKIE_SAMESITE", cookie_samesite_default).lower()
    if cookie_samesite not in {"lax", "strict", "none"}:
        cookie_samesite = cookie_samesite_default
    if cookie_samesite == "none" and not cookie_secure:
        # Browsers reject SameSite=None cookies without Secure.
        cookie_secure = True
    cookie_domain = os.getenv("SESSION_COOKIE_DOMAIN")
    if cookie_domain is not None:
        cookie_domain = cookie_domain.strip() or None
    password_reset_url_base = _required_env_in_production("PASSWORD_RESET_URL_BASE") or _env(
        "PASSWORD_RESET_URL_BASE",
        "http://localhost:5173/reset-password",
    )
    auth_db_path = _required_env_in_production("AUTH_DB_PATH") or _env("AUTH_DB_PATH", "data/auth.db")

    return AuthConfig(
        app_env=env,
        is_production=is_prod,
        cors_allowed_origins=allowed_origins,
        cors_allow_credentials=True,
        cookie_name=_env("SESSION_COOKIE_NAME", "bpmngen_session"),
        cookie_domain=cookie_domain,
        cookie_samesite=cookie_samesite,
        cookie_secure=cookie_secure,
        cookie_httponly=True,
        session_ttl_seconds=_env_int("SESSION_TTL_SECONDS", 60 * 60 * 24 * 7),
        require_verified_email=_env("AUTH_REQUIRE_VERIFIED_EMAIL", "false").lower() == "true",
        auth_db_path=auth_db_path,
        password_reset_ttl_seconds=_env_int("PASSWORD_RESET_TTL_SECONDS", 60 * 30),
        password_reset_url_base=password_reset_url_base,
        org_invite_ttl_seconds=max(60, _env_int("ORG_INVITE_TTL_HOURS", 24 * 7) * 60 * 60),
    )
