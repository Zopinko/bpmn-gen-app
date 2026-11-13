from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.deps import require_user
from auth.service import AuthUser, get_user_org_role, resolve_accessible_org_id
from services.org_competencies_storage import (
    build_matrix,
    create_competency,
    delete_competencies_by_employee,
    delete_competency,
    list_competencies,
    require_process_step,
    update_competency,
)
from services.org_employees_storage import (
    create_employee,
    delete_employee,
    get_employee,
    list_employees,
    update_employee,
)


router = APIRouter(prefix="/api/workforce", tags=["Workforce"])


CompetencyLevel = Literal["primary", "backup", "training"]


class CreateEmployeeRequest(BaseModel):
    emp_no: str
    name: str
    position: str | None = None


class UpdateEmployeeRequest(BaseModel):
    name: str | None = None
    position: str | None = None


class CreateCompetencyRequest(BaseModel):
    emp_id: str
    process_node_id: str
    step_id: str
    level: CompetencyLevel
    step_name: str = ""


class UpdateCompetencyRequest(BaseModel):
    level: CompetencyLevel


def _resolve_org_id(user: AuthUser, org_id: str | None) -> str:
    try:
        return resolve_accessible_org_id(user.id, org_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except LookupError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _require_workforce_write_access(user: AuthUser, org_id: str) -> None:
    role = (get_user_org_role(user.id, org_id) or "").strip().lower()
    if role not in {"owner", "member", "admin"}:
        raise HTTPException(status_code=403, detail="Pouzivatel nema pravo upravovat workforce.")


def _clean_required(value: str, field_name: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail=f"{field_name} je povinny.")
    return cleaned


@router.get("/employees")
def api_list_employees(org_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    resolved_org_id = _resolve_org_id(current_user, org_id)
    return list_employees(resolved_org_id)


@router.post("/employees", status_code=201)
def api_create_employee(
    payload: CreateEmployeeRequest,
    org_id: str | None = None,
    current_user: AuthUser = Depends(require_user),
):
    resolved_org_id = _resolve_org_id(current_user, org_id)
    _require_workforce_write_access(current_user, resolved_org_id)
    try:
        return create_employee(
            resolved_org_id,
            emp_no=_clean_required(payload.emp_no, "emp_no"),
            name=_clean_required(payload.name, "name"),
            position=payload.position,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/employees/{emp_id}")
def api_update_employee(
    emp_id: str,
    payload: UpdateEmployeeRequest,
    org_id: str | None = None,
    current_user: AuthUser = Depends(require_user),
):
    resolved_org_id = _resolve_org_id(current_user, org_id)
    _require_workforce_write_access(current_user, resolved_org_id)
    try:
        return update_employee(resolved_org_id, emp_id, name=payload.name, position=payload.position)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/employees/{emp_id}")
def api_delete_employee(
    emp_id: str,
    org_id: str | None = None,
    current_user: AuthUser = Depends(require_user),
):
    resolved_org_id = _resolve_org_id(current_user, org_id)
    _require_workforce_write_access(current_user, resolved_org_id)
    try:
        delete_employee(resolved_org_id, emp_id)
        delete_competencies_by_employee(resolved_org_id, emp_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}


@router.get("/competencies")
def api_list_competencies(
    org_id: str | None = None,
    process_node_id: str | None = None,
    emp_id: str | None = None,
    current_user: AuthUser = Depends(require_user),
):
    resolved_org_id = _resolve_org_id(current_user, org_id)
    return list_competencies(resolved_org_id, process_node_id=process_node_id, emp_id=emp_id)


@router.post("/competencies", status_code=201)
def api_create_competency(
    payload: CreateCompetencyRequest,
    org_id: str | None = None,
    current_user: AuthUser = Depends(require_user),
):
    resolved_org_id = _resolve_org_id(current_user, org_id)
    _require_workforce_write_access(current_user, resolved_org_id)
    emp_id = _clean_required(payload.emp_id, "emp_id")
    if not get_employee(resolved_org_id, emp_id):
        raise HTTPException(status_code=404, detail="Zamestnanec neexistuje.")
    process_node_id = _clean_required(payload.process_node_id, "process_node_id")
    step_id = _clean_required(payload.step_id, "step_id")
    try:
        require_process_step(resolved_org_id, process_node_id, step_id)
        return create_competency(
            resolved_org_id,
            emp_id=emp_id,
            process_node_id=process_node_id,
            step_id=step_id,
            level=payload.level,
            step_name=payload.step_name,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/competencies/{competency_id}")
def api_update_competency(
    competency_id: str,
    payload: UpdateCompetencyRequest,
    org_id: str | None = None,
    current_user: AuthUser = Depends(require_user),
):
    resolved_org_id = _resolve_org_id(current_user, org_id)
    _require_workforce_write_access(current_user, resolved_org_id)
    try:
        return update_competency(resolved_org_id, competency_id, payload.level)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/competencies/{competency_id}")
def api_delete_competency(
    competency_id: str,
    org_id: str | None = None,
    current_user: AuthUser = Depends(require_user),
):
    resolved_org_id = _resolve_org_id(current_user, org_id)
    _require_workforce_write_access(current_user, resolved_org_id)
    try:
        delete_competency(resolved_org_id, competency_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}


@router.get("/matrix")
def api_get_matrix(
    org_id: str | None = None,
    process_node_id: str | None = None,
    current_user: AuthUser = Depends(require_user),
):
    resolved_org_id = _resolve_org_id(current_user, org_id)
    return build_matrix(resolved_org_id, process_node_id=process_node_id)
