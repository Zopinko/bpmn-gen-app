from __future__ import annotations

from typing import Any, Dict, List

from .common import make_finding

RULE_ID = "lane_is_empty"
SEVERITY = "SOFT"


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    nodes_by_lane: Dict[str, int] = {}
    for node_id, lane_id in index.node_lane_id.items():
        if not lane_id:
            continue
        nodes_by_lane[lane_id] = nodes_by_lane.get(lane_id, 0) + 1

    for lane in index.lanes:
        lane_id = str(lane.get("id") or "")
        if not lane_id:
            continue
        if nodes_by_lane.get(lane_id, 0) > 0:
            continue
        findings.append(
            make_finding(
                rule_id=RULE_ID,
                severity=SEVERITY,
                target_id=lane_id,
                target_type="lane",
                message="Lane je prazdna.",
                proposal="Odstran lane alebo do nej presun aktivity.",
                confidence=0.7,
                risk="cosmetic",
            )
        )
    return findings
