from __future__ import annotations

from typing import Any, Dict, List

from .common import is_gateway_token, make_finding

RULE_ID = "gateway_diverging_min_two_outgoing"
SEVERITY = "HARD"


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    for node_id in index.nodes_by_id:
        token = index.node_type_token.get(node_id, "")
        if not is_gateway_token(token):
            continue
        incoming = [
            flow_id
            for flow_id in index.incoming.get(node_id, [])
            if index.flow_type_token.get(flow_id, "sequenceflow") == "sequenceflow"
        ]
        outgoing = [
            flow_id
            for flow_id in index.outgoing.get(node_id, [])
            if index.flow_type_token.get(flow_id, "sequenceflow") == "sequenceflow"
        ]
        if len(outgoing) >= 2:
            continue
        if len(incoming) >= 2:
            continue
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=node_id,
                target_type="gateway",
                message="Diverging gateway musi mat aspon dve outgoing vetvy.",
                proposal="Pridaj dalsiu outgoing vetvu alebo odstran gateway.",
                confidence=0.9,
                risk="model_invalid",
            )
        )
    return findings
