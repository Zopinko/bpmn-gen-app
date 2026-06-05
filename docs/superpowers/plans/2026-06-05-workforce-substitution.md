# Workforce & Substitutability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workforce layer to process maps — a central employee register per org, per-step competency assignments (primary/backup/training), an overlay on the process map viewer, and an auto-generated substitutability matrix.

**Architecture:** Two new JSON files per org (`employees.json`, `competencies.json`) under `data/models/orgs/{org_id}/`, following the existing file-based storage pattern. A new router `org_workforce_router` exposes 11 endpoints under `/api/workforce`. Frontend adds an overlay toggle to `MapViewer.jsx` and a new `WorkforcePage.jsx` with two tabs (employee register + org matrix).

**Tech Stack:** Python/FastAPI (backend), React/JSX (frontend), existing `atomic_write_json` + `TestClient` patterns.

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| Create | `backend/services/org_employees_storage.py` | CRUD for employees.json |
| Create | `backend/services/org_competencies_storage.py` | CRUD for competencies.json + matrix builder |
| Create | `backend/routers/org_workforce_router.py` | API router, prefix `/api/workforce` |
| Modify | `backend/main.py` | Register workforce router |
| Create | `backend/tests/test_workforce.py` | Integration tests |
| Create | `frontend/src/api/workforce.js` | API client functions |
| Create | `frontend/src/pages/WorkforcePage.jsx` | Employee register + matrix page |
| Create | `frontend/src/components/WorkforceOverlay.jsx` | Overlay side panel for map viewer |
| Modify | `frontend/src/components/MapViewer.jsx` | Add overlay toggle + render overlay |
| Modify | `frontend/src/App.jsx` | Add route to WorkforcePage |

---

## Task 1: Employee storage service

**Files:**
- Create: `backend/services/org_employees_storage.py`
- Test: `backend/tests/test_workforce.py`

- [ ] **Step 1: Create the test file with a failing test for `create_employee`**

```python
# backend/tests/test_workforce.py
import os
import pytest
from services.org_employees_storage import (
    create_employee,
    list_employees,
    update_employee,
    delete_employee,
    get_employee,
)


def _set_env(tmp_path):
    prev = os.environ.get("BPMN_MODELS_DIR")
    os.environ["BPMN_MODELS_DIR"] = str(tmp_path / "models")
    return prev


def _restore_env(prev):
    if prev is None:
        os.environ.pop("BPMN_MODELS_DIR", None)
    else:
        os.environ["BPMN_MODELS_DIR"] = prev


def test_create_and_list_employee(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", emp_no="E001", name="Jana Kováčová", position="Referentka")
        assert emp["emp_no"] == "E001"
        assert emp["name"] == "Jana Kováčová"
        assert emp["position"] == "Referentka"
        assert "id" in emp
        assert "created_at" in emp

        items = list_employees("org1")
        assert len(items) == 1
        assert items[0]["emp_no"] == "E001"
    finally:
        _restore_env(prev)
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd backend && python -m pytest tests/test_workforce.py::test_create_and_list_employee -v
```
Expected: `ModuleNotFoundError` or `ImportError` — module does not exist yet.

- [ ] **Step 3: Create `org_employees_storage.py`**

```python
# backend/services/org_employees_storage.py
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from services.storage_io import atomic_write_json


def _org_dir(org_id: str) -> Path:
    base = Path(os.getenv("BPMN_MODELS_DIR", "data/models"))
    path = base / "orgs" / str(org_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _employees_path(org_id: str) -> Path:
    return _org_dir(org_id) / "employees.json"


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _load(org_id: str) -> list[dict]:
    path = _employees_path(org_id)
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _save(org_id: str, employees: list[dict]) -> None:
    atomic_write_json(_employees_path(org_id), employees, ensure_ascii=False)


def list_employees(org_id: str) -> list[dict]:
    return _load(org_id)


def get_employee(org_id: str, emp_id: str) -> dict | None:
    return next((e for e in _load(org_id) if e["id"] == emp_id), None)


def create_employee(org_id: str, emp_no: str, name: str, position: str | None = None) -> dict:
    employees = _load(org_id)
    if any(e["emp_no"] == emp_no for e in employees):
        raise ValueError(f"Zamestnanec s číslom {emp_no} už existuje.")
    employee = {
        "id": str(uuid4()),
        "emp_no": emp_no.strip(),
        "name": name.strip(),
        "position": (position or "").strip(),
        "created_at": _now_iso(),
    }
    employees.append(employee)
    _save(org_id, employees)
    return employee


def update_employee(org_id: str, emp_id: str, name: str | None = None, position: str | None = None) -> dict:
    employees = _load(org_id)
    for i, e in enumerate(employees):
        if e["id"] == emp_id:
            updated = dict(e)
            if name is not None:
                updated["name"] = name.strip()
            if position is not None:
                updated["position"] = position.strip()
            employees[i] = updated
            _save(org_id, employees)
            return updated
    raise LookupError(f"Zamestnanec {emp_id} nenájdený.")


def delete_employee(org_id: str, emp_id: str) -> None:
    employees = _load(org_id)
    new_list = [e for e in employees if e["id"] != emp_id]
    if len(new_list) == len(employees):
        raise LookupError(f"Zamestnanec {emp_id} nenájdený.")
    _save(org_id, new_list)
```

