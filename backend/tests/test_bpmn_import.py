from fastapi.testclient import TestClient

from main import app
from services.bpmn_import import bpmn_xml_to_engine


client = TestClient(app)


BPMN_XML = """<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             id="Defs_1">
  <process id="Process_1" name="Import Test" isExecutable="false">
    <laneSet id="LaneSet_1">
      <lane id="Lane_A" name="Lane A">
        <flowNodeRef>Task_1</flowNodeRef>
        <flowNodeRef>EndEvent_1</flowNodeRef>
      </lane>
    </laneSet>
    <startEvent id="StartEvent_1" name="Start" />
    <task id="Task_1" name="Task A" />
    <exclusiveGateway id="Gateway_1" name="Decision" />
    <sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Gateway_1" />
    <sequenceFlow id="Flow_2" sourceRef="Gateway_1" targetRef="Task_1">
      <conditionExpression xsi:type="tFormalExpression">x &gt; 5</conditionExpression>
    </sequenceFlow>
    <endEvent id="EndEvent_1" name="End" />
    <sequenceFlow id="Flow_3" sourceRef="Task_1" targetRef="EndEvent_1" />
  </process>
</definitions>
"""


def test_bpmn_xml_to_engine_basic_mapping():
    engine = bpmn_xml_to_engine(BPMN_XML)
    assert engine["processId"] == "Process_1"
    assert engine["name"] == "Import Test"
    lanes = {lane["id"]: lane for lane in engine["lanes"]}
    assert "Lane_A" in lanes

    nodes_by_id = {n["id"]: n for n in engine["nodes"]}
    assert nodes_by_id["StartEvent_1"]["type"] == "startEvent"
    assert nodes_by_id["Gateway_1"]["type"] == "exclusiveGateway"
    assert nodes_by_id["Task_1"]["laneId"] == "Lane_A"
    assert nodes_by_id["EndEvent_1"]["laneId"] == "Lane_A"

    flows_by_id = {f["id"]: f for f in engine["flows"]}
    assert flows_by_id["Flow_2"]["condition"] == "x > 5"
    assert flows_by_id["Flow_1"]["source"] == "StartEvent_1"
    assert flows_by_id["Flow_1"]["target"] == "Gateway_1"


def test_import_endpoint_returns_engine_json():
    resp = client.post(
        "/wizard/import-bpmn",
        files={"file": ("test.bpmn", BPMN_XML, "application/xml")},
    )
    assert resp.status_code == 200
    data = resp.json()
    engine = data.get("engine_json")
    assert engine and engine.get("processId") == "Process_1"
    assert any(n.get("type") == "exclusiveGateway" for n in engine.get("nodes", []))
