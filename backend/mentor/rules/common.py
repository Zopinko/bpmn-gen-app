from __future__ import annotations

from typing import Any, Dict, Optional

from ..models import MentorFinding, MentorTarget


def is_gateway_token(token: str) -> bool:
    return token.endswith("gateway") or token == "gateway"


def is_event_token(token: str) -> bool:
    return "event" in token


def is_activity_token(token: str) -> bool:
    return token in {"task", "usertask", "servicetask", "subprocess"}


def is_boundary_event(node: Dict[str, Any], token: str) -> bool:
    if token == "boundaryevent":
        return True
    if node.get("attachedToRef") or node.get("attachedTo") or node.get("attached_to"):
        return True
    return False


def target_type_for_node(token: str) -> str:
    if token == "subprocess":
        return "subprocess"
    if is_gateway_token(token):
        return "gateway"
    if is_event_token(token):
        return "event"
    return "task"


def make_finding(
    rule_id: str,
    severity: str,
    target_id: str,
    target_type: str,
    message: str,
    proposal: str,
    confidence: float,
    risk: str,
    autofix: bool = False,
    fix_payload: Optional[Dict[str, Any]] = None,
) -> MentorFinding:
    return MentorFinding(
        id=f"{rule_id}:{target_id}",
        severity=severity,
        target=MentorTarget(id=target_id, type=target_type),
        message=message,
        proposal=proposal,
        confidence=confidence,
        risk=risk,
        autofix=autofix,
        fix_payload=fix_payload,
    )
