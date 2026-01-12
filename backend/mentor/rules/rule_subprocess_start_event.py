from __future__ import annotations

from typing import Any, Dict, List

from .common import make_finding

RULE_ID = "subprocess_start_event_none"
SEVERITY = "HARD"


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    for node_id, node in index.nodes_by_id.items():
        token = index.node_type_token.get(node_id, "")
        if token != "startevent":
            continue
        if not index.node_subprocess_id.get(node_id):
            continue
        event_def = node.get("eventDefinition") or node.get("event_definition")
        if event_def:
            findings.append(
                make_finding(
                    rule_id=RULE_ID,
                    severity=SEVERITY,
                    target_id=node_id,
                    target_type="event",
                    message="Start event v subprocess musi byt NONE.",
                    proposal="Odstran eventDefinition zo start eventu v subprocess.",
                    confidence=0.9,
                    risk="model_invalid",
                )
            )
    return findings
