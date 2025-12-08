from __future__ import annotations

import copy
import unicodedata
from typing import Any, Dict, List
from uuid import uuid4

from services.architect import (
    align_gateway_lanes,
    tidy_join_gateway_names,
    tidy_then_task_prefix,
    tidy_yes_no_gateway,
)

_ALIAS_MAP = {
    "start": "startEvent",
    "end": "endEvent",
    "exclusive": "exclusiveGateway",
    "inclusive": "inclusiveGateway",
    "parallel": "parallelGateway",
    # pass-through for already valid names
    "startEvent": "startEvent",
    "endEvent": "endEvent",
    "task": "task",
    "userTask": "userTask",
    "serviceTask": "serviceTask",
    "gateway": "gateway",
    "exclusiveGateway": "exclusiveGateway",
    "inclusiveGateway": "inclusiveGateway",
    "parallelGateway": "parallelGateway",
}

_SNAKE_TO_BPMN_TYPE = {
    "start_event": "startEvent",
    "end_event": "endEvent",
    "task": "task",
    "user_task": "userTask",
    "service_task": "serviceTask",
    "exclusive_gateway": "exclusiveGateway",
    "parallel_gateway": "parallelGateway",
    "inclusive_gateway": "inclusiveGateway",
    "event_based_gateway": "eventBasedGateway",
    "intermediate_catch_event": "intermediateCatchEvent",
    "intermediate_throw_event": "intermediateThrowEvent",
    "sub_process": "subProcess",
}


def _normalize_node_type(node: Dict[str, Any]) -> None:
    """Mutate *node* so its type matches canonical BPMN aliases."""
    node_type = (node.get("type") or "").strip()
    node["type"] = _ALIAS_MAP.get(node_type, node_type)


def normalize_engine_payload(engine: Dict[str, Any]) -> Dict[str, Any]:
    """Return a shallow copy of *engine* with defaults and canonical node types."""
    normalized: Dict[str, Any] = dict(engine or {})
    if not normalized.get("processId"):
        normalized["processId"] = f"proc_{uuid4().hex[:8]}"

    nodes: List[Dict[str, Any]] = list(normalized.get("nodes", []))
    for node in nodes:
        _normalize_node_type(node)
    normalized["nodes"] = nodes
    return normalized


def prepare_for_bpmn(engine: Dict[str, Any]) -> Dict[str, Any]:
    """Return a deep copy of *engine* ready for BPMN XML serialization."""
    prepared = copy.deepcopy(engine or {})
    for node in prepared.get("nodes", []):
        raw_type = node.get("type")
        mapped = (
            _SNAKE_TO_BPMN_TYPE.get(raw_type) if isinstance(raw_type, str) else None
        )
        if mapped:
            node["type"] = mapped
        elif isinstance(raw_type, str):
            parts = [part.capitalize() for part in raw_type.split("_") if part]
            if parts:
                node["type"] = parts[0] + "".join(parts[1:])
        if not node.get("name"):
            label = node.get("label")
            node["name"] = label or node.get("type") or "Task"
    return prepared


def _u_norm(text: str | None) -> str:
    return unicodedata.normalize("NFC", text or "")


def _apply_unicode_normalization(engine: Dict[str, Any]) -> Dict[str, Any]:
    for node in engine.get("nodes", []):
        if "label" in node:
            node["label"] = _u_norm(node["label"])
        if "name" in node:
            node["name"] = _u_norm(node["name"])
    for flow in engine.get("flows", []):
        if "label" in flow:
            flow["label"] = _u_norm(flow["label"])
        if "name" in flow:
            flow["name"] = _u_norm(flow["name"])
    return engine


def _tidy_labels(engine: Dict[str, Any]) -> Dict[str, Any]:
    replacements = {
        "schvÃ¡Äľ": "schváľ",
        "manaÅ¾Ã©rovi": "manažérovi",
        "faktÃºru": "faktúru",
        "ZlÃºÄŤ rozhodnutia": "Zlúč rozhodnutia",
        "objednÃ¡vka": "objednávka",
        "schvÃ¡lenÃ¡": "schválená",
    }
    for node in engine.get("nodes", []):
        name = node.get("name") or ""
        for broken, fixed in replacements.items():
            name = name.replace(broken, fixed)
        if node.get("type") == "exclusive_gateway":
            name_cf = name.casefold()
            if "suma" in name_cf and ">" in name:
                name = "Suma > 1000?"
            if "merge" in name_cf or "zlƭ��" in name_cf:
                name = "Zlƭ�� rozhodnutia"
        node["name"] = _u_norm(name)
    engine = align_gateway_lanes(engine)
    return _apply_unicode_normalization(engine)