- [ ] **Step 4: Run test — should pass**

```bash
cd backend && python -m pytest tests/test_workforce.py::test_create_and_list_employee -v
```
Expected: `PASSED`

- [ ] **Step 5: Add tests for duplicate emp_no, update, delete**

Append to `backend/tests/test_workforce.py`:

```python
def test_duplicate_emp_no_raises(tmp_path):
    prev = _set_env(tmp_path)
    try:
        create_employee("org1", "E001", "Jana K.")
        with pytest.raises(ValueError, match="E001"):
            create_employee("org1", "E001", "Iná Jana")
    finally:
        _restore_env(prev)


def test_update_employee(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.", "Referentka")
        updated = update_employee("org1", emp["id"], name="Jana Nová")
        assert updated["name"] == "Jana Nová"
        assert updated["position"] == "Referentka"  # unchanged
        assert get_employee("org1", emp["id"])["name"] == "Jana Nová"
    finally:
        _restore_env(prev)


def test_delete_employee(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        delete_employee("org1", emp["id"])
        assert list_employees("org1") == []
    finally:
        _restore_env(prev)


def test_employees_are_org_scoped(tmp_path):
    prev = _set_env(tmp_path)
    try:
        create_employee("org1", "E001", "Jana K.")
        create_employee("org2", "E001", "Peter M.")  # same emp_no, different org — OK
        assert len(list_employees("org1")) == 1
        assert len(list_employees("org2")) == 1
    finally:
        _restore_env(prev)
```

- [ ] **Step 6: Run all new tests**

```bash
cd backend && python -m pytest tests/test_workforce.py -v -k "employee"
```
Expected: 4 tests `PASSED`

- [ ] **Step 7: Commit**

```bash
git add backend/services/org_employees_storage.py backend/tests/test_workforce.py
git commit -m "feat: org employee storage service"
```

---

## Task 2: Competency storage service + matrix builder

**Files:**
- Create: `backend/services/org_competencies_storage.py`
- Modify: `backend/tests/test_workforce.py` (append tests)

- [ ] **Step 1: Write failing tests for competency CRUD and matrix**

Append to `backend/tests/test_workforce.py`:

```python
from services.org_competencies_storage import (
    create_competency,
    list_competencies,
    update_competency,
    delete_competency,
    delete_competencies_by_employee,
    build_matrix,
)


def test_create_and_list_competency(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        comp = create_competency("org1", emp["id"], "node_1", "task_1", "primary")
        assert comp["emp_id"] == emp["id"]
        assert comp["step_id"] == "task_1"
        assert comp["level"] == "primary"

        items = list_competencies("org1")
        assert len(items) == 1

        by_process = list_competencies("org1", process_node_id="node_1")
        assert len(by_process) == 1

        by_emp = list_competencies("org1", emp_id=emp["id"])
        assert len(by_emp) == 1
    finally:
        _restore_env(prev)


def test_upsert_competency_changes_level(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        create_competency("org1", emp["id"], "node_1", "task_1", "training")
        upserted = create_competency("org1", emp["id"], "node_1", "task_1", "primary")
        assert upserted["level"] == "primary"
        assert len(list_competencies("org1")) == 1  # no duplicate
    finally:
        _restore_env(prev)


def test_delete_employee_cascades_competencies(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        create_competency("org1", emp["id"], "node_1", "task_1", "primary")
        delete_competencies_by_employee("org1", emp["id"])
        assert list_competencies("org1") == []
    finally:
        _restore_env(prev)


def test_build_matrix_risk_levels(tmp_path):
    prev = _set_env(tmp_path)
    try:
        e1 = create_employee("org1", "E001", "Jana K.")
        e2 = create_employee("org1", "E002", "Peter M.")

        # task_1: primary + backup → risk=none
        create_competency("org1", e1["id"], "node_1", "task_1", "primary")
        create_competency("org1", e2["id"], "node_1", "task_1", "backup")

        # task_2: only primary, no backup → risk=critical
        create_competency("org1", e1["id"], "node_1", "task_2", "primary")

        # task_3: two backups, no primary → risk=low
        create_competency("org1", e1["id"], "node_1", "task_3", "backup")
        create_competency("org1", e2["id"], "node_1", "task_3", "backup")

        matrix = build_matrix("org1")
        risk_map = {r["step_id"]: r["risk"] for r in matrix["risk"]}
        assert risk_map["task_1"] == "none"
        assert risk_map["task_2"] == "critical"
        assert risk_map["task_3"] == "low"

        # task_4 not in competencies → not in matrix (unassigned steps only appear in overlay, not matrix)
        assert "task_4" not in risk_map
    finally:
        _restore_env(prev)


def test_build_matrix_process_filter(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        create_competency("org1", emp["id"], "node_1", "task_1", "primary")
        create_competency("org1", emp["id"], "node_2", "task_x", "backup")

        matrix = build_matrix("org1", process_node_id="node_1")
        step_ids = [s["step_id"] for s in matrix["steps"]]
        assert "task_1" in step_ids
        assert "task_x" not in step_ids
    finally:
        _restore_env(prev)
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd backend && python -m pytest tests/test_workforce.py -v -k "competency or matrix"
```
Expected: `ImportError` — module does not exist yet.

