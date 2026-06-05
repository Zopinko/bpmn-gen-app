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
