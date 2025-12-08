import xml.etree.ElementTree as ET
from typing import Any, Dict, List

# Minimal BPMN XML -> engine_json prevod pre wizard import.
# Podporuje lanes, start/end/task/userTask/serviceTask, exclusive/parallel/inclusive gateways a sequenceFlow.


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def bpmn_xml_to_engine(xml_text: str) -> Dict[str, Any]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid BPMN XML: {exc}") from exc

    process_el = None
    for el in root.iter():
        if _local(el.tag) == "process":
            process_el = el
            break
    if process_el is None:
        raise ValueError("BPMN XML neobsahuje <process>")

    process_id = process_el.get("id") or "Process_Imported"
    process_name = process_el.get("name") or process_id

    lanes: List[Dict[str, Any]] = []
    lane_map: Dict[str, str] = {}

    lane_set = next((child for child in process_el if _local(child.tag) == "laneSet"), None)
    if lane_set is not None:
        for lane in lane_set:
            if _local(lane.tag) != "lane":
                continue
            lid = lane.get("id") or f"Lane_{len(lanes) + 1}"
            lname = lane.get("name") or lid
            lanes.append({"id": lid, "name": lname})
            for fn_ref in lane.findall(".//{*}flowNodeRef"):
                ref_id = (fn_ref.text or "").strip()
                if ref_id:
                    lane_map[ref_id] = lid

    nodes: List[Dict[str, Any]] = []
    nodes_by_id: Dict[str, Dict[str, Any]] = {}

    known_types = {
        "startEvent": "startEvent",
        "endEvent": "endEvent",
        "task": "task",
        "userTask": "userTask",
        "serviceTask": "serviceTask",
        "exclusiveGateway": "exclusiveGateway",
        "parallelGateway": "parallelGateway",
        "inclusiveGateway": "inclusiveGateway",
    }

    for child in process_el:
        tag = _local(child.tag)
        if tag in {"laneSet", "sequenceFlow"}:
            continue
        node_id = child.get("id")
        if not node_id:
            continue
        node_type = known_types.get(tag)
        node_name = child.get("name") or node_id

        meta: Dict[str, Any] | None = None
        if node_type is None:
            node_type = "task"
            meta = {"original_tag": tag, "note": "unsupported element converted to task"}

        node_payload: Dict[str, Any] = {
            "id": node_id,
            "type": node_type,
            "name": node_name,
            "laneId": "",
        }
        if meta:
            node_payload["meta"] = meta

        nodes.append(node_payload)
        nodes_by_id[node_id] = node_payload

    flows: List[Dict[str, Any]] = []
    for seq in process_el.findall(".//{*}sequenceFlow"):
        fid = seq.get("id") or f"Flow_{len(flows) + 1}"
        src = seq.get("sourceRef") or ""
        tgt = seq.get("targetRef") or ""
        flow_name = seq.get("name")

        cond_text = None
        cond_el = next((c for c in seq if _local(c.tag) == "conditionExpression"), None)
        if cond_el is not None and cond_el.text:
            cond_text = cond_el.text.strip()

        flow_payload: Dict[str, Any] = {
            "id": fid,
            "source": src,
            "target": tgt,
        }
        if flow_name:
            flow_payload["name"] = flow_name
        if cond_text:
            flow_payload["condition"] = cond_text

        flows.append(flow_payload)

        # Ak sequenceFlow odkazuje na neznámy uzol, vytvor placeholder task
        for nid in (src, tgt):
            if nid and nid not in nodes_by_id:
                placeholder = {
                    "id": nid,
                    "type": "task",
                    "name": nid,
                    "laneId": "",
                    "meta": {"note": "created from sequenceFlow endpoint"},
                }
                nodes.append(placeholder)
                nodes_by_id[nid] = placeholder

    # Ak neexistujú lanes, pridaj default
    if not lanes:
        lanes.append({"id": "Lane_Imported", "name": "Imported"})

    default_lane_id = lanes[0]["id"]
    for node in nodes:
        nid = node["id"]
        node["laneId"] = lane_map.get(nid, default_lane_id)

    engine_json: Dict[str, Any] = {
        "processId": process_id,
        "name": process_name,
        "lanes": lanes,
        "nodes": nodes,
        "flows": flows,
    }
    return engine_json
