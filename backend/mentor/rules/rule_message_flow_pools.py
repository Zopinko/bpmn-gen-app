from __future__ import annotations

from typing import Any, Dict, List

from .common import make_finding

RULE_ID = "message_flow_between_pools"
SEVERITY = "HARD"


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    for flow_id, flow in index.flows_by_id.items():
        flow_type = index.flow_type_token.get(flow_id, "sequenceflow")
        if flow_type != "messageflow":
            continue
        src = str(flow.get("source") or "")
        tgt = str(flow.get("target") or "")
        if not src or not tgt:
            continue
        src_pool = index.node_pool_id.get(src)
        tgt_pool = index.node_pool_id.get(tgt)
        if not src_pool or not tgt_pool:
            continue
        if src_pool != tgt_pool:
            continue
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=flow_id,
                target_type="messageFlow",
                message="Message flow je pouzity v jednom poole.",
                proposal="Pouzi sequence flow v jednom poole alebo prepoj rozdielne pooly.",
                confidence=0.9,
                risk="model_invalid",
            )
        )
    return findings
