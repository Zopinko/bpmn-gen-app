from fastapi.testclient import TestClient
from xml.etree import ElementTree as ET

from main import app
from services import model_storage
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


def test_import_endpoint_rejects_oversized_upload():
    oversized_xml = "<definitions>" + ("A" * 1_100_000) + "</definitions>"

    resp = client.post(
        "/wizard/import-bpmn",
        files={"file": ("large.bpmn", oversized_xml, "application/xml")},
    )

    assert resp.status_code == 413
    assert "too large" in resp.json()["detail"].lower()


def test_imported_manual_positions_survive_saving_and_reopening(tmp_path, monkeypatch):
    monkeypatch.setattr(model_storage, "_base_dir", tmp_path)
    source = client.post("/wizard/import-bpmn", files={"file": ("test.bpmn", BPMN_XML, "application/xml")})
    assert source.status_code == 200
    rendered = client.post("/generate", json=source.json()["engine_json"])
    assert rendered.status_code == 200
    diagram = ET.fromstring(rendered.text)
    task_shape = diagram.find(".//{*}BPMNShape[@bpmnElement='Task_1']")
    task_shape.find("{*}Bounds").set("x", "1234")
    xml = ET.tostring(diagram, encoding="utf-8")

    response = client.post(
        "/wizard/import-bpmn?include_xml=true",
        files={"file": ("positioned.bpmn", xml, "application/xml")},
    )

    assert response.status_code == 200
    imported = response.json()
    assert imported["diagram_xml"] == xml.decode("utf-8")
    assert imported["engine_json"] == source.json()["engine_json"]

    saved = client.post("/wizard/models", json={**imported, "name": "Positioned process"})
    assert saved.status_code == 200
    reopened = client.get(f"/wizard/models/{saved.json()['id']}")
    assert reopened.status_code == 200
    assert reopened.json()["diagram_xml"] == imported["diagram_xml"]
    assert reopened.json()["engine_json"] == imported["engine_json"]

    plane = diagram.find(".//{*}BPMNPlane")
    plane.remove(plane.find("{*}BPMNEdge[@bpmnElement='Flow_2']"))
    incomplete = client.post(
        "/wizard/import-bpmn?include_xml=true",
        files={"file": ("partial.bpmn", ET.tostring(diagram), "application/xml")},
    )
    assert incomplete.status_code == 200
    assert incomplete.json()["diagram_xml"] is None


def test_import_leaves_layout_to_generator_when_file_has_no_positions():
    response = client.post(
        "/wizard/import-bpmn?include_xml=true",
        files={"file": ("unpositioned.bpmn", BPMN_XML, "application/xml")},
    )

    assert response.status_code == 200
    assert response.json()["diagram_xml"] is None


def test_import_render_and_export_endpoints_keep_fallback_route():
    xml = BPMN_XML.replace('name="Decision" />', 'name="Decision" default="Fallback" />').replace(
        "  </process>",
        '    <endEvent id="FallbackEnd" />\n'
        '    <sequenceFlow id="Fallback" sourceRef="Gateway_1" targetRef="FallbackEnd" />\n'
        "  </process>",
    )
    imported = client.post("/wizard/import-bpmn", files={"file": ("decision.bpmn", xml, "application/xml")})
    assert imported.status_code == 200
    engine = imported.json()["engine_json"]

    for endpoint in ("/generate", "/wizard/export-bpmn"):
        response = client.post(endpoint, json=engine)
        assert response.status_code == 200
        root = ET.fromstring(response.text)
        assert root.find(".//{*}exclusiveGateway").get("default") == "Fallback"
        assert root.find(".//{*}sequenceFlow[@id='Fallback']").get("targetRef") == "FallbackEnd"
