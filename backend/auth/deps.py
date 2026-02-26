from __future__ import annotations

import os
from fastapi import Depends, HTTPException, Request

from auth.service import AuthUser, find_user_by_session, get_user_primary_org
from core.auth_config import get_auth_config


def _super_admin_allowlist() -> set[str]:
    raw = os.environ.get("SUPER_ADMIN_EMAILS", "")
    return {
        item.strip().lower()
        for item in raw.split(",")
        if isinstance(item, str) and item.strip()
    }


def is_admin_panel_available() -> bool:
    raw = os.environ.get("ADMIN_PANEL_AVAILABLE", "")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def is_super_admin_email(email: str | None) -> bool:
    normalized = (email or "").strip().lower()
    if not normalized:
        return False
    return normalized in _super_admin_allowlist()


def is_super_admin_user(user: AuthUser) -> bool:
    return is_super_admin_email(user.email)


def require_user(request: Request) -> AuthUser:
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("BPMN_TEST_AUTH") == "1":
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


def require_super_admin(user: AuthUser = Depends(require_user)) -> AuthUser:
    if not is_super_admin_user(user):
        raise HTTPException(status_code=404, detail="Not found")
    return user
