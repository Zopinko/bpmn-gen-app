from __future__ import annotations

import copy
from typing import Any, Dict, List, Tuple

from .models import (
    MentorEngineApplyAuditEntry,
    MentorFinding,
    MentorReviewRequest,
)
from .rule_engine import run_rules


class MentorRuleError(Exception):
    pass


def _set_node_name(engine_json: Dict[str, Any], node_id: str, value: str) -> bool:
    for node in engine_json.get("nodes", []):
        if str(node.get("id")) == str(node_id):
            node["name"] = value
            return True
    return False


class MentorRuleService:
    def review(
        self, payload: MentorReviewRequest
    ) -> Tuple[List[MentorFinding], Dict[str, object]]:
        engine_json = payload.engine_json or {}
        nodes = engine_json.get("nodes") or []
        flows = engine_json.get("flows") or []
        lanes = engine_json.get("lanes") or []
        findings = run_rules(engine_json)
        meta: Dict[str, object] = {
            "rule_count": len(findings),
            "engine": "mentor_rules_v1",
            "node_count": len(nodes),
            "flow_count": len(flows),
            "lane_count": len(lanes),
        }
        return findings, meta

    def apply(
        self,
        engine_json: Dict[str, Any],
        accepted_finding_ids: List[str],
        fix_payload_overrides: Dict[str, Dict[str, Any]],
        findings: List[MentorFinding] | None = None,
    ) -> Tuple[Dict[str, Any], List[MentorEngineApplyAuditEntry]]:
        current = copy.deepcopy(engine_json)
        if findings is None:
            findings = run_rules(engine_json)

        findings_by_id = {finding.id: finding for finding in findings}
        audit_log: List[MentorEngineApplyAuditEntry] = []

        for finding_id in accepted_finding_ids:
            finding = findings_by_id.get(finding_id)
            if not finding or not finding.autofix:
                continue
            payload = fix_payload_overrides.get(finding_id) or finding.fix_payload
            if not payload:
                continue
            if payload.get("action") == "set_node_name":
                node_id = payload.get("nodeId")
                value = payload.get("value")
                if not node_id or value is None:
                    continue
                if _set_node_name(current, str(node_id), str(value)):
                    audit_log.append(
                        MentorEngineApplyAuditEntry(
                            id=finding_id,
                            action="set_node_name",
                            reason=finding.message,
                        )
                    )
        return current, audit_log
