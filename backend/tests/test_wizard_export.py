from fastapi.testclient import TestClient

from main import app
from services.bpmn_import import bpmn_xml_to_engine


client = TestClient(app)


def _sample_engine():
    return {
        "processId": "Process_Export_1",
        "name": "Exportovany proces",
        "lanes": [
            {"id": "Lane_1", "name": "Hlavna"},
        ],
        "nodes": [
            {"id": "start_1", "type": "startEvent", "laneId": "Lane_1", "name": "Start"},
            {"id": "task_1", "type": "task", "laneId": "Lane_1", "name": "Uloha"},
            {"id": "end_1", "type": "endEvent", "laneId": "Lane_1", "name": "Koniec"},
        ],
        "flows": [
            {"id": "flow_1", "source": "start_1", "target": "task_1"},
            {"id": "flow_2", "source": "task_1", "target": "end_1"},
        ],
    }


def test_export_bpmn_download_response():
    engine = _sample_engine()
    resp = client.post("/wizard/export-bpmn", json=engine)
    assert resp.status_code == 200
    # Content type and disposition for download
    assert "application/bpmn+xml" in resp.headers.get("content-type", "")
    disposition = resp.headers.get("content-disposition", "")
    assert "attachment;" in disposition
    assert "Process_Export_1.bpmn" in disposition

    xml = resp.text
    # Sparx-friendly BPMN 2.0 snippets
    assert '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"' in xml
    assert '<process id="Process_Export_1"' in xml
    assert 'name="Exportovany proces"' in xml
    # Lane and flowNodeRef wiring should be present
    assert 'lane id="Hlavna"' in xml or 'lane id="Lane_1"' in xml
    assert '<sequenceFlow id="flow_2" sourceRef="task_1" targetRef="end_1"' in xml


def test_public_generate_rejects_oversized_json_payload():
    engine = _sample_engine()
    engine["name"] = "A" * 300_000

    resp = client.post("/generate", json=engine)

    assert resp.status_code == 413
    assert "too large" in resp.json()["detail"].lower()


def test_linear_wizard_rejects_oversized_text_payload():
    resp = client.post(
        "/wizard/linear",
        json={
            "process_name": "Oversized",
            "roles": ["Worker"],
            "start_trigger": "A" * 300_000,
            "output": "Done",
            "steps": ["Step"],
        },
    )

    assert resp.status_code == 413
    assert "too large" in resp.json()["detail"].lower()


def test_linear_wizard_can_return_layout_with_the_model():
    payload = {
        "process_name": "Invoice approval",
        "roles": ["Reviewer"],
        "start_trigger": "Invoice received",
        "output": "Invoice processed",
        "steps": ["Review invoice"],
        "locale": "en",
    }

    original = client.post("/wizard/linear", json=payload)
    assert original.status_code == 200
    assert set(original.json()) == {"engine_json", "issues"}

    response = client.post("/wizard/linear?include_xml=true", json=payload)
    assert response.status_code == 200
    result = response.json()
    diagram = result["diagram_xml"]
    assert "BPMNShape" in diagram
    rendered_separately = client.post("/generate", json=result["engine_json"])
    assert rendered_separately.status_code == 200
    assert rendered_separately.text == diagram
    rendered = bpmn_xml_to_engine(diagram)
    assert rendered["processId"] == result["engine_json"]["processId"]
    assert {(f["source"], f["target"]) for f in rendered["flows"]} == {
        (f["source"], f["target"]) for f in result["engine_json"]["flows"]
    }
