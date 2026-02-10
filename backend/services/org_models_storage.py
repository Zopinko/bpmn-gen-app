from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List
from uuid import uuid4


def _base_models_dir() -> Path:
    return Path(os.getenv("BPMN_MODELS_DIR", "data/models"))


def org_models_dir(org_id: str) -> Path:
    path = _base_models_dir() / "orgs" / str(org_id) / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def org_model_path(org_id: str, model_id: str) -> Path:
    return org_models_dir(org_id) / f"{model_id}.json"


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def save_org_model_copy(org_id: str, model: Dict[str, Any], name_override: str | None = None) -> str:
    new_id = str(uuid4())
    now = _now_iso()
    stored = dict(model)
    stored["id"] = new_id
    if name_override is not None:
        stored["name"] = name_override
    stored["created_at"] = now
    stored["updated_at"] = now
    path = org_model_path(org_id, new_id)
    with path.open("w", encoding="utf-8") as f:
        json.dump(stored, f, ensure_ascii=False)
    return new_id


def list_org_models(org_id: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    directory = org_models_dir(org_id)
    for file in directory.glob("*.json"):
        try:
            with file.open("r", encoding="utf-8") as f:
                data = json.load(f)
            items.append(
                {
                    "id": data.get("id"),
                    "name": data.get("name"),
                    "created_at": data.get("created_at"),
                    "updated_at": data.get("updated_at"),
                }
            )
        except Exception:
            continue
    items.sort(key=lambda m: m.get("updated_at") or "", reverse=True)
    return items


def load_org_model(org_id: str, org_model_id: str) -> Dict[str, Any]:
    path = org_model_path(org_id, org_model_id)
    if not path.exists():
        raise FileNotFoundError(org_model_id)
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_org_model(org_id: str, org_model_id: str, model: Dict[str, Any]) -> Dict[str, Any]:
    path = org_model_path(org_id, org_model_id)
    created_at = model.get("created_at")
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as f:
                existing = json.load(f)
            created_at = existing.get("created_at", created_at)
        except Exception:
            pass
    now = _now_iso()
    stored = dict(model)
    stored["id"] = org_model_id
    stored["created_at"] = created_at or now
    stored["updated_at"] = now
    with path.open("w", encoding="utf-8") as f:
        json.dump(stored, f, ensure_ascii=False)
    return stored
