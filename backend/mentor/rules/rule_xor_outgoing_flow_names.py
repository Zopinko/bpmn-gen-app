from __future__ import annotations

from typing import Any, Dict, List

from .common import is_gateway_token, make_finding

RULE_ID = "xor_outgoing_flows_require_names"
SEVERITY = "SOFT"


def _is_xor_gateway(node: Dict[str, Any], token: str) -> bool:
    if "exclusive" in token:
        return True
    for key in ("gatewayType", "gateway_type", "kind"):
        value = node.get(key)
        if not value:
            continue
        value_cf = str(value).strip().lower()
        if value_cf in {"exclusive", "xor"}:
            return True
    return False


def _is_default_flow(node: Dict[str, Any], flow: Dict[str, Any]) -> bool:
    if flow.get("isDefault") is True or flow.get("default") is True:
        return True
    default_flow_id = node.get("defaultFlowId") or node.get("default_flow_id")
    if default_flow_id and str(default_flow_id) == str(flow.get("id")):
        return True
    return False


def _flow_label(flow: Dict[str, Any]) -> str:
    return (
        (flow.get("name") or "").strip()
        or (flow.get("label") or "").strip()
        or (flow.get("condition") or "").strip()
    )


def check(_: Dict[str, Any], index: Any) -> List[object]:
    findings: List[object] = []
    for node_id, node in index.nodes_by_id.items():
        token = index.node_type_token.get(node_id, "")
        if not is_gateway_token(token):
            continue
        if not _is_xor_gateway(node, token):
            continue
        outgoing_seq = [
            flow_id
            for flow_id in index.outgoing.get(node_id, [])
            if index.flow_type_token.get(flow_id, "sequenceflow") == "sequenceflow"
        ]
        if len(outgoing_seq) < 2:
            continue
        for flow_id in outgoing_seq:
            flow = index.flows_by_id.get(flow_id)
            if not flow:
                continue
            if _is_default_flow(node, flow):
                continue
            if _flow_label(flow):
                continue
            findings.append(
                make_finding(
                    rule_id=RULE_ID,
                    severity=SEVERITY,
                    target_id=flow_id,
                    target_type="sequenceFlow",
                    message="Vetva z XOR gateway nema nazov podmienky.",
                    proposal="Pomenuj vetvu vysledkom podmienky (napr. Ano / Nie alebo konkretna podmienka).",
                    confidence=0.8,
                    risk="cosmetic",
                )
            )
    return findings
