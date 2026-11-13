from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field

from auth import admin_mfa
from auth.deps import admin_session_hash, require_admin_identity
from auth.service import AuthUser, authenticate_user

class AdminMfaRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await handler(request)
            except RequestValidationError:
                raise HTTPException(422, "Invalid admin verification request.") from None

        return handle


router = APIRouter(prefix="/api/admin/mfa", include_in_schema=False, route_class=AdminMfaRoute)


class SetupRequest(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


class CodeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)


def _verified_attempt(request: Request, response: Response, user: AuthUser) -> str:
    if not user.email_verified_at:
        raise HTTPException(403, "Verify your email before setting up admin MFA.")
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise HTTPException(415, "Send an application/json request.")
    admin_mfa.record_attempt(user.id)
    response.headers["Cache-Control"] = "no-store"
    return admin_session_hash(request)


@router.get("/status")
def status(request: Request, response: Response, user: AuthUser = Depends(require_admin_identity)):
    admin_mfa.encryption_key()
    response.headers["Cache-Control"] = "no-store"
    enrolled, expires_at = admin_mfa.status(user.id, admin_session_hash(request))
    verified = bool(user.email_verified_at)
    return {
        "enrolled": enrolled,
        "unlocked": verified and expires_at is not None,
        "email_verified": verified,
        "expires_at": expires_at if verified else None,
    }


@router.post("/setup")
def setup(payload: SetupRequest, request: Request, response: Response, user: AuthUser = Depends(require_admin_identity)):
    session_hash = _verified_attempt(request, response, user)
    authenticated = authenticate_user(user.email, payload.password)
    if authenticated is None or authenticated.id != user.id:
        raise HTTPException(403, "Invalid password.")
    return admin_mfa.start_setup(user.id, user.email, session_hash)


@router.post("/confirm")
def confirm(payload: CodeRequest, request: Request, response: Response, user: AuthUser = Depends(require_admin_identity)):
    session_hash = _verified_attempt(request, response, user)
    return {"recovery_codes": admin_mfa.confirm_setup(user.id, session_hash, payload.code.strip())}


@router.post("/unlock")
def unlock(payload: CodeRequest, request: Request, response: Response, user: AuthUser = Depends(require_admin_identity)):
    session_hash = _verified_attempt(request, response, user)
    return {"expires_at": admin_mfa.unlock(user.id, session_hash, payload.code.strip())}
