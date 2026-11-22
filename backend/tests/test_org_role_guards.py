import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from auth.db import get_connection, run_auth_migrations
from auth.deps import require_user
from auth.service import (
    add_org_member,
    create_org_with_owner,
    create_session_for_user,
    find_user_by_session,
    register_user,
)
from core.auth_config import get_auth_config
from routers.generate_router import router as generate_router
from routers.orgs_router import router as orgs_router
from services.model_storage import load_model, save_model
from services.org_activity_log import list_org_events
from services.org_model_storage import create_process
from services.org_models_storage import list_org_models, load_org_model
from services.project_notes_storage import load_project_notes, save_project_notes


@pytest.fixture
def org_context(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setenv("BPMN_MODELS_DIR", str(tmp_path / "models"))
    monkeypatch.setenv("BPMN_PROJECT_NOTES_DIR", str(tmp_path / "notes"))
    monkeypatch.setenv("BPMN_PROJECT_NOTES_FILE", str(tmp_path / "legacy-notes.json"))
    run_auth_migrations()
    owner = register_user("owner@example.com", "password123")
    member = register_user("member@example.com", "password123")
    org_id = create_org_with_owner("Role guards", owner.id)["id"]
    add_org_member(member.id, org_id, "member")

    def client_for(user):
        def user_from_cookie(request: Request):
            user = find_user_by_session(request.cookies.get(get_auth_config().cookie_name) or "")
            if not user:
                raise HTTPException(status_code=401)
            return user

        app = FastAPI()
        app.dependency_overrides[require_user] = user_from_cookie
        app.include_router(orgs_router)
        app.include_router(generate_router)
        client = TestClient(app)
        token = create_session_for_user(user.id, ip_address="127.0.0.1", user_agent="pytest")
        client.cookies.set(get_auth_config().cookie_name, token)
        return client

    return org_id, owner, member, client_for


@pytest.mark.parametrize("role", ["viewer", "unsupported", "member", "owner", "admin"])
@pytest.mark.parametrize("action", ["push", "create", "update", "notes", "delete-request"])
def test_org_write_role_guards(org_context, role, action):
    org_id, _, actor, client_for = org_context
    # Direct SQL also covers legacy and unsupported persisted roles.
    with get_connection() as conn:
        conn.execute("UPDATE organization_members SET role = ? WHERE user_id = ? AND organization_id = ?",
                     (role, actor.id, org_id))
        conn.commit()
    client = client_for(actor)
    process = create_process(org_id, "root", "Original process")
    model_id = process["processRef"]["modelId"]
    original_model = load_org_model(org_id, model_id)
    original_models = list_org_models(org_id)
    original_events = list_org_events(org_id)
    save_project_notes(org_id, [{"text": "Original note"}])
    personal_model = save_model("Personal", {}, "<definitions />", user_id=actor.id)
    model_payload = {"name": "Changed", "engine_json": {"nodes": [], "flows": [], "lanes": []},
                     "diagram_xml": "<definitions />"}

    if action == "push":
        response = client.post("/api/orgs/push-model", json={"org_id": org_id, "model_id": personal_model["id"]})
    elif action == "create":
        response = client.post("/api/orgs/models", params={"org_id": org_id}, json=model_payload)
    elif action == "update":
        response = client.put(f"/api/orgs/models/{model_id}", params={"org_id": org_id}, json=model_payload)
    elif action == "notes":
        response = client.put("/wizard/project-notes", json={"org_id": org_id, "notes": [{"text": "Changed"}]})
    else:
        response = client.post("/api/orgs/activity/delete-request", json={"org_id": org_id, "node_id": process["id"]})

    allowed = role in {"owner", "member", "admin"}
    if action == "delete-request" and role in {"owner", "admin"}:
        # Owners (legacy admin resolves to owner) delete processes directly; no request needed.
        assert response.status_code == 400, response.text
        assert list_org_events(org_id) == original_events
        return
    assert response.status_code == (200 if allowed else 403), response.text
    if not allowed:
        assert load_org_model(org_id, model_id) == original_model
        assert list_org_models(org_id) == original_models
        assert load_project_notes(org_id) == [{"text": "Original note"}]
        assert list_org_events(org_id) == original_events
        assert load_model(personal_model["id"], user_id=actor.id) == personal_model
    elif action == "push":
        assert load_org_model(org_id, response.json()["org_model_id"])["name"] == "Personal"
    elif action == "create":
        assert load_org_model(org_id, response.json()["org_model_id"])["name"] == "Changed"
    elif action == "update":
        assert load_org_model(org_id, model_id)["name"] == "Changed"
    elif action == "notes":
        assert load_project_notes(org_id) == [{"text": "Changed"}]
    else:
        assert any(event["event_type"] == "delete_requested" for event in list_org_events(org_id))
    assert client.get("/wizard/project-notes", params={"org_id": org_id}).status_code == 200


def test_invite_link_get_is_read_only_and_post_is_owner_only(org_context):
    org_id, owner, member, client_for = org_context
    owner_client, member_client = client_for(owner), client_for(member)
    url = f"/api/orgs/{org_id}/invite-link"
    events_before = list_org_events(org_id)
    for params in ({}, {"regenerate": "true", "create_if_missing": "true"}, {}):
        response = owner_client.get(url, params=params)
        assert response.status_code == 200
        assert response.json()["status"] == "missing"
        assert response.json()["token"] is None
    with get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM organization_invites WHERE organization_id = ?", (org_id,)).fetchone()[0] == 0
    assert list_org_events(org_id) == events_before
    assert member_client.post(url, json={}).status_code == 403

    created = owner_client.post(url, json={})
    assert created.status_code == 200
    first = created.json()
    assert first["status"] == "active"
    assert first["token"]
    assert owner_client.get(url, params={"regenerate": "true"}).json() == first
    assert owner_client.post(url, json={"regenerate": False}).json() == first
    regenerated = owner_client.post(url, json={"regenerate": True})
    assert regenerated.status_code == 200
    assert regenerated.json()["token"] != first["token"]
    assert owner_client.get(url).json() == regenerated.json()
    assert member_client.post(url, json={"regenerate": True}).status_code == 403
    assert owner_client.get(url).json() == regenerated.json()
    invite_events = [event["event_type"] for event in list_org_events(org_id)
                     if event["event_type"].startswith("invite_link_")]
    assert sorted(invite_events) == ["invite_link_created", "invite_link_regenerated"]
