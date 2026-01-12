from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

from .models import MentorFinding
from .rules import RULES


def _tokenize(value: str) -> str:
    return "".join(ch for ch in value.lower().strip() if ch.isalnum())


def _normalize_node_type(raw_type: Any) -> str:
    if raw_type is None:
        return ""
    return _tokenize(str(raw_type))


def _normalize_flow_type(raw_type: Any) -> str:
    if raw_type is None:
        return "sequenceflow"
    return _tokenize(str(raw_type))


def _pick_first(mapping: Dict[str, Any], keys: Iterable[str]) -> Optional[Any]:
    for key in keys:
        if key in mapping:
            value = mapping.get(key)
            if value is not None:
                return value
    return None


@dataclass
class MentorIndex:
    nodes: List[Dict[str, Any]]
    flows: List[Dict[str, Any]]
    lanes: List[Dict[str, Any]]
    nodes_by_id: Dict[str, Dict[str, Any]]
    flows_by_id: Dict[str, Dict[str, Any]]
    incoming: Dict[str, List[str]]
    outgoing: Dict[str, List[str]]
    node_lane_id: Dict[str, str]
    lane_pool_id: Dict[str, str]
    node_pool_id: Dict[str, str]
    node_subprocess_id: Dict[str, Optional[str]]
    node_type_token: Dict[str, str]
    flow_type_token: Dict[str, str]


def build_index(engine_json: Dict[str, Any]) -> MentorIndex:
    nodes = list(engine_json.get("nodes") or [])
    flows = list(engine_json.get("flows") or [])
    lanes = list(engine_json.get("lanes") or [])

    nodes_by_id: Dict[str, Dict[str, Any]] = {}
    flows_by_id: Dict[str, Dict[str, Any]] = {}
    incoming: Dict[str, List[str]] = {}
    outgoing: Dict[str, List[str]] = {}
    node_lane_id: Dict[str, str] = {}
    node_type_token: Dict[str, str] = {}
    flow_type_token: Dict[str, str] = {}

    for node in nodes:
        node_id = str(node.get("id") or "")
        if not node_id:
            continue
        nodes_by_id[node_id] = node
        incoming.setdefault(node_id, [])
        outgoing.setdefault(node_id, [])
        lane_id = str(node.get("laneId") or "")
        if lane_id:
            node_lane_id[node_id] = lane_id
        node_type_token[node_id] = _normalize_node_type(node.get("type"))

    for flow in flows:
        flow_id = str(flow.get("id") or "")
        if not flow_id:
            continue
        flows_by_id[flow_id] = flow
        src = str(flow.get("source") or "")
        tgt = str(flow.get("target") or "")
        if src:
            outgoing.setdefault(src, []).append(flow_id)
        if tgt:
            incoming.setdefault(tgt, []).append(flow_id)
        flow_type_token[flow_id] = _normalize_flow_type(
            flow.get("type") or flow.get("flowType")
        )

    default_pool_id = str(engine_json.get("defaultPoolId") or engine_json.get("processId") or "pool_default")
    lane_pool_id: Dict[str, str] = {}
    for lane in lanes:
        lane_id = str(lane.get("id") or "")
        if not lane_id:
            continue
        pool_id = _pick_first(
            lane,
            [
                "poolId",
                "pool_id",
                "parentPoolId",
                "parent_pool_id",
                "participantId",
            ],
        )
        lane_pool_id[lane_id] = str(pool_id) if pool_id is not None else default_pool_id

    node_pool_id: Dict[str, str] = {}
    for node_id, node in nodes_by_id.items():
        pool_id = _pick_first(
            node,
            [
                "poolId",
                "pool_id",
                "participantId",
            ],
        )
        if pool_id is None:
            lane_id = node_lane_id.get(node_id)
            pool_id = lane_pool_id.get(lane_id or "", default_pool_id)
        node_pool_id[node_id] = str(pool_id)

    node_subprocess_id: Dict[str, Optional[str]] = {}
    for node_id, node in nodes_by_id.items():
        candidate = _pick_first(
            node,
            [
                "subProcessId",
                "subprocessId",
                "sub_process_id",
                "parentId",
                "parent_id",
            ],
        )
        candidate_id = str(candidate) if candidate else None
        if candidate_id and candidate_id in nodes_by_id:
            parent_type = _normalize_node_type(nodes_by_id[candidate_id].get("type"))
            if parent_type != "subprocess":
                candidate_id = None
        node_subprocess_id[node_id] = candidate_id

    return MentorIndex(
        nodes=nodes,
        flows=flows,
        lanes=lanes,
        nodes_by_id=nodes_by_id,
        flows_by_id=flows_by_id,
        incoming=incoming,
        outgoing=outgoing,
        node_lane_id=node_lane_id,
        lane_pool_id=lane_pool_id,
        node_pool_id=node_pool_id,
        node_subprocess_id=node_subprocess_id,
        node_type_token=node_type_token,
        flow_type_token=flow_type_token,
    )


def run_rules(engine_json: Dict[str, Any]) -> List[MentorFinding]:
    index = build_index(engine_json)
    findings: List[MentorFinding] = []
    for rule in RULES:
        findings.extend(rule(engine_json, index))
    return findings
