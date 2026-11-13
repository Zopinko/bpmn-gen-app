import smtplib
from threading import Event
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import email_service, service
from auth.db import get_connection, run_auth_migrations
from routers.auth_router import router as auth_router


@pytest.fixture
def mail_setup(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "mail.db"))
    monkeypatch.setenv("AUTH_EMAIL_PROVIDER", "smtp")
    monkeypatch.setenv("PASSWORD_RESET_URL_BASE", "https://app.example.test/reset-password")
    monkeypatch.delenv("AUTH_EMAIL_ALLOWLIST", raising=False)
    run_auth_migrations()
    messages = []
    monkeypatch.setattr(email_service, "_send_via_smtp", lambda *message: messages.append(message))
    return messages


def test_verification_mail_confirms_address_once(mail_setup):
    from auth.email_outbox import deliver_next_auth_email
    from auth.email_verification import verify_email

    service.register_user("new@example.test", "test-password-123", "en")
    assert deliver_next_auth_email()
    recipient, subject, body = mail_setup[0]
    assert recipient == "new@example.test"
    assert subject == "Verify your email for BPMN.GEN"
    link = next(line for line in body.splitlines() if line.startswith("https://"))
    url = urlsplit(link)
    assert url.path == "/verify-email"
    assert not url.query
    token = parse_qs(url.fragment)["token"][0]
    verify_email(token)
    assert service.authenticate_user(recipient, "test-password-123").email_verified_at
    with pytest.raises(ValueError):
        verify_email(token)
    assert not deliver_next_auth_email()


def test_mail_retry_and_resend_do_not_create_duplicate_pending_links(mail_setup, monkeypatch):
    from auth.email_outbox import deliver_next_auth_email
    from auth.email_verification import request_email_verification

    user = service.register_user("new@example.test", "test-password-123", "sk")
    request_email_verification(user.email)
    request_email_verification("unknown@example.test")

    def fail_delivery(*_):
        raise smtplib.SMTPServerDisconnected("temporary failure")

    with monkeypatch.context() as mock:
        mock.setattr(email_service, "_send_via_smtp", fail_delivery)
        assert deliver_next_auth_email()
        assert not deliver_next_auth_email()

    with get_connection() as conn:
        rows = conn.execute("SELECT attempts FROM auth_email_outbox").fetchall()
        assert [row["attempts"] for row in rows] == [1]
        conn.execute("UPDATE auth_email_outbox SET available_at = '2000-01-01T00:00:00Z'")
    assert deliver_next_auth_email()
    assert len(mail_setup) == 1
    assert not deliver_next_auth_email()


def test_change_and_reset_enqueue_confirmation_after_success(mail_setup, monkeypatch):
    from auth.email_outbox import deliver_next_auth_email

    user = service.register_user("user@example.test", "original-password", "en")
    assert deliver_next_auth_email()
    mail_setup.clear()

    with pytest.raises(ValueError):
        service.change_password(user.id, "wrong-password", "changed-password")
    assert not deliver_next_auth_email()
    service.change_password(user.id, "original-password", "changed-password")
    assert deliver_next_auth_email()

    monkeypatch.setattr(service.secrets, "token_urlsafe", lambda _: "known-reset-token")
    service.request_password_reset(user.email)
    assert mail_setup[1][1] == "Reset your BPMN.GEN password"
    service.confirm_password_reset("known-reset-token", "reset-password-123")
    assert deliver_next_auth_email()

    assert [message[1] for message in mail_setup] == [
        "Your BPMN.GEN password changed", "Reset your BPMN.GEN password", "Your BPMN.GEN password changed",
    ]
    assert all("reset-password-123" not in body for _, _, body in mail_setup)


def test_expired_link_can_be_replaced(mail_setup):
    from auth.email_outbox import deliver_next_auth_email
    from auth.email_verification import request_email_verification, verify_email
    from auth.security import make_email_verification_token

    user = service.register_user("new@example.test", "test-password-123", "sk")
    with get_connection() as conn:
        expired_id = conn.execute("SELECT verification_id FROM email_verifications").fetchone()["verification_id"]
        conn.execute("UPDATE email_verifications SET expires_at = '2000-01-01T00:00:00Z', requested_at = '2000-01-01T00:00:00Z'")
    with pytest.raises(ValueError):
        verify_email(make_email_verification_token(expired_id))

    request_email_verification(user.email)
    while deliver_next_auth_email():
        pass
    assert len(mail_setup) == 1
    assert expired_id not in mail_setup[0][2]


def test_registration_and_verification_api(mail_setup, monkeypatch):
    from auth.email_outbox import deliver_next_auth_email

    monkeypatch.setenv("AUTH_REQUIRE_VERIFIED_EMAIL", "true")
    app = FastAPI()
    app.include_router(auth_router)
    with TestClient(app) as client:
        credentials = {"email": "new@example.test", "password": "test-password-123"}
        assert client.post("/api/auth/register", json={**credentials, "language": "en"}).status_code == 201
        assert client.post("/api/auth/login", json=credentials).status_code == 403
        assert deliver_next_auth_email()
        link = next(line for line in mail_setup[0][2].splitlines() if line.startswith("https://"))
        token = parse_qs(urlsplit(link).fragment)["token"][0]
        signature_changed = "b" if token[-1] == "a" else "a"
        assert client.post("/api/auth/verify-email", json={"token": token[:-1] + signature_changed}).status_code == 400
        assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 200
        assert client.post("/api/auth/login", json=credentials).json()["user"]["email_verified"] is True
        resend = client.post("/api/auth/resend-verification", json={"email": credentials["email"]})
        unknown = client.post("/api/auth/resend-verification", json={"email": "unknown@example.test"})
        assert resend.status_code == unknown.status_code == 200
        assert resend.json() == unknown.json()
        assert not deliver_next_auth_email()


