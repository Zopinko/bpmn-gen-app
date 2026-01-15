# mypy: ignore-errors
# bpmn_svc.py
# Jednotné, prehľadné a spätnokompatibilné generovanie BPMN z engine_json.

import xml.etree.ElementTree as ET
import heapq
import re
from collections import defaultdict
from typing import Any, Dict, List, Callable
from uuid import uuid4
from services.architect.normalize import postprocess_engine_json
from services.architect import _mk_question
from services.controller_svc import validate_engine
from schemas.wizard import (
    LaneAppendRequest,
    LinearWizardRequest,
)


# services/bpmn_svc.py

LAYOUT_VERSION = "topo_v3"
POOL_HEADER_WIDTH = 30  # px, rovnaké ako bpmn-js default

# -------------------------------
# Namespaces a helpers
# -------------------------------
NS = {
    "bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
    "dc": "http://www.omg.org/spec/DD/20100524/DC",
    "di": "http://www.omg.org/spec/DD/20100524/DI",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
}
ET.register_namespace("", NS["bpmn"])
ET.register_namespace("bpmndi", NS["bpmndi"])
ET.register_namespace("dc", NS["dc"])
ET.register_namespace("di", NS["di"])
ET.register_namespace("xsi", NS["xsi"])

TYPE_TAG = {
    "start_event": "startEvent",
    "end_event": "endEvent",
    "task": "task",
    "exclusive_gateway": "exclusiveGateway",
    "parallel_gateway": "parallelGateway",
    "inclusive_gateway": "inclusiveGateway",
}


def T(ns: str, local: str) -> str:
    return f"{{{NS[ns]}}}{local}"


def _safe_lane_id(raw_id: str, fallback: str = "Lane") -> str:
    base = re.sub(r"[^0-9A-Za-z_]", "_", (raw_id or "").strip())
    if not base:
        base = fallback
    if base[0].isdigit():
        base = f"{fallback}_{base}"
    if not base.startswith(fallback):
        base = f"{fallback}_{base}"
    return base


def _slugify_process_id(raw_name: str) -> str:
    normalized = re.sub(r"[^0-9A-Za-z]+", "-", (raw_name or "").strip().lower())
    normalized = re.sub(r"-+", "-", normalized).strip("-")
    return normalized or "process"


def _expand_conditional_step(
    step: str,
    lane_id: str,
    prev_id: str | None,
    make_gateway_id: Callable[[], str],
    make_task_ids: Callable[[], tuple[str, str]],
    make_flow_id: Callable[[str, str], str],
    include_lane_in_flow: bool = False,
) -> tuple[str | None, list[Dict[str, Any]], list[Dict[str, Any]]]:
    """Return (new_prev, nodes, flows) for a conditional 'Ak/Keď/Ked ...' step."""
    cond = then_part = else_part = None
    cond_prefix = r"(?:Ak|Keď|Ked)"

    # Variant 1a: explicit ELSE with tak/potom and optional commas
    m = re.match(
        rf"^\s*{cond_prefix}\s+(?P<cond>.+?)\s*,?\s*(?:tak|potom)\s+(?P<then>.+?)\s*,?\s*inak\s*[:\-]?\s*(?P<else>.+)\s*$",
        step,
        flags=re.IGNORECASE,
    )
    if m:
        cond = (m.group("cond") or "").strip()
        then_part = (m.group("then") or "").strip()
        else_part = (m.group("else") or "").strip() or None
    else:
        # Variant 1b: tak/potom bez explicitného inak (fallback)
        m = re.match(
            rf"^\s*{cond_prefix}\s+(?P<cond>.+?)\s*,?\s*(?:tak|potom)\s+(?P<then>.+)\s*$",
            step,
            flags=re.IGNORECASE,
        )
        if m:
            cond = (m.group("cond") or "").strip()
            then_part = (m.group("then") or "").strip()
        else:
            # Variant 2: legacy "Ak X, Y" without explicit tak/potom
            m = re.match(rf"^\s*{cond_prefix}\s+(.*?),(.*)$", step, flags=re.IGNORECASE)
            if m:
                cond = m.group(1).strip()
                then_part = m.group(2).strip()

    if not cond or not then_part:
        return None, [], []

    then_part = then_part or "Krok"
    gw_id = make_gateway_id()
    gw_name = _mk_question(cond)
    yes_id, else_id = make_task_ids()

    nodes = [
        {
            "id": gw_id,
            "type": "exclusiveGateway",
            "name": gw_name,
            "laneId": lane_id,
        },
        {"id": yes_id, "type": "task", "name": then_part, "laneId": lane_id},
    ]

    end_keywords = {"koniec", "end", "ukonci", "ukonči", "stop"}
    else_lower = (else_part or "").lower()
    if else_part and else_lower in end_keywords:
        nodes.append({"id": else_id, "type": "endEvent", "name": else_part, "laneId": lane_id})
    else:
        nodes.append({"id": else_id, "type": "task", "name": else_part or "Inak", "laneId": lane_id})

    flows: list[Dict[str, Any]] = []
    if prev_id:
        flow = {"id": make_flow_id(prev_id, gw_id), "source": prev_id, "target": gw_id}
        if include_lane_in_flow:
            flow["laneId"] = lane_id
        flows.append(flow)

    flow_yes = {"id": make_flow_id(gw_id, yes_id), "source": gw_id, "target": yes_id, "name": "Áno"}
    flow_no = {"id": make_flow_id(gw_id, else_id), "source": gw_id, "target": else_id, "name": "Nie"}
    if include_lane_in_flow:
        flow_yes["laneId"] = lane_id
        flow_no["laneId"] = lane_id

    flows.extend([flow_yes, flow_no])
    return yes_id, nodes, flows


def _expand_parallel_step(
    step: str,
    lane_id: str,
    prev_id: str | None,
    make_gateway_id: Callable[[], str],
    make_task_id: Callable[[], str],
    make_flow_id: Callable[[str, str], str],
    include_lane_in_flow: bool = False,
) -> tuple[str | None, list[Dict[str, Any]], list[Dict[str, Any]]]:
    """Return (new_prev, nodes, flows) for parallel patterns or fallback."""
    items: list[str] = []

    # Highest priority: explicit "Paralelne: A; B; ..."
    m = re.match(r"^\s*Paralelne\s*:\s*(.+)$", step, flags=re.IGNORECASE)
    if m:
        raw = m.group(1)
        items = [
            part.strip().rstrip(".") for part in raw.split(";") if part.strip().rstrip(".")
        ]
    else:
        # Next: "Zároveň ..." with at least one explicit " a "
        trimmed = step.lstrip()
        lowered = trimmed.lower()
        prefixes = ["zároveň", "zaroven", "súčasne", "sucasne"]
        prefix = next((p for p in prefixes if lowered.startswith(p)), None)
        if prefix:
            raw = trimmed[len(prefix) :].strip()
            if re.search(r"\s+a\s+", raw, flags=re.IGNORECASE):
                parts = [p.strip().rstrip(".") for p in raw.split(",") if p.strip().rstrip(".")]
                last_chunk = parts.pop() if parts else raw
                subparts = [
                    s.strip().rstrip(".")
                    for s in re.split(r"\s+a\s+", last_chunk)
                    if s.strip().rstrip(".")
                ]
                items = [x for x in parts + subparts if x]

    if len(items) < 2:
        return None, [], []  # fallback to normal task handling

    split_id = make_gateway_id()
    join_id = make_gateway_id()

    nodes: list[Dict[str, Any]] = [
        {
            "id": split_id,
            "type": "parallelGateway",
            "laneId": lane_id,
            "name": "Paralelne",
        },
        {
            "id": join_id,
            "type": "parallelGateway",
            "laneId": lane_id,
            "name": "Zlúčenie paralelných vetiev",
        },
    ]
    flows: list[Dict[str, Any]] = []

    if prev_id:
        flow = {"id": make_flow_id(prev_id, split_id), "source": prev_id, "target": split_id}
        if include_lane_in_flow:
            flow["laneId"] = lane_id
        flows.append(flow)

    for item in items:
        task_id = make_task_id()
        nodes.append({"id": task_id, "type": "task", "name": item, "laneId": lane_id})

        f1 = {"id": make_flow_id(split_id, task_id), "source": split_id, "target": task_id}
        f2 = {"id": make_flow_id(task_id, join_id), "source": task_id, "target": join_id}
        if include_lane_in_flow:
            f1["laneId"] = lane_id
            f2["laneId"] = lane_id
        flows.extend([f1, f2])

    return join_id, nodes, flows


