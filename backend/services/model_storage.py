import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4


_base_dir = Path(os.getenv("BPMN_MODELS_DIR", "data/models"))


def set_base_dir(path: str | Path) -> None:
    """Override storage directory (useful for tests)."""
    global _base_dir
    _base_dir = Path(path)
    _base_dir.mkdir(parents=True, exist_ok=True)


def _models_dir() -> Path:
    os.makedirs(_base_dir, exist_ok=True)
    return _base_dir


def _model_path(model_id: str) -> Path:
    return _models_dir() / f"{model_id}.json"


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def save_model(
    name: str,
    engine_json: Dict[str, Any],
    diagram_xml: str,
    model_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Create or update a model. Returns full model."""
    model_id = model_id or str(uuid4())
    path = _model_path(model_id)
    created_at = _now_iso()
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as f:
                existing = json.load(f)
            created_at = existing.get("created_at", created_at)
        except Exception:
            pass
    model = {
        "id": model_id,
        "name": name,
        "engine_json": engine_json,
        "diagram_xml": diagram_xml,
        "created_at": created_at,
        "updated_at": _now_iso(),
    }
    with path.open("w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False)
    return model


def load_model(model_id: str) -> Dict[str, Any]:
    path = _model_path(model_id)
    if not path.exists():
        raise FileNotFoundError(model_id)
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def delete_model(model_id: str) -> None:
    path = _model_path(model_id)
    if path.exists():
        path.unlink()


def list_models(search: str | None = None) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    directory = _models_dir()
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
    if search:
        s = search.lower()
        items = [m for m in items if s in (m.get("name") or "").lower()]
    # newest first by updated_at
    items.sort(key=lambda m: m.get("updated_at") or "", reverse=True)
    return items
