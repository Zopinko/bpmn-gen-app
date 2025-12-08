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
            inbound = indeg[node["id"]]
            outbound = outdeg[node["id"]]
            if inbound < 1 or outbound < 1:
                warnings.append(
                    f"Gateway {node['id']} ('{node.get('name', '')}') has indeg={inbound}, outdeg={outbound}"
                )
    return warnings
