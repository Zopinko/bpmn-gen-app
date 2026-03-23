import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from auth.db import run_auth_migrations
from auth.deps import require_user
from auth.service import create_session_for_user, find_user_by_session, find_user_id_by_email, register_user
from core.auth_config import get_auth_config
from routers.auth_router import router as auth_router
from routers.org_model_router import router as org_model_router
from routers.orgs_router import router as orgs_router
from services.model_storage import load_model as load_global_model
from services.org_models_storage import load_org_model


def _set_env(tmp_path):
    db_path = tmp_path / "auth-org-guardrails.db"
    models_dir = tmp_path / "models"
    previous = {
        "AUTH_DB_PATH": os.environ.get("AUTH_DB_PATH"),
        "BPMN_MODELS_DIR": os.environ.get("BPMN_MODELS_DIR"),
        "APP_ENV": os.environ.get("APP_ENV"),
        "BPMN_TEST_AUTH": os.environ.get("BPMN_TEST_AUTH"),
    }
    os.environ["AUTH_DB_PATH"] = str(db_path)
    os.environ["BPMN_MODELS_DIR"] = str(models_dir)
    os.environ.pop("BPMN_TEST_AUTH", None)
    os.environ.pop("APP_ENV", None)
    return previous


def _restore_env(previous):
    for key, value in previous.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


def _make_client() -> TestClient:
    def _require_user_from_cookie(request: Request):
        cookie_name = get_auth_config().cookie_name
        token = request.cookies.get(cookie_name)
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
    app.include_router(org_model_router)
    return TestClient(app)


def _authed_client(email: str) -> TestClient:
    user_id = find_user_id_by_email(email)
    assert user_id
    token = create_session_for_user(user_id=user_id, ip_address="127.0.0.1", user_agent="pytest")
    client = _make_client()
    client.cookies.set(get_auth_config().cookie_name, token)
    return client


