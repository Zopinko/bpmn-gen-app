from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import APIRouter, Depends

from auth.db import get_connection
from auth.deps import require_super_admin


router = APIRouter(prefix="/api/admin", tags=["Admin"], dependencies=[Depends(require_super_admin)])


def _models_base_dir() -> Path:
    return Path(os.getenv("BPMN_MODELS_DIR", "data/models")) / "orgs"


def _org_model_items() -> list[dict]:
    items: list[dict] = []
    base_dir = _models_base_dir()
    if not base_dir.exists():
        return items
    for org_dir in base_dir.iterdir():
        if not org_dir.is_dir():
            continue
        models_dir = org_dir / "models"
        if not models_dir.exists():
            continue
        for file in models_dir.glob("*.json"):
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
            except Exception:
                continue
            items.append(
                {
                    "id": data.get("id") or file.stem,
                    "name": data.get("name") or file.stem,
                    "org_id": org_dir.name,
                    "created_at": data.get("created_at"),
                    "updated_at": data.get("updated_at"),
                }
            )
    items.sort(key=lambda item: item.get("updated_at") or item.get("created_at") or "", reverse=True)
    return items


def _org_model_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in _org_model_items():
        org_id = str(item.get("org_id") or "")
        counts[org_id] = counts.get(org_id, 0) + 1
    return counts


@router.get("/users")
def list_admin_users():
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                u.id,
                u.email,
                u.role,
                u.email_verified_at,
                u.created_at,
                u.last_login_at,
                COUNT(DISTINCT om.organization_id) AS org_count,
                COUNT(DISTINCT CASE
                    WHEN s.revoked_at IS NULL THEN s.id
                    ELSE NULL
                END) AS session_count
            FROM users u
            LEFT JOIN organization_members om ON om.user_id = u.id
            LEFT JOIN auth_sessions s ON s.user_id = u.id
            GROUP BY u.id, u.email, u.role, u.email_verified_at, u.created_at, u.last_login_at
            ORDER BY u.created_at DESC
            """
        ).fetchall()
    items = [
        {
            "id": row["id"],
            "email": row["email"],
            "role": row["role"],
            "email_verified_at": row["email_verified_at"],
            "created_at": row["created_at"],
            "last_login_at": row["last_login_at"],
            "org_count": int(row["org_count"] or 0),
            "session_count": int(row["session_count"] or 0),
        }
        for row in rows
    ]
    return {"count": len(items), "items": items}


@router.get("/orgs")
def list_admin_orgs():
    model_counts = _org_model_counts()
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                o.id,
                o.name,
                o.created_at,
                o.created_by_user_id,
                u.email AS created_by_email,
                COUNT(DISTINCT om.user_id) AS member_count,
                COUNT(DISTINCT CASE WHEN om.role = 'owner' THEN om.user_id ELSE NULL END) AS owner_count
            FROM organizations o
            LEFT JOIN users u ON u.id = o.created_by_user_id
            LEFT JOIN organization_members om ON om.organization_id = o.id
            GROUP BY o.id, o.name, o.created_at, o.created_by_user_id, u.email
            ORDER BY o.created_at DESC
            """
        ).fetchall()
    items = [
        {
            "id": row["id"],
            "name": row["name"],
            "created_at": row["created_at"],
            "created_by_user_id": row["created_by_user_id"],
            "created_by_email": row["created_by_email"],
            "member_count": int(row["member_count"] or 0),
            "owner_count": int(row["owner_count"] or 0),
            "model_count": int(model_counts.get(row["id"], 0)),
        }
        for row in rows
    ]
    return {"count": len(items), "items": items}


@router.get("/models")
def list_admin_models():
    items = _org_model_items()
    org_names: dict[str, str] = {}
    with get_connection() as conn:
        for row in conn.execute("SELECT id, name FROM organizations").fetchall():
            org_names[row["id"]] = row["name"]
    for item in items:
        org_id = str(item.get("org_id") or "")
        item["org_name"] = org_names.get(org_id)
    return {"count": len(items), "items": items}
