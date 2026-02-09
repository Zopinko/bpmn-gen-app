from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException

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
def get_org_model():
    return get_tree()


@router.post("/folder")
def create_org_folder(payload: dict = Body(...)):
    parent_id = payload.get("parentId")
    name = payload.get("name")
    if not isinstance(parent_id, str) or not parent_id.strip():
        raise HTTPException(status_code=400, detail="parentId je povinny.")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=400, detail="name je povinny.")
    try:
        node = create_folder(parent_id=parent_id.strip(), name=name.strip())
        return {"node": node, "tree": get_tree()}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/process")
def create_org_process(payload: dict = Body(...)):
    parent_id = payload.get("parentId")
    name = payload.get("name")
    if not isinstance(parent_id, str) or not parent_id.strip():
        raise HTTPException(status_code=400, detail="parentId je povinny.")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=400, detail="name je povinny.")
    try:
        node = create_process(parent_id=parent_id.strip(), name=name.strip())
        return {"node": node, "tree": get_tree()}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/node/{node_id}")
def rename_org_node(node_id: str, payload: dict = Body(...)):
    name = payload.get("name")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=400, detail="name je povinny.")
    try:
        node = rename_node(node_id=node_id, name=name.strip())
        return {"node": node, "tree": get_tree()}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/move")
def move_org_node(payload: dict = Body(...)):
    node_id = payload.get("nodeId")
    target_parent_id = payload.get("targetParentId")
    if not isinstance(node_id, str) or not node_id.strip():
        raise HTTPException(status_code=400, detail="nodeId je povinny.")
    if not isinstance(target_parent_id, str) or not target_parent_id.strip():
        raise HTTPException(status_code=400, detail="targetParentId je povinny.")
    try:
        node = move_node(node_id=node_id.strip(), new_parent_id=target_parent_id.strip())
        return {"node": node, "tree": get_tree()}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/node/{node_id}")
def delete_org_node(node_id: str):
    try:
        delete_node(node_id)
        return {"ok": True, "tree": get_tree()}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
