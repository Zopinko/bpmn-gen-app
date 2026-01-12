from __future__ import annotations

from typing import Any, Dict, List

from .common import is_gateway_token, make_finding

RULE_ID = "gateway_requires_incoming"
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
        if incoming_seq:
            continue
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=node_id,
                target_type="gateway",
                message="Gateway nema ziadny vstupny tok.",
                proposal="Pripoj gateway na predchadzajucu aktivitu alebo udalost pomocou sequence flow.",
                confidence=0.85,
                risk="semantic_change",
            )
        )
    return findings
