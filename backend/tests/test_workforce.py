import os
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from auth.db import run_auth_migrations
from auth.deps import require_user
from auth.service import create_session_for_user, find_user_by_session, find_user_id_by_email, register_user
from core.auth_config import get_auth_config
from routers.auth_router import router as auth_router
from routers.orgs_router import router as orgs_router
from routers.org_workforce_router import router as workforce_router
from services.org_employees_storage import (
    create_employee,
    list_employees,
    update_employee,
    delete_employee,
    get_employee,
)
from services.org_competencies_storage import (
    create_competency,
    list_competencies,
    update_competency,
    delete_competency,
    delete_competencies_by_employee,
    build_matrix,
)
from services.org_model_storage import create_process, delete_node, get_process_model_ref
from services.org_models_storage import save_org_model


def _set_env(tmp_path):
    prev = os.environ.get("BPMN_MODELS_DIR")
    os.environ["BPMN_MODELS_DIR"] = str(tmp_path / "models")
    return prev


def _restore_env(prev):
    if prev is None:
        os.environ.pop("BPMN_MODELS_DIR", None)
    else:
        os.environ["BPMN_MODELS_DIR"] = prev


def _make_process(org_id, *step_ids):
    process = create_process(org_id, "root", "Workforce process")
    save_org_model(org_id, process["processRef"]["modelId"], {
        "engine_json": {"nodes": [
            {"id": step_id, "type": "task", "name": step_id}
            for step_id in step_ids
        ] + [{"id": "start", "type": "startEvent", "name": "Start"}]},
    })
    return process["id"]


def _set_api_env(tmp_path):
    previous = {
        "AUTH_DB_PATH": os.environ.get("AUTH_DB_PATH"),
        "BPMN_MODELS_DIR": os.environ.get("BPMN_MODELS_DIR"),
    }
    os.environ["AUTH_DB_PATH"] = str(tmp_path / "auth.db")
    os.environ["BPMN_MODELS_DIR"] = str(tmp_path / "models")
    return previous


def _restore_api_env(previous):
    for key, value in previous.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


def _make_api_client() -> TestClient:
    def _require_user_from_cookie(request: Request):
        token = request.cookies.get(get_auth_config().cookie_name)
        if not token:
            raise HTTPException(status_code=401, detail="Pouzivatel nie je prihlaseny.")
        user = find_user_by_session(token)
        if not user:
            raise HTTPException(status_code=401, detail="Pouzivatel nie je prihlaseny.")
        return user

    app = FastAPI()
    app.dependency_overrides[require_user] = _require_user_from_cookie
    app.include_router(auth_router)
    app.include_router(orgs_router)
    app.include_router(workforce_router)
    return TestClient(app)


def _authed_api_client(email: str) -> TestClient:
    user_id = find_user_id_by_email(email)
    assert user_id
    token = create_session_for_user(user_id=user_id, ip_address="127.0.0.1", user_agent="pytest")
    client = _make_api_client()
    client.cookies.set(get_auth_config().cookie_name, token)
    return client