- [ ] **Step 3: Create `org_competencies_storage.py`**

```python
# backend/services/org_competencies_storage.py
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal
from uuid import uuid4

from services.storage_io import atomic_write_json

CompetencyLevel = Literal["primary", "backup", "training"]
VALID_LEVELS = {"primary", "backup", "training"}


def _org_dir(org_id: str) -> Path:
    base = Path(os.getenv("BPMN_MODELS_DIR", "data/models"))
    path = base / "orgs" / str(org_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _competencies_path(org_id: str) -> Path:
    return _org_dir(org_id) / "competencies.json"


def _load(org_id: str) -> list[dict]:
    path = _competencies_path(org_id)
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _save(org_id: str, competencies: list[dict]) -> None:
    atomic_write_json(_competencies_path(org_id), competencies, ensure_ascii=False)


def list_competencies(
    org_id: str,
    process_node_id: str | None = None,
    emp_id: str | None = None,
) -> list[dict]:
    items = _load(org_id)
    if process_node_id:
        items = [c for c in items if c["process_node_id"] == process_node_id]
    if emp_id:
        items = [c for c in items if c["emp_id"] == emp_id]
    return items


def create_competency(
    org_id: str,
    emp_id: str,
    process_node_id: str,
    step_id: str,
    level: CompetencyLevel,
) -> dict:
    if level not in VALID_LEVELS:
        raise ValueError(f"Neplatná úroveň: {level}. Povolené: {VALID_LEVELS}")
    competencies = _load(org_id)
    for i, c in enumerate(competencies):
        if c["emp_id"] == emp_id and c["process_node_id"] == process_node_id and c["step_id"] == step_id:
            updated = dict(c)
            updated["level"] = level
            competencies[i] = updated
            _save(org_id, competencies)
            return updated
    competency = {
        "id": str(uuid4()),
        "emp_id": emp_id,
        "process_node_id": process_node_id,
        "step_id": step_id,
        "level": level,
    }
    competencies.append(competency)
    _save(org_id, competencies)
    return competency


def update_competency(org_id: str, competency_id: str, level: CompetencyLevel) -> dict:
    if level not in VALID_LEVELS:
        raise ValueError(f"Neplatná úroveň: {level}.")
    competencies = _load(org_id)
    for i, c in enumerate(competencies):
        if c["id"] == competency_id:
            updated = dict(c)
            updated["level"] = level
            competencies[i] = updated
            _save(org_id, competencies)
            return updated
    raise LookupError(f"Kompetencia {competency_id} nenájdená.")


def delete_competency(org_id: str, competency_id: str) -> None:
    competencies = _load(org_id)
    new_list = [c for c in competencies if c["id"] != competency_id]
    if len(new_list) == len(competencies):
        raise LookupError(f"Kompetencia {competency_id} nenájdená.")
    _save(org_id, new_list)


def delete_competencies_by_employee(org_id: str, emp_id: str) -> None:
    competencies = _load(org_id)
    _save(org_id, [c for c in competencies if c["emp_id"] != emp_id])


def _compute_risk(step_competencies: list[dict]) -> str:
    if not step_competencies:
        return "unassigned"
    if len(step_competencies) == 1:
        return "critical"
    levels = {c["level"] for c in step_competencies}
    if "primary" in levels and "backup" in levels:
        return "none"
    return "low"


def build_matrix(org_id: str, process_node_id: str | None = None) -> dict:
    from services.org_employees_storage import list_employees

    employees = list_employees(org_id)
    competencies = list_competencies(org_id, process_node_id=process_node_id)

    seen: dict[str, dict] = {}
    for c in competencies:
        key = f"{c['process_node_id']}::{c['step_id']}"
        if key not in seen:
            seen[key] = {"step_id": c["step_id"], "process_node_id": c["process_node_id"]}
    steps = list(seen.values())

    cells = [{"emp_id": c["emp_id"], "step_id": c["step_id"], "level": c["level"]} for c in competencies]

    risk = []
    for step in steps:
        step_comps = [
            c for c in competencies
            if c["step_id"] == step["step_id"] and c["process_node_id"] == step["process_node_id"]
        ]
        risk.append({
            "step_id": step["step_id"],
            "process_node_id": step["process_node_id"],
            "risk": _compute_risk(step_comps),
        })

    return {"employees": employees, "steps": steps, "cells": cells, "risk": risk}
```

- [ ] **Step 4: Run competency and matrix tests**

```bash
cd backend && python -m pytest tests/test_workforce.py -v -k "competency or matrix"
```
Expected: 5 tests `PASSED`

- [ ] **Step 5: Run full test_workforce.py**

```bash
cd backend && python -m pytest tests/test_workforce.py -v
```
Expected: all 9 tests `PASSED`

- [ ] **Step 6: Commit**

```bash
git add backend/services/org_competencies_storage.py backend/tests/test_workforce.py
git commit -m "feat: org competencies storage + matrix builder"
```

---

## Task 3: Workforce API router

**Files:**
- Create: `backend/routers/org_workforce_router.py`
- Modify: `backend/tests/test_workforce.py` (append API tests)

- [ ] **Step 1: Write failing API tests**

Append to `backend/tests/test_workforce.py`:

