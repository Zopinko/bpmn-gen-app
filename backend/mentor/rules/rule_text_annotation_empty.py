from __future__ import annotations

from typing import Any, Dict, List

from .common import make_finding

RULE_ID = "text_annotation_empty"
SEVERITY = "SOFT"


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    for node_id, node in index.nodes_by_id.items():
        token = index.node_type_token.get(node_id, "")
        meta = node.get("meta") or {}
        raw_type = str(node.get("type") or "")
        is_annotation = (
            token.endswith("textannotation")
            or "textannotation" in token
            or "textAnnotation" in raw_type
            or meta.get("note") == "textAnnotation"
        )
        if not is_annotation:
            continue
        text = (node.get("text") or node.get("name") or node.get("label") or "").strip()
        if text:
            continue
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=node_id,
                target_type="unknown",
                message="Text annotation je prazdna.",
                proposal="Ak text annotation nepotrebujes, zmaz ju.",
                confidence=0.55,
                risk="cosmetic",
            )
        )
    return findings
