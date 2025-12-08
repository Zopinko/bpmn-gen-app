from typing import Any, Dict, List, Literal

from pydantic import BaseModel

Severity = Literal["error", "warning"]


class NodeIssue(BaseModel):
    node_id: str
    severity: Severity
    code: str
    message: str


def _flows_by_node(
    flows: List[Dict[str, Any]]
) -> tuple[Dict[str, int], Dict[str, int]]:
    incoming: Dict[str, int] = {}
    outgoing: Dict[str, int] = {}
    for flow in flows or []:
        src = flow.get("source") or flow.get("sourceId") or flow.get("sourceRef")
        tgt = flow.get("target") or flow.get("targetId") or flow.get("targetRef")
        if isinstance(src, str):
            outgoing[src] = outgoing.get(src, 0) + 1
        if isinstance(tgt, str):
            incoming[tgt] = incoming.get(tgt, 0) + 1
    return incoming, outgoing


def validate_engine(engine_json: Dict[str, Any]) -> List[NodeIssue]:
    issues: List[NodeIssue] = []

    nodes: List[Dict[str, Any]] = list(engine_json.get("nodes") or [])
    flows: List[Dict[str, Any]] = list(engine_json.get("flows") or [])
    lanes: List[Dict[str, Any]] = list(engine_json.get("lanes") or [])

    incoming_counts, outgoing_counts = _flows_by_node(flows)

    # Hard errors
    for node in nodes:
        nid = node.get("id")
        ntype = (node.get("type") or "").strip()
        if not nid:
            continue

        if ntype in {
            "exclusiveGateway",
            "parallelGateway",
            "inclusiveGateway",
            "eventBasedGateway",
        }:
            if outgoing_counts.get(nid, 0) < 2:
                issues.append(
                    NodeIssue(
                        node_id=nid,
                        severity="error",
                        code="gateway_too_few_outgoing",
                        message="Táto brána má menej ako dve výstupné vetvy.",
                    )
                )

        if ntype in {"startEvent", "start_event"} and incoming_counts.get(nid, 0) > 0:
            issues.append(
                NodeIssue(
                    node_id=nid,
                    severity="error",
                    code="start_has_incoming",
                    message="Začiatočná udalosť nesmie mať prichádzajúci tok.",
                )
            )

        if ntype in {"endEvent", "end_event"} and outgoing_counts.get(nid, 0) > 0:
            issues.append(
                NodeIssue(
                    node_id=nid,
                    severity="error",
                    code="end_has_outgoing",
                    message="Koncová udalosť nesmie mať odchádzajúci tok.",
                )
            )

        if (
            ntype in {"task", "manual_task"}
            and incoming_counts.get(nid, 0) == 0
            and outgoing_counts.get(nid, 0) == 0
        ):
            issues.append(
                NodeIssue(
                    node_id=nid,
                    severity="error",
                    code="task_disconnected",
                    message="Tento krok nie je pripojený do žiadneho toku.",
                )
            )

    # Soft warnings
    lane_nodes: Dict[str, List[str]] = {}
    for lane in lanes:
        lid = lane.get("id")
        if isinstance(lid, str) and lid:
            lane_nodes[lid] = []
    for node in nodes:
        lid = node.get("laneId")
        nid = node.get("id")
        if isinstance(lid, str) and isinstance(nid, str) and lid in lane_nodes:
            lane_nodes[lid].append(nid)

    for lane in lanes:
        lid = lane.get("id")
        if lid and not lane_nodes.get(lid):
            issues.append(
                NodeIssue(
                    node_id=lid,
                    severity="warning",
                    code="lane_empty",
                    message="Táto lane nemá žiadne kroky.",
                )
            )

    for node in nodes:
        nid = node.get("id")
        ntype = (node.get("type") or "").strip()
        name = (node.get("name") or node.get("label") or "").strip()
        if ntype == "task" and name.lower() == "inak":
            issues.append(
                NodeIssue(
                    node_id=nid,
                    severity="warning",
                    code="else_placeholder",
                    message="Vetva 'Inak' je len placeholder, doplň reálne kroky pre NIE.",
                )
            )

    return issues
