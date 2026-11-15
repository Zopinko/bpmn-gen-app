import json
import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

from main import create_app
from auth.db import get_connection, run_auth_migrations
from auth.deps import require_super_admin
from auth.service import AuthUser, create_org_with_owner, create_session_for_user, find_user_id_by_email, register_user
from routers.admin_router import router as admin_router
from services import model_storage
from services.feedback_storage import create_feedback
from services.model_storage import save_model


def _set_env(tmp_path):
    db_path = tmp_path / "auth-admin-users.db"
    models_dir = tmp_path / "models"
    previous = {
        "AUTH_DB_PATH": os.environ.get("AUTH_DB_PATH"),
        "BPMN_MODELS_DIR": os.environ.get("BPMN_MODELS_DIR"),
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


def _make_admin_client(current_user: AuthUser) -> TestClient:
    app = FastAPI()
    app.dependency_overrides[require_super_admin] = lambda: current_user
    app.include_router(admin_router)
    return TestClient(app)


def test_admin_can_resolve_and_reopen_existing_feedback(tmp_path, monkeypatch):
    monkeypatch.setenv("BPMN_MODELS_DIR", str(tmp_path))
    legacy = {"id": "legacy", "message": "Previous feedback"}
    (tmp_path / "feedback.json").write_text(json.dumps([legacy]), encoding="utf-8")
    new = create_feedback("user", "user@example.com", "New feedback")
    client = _make_admin_client(AuthUser(id="admin", email="admin@example.com", role="user",
                                        email_verified_at=None, created_at="2026-01-01"))
    route = "/api/admin/feedback"
    assert all(item["resolved"] is False for item in client.get(route).json()["items"])
    assert client.patch(f"{route}/legacy", json={"resolved": "false"}).status_code == 422
    assert client.patch(f"{route}/missing", json={"resolved": True}).status_code == 404
    for _ in range(2):
        assert client.patch(f"{route}/legacy", json={"resolved": True}).json()["resolved"] is True
    result = client.get(route).json()
    assert result["count"] == 2
    assert result["items"] == [new, {**legacy, "resolved": True}]
    assert client.patch(f"{route}/legacy", json={"resolved": False}).json()["resolved"] is False
    assert all(item["resolved"] is False for item in client.get(route).json()["items"])


def test_admin_counts_only_saved_sandbox_models_for_existing_accounts(tmp_path, monkeypatch):
    previous = _set_env(tmp_path)
    models_dir = tmp_path / "models"
    monkeypatch.setattr(model_storage, "_base_dir", models_dir)
    try:
        run_auth_migrations()
        admin = register_user("super@example.com", "password123")
        first = register_user("first@example.com", "password123")
        second = register_user("second@example.com", "password123")
        payload = {"name": "Process", "engine_json": {}, "diagram_xml": "<definitions />"}
        save_model(**payload, model_id="shared", user_id=first.id)
        save_model(**payload, model_id="shared", user_id=second.id)
        save_model(**payload, model_id="another", user_id=first.id)
        save_model(**payload, model_id="orphan", user_id="deleted-account")
        save_model(**payload, model_id="global")
        org_dir = models_dir / "orgs" / "example-org" / "models"
        org_dir.mkdir(parents=True)
        (org_dir / "model.json").write_text('{"id":"org-model"}', encoding="utf-8")
        (models_dir / "users" / first.id / "models" / "broken.json").write_text("{", encoding="utf-8")

        response = _make_admin_client(admin).get("/api/admin/users")
        assert response.status_code == 200
        counts = {row["id"]: row["sandbox_model_count"] for row in response.json()["items"]}
        assert counts == {admin.id: 0, first.id: 2, second.id: 1}
        assert not (models_dir / "users" / admin.id).exists()
    finally:
        _restore_env(previous)


def test_super_admin_can_delete_regular_user_and_cleanup_storage(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        admin = register_user("super@example.com", "password123")
        user = register_user("victim@example.com", "password123")
        create_session_for_user(user_id=user.id, ip_address="127.0.0.1", user_agent="pytest")
        save_model(
            name="Personal model",
            engine_json={"nodes": [], "flows": [], "lanes": []},
            diagram_xml="<definitions />",
            user_id=user.id,
        )

        client = _make_admin_client(
            AuthUser(
                id=admin.id,
                email=admin.email,
                role=admin.role,
                email_verified_at=admin.email_verified_at,
                created_at=admin.created_at,
                language=admin.language,
            )
        )

        response = client.delete(f"/api/admin/users/{user.id}")
        assert response.status_code == 200
        payload = response.json()
        assert payload["deleted"] is True
        assert payload["deleted_personal_models"] == 1

        with get_connection() as conn:
            deleted_user = conn.execute("SELECT id FROM users WHERE id = ?", (user.id,)).fetchone()
            deleted_sessions = conn.execute("SELECT id FROM auth_sessions WHERE user_id = ?", (user.id,)).fetchall()
        assert deleted_user is None
        assert deleted_sessions == []
        assert not (tmp_path / "models" / "users" / user.id).exists()
    finally:
        _restore_env(previous)


def test_delete_user_is_blocked_when_user_created_organization(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        admin = register_user("super@example.com", "password123")
        owner = register_user("owner@example.com", "password123")
        create_org_with_owner("Created Org", owner.id)

        client = _make_admin_client(admin)
        response = client.delete(f"/api/admin/users/{owner.id}")

        assert response.status_code == 409
        assert "vytvoril organizaciu" in (response.json().get("detail") or "").lower()
        assert find_user_id_by_email("owner@example.com") == owner.id
    finally:
        _restore_env(previous)


def test_super_admin_cannot_delete_currently_authenticated_account(tmp_path):
    previous = _set_env(tmp_path)
    try:
        run_auth_migrations()
        admin = register_user("super@example.com", "password123")
        client = _make_admin_client(admin)

        response = client.delete(f"/api/admin/users/{admin.id}")

        assert response.status_code == 400
        assert "nie je mozne zmazat" in (response.json().get("detail") or "").lower()
    finally:
        _restore_env(previous)


def test_admin_delete_preflight_returns_cors_headers(tmp_path):
    previous = _set_env(tmp_path)
    old_admin_available = os.environ.get("ADMIN_PANEL_AVAILABLE")
    old_super_admins = os.environ.get("SUPER_ADMIN_EMAILS")
    old_cors = os.environ.get("CORS_ALLOW_ORIGINS")
    try:
        os.environ["ADMIN_PANEL_AVAILABLE"] = "true"
        os.environ["SUPER_ADMIN_EMAILS"] = "super@example.com"
        os.environ["CORS_ALLOW_ORIGINS"] = "https://app.example.com"
        run_auth_migrations()
        register_user("super@example.com", "password123")
        app = create_app()
        client = TestClient(app)

        response = client.options(
            "/api/admin/users/some-user-id",
            headers={
                "Origin": "https://app.example.com",
                "Access-Control-Request-Method": "DELETE",
            },
        )

        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "https://app.example.com"
        assert response.headers.get("access-control-allow-credentials") == "true"
    finally:
        if old_admin_available is None:
            os.environ.pop("ADMIN_PANEL_AVAILABLE", None)
        else:
            os.environ["ADMIN_PANEL_AVAILABLE"] = old_admin_available
        if old_super_admins is None:
            os.environ.pop("SUPER_ADMIN_EMAILS", None)
        else:
            os.environ["SUPER_ADMIN_EMAILS"] = old_super_admins
        if old_cors is None:
            os.environ.pop("CORS_ALLOW_ORIGINS", None)
        else:
            os.environ["CORS_ALLOW_ORIGINS"] = old_cors
        _restore_env(previous)