def build_linear_engine_from_wizard(data: LinearWizardRequest) -> Dict[str, Any]:
    """
    Deterministically build a linear engine_json from a wizard payload without any AI calls.
    """
    process_name = (data.process_name or "Process").strip() or "Process"
    roles = [role.strip() for role in data.roles if role and role.strip()]
    if not roles:
        roles = ["Main"]

    lanes = [
        {"id": f"lane_{idx}", "name": role} for idx, role in enumerate(roles, start=1)
    ]
    primary_lane_id = lanes[0]["id"]

    start_id = "start_1"
    end_id = "end_1"
    start_label = (data.start_trigger or "Start").strip() or "Start"
    end_label = (data.output or "End").strip() or "End"

    nodes: List[Dict[str, Any]] = [
        {
            "id": start_id,
            "type": "startEvent",
            "name": start_label,
            "laneId": primary_lane_id,
        }
    ]
    flows: List[Dict[str, Any]] = []

    previous = start_id
    step_names = [
        (step or "").strip() for step in (data.steps or []) if (step or "").strip()
    ]

    def _new_gateway_id() -> str:
        return f"gw_{uuid4().hex[:8]}"

    for idx, step in enumerate(step_names, start=1):
        par_counter = {"i": 0}
        new_prev, new_nodes, new_flows = _expand_parallel_step(
            step=step,
            lane_id=primary_lane_id,
            prev_id=previous,
            make_gateway_id=_new_gateway_id,
            make_task_id=lambda: f"task_{idx}_p_{(par_counter.__setitem__('i', par_counter['i'] + 1) or par_counter['i'])}",
            make_flow_id=lambda s, t: f"flow_{s}_to_{t}",
            include_lane_in_flow=True,
        )
        if new_nodes:
            nodes.extend(new_nodes)
            flows.extend(new_flows)
            previous = new_prev or previous
            continue

        new_prev, new_nodes, new_flows = _expand_conditional_step(
            step=step,
            lane_id=primary_lane_id,
            prev_id=previous,
            make_gateway_id=_new_gateway_id,
            make_task_ids=lambda: (f"task_{idx}_yes", f"task_{idx}_no"),
            make_flow_id=lambda s, t: f"flow_{s}_to_{t}",
            include_lane_in_flow=True,
        )
        if new_nodes:
            nodes.extend(new_nodes)
            flows.extend(new_flows)
            previous = new_prev or previous
            continue

        task_id = f"task_{idx}"
        nodes.append(
            {"id": task_id, "type": "task", "name": step, "laneId": primary_lane_id}
        )
        flows.append(
            {
                "id": f"flow_{previous}_to_{task_id}",
                "source": previous,
                "target": task_id,
                "laneId": primary_lane_id,
            }
        )
        previous = task_id

    nodes.append(
        {"id": end_id, "type": "endEvent", "name": end_label, "laneId": primary_lane_id}
    )
    flows.append(
        {
            "id": f"flow_{previous}_to_{end_id}",
            "source": previous,
            "target": end_id,
            "laneId": primary_lane_id,
        }
    )

    process_id = f"{_slugify_process_id(process_name)}-{uuid4().hex[:8]}"

    engine_json: Dict[str, Any] = {
        "processId": process_id,
        "name": process_name,
        "lanes": lanes,
        "nodes": nodes,
        "flows": flows,
    }

    validated = postprocess_engine_json(engine_json, locale="sk")
    issues = validate_engine(validated)
    return {
        "engine_json": validated,
        "issues": [issue.model_dump() for issue in issues],
    }


def append_tasks_to_lane_from_description(data: LaneAppendRequest) -> Dict[str, Any]:
    """Append linear tasks into a lane based on multiline description."""
    engine = dict(data.engine_json or {})
    lanes = engine.get("lanes") or []
    nodes: List[Dict[str, Any]] = list(engine.get("nodes") or [])
    flows: List[Dict[str, Any]] = list(engine.get("flows") or [])

    if not lanes:
        raise ValueError("Engine JSON has no lanes.")

    lane_lookup = {lane.get("id"): lane for lane in lanes if lane.get("id")}
    target_lane_id = None

    if data.lane_id and data.lane_id in lane_lookup:
        target_lane_id = data.lane_id
    elif data.lane_name:
        name_lower = data.lane_name.lower()
        for lane in lanes:
            if (lane.get("name") or "").lower() == name_lower:
                target_lane_id = lane.get("id")
                break

    if not target_lane_id:
        raise ValueError("Lane not found")

    nodes_by_id = {node.get("id"): node for node in nodes if node.get("id")}
    existing_ids = {node.get("id") for node in nodes}
    flow_ids = {flow.get("id") for flow in flows}

    def _new_task_id() -> str:
        candidate = f"task_{uuid4().hex[:8]}"
        while candidate in existing_ids:
            candidate = f"task_{uuid4().hex[:8]}"
        existing_ids.add(candidate)
        return candidate

    def _new_flow_id(src: str, tgt: str) -> str:
        candidate = f"flow_{src}_to_{tgt}"
        if candidate not in flow_ids:
            flow_ids.add(candidate)
            return candidate
        candidate = f"flow_{uuid4().hex[:8]}"
        flow_ids.add(candidate)
        return candidate

    def _new_gateway_id() -> str:
        candidate = f"gw_{uuid4().hex[:8]}"
        while candidate in existing_ids:
            candidate = f"gw_{uuid4().hex[:8]}"
        existing_ids.add(candidate)
        return candidate

    lane_node_indices = [
        idx for idx, node in enumerate(nodes) if node.get("laneId") == target_lane_id
    ]
    lane_nodes = [nodes[idx] for idx in lane_node_indices]
    last_created_lane_id = None
    for node in reversed(nodes):
        node_id = node.get("id")
        node_type = node.get("type")
        if node_id and node_type:
            last_created_lane_id = node.get("laneId")
            break
    align_global_x = bool(last_created_lane_id) and last_created_lane_id != target_lane_id
    end_node_id = None
    end_flow_id = None
    gateway_types = {
        "exclusiveGateway",
        "parallelGateway",
        "inclusiveGateway",
        "eventBasedGateway",
    }
    end_candidates = [node for node in lane_nodes if _normalize_node_type(node) == "endEvent"]
    for node in reversed(lane_nodes):
        if _normalize_node_type(node) != "endEvent":
            continue
        has_outgoing = any(flow.get("source") == node.get("id") for flow in flows)
        if has_outgoing:
            continue
        incoming_to_end = [flow for flow in flows if flow.get("target") == node.get("id")]
        if incoming_to_end:
            src_id = incoming_to_end[0].get("source")
            src_node = nodes_by_id.get(src_id)
            if src_node and _normalize_node_type(src_node) in gateway_types:
                continue
        end_node_id = node.get("id")
        break
    if end_node_id is None and end_candidates:
        end_node_id = end_candidates[-1].get("id")

    prev_id = None
    if end_node_id:
        incoming_to_end = [flow for flow in flows if flow.get("target") == end_node_id]
        for flow in incoming_to_end:
            src_id = flow.get("source")
            src_node = nodes_by_id.get(src_id)
            if not src_node:
                continue
            src_type = _normalize_node_type(src_node)
            if src_type in gateway_types:
                continue
            if src_node.get("laneId") == target_lane_id and src_type != "endEvent":
                prev_id = src_id
                end_flow_id = flow.get("id")
                break
        if prev_id is None:
            for node in reversed(lane_nodes):
                if node.get("id") != end_node_id and _normalize_node_type(node) != "endEvent":
                    prev_id = node.get("id")
                    break
    elif lane_nodes:
        prev_id = lane_nodes[-1].get("id")

    if end_node_id and prev_id and end_flow_id is None:
        for flow in flows:
            if flow.get("source") == prev_id and flow.get("target") == end_node_id:
                end_flow_id = flow.get("id")
                break

    steps = [
        line.strip() for line in (data.description or "").splitlines() if line.strip()
    ]
    if not steps:
        return postprocess_engine_json(engine, locale="sk")

    if end_flow_id:
        flows = [flow for flow in flows if flow.get("id") != end_flow_id]
        flow_ids.discard(end_flow_id)

    for step in steps:
        par_counter = {"i": 0}
        new_prev, new_nodes, new_flows = _expand_parallel_step(
            step=step,
            lane_id=target_lane_id,
            prev_id=prev_id,
            make_gateway_id=_new_gateway_id,
            make_task_id=lambda: _new_task_id(),
            make_flow_id=_new_flow_id,
            include_lane_in_flow=False,
        )
        if new_nodes:
            if align_global_x:
                for node in new_nodes:
                    node["_align_global_x"] = True
            nodes.extend(new_nodes)
            flows.extend(new_flows)
            prev_id = new_prev or prev_id
            continue

        new_prev, new_nodes, new_flows = _expand_conditional_step(
            step=step,
            lane_id=target_lane_id,
            prev_id=prev_id,
            make_gateway_id=_new_gateway_id,
            make_task_ids=lambda: (_new_task_id(), _new_task_id()),
            make_flow_id=_new_flow_id,
            include_lane_in_flow=False,
        )
        if new_nodes:
            if align_global_x:
                for node in new_nodes:
                    node["_align_global_x"] = True
            nodes.extend(new_nodes)
            flows.extend(new_flows)
            prev_id = new_prev or prev_id
            continue

        created_id = _new_task_id()
        node_payload: Dict[str, Any] = {
            "id": created_id,
            "type": "task",
            "name": step,
            "laneId": target_lane_id,
        }
        if align_global_x:
            node_payload["_align_global_x"] = True

        nodes.append(node_payload)
        if prev_id:
            flows.append(
                {
                    "id": _new_flow_id(prev_id, created_id),
                    "source": prev_id,
                    "target": created_id,
                }
            )
        prev_id = created_id

    if end_node_id and prev_id:
        has_link = any(
            flow.get("source") == prev_id and flow.get("target") == end_node_id
            for flow in flows
        )
        if not has_link:
            flows.append(
                {
                    "id": _new_flow_id(prev_id, end_node_id),
                    "source": prev_id,
                    "target": end_node_id,
                }
            )

    engine["nodes"] = nodes
    engine["flows"] = flows
    engine["lanes"] = lanes

    validated = postprocess_engine_json(engine, locale="sk")
    issues = validate_engine(validated)
    return {
        "engine_json": validated,
        "issues": [issue.model_dump() for issue in issues],
    }


