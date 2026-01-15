from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List

from .common import make_finding

RULE_ID = "rightmost_not_end_event"
SEVERITY = "INFO"


def _normalize(value: Any) -> str:
    return "".join(ch for ch in str(value or "").strip().lower() if ch.isalnum())


def _is_end_event(node: Dict[str, Any]) -> bool:
    ntype = _normalize(node.get("type"))
    return ntype in {"endevent", "end_event"} or ntype.endswith("endevent")


def _compute_levels(nodes: List[Dict[str, Any]], flows: List[Dict[str, Any]]) -> Dict[str, int]:
    nodes_by_id = {str(node.get("id")): node for node in nodes if node.get("id")}
    incoming = defaultdict(list)
    outgoing = defaultdict(list)
    indegree = {node_id: 0 for node_id in nodes_by_id}

    for flow in flows:
        src = str(flow.get("source") or flow.get("sourceRef") or flow.get("sourceId") or "")
        tgt = str(flow.get("target") or flow.get("targetRef") or flow.get("targetId") or "")
        if not src or not tgt:
            continue
        if src not in nodes_by_id or tgt not in nodes_by_id:
            continue
        outgoing[src].append(tgt)
        incoming[tgt].append(src)
        indegree[tgt] += 1

    levels = {node_id: 0 for node_id in nodes_by_id}
    queue = [node_id for node_id, deg in indegree.items() if deg == 0]

    processed = set()
    while queue:
        node_id = queue.pop(0)
        if node_id in processed:
            continue
        processed.add(node_id)
        base_level = levels[node_id]
        step = 1
        for tgt in outgoing.get(node_id, []):
            candidate = base_level + step
            if candidate > levels[tgt]:
                levels[tgt] = candidate
            indegree[tgt] -= 1
            if indegree[tgt] == 0:
                queue.append(tgt)

    # handle cycles or disconnected nodes
    if len(processed) < len(nodes_by_id):
        max_level = max(levels.values(), default=0)
        for node_id in nodes_by_id:
            if node_id not in processed:
                max_level += 1
                levels[node_id] = max_level

    return levels


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    nodes = index.nodes or []
    flows = index.flows or []
    if not nodes:
        return findings

    levels = _compute_levels(nodes, flows)
    if not levels:
        return findings

    max_level = max(levels.values(), default=0)
    rightmost_nodes = [node for node in nodes if levels.get(str(node.get("id")), 0) == max_level]
    if not rightmost_nodes:
        return findings

    if any(_is_end_event(node) for node in rightmost_nodes):
        return findings

    target_node = rightmost_nodes[0]
    target_id = str(target_node.get("id") or "unknown")
    findings.append(
        make_finding(
            rule_id=RULE_ID,
            severity=SEVERITY,
            target_id=target_id,
            target_type="event",
            message="Najpravejsi objekt nie je end event.",
            proposal="Skontroluj ukoncenie procesu. End event by mal byt na konci toku.",
            confidence=0.55,
            risk="cosmetic",
        )
    )
    return findings
