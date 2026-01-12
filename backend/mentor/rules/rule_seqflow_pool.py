from __future__ import annotations

from typing import Any, Dict, List

from .common import make_finding

RULE_ID = "seqflow_no_cross_pool"
SEVERITY = "HARD"


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    for flow_id, flow in index.flows_by_id.items():
        flow_type = index.flow_type_token.get(flow_id, "sequenceflow")
        if flow_type != "sequenceflow":
            continue
        src = str(flow.get("source") or "")
        tgt = str(flow.get("target") or "")
        if not src or not tgt:
            continue
        src_pool = index.node_pool_id.get(src)
        tgt_pool = index.node_pool_id.get(tgt)
        if not src_pool or not tgt_pool:
            continue
        if src_pool == tgt_pool:
            continue
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=flow_id,
                target_type="sequenceFlow",
                message="Sequence flow prechadza hranicu poolu.",
                proposal="Presun uzly do rovnakeho poolu alebo pouzi message flow.",
                confidence=0.9,
                risk="model_invalid",
            )
        )
    return findings
