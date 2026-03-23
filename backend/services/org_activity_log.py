from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from auth.security import to_iso_z, utcnow
from services.storage_io import atomic_write_json

logger = logging.getLogger(__name__)


def _models_dir() -> Path:
    return Path(os.getenv("BPMN_MODELS_DIR", "data/models"))


def _safe_org_id(org_id: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in str(org_id))


def _activity_log_path(org_id: str) -> Path:
    return _models_dir() / "orgs" / _safe_org_id(org_id) / "activity_log.json"


def _load_events(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Failed to read org activity log: path=%s error=%s", path, exc)
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def list_org_events(org_id: str, limit: int = 50) -> list[dict[str, Any]]:
    if not str(org_id or "").strip():
        return []
    safe_limit = max(1, min(int(limit or 50), 200))
    items = _load_events(_activity_log_path(org_id))
    return list(reversed(items))[:safe_limit]


def get_org_event(org_id: str, event_id: str) -> dict[str, Any] | None:
    if not str(org_id or "").strip() or not str(event_id or "").strip():
        return None
    items = _load_events(_activity_log_path(org_id))
    for item in items:
        if str(item.get("id") or "") == str(event_id):
            return item
    return None


def get_org_request_resolution(org_id: str, request_id: str) -> dict[str, Any] | None:
    if not str(org_id or "").strip() or not str(request_id or "").strip():
        return None
    items = _load_events(_activity_log_path(org_id))
    for item in reversed(items):
        event_type = str(item.get("event_type") or "")
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        if metadata.get("request_id") != request_id:
            continue
        if event_type in {"delete_request_approved", "delete_request_rejected"}:
            return item
    return None


def record_org_event(
    org_id: str,
    *,
    actor_user_id: str,
    actor_email: str,
    event_type: str,
    entity_type: str,
    entity_id: str,
    entity_name: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if not str(org_id or "").strip():
        return None
    try:
        path = _activity_log_path(org_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        items = _load_events(path)
        payload = {
            "id": str(uuid4()),
            "org_id": str(org_id),
            "actor_user_id": str(actor_user_id or "").strip(),
            "actor_email": str(actor_email or "").strip().lower(),
            "event_type": str(event_type or "").strip(),
            "entity_type": str(entity_type or "").strip(),
            "entity_id": str(entity_id or "").strip(),
            "entity_name": str(entity_name or "").strip(),
            "metadata": metadata if isinstance(metadata, dict) else {},
            "created_at": to_iso_z(utcnow()),
        }
        items.append(payload)
        atomic_write_json(path, items, ensure_ascii=False)
        return payload
    except Exception as exc:
        logger.warning(
            "Failed to record org activity event: org_id=%s event_type=%s entity_type=%s entity_id=%s error=%s",
            org_id,
            event_type,
            entity_type,
            entity_id,
            exc,
        )
        return None
