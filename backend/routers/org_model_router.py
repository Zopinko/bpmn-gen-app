from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from auth.deps import require_primary_org_id, require_user
from auth.service import AuthUser
from services.org_model_storage import (
    create_folder,
    create_process,
    delete_node,
    get_tree,
    move_node,
    rename_node,
)


router = APIRouter(prefix="/api/org-model", tags=["OrganizationModel"])


@router.get("")
def get_org_model(current_user: AuthUser = Depends(require_user)):
    org_id = require_primary_org_id(current_user)
    return get_tree(org_id)


@router.post("/folder")
def create_org_folder(payload: dict = Body(...), current_user: AuthUser = Depends(require_user)):
    parent_id = payload.get("parentId")
    name = payload.get("name")
    if not isinstance(parent_id, str) or not parent_id.strip():
        raise HTTPException(status_code=400, detail="parentId je povinny.")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=400, detail="name je povinny.")
    try:
        org_id = require_primary_org_id(current_user)
        node = create_folder(org_id=org_id, parent_id=parent_id.strip(), name=name.strip())
        return {"node": node, "tree": get_tree(org_id)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/process")
def create_org_process(payload: dict = Body(...), current_user: AuthUser = Depends(require_user)):
    parent_id = payload.get("parentId")
    name = payload.get("name")
    if not isinstance(parent_id, str) or not parent_id.strip():
        raise HTTPException(status_code=400, detail="parentId je povinny.")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=400, detail="name je povinny.")
    try:
        org_id = require_primary_org_id(current_user)
        node = create_process(org_id=org_id, parent_id=parent_id.strip(), name=name.strip())
        return {"node": node, "tree": get_tree(org_id)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/node/{node_id}")
def rename_org_node(
    node_id: str,
    payload: dict = Body(...),
    current_user: AuthUser = Depends(require_user),
):
    name = payload.get("name")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=400, detail="name je povinny.")
    try:
        org_id = require_primary_org_id(current_user)
        node = rename_node(org_id=org_id, node_id=node_id, name=name.strip())
        return {"node": node, "tree": get_tree(org_id)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/move")
def move_org_node(payload: dict = Body(...), current_user: AuthUser = Depends(require_user)):
    node_id = payload.get("nodeId")
    target_parent_id = payload.get("targetParentId")
    if not isinstance(node_id, str) or not node_id.strip():
        raise HTTPException(status_code=400, detail="nodeId je povinny.")
    if not isinstance(target_parent_id, str) or not target_parent_id.strip():
        raise HTTPException(status_code=400, detail="targetParentId je povinny.")
    try:
        org_id = require_primary_org_id(current_user)
        node = move_node(
            org_id=org_id,
            node_id=node_id.strip(),
            new_parent_id=target_parent_id.strip(),
        )
        return {"node": node, "tree": get_tree(org_id)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/node/{node_id}")
def delete_org_node(node_id: str, current_user: AuthUser = Depends(require_user)):
    try:
        org_id = require_primary_org_id(current_user)
        delete_node(org_id=org_id, node_id=node_id)
        return {"ok": True, "tree": get_tree(org_id)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
