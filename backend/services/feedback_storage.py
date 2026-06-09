from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from services.storage_io import atomic_write_json

logger = logging.getLogger(__name__)


def _feedback_path() -> Path:
    base = Path(os.getenv("BPMN_MODELS_DIR", "data/models"))
    base.mkdir(parents=True, exist_ok=True)
    return base / "feedback.json"


def _load() -> list[dict]:
    path = _feedback_path()
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as exc:
        logger.error("Corrupted feedback.json: %s", exc)
        return []


def _save(items: list[dict]) -> None:
    atomic_write_json(_feedback_path(), items, ensure_ascii=False)


def create_feedback(user_id: str, user_email: str, message: str, page: str = "") -> dict:
    message = message.strip()
    if not message:
        raise ValueError("Feedback message cannot be empty.")
    if len(message) > 4000:
        raise ValueError("Feedback message is too long (max 4000 characters).")

    items = _load()
    entry = {
        "id": str(uuid4()),
        "user_id": user_id,
        "user_email": user_email,
        "message": message,
        "page": str(page or "").strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    items.append(entry)
    _save(items)
    return entry


def list_feedback() -> list[dict]:
    return list(reversed(_load()))
