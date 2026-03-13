import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth.db import run_auth_migrations
from auth.service import register_user
from routers.auth_router import router as auth_router


def _set_auth_env(tmp_path):
    db_path = tmp_path / "auth-change-password.db"
    old_db = os.environ.get("AUTH_DB_PATH")
    os.environ["AUTH_DB_PATH"] = str(db_path)
    return old_db


def _restore_auth_env(old_db):
    if old_db is None:
        os.environ.pop("AUTH_DB_PATH", None)
    else:
        os.environ["AUTH_DB_PATH"] = old_db


def _make_client():
    app = FastAPI()
    app.include_router(auth_router)
    return TestClient(app)


def test_me_returns_org_fields(tmp_path):
    old_db = _set_auth_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("me@example.com", "password123")
        client = _make_client()

        login_resp = client.post("/api/auth/login", json={"email": "me@example.com", "password": "password123"})
        assert login_resp.status_code == 200

        me_resp = client.get("/api/auth/me")
        assert me_resp.status_code == 200
        user = me_resp.json().get("user") or {}
        assert user.get("id")
        assert user.get("email") == "me@example.com"
        assert "org_id" in user
        assert "org_name" in user
        assert "created_at" in user
    finally:
        _restore_auth_env(old_db)


def test_change_password_requires_correct_current_password(tmp_path):
    old_db = _set_auth_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("cp@example.com", "oldpassword123")
        client = _make_client()

        login_resp = client.post("/api/auth/login", json={"email": "cp@example.com", "password": "oldpassword123"})
        assert login_resp.status_code == 200

        wrong_current = client.post(
            "/api/auth/change-password",
            json={"current_password": "wrongpass123", "new_password": "newpassword123"},
        )
        assert wrong_current.status_code == 400

        ok_change = client.post(
            "/api/auth/change-password",
            json={"current_password": "oldpassword123", "new_password": "newpassword123"},
        )
        assert ok_change.status_code == 200

        client.post("/api/auth/logout")

        old_login = client.post("/api/auth/login", json={"email": "cp@example.com", "password": "oldpassword123"})
        assert old_login.status_code == 401

        new_login = client.post("/api/auth/login", json={"email": "cp@example.com", "password": "newpassword123"})
        assert new_login.status_code == 200
    finally:
        _restore_auth_env(old_db)
