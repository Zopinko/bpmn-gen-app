from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from auth.deps import is_admin_panel_available, is_super_admin_user
from auth.service import (
    AuthUser,
    authenticate_user,
    create_session_for_user,
    find_user_by_session,
    register_user,
    revoke_session,
    update_last_login,
)
from core.auth_config import get_auth_config


router = APIRouter(prefix="/api/auth", tags=["Auth"])


class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


def _user_payload(user: AuthUser) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "admin_panel_available": is_admin_panel_available(),
        "is_super_admin": is_super_admin_user(user),
        "email_verified": bool(user.email_verified_at),
        "created_at": user.created_at,
    }


def _set_session_cookie(response: Response, session_token: str) -> None:
    cfg = get_auth_config()
    response.set_cookie(
        key=cfg.cookie_name,
        value=session_token,
        httponly=cfg.cookie_httponly,
        secure=cfg.cookie_secure,
        samesite=cfg.cookie_samesite,
        max_age=cfg.session_ttl_seconds,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    cfg = get_auth_config()
    response.delete_cookie(
        key=cfg.cookie_name,
        path="/",
        secure=cfg.cookie_secure,
        httponly=cfg.cookie_httponly,
        samesite=cfg.cookie_samesite,
    )


@router.post("/register", status_code=201)
def register(payload: RegisterRequest):
    try:
        user = register_user(payload.email, payload.password)
    except ValueError as exc:
        message = str(exc)
        if "existuje" in message:
            raise HTTPException(status_code=409, detail=message)
        raise HTTPException(status_code=400, detail=message)
    return {"message": "Registracia bola uspesna.", "user": _user_payload(user)}


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response):
    cfg = get_auth_config()
    user = authenticate_user(payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Nespravny email alebo heslo.")
    if cfg.require_verified_email and not user.email_verified_at:
        raise HTTPException(status_code=403, detail="Najprv over emailovu adresu.")

    session_token = create_session_for_user(
        user_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    update_last_login(user.id)
    _set_session_cookie(response, session_token)
    return {"user": _user_payload(user)}


@router.post("/logout")
def logout(request: Request, response: Response):
    cfg = get_auth_config()
    token = request.cookies.get(cfg.cookie_name)
    if token:
        revoke_session(token)
    _clear_session_cookie(response)
    return {"message": "Odhlasenie bolo uspesne."}


@router.get("/me")
def me(request: Request):
    cfg = get_auth_config()
    token = request.cookies.get(cfg.cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Pouzivatel nie je prihlaseny.")
    user = find_user_by_session(token)
    if not user:
        raise HTTPException(status_code=401, detail="Pouzivatel nie je prihlaseny.")
    return {"user": _user_payload(user)}
