import logging
import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth.db import get_connection, run_auth_migrations
from auth.service import register_user
from routers.auth_router import router as auth_router


GENERIC_SUCCESS = "If an account with that email exists, we sent a password reset link."


def _set_auth_env(tmp_path):
    db_path = tmp_path / "auth-reset.db"
    old_db = os.environ.get("AUTH_DB_PATH")
    old_provider = os.environ.get("AUTH_EMAIL_PROVIDER")
    old_reset_base = os.environ.get("PASSWORD_RESET_URL_BASE")
    os.environ["AUTH_DB_PATH"] = str(db_path)
    os.environ["AUTH_EMAIL_PROVIDER"] = "console"
    os.environ["PASSWORD_RESET_URL_BASE"] = "http://localhost:5173/reset-password"
    return old_db, old_provider, old_reset_base


def _restore_auth_env(old_db, old_provider, old_reset_base):
    if old_db is None:
        os.environ.pop("AUTH_DB_PATH", None)
    else:
        os.environ["AUTH_DB_PATH"] = old_db
    if old_provider is None:
        os.environ.pop("AUTH_EMAIL_PROVIDER", None)
    else:
        os.environ["AUTH_EMAIL_PROVIDER"] = old_provider
    if old_reset_base is None:
        os.environ.pop("PASSWORD_RESET_URL_BASE", None)
    else:
        os.environ["PASSWORD_RESET_URL_BASE"] = old_reset_base


def _make_client():
    app = FastAPI()
    app.include_router(auth_router)
    return TestClient(app)


def test_forgot_password_generic_response(tmp_path, caplog):
    old_db, old_provider, old_reset_base = _set_auth_env(tmp_path)
    try:
        run_auth_migrations()
        register_user("known@example.com", "oldpassword123")
        client = _make_client()
        caplog.set_level(logging.WARNING)

        known = client.post("/api/auth/forgot-password", json={"email": "known@example.com"})
        missing = client.post("/api/auth/forgot-password", json={"email": "missing@example.com"})

        assert known.status_code == 200
        assert missing.status_code == 200
        assert known.json().get("message") == GENERIC_SUCCESS
        assert missing.json().get("message") == GENERIC_SUCCESS
    finally:
        _restore_auth_env(old_db, old_provider, old_reset_base)


def test_password_reset_end_to_end_and_one_time_use(tmp_path, caplog):
    old_db, old_provider, old_reset_base = _set_auth_env(tmp_path)
    try:
        import auth.service as auth_service

        run_auth_migrations()
        register_user("user@example.com", "oldpassword123")
        client = _make_client()
        caplog.set_level(logging.INFO)
        token = "known-reset-token"
        original_token_factory = auth_service.secrets.token_urlsafe
        auth_service.secrets.token_urlsafe = lambda _: token

        try:
            request_resp = client.post("/api/auth/forgot-password", json={"email": "user@example.com"})
            assert request_resp.status_code == 200
            assert request_resp.json().get("message") == GENERIC_SUCCESS
            assert all(token not in record.getMessage() for record in caplog.records)

            reset_resp = client.post(
                "/api/auth/reset-password",
                json={"token": token, "new_password": "newpassword123"},
            )
            assert reset_resp.status_code == 200

            old_login = client.post(
                "/api/auth/login",
                json={"email": "user@example.com", "password": "oldpassword123"},
            )
            assert old_login.status_code == 401

            new_login = client.post(
                "/api/auth/login",
                json={"email": "user@example.com", "password": "newpassword123"},
            )
            assert new_login.status_code == 200

            reuse_resp = client.post(
                "/api/auth/reset-password",
                json={"token": token, "new_password": "anotherpass123"},
            )
            assert reuse_resp.status_code == 400
        finally:
            auth_service.secrets.token_urlsafe = original_token_factory
    finally:
        _restore_auth_env(old_db, old_provider, old_reset_base)


def test_password_reset_expired_token_fails(tmp_path, caplog):
    old_db, old_provider, old_reset_base = _set_auth_env(tmp_path)
    try:
        import auth.service as auth_service

        run_auth_migrations()
        register_user("expiry@example.com", "oldpassword123")
        client = _make_client()
        caplog.set_level(logging.INFO)
        token = "expired-reset-token"
        original_token_factory = auth_service.secrets.token_urlsafe
        auth_service.secrets.token_urlsafe = lambda _: token

        try:
            request_resp = client.post("/api/auth/forgot-password", json={"email": "expiry@example.com"})
            assert request_resp.status_code == 200
            assert all(token not in record.getMessage() for record in caplog.records)

            with get_connection() as conn:
                conn.execute(
                    """
                    UPDATE users
                    SET password_reset_expires_at = '2000-01-01T00:00:00Z'
                    WHERE email = 'expiry@example.com'
                    """
                )
                conn.commit()

            expired_resp = client.post(
                "/api/auth/reset-password",
                json={"token": token, "new_password": "newpassword123"},
            )
            assert expired_resp.status_code == 400
        finally:
            auth_service.secrets.token_urlsafe = original_token_factory
    finally:
        _restore_auth_env(old_db, old_provider, old_reset_base)


def test_password_reset_rejects_reusing_current_password(tmp_path):
    old_db, old_provider, old_reset_base = _set_auth_env(tmp_path)
    try:
        import auth.service as auth_service

        run_auth_migrations()
        register_user("reuse@example.com", "oldpassword123")
        client = _make_client()
        reset_link_value = "same-password-token"
        original_token_factory = auth_service.secrets.token_urlsafe
        auth_service.secrets.token_urlsafe = lambda _: reset_link_value

        try:
            request_resp = client.post("/api/auth/forgot-password", json={"email": "reuse@example.com"})
            assert request_resp.status_code == 200

            reset_resp = client.post(
                "/api/auth/reset-password",
                json={"token": reset_link_value, "new_password": "oldpassword123"},
            )
            assert reset_resp.status_code == 400
            assert reset_resp.json()["detail"] == "Nove heslo sa musi lisit od povodneho."
        finally:
            auth_service.secrets.token_urlsafe = original_token_factory
    finally:
        _restore_auth_env(old_db, old_provider, old_reset_base)
