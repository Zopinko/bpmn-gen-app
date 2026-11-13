from services.bpmn_svc import generate_bpmn_from_json
from services.bpmn_import import bpmn_xml_to_engine
import xml.etree.ElementTree as ET


NS = {
    "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
    "dc": "http://www.omg.org/spec/DD/20100524/DC",
    "di": "http://www.omg.org/spec/DD/20100524/DI",
}


def test_generate_bpmn_includes_engine_ids():
    engine = {
        "processId": "Process_1",
        "name": "Test",
        "lanes": [
            {"id": "Lane_A", "name": "Role A"},
            {"id": "Lane_B", "name": "Role B"},
        ],
        "nodes": [
            {"id": "Start_1", "type": "startEvent", "laneId": "Lane_A", "name": "Start"},
            {"id": "Task_1", "type": "task", "laneId": "Lane_A", "name": "Step A"},
            {"id": "End_1", "type": "endEvent", "laneId": "Lane_B", "name": "End"},
        ],
        "flows": [
            {"source": "Start_1", "target": "Task_1"},
            {"id": "Flow_1", "source": "Task_1", "target": "End_1"},
        ],
    }

    xml = generate_bpmn_from_json(engine)
    assert 'data-engine-id="Start_1"' in xml
    assert 'data-engine-id="Task_1"' in xml
    assert 'data-engine-id="End_1"' in xml
    assert 'data-engine-id="Flow_1"' in xml
    assert 'data-engine-id="F_Start_1_Task_1_0"' in xml


def test_start_event_label_bounds_stay_attached_after_first_task():
    engine = {
        "processId": "Process_1",
        "name": "Test",
        "lanes": [{"id": "Lane_A", "name": "Role A"}],
        "nodes": [
            {"id": "Start_1", "type": "startEvent", "laneId": "Lane_A", "name": "Start"},
            {"id": "Task_1", "type": "task", "laneId": "Lane_A", "name": "First task"},
        ],
        "flows": [{"id": "Flow_1", "source": "Start_1", "target": "Task_1"}],
    }

    root = ET.fromstring(generate_bpmn_from_json(engine))
    start_shape = root.find(".//bpmndi:BPMNShape[@bpmnElement='Start_1']", NS)
    assert start_shape is not None
    start_bounds = start_shape.find("dc:Bounds", NS)
    label_bounds = start_shape.find("bpmndi:BPMNLabel/dc:Bounds", NS)

    assert start_bounds is not None
    assert label_bounds is not None

    event_x = float(start_bounds.attrib["x"])
    event_y = float(start_bounds.attrib["y"])
    event_w = float(start_bounds.attrib["width"])
    event_h = float(start_bounds.attrib["height"])
    label_x = float(label_bounds.attrib["x"])
    label_y = float(label_bounds.attrib["y"])
    label_w = float(label_bounds.attrib["width"])

    event_center_x = event_x + event_w / 2
    label_center_x = label_x + label_w / 2
    flow_edge = root.find(".//bpmndi:BPMNEdge[@bpmnElement='Flow_1']", NS)
    flow_y = float(flow_edge.find("di:waypoint", NS).attrib["y"])

    assert abs(label_center_x - event_center_x) <= 0.5
    assert label_y == event_y + event_h + 2
    assert label_y > flow_y + 12


def test_lane_id_round_trip_does_not_collide_with_node_or_di_ids():
    engine = {
        "processId": "Process_1", "name": "Test",
        "lanes": [{"id": "lane_original", "name": "Task_1"}],
        "nodes": [
            {"id": "Task_1", "type": "task", "name": "First task", "laneId": "lane_original"},
            {"id": "DI_Task_1", "type": "endEvent", "name": "End", "laneId": "lane_original"},
        ],
        "flows": [{"id": "Flow_1", "source": "Task_1", "target": "DI_Task_1"}],
    }

    xml = generate_bpmn_from_json(engine)
    root = ET.fromstring(xml)
    ids = [element.get("id") for element in root.iter() if element.get("id")]
    assert len(ids) == len(set(ids))
    imported = bpmn_xml_to_engine(xml)
    assert imported["lanes"] == engine["lanes"]
    assert {node["laneId"] for node in imported["nodes"]} == {"lane_original"}
