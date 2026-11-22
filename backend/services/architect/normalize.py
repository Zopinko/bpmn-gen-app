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
    if not node_type:
        return
    if node_type in _ALIAS_MAP:
        node["type"] = _ALIAS_MAP[node_type]
        return
    lower = node_type.lower()
    if lower in _ALIAS_MAP:
        node["type"] = _ALIAS_MAP[lower]
        return
    node["type"] = node_type


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
        node["name"] = _u_norm(name)
    engine = align_gateway_lanes(engine)
    return _apply_unicode_normalization(engine)


def _shorten_gateway_name(name: str) -> str:
    # Keep the user's condition text; never substitute domain-specific constants.
    return (name or "").strip() or "Gateway"


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
            )

    # Drop orphan flows (e.g. stale client state) whose endpoints no longer exist.
    node_ids = {str(node.get("id")) for node in engine_json["nodes"]}
    engine_json["flows"] = [
        flow
        for flow in engine_json["flows"]
        if str(flow.get("source") or "") in node_ids and str(flow.get("target") or "") in node_ids
    ]
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
    return _postprocess_engine_json(staged)
