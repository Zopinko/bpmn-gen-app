import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from auth.deps import require_user
from auth.db import run_auth_migrations
from auth.service import create_session_for_user, find_user_by_session, find_user_id_by_email, register_user
from core.auth_config import get_auth_config
from routers.auth_router import router as auth_router
from routers.orgs_router import router as orgs_router


def _set_env(tmp_path):
    db_path = tmp_path / "auth-org-mvp.db"
    models_dir = tmp_path / "models"
    previous = {
        "AUTH_DB_PATH": os.environ.get("AUTH_DB_PATH"),
        "BPMN_MODELS_DIR": os.environ.get("BPMN_MODELS_DIR"),
        "SUPER_ADMIN_EMAILS": os.environ.get("SUPER_ADMIN_EMAILS"),
    }
    os.environ["AUTH_DB_PATH"] = str(db_path)
    os.environ["BPMN_MODELS_DIR"] = str(models_dir)
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


def test_user_can_create_only_one_owned_org(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        client = _authed_client("owner@example.com")

        first = client.post("/api/orgs", json={"name": "First Org"})
        assert first.status_code == 201

        second = client.post("/api/orgs", json={"name": "Second Org"})
        assert second.status_code == 400
        assert "iba jednu organizaciu" in (second.json().get("detail") or "").lower()
    finally:
        _restore_env(previous)


def test_owner_can_join_other_orgs_and_have_multiple_memberships(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("a@example.com", "password123")
        register_user("b@example.com", "password123")
        register_user("c@example.com", "password123")

        client_a = _authed_client("a@example.com")
        client_b = _authed_client("b@example.com")
        client_c = _authed_client("c@example.com")

        org_a = client_a.post("/api/orgs", json={"name": "Org A"}).json()
        org_b = client_b.post("/api/orgs", json={"name": "Org B"}).json()
        org_c = client_c.post("/api/orgs", json={"name": "Org C"}).json()

        token_b = client_b.get(f"/api/orgs/{org_b['id']}/invite-link").json()["token"]
        token_c = client_c.get(f"/api/orgs/{org_c['id']}/invite-link").json()["token"]

        join_b = client_a.post(f"/api/orgs/invite/{token_b}/accept")
        join_c = client_a.post(f"/api/orgs/invite/{token_c}/accept")
        assert join_b.status_code == 200
        assert join_c.status_code == 200

        my_orgs = client_a.get("/api/orgs/my")
        assert my_orgs.status_code == 200
        items = my_orgs.json()
        assert len(items) == 3
        roles = {str(item.get("id")): str(item.get("role")) for item in items}
        assert roles[str(org_a["id"])] == "owner"
        assert roles[str(org_b["id"])] == "member"
        assert roles[str(org_c["id"])] == "member"
    finally:
        _restore_env(previous)


def test_owner_member_permissions_and_member_can_work_with_models(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("member@example.com", "password123")

        owner_client = _authed_client("owner@example.com")
        member_client = _authed_client("member@example.com")

        created = owner_client.post("/api/orgs", json={"name": "Org Main"})
        assert created.status_code == 201
        org_id = created.json()["id"]

        add_member = owner_client.post(
            "/api/orgs/members",
            json={"email": "member@example.com", "org_id": org_id, "role": "member"},
        )
        assert add_member.status_code == 200

        remove_member = owner_client.post(
            "/api/orgs/members/remove",
            json={"email": "member@example.com", "org_id": org_id},
        )
        assert remove_member.status_code == 200

        remove_owner_forbidden = owner_client.post(
            "/api/orgs/members/remove",
            json={"email": "owner@example.com", "org_id": org_id},
        )
        assert remove_owner_forbidden.status_code == 400

        add_member_again = owner_client.post(
            "/api/orgs/members",
            json={"email": "member@example.com", "org_id": org_id, "role": "member"},
        )
        assert add_member_again.status_code == 200

        list_models = member_client.get(f"/api/orgs/models?org_id={org_id}")
        assert list_models.status_code == 200

        created_model = member_client.post(
            f"/api/orgs/models?org_id={org_id}",
            json={
                "name": "Member editable process",
                "engine_json": {"nodes": [], "flows": [], "lanes": []},
                "diagram_xml": "<definitions />",
            },
        )
        assert created_model.status_code == 200
        org_model_id = created_model.json()["org_model_id"]

        updated_model = member_client.put(
            f"/api/orgs/models/{org_model_id}?org_id={org_id}",
            json={
                "name": "Updated by member",
                "engine_json": {"nodes": [], "flows": [], "lanes": []},
                "diagram_xml": "<definitions />",
            },
        )
        assert updated_model.status_code == 200

        member_list_visible = member_client.get(f"/api/orgs/members?org_id={org_id}")
        assert member_list_visible.status_code == 200
        assert any((row.get("email") or "").lower() == "owner@example.com" for row in member_list_visible.json())

        member_invite_forbidden = member_client.get(f"/api/orgs/{org_id}/invite-link")
        assert member_invite_forbidden.status_code == 403
    finally:
        _restore_env(previous)


def test_owner_can_manage_other_owners_but_last_owner_is_protected(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("second@example.com", "password123")
        register_user("third@example.com", "password123")

        owner_client = _authed_client("owner@example.com")
        created = owner_client.post("/api/orgs", json={"name": "Org Main"})
        assert created.status_code == 201
        org_id = created.json()["id"]

        add_second = owner_client.post(
            "/api/orgs/members",
            json={"email": "second@example.com", "org_id": org_id, "role": "member"},
        )
        assert add_second.status_code == 200

        promote_second = owner_client.post(
            "/api/orgs/members/role",
            json={"email": "second@example.com", "org_id": org_id, "role": "owner"},
        )
        assert promote_second.status_code == 200
        assert promote_second.json()["role"] == "owner"

        remove_original_owner = owner_client.post(
            "/api/orgs/members/remove",
            json={"email": "owner@example.com", "org_id": org_id},
        )
        assert remove_original_owner.status_code == 200

        second_client = _authed_client("second@example.com")

        demote_last_owner = second_client.post(
            "/api/orgs/members/role",
            json={"email": "second@example.com", "org_id": org_id, "role": "member"},
        )
        assert demote_last_owner.status_code == 400

        remove_last_owner = second_client.post(
            "/api/orgs/members/remove",
            json={"email": "second@example.com", "org_id": org_id},
        )
        assert remove_last_owner.status_code == 400

        add_third = second_client.post(
            "/api/orgs/members",
            json={"email": "third@example.com", "org_id": org_id, "role": "member"},
        )
        assert add_third.status_code == 200

        promote_third = second_client.post(
            "/api/orgs/members/role",
            json={"email": "third@example.com", "org_id": org_id, "role": "owner"},
        )
        assert promote_third.status_code == 200

        demote_second = second_client.post(
            "/api/orgs/members/role",
            json={"email": "second@example.com", "org_id": org_id, "role": "member"},
        )
        assert demote_second.status_code == 200
        assert demote_second.json()["role"] == "member"
    finally:
        _restore_env(previous)


def test_member_can_leave_joined_org(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")
        register_user("member@example.com", "password123")

        owner_client = _authed_client("owner@example.com")
        member_client = _authed_client("member@example.com")

        created = owner_client.post("/api/orgs", json={"name": "Org Main"})
        assert created.status_code == 201
        org_id = created.json()["id"]

        add_member = owner_client.post(
            "/api/orgs/members",
            json={"email": "member@example.com", "org_id": org_id, "role": "member"},
        )
        assert add_member.status_code == 200

        leave_org = member_client.post("/api/orgs/leave", json={"org_id": org_id})
        assert leave_org.status_code == 200

        members_after = owner_client.get(f"/api/orgs/members?org_id={org_id}")
        assert members_after.status_code == 200
        assert all((row.get("email") or "").lower() != "member@example.com" for row in members_after.json())
    finally:
        _restore_env(previous)


def test_last_owner_cannot_leave_org(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("owner@example.com", "password123")

        owner_client = _authed_client("owner@example.com")
        created = owner_client.post("/api/orgs", json={"name": "Org Main"})
        assert created.status_code == 201
        org_id = created.json()["id"]

        leave_org = owner_client.post("/api/orgs/leave", json={"org_id": org_id})
        assert leave_org.status_code == 400
        assert "owner" in (leave_org.json().get("detail") or "").lower()
    finally:
        _restore_env(previous)


def test_org_scoped_endpoints_validate_membership_and_selected_org(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("multi@example.com", "password123")
        register_user("owner2@example.com", "password123")
        register_user("outsider@example.com", "password123")

        multi_client = _authed_client("multi@example.com")
        owner2_client = _authed_client("owner2@example.com")
        outsider_client = _authed_client("outsider@example.com")

        first_org = multi_client.post("/api/orgs", json={"name": "First"}).json()
        second_org = owner2_client.post("/api/orgs", json={"name": "Second"}).json()

        token = owner2_client.get(f"/api/orgs/{second_org['id']}/invite-link").json()["token"]
        accepted = multi_client.post(f"/api/orgs/invite/{token}/accept")
        assert accepted.status_code == 200

        missing_selected_org = multi_client.get("/api/orgs/models")
        assert missing_selected_org.status_code == 400
        assert "vyber aktivnu organizaciu" in (missing_selected_org.json().get("detail") or "").lower()

        explicit_org = multi_client.get(f"/api/orgs/models?org_id={first_org['id']}")
        assert explicit_org.status_code == 200

        forbidden = outsider_client.get(f"/api/orgs/models?org_id={first_org['id']}")
        assert forbidden.status_code == 403

        single_org_default = owner2_client.get("/api/orgs/models")
        assert single_org_default.status_code == 200
    finally:
        _restore_env(previous)


def test_superadmin_flag_from_auth_me_is_preserved(tmp_path):
    previous = _set_env(tmp_path)
    try:
        os.environ["SUPER_ADMIN_EMAILS"] = "super@example.com"
        run_auth_migrations()
        register_user("super@example.com", "password123")
        client = _authed_client("super@example.com")

        response = client.get("/api/auth/me")
        assert response.status_code == 200
        user = response.json().get("user") or {}
        assert user.get("is_super_admin") is True
    finally:
        _restore_env(previous)
