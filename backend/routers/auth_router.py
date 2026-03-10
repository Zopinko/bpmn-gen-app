from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

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

_RATE_LIMIT_WINDOW_SECONDS = 60
_RATE_LIMIT_MESSAGE = "Too many attempts. Please try again later."
_rate_limit_lock = Lock()
_rate_limit_buckets: dict[tuple[str, str], deque[float]] = defaultdict(deque)


class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


def _get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        first_ip = forwarded_for.split(",")[0].strip()
        if first_ip:
            return first_ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _enforce_rate_limit(request: Request, endpoint_key: str, limit: int) -> None:
    now = time.monotonic()
    cutoff = now - _RATE_LIMIT_WINDOW_SECONDS
    client_ip = _get_client_ip(request)
    bucket_key = (endpoint_key, client_ip)
    with _rate_limit_lock:
        bucket = _rate_limit_buckets[bucket_key]
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(status_code=429, detail=_RATE_LIMIT_MESSAGE)
        bucket.append(now)


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
        domain=cfg.cookie_domain,
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
        domain=cfg.cookie_domain,
        path="/",
        secure=cfg.cookie_secure,
        httponly=cfg.cookie_httponly,
        samesite=cfg.cookie_samesite,
    )


@router.post("/register", status_code=201)
def register(payload: RegisterRequest, request: Request):
    _enforce_rate_limit(request, endpoint_key="register", limit=5)
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
    _enforce_rate_limit(request, endpoint_key="login", limit=10)
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