```python
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from auth.db import run_auth_migrations
from auth.deps import require_user
from auth.service import create_session_for_user, find_user_by_session, find_user_id_by_email, register_user
from core.auth_config import get_auth_config
from routers.auth_router import router as auth_router
from routers.orgs_router import router as orgs_router
from routers.org_workforce_router import router as workforce_router


def _make_api_client() -> TestClient:
    def _require_user_from_cookie(request: Request):
        token = request.cookies.get(get_auth_config().cookie_name)
        if not token:
            raise HTTPException(status_code=401)
        user = find_user_by_session(token)
        if not user:
            raise HTTPException(status_code=401)
        return user

    app = FastAPI()
    app.dependency_overrides[require_user] = _require_user_from_cookie
    app.include_router(auth_router)
    app.include_router(orgs_router)
    app.include_router(workforce_router)
    return TestClient(app)


def _authed_api_client(email: str) -> TestClient:
    user_id = find_user_id_by_email(email)
    assert user_id
    token = create_session_for_user(user_id=user_id, ip_address="127.0.0.1", user_agent="pytest")
    client = _make_api_client()
    client.cookies.set(get_auth_config().cookie_name, token)
    return client


def test_workforce_api_full_flow(tmp_path):
    prev_db = os.environ.get("AUTH_DB_PATH")
    prev_models = os.environ.get("BPMN_MODELS_DIR")
    os.environ["AUTH_DB_PATH"] = str(tmp_path / "auth.db")
    os.environ["BPMN_MODELS_DIR"] = str(tmp_path / "models")
    try:
        run_auth_migrations()
        register_user("owner@test.com", "pass123")
        org_setup_client = _make_api_client()
        user_id = find_user_id_by_email("owner@test.com")
        token = create_session_for_user(user_id=user_id, ip_address="127.0.0.1", user_agent="pytest")
        org_setup_client.cookies.set(get_auth_config().cookie_name, token)
        org_resp = org_setup_client.post("/api/orgs", json={"name": "Test Org"})
        assert org_resp.status_code == 201
        org_id = org_resp.json()["id"]

        client = _authed_api_client("owner@test.com")

        # Create employee
        r = client.post(f"/api/workforce/employees?org_id={org_id}", json={"emp_no": "E001", "name": "Jana K.", "position": "Referentka"})
        assert r.status_code == 201
        emp_id = r.json()["id"]

        # List employees
        r = client.get(f"/api/workforce/employees?org_id={org_id}")
        assert r.status_code == 200
        assert len(r.json()) == 1

        # Duplicate emp_no fails
        r = client.post(f"/api/workforce/employees?org_id={org_id}", json={"emp_no": "E001", "name": "Iná Jana"})
        assert r.status_code == 400

        # Create competency
        r = client.post(f"/api/workforce/competencies?org_id={org_id}", json={"emp_id": emp_id, "process_node_id": "node_1", "step_id": "task_1", "level": "primary"})
        assert r.status_code == 201
        comp_id = r.json()["id"]

        # Get matrix
        r = client.get(f"/api/workforce/matrix?org_id={org_id}")
        assert r.status_code == 200
        matrix = r.json()
        assert len(matrix["employees"]) == 1
        assert len(matrix["steps"]) == 1
        assert matrix["risk"][0]["risk"] == "critical"  # only one person

        # Update competency level
        r = client.patch(f"/api/workforce/competencies/{comp_id}?org_id={org_id}", json={"level": "backup"})
        assert r.status_code == 200
        assert r.json()["level"] == "backup"

        # Delete employee cascades competencies
        r = client.delete(f"/api/workforce/employees/{emp_id}?org_id={org_id}")
        assert r.status_code == 200
        r = client.get(f"/api/workforce/competencies?org_id={org_id}")
        assert r.status_code == 200
        assert r.json() == []
    finally:
        for k, v in [("AUTH_DB_PATH", prev_db), ("BPMN_MODELS_DIR", prev_models)]:
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
```

- [ ] **Step 2: Run to confirm test fails**

```bash
cd backend && python -m pytest tests/test_workforce.py::test_workforce_api_full_flow -v
```
Expected: `ImportError` — router does not exist yet.

- [ ] **Step 3: Create `org_workforce_router.py`**

