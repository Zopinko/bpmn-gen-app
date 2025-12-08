# tests/test_bpmn_gateways.py
from xml.etree import ElementTree as ET

from services.bpmn_svc import generate_bpmn_from_json  # predpokladané API


def _root(xml_text: str):
    return ET.fromstring(xml_text)


def _count(root, local_name: str) -> int:
    def _local(tag: str) -> str:
        return tag.split("}")[-1]  # ignoruj namespace, ak je typu {ns}tag

    return sum(1 for el in root.iter() if _local(el.tag) == local_name)


def _has_seq_flow(root, source: str, target: str) -> bool:
    def _local(tag: str) -> str:
        return tag.split("}")[-1]

    for el in root.iter():
        if _local(el.tag) == "sequenceFlow":
            if (
                el.attrib.get("sourceRef") == source
                and el.attrib.get("targetRef") == target
            ):
                return True
    return False


def test_xor_split_join():
    engine = {
        "nodes": [
            {"id": "start", "type": "startEvent", "name": "Start", "laneId": "L1"},
            {
                "id": "gw_x",
                "type": "exclusiveGateway",
                "name": "Decision",
                "laneId": "L1",
            },
            {"id": "A", "type": "task", "name": "Path A", "laneId": "L1"},
            {"id": "B", "type": "task", "name": "Path B", "laneId": "L1"},
            {
                "id": "gw_x_join",
                "type": "exclusiveGateway",
                "name": "Join",
                "laneId": "L1",
            },
            {"id": "end", "type": "endEvent", "name": "End", "laneId": "L1"},
        ],
        "flows": [
            {"id": "f1", "source": "start", "target": "gw_x"},
            {"id": "f2", "source": "gw_x", "target": "A", "gw_id": "x1"},
            {"id": "f3", "source": "gw_x", "target": "B", "gw_id": "x1"},
            {"id": "f4", "source": "A", "target": "gw_x_join", "gw_id": "x1"},
            {"id": "f5", "source": "B", "target": "gw_x_join", "gw_id": "x1"},
            {"id": "f6", "source": "gw_x_join", "target": "end"},
        ],
    }
    xml_text = generate_bpmn_from_json(engine)
    r = _root(xml_text)
    assert _count(r, "exclusiveGateway") == 2
    assert _has_seq_flow(r, "gw_x", "A")
    assert _has_seq_flow(r, "gw_x", "B")
    assert _has_seq_flow(r, "A", "gw_x_join")
    assert _has_seq_flow(r, "B", "gw_x_join")


def test_and_split_join():
    engine = {
        "nodes": [
            {"id": "start", "type": "startEvent", "name": "Start", "laneId": "L1"},
            {"id": "gw_p", "type": "parallelGateway", "name": "Fork", "laneId": "L1"},
            {"id": "C1", "type": "task", "name": "Task 1", "laneId": "L1"},
            {"id": "C2", "type": "task", "name": "Task 2", "laneId": "L1"},
            {"id": "C3", "type": "task", "name": "Task 3", "laneId": "L1"},
            {
                "id": "gw_p_join",
                "type": "parallelGateway",
                "name": "Join",
                "laneId": "L1",
            },
            {"id": "end", "type": "endEvent", "name": "End", "laneId": "L1"},
        ],
        "flows": [
            {"id": "f1", "source": "start", "target": "gw_p"},
            {"id": "f2", "source": "gw_p", "target": "C1", "gw_id": "p1"},
            {"id": "f3", "source": "gw_p", "target": "C2", "gw_id": "p1"},
            {"id": "f4", "source": "gw_p", "target": "C3", "gw_id": "p1"},
            {"id": "f5", "source": "C1", "target": "gw_p_join", "gw_id": "p1"},
            {"id": "f6", "source": "C2", "target": "gw_p_join", "gw_id": "p1"},
            {"id": "f7", "source": "C3", "target": "gw_p_join", "gw_id": "p1"},
            {"id": "f8", "source": "gw_p_join", "target": "end"},
        ],
    }
    xml_text = generate_bpmn_from_json(engine)
    r = _root(xml_text)
    assert _count(r, "parallelGateway") == 2
    assert _has_seq_flow(r, "gw_p", "C1")
    assert _has_seq_flow(r, "gw_p", "C2")
    assert _has_seq_flow(r, "gw_p", "C3")


def test_inclusive_split_join():
    engine = {
        "nodes": [
            {"id": "start", "type": "startEvent", "name": "Start", "laneId": "L1"},
            {
                "id": "gw_o",
                "type": "inclusiveGateway",
                "name": "Decide",
                "laneId": "L1",
            },
            {"id": "D1", "type": "task", "name": "Option 1", "laneId": "L1"},
            {"id": "D2", "type": "task", "name": "Option 2", "laneId": "L1"},
            {
                "id": "gw_o_join",
                "type": "inclusiveGateway",
                "name": "Join",
                "laneId": "L1",
            },
            {"id": "end", "type": "endEvent", "name": "End", "laneId": "L1"},
        ],
        "flows": [
            {"id": "f1", "source": "start", "target": "gw_o"},
            {"id": "f2", "source": "gw_o", "target": "D1", "gw_id": "o1"},
            {"id": "f3", "source": "gw_o", "target": "D2", "gw_id": "o1"},
            {"id": "f4", "source": "D1", "target": "gw_o_join", "gw_id": "o1"},
            {"id": "f5", "source": "D2", "target": "gw_o_join", "gw_id": "o1"},
            {"id": "f6", "source": "gw_o_join", "target": "end"},
        ],
    }
    xml_text = generate_bpmn_from_json(engine)
    r = _root(xml_text)
    assert _count(r, "inclusiveGateway") == 2
    assert _has_seq_flow(r, "gw_o", "D1")
    assert _has_seq_flow(r, "gw_o", "D2")
