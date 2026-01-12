from __future__ import annotations

from typing import Any, Dict, List

from .common import is_gateway_token, make_finding

RULE_ID = "gateway_is_redundant"
SEVERITY = "SOFT"


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    for node_id in index.nodes_by_id:
        token = index.node_type_token.get(node_id, "")
        if not is_gateway_token(token):
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
        if len(incoming_seq) != 1 or len(outgoing_seq) != 1:
            continue
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=node_id,
                target_type="gateway",
                message="Gateway je pravdepodobne zbytocny (nema rozdelenie ani zlucenie toku).",
                proposal="Zvaz odstranenie gateway a priame prepojenie aktivit.",
                confidence=0.75,
                risk="cosmetic",
            )
        )
    return findings
