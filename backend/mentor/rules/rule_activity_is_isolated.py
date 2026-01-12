from __future__ import annotations

from typing import Any, Dict, List

from .common import is_activity_token, make_finding, target_type_for_node

RULE_ID = "activity_is_isolated"
SEVERITY = "SOFT"


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    for node_id, node in index.nodes_by_id.items():
        token = index.node_type_token.get(node_id, "")
        if not is_activity_token(token):
            continue
        incoming_seq = [
            flow_id
            for flow_id in index.incoming.get(node_id, [])
            if index.flow_type_token.get(flow_id, "sequenceflow") == "sequenceflow"
        ]
        outgoing_seq = [
            flow_id
            for flow_id in index.outgoing.get(node_id, [])
            if index.flow_type_token.get(flow_id, "sequenceflow") == "sequenceflow"
        ]
        if incoming_seq or outgoing_seq:
            continue
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=node_id,
                target_type=target_type_for_node(token),
                message="Aktivita nie je napojena na proces.",
                proposal="Pripoj aktivitu pomocou sequence flow alebo ju odstran.",
                confidence=0.8,
                risk="semantic_change",
            )
        )
    return findings
