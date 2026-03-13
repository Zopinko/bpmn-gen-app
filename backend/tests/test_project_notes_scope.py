import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from auth.db import run_auth_migrations
from auth.deps import require_user
from auth.service import create_session_for_user, find_user_by_session, find_user_id_by_email, register_user
from core.auth_config import get_auth_config
from routers.auth_router import router as auth_router
from routers.generate_router import router as generate_router
from routers.orgs_router import router as orgs_router


def _set_env(tmp_path):
    db_path = tmp_path / "auth-notes-scope.db"
    models_dir = tmp_path / "models"
    notes_dir = tmp_path / "project_notes"
    previous = {
        "AUTH_DB_PATH": os.environ.get("AUTH_DB_PATH"),
        "BPMN_MODELS_DIR": os.environ.get("BPMN_MODELS_DIR"),
        "BPMN_PROJECT_NOTES_DIR": os.environ.get("BPMN_PROJECT_NOTES_DIR"),
    }
    os.environ["AUTH_DB_PATH"] = str(db_path)
    os.environ["BPMN_MODELS_DIR"] = str(models_dir)
    os.environ["BPMN_PROJECT_NOTES_DIR"] = str(notes_dir)
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
    app.include_router(generate_router)
    return TestClient(app)


def _authed_client(email: str) -> TestClient:
    user_id = find_user_id_by_email(email)
    assert user_id
    token = create_session_for_user(user_id=user_id, ip_address="127.0.0.1", user_agent="pytest")
    client = _make_client()
    client.cookies.set(get_auth_config().cookie_name, token)
    return client


def test_notes_are_scoped_per_organization(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner1@example.com", "password123")
        register_user("owner2@example.com", "password123")

        owner1 = _authed_client("owner1@example.com")
        owner2 = _authed_client("owner2@example.com")

        org1 = owner1.post("/api/orgs", json={"name": "Org One"}).json()["id"]
        org2 = owner2.post("/api/orgs", json={"name": "Org Two"}).json()["id"]

        saved_org1 = owner1.put(
            "/wizard/project-notes",
            json={"org_id": org1, "notes": [{"id": "n1", "text": "Poznamka org1", "status": "new"}]},
        )
        assert saved_org1.status_code == 200

        saved_org2 = owner2.put(
            "/wizard/project-notes",
            json={"org_id": org2, "notes": [{"id": "n2", "text": "Poznamka org2", "status": "new"}]},
        )
        assert saved_org2.status_code == 200

        org1_notes = owner1.get(f"/wizard/project-notes?org_id={org1}")
        org2_notes = owner2.get(f"/wizard/project-notes?org_id={org2}")
        assert org1_notes.status_code == 200
        assert org2_notes.status_code == 200
        assert [item["id"] for item in org1_notes.json()["notes"]] == ["n1"]
        assert [item["id"] for item in org2_notes.json()["notes"]] == ["n2"]
    finally:
        _restore_env(previous)


def test_non_member_cannot_access_foreign_org_notes(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("outsider@example.com", "password123")

        owner = _authed_client("owner@example.com")
        outsider = _authed_client("outsider@example.com")
        org_id = owner.post("/api/orgs", json={"name": "Org Main"}).json()["id"]

        saved = owner.put(
            "/wizard/project-notes",
            json={"org_id": org_id, "notes": [{"id": "n1", "text": "Interna poznamka", "status": "new"}]},
        )
        assert saved.status_code == 200

        forbidden_get = outsider.get(f"/wizard/project-notes?org_id={org_id}")
        forbidden_put = outsider.put(
            "/wizard/project-notes",
            json={"org_id": org_id, "notes": [{"id": "hack", "text": "x", "status": "new"}]},
        )
        assert forbidden_get.status_code == 403
        assert forbidden_put.status_code == 403
    finally:
        _restore_env(previous)


def test_member_can_read_and_update_org_notes(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("member@example.com", "password123")

        owner = _authed_client("owner@example.com")
        member = _authed_client("member@example.com")
        org_id = owner.post("/api/orgs", json={"name": "Org Main"}).json()["id"]

        add_member = owner.post(
            "/api/orgs/members",
            json={"email": "member@example.com", "org_id": org_id, "role": "member"},
        )
        assert add_member.status_code == 200

        saved_by_owner = owner.put(
            "/wizard/project-notes",
            json={"org_id": org_id, "notes": [{"id": "n1", "text": "Prva", "status": "new"}]},
        )
        assert saved_by_owner.status_code == 200

        fetched_by_member = member.get(f"/wizard/project-notes?org_id={org_id}")
        assert fetched_by_member.status_code == 200
        assert fetched_by_member.json()["notes"][0]["id"] == "n1"

        updated_by_member = member.put(
            "/wizard/project-notes",
            json={"org_id": org_id, "notes": [{"id": "n1", "text": "Upravene memberom", "status": "agreed"}]},
        )
        assert updated_by_member.status_code == 200

        check_owner = owner.get(f"/wizard/project-notes?org_id={org_id}")
        assert check_owner.status_code == 200
        assert check_owner.json()["notes"][0]["text"] == "Upravene memberom"
    finally:
        _restore_env(previous)
