from fastapi.testclient import TestClient

from main import app


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
