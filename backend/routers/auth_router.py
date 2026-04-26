from __future__ import annotations

import time
from collections import defaultdict, deque
import logging
from threading import Lock

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from auth.deps import is_admin_panel_available, is_super_admin_user
from auth.service import (
    AuthUser,
    authenticate_user,
    change_password,
    confirm_password_reset,
    create_session_for_user,
    find_user_by_session,
    get_user_primary_org,
    request_password_reset,
    register_user,
    revoke_session,
    update_last_login,
    update_user_language,
)
from core.auth_config import get_auth_config


router = APIRouter(prefix="/api/auth", tags=["Auth"])
logger = logging.getLogger(__name__)

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


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateMeRequest(BaseModel):
    language: str | None = None


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
    org = get_user_primary_org(user.id)
    return {
        "id": user.id,
        "email": user.email,
        "name": None,
        "org_id": org["id"] if org else None,
        "org_name": org["name"] if org else None,
        "role": user.role,
        "language": user.language,
        "admin_panel_available": is_admin_panel_available(),
        "is_super_admin": is_super_admin_user(user),
        "email_verified": bool(user.email_verified_at),
        "created_at": user.created_at,
    }


def _require_authenticated_user(request: Request) -> AuthUser:
    cfg = get_auth_config()
    token = request.cookies.get(cfg.cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Pouzivatel nie je prihlaseny.")
    user = find_user_by_session(token)
    if not user:
        raise HTTPException(status_code=401, detail="Pouzivatel nie je prihlaseny.")
    return user


def _request_host(request: Request) -> str:
    forwarded_host = request.headers.get("x-forwarded-host")
    host_header = (forwarded_host or request.headers.get("host") or "").split(",")[0].strip()
    return host_header.split(":")[0].strip().lower()


def _resolve_cookie_domain(request: Request, configured_domain: str | None) -> str | None:
    if not configured_domain:
        return None
    request_host = _request_host(request)
    normalized_domain = configured_domain.lstrip(".").lower()
    if not request_host:
        return configured_domain
    if request_host == normalized_domain or request_host.endswith(f".{normalized_domain}"):
        return configured_domain
    logger.warning(
        "Ignoring invalid SESSION_COOKIE_DOMAIN '%s' for request host '%s'; using host-only cookie.",
        configured_domain,
        request_host,
    )
    return None


def _set_session_cookie(response: Response, request: Request, session_token: str) -> str | None:
    cfg = get_auth_config()
    cookie_domain = _resolve_cookie_domain(request, cfg.cookie_domain)
    response.set_cookie(
        key=cfg.cookie_name,
        value=session_token,
        domain=cookie_domain,
        httponly=cfg.cookie_httponly,
        secure=cfg.cookie_secure,
        samesite=cfg.cookie_samesite,
        max_age=cfg.session_ttl_seconds,
        path="/",
    )
    return cookie_domain


def _clear_session_cookie(request: Request, response: Response) -> None:
    cfg = get_auth_config()
    cookie_domain = _resolve_cookie_domain(request, cfg.cookie_domain)
    response.delete_cookie(
        key=cfg.cookie_name,
        domain=cookie_domain,
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
    cookie_domain = _set_session_cookie(response, request, session_token)
    logger.warning(
        "Auth login set-cookie prepared: name=%s domain=%s path=/ httponly=%s secure=%s samesite=%s max_age=%s",
        cfg.cookie_name,
        cookie_domain or "<host-only>",
        cfg.cookie_httponly,
        cfg.cookie_secure,
        cfg.cookie_samesite,
        cfg.session_ttl_seconds,
    )
    return {"user": _user_payload(user)}


@router.post("/logout")
def logout(request: Request, response: Response):
    cfg = get_auth_config()
    token = request.cookies.get(cfg.cookie_name)
    if token:
        revoke_session(token)
    _clear_session_cookie(request, response)
    return {"message": "Odhlasenie bolo uspesne."}


@router.get("/me")
def me(request: Request):
    user = _require_authenticated_user(request)
    return {"user": _user_payload(user)}


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest, request: Request):
    _enforce_rate_limit(request, endpoint_key="forgot_password", limit=5)
    request_password_reset(payload.email)
    return {
        "message": "If an account with that email exists, we sent a password reset link.",
    }


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, request: Request):
    _enforce_rate_limit(request, endpoint_key="reset_password", limit=10)
    try:
        confirm_password_reset(payload.token, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"message": "Password was reset successfully."}


@router.patch("/me")
def update_me(payload: UpdateMeRequest, request: Request):
    user = _require_authenticated_user(request)
    if payload.language is not None:
        try:
            update_user_language(user.id, payload.language)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    updated_user = find_user_by_session(request.cookies.get(get_auth_config().cookie_name))
    return {"user": _user_payload(updated_user)}


@router.post("/change-password")
def change_password_logged_in(payload: ChangePasswordRequest, request: Request):
    _enforce_rate_limit(request, endpoint_key="change_password", limit=10)
    user = _require_authenticated_user(request)
    try:
        change_password(user.id, payload.current_password, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"message": "Password changed successfully."}
