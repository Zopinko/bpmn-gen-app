from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel

from auth.deps import require_primary_org_id, require_user
from auth.service import (
    AuthUser,
    create_org_with_owner,
    get_user_orgs,
    get_user_primary_org,
    get_user_org_role,
    is_user_member_of_org,
)
from auth.security import to_iso_z, utcnow
from services.model_storage import load_model, save_model
from services.org_models_storage import list_org_models, load_org_model, save_org_model, save_org_model_copy


router = APIRouter(prefix="/api/orgs", tags=["Organizations"])


class CreateOrgRequest(BaseModel):
    name: str


class PushOrgModelRequest(BaseModel):
    model_id: str
    name: str | None = None
    org_id: str | None = None


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


@router.get("/current")
def get_current_org(current_user: AuthUser = Depends(require_user)):
    org = get_user_primary_org(current_user.id)
    if not org:
        raise HTTPException(status_code=404, detail="Pouzivatel nema organizaciu.")
    return {"id": org["id"], "name": org["name"], "role": org["role"]}


def _resolve_org_id(user: AuthUser, org_id: str | None) -> str:
    if org_id:
        if not is_user_member_of_org(user.id, org_id):
            raise HTTPException(status_code=403, detail="Pouzivatel nema pristup k organizacii.")
        return org_id
    return require_primary_org_id(user)


@router.post("/push-model")
def push_model(payload: PushOrgModelRequest, current_user: AuthUser = Depends(require_user)):
    org_id = _resolve_org_id(current_user, payload.org_id)
    try:
        model = load_model(payload.model_id, user_id=current_user.id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Model nenajdeny.")
    name_override = None
    if isinstance(payload.name, str) and payload.name.strip():
        name_override = payload.name.strip()
    org_model_id = save_org_model_copy(org_id=org_id, model=model, name_override=name_override)
    try:
        process_meta = dict(model.get("process_meta") or {})
        pushes = list(process_meta.get("org_pushes") or [])
        pushes = [p for p in pushes if p.get("org_id") != org_id]
        pushes.append(
            {
                "org_id": org_id,
                "org_model_id": org_model_id,
                "pushed_at": to_iso_z(utcnow()),
            }
        )
        process_meta["org_pushes"] = pushes
        save_model(
            name=model.get("name") or (name_override or payload.model_id),
            engine_json=model.get("engine_json") or {},
            diagram_xml=model.get("diagram_xml") or "",
            model_id=payload.model_id,
            generator_input=model.get("generator_input"),
            process_meta=process_meta,
            user_id=current_user.id,
        )
    except Exception:
        pass
    return {"org_model_id": org_model_id, "org_id": org_id}


@router.get("/models")
def list_models(org_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    org_id = _resolve_org_id(current_user, org_id)
    return list_org_models(org_id)


@router.get("/models/{org_model_id}")
def get_org_model(org_model_id: str, org_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    org_id = _resolve_org_id(current_user, org_id)
    try:
        return load_org_model(org_id, org_model_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Model nenajdeny.")


@router.put("/models/{org_model_id}")
def update_org_model(
    org_model_id: str,
    payload: dict = Body(...),
    org_id: str | None = None,
    current_user: AuthUser = Depends(require_user),
):
    org_id = _resolve_org_id(current_user, org_id)
    role = get_user_org_role(current_user.id, org_id)
    if role != "owner":
        raise HTTPException(status_code=403, detail="Pouzivatel nema pravo upravovat organizaciu.")
    name = payload.get("name")
    engine_json = payload.get("engine_json")
    diagram_xml = payload.get("diagram_xml")
    generator_input = payload.get("generator_input")
    process_meta = payload.get("process_meta")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=400, detail="name je povinny a musi byt string.")
    if not isinstance(engine_json, dict):
        raise HTTPException(status_code=400, detail="engine_json je povinny a musi byt objekt.")
    if not isinstance(diagram_xml, str) or not diagram_xml.strip():
        raise HTTPException(status_code=400, detail="diagram_xml je povinny a musi byt string.")
    model = {
        "id": org_model_id,
        "name": name.strip(),
        "engine_json": engine_json,
        "diagram_xml": diagram_xml,
    }
    if isinstance(generator_input, dict):
        model["generator_input"] = generator_input
    if isinstance(process_meta, dict):
        model["process_meta"] = process_meta
    saved = save_org_model(org_id, org_model_id, model)
    return {"ok": True, "modelId": saved.get("id"), "orgId": org_id}
