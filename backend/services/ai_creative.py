from __future__ import annotations

import copy
import time
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional

from core.settings import get_settings
from services.bpmn_svc import json_to_bpmn
from services.controller.validate import validate as controller_validate
from services.creative_providers import get_provider


@dataclass
class CreativeResult:
    engine_json: Optional[Dict[str, Any]]
    bpmn_xml: Optional[str]
    issues: List[Dict[str, Any]]
    meta: Dict[str, Any]


def _sentences(text: str) -> List[str]:
    cleaned = text.replace("\r\n", " ").replace("\n", " ")
    parts = [segment.strip() for segment in cleaned.split(".")]
    return [p for p in parts if p]


def _build_stub_engine(
    text: str, max_nodes: int
) -> tuple[Dict[str, Any], List[Dict[str, Any]]]:
    sentences = _sentences(text)
    issues: List[Dict[str, Any]] = []

    if not sentences:
        sentences = ["Empty input"]
        issues.append(
            {
                "code": "EMPTY_TEXT",
                "message": "Input text was empty, creative stub added a placeholder.",
                "severity": "warning",
            }
        )

    lane_id = "Main"
    nodes: List[Dict[str, Any]] = [
        {
            "id": "StartEvent_1",
            "type": "start_event",
            "name": "Start",
            "laneId": lane_id,
        },
    ]
    flows: List[Dict[str, Any]] = []

    previous = "StartEvent_1"
    node_count = 1

    for idx, sentence in enumerate(sentences, start=1):
        task_id = f"Task_{idx:03d}"
        nodes.append(
            {
                "id": task_id,
                "type": "task",
                "name": sentence[:80] or "Activity",
                "laneId": lane_id,
            }
        )
        flows.append(
            {"id": f"Flow_{previous}_{task_id}", "source": previous, "target": task_id}
        )
        previous = task_id
        node_count += 1

    end_id = "EndEvent_1"
    nodes.append({"id": end_id, "type": "end_event", "name": "End", "laneId": lane_id})
    flows.append(
        {"id": f"Flow_{previous}_{end_id}", "source": previous, "target": end_id}
    )
    node_count += 1

    if node_count > max_nodes:
        issues.append(
            {
                "code": "OVER_MAX_NODES",
                "message": f"Creative stub produced {node_count} nodes, limit is {max_nodes}.",
                "severity": "error",
            }
        )

    engine = {
        "lanes": [{"id": lane_id, "name": lane_id}],
        "nodes": nodes,
        "flows": flows,
    }

    return engine, issues


def _ensure_lane(node: Dict[str, Any], lanes: Dict[str, Dict[str, str]]):
    lane = node.get("laneId")
    if lane:
        lanes.setdefault(lane, {"id": lane, "name": lane})
        return
    name = node.get("name") or ""
    if ":" in name:
        prefix = name.split(":", 1)[0].strip()
        if prefix:
            lane = prefix
            node["laneId"] = lane
            lanes.setdefault(lane, {"id": lane, "name": lane})


def _generate_id(prefix: str, existing: set[str], counter: int) -> str:
    candidate = f"{prefix}_{counter:03d}"
    while candidate in existing:
        counter += 1
        candidate = f"{prefix}_{counter:03d}"
    existing.add(candidate)
    return candidate


def _normalize_engine(
    engine: Dict[str, Any], max_nodes: int
) -> tuple[Dict[str, Any], List[Dict[str, Any]]]:
    normalized = copy.deepcopy(engine or {})
    nodes = list(normalized.get("nodes") or [])
    flows = list(normalized.get("flows") or [])
    lanes_list = list(normalized.get("lanes") or [])

    lane_map = {
        lane.get("id") or lane.get("name"): lane
        for lane in lanes_list
        if isinstance(lane, dict)
    }
    node_ids = set()
    id_counter = 1

    for node in nodes:
        node_id = node.get("id")
        if not node_id:
            node_id = _generate_id("Node", node_ids, id_counter)
            node["id"] = node_id
            id_counter += 1
        node_ids.add(node_id)
        node_type = (node.get("type") or "task").lower()
        node["type"] = node_type
        node_name = node.get("name")
        if node_name:
            node["name"] = node_name[:48]
        _ensure_lane(node, lane_map)

    if not nodes:
        stub_engine, stub_issues = _build_stub_engine(
            "Generated empty process", max_nodes
        )
        return stub_engine, stub_issues

    start_count = sum(1 for node in nodes if "start" in (node.get("type") or ""))
    end_count = sum(1 for node in nodes if "end" in (node.get("type") or ""))
    issues: List[Dict[str, Any]] = []

    if start_count == 0:
        new_id = _generate_id("StartEvent", node_ids, id_counter)
        nodes.insert(
            0, {"id": new_id, "type": "start_event", "name": "Start", "laneId": "Main"}
        )
        lane_map.setdefault("Main", {"id": "Main", "name": "Main"})
        id_counter += 1
    if end_count == 0:
        new_id = _generate_id("EndEvent", node_ids, id_counter)
        nodes.append(
            {"id": new_id, "type": "end_event", "name": "End", "laneId": "Main"}
        )
        lane_map.setdefault("Main", {"id": "Main", "name": "Main"})
        id_counter += 1
        issues.append(
            {
                "code": "MISSING_END_EVENT",
                "message": "End event was missing; added automatically.",
                "severity": "warning",
            }
        )

    flow_ids = {flow.get("id") for flow in flows if flow.get("id")}
    flow_counter = 1
    # ensure flows have ids
    for flow in flows:
        if not flow.get("id"):
            new_id = _generate_id("Flow", flow_ids, flow_counter)
            flow["id"] = new_id
            flow_counter += 1

    existing_nodes = {node["id"] for node in nodes}
    referenced = set()
    for flow in flows:
        src = flow.get("source")
        tgt = flow.get("target")
        if src in existing_nodes:
            referenced.add(src)
        if tgt in existing_nodes:
            referenced.add(tgt)

    # connect isolated nodes linearly
    last_node_id = None
    if flows:
        last_node_id = flows[-1].get("target")
    for node in nodes:
        node_id = node["id"]
        if node_id not in referenced and node.get("type") != "start_event":
            if last_node_id and last_node_id != node_id:
                new_id = _generate_id("Flow", flow_ids, flow_counter)
                flows.append({"id": new_id, "source": last_node_id, "target": node_id})
                flow_counter += 1
            issues.append(
                {
                    "code": "ORPHAN_NODE",
                    "message": f"Node {node_id} was orphaned; auto-connected.",
                    "severity": "warning",
                }
            )
        last_node_id = node_id

    for node in nodes:
        node_type = (node.get("type") or "").lower()
        if "gateway" in node_type and not (node.get("name") or "").strip():
            issues.append(
                {
                    "code": "UNLABELED_GATEWAY",
                    "message": f"Gateway {node['id']} is missing a label.",
                    "severity": "warning",
                }
            )

    if len(nodes) > max_nodes:
        issues.append(
            {
                "code": "OVER_MAX_NODES",
                "message": f"Creative result produced {len(nodes)} nodes, limit is {max_nodes}.",
                "severity": "error",
            }
        )

    normalized["nodes"] = nodes
    normalized["flows"] = flows
    normalized["lanes"] = list(lane_map.values())

    return normalized, issues