def test_org_process_creation_stores_model_in_org_scope(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        client = _authed_client("owner@example.com")
        org_id = client.post("/api/orgs", json={"name": "Org A"}).json()["id"]

        created = client.post(
            f"/api/org-model/process?org_id={org_id}",
            json={"parentId": "root", "name": "Scoped process"},
        )

        assert created.status_code == 200
        node = created.json()["node"]
        model_id = node["processRef"]["modelId"]
        org_model = load_org_model(org_id, model_id)
        assert org_model["name"] == "Scoped process"

        try:
            load_global_model(model_id)
        except FileNotFoundError:
            pass
        else:
            raise AssertionError("process model should not be stored in global model storage")
    finally:
        _restore_env(previous)


def test_process_model_ref_must_belong_to_same_org(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("owner2@example.com", "password123")
        client_a = _authed_client("owner@example.com")
        client_b = _authed_client("owner2@example.com")
        org_a = client_a.post("/api/orgs", json={"name": "Org A"}).json()["id"]
        org_b = client_b.post("/api/orgs", json={"name": "Org B"}).json()["id"]

        process = client_a.post(
            f"/api/org-model/process?org_id={org_a}",
            json={"parentId": "root", "name": "Process A"},
        ).json()["node"]
        foreign_model_id = client_b.post(
            f"/api/orgs/models?org_id={org_b}",
            json={
                "name": "Foreign model",
                "engine_json": {"nodes": [], "flows": [], "lanes": []},
                "diagram_xml": "<definitions />",
            },
        ).json()["org_model_id"]

        response = client_a.patch(
            f"/api/org-model/process/{process['id']}/model-ref?org_id={org_a}",
            json={"modelId": foreign_model_id},
        )

        assert response.status_code == 400
        assert "neexistuje" in (response.json().get("detail") or "").lower()
    finally:
        _restore_env(previous)


def test_create_process_from_org_model_requires_existing_same_org_model(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        client = _authed_client("owner@example.com")
        org_id = client.post("/api/orgs", json={"name": "Org A"}).json()["id"]

        response = client.post(
            f"/api/org-model/process-from-org-model?org_id={org_id}",
            json={"parentId": "root", "name": "Bad ref", "modelId": "missing-model"},
        )

        assert response.status_code == 400
        assert "neexistuje" in (response.json().get("detail") or "").lower()
    finally:
        _restore_env(previous)


def test_org_process_save_rejects_stale_base_version_when_tree_ref_changed(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("member@example.com", "password123")
        owner_client = _authed_client("owner@example.com")
        member_client = _authed_client("member@example.com")
        org_id = owner_client.post("/api/orgs", json={"name": "Org A"}).json()["id"]
        owner_client.post(
            "/api/orgs/members",
            json={"email": "member@example.com", "org_id": org_id, "role": "member"},
        )

        created = owner_client.post(
            f"/api/org-model/process?org_id={org_id}",
            json={"parentId": "root", "name": "Shared process"},
        )
        assert created.status_code == 200
        node = created.json()["node"]
        tree_node_id = node["id"]
        base_model_id = node["processRef"]["modelId"]

        member_save = member_client.post(
            f"/api/orgs/models?org_id={org_id}",
            json={
                "name": "Shared process",
                "engine_json": {"nodes": [], "flows": [], "lanes": []},
                "diagram_xml": "<definitions />",
                "base_model_id": base_model_id,
                "tree_node_id": tree_node_id,
            },
        )
        assert member_save.status_code == 200
        new_model_id = member_save.json()["org_model_id"]

        member_ref_update = member_client.patch(
            f"/api/org-model/process/{tree_node_id}/model-ref?org_id={org_id}",
            json={"modelId": new_model_id},
        )
        assert member_ref_update.status_code == 200

        stale_save = owner_client.post(
            f"/api/orgs/models?org_id={org_id}",
            json={
                "name": "Shared process",
                "engine_json": {"nodes": [], "flows": [], "lanes": []},
                "diagram_xml": "<definitions />",
                "base_model_id": base_model_id,
                "tree_node_id": tree_node_id,
            },
        )
        assert stale_save.status_code == 409
        assert "medzicasom zmeneny" in (stale_save.json().get("detail") or "").lower()
    finally:
        _restore_env(previous)


def test_org_presence_lists_active_editor_for_process_node(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        client = _authed_client("owner@example.com")
        org_id = client.post("/api/orgs", json={"name": "Org A"}).json()["id"]
        created = client.post(
            f"/api/org-model/process?org_id={org_id}",
            json={"parentId": "root", "name": "Presence process"},
        )
        assert created.status_code == 200
        node_id = created.json()["node"]["id"]

        heartbeat = client.post(
            f"/api/org-model/presence/heartbeat?org_id={org_id}",
            json={"treeNodeId": node_id, "active": True},
        )
        assert heartbeat.status_code == 200

        listing = client.get(f"/api/org-model/presence?org_id={org_id}")
        assert listing.status_code == 200
        items = listing.json().get("items") or {}
        assert node_id in items
        assert any((row.get("email") or "").lower() == "owner@example.com" for row in items[node_id])
    finally:
        _restore_env(previous)


def test_member_cannot_delete_org_process(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("member@example.com", "password123")
        owner_client = _authed_client("owner@example.com")
        member_client = _authed_client("member@example.com")
        org_id = owner_client.post("/api/orgs", json={"name": "Org A"}).json()["id"]
        owner_client.post(
            "/api/orgs/members",
            json={"email": "member@example.com", "org_id": org_id, "role": "member"},
        )

        created = owner_client.post(
            f"/api/org-model/process?org_id={org_id}",
            json={"parentId": "root", "name": "Protected process"},
        )
        assert created.status_code == 200
        node_id = created.json()["node"]["id"]

        member_delete = member_client.delete(f"/api/org-model/node/{node_id}?org_id={org_id}")
        assert member_delete.status_code == 403
        assert "owner" in (member_delete.json().get("detail") or "").lower()

        tree = owner_client.get(f"/api/org-model?org_id={org_id}")
        assert tree.status_code == 200
        children = tree.json().get("children") or []
        assert any(child.get("id") == node_id for child in children)
    finally:
        _restore_env(previous)
