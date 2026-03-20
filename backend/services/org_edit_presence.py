from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock


PRESENCE_TTL_SECONDS = 70


@dataclass
class EditorPresence:
    user_id: str
    email: str
    org_id: str
    tree_node_id: str
    last_seen_at: datetime


_presence_lock = Lock()
_presence_by_key: dict[tuple[str, str, str], EditorPresence] = {}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _prune_expired(now: datetime | None = None) -> None:
    current = now or _utcnow()
    cutoff = current - timedelta(seconds=PRESENCE_TTL_SECONDS)
    expired = [key for key, value in _presence_by_key.items() if value.last_seen_at < cutoff]
    for key in expired:
        _presence_by_key.pop(key, None)


def heartbeat_editor_presence(org_id: str, tree_node_id: str, user_id: str, email: str) -> None:
    now = _utcnow()
    key = (str(org_id), str(tree_node_id), str(user_id))
    with _presence_lock:
        _prune_expired(now)
        _presence_by_key[key] = EditorPresence(
            user_id=str(user_id),
            email=str(email or ""),
            org_id=str(org_id),
            tree_node_id=str(tree_node_id),
            last_seen_at=now,
        )


def clear_editor_presence(org_id: str, tree_node_id: str, user_id: str) -> None:
    key = (str(org_id), str(tree_node_id), str(user_id))
    with _presence_lock:
        _presence_by_key.pop(key, None)
        _prune_expired()


def list_org_editor_presence(org_id: str) -> dict[str, list[dict[str, str]]]:
    with _presence_lock:
        _prune_expired()
        grouped: dict[str, list[dict[str, str]]] = {}
        for presence in _presence_by_key.values():
            if str(presence.org_id) != str(org_id):
                continue
            grouped.setdefault(str(presence.tree_node_id), []).append(
                {
                    "user_id": presence.user_id,
                    "email": presence.email,
                    "last_seen_at": presence.last_seen_at.isoformat().replace("+00:00", "Z"),
                }
            )
        return grouped
