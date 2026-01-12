from __future__ import annotations

from typing import Any, Dict, List

from .common import is_boundary_event, make_finding

RULE_ID = "boundary_event_max_one_outgoing"
SEVERITY = "HARD"


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    for node_id, node in index.nodes_by_id.items():
        token = index.node_type_token.get(node_id, "")
        if not is_boundary_event(node, token):
            continue
        outgoing = index.outgoing.get(node_id, [])
        seq_outgoing = [
            flow_id
            for flow_id in outgoing
            if index.flow_type_token.get(flow_id, "sequenceflow") == "sequenceflow"
        ]
        if len(seq_outgoing) <= 1:
            continue
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=node_id,
                target_type="event",
                message="Boundary event ma viac ako jeden outgoing sequence flow.",
                proposal="Ponechaj len jeden outgoing sequence flow z boundary eventu.",
                confidence=0.9,
                risk="model_invalid",
            )
        )
    return findings