```python
# backend/routers/org_workforce_router.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.deps import require_user
from auth.service import AuthUser, resolve_accessible_org_id
from services.org_employees_storage import (
    create_employee,
    delete_employee,
    get_employee,
    list_employees,
    update_employee,
)
from services.org_competencies_storage import (
    build_matrix,
    create_competency,
    delete_competency,
    delete_competencies_by_employee,
    list_competencies,
    update_competency,
)

router = APIRouter(prefix="/api/workforce", tags=["Workforce"])


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
    level: str


class UpdateCompetencyRequest(BaseModel):
    level: str


def _resolve(user: AuthUser, org_id: str | None) -> str:
    try:
        return resolve_accessible_org_id(user.id, org_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except LookupError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --- Employees ---

@router.get("/employees")
def api_list_employees(org_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    oid = _resolve(current_user, org_id)
    return list_employees(oid)


@router.post("/employees", status_code=201)
def api_create_employee(payload: CreateEmployeeRequest, org_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    oid = _resolve(current_user, org_id)
    if not payload.emp_no.strip():
        raise HTTPException(status_code=400, detail="emp_no je povinné.")
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="name je povinné.")
    try:
        return create_employee(oid, emp_no=payload.emp_no.strip(), name=payload.name.strip(), position=payload.position)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/employees/{emp_id}")
def api_update_employee(emp_id: str, payload: UpdateEmployeeRequest, org_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    oid = _resolve(current_user, org_id)
    try:
        return update_employee(oid, emp_id, name=payload.name, position=payload.position)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/employees/{emp_id}")
def api_delete_employee(emp_id: str, org_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    oid = _resolve(current_user, org_id)
    try:
        delete_competencies_by_employee(oid, emp_id)
        delete_employee(oid, emp_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}


# --- Competencies ---

@router.get("/competencies")
def api_list_competencies(org_id: str | None = None, process_node_id: str | None = None, emp_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    oid = _resolve(current_user, org_id)
    return list_competencies(oid, process_node_id=process_node_id, emp_id=emp_id)


@router.post("/competencies", status_code=201)
def api_create_competency(payload: CreateCompetencyRequest, org_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    oid = _resolve(current_user, org_id)
    if not get_employee(oid, payload.emp_id):
        raise HTTPException(status_code=404, detail="Zamestnanec neexistuje.")
    try:
        return create_competency(oid, payload.emp_id, payload.process_node_id, payload.step_id, payload.level)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/competencies/{comp_id}")
def api_update_competency(comp_id: str, payload: UpdateCompetencyRequest, org_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    oid = _resolve(current_user, org_id)
    try:
        return update_competency(oid, comp_id, payload.level)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/competencies/{comp_id}")
def api_delete_competency(comp_id: str, org_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    oid = _resolve(current_user, org_id)
    try:
        delete_competency(oid, comp_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"ok": True}


# --- Matrix ---

@router.get("/matrix")
def api_get_matrix(org_id: str | None = None, process_node_id: str | None = None, current_user: AuthUser = Depends(require_user)):
    oid = _resolve(current_user, org_id)
    return build_matrix(oid, process_node_id=process_node_id)
```

- [ ] **Step 4: Run API test**

```bash
cd backend && python -m pytest tests/test_workforce.py::test_workforce_api_full_flow -v
```
Expected: `PASSED`

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd backend && python -m pytest tests/ -v --tb=short
```
Expected: all existing tests still pass, new tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/org_workforce_router.py backend/tests/test_workforce.py
git commit -m "feat: workforce API router (employees + competencies + matrix)"
```

---

## Task 4: Register router in main.py

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add import**

In `backend/main.py`, add after the last router import (line 19):

```python
from routers.org_workforce_router import router as org_workforce_router
```

- [ ] **Step 2: Register router**

In `backend/main.py`, inside `create_app()`, after `app.include_router(controller_router)` (line 84):

```python
    app.include_router(org_workforce_router)
```

- [ ] **Step 3: Verify app still starts**

```bash
cd backend && python -c "from main import create_app; create_app(); print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: register org_workforce_router in app"
```

---

## Task 5: Frontend API client

**Files:**
- Create: `frontend/src/api/workforce.js`

- [ ] **Step 1: Create API client**

```javascript
// frontend/src/api/workforce.js
const BASE = "/api/workforce";

async function _req(method, path, body, params) {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  }
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const listEmployees = (orgId) => _req("GET", "/employees", null, { org_id: orgId });
export const createEmployee = (orgId, data) => _req("POST", "/employees", data, { org_id: orgId });
export const updateEmployee = (orgId, empId, data) => _req("PATCH", `/employees/${empId}`, data, { org_id: orgId });
export const deleteEmployee = (orgId, empId) => _req("DELETE", `/employees/${empId}`, null, { org_id: orgId });

export const listCompetencies = (orgId, params) => _req("GET", "/competencies", null, { org_id: orgId, ...params });
export const createCompetency = (orgId, data) => _req("POST", "/competencies", data, { org_id: orgId });
export const updateCompetency = (orgId, compId, data) => _req("PATCH", `/competencies/${compId}`, data, { org_id: orgId });
export const deleteCompetency = (orgId, compId) => _req("DELETE", `/competencies/${compId}`, null, { org_id: orgId });

export const getMatrix = (orgId, processNodeId) =>
  _req("GET", "/matrix", null, { org_id: orgId, process_node_id: processNodeId });
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/workforce.js
git commit -m "feat: workforce API client"
```

---

## Task 6: WorkforcePage — employee register tab

**Files:**
- Create: `frontend/src/pages/WorkforcePage.jsx`

- [ ] **Step 1: Create WorkforcePage with employee tab**

