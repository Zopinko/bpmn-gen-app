import os
from fastapi.testclient import TestClient
from services import model_storage


# Set temp storage dir before creating client (respects env override)
def _setup_tmp_dir(tmp_path):
    tmp_dir = tmp_path / "models"
    old_env = os.environ.get("BPMN_MODELS_DIR")
    os.environ["BPMN_MODELS_DIR"] = str(tmp_dir)
    model_storage.set_base_dir(tmp_dir)
    return tmp_dir, old_env


def _make_client():
    from main import app
    return TestClient(app)


def _sample_engine():
    return {
        "processId": "Process_Save_1",
        "name": "Save Test",
        "lanes": [{"id": "Lane_1", "name": "Main"}],
        "nodes": [
            {"id": "start_1", "type": "startEvent", "laneId": "Lane_1", "name": "Start"},
            {"id": "task_1", "type": "task", "laneId": "Lane_1", "name": "Task"},
            {"id": "end_1", "type": "endEvent", "laneId": "Lane_1", "name": "End"},
        ],
        "flows": [
            {"id": "f1", "source": "start_1", "target": "task_1"},
            {"id": "f2", "source": "task_1", "target": "end_1"},
        ],
    }


def test_create_and_get_model(tmp_path):
    tmp_dir, old_env = _setup_tmp_dir(tmp_path)
    try:
        client = _make_client()
        payload = {
            "name": "My Model",
            "engine_json": _sample_engine(),
            "diagram_xml": "<definitions></definitions>",
            "generator_input": {
                "processName": "My Model",
                "roles": "Role 1\nRole 2",
                "trigger": "Start",
                "input": "Input data",
                "output": "Output data",
                "mainSteps": "Step 1\nStep 2",
            },
            "process_meta": {
                "owner": "Owner",
                "department": "Dept",
                "status": "Draft",
                "version": "1.0",
                "internalId": "MODEL-1",
                "tags": "tag1, tag2",
                "description": "Sample description",
            },
        }
        create_resp = client.post("/wizard/models", json=payload)
        assert create_resp.status_code == 200
        data = create_resp.json()
        model_id = data["id"]
        assert data["name"] == "My Model"
        assert data["created_at"]
        # file exists
        saved_path = (tmp_dir / f"{model_id}.json")
        assert saved_path.exists()

        get_resp = client.get(f"/wizard/models/{model_id}")
        assert get_resp.status_code == 200
        fetched = get_resp.json()
        assert fetched["engine_json"]["processId"] == "Process_Save_1"
        assert fetched["diagram_xml"].startswith("<definitions")
        assert fetched.get("generator_input", {}).get("processName") == "My Model"
        assert fetched.get("process_meta", {}).get("owner") == "Owner"
    finally:
        if old_env is None:
            os.environ.pop("BPMN_MODELS_DIR", None)
        else:
            os.environ["BPMN_MODELS_DIR"] = old_env


def test_list_search_and_delete_models(tmp_path):
    tmp_dir, old_env = _setup_tmp_dir(tmp_path)
    try:
        client = _make_client()
        # create two models
        for idx in range(2):
            payload = {
                "name": f"Model {idx}",
                "engine_json": _sample_engine(),
                "diagram_xml": "<definitions></definitions>",
            }
            r = client.post("/wizard/models", json=payload)
            assert r.status_code == 200

        resp = client.get("/wizard/models?limit=1&offset=0")
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"]
        assert data["total"] >= 2
        # process_meta should be included in list for version visibility
        assert "process_meta" in data["items"][0]

        search_resp = client.get("/wizard/models?search=Model%201")
        assert search_resp.status_code == 200
        search_data = search_resp.json()
        assert any("Model 1" in item["name"] for item in search_data["items"])

        # delete first model
        first_id = data["items"][0]["id"]
        del_resp = client.delete(f"/wizard/models/{first_id}")
        assert del_resp.status_code == 200
        # file removed
        assert not (tmp_dir / f"{first_id}.json").exists()
        missing = client.get(f"/wizard/models/{first_id}")
        assert missing.status_code == 404
    finally:
        if old_env is None:
            os.environ.pop("BPMN_MODELS_DIR", None)
        else:
            os.environ["BPMN_MODELS_DIR"] = old_env


def test_rename_model(tmp_path):
    tmp_dir, old_env = _setup_tmp_dir(tmp_path)
    try:
        client = _make_client()
        payload = {
            "name": "Original",
            "engine_json": _sample_engine(),
            "diagram_xml": "<definitions></definitions>",
            "generator_input": {"processName": "Original"},
            "process_meta": {"owner": "Tester"},
        }
        create_resp = client.post("/wizard/models", json=payload)
        assert create_resp.status_code == 200
        created = create_resp.json()
        model_id = created["id"]
        old_updated_at = created["updated_at"]

        new_name = "Premenovany model"
        rename_resp = client.patch(f"/wizard/models/{model_id}", json={"name": new_name})
        assert rename_resp.status_code == 200
        renamed = rename_resp.json()
        assert renamed["name"] == new_name
        assert renamed["updated_at"] != old_updated_at
        assert renamed.get("generator_input", {}).get("processName") == "Original"

        list_resp = client.get("/wizard/models")
        assert list_resp.status_code == 200
        items = list_resp.json().get("items") or []
        assert any(item["id"] == model_id and item["name"] == new_name for item in items)

        fetched = client.get(f"/wizard/models/{model_id}")
        assert fetched.status_code == 200
        fetched_body = fetched.json()
        assert fetched_body.get("process_meta", {}).get("owner") == "Tester"
    finally:
        if old_env is None:
            os.environ.pop("BPMN_MODELS_DIR", None)
        else:
            os.environ["BPMN_MODELS_DIR"] = old_env
