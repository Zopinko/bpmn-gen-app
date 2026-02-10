import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

# Storage root: defaults to repo-local data/models; override via BPMN_MODELS_DIR for persistent disk (Render).
raw_dir = os.getenv("BPMN_MODELS_DIR")
_base_dir = Path(raw_dir) if raw_dir else Path("data/models")


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


def _user_models_dir(user_id: str) -> Path:
    base = _models_dir()
    user_dir = base / "users" / str(user_id) / "models"
    user_dir.mkdir(parents=True, exist_ok=True)
    return user_dir


def get_user_models_dir(user_id: str) -> Path:
    return _user_models_dir(user_id)


def _user_model_path(user_id: str, model_id: str) -> Path:
    return _user_models_dir(user_id) / f"{model_id}.json"


def _resolve_model_path(user_id: Optional[str], model_id: str) -> Path:
    if user_id:
        user_path = _user_model_path(user_id, model_id)
        if user_path.exists():
            return user_path
        global_path = _model_path(model_id)
        if global_path.exists():
            return global_path
        return user_path
    return _model_path(model_id)


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def save_model(
    name: str,
    engine_json: Dict[str, Any],
    diagram_xml: str,
    model_id: Optional[str] = None,
    generator_input: Optional[Dict[str, Any]] = None,
    process_meta: Optional[Dict[str, Any]] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Create or update a model. Returns full model."""
    model_id = model_id or str(uuid4())
    path = _user_model_path(user_id, model_id) if user_id else _model_path(model_id)
    created_at = _now_iso()
    existing_generator_input: Optional[Dict[str, Any]] = None
    existing_process_meta: Optional[Dict[str, Any]] = None
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as f:
                existing = json.load(f)
            created_at = existing.get("created_at", created_at)
            existing_generator_input = existing.get("generator_input")
            existing_process_meta = existing.get("process_meta")
        except Exception:
            pass
    final_generator_input = existing_generator_input if generator_input is None else generator_input
    final_process_meta = existing_process_meta if process_meta is None else process_meta
    model = {
        "id": model_id,
        "name": name,
        "engine_json": engine_json,
        "diagram_xml": diagram_xml,
        "created_at": created_at,
        "updated_at": _now_iso(),
    }
    if final_generator_input is not None:
        model["generator_input"] = final_generator_input
    if final_process_meta is not None:
        model["process_meta"] = final_process_meta
    with path.open("w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False)
    return model


def load_model(model_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
    path = _resolve_model_path(user_id, model_id)
    if not path.exists():
        raise FileNotFoundError(model_id)
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def delete_model(model_id: str, user_id: Optional[str] = None) -> None:
    path = _resolve_model_path(user_id, model_id)
    if path.exists():
        path.unlink()


def list_models(search: str | None = None, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    directory = _user_models_dir(user_id) if user_id else _models_dir()
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
                    "process_meta": data.get("process_meta"),
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