def _wire_backoffice_after_merge(engine: Dict[str, Any]) -> Dict[str, Any]:
    nodes: List[Dict[str, Any]] = engine.get("nodes", [])
    flows: List[Dict[str, Any]] = engine.get("flows", [])
    lanes: List[Dict[str, Any]] = engine.get("lanes", [])

    incoming: Dict[str, List[str]] = {node["id"]: [] for node in nodes}
    outgoing: Dict[str, List[str]] = {node["id"]: [] for node in nodes}
    for flow in flows:
        incoming.setdefault(flow["target"], []).append(flow["id"])
        outgoing.setdefault(flow["source"], []).append(flow["id"])

    join = None
    for node in nodes:
        if (
            node.get("type") == "exclusive_gateway"
            and len(incoming.get(node["id"], [])) >= 2
        ):
            join = node
            break
    if not join:
        return engine

    lane_back = next(
        (
            lane["id"]
            for lane in lanes
            if (lane.get("name") or "").lower().startswith("back")
        ),
        None,
    )
    if not lane_back:
        return engine

    back_tasks = [
        node
        for node in nodes
        if node.get("type") == "task" and node.get("laneId") == lane_back
    ]
    if not back_tasks:
        return engine
    first_back = back_tasks[0]

    to_remove_nodes = [
        node
        for node in nodes
        if node.get("laneId") == lane_back
        and node.get("type") in {"start_event", "end_event"}
    ]
    to_remove_flow_ids = set()
    for node in to_remove_nodes:
        to_remove_flow_ids.update(outgoing.get(node["id"], []))
        to_remove_flow_ids.update(incoming.get(node["id"], []))

    nodes[:] = [node for node in nodes if node not in to_remove_nodes]
    flows[:] = [flow for flow in flows if flow["id"] not in to_remove_flow_ids]

    if not any(
        flow["source"] == join["id"] and flow["target"] == first_back["id"]
        for flow in flows
    ):
        flows.append(
            {
                "id": f"f_{join['id']}__{first_back['id']}",
                "source": join["id"],
                "target": first_back["id"],
                "laneId": lane_back,
            }
        )

    end_ids = {node["id"] for node in nodes if node.get("type") == "end_event"}
    flows[:] = [
        flow
        for flow in flows
        if not (flow["source"] == join["id"] and flow["target"] in end_ids)
    ]

    end_node = next((node for node in nodes if node.get("type") == "end_event"), None)
    if end_node is None:
        end_node = {
            "id": f"end_{first_back['id']}",
            "type": "end_event",
            "name": "End",
            "laneId": lane_back,
        }
        nodes.append(end_node)
    else:
        end_node["laneId"] = lane_back
        end_node.setdefault("name", "End")

    end_id = end_node["id"]
    flows[:] = [
        flow
        for flow in flows
        if not (flow["target"] == end_id and flow["source"] != first_back["id"])
    ]
    if not any(
        flow["source"] == first_back["id"] and flow["target"] == end_id
        for flow in flows
    ):
        flows.append(
            {
                "id": f"f_{first_back['id']}__{end_id}",
                "source": first_back["id"],
                "target": end_id,
                "laneId": lane_back,
            }
        )

    return engine


def _build_ix(
    engine_json: Dict[str, Any],
) -> tuple[Dict[str, Dict[str, Any]], Dict[str, List[str]], Dict[str, List[str]]]:
    by_id: Dict[str, Dict[str, Any]] = {
        str(node["id"]): node for node in engine_json["nodes"]
    }
    incoming: Dict[str, List[str]] = {
        str(node["id"]): [] for node in engine_json["nodes"]
    }
    outgoing: Dict[str, List[str]] = {
        str(node["id"]): [] for node in engine_json["nodes"]
    }
    for flow in engine_json["flows"]:
        source_id = str(flow["source"])
        target_id = str(flow["target"])
        outgoing[source_id].append(flow["id"])
        incoming[target_id].append(flow["id"])
    return by_id, incoming, outgoing