if __name__ == "__main__":
    # Quick smoke checks for conditional parsing variations.
    gw_ids = iter(["gw_demo_1", "gw_demo_2"])
    task_ids = iter([f"t{i}" for i in range(1, 10)])

    def _demo_gw():
        return next(gw_ids)

    def _demo_tasks():
        return next(task_ids), next(task_ids)

    def _demo_flow(s: str, t: str) -> str:
        return f"flow_{s}_to_{t}"

    _p, _nodes, _flows = _expand_conditional_step(
        "Ak prší tak zober dáždnik, inak end",
        "Lane_A",
        "start",
        make_gateway_id=_demo_gw,
        make_task_ids=_demo_tasks,
        make_flow_id=_demo_flow,
        include_lane_in_flow=True,
    )
    assert any(n["type"] == "endEvent" for n in _nodes), "Else endEvent expected"
    assert len(_flows) == 3, "Should create three flows (prev->gw, gw->yes, gw->no)"

    _p, _nodes, _flows = _expand_conditional_step(
        "Ak chyba, tak retry, inak stop",
        "Lane_C",
        "prev2",
        make_gateway_id=_demo_gw,
        make_task_ids=_demo_tasks,
        make_flow_id=_demo_flow,
        include_lane_in_flow=False,
    )
    assert any(n.get("name") == "stop" for n in _nodes), "Else text should propagate (not placeholder)"
    assert any(n.get("name") == "retry" for n in _nodes), "Then text should propagate"

    _p, _nodes, _flows = _expand_conditional_step(
        "Ak prší, tak zober dáždnik, inak zavolaj kuriéra",
        "Lane_D",
        "start2",
        make_gateway_id=_demo_gw,
        make_task_ids=_demo_tasks,
        make_flow_id=_demo_flow,
        include_lane_in_flow=True,
    )
    assert any(n.get("name") == "zober dáždnik" for n in _nodes), "Then text lost when comma present"
    assert any(n.get("name") == "zavolaj kuriéra" for n in _nodes), "Else text lost when comma present"

    _p, _nodes, _flows = _expand_conditional_step(
        "Ak slabo upečieme medovníky, tak budú nedopečené, inak budú dobré",
        "Lane_E",
        "start3",
        make_gateway_id=_demo_gw,
        make_task_ids=_demo_tasks,
        make_flow_id=_demo_flow,
        include_lane_in_flow=True,
    )
    assert any(n.get("name") == "budú nedopečené" for n in _nodes), "Then should capture pred inak"
    assert any(n.get("name") == "budú dobré" for n in _nodes), "Else should capture text za inak"

    _p, _nodes, _flows = _expand_parallel_step(
        "Paralelne: A; B; C",
        "Lane_P",
        "prevP",
        make_gateway_id=_demo_gw,
        make_task_id=lambda: next(task_ids),
        make_flow_id=_demo_flow,
        include_lane_in_flow=True,
    )
    assert _p, "Parallel should return join id as new prev"
    assert sum(1 for n in _nodes if n.get("type") == "parallelGateway") == 2, "Should create split and join"
    assert sum(1 for n in _nodes if n.get("type") == "task") == 3, "Should create tasks for each branch"

    _p, _nodes, _flows = _expand_parallel_step(
        "Zaroven priprav zmluvu a zapis vysledok",
        "Lane_Z",
        "prevZ",
        make_gateway_id=_demo_gw,
        make_task_id=lambda: next(task_ids),
        make_flow_id=_demo_flow,
        include_lane_in_flow=False,
    )
    assert sum(1 for n in _nodes if n.get("type") == "task") == 2, "Zároveň should split into two tasks"

    _p, _nodes, _flows = _expand_parallel_step(
        "Súčasne priprav zmluvu a zapíš výsledok",
        "Lane_S",
        "prevS",
        make_gateway_id=_demo_gw,
        make_task_id=lambda: next(task_ids),
        make_flow_id=_demo_flow,
        include_lane_in_flow=False,
    )
    assert sum(1 for n in _nodes if n.get("type") == "task") == 2, "Súčasne alias should split into two tasks"

    _p, _nodes, _flows = _expand_conditional_step(
        "Ak chyba, retry",
        "Lane_B",
        "prev",
        make_gateway_id=_demo_gw,
        make_task_ids=_demo_tasks,
        make_flow_id=_demo_flow,
        include_lane_in_flow=False,
    )
    assert any(n.get("name") == "Inak" for n in _nodes), "Fallback Inak task expected"


CANONICAL_TYPES = {
    "startEvent",
    "endEvent",
    "task",
    "userTask",
    "serviceTask",
    "exclusiveGateway",
    "parallelGateway",
    "inclusiveGateway",
    "eventBasedGateway",
    "intermediateCatchEvent",
    "intermediateThrowEvent",
    "subProcess",
}

SNAKE_TO_BPMN_TYPE = {
    "start_event": "startEvent",
    "end_event": "endEvent",
    "task": "task",
    "user_task": "userTask",
    "service_task": "serviceTask",
    "exclusive_gateway": "exclusiveGateway",
    "parallel_gateway": "parallelGateway",
    "inclusive_gateway": "inclusiveGateway",
    "event_based_gateway": "eventBasedGateway",
    "intermediate_catch_event": "intermediateCatchEvent",
    "intermediate_throw_event": "intermediateThrowEvent",
    "sub_process": "subProcess",
}


def _xml_to_string(elem: ET.Element) -> str:
    _indent(elem)
    xml_bytes = ET.tostring(elem, encoding="utf-8", xml_declaration=True)
    return xml_bytes.decode("utf-8")


def _indent(elem, level: int = 0):
    i = "\n" + level * "  "
    if len(elem):
        if not elem.text or not elem.text.strip():
            elem.text = i + "  "
        for e in elem:
            _indent(e, level + 1)
        if not e.tail or not e.tail.strip():
            e.tail = i
    if level and (not elem.tail or not elem.tail.strip()):
        elem.tail = i