```jsx
// frontend/src/pages/WorkforcePage.jsx
import { useState, useEffect, useCallback } from "react";
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getMatrix,
} from "../api/workforce";

const RISK_LABEL = { none: "🟢", low: "🟡", critical: "🔴", unassigned: "⚫" };

export default function WorkforcePage({ orgId }) {
  const [tab, setTab] = useState("employees");
  const [employees, setEmployees] = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [form, setForm] = useState({ emp_no: "", name: "", position: "" });
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState("");

  const loadEmployees = useCallback(async () => {
    try {
      setEmployees(await listEmployees(orgId));
    } catch (e) {
      setError(e.message);
    }
  }, [orgId]);

  const loadMatrix = useCallback(async () => {
    try {
      setMatrix(await getMatrix(orgId));
    } catch (e) {
      setError(e.message);
    }
  }, [orgId]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    if (tab === "matrix") loadMatrix();
  }, [tab, loadMatrix]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      if (editId) {
        await updateEmployee(orgId, editId, { name: form.name, position: form.position });
        setEditId(null);
      } else {
        await createEmployee(orgId, form);
      }
      setForm({ emp_no: "", name: "", position: "" });
      await loadEmployees();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(empId) {
    if (!window.confirm("Odstrániť zamestnanca? Vymažú sa aj všetky jeho kompetencie.")) return;
    try {
      await deleteEmployee(orgId, empId);
      await loadEmployees();
    } catch (e) {
      setError(e.message);
    }
  }

  function startEdit(emp) {
    setEditId(emp.id);
    setForm({ emp_no: emp.emp_no, name: emp.name, position: emp.position });
  }

  return (
    <div className="workforce-page">
      <h2>Workforce</h2>
      <div className="workforce-tabs">
        <button className={tab === "employees" ? "active" : ""} onClick={() => setTab("employees")}>
          👥 Zamestnanci
        </button>
        <button className={tab === "matrix" ? "active" : ""} onClick={() => setTab("matrix")}>
          📊 Matica zastupiteľnosti
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {tab === "employees" && (
        <div className="workforce-employees">
          <form onSubmit={handleSubmit} className="employee-form">
            <input
              placeholder="Č. zamestnanca (E001)"
              value={form.emp_no}
              onChange={(e) => setForm({ ...form, emp_no: e.target.value })}
              required
              disabled={!!editId}
            />
            <input
              placeholder="Meno a priezvisko"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              placeholder="Pozícia (voliteľné)"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
            <button type="submit">{editId ? "Uložiť zmeny" : "+ Pridať"}</button>
            {editId && (
              <button type="button" onClick={() => { setEditId(null); setForm({ emp_no: "", name: "", position: "" }); }}>
                Zrušiť
              </button>
            )}
          </form>

          <table className="employee-table">
            <thead>
              <tr>
                <th>Č. zamestnanca</th>
                <th>Meno</th>
                <th>Pozícia</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td><code>{emp.emp_no}</code></td>
                  <td>{emp.name}</td>
                  <td>{emp.position}</td>
                  <td>
                    <button onClick={() => startEdit(emp)}>✏️</button>
                    <button onClick={() => handleDelete(emp.id)}>🗑️</button>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "#666" }}>Zatiaľ žiadni zamestnanci</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "matrix" && matrix && (
        <div className="workforce-matrix">
          <p className="matrix-hint">Stĺpce = kroky procesov · Riadky = zamestnanci · Auto-generované</p>
          {matrix.steps.length === 0 ? (
            <p>Zatiaľ žiadne kompetencie. Pridaj ich cez overlay na procesnej mape.</p>
          ) : (
            <table className="matrix-table">
              <thead>
                <tr>
                  <th>Zamestnanec</th>
                  {matrix.steps.map((s) => {
                    const riskEntry = matrix.risk.find((r) => r.step_id === s.step_id && r.process_node_id === s.process_node_id);
                    const risk = riskEntry?.risk || "none";
                    return (
                      <th key={`${s.process_node_id}::${s.step_id}`} className={`risk-${risk}`} title={`Krok: ${s.step_id}`}>
                        {RISK_LABEL[risk]} {s.step_id}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {matrix.employees.map((emp) => (
                  <tr key={emp.id}>
                    <td><strong>{emp.emp_no}</strong> {emp.name}</td>
                    {matrix.steps.map((s) => {
                      const cell = matrix.cells.find((c) => c.emp_id === emp.id && c.step_id === s.step_id);
                      return (
                        <td key={`${s.process_node_id}::${s.step_id}`} style={{ textAlign: "center" }}>
                          {cell ? RISK_LABEL[cell.level] ?? cell.level : "⚪"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/WorkforcePage.jsx
git commit -m "feat: WorkforcePage with employee register and substitutability matrix"
```

---

## Task 7: Workforce overlay component

**Files:**
- Create: `frontend/src/components/WorkforceOverlay.jsx`

- [ ] **Step 1: Create the overlay side panel**

