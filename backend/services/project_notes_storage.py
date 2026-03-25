import json
import logging
import os
from pathlib import Path
from typing import List

from services.storage_io import atomic_write_json

_default_path = Path("data/project_notes.json")
logger = logging.getLogger(__name__)


def _resolve_legacy_notes_path() -> Path:
    explicit_file = os.getenv("BPMN_PROJECT_NOTES_FILE")
    if explicit_file:
        return Path(explicit_file)
    explicit_dir = os.getenv("BPMN_PROJECT_NOTES_DIR")
    if explicit_dir:
        return Path(explicit_dir) / "project_notes.json"
    models_dir = os.getenv("BPMN_MODELS_DIR")
    if models_dir:
        return Path(models_dir) / "project_notes.json"
    return _default_path


def _resolve_notes_base_dir() -> Path:
    explicit_dir = os.getenv("BPMN_PROJECT_NOTES_DIR")
    if explicit_dir:
        return Path(explicit_dir)
    explicit_file = os.getenv("BPMN_PROJECT_NOTES_FILE")
    if explicit_file:
        return Path(explicit_file).parent / "project_notes"
    models_dir = os.getenv("BPMN_MODELS_DIR")
    if models_dir:
        return Path(models_dir) / "project_notes"
    return Path("data/project_notes")


def _ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _org_notes_path(org_id: str) -> Path:
    safe_org_id = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in str(org_id))
    return _resolve_notes_base_dir() / f"org_{safe_org_id}.json"


def _load_notes_from_path(path: Path) -> List[dict]:
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
    except Exception as exc:
        logger.warning("Failed to read project notes file: path=%s error=%s", path, exc)
        return []
    return []


def load_project_notes(org_id: str) -> List[dict]:
    if not str(org_id or "").strip():
        return []
    return _load_notes_from_path(_org_notes_path(org_id))


def save_project_notes(org_id: str, notes: List[dict]) -> List[dict]:
    if not str(org_id or "").strip():
        return []
    file_path = _org_notes_path(org_id)
    _ensure_dir(file_path)
    sanitized: List[dict] = []
    for item in notes:
        if isinstance(item, dict):
            sanitized.append(item)
    atomic_write_json(file_path, sanitized, ensure_ascii=False)
    return sanitized


def delete_project_notes(org_id: str) -> None:
    if not str(org_id or "").strip():
        return
    file_path = _org_notes_path(org_id)
    if file_path.exists():
        file_path.unlink()


def has_legacy_global_notes() -> bool:
    legacy_path = _resolve_legacy_notes_path()
    return legacy_path.exists()
