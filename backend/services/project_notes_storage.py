import json
import os
from pathlib import Path
from typing import Any, List

_default_path = Path("data/project_notes.json")
_file_path = Path(os.getenv("BPMN_PROJECT_NOTES_FILE", str(_default_path)))


def _ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def load_project_notes() -> List[dict]:
    if not _file_path.exists():
        return []
    try:
        with _file_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
    except Exception:
        return []
    return []


def save_project_notes(notes: List[dict]) -> List[dict]:
    _ensure_dir(_file_path)
    sanitized: List[dict] = []
    for item in notes:
        if isinstance(item, dict):
            sanitized.append(item)
    with _file_path.open("w", encoding="utf-8") as f:
        json.dump(sanitized, f, ensure_ascii=False)
    return sanitized
