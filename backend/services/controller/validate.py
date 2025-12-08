from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Literal

from services.engine_normalizer import gateway_degrees

Severity = Literal["error", "warning"]


def _norm_type(value: str | None) -> str:
    if not value:
        return ""
    return value.replace("-", "_").replace(" ", "_").lower()


@dataclass(frozen=True)
class Issue:
    code: str
    message: str
    severity: Severity
    node_id: str | None = None


def validate(engine: Dict[str, object]) -> List[Issue]:
    """Run controller-level BPMN checks and return validation issues."""
    issues: List[Issue] = []

    nodes = [node for node in engine.get("nodes", []) if isinstance(node, dict)]  # type: ignore[arg-type]
    flows = [flow for flow in engine.get("flows", []) if isinstance(flow, dict)]  # type: ignore[arg-type]
    lanes = [lane for lane in engine.get("lanes", []) if isinstance(lane, dict)]  # type: ignore[arg-type]

    node_by_id = {node.get("id"): node for node in nodes if node.get("id")}
    indeg, outdeg = gateway_degrees(nodes, flows)

    # Hard rule: missing end event
    has_end_event = any(
        _norm_type(node.get("type")) in {"end_event", "bpmnend", "endevent"}
        for node in nodes
    )
    if not has_end_event:
        issues.append(
            Issue(
                code="missing_end_event",
                message="Process is missing an end event.",
                severity="error",
            )
        )

    # Hard rule: gateways must have at least one outgoing flow
    for node_id, node in node_by_id.items():
        node_type = _norm_type(node.get("type"))
        if "gateway" in node_type and outdeg.get(node_id, 0) < 1:
            name = (
                (node.get("name") or node_id)
                if node_id
                else node.get("name") or "Gateway"
            )
            issues.append(
                Issue(
                    code="gateway_without_outgoing_branch",
                    message=f"Gateway '{name}' has no outgoing sequence flow.",
                    severity="error",
                    node_id=node_id,
                )
            )

    # Hard rule: task must have both incoming and outgoing flows
    for node_id, node in node_by_id.items():
        node_type = _norm_type(node.get("type"))
        if "task" in node_type:
            incoming = indeg.get(node_id, 0)
            outgoing = outdeg.get(node_id, 0)
            if incoming < 1 or outgoing < 1:
                missing = []
                if incoming < 1:
                    missing.append("incoming")
                if outgoing < 1:
                    missing.append("outgoing")
                name = (
                    (node.get("name") or node_id)
                    if node_id
                    else node.get("name") or "Task"
                )
                issues.append(
                    Issue(
                        code="task_without_incoming_or_outgoing",
                        message=f"Task '{name}' is missing {' and '.join(missing)} sequence flow(s).",
                        severity="error",
                        node_id=node_id,
                    )
                )

    # Soft rule: empty lanes
    lane_usage: Dict[str, int] = {}
    for node in nodes:
        lane_id = node.get("laneId")
        if isinstance(lane_id, str):
            lane_usage[lane_id] = lane_usage.get(lane_id, 0) + 1
    for lane in lanes:
        lane_id = lane.get("id")
        if isinstance(lane_id, str) and lane_usage.get(lane_id, 0) == 0:
            name = lane.get("name") or lane_id
            issues.append(
                Issue(
                    code="empty_lane",
                    message=f"Lane '{name}' has no assigned nodes.",
                    severity="warning",
                )
            )

    # Soft rule: names that are too long
    for node_id, node in node_by_id.items():
        name = node.get("name")
        if isinstance(name, str) and len(name) > 60:
            issues.append(
                Issue(
                    code="too_long_name",
                    message=f"Node '{name}' exceeds 60 characters.",
                    severity="warning",
                    node_id=node_id,
                )
            )

    # Soft rule: duplicate task names within the same lane
    tasks_per_lane: Dict[str, Dict[str, List[str]]] = {}
    for node_id, node in node_by_id.items():
        node_type = _norm_type(node.get("type"))
        if "task" not in node_type:
            continue
        lane_id = node.get("laneId") or "__no_lane__"
        if not isinstance(lane_id, str):
            lane_id = "__no_lane__"
        name = (node.get("name") or "").strip()
        key = name.lower()
        if not key:
            continue
        lane_map = tasks_per_lane.setdefault(lane_id, {})
        lane_map.setdefault(key, []).append(node_id or name)

    for lane_id, name_map in tasks_per_lane.items():
        for name_key, node_ids in name_map.items():
            if len(node_ids) > 1:
                display_name = next(
                    (
                        node_by_id.get(node_id, {}).get("name")
                        for node_id in node_ids
                        if node_id in node_by_id
                    ),
                    name_key,
                )
                issues.append(
                    Issue(
                        code="duplicate_task_names",
                        message=f"Lane '{lane_id}' has duplicate task name '{display_name}'.",
                        severity="warning",
                    )
                )

    return issues
