import importlib
import logging
import os
import smtplib

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import model_storage, project_notes_storage


def test_org_invite_secret_raises_in_production_when_missing(monkeypatch):
    monkeypatch.delenv("ORG_INVITE_TOKEN_SECRET", raising=False)
    monkeypatch.setenv("APP_ENV", "production")

    from auth import security as security_module

    security = importlib.reload(security_module)
    try:
        try:
            security.make_org_invite_public_token("invite-1")
            raise AssertionError("Expected RuntimeError when secret is missing in production.")
        except RuntimeError as exc:
            assert "ORG_INVITE_TOKEN_SECRET must be configured" in str(exc)
    finally:
        importlib.reload(security_module)


def test_auth_config_requires_render_production_envs(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)
    monkeypatch.delenv("PASSWORD_RESET_URL_BASE", raising=False)
    monkeypatch.delenv("AUTH_DB_PATH", raising=False)

    from core.auth_config import get_auth_config

    try:
        get_auth_config()
        raise AssertionError("Expected RuntimeError when production env vars are missing.")
    except RuntimeError as exc:
        assert "CORS_ALLOW_ORIGINS must be configured" in str(exc)


def test_auth_config_requires_password_reset_url_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://app.example.com")
    monkeypatch.delenv("PASSWORD_RESET_URL_BASE", raising=False)
    monkeypatch.delenv("AUTH_DB_PATH", raising=False)

    from core.auth_config import get_auth_config

    try:
        get_auth_config()
        raise AssertionError("Expected RuntimeError when PASSWORD_RESET_URL_BASE is missing in production.")
    except RuntimeError as exc:
        assert "PASSWORD_RESET_URL_BASE must be configured" in str(exc)


def test_auth_config_requires_auth_db_path_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://app.example.com")
    monkeypatch.setenv("PASSWORD_RESET_URL_BASE", "https://app.example.com/reset-password")
    monkeypatch.delenv("AUTH_DB_PATH", raising=False)

    from core.auth_config import get_auth_config

    try:
        get_auth_config()
        raise AssertionError("Expected RuntimeError when AUTH_DB_PATH is missing in production.")
    except RuntimeError as exc:
        assert "AUTH_DB_PATH must be configured" in str(exc)


def test_corrupt_storage_files_are_skipped_with_warning(tmp_path, caplog):
    model_storage.set_base_dir(tmp_path / "models")
    bad_model = model_storage.get_user_models_dir("user-1") / "broken.json"
    bad_model.write_text("{broken", encoding="utf-8")

    original_notes_dir = os.environ.get("BPMN_PROJECT_NOTES_DIR")
    os.environ["BPMN_PROJECT_NOTES_DIR"] = str(tmp_path / "notes")
    try:
        bad_notes = tmp_path / "notes" / "org_org-1.json"
        bad_notes.parent.mkdir(parents=True, exist_ok=True)
        bad_notes.write_text("{broken", encoding="utf-8")

        caplog.set_level(logging.WARNING)
        models = model_storage.list_models(user_id="user-1")
        notes = project_notes_storage.load_project_notes("org-1")

        assert models == []
        assert notes == []
        messages = [record.getMessage() for record in caplog.records]
        assert any("Failed to read model file while listing" in message for message in messages)
        assert any("Failed to read project notes file" in message for message in messages)
    finally:
        if original_notes_dir is None:
            os.environ.pop("BPMN_PROJECT_NOTES_DIR", None)
        else:
            os.environ["BPMN_PROJECT_NOTES_DIR"] = original_notes_dir


def test_password_reset_email_logs_do_not_expose_reset_link(caplog, monkeypatch):
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "console")

    from auth.email_service import send_password_reset_email

    caplog.set_level(logging.INFO)
    reset_link = "https://app.example.com/reset-password?token=secret-token"
    send_password_reset_email("user@example.com", reset_link)

    messages = [record.getMessage() for record in caplog.records]
    assert any("Password reset email dispatch suppressed" in message for message in messages)
    assert all(reset_link not in message for message in messages)
    assert all("secret-token" not in message for message in messages)


def test_password_reset_email_allowlist_blocks_non_listed_recipient(caplog, monkeypatch):
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "smtp")
    monkeypatch.setenv("AUTH_EMAIL_ALLOWLIST", "allowed@example.com")

    from auth.email_service import send_password_reset_email

    caplog.set_level(logging.INFO)
    send_password_reset_email("blocked@example.com", "https://app.example.com/reset-password?token=secret-token")

    messages = [record.getMessage() for record in caplog.records]
    assert any("Password reset email blocked by allowlist" in message for message in messages)
    assert all("secret-token" not in message for message in messages)


def test_password_reset_email_sends_via_smtp(monkeypatch):
    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            sent["host"] = host
            sent["port"] = port
            sent["timeout"] = timeout
            sent["starttls"] = False

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def ehlo(self):
            sent["ehlo"] = sent.get("ehlo", 0) + 1

        def starttls(self, context=None):
            sent["starttls"] = True

        def login(self, username, password):
            sent["username"] = username
            sent["password"] = password

        def send_message(self, message):
            sent["subject"] = message["Subject"]
            sent["from"] = message["From"]
            sent["to"] = message["To"]
            sent["body"] = message.get_content()

    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "smtp")
    monkeypatch.delenv("AUTH_EMAIL_ALLOWLIST", raising=False)
    monkeypatch.setenv("AUTH_EMAIL_FROM", "noreply@example.com")
    monkeypatch.setenv("AUTH_EMAIL_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("AUTH_EMAIL_SMTP_PORT", "587")
    monkeypatch.setenv("AUTH_EMAIL_SMTP_SECURITY", "starttls")
    monkeypatch.setenv("AUTH_EMAIL_SMTP_USERNAME", "smtp-user")
    monkeypatch.setenv("AUTH_EMAIL_SMTP_PASSWORD", "smtp-pass")
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)

    from auth.email_service import send_password_reset_email

    send_password_reset_email("user@example.com", "https://app.example.com/reset-password?token=known-token")

    assert sent["host"] == "smtp.example.com"
    assert sent["port"] == 587
    assert sent["timeout"] == 20.0
    assert sent["starttls"] is True
    assert sent["username"] == "smtp-user"
    assert sent["password"] == "smtp-pass"
    assert sent["subject"] == "Reset hesla"
    assert sent["from"] == "noreply@example.com"
    assert sent["to"] == "user@example.com"
    assert "https://app.example.com/reset-password?token=known-token" in sent["body"]


def test_mount_playground_skips_missing_directory(caplog, tmp_path):
    from main import mount_playground

    app = FastAPI()
    caplog.set_level(logging.WARNING)

    mount_playground(app, tmp_path / "missing-playground")

    assert not any(getattr(route, "path", None) == "/playground" for route in app.routes)
    assert any("Skipping playground mount" in record.getMessage() for record in caplog.records)


def test_healthz_endpoint_reports_ok():
    from main import app

    client = TestClient(app)
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
