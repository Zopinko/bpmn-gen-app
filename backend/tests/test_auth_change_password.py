import os
from urllib.parse import parse_qs, urlsplit
from collections import defaultdict, deque

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth.db import get_connection, run_auth_migrations
from auth.service import change_password, create_session_for_user, find_user_by_session, register_user
import routers.auth_router as auth_router_module
from routers.auth_router import router as auth_router


@pytest.fixture(autouse=True)
def _isolated_rate_limits(monkeypatch):
    monkeypatch.setattr(auth_router_module, "_rate_limit_buckets", defaultdict(deque))


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


def test_bpmn_test_auth_does_not_bypass_auth_in_production(tmp_path):
    old_db = _set_auth_env(tmp_path)
    old_app_env = os.environ.get("APP_ENV")
    old_test_auth = os.environ.get("BPMN_TEST_AUTH")
    old_cors = os.environ.get("CORS_ALLOW_ORIGINS")
    old_reset_base = os.environ.get("PASSWORD_RESET_URL_BASE")
    try:
        run_auth_migrations()
        client = _make_client()
        os.environ["APP_ENV"] = "production"
        os.environ["BPMN_TEST_AUTH"] = "1"
        os.environ["CORS_ALLOW_ORIGINS"] = "https://app.example.com"
        os.environ["PASSWORD_RESET_URL_BASE"] = "https://app.example.com/reset-password"

        response = client.get("/api/auth/me")

        assert response.status_code == 401
    finally:
        if old_app_env is None:
            os.environ.pop("APP_ENV", None)
        else:
            os.environ["APP_ENV"] = old_app_env
        if old_test_auth is None:
            os.environ.pop("BPMN_TEST_AUTH", None)
        else:
            os.environ["BPMN_TEST_AUTH"] = old_test_auth
        if old_cors is None:
            os.environ.pop("CORS_ALLOW_ORIGINS", None)
        else:
            os.environ["CORS_ALLOW_ORIGINS"] = old_cors
        if old_reset_base is None:
            os.environ.pop("PASSWORD_RESET_URL_BASE", None)
        else:
            os.environ["PASSWORD_RESET_URL_BASE"] = old_reset_base
        _restore_auth_env(old_db)


def test_change_password_keeps_current_session_and_revokes_others(tmp_path):
    old_db = _set_auth_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("sessions@example.com", "oldpassword123")
        register_user("other@example.com", "otherpassword123")
        first, second, other = _make_client(), _make_client(), _make_client()
        for client in (first, second):
            assert client.post("/api/auth/login", json={
                "email": "sessions@example.com", "password": "oldpassword123",
            }).status_code == 200
        assert other.post("/api/auth/login", json={
            "email": "other@example.com", "password": "otherpassword123",
        }).status_code == 200
        assert second.get("/api/auth/me").status_code == 200

        response = first.post("/api/auth/change-password", json={
            "current_password": "oldpassword123", "new_password": "newpassword123",
        })

        assert response.status_code == 200
        assert first.get("/api/auth/me").status_code == 200
        assert second.get("/api/auth/me").status_code == 401
        assert other.get("/api/auth/me").status_code == 200
    finally:
        _restore_auth_env(old_db)


def test_change_password_invalidates_existing_reset_token(tmp_path, monkeypatch):
    old_db = _set_auth_env(tmp_path)
    reset_links = []
    monkeypatch.setattr(
        "auth.service.send_password_reset_email",
        lambda email, link, language: reset_links.append(link),
    )
    try:
        run_auth_migrations()
        user = register_user("reset-change@example.com", "oldpassword123")
        client = _make_client()
        assert client.post("/api/auth/login", json={
            "email": user.email, "password": "oldpassword123",
        }).status_code == 200
        assert client.post("/api/auth/forgot-password", json={"email": user.email}).status_code == 200
        token = parse_qs(urlsplit(reset_links[0]).query)["token"][0]
        with get_connection() as conn:
            before = conn.execute(
                "SELECT password_reset_token_hash, password_reset_expires_at FROM users WHERE id = ?",
                (user.id,),
            ).fetchone()
        assert before["password_reset_token_hash"]
        assert before["password_reset_expires_at"]

        assert client.post("/api/auth/change-password", json={
            "current_password": "oldpassword123", "new_password": "newpassword123",
        }).status_code == 200

        with get_connection() as conn:
            after = conn.execute(
                "SELECT password_reset_token_hash, password_reset_expires_at FROM users WHERE id = ?",
                (user.id,),
            ).fetchone()
        assert after["password_reset_token_hash"] is None
        assert after["password_reset_expires_at"] is None
        assert client.post("/api/auth/reset-password", json={
            "token": token, "new_password": "resetpassword123",
        }).status_code == 400
        assert client.get("/api/auth/me").status_code == 200
        assert client.post("/api/auth/login", json={
            "email": user.email, "password": "newpassword123",
        }).status_code == 200
    finally:
        _restore_auth_env(old_db)


def test_change_password_without_keep_token_revokes_all_sessions(tmp_path):
    old_db = _set_auth_env(tmp_path)
    try:
        run_auth_migrations()
        user = register_user("no-keep@example.com", "oldpassword123")
        tokens = [create_session_for_user(user.id, None, None) for _ in range(2)]

        change_password(user.id, "oldpassword123", "newpassword123")

        assert all(find_user_by_session(token) is None for token in tokens)
    finally:
        _restore_auth_env(old_db)
