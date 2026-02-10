from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from services.model_storage import save_model


def _models_dir() -> Path:
    return Path(os.getenv("BPMN_MODELS_DIR", "data/models"))


def _legacy_tree_path() -> Path:
    tree_dir = os.getenv("BPMN_TREE_DIR", os.path.join(_models_dir().as_posix(), "tree"))
    return Path(tree_dir) / "model_organizacie.json"


def org_tree_path(org_id: str) -> Path:
    path = _models_dir() / "orgs" / str(org_id) / "tree.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _default_root() -> dict[str, Any]:
    return {
        "id": "root",
        "type": "folder",
        "name": "Model organizácie",
        "children": [],
    }


def _ensure_storage(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return
    path.write_text(json.dumps(_default_root(), ensure_ascii=False, indent=2), encoding="utf-8")


def _read_tree(org_id: str) -> dict[str, Any]:
    path = org_tree_path(org_id)
    if not path.exists():
        legacy = _legacy_tree_path()
        if legacy.exists():
            path.write_text(legacy.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            _ensure_storage(path)
    return json.loads(path.read_text(encoding="utf-8"))


def _write_tree(org_id: str, tree: dict[str, Any]) -> None:
    path = org_tree_path(org_id)
    _ensure_storage(path)
    path.write_text(json.dumps(tree, ensure_ascii=False, indent=2), encoding="utf-8")


def get_tree(org_id: str) -> dict[str, Any]:
    return _read_tree(org_id)


def _find_node_and_parent(
    current: dict[str, Any],
    node_id: str,
    parent: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if current.get("id") == node_id:
        return current, parent
    for child in current.get("children", []):
        found, found_parent = _find_node_and_parent(child, node_id, current)
        if found:
            return found, found_parent
    return None, None


def _assert_folder(node: dict[str, Any] | None, message: str) -> dict[str, Any]:
    if not node or node.get("type") != "folder":
        raise ValueError(message)
    return node


def create_folder(org_id: str, parent_id: str, name: str) -> dict[str, Any]:
    tree = _read_tree(org_id)
    parent, _ = _find_node_and_parent(tree, parent_id)
    parent = _assert_folder(parent, "Nadriadena polozka musi byt priecinok.")
    node = {
        "id": f"fld_{uuid4().hex[:12]}",
        "type": "folder",
        "name": name.strip() or "Novy priecinok",
        "children": [],
    }
    parent.setdefault("children", []).append(node)
    _write_tree(org_id, tree)
    return node


def _create_empty_process_model(name: str) -> dict[str, Any]:
    process_id = f"process_{uuid4().hex[:8]}"
    lane_id = f"lane_{uuid4().hex[:6]}"
    start_id = f"start_{uuid4().hex[:6]}"
    end_id = f"end_{uuid4().hex[:6]}"
    flow_id = f"flow_{uuid4().hex[:6]}"
    engine_json = {
        "processId": process_id,
        "name": name,
        "lanes": [{"id": lane_id, "name": "Main"}],
        "nodes": [
            {"id": start_id, "type": "startEvent", "laneId": lane_id, "name": "Start"},
            {"id": end_id, "type": "endEvent", "laneId": lane_id, "name": "End"},
        ],
        "flows": [{"id": flow_id, "source": start_id, "target": end_id}],
    }
    diagram_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_{process_id}" targetNamespace="http://bpmn.io/schema/bpmn">
  <process id="{process_id}" name="{name}" isExecutable="false">
    <startEvent id="{start_id}" name="Start" />
    <endEvent id="{end_id}" name="End" />
    <sequenceFlow id="{flow_id}" sourceRef="{start_id}" targetRef="{end_id}" />
  </process>
</definitions>
"""
    return save_model(
        name=name,
        engine_json=engine_json,
        diagram_xml=diagram_xml,
    )


def create_process(org_id: str, parent_id: str, name: str) -> dict[str, Any]:
    tree = _read_tree(org_id)
    parent, _ = _find_node_and_parent(tree, parent_id)
    parent = _assert_folder(parent, "Nadriadena polozka musi byt priecinok.")
    model = _create_empty_process_model(name.strip() or "Novy proces")
    node = {
        "id": f"prc_{uuid4().hex[:12]}",
        "type": "process",
        "name": model.get("name") or "Novy proces",
        "processRef": {"modelId": model["id"]},
    }
    parent.setdefault("children", []).append(node)
    _write_tree(org_id, tree)
    return node


def rename_node(org_id: str, node_id: str, name: str) -> dict[str, Any]:
    tree = _read_tree(org_id)
    node, _ = _find_node_and_parent(tree, node_id)
    if not node:
        raise ValueError("Polozka neexistuje.")
    if node.get("id") == "root":
        raise ValueError("Root nie je mozne premenovat.")
    node["name"] = name.strip() or node.get("name") or "Bez nazvu"
    _write_tree(org_id, tree)
    return node


def _is_descendant(node: dict[str, Any], possible_descendant_id: str) -> bool:
    for child in node.get("children", []):
        if child.get("id") == possible_descendant_id:
            return True
        if _is_descendant(child, possible_descendant_id):
            return True
    return False


def move_node(org_id: str, node_id: str, new_parent_id: str) -> dict[str, Any]:
    if node_id == "root":
        raise ValueError("Root nie je mozne presuvat.")
    tree = _read_tree(org_id)
    node, parent = _find_node_and_parent(tree, node_id)
    if not node or not parent:
        raise ValueError("Polozka neexistuje.")
    new_parent, _ = _find_node_and_parent(tree, new_parent_id)
    new_parent = _assert_folder(new_parent, "Cielovy parent musi byt priecinok.")
    if _is_descendant(node, new_parent_id):
        raise ValueError("Priecinok nie je mozne presunut do vlastneho potomka.")
    parent["children"] = [child for child in parent.get("children", []) if child.get("id") != node_id]
    new_parent.setdefault("children", []).append(node)
    _write_tree(org_id, tree)
    return node


def delete_node(org_id: str, node_id: str) -> None:
    if node_id == "root":
        raise ValueError("Root nie je mozne zmazat.")
    tree = _read_tree(org_id)
    node, parent = _find_node_and_parent(tree, node_id)
    if not node or not parent:
        raise ValueError("Polozka neexistuje.")
    if node.get("type") == "folder" and node.get("children"):
        raise ValueError("Priecinok musi byt prazdny.")
    parent["children"] = [child for child in parent.get("children", []) if child.get("id") != node_id]
    _write_tree(org_id, tree)