```jsx
// frontend/src/components/WorkforceOverlay.jsx
import { useState, useEffect } from "react";
import {
  listEmployees,
  listCompetencies,
  createCompetency,
  updateCompetency,
  deleteCompetency,
  createEmployee,
} from "../api/workforce";

const LEVEL_LABELS = { primary: "🟢 Primárny", backup: "🔵 Záloha", training: "🟡 Zácvik" };
const LEVELS = ["primary", "backup", "training"];

export function computeTaskRisk(competencies) {
  if (!competencies.length) return "unassigned";
  if (competencies.length === 1) return "critical";
  const levels = new Set(competencies.map((c) => c.level));
  if (levels.has("primary") && levels.has("backup")) return "none";
  return "low";
}

export const RISK_BORDER = {
  none: "#16a34a",
  low: "#d97706",
  critical: "#ef4444",
  unassigned: "#475569",
};

export default function WorkforceOverlay({ orgId, processNodeId, selectedStepId, stepName, onClose }) {
  const [employees, setEmployees] = useState([]);
  const [competencies, setCompetencies] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newEmpId, setNewEmpId] = useState("");
  const [newLevel, setNewLevel] = useState("backup");
  const [newName, setNewName] = useState("");
  const [newEmpNo, setNewEmpNo] = useState("");
  const [createNew, setCreateNew] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orgId || !selectedStepId) return;
    Promise.all([
      listEmployees(orgId),
      listCompetencies(orgId, { process_node_id: processNodeId }),
    ]).then(([emps, comps]) => {
      setEmployees(emps);
      setCompetencies(comps.filter((c) => c.step_id === selectedStepId));
    }).catch((e) => setError(e.message));
  }, [orgId, processNodeId, selectedStepId]);

  const risk = computeTaskRisk(competencies);
  const assignedEmpIds = new Set(competencies.map((c) => c.emp_id));
  const availableEmployees = employees.filter((e) => !assignedEmpIds.has(e.id));

  async function handleAdd() {
    setError("");
    try {
      let empId = newEmpId;
      if (createNew) {
        const emp = await createEmployee(orgId, { emp_no: newEmpNo, name: newName });
        empId = emp.id;
      }
      if (!empId) { setError("Vyber alebo zadaj zamestnanca."); return; }
      await createCompetency(orgId, { emp_id: empId, process_node_id: processNodeId, step_id: selectedStepId, level: newLevel });
      const comps = await listCompetencies(orgId, { process_node_id: processNodeId });
      setCompetencies(comps.filter((c) => c.step_id === selectedStepId));
      const emps = await listEmployees(orgId);
      setEmployees(emps);
      setAdding(false);
      setCreateNew(false);
      setNewEmpId(""); setNewName(""); setNewEmpNo("");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleLevelChange(compId, level) {
    try {
      await updateCompetency(orgId, compId, { level });
      setCompetencies((prev) => prev.map((c) => c.id === compId ? { ...c, level } : c));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRemove(compId) {
    try {
      await deleteCompetency(orgId, compId);
      setCompetencies((prev) => prev.filter((c) => c.id !== compId));
    } catch (e) {
      setError(e.message);
    }
  }

  const riskMessages = {
    unassigned: "⚫ Nikto nie je priradený k tomuto kroku.",
    critical: "🔴 Len jedna osoba pozná tento krok — riziko výpadku.",
    low: "🟡 Chýba primárny vykonávateľ alebo záloha.",
    none: null,
  };

  return (
    <div className="workforce-overlay-panel">
      <div className="overlay-header">
        <span className="overlay-title">👥 {stepName || selectedStepId}</span>
        <button className="overlay-close" onClick={onClose}>✕</button>
      </div>

      {error && <div className="overlay-error">{error}</div>}
      {riskMessages[risk] && <div className={`overlay-risk risk-${risk}`}>{riskMessages[risk]}</div>}

      <div className="overlay-competencies">
        {competencies.map((comp) => {
          const emp = employees.find((e) => e.id === comp.emp_id);
          return (
            <div key={comp.id} className="competency-row">
              <span className="emp-info">{emp?.emp_no} {emp?.name}</span>
              <select value={comp.level} onChange={(e) => handleLevelChange(comp.id, e.target.value)}>
                {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
              </select>
              <button onClick={() => handleRemove(comp.id)} title="Odstrániť">✕</button>
            </div>
          );
        })}
        {competencies.length === 0 && <p className="overlay-empty">Žiadne priradenia</p>}
      </div>

      {adding ? (
        <div className="overlay-add-form">
          <label>
            <input type="checkbox" checked={createNew} onChange={(e) => setCreateNew(e.target.checked)} />
            {" "}Nový zamestnanec
          </label>
          {createNew ? (
            <>
              <input placeholder="Č. zamestnanca (E001)" value={newEmpNo} onChange={(e) => setNewEmpNo(e.target.value)} />
              <input placeholder="Meno a priezvisko" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </>
          ) : (
            <select value={newEmpId} onChange={(e) => setNewEmpId(e.target.value)}>
              <option value="">— vyber zamestnanca —</option>
              {availableEmployees.map((e) => (
                <option key={e.id} value={e.id}>{e.emp_no} {e.name}</option>
              ))}
            </select>
          )}
          <select value={newLevel} onChange={(e) => setNewLevel(e.target.value)}>
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
          </select>
          <div className="overlay-add-actions">
            <button onClick={handleAdd}>Potvrdiť</button>
            <button onClick={() => { setAdding(false); setCreateNew(false); }}>Zrušiť</button>
          </div>
        </div>
      ) : (
        <button className="overlay-add-btn" onClick={() => setAdding(true)}>+ Pridať zamestnanca</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/WorkforceOverlay.jsx
git commit -m "feat: WorkforceOverlay side panel component"
```

---

## Task 8: MapViewer overlay toggle

**Files:**
- Modify: `frontend/src/components/MapViewer.jsx`

- [ ] **Step 1: Read current MapViewer.jsx to understand its structure**

```bash
head -60 frontend/src/components/MapViewer.jsx
```

- [ ] **Step 2: Add overlay state and toggle button**

At the top of `MapViewer.jsx`, add imports after existing ones:

```jsx
import { useState, useEffect } from "react";
import WorkforceOverlay, { computeTaskRisk, RISK_BORDER } from "./WorkforceOverlay";
import { listCompetencies } from "../api/workforce";
```