def test_app_worker_sends_pending_email_on_startup(mail_setup, monkeypatch):
    from main import create_app

    service.register_user("queued@example.test", "test-password-123", "en")
    sent = Event()

    def capture_delivery(*message):
        mail_setup.append(message)
        sent.set()

    monkeypatch.setattr(email_service, "_send_via_smtp", capture_delivery)
    with TestClient(create_app()):
        assert sent.wait(timeout=3)
    assert mail_setup[0][0] == "queued@example.test"


def test_addressed_invite_requires_verified_recipient_and_keeps_shared_link(mail_setup):
    from auth.email_outbox import deliver_next_auth_email

    owner = service.register_user("owner@example.test", "test-password-123")
    org_id = service.create_org_with_owner("Test Team", owner.id)["id"]
    shared = service.get_or_create_org_invite(org_id, owner.id)
    service.send_org_invite_email(org_id, owner.id, "NEW@example.test", "en")
    with pytest.raises(service.OrgInviteSendLimit):
        service.send_org_invite_email(org_id, owner.id, "new@example.test", "en")
    assert service.get_latest_org_invite(org_id)["id"] == shared["id"]
    while deliver_next_auth_email():
        pass
    invites = [mail for mail in mail_setup if mail[0] == "new@example.test"]
    assert len(invites) == 1
    link = next(line for line in invites[0][2].splitlines() if line.startswith("https://"))
    url = urlsplit(link)
    assert url.path == "/join-org"
    token = parse_qs(url.fragment)["token"][0]
    recipient = service.register_user("new@example.test", "test-password-123")
    with pytest.raises(PermissionError, match="invite_email_mismatch"):
        service.accept_org_invite(token, owner.id)
    with pytest.raises(PermissionError, match="invite_email_unverified"):
        service.accept_org_invite(token, recipient.id)

    with get_connection() as conn:
        conn.execute("UPDATE users SET email_verified_at = datetime('now') WHERE id = ?", (recipient.id,))
        stored_token = conn.execute("SELECT token FROM organization_invites WHERE recipient_email = ?", (recipient.email,)).fetchone()[0]
    with pytest.raises(ValueError):
        service.accept_org_invite(stored_token, recipient.id)
    service.regenerate_org_invite(org_id, owner.id)
    assert service.accept_org_invite(token, recipient.id)["membership"]["role"] == "member"
    assert service.accept_org_invite(token, recipient.id)["membership"]["already_member"] is True
    with pytest.raises(PermissionError):
        service.send_org_invite_email(org_id, recipient.id, "someone@example.test", "en")


def test_resending_addressed_invite_replaces_only_that_recipient(mail_setup):
    from auth.email_outbox import deliver_next_auth_email

    owner = service.register_user("owner@example.test", "test-password-123")
    org_id = service.create_org_with_owner("Test Team", owner.id)["id"]
    service.send_org_invite_email(org_id, owner.id, "first@example.test", "sk")
    service.send_org_invite_email(org_id, owner.id, "second@example.test", "sk")
    with get_connection() as conn:
        conn.execute("UPDATE organization_invites SET created_at = '2000-01-01T00:00:00Z' WHERE recipient_email = 'first@example.test'")
    service.send_org_invite_email(org_id, owner.id, "first@example.test", "sk")

    while deliver_next_auth_email():
        pass
    assert sorted(mail[0] for mail in mail_setup if mail[0] != owner.email) == ["first@example.test", "second@example.test"]
    with get_connection() as conn:
        active = conn.execute("SELECT recipient_email FROM organization_invites WHERE revoked_at IS NULL ORDER BY recipient_email").fetchall()
    assert [invite[0] for invite in active] == ["first@example.test", "second@example.test"]


def test_membership_changes_notify_only_affected_member_once(mail_setup):
    from auth.email_outbox import deliver_next_auth_email

    owner = service.register_user("owner@example.test", "test-password-123", "sk")
    member = service.register_user("member@example.test", "test-password-123", "en")
    org_id = service.create_org_with_owner("Test Team", owner.id)["id"]
    while deliver_next_auth_email():
        pass
    mail_setup.clear()

    assert service.add_org_member(member.id, org_id, "member") is True
    assert service.add_org_member(member.id, org_id, "member") is False
    assert service.update_org_member_role_by_email(org_id, member.email, "owner")["updated"] is True
    assert service.update_org_member_role_by_email(org_id, member.email, "owner")["updated"] is False
    assert service.remove_org_member_by_email(org_id, member.email)["removed"] is True
    with pytest.raises(LookupError):
        service.remove_org_member_by_email(org_id, member.email)

    while deliver_next_auth_email():
        pass
    assert [(recipient, subject) for recipient, subject, _ in mail_setup] == [
        (member.email, "You were added to a BPMN.GEN organization"),
        (member.email, "You were made an owner of a BPMN.GEN organization"),
        (member.email, "Your access to a BPMN.GEN organization was removed"),
    ]
    assert all("Test Team" in body for _, _, body in mail_setup)
