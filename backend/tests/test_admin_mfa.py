import base64

import pyotp
import pytest
from fastapi.testclient import TestClient

from auth.db import get_connection
from auth.service import create_session_for_user, register_user
from main import create_app


@pytest.fixture
def admin_clients(tmp_path, monkeypatch):
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.delenv("BPMN_TEST_AUTH", raising=False)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setenv("ADMIN_PANEL_AVAILABLE", "true")
    monkeypatch.setenv("SESSION_COOKIE_NAME", "mfa_test")
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "false")
    monkeypatch.setenv("SESSION_COOKIE_SAMESITE", "lax")
    monkeypatch.setenv("ADMIN_MFA_ENCRYPTION_KEY", base64.urlsafe_b64encode(bytes(32)).decode())
    app = create_app()
    admin = register_user("admin@example.com", "test-password")
    member = register_user("member@example.com", "test-password")
    monkeypatch.setenv("SUPER_ADMIN_USER_IDS", admin.id)
    monkeypatch.setenv("SUPER_ADMIN_EMAILS", member.email)

    def client(user):
        return TestClient(app, cookies={"mfa_test": create_session_for_user(user.id, None, None)})

    return admin, client(admin), client(admin), client(member)


def test_enrollment_elevation_and_recovery(admin_clients):
    admin, client, other_session, member = admin_clients
    path = "/api/admin/mfa"
    assert member.get(f"{path}/status").status_code == 404
    assert client.get("/api/admin/users").status_code == 403
    assert client.post(f"{path}/setup", json={"password": "test-password"}).status_code == 403
    with get_connection() as conn:
        conn.execute("UPDATE users SET email_verified_at = created_at WHERE id = ?", (admin.id,))

    assert client.post(f"{path}/setup", json={"password": "wrong-password"}).status_code == 403
    response = client.post(f"{path}/setup", json={"password": "test-password"})
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["qr_data_url"].startswith("data:image/svg+xml;base64,")
    code = pyotp.TOTP(response.json()["manual_key"]).now()
    assert other_session.post(f"{path}/confirm", json={"code": code}).status_code == 409
    confirmed = client.post(f"{path}/confirm", json={"code": code})
    assert confirmed.status_code == 200
    recovery = confirmed.json()["recovery_codes"]
    assert len(set(recovery)) == 8
    assert client.get("/api/admin/users").status_code == 200
    assert other_session.get("/api/admin/users").status_code == 403
    assert other_session.post(f"{path}/unlock", json={"code": code}).status_code == 403
    assert other_session.post(f"{path}/setup", json={"password": "test-password"}).status_code == 409
    assert other_session.post(f"{path}/unlock", json={"code": recovery[0]}).status_code == 200
    assert other_session.get("/api/admin/users").status_code == 200
    with get_connection() as conn:
        conn.execute("UPDATE admin_mfa_elevations SET expires_at = '1970-01-01T00:00:00Z'")
    assert other_session.get("/api/admin/users").status_code == 403
    assert other_session.post(f"{path}/unlock", json={"code": recovery[0]}).status_code == 403


def test_admin_id_is_required_and_key_fails_closed(admin_clients, monkeypatch):
    _, client, _, _ = admin_clients
    monkeypatch.delenv("ADMIN_MFA_ENCRYPTION_KEY")
    assert client.get("/api/admin/mfa/status").status_code == 503
    assert client.get("/api/admin/users").status_code == 403
    monkeypatch.delenv("SUPER_ADMIN_USER_IDS")
    assert client.get("/api/admin/mfa/status").status_code == 404


def test_admin_mfa_rejects_untrusted_origin_and_limits_attempts_by_account(admin_clients):
    admin, client, other_session, _ = admin_clients
    with get_connection() as conn:
        conn.execute("UPDATE users SET email_verified_at = created_at WHERE id = ?", (admin.id,))

    path = "/api/admin/mfa/setup"
    password = {"password": "wrong-password"}
    assert client.post(
        path, json=password, headers={"Origin": "https://untrusted.example"}
    ).status_code == 403
    with get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM admin_mfa_attempts").fetchone()[0] == 0
    for _ in range(8):
        assert client.post(path, json=password).status_code == 403
    assert other_session.post(path, json=password).status_code == 429
