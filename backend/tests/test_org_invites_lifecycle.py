import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from auth.db import get_connection, run_auth_migrations
from auth.deps import require_user
from auth.service import create_session_for_user, find_user_by_session, find_user_id_by_email, register_user
from core.auth_config import get_auth_config
from routers.auth_router import router as auth_router
from routers.orgs_router import router as orgs_router


def _set_env(tmp_path):
    db_path = tmp_path / "auth-org-invites.db"
    models_dir = tmp_path / "models"
    previous = {
        "AUTH_DB_PATH": os.environ.get("AUTH_DB_PATH"),
        "BPMN_MODELS_DIR": os.environ.get("BPMN_MODELS_DIR"),
        "ORG_INVITE_TTL_HOURS": os.environ.get("ORG_INVITE_TTL_HOURS"),
    }
    os.environ["AUTH_DB_PATH"] = str(db_path)
    os.environ["BPMN_MODELS_DIR"] = str(models_dir)
    os.environ["ORG_INVITE_TTL_HOURS"] = "168"
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
    return TestClient(app)


def _authed_client(email: str) -> TestClient:
    user_id = find_user_id_by_email(email)
    assert user_id
    token = create_session_for_user(user_id=user_id, ip_address="127.0.0.1", user_agent="pytest")
    client = _make_client()
    client.cookies.set(get_auth_config().cookie_name, token)
    return client


def _expire_invite(token: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE organization_invites SET expires_at = ? WHERE token = ?",
            ("2000-01-01T00:00:00Z", token),
        )
        conn.commit()


def test_generated_invite_is_active_with_expiry(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        owner_client = _authed_client("owner@example.com")
        org_id = owner_client.post("/api/orgs", json={"name": "Org A"}).json()["id"]

        invite = owner_client.get(f"/api/orgs/{org_id}/invite-link").json()

        assert invite["status"] == "active"
        assert invite["token"]
        assert invite["expires_at"]
        assert invite["used_at"] is None
        assert invite["revoked_at"] is None
    finally:
        _restore_env(previous)


def test_invite_expires_and_cannot_be_accepted(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("invitee@example.com", "password123")
        owner_client = _authed_client("owner@example.com")
        invitee_client = _authed_client("invitee@example.com")
        org_id = owner_client.post("/api/orgs", json={"name": "Org A"}).json()["id"]

        created = owner_client.get(f"/api/orgs/{org_id}/invite-link").json()
        token = created["token"]
        _expire_invite(token)

        latest = owner_client.get(f"/api/orgs/{org_id}/invite-link?create_if_missing=false").json()
        assert latest["status"] == "expired"

        accepted = invitee_client.post(f"/api/orgs/invite/{token}/accept")
        assert accepted.status_code == 400
        assert "vypršal" in (accepted.json().get("detail") or "").lower()
    finally:
        _restore_env(previous)


def test_regenerated_invite_revokes_previous_token(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("invitee@example.com", "password123")
        owner_client = _authed_client("owner@example.com")
        invitee_client = _authed_client("invitee@example.com")
        org_id = owner_client.post("/api/orgs", json={"name": "Org A"}).json()["id"]

        first = owner_client.get(f"/api/orgs/{org_id}/invite-link").json()
        second = owner_client.get(f"/api/orgs/{org_id}/invite-link?regenerate=true").json()

        assert first["token"] != second["token"]
        assert second["status"] == "active"

        old_accept = invitee_client.post(f"/api/orgs/invite/{first['token']}/accept")
        assert old_accept.status_code == 400
        assert "zrušen" in (old_accept.json().get("detail") or "").lower()
    finally:
        _restore_env(previous)


def test_valid_invite_is_used_and_cannot_be_reused(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("invitee@example.com", "password123")
        owner_client = _authed_client("owner@example.com")
        invitee_client = _authed_client("invitee@example.com")
        org_id = owner_client.post("/api/orgs", json={"name": "Org A"}).json()["id"]

        token = owner_client.get(f"/api/orgs/{org_id}/invite-link").json()["token"]

        accepted = invitee_client.post(f"/api/orgs/invite/{token}/accept")
        assert accepted.status_code == 200
        assert accepted.json().get("invite", {}).get("status") == "used"
        assert accepted.json().get("membership", {}).get("already_member") is False

        reused = owner_client.post(f"/api/orgs/invite/{token}/accept")
        assert reused.status_code == 400
        assert "použit" in (reused.json().get("detail") or "").lower()
    finally:
        _restore_env(previous)


def test_already_member_acceptance_is_graceful_and_marks_invite_used(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        owner_client = _authed_client("owner@example.com")
        org_id = owner_client.post("/api/orgs", json={"name": "Org A"}).json()["id"]
        token = owner_client.get(f"/api/orgs/{org_id}/invite-link").json()["token"]

        response = owner_client.post(f"/api/orgs/invite/{token}/accept")
        assert response.status_code == 200
        payload = response.json()
        assert payload.get("membership", {}).get("already_member") is True
        assert payload.get("invite", {}).get("status") == "used"

        latest = owner_client.get(f"/api/orgs/{org_id}/invite-link?create_if_missing=false").json()
        assert latest["status"] == "used"
        assert latest["used_at"]
    finally:
        _restore_env(previous)


def test_invite_status_is_missing_when_no_invite_exists(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        owner_client = _authed_client("owner@example.com")
        org_id = owner_client.post("/api/orgs", json={"name": "Org A"}).json()["id"]

        invite = owner_client.get(f"/api/orgs/{org_id}/invite-link?create_if_missing=false").json()
        assert invite["status"] == "missing"
        assert invite["token"] is None
    finally:
        _restore_env(previous)
