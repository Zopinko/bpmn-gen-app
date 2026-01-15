from __future__ import annotations

from typing import Any, Dict, List

from .common import make_finding

RULE_ID = "lane_missing_name"
SEVERITY = "HARD"


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    for lane in index.lanes:
        lane_id = str(lane.get("id") or "")
        if not lane_id:
            continue
        lane_name = str(lane.get("name") or "").strip()
        if not lane_name:
            missing = True
        else:
            same_as_id = lane_name == lane_id
            looks_default = lane_id.lower().startswith("lane_") and same_as_id
            missing = looks_default
        if not missing:
            continue
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=lane_id,
                target_type="lane",
                message="Lane nema nazov.",
                proposal="Dopln nazov lane, aby bolo jasne, kto vykonava kroky.",
                confidence=0.8,
                risk="semantic_change",
            )
        )
    return findings
