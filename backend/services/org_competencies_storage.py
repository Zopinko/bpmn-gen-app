from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Literal
from uuid import uuid4

from services.storage_io import atomic_write_json

logger = logging.getLogger(__name__)

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
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as exc:
        logger.error("Corrupted competencies.json for org=%s: %s", org_id, exc)
        raise ValueError(f"Poškodené dáta kompetencií pre org {org_id}") from exc


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
