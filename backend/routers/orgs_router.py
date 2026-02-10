from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.deps import require_primary_org_id, require_user
from auth.service import AuthUser, create_org_with_owner, get_user_orgs
from services.model_storage import load_model
from services.org_models_storage import list_org_models, load_org_model, save_org_model_copy


router = APIRouter(prefix="/api/orgs", tags=["Organizations"])


class CreateOrgRequest(BaseModel):
    name: str


class PushOrgModelRequest(BaseModel):
    model_id: str
    name: str | None = None


@router.post("", status_code=201)
def create_org(payload: CreateOrgRequest, current_user: AuthUser = Depends(require_user)):
    try:
        org = create_org_with_owner(payload.name, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return org


@router.get("/my")
def list_my_orgs(current_user: AuthUser = Depends(require_user)):
    orgs = get_user_orgs(current_user.id)
    return [{"id": org["id"], "name": org["name"], "role": org["role"]} for org in orgs]


@router.post("/push-model")
def push_model(payload: PushOrgModelRequest, current_user: AuthUser = Depends(require_user)):
    org_id = require_primary_org_id(current_user)
    try:
        model = load_model(payload.model_id, user_id=current_user.id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Model nenajdeny.")
    name_override = None
    if isinstance(payload.name, str) and payload.name.strip():
        name_override = payload.name.strip()
    org_model_id = save_org_model_copy(org_id=org_id, model=model, name_override=name_override)
    return {"org_model_id": org_model_id, "org_id": org_id}


@router.get("/models")
def list_models(current_user: AuthUser = Depends(require_user)):
    org_id = require_primary_org_id(current_user)
    return list_org_models(org_id)


@router.get("/models/{org_model_id}")
def get_org_model(org_model_id: str, current_user: AuthUser = Depends(require_user)):
    org_id = require_primary_org_id(current_user)
    try:
        return load_org_model(org_id, org_model_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Model nenajdeny.")