# -------------------------------
# Jednoduchý auto-layout
# -------------------------------
def _build_layout(data: Dict[str, Any]) -> Dict[str, Any]:
    GRID_X = 250  # väčší horizontálny odstup medzi uzlami
    GRID_Y = 180  # väčší vertikálny odstup (vzdušnejšie lane)
    BASE_LANE_X = 0  # offset lane od ľavého okraja poolu
    BASE_LANE_Y = 0  # lane začína hneď pri vrchu poolu
    LANE_CONTENT_PAD = 80  # left padding before first node
    ROW_MARGIN = 8
    POOL_PAD_X = 60
    POOL_PAD_Y = 0  # žiadny extra vertikálny padding – výška = súčet lanes
    MIN_LANE_HEIGHT = 200
    GATEWAY_EXTRA_PADDING = 16
    WAYPOINT_SPACING = 44
    LANE_MARGIN = 0
    SYSTEM_LANE_ID = "Lane_System"

    NODE_SIZES = {
        "startEvent": (36, 36),
        "endEvent": (36, 36),
        "intermediateCatchEvent": (36, 36),
        "intermediateThrowEvent": (36, 36),
        "exclusiveGateway": (50, 50),
        "parallelGateway": (50, 50),
        "inclusiveGateway": (50, 50),
        "eventBasedGateway": (50, 50),
        "task": (190, 78),  # ~25% nižšie, stále široké
        "userTask": (190, 78),
        "serviceTask": (190, 78),
        "subProcess": (240, 180),
    }
    GATEWAY_TYPES = {
        "exclusiveGateway",
        "parallelGateway",
        "inclusiveGateway",
        "eventBasedGateway",
    }

    lanes = data.get("lanes") or []
    nodes = data.get("nodes") or []
    flows = data.get("flows") or []

    lane_name_map = {
        lane["id"]: (lane.get("name") or lane.get("id") or lane["id"])
        for lane in lanes
        if lane.get("id")
    }
    system_needed = False

    nodes_by_id: Dict[str, Dict[str, Any]] = {}
    node_order: Dict[str, int] = {}
    node_type: Dict[str, str] = {}
    lane_for_node: Dict[str, str] = {}
    for idx, node in enumerate(nodes):
        node_id = node.get("id")
        if not node_id:
            continue
        nodes_by_id[node_id] = node
        node_order[node_id] = idx
        ntype = _normalize_node_type(node)
        node_type[node_id] = ntype
        lane_id = node.get("laneId")
        if not lane_id or lane_id not in lane_name_map:
            system_needed = True
            lane_id = SYSTEM_LANE_ID
        if lane_id not in lane_name_map:
            lane_name_map[lane_id] = "System" if lane_id == SYSTEM_LANE_ID else lane_id
        lane_for_node[node_id] = lane_id

    def _resolve_edge_endpoint(
        flow: Dict[str, Any], keys: tuple[str, ...]
    ) -> str | None:
        for key in keys:
            value = flow.get(key)
            if value:
                return value
        return None

    ordered_lanes: List[str] = []
    seen_lanes: set[str] = set()

    def register_lane(lane_id: str | None) -> None:
        if not lane_id:
            return
        if lane_id not in lane_name_map:
            lane_name_map[lane_id] = lane_id
        if lane_id not in seen_lanes:
            seen_lanes.add(lane_id)
            ordered_lanes.append(lane_id)

    # Prefer the engine_json lane order (creation/order in wizard or process card).
    for lane in lanes:
        register_lane(lane.get("id"))

    # Add any lanes referenced by nodes but missing from the lane list.
    for node in nodes:
        lane_id = lane_for_node.get(node.get("id")) or node.get("laneId")
        register_lane(lane_id)

    # Fall back to any remaining lanes for determinism.
    all_lane_ids = {lane_id for lane_id in lane_name_map if lane_id}
    remaining_lanes = sorted(
        (lane_id for lane_id in all_lane_ids if lane_id not in seen_lanes),
        key=lambda lid: (lane_name_map.get(lid, lid).lower(), lid),
    )
    for lane_id in remaining_lanes:
        register_lane(lane_id)

    if not ordered_lanes:
        ordered_lanes.append(SYSTEM_LANE_ID)

    adjacency: Dict[str, List[str]] = defaultdict(list)
    incoming: Dict[str, List[str]] = defaultdict(list)
    indegree = {node_id: 0 for node_id in nodes_by_id}

    for flow in flows:
        src = _resolve_edge_endpoint(flow, ("source", "sourceRef", "sourceId"))
        tgt = _resolve_edge_endpoint(flow, ("target", "targetRef", "targetId"))
        if not src or not tgt:
            continue
        if src not in nodes_by_id or tgt not in nodes_by_id:
            continue
        adjacency[src].append(tgt)
        incoming[tgt].append(src)
        indegree[tgt] += 1

    levels = {node_id: 0 for node_id in nodes_by_id}
    processed: set[str] = set()
    heap: list[tuple[int, str]] = []

    zero_indegree_nodes = [
        node_id
        for node_id, deg in indegree.items()
        if deg == 0 and node_id in nodes_by_id
    ]
    for node_id in sorted(zero_indegree_nodes, key=lambda nid: node_order.get(nid, 0)):
        heapq.heappush(heap, (node_order.get(node_id, 0), node_id))

    while heap:
        _, node_id = heapq.heappop(heap)
        if node_id in processed:
            continue
        processed.add(node_id)
        base_level = levels[node_id]
        step = 1
        for tgt in sorted(
            adjacency.get(node_id, []), key=lambda nid: node_order.get(nid, 0)
        ):
            candidate = base_level + step
            if candidate > levels[tgt]:
                levels[tgt] = candidate
            indegree[tgt] -= 1
            if indegree[tgt] == 0:
                heapq.heappush(heap, (node_order.get(tgt, 0), tgt))

    remaining = [nid for nid in nodes_by_id if nid not in processed]
    if remaining:
        max_level = max(levels.values(), default=0)
        for offset, nid in enumerate(
            sorted(remaining, key=lambda n: node_order.get(n, 0)), start=1
        ):
            levels[nid] = max(levels[nid], max_level + offset)

    for nid, preds in incoming.items():
        if not preds or nid not in levels:
            continue
        min_level = max(levels.get(pid, 0) + 1 for pid in preds if pid in levels)
        if min_level > levels[nid]:
            levels[nid] = min_level

    align_nodes = [nid for nid, node in nodes_by_id.items() if node.get("_align_global_x")]
    if align_nodes and levels:
        neighbors: Dict[str, set[str]] = defaultdict(set)
        for flow in flows:
            src = _resolve_edge_endpoint(flow, ("source", "sourceRef", "sourceId"))
            tgt = _resolve_edge_endpoint(flow, ("target", "targetRef", "targetId"))
            if not src or not tgt:
                continue
            if src not in nodes_by_id or tgt not in nodes_by_id:
                continue
            neighbors[src].add(tgt)
            neighbors[tgt].add(src)

        component_id: Dict[str, int] = {}
        components: List[set[str]] = []
        for node_id in nodes_by_id:
            if node_id in component_id:
                continue
            stack = [node_id]
            component_nodes: set[str] = set()
            while stack:
                current = stack.pop()
                if current in component_nodes:
                    continue
                component_nodes.add(current)
                for nxt in neighbors.get(current, set()):
                    if nxt not in component_nodes:
                        stack.append(nxt)
            comp_index = len(components)
            for nid in component_nodes:
                component_id[nid] = comp_index
            components.append(component_nodes)

        align_components = {component_id[nid] for nid in align_nodes if nid in component_id}
        if align_components:
            base_levels = [
                lvl
                for nid, lvl in levels.items()
                if component_id.get(nid) not in align_components
            ]
            last_created_id = None
            last_created_order = -1
            for nid, order in node_order.items():
                if component_id.get(nid) in align_components:
                    continue
                if order > last_created_order:
                    last_created_order = order
                    last_created_id = nid

            for comp_index in align_components:
                comp_nodes = components[comp_index]
                base_max_level = (
                    levels.get(last_created_id)
                    if last_created_id and last_created_id in levels
                    else None
                )

                if base_max_level is None and base_levels:
                    base_max_level = max(base_levels)

                if base_max_level is None:
                    continue

                target_start = base_max_level
                min_level = min((levels.get(nid, 0) for nid in comp_nodes), default=0)
                shift = target_start - min_level
                if shift > 0:
                    for nid in comp_nodes:
                        levels[nid] = levels.get(nid, 0) + shift

    if levels:
        ordered_nodes = sorted(nodes_by_id, key=lambda nid: node_order.get(nid, 0))
        running_max = None
        for nid in ordered_nodes:
            lvl = levels.get(nid, 0)
            if running_max is None:
                running_max = lvl
            is_isolated = not incoming.get(nid) and not adjacency.get(nid)
            if is_isolated and running_max is not None and lvl < running_max:
                levels[nid] = running_max
                lvl = running_max
            if running_max is None:
                running_max = lvl
            else:
                running_max = max(running_max, lvl)

    lane_offsets = {
        lane_id: float(BASE_LANE_X + LANE_CONTENT_PAD) for lane_id in ordered_lanes
    }

    row_index = {}
    lane_row_counts = {}
    lane_max_node_height = {lane_id: 0 for lane_id in ordered_lanes}
    lane_row_spacing = {}
    lane_has_nodes = {}

    for lane_id in ordered_lanes:
        groups: Dict[int, List[str]] = defaultdict(list)
        for nid, node in nodes_by_id.items():
            if lane_for_node.get(nid, SYSTEM_LANE_ID) != lane_id:
                continue
            col = levels.get(nid, 0)
            groups[col].append(nid)
            size_h = NODE_SIZES.get(node_type.get(nid, "task"), (160, 52))[1]
            lane_max_node_height[lane_id] = max(lane_max_node_height[lane_id], size_h)

        if not groups:
            lane_row_counts[lane_id] = 1
            lane_max_node_height[lane_id] = max(lane_max_node_height[lane_id], 52)
            lane_row_spacing[lane_id] = GRID_Y
            lane_has_nodes[lane_id] = False
            continue

        max_stack = 1
        for col in sorted(groups.keys()):
            node_ids = sorted(groups[col], key=lambda nid: node_order.get(nid, 0))
            count = len(node_ids)
            merge_ids = [
                nid
                for nid in node_ids
                if node_type.get(nid) in GATEWAY_TYPES
                and len(incoming.get(nid, [])) > 1
            ]
            merge_id = merge_ids[0] if merge_ids else None

            if count == 1:
                row_index[node_ids[0]] = 0.0
            elif merge_id:
                row_index[merge_id] = 0.0
                remaining = [nid for nid in node_ids if nid != merge_id]
                branch_offsets = []
                k = 1.0
                while len(branch_offsets) < len(remaining):
                    branch_offsets.extend([float(-k), float(k)])
                    k += 1
                for nid, offset in zip(remaining, branch_offsets):
                    row_index[nid] = float(offset)
            else:
                balanced_offsets = [float(i - (count - 1) / 2) for i in range(count)]
                for nid, offset in zip(node_ids, balanced_offsets):
                    row_index[nid] = float(offset)
            max_stack = max(max_stack, count)
        lane_row_counts[lane_id] = max_stack
        if lane_max_node_height[lane_id] == 0:
            lane_max_node_height[lane_id] = 52
        lane_has_nodes[lane_id] = True

    lane_heights: Dict[str, float] = {}
    lane_y: Dict[str, float] = {}
    current_lane_y = float(BASE_LANE_Y)
    for lane_id in ordered_lanes:
        used_rows = lane_row_counts.get(lane_id, 0)
        if used_rows == 0:
            used_rows = 1
        tallest = lane_max_node_height.get(lane_id, 52)
        if lane_has_nodes.get(lane_id, False) and used_rows == 1:
            row_spacing = float(tallest + ROW_MARGIN)
        else:
            row_spacing = float(max(GRID_Y, tallest + ROW_MARGIN))
        lane_row_spacing[lane_id] = row_spacing
        total_height = float(ROW_MARGIN * 2 + tallest)
        if used_rows > 1:
            total_height += (used_rows - 1) * row_spacing
        if not lane_has_nodes.get(lane_id, False):
            total_height = max(total_height, ROW_MARGIN * 2 + 52)
        height = max(MIN_LANE_HEIGHT, total_height)
        height_with_margin = height + 2 * LANE_MARGIN
        lane_heights[lane_id] = float(height_with_margin)
        lane_y[lane_id] = float(current_lane_y + LANE_MARGIN)
        current_lane_y += height_with_margin

    pos: Dict[str, tuple[float, float, float, float]] = {}
    max_x = 0.0
    for nid, node in nodes_by_id.items():
        lane_id = lane_for_node.get(nid, SYSTEM_LANE_ID)
        col = levels.get(nid, 0)
        ntype = node_type.get(nid, "task")
        width, height = NODE_SIZES.get(ntype, (160, 52))
        lane_offset = float(lane_offsets.get(lane_id, float(BASE_LANE_X)))
        row_value = row_index.get(nid, 0.0)
        # vertikálny základ – použijeme stred lane, aby boli uzly pekne v strede
        base_y = lane_y.get(lane_id, BASE_LANE_Y)
        lane_height = lane_heights.get(lane_id, MIN_LANE_HEIGHT)
        lane_center_y = base_y + lane_height / 2
        x = float(lane_offset + col * GRID_X)
        # Štart event necháme blízko nasledujúceho uzla (inak je hrana zbytočne dlhá)
        if ntype == "startEvent":
            task_ref_w = NODE_SIZES.get("task", (190, 78))[0]
            if task_ref_w > width:
                x += float(task_ref_w - width)
        if ntype == "exclusiveGateway":
            x += GATEWAY_EXTRA_PADDING
        row_spacing = lane_row_spacing.get(
            lane_id, max(GRID_Y, lane_max_node_height.get(lane_id, 52) + ROW_MARGIN)
        )
        # riadky sú rozmiestnené symetricky okolo stredu lane
        y = float(lane_center_y + row_value * row_spacing - height / 2)
        pos[nid] = (x, y, float(width), float(height))
        max_x = max(max_x, x + width)

    for nid, preds in incoming.items():
        if len(preds) < 2:
            continue
        if nid not in pos:
            continue
        # gateway s viacerými vstupmi nechávame na pevnej “hlavnej” osi
        if node_type.get(nid) in GATEWAY_TYPES:
            continue
        pred_centers = []
        pred_right_edges = []
        for pid in preds:
            px = pos.get(pid)
            if not px:
                continue
            pred_centers.append(px[0] + px[2] / 2)
            pred_right_edges.append(px[0] + px[2])
        if not pred_centers:
            continue
        lane_id = lane_for_node.get(nid, SYSTEM_LANE_ID)
        lane_offset = float(lane_offsets.get(lane_id, float(BASE_LANE_X)))
        x, y, width, height = pos[nid]
        avg_center = sum(pred_centers) / len(pred_centers)
        base_x = float(lane_offset + levels.get(nid, 0) * GRID_X)
        center_based = float(avg_center - width / 2)
        min_from_preds = (
            float(max(pred_right_edges) + ROW_MARGIN)
            if pred_right_edges
            else lane_offset
        )
        new_x = max(center_based, float(lane_offset), base_x, min_from_preds)
        pos[nid] = (new_x, y, width, height)

    if pos:
        max_x = max((x + w) for x, y, w, h in pos.values())

    pool_x = 0.0
    pool_y = 0.0
    has_lanes = bool(lanes)
    lane_x = pool_x + (POOL_HEADER_WIDTH if has_lanes else 16)
    lane_width = float(max(620, max_x - lane_x + POOL_PAD_X))
    pool_w = lane_x + lane_width
    # výška poolu = suma lane výšok (už vrátane marginov) + prípadný padding (0)
    pool_h = float(current_lane_y + POOL_PAD_Y)

    if has_lanes:
        lane_width = pool_w - POOL_HEADER_WIDTH

    out_counts = {nid: len(adjacency.get(nid, [])) for nid in nodes_by_id}
    in_counts = {nid: len(incoming.get(nid, [])) for nid in nodes_by_id}
    # pre DI routing – typy uzlov a topologické úrovne
    node_type_map = dict(node_type)

    return {
        "lane_y": lane_y,
        "lane_h_map": lane_heights,
        "lane_w": lane_width,
        "lane_x": lane_x,
        "lane_h": float(MIN_LANE_HEIGHT),
        "lane_order": ordered_lanes,
        "lane_offset_map": lane_offsets,
        "node_pos": pos,
        "pool_bounds": (pool_x, pool_y, pool_w, pool_h),
        "out_counts": out_counts,
        "in_counts": in_counts,
        "lane_for_node": lane_for_node,
        "waypoint_spacing": WAYPOINT_SPACING,
        "levels": levels,
        "node_type_map": node_type_map,
    }