def _shorten_gateway_name(name: str) -> str:
    lowered = (name or "").lower()
    if "merge" in lowered or "zlƭ��" in lowered:
        return "Zlƭ�� rozhodnutia"
    if ">" in lowered or "v�ώ���" in lowered or "suma" in lowered:
        return "Suma > 1000?"
    return name or "Gateway"


def _postprocess_engine_json(engine_json: Dict[str, Any]) -> Dict[str, Any]:
    for node in engine_json["nodes"]:
        if node["type"] == "exclusive_gateway":
            node["name"] = _shorten_gateway_name(node.get("name", ""))
        if node["type"] == "task" and node.get("name"):
            node["name"] = (
                node["name"]
                .replace("schvÃ¡Äľ", "schváľ")
                .replace("manaÅ¾Ã©rovi", "manažérovi")
                .replace("faktÃºru", "faktúru")
                .replace("je suma >", "schváľ ponuku")
            )

    by_id, incoming, outgoing = _build_ix(engine_json)

    starts = [node for node in engine_json["nodes"] if node["type"] == "start_event"]
    ends = [node for node in engine_json["nodes"] if node["type"] == "end_event"]
    if len(starts) > 1 and len(ends) > 1:
        for start in starts[1:]:
            out_ids = list(outgoing.get(start["id"], []))
            engine_json["flows"] = [
                flow for flow in engine_json["flows"] if flow["id"] not in out_ids
            ]
            engine_json["nodes"] = [
                node for node in engine_json["nodes"] if node["id"] != start["id"]
            ]

        for end in ends[1:]:
            in_ids = set(incoming.get(end["id"], []))
            engine_json["flows"] = [
                flow for flow in engine_json["flows"] if flow["id"] not in in_ids
            ]
            engine_json["nodes"] = [
                node for node in engine_json["nodes"] if node["id"] != end["id"]
            ]

        by_id, incoming, outgoing = _build_ix(engine_json)

        joins = [
            node
            for node in engine_json["nodes"]
            if node["type"] == "exclusive_gateway"
            and len(incoming.get(node["id"], [])) >= 2
        ]
        join = joins[0] if joins else None

        lane_back = next(
            (
                lane["id"]
                for lane in engine_json["lanes"]
                if lane["name"].lower().startswith("backoffice")
            ),
            None,
        )
        back_tasks = [
            node
            for node in engine_json["nodes"]
            if node["type"] == "task" and node["laneId"] == lane_back
        ]
        first_back = None
        for task in back_tasks:
            inc = incoming.get(task["id"], [])
            if not inc or any(
                by_id[flow["source"]]["type"] == "start_event"
                for flow in engine_json["flows"]
                if flow["id"] in inc
            ):
                first_back = task
                break

        if join and first_back:
            engine_json["flows"] = [
                flow
                for flow in engine_json["flows"]
                if not (
                    flow["target"] == first_back["id"]
                    and by_id[flow["source"]]["type"] == "start_event"
                )
            ]

            new_id = f"f_fix_{join['id']}__{first_back['id']}"
            engine_json["flows"].append(
                {
                    "id": new_id,
                    "source": join["id"],
                    "target": first_back["id"],
                    "laneId": lane_back,
                }
            )

    return engine_json


def postprocess_engine_json(
    engine: Dict[str, Any], *, locale: str = "sk"
) -> Dict[str, Any]:
    """Apply label cleanup and structural post-processing prior to layout."""
    staged = _tidy_labels(copy.deepcopy(engine or {}))
    staged = tidy_yes_no_gateway(staged, locale=locale)
    staged = tidy_then_task_prefix(staged)
    staged = tidy_join_gateway_names(staged, locale=locale)
    staged = align_gateway_lanes(staged)
    staged = _wire_backoffice_after_merge(staged)
    return _postprocess_engine_json(staged)
