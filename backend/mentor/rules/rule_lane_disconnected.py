from __future__ import annotations

from collections import defaultdict, deque
from typing import Any, Dict, List, Set

from .common import make_finding

RULE_ID = "lane_is_disconnected"
SEVERITY = "SOFT"


def _is_sequence_flow(flow: Dict[str, Any]) -> bool:
    ftype = (flow.get("type") or flow.get("flowType") or "sequenceFlow").strip().lower()
    return ftype in {"sequenceflow", "sequence_flow"}


def _is_start_event(node: Dict[str, Any]) -> bool:
    ntype = (node.get("type") or "").strip().lower()
    return "start" in ntype and "event" in ntype


def _build_components(nodes: List[Dict[str, Any]], flows: List[Dict[str, Any]]) -> List[Set[str]]:
    nodes_by_id = {str(node.get("id")): node for node in nodes if node.get("id")}
    neighbors: Dict[str, Set[str]] = defaultdict(set)
    for flow in flows:
        if not _is_sequence_flow(flow):
            continue
        src = str(flow.get("source") or flow.get("sourceRef") or flow.get("sourceId") or "")
        tgt = str(flow.get("target") or flow.get("targetRef") or flow.get("targetId") or "")
        if not src or not tgt:
            continue
        if src not in nodes_by_id or tgt not in nodes_by_id:
            continue
        neighbors[src].add(tgt)
        neighbors[tgt].add(src)

    visited: Set[str] = set()
    components: List[Set[str]] = []
    for node_id in nodes_by_id:
        if node_id in visited:
            continue
        comp: Set[str] = set()
        queue = deque([node_id])
        visited.add(node_id)
        while queue:
            cur = queue.popleft()
            comp.add(cur)
            for nxt in neighbors.get(cur, set()):
                if nxt in visited:
                    continue
                visited.add(nxt)
                queue.append(nxt)
        components.append(comp)
    return components


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    nodes = index.nodes or []
    flows = index.flows or []
    if not nodes:
        return findings

    components = _build_components(nodes, flows)
    if len(components) <= 1:
        return findings

    nodes_by_id = {str(node.get("id")): node for node in nodes if node.get("id")}
    start_nodes = [node for node in nodes if _is_start_event(node)]
    primary_component: Set[str] | None = None
    for node in start_nodes:
        nid = str(node.get("id") or "")
        if not nid:
            continue
        for comp in components:
            if nid in comp:
                primary_component = comp
                break
        if primary_component:
            break
    if primary_component is None:
        primary_component = max(components, key=len)

    nodes_by_lane: Dict[str, List[str]] = defaultdict(list)
    for node_id in nodes_by_id:
        lane_id = str(index.node_lane_id.get(node_id, "") or "")
        if not lane_id:
            continue
        nodes_by_lane[lane_id].append(node_id)

    for lane_id, lane_nodes in nodes_by_lane.items():
        if not lane_nodes:
            continue
        if any(node_id in primary_component for node_id in lane_nodes):
            continue
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=lane_id,
                target_type="lane",
                message="Lane nie je prepojena so zvyskom procesu.",
                proposal="Prepoj kroky v tejto lane na hlavny tok (sequence flow).",
                confidence=0.6,
                risk="model_invalid",
            )
        )

    return findings
