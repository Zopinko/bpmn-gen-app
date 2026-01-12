from __future__ import annotations

from typing import Any, Dict, List

from .common import is_activity_token, make_finding, target_type_for_node

RULE_ID = "activity_requires_name"
SEVERITY = "SOFT"


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    for node_id, node in index.nodes_by_id.items():
        token = index.node_type_token.get(node_id, "")
        if not is_activity_token(token):
            continue
        name = (node.get("name") or "").strip()
        if name and name != node_id:
            continue
        default_name = "Nepomenovany subprocess" if token == "subprocess" else "Nepomenovana aktivita"
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=node_id,
                target_type=target_type_for_node(token),
                message="Aktivita nema nazov.",
                proposal="Dopln jasny nazov aktivity.",
                confidence=0.7,
                risk="cosmetic",
                autofix=True,
                fix_payload={
                    "action": "set_node_name",
                    "nodeId": node_id,
                    "value": default_name,
                },
            )
        )
    return findings