def test_create_and_list_employee(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", emp_no="E001", name="Jana Kováčová", position="Referentka")
        assert emp["emp_no"] == "E001"
        assert emp["name"] == "Jana Kováčová"
        assert emp["position"] == "Referentka"
        assert "id" in emp
        assert "created_at" in emp

        items = list_employees("org1")
        assert len(items) == 1
        assert items[0]["emp_no"] == "E001"
    finally:
        _restore_env(prev)


def test_duplicate_emp_no_raises(tmp_path):
    prev = _set_env(tmp_path)
    try:
        create_employee("org1", "E001", "Jana K.")
        with pytest.raises(ValueError, match="E001"):
            create_employee("org1", "E001", "Iná Jana")
    finally:
        _restore_env(prev)


def test_update_employee(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.", "Referentka")
        updated = update_employee("org1", emp["id"], name="Jana Nová")
        assert updated["name"] == "Jana Nová"
        assert updated["position"] == "Referentka"  # unchanged
        assert get_employee("org1", emp["id"])["name"] == "Jana Nová"
    finally:
        _restore_env(prev)


def test_delete_employee(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        delete_employee("org1", emp["id"])
        assert list_employees("org1") == []
    finally:
        _restore_env(prev)


def test_employees_are_org_scoped(tmp_path):
    prev = _set_env(tmp_path)
    try:
        create_employee("org1", "E001", "Jana K.")
        create_employee("org2", "E001", "Peter M.")  # same emp_no, different org — OK
        assert len(list_employees("org1")) == 1
        assert len(list_employees("org2")) == 1
    finally:
        _restore_env(prev)


def test_update_employee_not_found(tmp_path):
    prev = _set_env(tmp_path)
    try:
        with pytest.raises(LookupError):
            update_employee("org1", "nonexistent-id", name="New Name")
    finally:
        _restore_env(prev)


def test_delete_employee_not_found(tmp_path):
    prev = _set_env(tmp_path)
    try:
        with pytest.raises(LookupError):
            delete_employee("org1", "nonexistent-id")
    finally:
        _restore_env(prev)


def test_create_and_list_competency(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        comp = create_competency("org1", emp["id"], "node_1", "task_1", "primary")
        assert comp["emp_id"] == emp["id"]
        assert comp["step_id"] == "task_1"
        assert comp["level"] == "primary"

        items = list_competencies("org1")
        assert len(items) == 1

        by_process = list_competencies("org1", process_node_id="node_1")
        assert len(by_process) == 1

        by_emp = list_competencies("org1", emp_id=emp["id"])
        assert len(by_emp) == 1
    finally:
        _restore_env(prev)


def test_upsert_competency_changes_level(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        create_competency("org1", emp["id"], "node_1", "task_1", "training")
        upserted = create_competency("org1", emp["id"], "node_1", "task_1", "primary")
        assert upserted["level"] == "primary"
        assert len(list_competencies("org1")) == 1  # no duplicate
    finally:
        _restore_env(prev)


def test_delete_employee_cascades_competencies(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        create_competency("org1", emp["id"], "node_1", "task_1", "primary")
        delete_competencies_by_employee("org1", emp["id"])
        assert list_competencies("org1") == []
    finally:
        _restore_env(prev)


def test_build_matrix_risk_levels(tmp_path):
    prev = _set_env(tmp_path)
    try:
        e1 = create_employee("org1", "E001", "Jana K.")
        e2 = create_employee("org1", "E002", "Peter M.")
        process_id = _make_process("org1", "task_1", "task_2", "task_3", "task_4")

        # task_1: primary + backup → risk=none
        create_competency("org1", e1["id"], process_id, "task_1", "primary")
        create_competency("org1", e2["id"], process_id, "task_1", "backup")

        # task_2: only primary, no backup → risk=critical
        create_competency("org1", e1["id"], process_id, "task_2", "primary")

        # task_3: two backups, no primary → risk=low
        create_competency("org1", e1["id"], process_id, "task_3", "backup")
        create_competency("org1", e2["id"], process_id, "task_3", "backup")

        matrix = build_matrix("org1")
        risk_map = {r["step_id"]: r["risk"] for r in matrix["risk"]}
        assert risk_map["task_1"] == "none"
        assert risk_map["task_2"] == "critical"
        assert risk_map["task_3"] == "low"

        assert risk_map["task_4"] == "unassigned"
        assert "start" not in risk_map
    finally:
        _restore_env(prev)


def test_build_matrix_process_filter(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        process_id = _make_process("org1", "task_1")
        other_process_id = _make_process("org1", "task_x")
        create_competency("org1", emp["id"], process_id, "task_1", "primary")
        create_competency("org1", emp["id"], other_process_id, "task_x", "backup")

        matrix = build_matrix("org1", process_node_id=process_id)
        step_ids = [s["step_id"] for s in matrix["steps"]]
        assert "task_1" in step_ids
        assert "task_x" not in step_ids
    finally:
        _restore_env(prev)


def test_build_matrix_after_deleting_assignments_and_process(tmp_path, monkeypatch):
    monkeypatch.setenv("BPMN_MODELS_DIR", str(tmp_path / "models"))
    process_id = _make_process("org1", "task_1")
    employee = create_employee("org1", "E001", "Jana K.")
    assignment = create_competency("org1", employee["id"], process_id, "task_1", "primary")
    create_competency("org1", employee["id"], process_id, "deleted_task", "backup")
    delete_competency("org1", assignment["id"])

    matrix = build_matrix("org1")
    assert [step["step_id"] for step in matrix["steps"]] == ["task_1"]
    assert matrix["risk"][0]["risk"] == "unassigned"
    assert matrix["cells"] == []

    delete_node("org1", process_id)
    assert build_matrix("org1")["steps"] == []


@pytest.mark.parametrize("delete_process", [False, True])
def test_update_competency_rejects_removed_step(tmp_path, monkeypatch, delete_process):
    monkeypatch.setenv("BPMN_MODELS_DIR", str(tmp_path / "models"))
    process_id = _make_process("org1", "task_1")
    employee = create_employee("org1", "E001", "Jana K.")
    assignment = create_competency("org1", employee["id"], process_id, "task_1", "primary")

    if delete_process:
        delete_node("org1", process_id)
    else:
        model_id = get_process_model_ref("org1", process_id)
        save_org_model("org1", model_id, {"engine_json": {"nodes": []}})

    with pytest.raises(LookupError):
        update_competency("org1", assignment["id"], "backup")
    assert list_competencies("org1")[0]["level"] == "primary"


def test_build_matrix_enriches_process_and_step_names(tmp_path):
    prev = _set_env(tmp_path)
    try:
        process_node = create_process("org1", "root", "Schvalenie faktury")
        process_node_id = process_node["id"]
        model_id = process_node["processRef"]["modelId"]
        engine_json = {
            "processId": "process_invoice",
            "name": "Schvalenie faktury",
            "lanes": [{"id": "lane_1", "name": "Uctaren"}],
            "nodes": [
                {"id": "task_check", "type": "task", "laneId": "lane_1", "name": "Skontrolovat fakturu"},
                {"id": "task_pay", "type": "task", "laneId": "lane_1", "name": "Uhradit fakturu"},
            ],
            "flows": [],
        }
        save_org_model(
            "org1",
            model_id,
            {
                "name": "Schvalenie faktury",
                "engine_json": engine_json,
                "diagram_xml": "<definitions />",
            },
        )
        emp = create_employee("org1", "E001", "Jana K.")
        create_competency("org1", emp["id"], process_node_id, "task_check", "primary")

        matrix = build_matrix("org1")

        assert matrix["steps"][0]["process_name"] == "Schvalenie faktury"
        assert matrix["steps"][0]["step_name"] == "Skontrolovat fakturu"
        assert matrix["cells"][0]["process_node_id"] == process_node_id
    finally:
        _restore_env(prev)


def test_workforce_api_full_flow(tmp_path):
    previous = _set_api_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("outsider@example.com", "password123")

        owner_client = _authed_api_client("owner@example.com")
        outsider_client = _authed_api_client("outsider@example.com")
        org_resp = owner_client.post("/api/orgs", json={"name": "Workforce Org"})
        assert org_resp.status_code == 201
        org_id = org_resp.json()["id"]
        process_id = _make_process(org_id, "task_1")

        employee = owner_client.post(
            f"/api/workforce/employees?org_id={org_id}",
            json={"emp_no": "E001", "name": "Jana K.", "position": "Referentka"},
        )
        assert employee.status_code == 201
        emp_id = employee.json()["id"]

        listed = owner_client.get(f"/api/workforce/employees?org_id={org_id}")
        assert listed.status_code == 200
        assert listed.json()[0]["emp_no"] == "E001"

        updated = owner_client.patch(
            f"/api/workforce/employees/{emp_id}?org_id={org_id}",
            json={"name": "Jana Nova", "position": "Specialistka"},
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "Jana Nova"

        competency = owner_client.post(
            f"/api/workforce/competencies?org_id={org_id}",
            json={
                "emp_id": emp_id,
                "process_node_id": process_id,
                "step_id": "task_1",
                "level": "primary",
            },
        )
        assert competency.status_code == 201
        comp_id = competency.json()["id"]

        matrix = owner_client.get(f"/api/workforce/matrix?org_id={org_id}")
        assert matrix.status_code == 200
        assert len(matrix.json()["employees"]) == 1
        assert matrix.json()["risk"][0]["risk"] == "critical"

        changed = owner_client.patch(
            f"/api/workforce/competencies/{comp_id}?org_id={org_id}",
            json={"level": "backup"},
        )
        assert changed.status_code == 200
        assert changed.json()["level"] == "backup"

        forbidden = outsider_client.get(f"/api/workforce/employees?org_id={org_id}")
        assert forbidden.status_code == 403

        deleted = owner_client.delete(f"/api/workforce/employees/{emp_id}?org_id={org_id}")
        assert deleted.status_code == 200
        assert owner_client.get(f"/api/workforce/competencies?org_id={org_id}").json() == []
    finally:
        _restore_api_env(previous)


def test_workforce_api_matrix_smoke_returns_levels_and_risk(tmp_path):
    previous = _set_api_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")

        client = _authed_api_client("owner@example.com")
        org_resp = client.post("/api/orgs", json={"name": "Workforce Org"})
        assert org_resp.status_code == 201
        org_id = org_resp.json()["id"]
        process_id = _make_process(org_id, "task_check_application", "task_approval")

        employees = {}
        for emp_no, name in [
            ("E001", "John Smith"),
            ("E002", "Jane Doe"),
            ("E003", "Tom Green"),
        ]:
            response = client.post(
                f"/api/workforce/employees?org_id={org_id}",
                json={"emp_no": emp_no, "name": name, "position": "Operator"},
            )
            assert response.status_code == 201
            employees[name] = response.json()["id"]

        competencies = [
            (employees["John Smith"], "task_check_application", "primary"),
            (employees["Jane Doe"], "task_check_application", "backup"),
            (employees["Jane Doe"], "task_approval", "training"),
            (employees["Tom Green"], "task_approval", "training"),
        ]
        for emp_id, step_id, level in competencies:
            response = client.post(
                f"/api/workforce/competencies?org_id={org_id}",
                json={
                    "emp_id": emp_id,
                    "process_node_id": process_id,
                    "step_id": step_id,
                    "level": level,
                },
            )
            assert response.status_code == 201

        matrix = client.get(f"/api/workforce/matrix?org_id={org_id}")
        assert matrix.status_code == 200
        payload = matrix.json()

        levels_by_step = {}
        for cell in payload["cells"]:
            levels_by_step.setdefault(cell["step_id"], set()).add(cell["level"])

        assert levels_by_step["task_check_application"] == {"primary", "backup"}
        assert levels_by_step["task_approval"] == {"training"}

        risk_map = {item["step_id"]: item["risk"] for item in payload["risk"]}
        assert risk_map["task_check_application"] == "none"
        assert risk_map["task_approval"] == "low"
    finally:
        _restore_api_env(previous)


def test_workforce_api_rejects_unknown_employee_competency(tmp_path):
    previous = _set_api_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        client = _authed_api_client("owner@example.com")
        org_id = client.post("/api/orgs", json={"name": "Workforce Org"}).json()["id"]

        response = client.post(
            f"/api/workforce/competencies?org_id={org_id}",
            json={
                "emp_id": "missing",
                "process_node_id": "node_1",
                "step_id": "task_1",
                "level": "primary",
            },
        )

        assert response.status_code == 404
    finally:
        _restore_api_env(previous)


def test_workforce_api_rejects_step_outside_process(tmp_path):
    previous = _set_api_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        client = _authed_api_client("owner@example.com")
        org_id = client.post("/api/orgs", json={"name": "Workforce Org"}).json()["id"]
        process_id = _make_process(org_id, "task_1")
        _make_process(org_id, "other_task")
        employee = create_employee(org_id, "E001", "Jana K.")

        for node_id, step_id in [(process_id, "other_task"), (process_id, "start"), ("missing", "task_1")]:
            response = client.post(f"/api/workforce/competencies?org_id={org_id}", json={
                "emp_id": employee["id"], "process_node_id": node_id, "step_id": step_id, "level": "primary",
            })
            assert response.status_code == 404
        assert list_competencies(org_id) == []
    finally:
        _restore_api_env(previous)
