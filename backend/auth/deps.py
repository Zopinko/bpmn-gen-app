from __future__ import annotations

from fastapi import HTTPException, Request

from auth.service import AuthUser, find_user_by_session, get_user_primary_org
from core.auth_config import get_auth_config


def require_user(request: Request) -> AuthUser:
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
