import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth.db import get_connection, run_auth_migrations
from auth.deps import require_super_admin
from auth.service import AuthUser, create_org_with_owner, create_session_for_user, find_user_id_by_email, register_user
from routers.admin_router import router as admin_router
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