def _normalize_node_type(node: Dict[str, Any]) -> str:
    raw_type = (node.get("type") or "").strip()
    if not raw_type:
        return "task"

    if raw_type in CANONICAL_TYPES:
        return raw_type

    snake_type = raw_type.replace("-", "_").lower()

    if snake_type == "gateway":
        gtype = (node.get("gatewayType") or "exclusive").lower()
        return {
            "exclusive": "exclusiveGateway",
            "parallel": "parallelGateway",
            "inclusive": "inclusiveGateway",
            "event": "eventBasedGateway",
        }.get(gtype, "exclusiveGateway")

    mapped = SNAKE_TO_BPMN_TYPE.get(snake_type)
    if mapped:
        return mapped

    return "task"


def _add_event_definition(parent_el: ET.Element, node: Dict[str, Any]):
    """
    Zapíše vnorenú definíciu eventu podľa node['eventDefinition'].
    - timer:  <timerEventDefinition><timeDuration xsi:type="tFormalExpression">PT48H</timeDuration></timerEventDefinition>
    - message:<messageEventDefinition/>
    - error:  <errorEventDefinition/>
    """
    ev = (node.get("eventDefinition") or "").lower()
    if ev == "timer":
        ted = ET.SubElement(parent_el, T("bpmn", "timerEventDefinition"))
        # podpora ISO8601 alebo raw
        timer = node.get("timer") or {}
        val = (timer.get("iso8601") or timer.get("raw") or "").strip()
        if val:
            time_expr = ET.SubElement(
                ted,
                T("bpmn", "timeDuration"),
                {f"{{{NS['xsi']}}}type": "tFormalExpression"},
            )
            time_expr.text = val
    elif ev == "message":
        ET.SubElement(parent_el, T("bpmn", "messageEventDefinition"))
    elif ev == "error":
        # voliteľne vieš pridať errorRef ak ho niekde spravuješ
        ET.SubElement(parent_el, T("bpmn", "errorEventDefinition"))
    else:
        # nič – neznámy/neuvedený eventDefinition
        pass


