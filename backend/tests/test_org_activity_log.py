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


def _set_env(tmp_path):
    db_path = tmp_path / "auth-org-activity.db"
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


def test_org_activity_lists_key_events(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("member@example.com", "password123")
        owner_client = _authed_client("owner@example.com")
        member_client = _authed_client("member@example.com")

        org_id = owner_client.post("/api/orgs", json={"name": "Org A"}).json()["id"]

        add_member = owner_client.post(
            "/api/orgs/members",
            json={"email": "member@example.com", "org_id": org_id, "role": "member"},
        )
        assert add_member.status_code == 200

        create_process = owner_client.post(
            f"/api/org-model/process?org_id={org_id}",
            json={"parentId": "root", "name": "Approval flow"},
        )
        assert create_process.status_code == 200
        node_id = create_process.json()["node"]["id"]

        delete_request = member_client.post(
            "/api/orgs/activity/delete-request",
            json={"org_id": org_id, "node_id": node_id, "reason": "Proces je duplicitny."},
        )
        assert delete_request.status_code == 200

        activity = owner_client.get(f"/api/orgs/activity?org_id={org_id}")
        assert activity.status_code == 200
        items = activity.json()["items"]
        event_types = [item["event_type"] for item in items]

        assert "member_added" in event_types
        assert "process_created" in event_types
        assert "delete_requested" in event_types
        assert items[0]["event_type"] == "delete_requested"
        assert items[0]["actor_email"] == "member@example.com"
        assert items[0]["metadata"]["reason"] == "Proces je duplicitny."
    finally:
        _restore_env(previous)


def test_owner_can_approve_delete_request_and_process_is_removed(tmp_path):
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

        create_process = owner_client.post(
            f"/api/org-model/process?org_id={org_id}",
            json={"parentId": "root", "name": "Approval flow"},
        )
        node_id = create_process.json()["node"]["id"]

        delete_request = member_client.post(
            "/api/orgs/activity/delete-request",
            json={"org_id": org_id, "node_id": node_id},
        )
        assert delete_request.status_code == 200

        activity_before = owner_client.get(f"/api/orgs/activity?org_id={org_id}")
        request_event = next(
            item for item in activity_before.json()["items"] if item["event_type"] == "delete_requested"
        )

        approve = owner_client.post(f"/api/orgs/activity/delete-request/{request_event['id']}/approve?org_id={org_id}")
        assert approve.status_code == 200
        assert approve.json()["deleted"] is True

        tree = owner_client.get(f"/api/org-model?org_id={org_id}")
        assert tree.status_code == 200
        assert tree.json()["children"] == []

        activity = owner_client.get(f"/api/orgs/activity?org_id={org_id}")
        items = activity.json()["items"]
        event_types = [item["event_type"] for item in items]

        assert "delete_request_approved" in event_types
        assert "process_deleted" in event_types
    finally:
        _restore_env(previous)


def test_owner_can_reject_delete_request_without_removing_process(tmp_path):
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

        create_process = owner_client.post(
            f"/api/org-model/process?org_id={org_id}",
            json={"parentId": "root", "name": "Approval flow"},
        )
        node_id = create_process.json()["node"]["id"]

        delete_request = member_client.post(
            "/api/orgs/activity/delete-request",
            json={"org_id": org_id, "node_id": node_id},
        )
        assert delete_request.status_code == 200

        activity_before = owner_client.get(f"/api/orgs/activity?org_id={org_id}")
        request_event = next(
            item for item in activity_before.json()["items"] if item["event_type"] == "delete_requested"
        )

        reject = owner_client.post(f"/api/orgs/activity/delete-request/{request_event['id']}/reject?org_id={org_id}")
        assert reject.status_code == 200
        assert reject.json()["rejected"] is True

        tree = owner_client.get(f"/api/org-model?org_id={org_id}")
        assert tree.status_code == 200
        assert len(tree.json()["children"]) == 1
        assert tree.json()["children"][0]["id"] == node_id

        activity = owner_client.get(f"/api/orgs/activity?org_id={org_id}")
        items = activity.json()["items"]
        event_types = [item["event_type"] for item in items]

        assert "delete_request_rejected" in event_types
        assert "process_deleted" not in event_types
    finally:
        _restore_env(previous)


def test_member_cannot_approve_delete_request(tmp_path):
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

        create_process = owner_client.post(
            f"/api/org-model/process?org_id={org_id}",
            json={"parentId": "root", "name": "Approval flow"},
        )
        node_id = create_process.json()["node"]["id"]

        member_client.post(
            "/api/orgs/activity/delete-request",
            json={"org_id": org_id, "node_id": node_id},
        )
        activity_before = owner_client.get(f"/api/orgs/activity?org_id={org_id}")
        request_event = next(
            item for item in activity_before.json()["items"] if item["event_type"] == "delete_requested"
        )

        approve = member_client.post(f"/api/orgs/activity/delete-request/{request_event['id']}/approve?org_id={org_id}")
        assert approve.status_code == 403
    finally:
        _restore_env(previous)