Inside the component, add state (after existing state declarations):

```jsx
const [overlayOn, setOverlayOn] = useState(false);
const [selectedStepId, setSelectedStepId] = useState(null);
const [selectedStepName, setSelectedStepName] = useState(null);
const [stepCompetencies, setStepCompetencies] = useState({});
```

- [ ] **Step 3: Load competencies when overlay is toggled on**

Add this effect inside the component (after existing effects):

```jsx
useEffect(() => {
  if (!overlayOn || !orgId || !processNodeId) return;
  listCompetencies(orgId, { process_node_id: processNodeId })
    .then((comps) => {
      const byStep = {};
      comps.forEach((c) => {
        if (!byStep[c.step_id]) byStep[c.step_id] = [];
        byStep[c.step_id].push(c);
      });
      setStepCompetencies(byStep);
    })
    .catch(() => {});
}, [overlayOn, orgId, processNodeId]);
```

- [ ] **Step 4: Add toggle button to MapViewer toolbar**

Find the toolbar/controls area in `MapViewer.jsx` and add the toggle button alongside existing controls:

```jsx
{orgId && processNodeId && (
  <button
    className={`overlay-toggle${overlayOn ? " active" : ""}`}
    onClick={() => { setOverlayOn((v) => !v); setSelectedStepId(null); }}
    title="Zastupiteľnosť"
  >
    👥 Zastupiteľnosť
  </button>
)}
```

- [ ] **Step 5: Add click handler on task nodes and risk border overlay**

In the section where bpmn-js viewer is set up (where `viewer.on` or canvas events are wired), add:

```jsx
if (overlayOn) {
  viewer.on("element.click", (event) => {
    const el = event.element;
    if (el.type === "bpmn:Task" || el.type === "bpmn:UserTask" || el.type === "bpmn:ServiceTask") {
      setSelectedStepId(el.id);
      setSelectedStepName(el.businessObject?.name || el.id);
    }
  });
}
```

After the diagram renders, when `overlayOn` is true, apply colored borders via bpmn-js overlays API:

```jsx
if (overlayOn && viewer) {
  const overlaysApi = viewer.get("overlays");
  overlaysApi.clear();
  Object.entries(stepCompetencies).forEach(([stepId, comps]) => {
    const risk = computeTaskRisk(comps);
    try {
      overlaysApi.add(stepId, {
        position: { top: -4, left: -4 },
        html: `<div style="
          border: 3px solid ${RISK_BORDER[risk]};
          border-radius: 4px;
          width: calc(100% + 8px);
          height: calc(100% + 8px);
          pointer-events: none;
          box-shadow: 0 0 6px ${RISK_BORDER[risk]}44;
        "></div>`,
      });
    } catch (_) {}
  });
}
```

- [ ] **Step 6: Render overlay panel**

In the JSX return of `MapViewer.jsx`, after the diagram container, add:

```jsx
{overlayOn && selectedStepId && (
  <WorkforceOverlay
    orgId={orgId}
    processNodeId={processNodeId}
    selectedStepId={selectedStepId}
    stepName={selectedStepName}
    onClose={() => setSelectedStepId(null)}
  />
)}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/MapViewer.jsx
git commit -m "feat: workforce overlay toggle on MapViewer"
```

---

## Task 9: Wire WorkforcePage into app routing

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Read App.jsx to find routing pattern**

```bash
grep -n "import\|Route\|path" frontend/src/App.jsx | head -30
```

- [ ] **Step 2: Add import and route**

Add import near other page imports in `frontend/src/App.jsx`:

```jsx
import WorkforcePage from "./pages/WorkforcePage";
```

Add route inside the router/routes section, following the existing pattern for org-scoped pages. Pass `orgId` from app state or context (check how other org-scoped pages receive it):

```jsx
<Route path="/workforce" element={<WorkforcePage orgId={activeOrgId} />} />
```

- [ ] **Step 3: Add nav link**

Find the nav/sidebar in `App.jsx` or `Sidebar`-equivalent component and add:

```jsx
<a href="/workforce">👥 Workforce</a>
```

- [ ] **Step 4: Verify app compiles**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: add WorkforcePage route and nav link"
```

---

## Self-Review Checklist

- [x] Employee storage: create, list, update, delete, org-scoped — covered in Task 1
- [x] Competency storage: create (with upsert), list (filtered), update level, delete, cascade delete — covered in Task 2
- [x] Matrix builder: steps aggregated, cells, risk levels (none/low/critical/unassigned) — covered in Task 2
- [x] API router: 11 endpoints, auth scoped, employee existence check before competency — covered in Task 3
- [x] Router registered in main.py — covered in Task 4
- [x] Frontend API client: all 9 functions — covered in Task 5
- [x] WorkforcePage: employee tab (CRUD), matrix tab (auto-generated) — covered in Task 6
- [x] Overlay side panel: show competencies, add/change/remove, inline employee create, risk warning — covered in Task 7
- [x] MapViewer: toggle, colored borders, click → panel — covered in Task 8
- [x] App routing — covered in Task 9
- [x] `owner_emp_id` on lane: not a separate task — engine schema already allows it via `additionalProperties: True`, can be set by the overlay when assigning a primary person to a lane (future extension, out of scope for this plan per spec)