class AICreativeService:
    def __init__(self) -> None:
        self.settings = get_settings().ai_creative
        self.provider = get_provider(self.settings, _build_stub_engine)

    def generate(
        self, text: str, language: str, options: Dict[str, Any]
    ) -> CreativeResult:
        max_nodes = int(options.get("max_nodes") or self.settings.max_nodes)
        strict_bpmn = bool(options.get("strict_bpmn", False))
        return_xml = bool(options.get("return_xml", True))
        output_mode = self.settings.output or "auto"

        started = time.perf_counter()
        provider_result = self.provider.generate(text, language, max_nodes, output_mode)
        provider_meta = dict(provider_result.get("meta", {}))
        provider_meta.setdefault("provider", self.settings.provider)
        provider_meta.setdefault("model", self.settings.model)
        provider_meta.setdefault(
            "mode", "json" if provider_result.get("engine_json") else "xml"
        )
        provider_meta.setdefault(
            "duration_ms", int((time.perf_counter() - started) * 1000)
        )

        raw_issues = provider_result.get("issues") or []
        issues: List[Dict[str, Any]] = [
            issue for issue in raw_issues if isinstance(issue, dict)
        ]

        engine_json = provider_result.get("engine_json")

        if engine_json:
            engine_json, normalize_issues = _normalize_engine(engine_json, max_nodes)
            issues.extend(normalize_issues)
            controller_issues = controller_validate(engine_json)
            issues.extend(asdict(issue) for issue in controller_issues)
            provider_meta["node_count"] = len(engine_json.get("nodes", []))
        else:
            engine_json = None

        if provider_meta.get("node_count") is None and engine_json:
            provider_meta["node_count"] = len(engine_json.get("nodes", []))

        if strict_bpmn and any(issue.get("severity") == "error" for issue in issues):
            provider_meta["strict_bpmn_failed"] = True

        bpmn_xml = provider_result.get("bpmn_xml")

        if return_xml and engine_json and not bpmn_xml:
            bpmn_xml = json_to_bpmn(
                {"name": "AI Creative", **engine_json, "locale": language or "auto"}
            )

        return CreativeResult(
            engine_json=engine_json,
            bpmn_xml=bpmn_xml,
            issues=issues,
            meta=provider_meta,
        )

    def status(self) -> Dict[str, Any]:
        health = getattr(self.provider, "health", None)
        if callable(health):
            result = health()
            if isinstance(result, dict):
                result.setdefault("provider", self.settings.provider)
                result.setdefault("model", self.settings.model)
                result.setdefault("details", {})
                result.setdefault("api_key_present", False)
                result.setdefault("duration_ms", 0)
                result.setdefault("ok", True)
                return result
        return {
            "ok": False,
            "provider": self.settings.provider,
            "model": self.settings.model,
            "api_key_present": False,
            "error": "health_not_supported",
            "details": {},
            "duration_ms": 0,
        }

    def fallback_stub(self, text: str, language: str, max_nodes: int) -> CreativeResult:
        engine, issues = _build_stub_engine(text, max_nodes)
        controller_issues = controller_validate(engine)
        issues.extend(asdict(issue) for issue in controller_issues)
        meta = {
            "provider": "stub",
            "mode": "json",
            "node_count": len(engine.get("nodes", [])),
        }
        return CreativeResult(
            engine_json=engine, bpmn_xml=None, issues=issues, meta=meta
        )
