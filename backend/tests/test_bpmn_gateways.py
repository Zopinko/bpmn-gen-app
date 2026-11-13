# tests/test_bpmn_gateways.py
from xml.etree import ElementTree as ET

from services.bpmn_svc import generate_bpmn_from_json  # predpokladané API
from services.bpmn_import import bpmn_xml_to_engine


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


def _seq_flow_name(root, source: str, target: str) -> str | None:
    def _local(tag: str) -> str:
        return tag.split("}")[-1]

    for el in root.iter():
        if _local(el.tag) == "sequenceFlow":
            if (
                el.attrib.get("sourceRef") == source
                and el.attrib.get("targetRef") == target
            ):
                return el.attrib.get("name")
    return None


def test_bpmn_round_trip_keeps_default_branch_and_distinct_end_events():
    xml = """<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
      <process id="Process_1" name="Invoice review">
        <startEvent id="start"/>
        <exclusiveGateway id="decision" default="fallback"/>
        <task id="approve"/>
        <endEvent id="approved"/>
        <endEvent id="rejected"/>
        <sequenceFlow id="start_flow" sourceRef="start" targetRef="decision"/>
        <sequenceFlow id="condition" sourceRef="decision" targetRef="approve">
          <conditionExpression>amount &gt; 5</conditionExpression>
        </sequenceFlow>
        <sequenceFlow id="done" sourceRef="approve" targetRef="approved"/>
        <sequenceFlow id="fallback" sourceRef="decision" targetRef="rejected"/>
      </process>
    </definitions>"""

    imported = bpmn_xml_to_engine(xml)
    assert [flow["id"] for flow in imported["flows"] if flow.get("default")] == ["fallback"]
    rendered = generate_bpmn_from_json(imported)
    root = _root(rendered)
    assert root.find(".//{*}exclusiveGateway").get("default") == "fallback"
    reopened = bpmn_xml_to_engine(rendered)
    assert {node["id"] for node in reopened["nodes"] if node["type"] == "endEvent"} == {"approved", "rejected"}
    assert {(f["id"], f["source"], f["target"], f.get("condition"), f.get("default")) for f in reopened["flows"]} == {
        (f["id"], f["source"], f["target"], f.get("condition"), f.get("default")) for f in imported["flows"]
    }


def test_renderer_keeps_existing_gateway_join_as_end_event_predecessor():
    lane = {"id": "lane_1", "name": "Operations"}
    engine = {
        "processId": "Process_1", "name": "Parallel work", "lanes": [lane],
        "nodes": [
            {"id": node_id, "type": kind, "name": node_id, "laneId": lane["id"]}
            for node_id, kind in [("task_1", "task"), ("task_2", "task"), ("join", "parallelGateway"), ("end", "endEvent")]
        ],
        "flows": [
            {"id": f"f_{source}", "source": source, "target": target}
            for source, target in [("task_1", "join"), ("task_2", "join"), ("join", "end")]
        ],
    }

    root = _root(generate_bpmn_from_json(engine))
    assert _has_seq_flow(root, "join", "end")
    assert not _has_seq_flow(root, "task_2", "end")


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


def test_exclusive_gateway_defaults_to_yes_no_in_english_locale():
    engine = {
        "locale": "en",
        "nodes": [
            {"id": "start", "type": "startEvent", "name": "Start", "laneId": "L1"},
            {"id": "gw_x", "type": "exclusiveGateway", "name": "Decision", "laneId": "L1"},
            {"id": "A", "type": "task", "name": "Approve", "laneId": "L1"},
            {"id": "B", "type": "task", "name": "Reject", "laneId": "L1"},
        ],
        "flows": [
            {"id": "f1", "source": "start", "target": "gw_x"},
            {"id": "f2", "source": "gw_x", "target": "A"},
            {"id": "f3", "source": "gw_x", "target": "B"},
        ],
    }

    xml_text = generate_bpmn_from_json(engine)
    r = _root(xml_text)

    assert _seq_flow_name(r, "gw_x", "A") == "Yes"
    assert _seq_flow_name(r, "gw_x", "B") == "No"