# -------------------------------
# DI (BPMNDiagram) – shapes & edges
# -------------------------------
def _add_di(
    defs: ET.Element,
    collab_id: str,
    participant_id: str,
    data,
    layout,
    flows,
    lane_xml_ids,
):
    diagram = ET.SubElement(
        defs, T("bpmndi", "BPMNDiagram"), {"id": "BPMNDiagram_1", "name": data["name"]}
    )
    plane = ET.SubElement(
        diagram,
        T("bpmndi", "BPMNPlane"),
        {"id": "BPMNPlane_1", "bpmnElement": collab_id},
    )

    lane_for_node = layout.get("lane_for_node", {})
    # pool
    px, py, pw, ph = layout["pool_bounds"]
    shp_part = ET.SubElement(
        plane,
        T("bpmndi", "BPMNShape"),
        {
            "id": f"DI_{participant_id}",
            "bpmnElement": participant_id,
            "isHorizontal": "true",
        },
    )
    ET.SubElement(
        shp_part,
        T("dc", "Bounds"),
        {"x": str(px), "y": str(py), "width": str(pw), "height": str(ph)},
    )

    # lanes
    lane_heights = layout.get("lane_h_map", {})
    default_lane_h = layout.get("lane_h", 130)
    lane_width = layout.get("lane_w") or layout.get("pool_bounds", (0, 0, 0, 0))[2]
    lane_x = layout.get("lane_x", 20)
    lane_order = layout.get("lane_order") or [ln["id"] for ln in data["lanes"]]
    lane_lookup = {ln["id"]: ln for ln in data["lanes"] if ln.get("id")}
    emitted_lanes: set[str] = set()
    for lane_id in lane_order:
        ln = lane_lookup.get(lane_id)
        if not ln:
            continue
        xml_lane_id = lane_xml_ids.get(lane_id, lane_id)
        ly = layout["lane_y"].get(lane_id, 40)
        lh = lane_heights.get(lane_id, default_lane_h)
        shp = ET.SubElement(
            plane,
            T("bpmndi", "BPMNShape"),
            {"id": f"DI_{xml_lane_id}", "bpmnElement": xml_lane_id},
        )
        ET.SubElement(
            shp,
            T("dc", "Bounds"),
            {
                "x": str(lane_x),
                "y": str(ly),
                "width": str(lane_width),
                "height": str(lh),
            },
        )
        emitted_lanes.add(lane_id)

    for ln in data["lanes"]:
        lane_id = ln.get("id")
        if not lane_id or lane_id in emitted_lanes:
            continue
        xml_lane_id = lane_xml_ids.get(lane_id, lane_id)
        ly = layout["lane_y"].get(lane_id, 40)
        lh = lane_heights.get(lane_id, default_lane_h)
        shp = ET.SubElement(
            plane,
            T("bpmndi", "BPMNShape"),
            {"id": f"DI_{xml_lane_id}", "bpmnElement": xml_lane_id},
        )
        ET.SubElement(
            shp,
            T("dc", "Bounds"),
            {
                "x": str(lane_x),
                "y": str(ly),
                "width": str(lane_width),
                "height": str(lh),
            },
        )

    # shapes pre uzly
    pos = layout["node_pos"]
    for n in data["nodes"]:
        nid = n["id"]
        x, y, w, h = pos[nid]
        shp = ET.SubElement(
            plane, T("bpmndi", "BPMNShape"), {"id": f"DI_{nid}", "bpmnElement": nid}
        )
        ET.SubElement(
            shp,
            T("dc", "Bounds"),
            {"x": str(x), "y": str(y), "width": str(w), "height": str(h)},
        )

    node_bounds: Dict[str, tuple[float, float, float, float]] = {
        nid: (x, y, x + w, y + h) for nid, (x, y, w, h) in pos.items()
    }
    out_counts = layout.get("out_counts", {})
    in_counts = layout.get("in_counts", {})
    lane_heights = layout.get("lane_h_map", {})
    lane_y_map = layout.get("lane_y", {})
    levels = layout.get("levels", {})
    node_type_map = layout.get("node_type_map", {})

    GRID_Y = 140.0
    H_OFFSET = 80.0
    COLLISION_PADDING = 6.0
    WAYPOINT_SPACING = float(layout.get("waypoint_spacing", 40))

    # Gateway typy pre rozlíšenie hlavných a alternatívnych vetiev
    gateway_types = {
        "exclusiveGateway",
        "parallelGateway",
        "inclusiveGateway",
        "eventBasedGateway",
    }

    # Zostavíme outgoing flows per source, aby sme vedeli nájsť hlavnú vetvu
    outgoing_by_src: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for f in flows:
        src = f.get("source")
        if src:
            outgoing_by_src[src].append(f)

    # main_branch_for_flow[flow_id] = "main" pre hlavnú vetvu z gateway
    main_branch_for_flow: Dict[str, str] = {}
    for src_id, flist in outgoing_by_src.items():
        if node_type_map.get(src_id) not in gateway_types:
            continue
        if len(flist) < 2:
            continue

        def _level_of(flow: Dict[str, Any]) -> int:
            return int(levels.get(flow.get("target"), 0))

        main_flow = max(flist, key=_level_of)
        fid = main_flow.get("id")
        if fid:
            main_branch_for_flow[fid] = "main"

    Point = tuple[float, float]

    def right_mid(nid: str) -> Point:
        x, y, w, h = pos[nid]
        return (x + w, y + h / 2)

    def left_mid(nid: str) -> Point:
        x, y, w, h = pos[nid]
        return (x, y + h / 2)

    def top_mid(nid: str) -> Point:
        x, y, w, h = pos[nid]
        return (x + w / 2, y)

    def bottom_mid(nid: str) -> Point:
        x, y, w, h = pos[nid]
        return (x + w / 2, y + h)

    def lane_center(nid: str) -> float | None:
        lane_id = lane_for_node.get(nid)
        if not lane_id:
            return None
        lane_top = lane_y_map.get(lane_id)
        if lane_top is None:
            return None
        lane_height = lane_heights.get(lane_id, layout.get("lane_h", 130))
        return lane_top + lane_height / 2

    def _dedup(points: List[Point]) -> List[Point]:
        collapsed = [points[0]]
        for pt in points[1:]:
            if pt != collapsed[-1]:
                collapsed.append(pt)
        return collapsed

    def _segment_hits_rect(
        p1: Point,
        p2: Point,
        rect: tuple[float, float, float, float],
    ) -> bool:
        x1, y1 = p1
        x2, y2 = p2
        rx1, ry1, rx2, ry2 = rect
        rx1 -= COLLISION_PADDING
        ry1 -= COLLISION_PADDING
        rx2 += COLLISION_PADDING
        ry2 += COLLISION_PADDING
        if x1 == x2:
            x = x1
            if x <= rx1 or x >= rx2:
                return False
            y_low, y_high = sorted((y1, y2))
            return not (y_high <= ry1 or y_low >= ry2)
        if y1 == y2:
            y = y1
            if y <= ry1 or y >= ry2:
                return False
            x_low, x_high = sorted((x1, x2))
            return not (x_high <= rx1 or x_low >= rx2)
        return False

    def _path_collides(points: List[Point], ignore: set[str]) -> bool:
        for idx in range(len(points) - 1):
            p1, p2 = points[idx], points[idx + 1]
            if p1 == p2:
                continue
            for nid, bounds in node_bounds.items():
                if nid in ignore:
                    continue
                if _segment_hits_rect(p1, p2, bounds):
                    return True
        return False

    def _choose_ports(
        src_id: str, tgt_id: str, branch_kind: str = "main"
    ) -> tuple[Point, Point]:
        src_right = right_mid(src_id)
        src_left = left_mid(src_id)
        tgt_left = left_mid(tgt_id)
        tgt_right = right_mid(tgt_id)

        # Špeciálny režim pre gateways:
        # - hlavná vetva ide doprava (right_mid -> left_mid),
        # - alternatívne vetvy preferujú spodný port (down).
        if node_type_map.get(src_id) in gateway_types:
            if branch_kind == "main":
                return src_right, tgt_left
            src_center = lane_center(src_id)
            tgt_center = lane_center(tgt_id)
            if (
                src_center is not None
                and tgt_center is not None
                and tgt_center > src_center + 1
            ):
                return bottom_mid(src_id), top_mid(tgt_id)
            return bottom_mid(src_id), tgt_left

        src_center = lane_center(src_id)
        tgt_center = lane_center(tgt_id)
        src_lane = lane_for_node.get(src_id)
        tgt_lane = lane_for_node.get(tgt_id)
        if (
            src_center is not None
            and tgt_center is not None
            and abs(src_center - tgt_center) > 1
        ):
            if src_lane == tgt_lane:
                return src_right, tgt_left
            if tgt_center > src_center:
                return bottom_mid(src_id), top_mid(tgt_id)
            if tgt_center < src_center:
                return top_mid(src_id), bottom_mid(tgt_id)

        if src_right[0] <= tgt_left[0]:
            return src_right, tgt_left
        if tgt_right[0] <= src_left[0]:
            return src_left, tgt_right
        return src_right, tgt_left

    def _build_path(
        start_point: Point,
        end_point: Point,
        direction: int,
        offset: float,
        start_shift: float,
        end_shift: float,
    ) -> List[Point]:
        sx, sy = start_point
        tx, ty = end_point
        points: List[Point] = [(sx, sy)]
        current_x, current_y = sx, sy

        if start_shift:
            current_y += start_shift
            points.append((current_x, current_y))

        mid_x = current_x + direction * offset
        if mid_x != current_x or not points:
            points.append((mid_x, current_y))

        target_y = ty + end_shift
        if current_y != target_y:
            points.append((mid_x, target_y))

        if mid_x != tx:
            points.append((tx, target_y))

        if target_y != ty:
            points.append((tx, ty))

        if points[-1] != (tx, ty):
            points.append((tx, ty))

        return _dedup(points)

    def _orthogonal_waypoints(flow: Dict[str, Any]) -> List[Point]:
        src_id = flow["source"]
        tgt_id = flow["target"]
        flow_id = flow["id"]

        # default = alternatívna vetva; ak je označená ako main, berieme ju ako hlavnú
        branch_kind = "main" if main_branch_for_flow.get(flow_id) == "main" else "alt"
        src_type = node_type_map.get(src_id)
        is_gateway_src = src_type in gateway_types

        def _l_path(start_point: Point, end_point: Point, horizontal_first: bool) -> List[Point]:
            sx, sy = start_point
            tx, ty = end_point
            if horizontal_first:
                return _dedup([(sx, sy), (tx, sy), (tx, ty)])
            return _dedup([(sx, sy), (sx, ty), (tx, ty)])

        def _gateway_l_path(start_point: Point, end_point: Point) -> List[Point]:
            sx, sy = start_point
            tx, ty = end_point
            delta_x = tx - sx
            if delta_x <= WAYPOINT_SPACING:
                return _l_path(start_point, end_point, horizontal_first=True)
            elbow_x = sx + min(H_OFFSET, delta_x - WAYPOINT_SPACING)
            return _dedup([(sx, sy), (elbow_x, sy), (elbow_x, ty), (tx, ty)])

        if src_id == tgt_id:
            sx, sy = right_mid(src_id)
            loop_x = sx + H_OFFSET
            loop_y = sy - GRID_Y
            if loop_y < 0:
                loop_y = sy + GRID_Y
            return _dedup(
                [
                    (sx, sy),
                    (loop_x, sy),
                    (loop_x, loop_y),
                    (sx, loop_y),
                    (sx, sy),
                ]
            )

        # ŠPECIÁLNY PRÍPAD: alternatívna vetva z gateway – chceme čisté “L” dole a späť
        if is_gateway_src and branch_kind == "alt":
            start_point = right_mid(src_id)
            end_point = left_mid(tgt_id)
            ignore = {src_id, tgt_id}
            path = _gateway_l_path(start_point, end_point)
            if not _path_collides(path, ignore):
                return path
            path = _l_path(start_point, end_point, horizontal_first=True)
            if not _path_collides(path, ignore):
                return path
            path = _l_path(start_point, end_point, horizontal_first=False)
            if not _path_collides(path, ignore):
                return path

        # special case: cross-lane flow from non-gateway node
        tgt_is_gateway = node_type_map.get(tgt_id) in gateway_types
        if not is_gateway_src and tgt_is_gateway:
            start_point = right_mid(src_id)
            end_point = left_mid(tgt_id)
            ignore = {src_id, tgt_id}
            path = _gateway_l_path(start_point, end_point)
            if not _path_collides(path, ignore):
                return path
            path = _l_path(start_point, end_point, horizontal_first=True)
            if not _path_collides(path, ignore):
                return path

        src_lane = lane_for_node.get(src_id)
        tgt_lane = lane_for_node.get(tgt_id)
        if (
            not is_gateway_src
            and src_lane is not None
            and tgt_lane is not None
            and src_lane != tgt_lane
        ):
            start_point, end_point = _choose_ports(src_id, tgt_id, branch_kind)
            ignore = {src_id, tgt_id}
            sx, sy = start_point
            tx, ty = end_point

            src_center = lane_center(src_id)
            tgt_center = lane_center(tgt_id)
            mid_y_cross: float
            if src_center is not None and tgt_center is not None:
                mid_y_cross = (src_center + tgt_center) / 2.0
            else:
                mid_y_cross = (sy + ty) / 2.0

            path = [
                (sx, sy),
                (sx, mid_y_cross),
                (tx, mid_y_cross),
                (tx, ty),
            ]
            if not _path_collides(path, ignore):
                return _dedup(path)

        # ŠPECIÁLNY PRÍPAD: hlavná vetva z gateway – preferujeme priamu čiaru doprava
        if is_gateway_src and branch_kind == "main":
            start_point, end_point = _choose_ports(src_id, tgt_id, branch_kind)
            ignore = {src_id, tgt_id}
            path = _gateway_l_path(start_point, end_point)
            if not _path_collides(path, ignore):
                return path
            path = _l_path(start_point, end_point, horizontal_first=True)
            if not _path_collides(path, ignore):
                return path
            path = _l_path(start_point, end_point, horizontal_first=False)
            if not _path_collides(path, ignore):
                return path
            # ak je kolizia, este to neskor skusi genericky algoritmus

        # GENERICKÝ PRÍPAD – všetko ostatné (vrátane nongateway vetiev)
        start_point, end_point = _choose_ports(src_id, tgt_id, branch_kind)
        ignore = {src_id, tgt_id}
        sx, sy = start_point
        tx, ty = end_point
        straight_path: List[Point] | None = None
        if abs(sy - ty) <= 1:
            straight_candidate = [start_point, end_point]
            if not _path_collides(straight_candidate, ignore):
                straight_path = straight_candidate
        if straight_path is None and abs(sx - tx) <= 1:
            straight_candidate = [start_point, end_point]
            if not _path_collides(straight_candidate, ignore):
                straight_path = straight_candidate
        if straight_path is not None:
            return straight_path
        direction = 1 if end_point[0] >= start_point[0] else -1
        fan_out = out_counts.get(src_id, 0)
        fan_in = in_counts.get(tgt_id, 0)
        branch_mode = fan_out > 1 or fan_in > 1
        base_offset = float(H_OFFSET + (60 if branch_mode else 0))
        offset = float(max(base_offset, abs(end_point[0] - start_point[0]) / 2))
        vertical_step = float(max(GRID_Y / 3, 40))
        preferred_attempts: List[tuple[float, float]] = []
        src_center = lane_center(src_id)
        tgt_center = lane_center(tgt_id)
        if src_center is not None and tgt_center is not None:
            vertical_diff = tgt_center - src_center
            if abs(vertical_diff) > 1:
                base_shift = vertical_step if vertical_diff > 0 else -vertical_step
                preferred_attempts.append((base_shift, -base_shift))
        # Snažíme sa udržať čisté L/Z tvary:
        # najprv skúšame bez vertikálneho posunu, potom malé ± posuny.
        attempts: List[tuple[float, float]] = preferred_attempts + [
            (0.0, 0.0),
            (vertical_step, 0.0),
            (-vertical_step, 0.0),
            (0.0, vertical_step),
            (0.0, -vertical_step),
        ]

        for start_shift, end_shift in attempts:
            path = _build_path(
                start_point,
                end_point,
                direction,
                offset + WAYPOINT_SPACING,
                start_shift,
                end_shift,
            )
            if not _path_collides(path, ignore):
                return path

        return _dedup([start_point, end_point])

    for f in flows:
        fid = f["id"]
        points = _orthogonal_waypoints(f)
        e = ET.SubElement(
            plane, T("bpmndi", "BPMNEdge"), {"id": f"Edge_{fid}", "bpmnElement": fid}
        )
        for px, py in points:
            ET.SubElement(e, T("di", "waypoint"), {"x": str(px), "y": str(py)})

        label_text = f.get("name") or f.get("label")
        if label_text:
            horizontal_segments = [
                ((p1[0] + p2[0]) / 2, p1[1])
                for p1, p2 in zip(points, points[1:])
                if p1[1] == p2[1]
            ]
            if horizontal_segments:
                mid_x, mid_y = horizontal_segments[len(horizontal_segments) // 2]
                label = ET.SubElement(e, T("bpmndi", "BPMNLabel"))
                ET.SubElement(
                    label,
                    T("dc", "Bounds"),
                    {
                        "x": str(int(mid_x) - 40),
                        "y": str(int(mid_y) - 10),
                        "width": "80",
                        "height": "20",
                    },
                )


# Target namespace for the generated BPMN definitions
TARGET_NS = "http://bpmn.gen/definitions"


# -------------------------------
# Core: JSON -> BPMN XML
# -------------------------------
def json_to_bpmn(data: Dict[str, Any]) -> str:
    defs_id = data.get("definitionsId", "Definitions_1")
    proc_id = data.get("processId", "Process_1")
    proc_name = data.get("name") or data.get("processName") or "Generated Process"

    nodes: List[Dict[str, Any]] = data.get("nodes") or []
    flows: List[Dict[str, Any]] = data.get("flows") or []
    lanes: List[Dict[str, Any]] = data.get("lanes") or []
    if not lanes:
        lane_ids = sorted({node.get("laneId", "Lane_1") for node in nodes}) or [
            "Lane_1"
        ]
        lanes = [{"id": lane_id, "name": lane_id} for lane_id in lane_ids]

    lane_index = {lane["id"]: lane for lane in lanes if lane.get("id")}
    system_lane_id = "Lane_System"
    system_lane_name = "System"
    system_needed = False
    for node in nodes:
        lane_id = (node.get("laneId") or "").strip()
        if not lane_id or lane_id not in lane_index:
            node["laneId"] = system_lane_id
            system_needed = True
    if system_needed and system_lane_id not in lane_index:
        system_lane = {"id": system_lane_id, "name": system_lane_name}
        lanes.append(system_lane)
        lane_index[system_lane_id] = system_lane

    normalized_data = dict(data)
    normalized_data.update(
        {
            "definitionsId": defs_id,
            "processId": proc_id,
            "processName": proc_name,
            "nodes": nodes,
            "flows": flows,
            "lanes": lanes,
        }
    )
    normalized_data.setdefault("name", proc_name)

    defs = ET.Element(
        T("bpmn", "definitions"),
        {
            "id": defs_id,
            "targetNamespace": TARGET_NS,
        },
    )

    process = ET.SubElement(
        defs,
        T("bpmn", "process"),
        {"id": proc_id, "name": proc_name, "isExecutable": "false"},
    )

    lane_elems = {}
    lane_xml_ids = {}
    if lanes:
        lane_set = ET.SubElement(process, T("bpmn", "laneSet"), {"id": "LaneSet_1"})
        used_lane_ids = set()

        def slugify(value: str) -> str:
            value = (value or "").strip()
            value = re.sub(r"\s+", "_", value)
            value = re.sub(r"[^A-Za-z0-9_]", "", value)
            return value or "Lane"

        for idx, ln in enumerate(lanes, start=1):
            if "id" not in ln or "name" not in ln:
                raise ValueError("Každá lane musí mať 'id' a 'name'.")
            base_name = ln.get("name") or ln.get("id") or f"Lane_{idx}"
            lane_bpmn_id = slugify(base_name)
            xml_lane_id = lane_bpmn_id
            attempt = 1
            while xml_lane_id in used_lane_ids:
                xml_lane_id = f"{lane_bpmn_id}_{attempt}"
                attempt += 1
            used_lane_ids.add(xml_lane_id)
            lane_xml_ids[ln["id"]] = xml_lane_id
            lane_elems[ln["id"]] = ET.SubElement(
                lane_set,
                T("bpmn", "lane"),
                {"id": xml_lane_id, "name": ln["name"]},
            )
    node_ids = set()
    for n in nodes:
        for key in ["id", "type", "laneId", "name"]:
            if key not in n:
                raise ValueError(f"Node {n} chýba kľúč: {key}")
        nid = n["id"]
        node_ids.add(nid)

        ntype = _normalize_node_type(n)

        if ntype == "startEvent":
            ET.SubElement(
                process, T("bpmn", "startEvent"), {"id": nid, "name": n["name"]}
            )

        elif ntype == "endEvent":
            ET.SubElement(
                process, T("bpmn", "endEvent"), {"id": nid, "name": n["name"]}
            )

        elif ntype in ("task", "userTask", "serviceTask"):
            ET.SubElement(process, T("bpmn", ntype), {"id": nid, "name": n["name"]})

        elif ntype in (
            "exclusiveGateway",
            "parallelGateway",
            "inclusiveGateway",
            "eventBasedGateway",
        ):
            ET.SubElement(process, T("bpmn", ntype), {"id": nid, "name": n["name"]})

        elif ntype in ("intermediateCatchEvent", "intermediateThrowEvent"):
            el = ET.SubElement(
                process, T("bpmn", ntype), {"id": nid, "name": n["name"]}
            )
            _add_event_definition(el, n)

        elif ntype == "subProcess":
            ET.SubElement(
                process, T("bpmn", "subProcess"), {"id": nid, "name": n["name"]}
            )

        else:
            ET.SubElement(process, T("bpmn", "task"), {"id": nid, "name": n["name"]})

    for f in flows:
        for key in ["id", "source", "target"]:
            if key not in f:
                raise ValueError(f"Flow {f} chýba kľúč: {key}")
        if f["source"] not in node_ids or f["target"] not in node_ids:
            raise ValueError(f"Flow {f['id']} odkazuje na neexistujúci uzol.")
        attrs = {"id": f["id"], "sourceRef": f["source"], "targetRef": f["target"]}
        # >>> Dôležité: ak flow nemá 'name', ale má 'label', použijeme label
        flow_name = f.get("name") or f.get("label")
        if flow_name:
            attrs["name"] = flow_name
        flow_el = ET.SubElement(process, T("bpmn", "sequenceFlow"), attrs)

        cond = f.get("condition")
        if cond:
            ce = ET.SubElement(
                flow_el,
                T("bpmn", "conditionExpression"),
                {f"{{{NS['xsi']}}}type": "tFormalExpression"},
            )
            ce.text = cond

    for n in nodes:
        ln_elem = lane_elems.get(n["laneId"])
        if ln_elem is None:
            raise ValueError(
                f"Lane element pre node {n['id']} neexistuje (laneId={n['laneId']})."
            )
        ET.SubElement(ln_elem, T("bpmn", "flowNodeRef")).text = n["id"]

    collab_id = "Collab_1"
    participant_id = "Participant_1"
    collab = ET.SubElement(defs, T("bpmn", "collaboration"), {"id": collab_id})
    ET.SubElement(
        collab,
        T("bpmn", "participant"),
        {"id": participant_id, "name": proc_name, "processRef": proc_id},
    )

    layout = _build_layout(normalized_data)
    _add_di(
        defs,
        collab_id,
        participant_id,
        normalized_data,
        layout,
        flows,
        lane_xml_ids,
    )

    defs.set("layoutVersion", LAYOUT_VERSION)
    return _xml_to_string(defs)


# -------------------------------
# Public hook (kompatibilný)
# -------------------------------
def generate_bpmn_from_json(data: dict) -> str:
    # zober locale z requestu, ak je; inak SK
    locale = (data.get("locale") or "sk").lower()
    data = postprocess_engine_json(data, locale=locale)
    return json_to_bpmn(data)
