from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from services.org_model_storage import get_node, get_tree
from services.org_models_storage import load_org_model
from services.storage_io import atomic_write_json

logger = logging.getLogger(__name__)

CompetencyLevel = Literal["primary", "backup", "training"]
VALID_LEVELS = {"primary", "backup", "training"}
TASK_TYPES = {"task", "userTask", "serviceTask"}


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
    step_name: str = "",
) -> dict:
    if level not in VALID_LEVELS:
        raise ValueError(f"Neplatná úroveň: {level}. Povolené: {VALID_LEVELS}")
    competencies = _load(org_id)
    clean_step_name = str(step_name or "").strip()
    for i, c in enumerate(competencies):
        if c["emp_id"] == emp_id and c["process_node_id"] == process_node_id and c["step_id"] == step_id:
            updated = dict(c)
            updated["level"] = level
            if clean_step_name:
                updated["step_name"] = clean_step_name
            competencies[i] = updated
            _save(org_id, competencies)
            return updated
    competency: dict[str, Any] = {
        "id": str(uuid4()),
        "emp_id": emp_id,
        "process_node_id": process_node_id,
        "step_id": step_id,
        "level": level,
    }
    if clean_step_name:
        competency["step_name"] = clean_step_name
    competencies.append(competency)
    _save(org_id, competencies)
    return competency


def update_competency(org_id: str, competency_id: str, level: CompetencyLevel) -> dict:
    if level not in VALID_LEVELS:
        raise ValueError(f"Neplatná úroveň: {level}.")
    competencies = _load(org_id)
    for i, c in enumerate(competencies):
        if c["id"] == competency_id:
            require_process_step(org_id, c["process_node_id"], c["step_id"])
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


def list_process_steps(org_id: str, process_node_id: str | None = None) -> dict[tuple[str, str], dict]:
    if process_node_id:
        process = get_node(org_id, process_node_id)
        if not process or process.get("type") != "process":
            return {}
        pending = [process]
    else:
        pending = [get_tree(org_id)]

    steps = {}
    while pending:
        process = pending.pop()
        if process.get("type") != "process":
            pending.extend(reversed(process.get("children", [])))
            continue
        process_id = str(process["id"])
        model_id = (process.get("processRef") or {}).get("modelId")
        if not model_id:
            continue
        try:
            model = load_org_model(org_id, model_id)
        except (FileNotFoundError, ValueError) as exc:
            logger.warning("Could not load workforce process org=%s process=%s: %s", org_id, process_id, exc)
            continue
        engine = model.get("engine_json")
        nodes = engine.get("nodes") if isinstance(engine, dict) else None
        if not isinstance(nodes, list):
            continue
        process_name = str(process.get("name") or model.get("name") or process_id)
        for node in nodes:
            if not isinstance(node, dict) or str(node.get("type")) not in TASK_TYPES or not node.get("id"):
                continue
            step_id = str(node["id"])
            steps[process_id, step_id] = {
                "process_node_id": process_id,
                "process_name": process_name,
                "step_id": step_id,
                "step_name": str(node.get("name") or node.get("label") or step_id),
            }
    return steps


def require_process_step(org_id: str, process_node_id: str, step_id: str) -> None:
    if (process_node_id, step_id) not in list_process_steps(org_id, process_node_id):
        raise LookupError("Krok neexistuje v aktuálnom procese.")


def build_matrix(org_id: str, process_node_id: str | None = None) -> dict:
    from services.org_employees_storage import list_employees

    employees = list_employees(org_id)
    employee_ids = {employee["id"] for employee in employees}
    steps = list_process_steps(org_id, process_node_id)
    competencies = list_competencies(org_id, process_node_id=process_node_id)
    cells = []
    assignments_by_step: dict[tuple[str, str], list[dict]] = {}
    for c in competencies:
        key = (c["process_node_id"], c["step_id"])
        if key not in steps or c["emp_id"] not in employee_ids:
            continue
        cell = {
            "emp_id": c["emp_id"],
            "process_node_id": c["process_node_id"],
            "step_id": c["step_id"],
            "level": c["level"],
        }
        cells.append(cell)
        assignments_by_step.setdefault(key, []).append(cell)

    risk = [
        {
            "process_node_id": process_id,
            "step_id": step_id,
            "risk": _compute_risk(assignments_by_step.get((process_id, step_id), [])),
        }
        for process_id, step_id in steps
    ]

    return {"employees": employees, "steps": list(steps.values()), "cells": cells, "risk": risk}
