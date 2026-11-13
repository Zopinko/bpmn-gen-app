from __future__ import annotations

import collections
from typing import Any, Dict, List


def gateway_degrees(nodes: List[Dict[str, Any]], flows: List[Dict[str, Any]]):
    indeg: collections.Counter[str] = collections.Counter()
    outdeg: collections.Counter[str] = collections.Counter()
    for flow in flows:
        src = flow.get("source")
        tgt = flow.get("target")
        if src:
            outdeg[src] += 1
        if tgt:
            indeg[tgt] += 1
    return indeg, outdeg


def find_gateway_warnings(
    nodes: List[Dict[str, Any]], flows: List[Dict[str, Any]]
) -> List[str]:
    indeg, outdeg = gateway_degrees(nodes, flows)
    warnings: List[str] = []
    for node in nodes:
        node_type = node.get("type")
        if node_type in {
            "gateway",
            "exclusiveGateway",
            "inclusiveGateway",
            "parallelGateway",
        }:
            node_id = node.get("id")
            if not node_id:
                warnings.append(
                    f"Gateway-like node missing id key (name='{node.get('name', '')}', type='{node_type}')"
                )
                continue
            inbound = indeg[node_id]
            outbound = outdeg[node_id]
            if inbound < 1 or outbound < 1:
                warnings.append(
                    f"Gateway {node_id} ('{node.get('name', '')}') has indeg={inbound}, outdeg={outbound}"
                )
    return warnings
