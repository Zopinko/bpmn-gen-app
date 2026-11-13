from __future__ import annotations

import os
from fastapi import Depends, HTTPException, Request

from auth.admin_mfa import is_unlocked
from auth.service import AuthUser, find_user_by_session, get_user_primary_org
from auth.security import digest_token
from core.auth_config import get_auth_config


def is_super_admin_id(user_id: str) -> bool:
    raw = os.environ.get("SUPER_ADMIN_USER_IDS", "")
    return bool(user_id and user_id in {item.strip() for item in raw.split(",")})


def is_admin_panel_available() -> bool:
    raw = os.environ.get("ADMIN_PANEL_AVAILABLE", "")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def is_super_admin_user(user: AuthUser) -> bool:
    return is_super_admin_id(user.id)


def require_user(request: Request) -> AuthUser:
    app_env = (os.environ.get("APP_ENV") or "development").strip().lower()
    test_auth_enabled = os.environ.get("BPMN_TEST_AUTH") == "1"
    if os.environ.get("PYTEST_CURRENT_TEST") or (test_auth_enabled and app_env in {"dev", "development", "local"}):
        return AuthUser(
            id="",
            email="test@example.com",
            role="owner",
            email_verified_at=None,
            created_at="1970-01-01T00:00:00Z",
        )
    cfg = get_auth_config()
    token = request.cookies.get(cfg.cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Pouzivatel nie je prihlaseny.")
    user = find_user_by_session(token)
    if not user:
        raise HTTPException(status_code=401, detail="Pouzivatel nie je prihlaseny.")
    return user


def require_primary_org_id(user: AuthUser) -> str:
    org = get_user_primary_org(user.id)
    if not org:
        raise HTTPException(status_code=403, detail="Pouzivatel nema organizaciu.")
    return org["id"]


def require_admin_identity(request: Request) -> AuthUser:
    if not is_admin_panel_available():
        raise HTTPException(status_code=404, detail="Not found")
    token = request.cookies.get(get_auth_config().cookie_name)
    user = find_user_by_session(token) if token else None
    if user is None or not is_super_admin_user(user):
        raise HTTPException(status_code=404, detail="Not found")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if origin is not None and origin not in get_auth_config().cors_allowed_origins:
            raise HTTPException(status_code=403, detail="Origin not allowed.")
    return user


def admin_session_hash(request: Request) -> str:
    return digest_token(request.cookies[get_auth_config().cookie_name])


def require_super_admin(request: Request, user: AuthUser = Depends(require_admin_identity)) -> AuthUser:
    if not user.email_verified_at or not is_unlocked(user.id, admin_session_hash(request)):
        raise HTTPException(status_code=403, detail="Admin MFA required.")
    return user
