from __future__ import annotations

from email.headerregistry import Address
from email.message import EmailMessage
import logging
import os
import smtplib
import ssl

from auth import email_templates
from core.auth_config import get_auth_config


logger = logging.getLogger(__name__)


def _csv_env(name: str) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return []
    return [item.strip().lower() for item in raw.split(",") if item.strip()]


def _required_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} must be configured for SMTP email delivery.")
    return value


def _smtp_security_mode() -> str:
    mode = (os.getenv("AUTH_EMAIL_SMTP_SECURITY") or "starttls").strip().lower()
    if mode not in {"ssl", "starttls"}:
        raise RuntimeError("AUTH_EMAIL_SMTP_SECURITY must be either 'ssl' or 'starttls'.")
    return mode


def _send_via_smtp(email: str, subject: str, body: str, html: str | None = None) -> None:
    host = _required_env("AUTH_EMAIL_SMTP_HOST")
    port = int((os.getenv("AUTH_EMAIL_SMTP_PORT") or "").strip() or ("465" if _smtp_security_mode() == "ssl" else "587"))
    username = _required_env("AUTH_EMAIL_SMTP_USERNAME")
    password = _required_env("AUTH_EMAIL_SMTP_PASSWORD")
    from_email = _required_env("AUTH_EMAIL_FROM")
    security = _smtp_security_mode()

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = from_email
    message["To"] = Address(addr_spec=email)
    message.set_content(body)
    if html:
        # multipart/alternative: clients show the HTML, the plain text stays as a fallback.
        message.add_alternative(html, subtype="html")

    timeout = float((os.getenv("AUTH_EMAIL_SMTP_TIMEOUT_SECONDS") or "20").strip())
    if security == "ssl":
        with smtplib.SMTP_SSL(host, port, timeout=timeout, context=ssl.create_default_context()) as server:
            server.login(username, password)
            server.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=timeout) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.login(username, password)
            server.send_message(message)


def smtp_email_enabled() -> bool:
    return os.getenv("AUTH_EMAIL_PROVIDER", "console").strip().lower() == "smtp"


def is_recipient_allowed(email: str) -> bool:
    allowlist = _csv_env("AUTH_EMAIL_ALLOWLIST")
    return not allowlist or email.strip().lower() in allowlist


def _send_auth_email(label: str, email: str, message: email_templates.Email) -> None:
    provider = os.getenv("AUTH_EMAIL_PROVIDER", "console").strip().lower()
    if not is_recipient_allowed(email):
        logger.info("%s email blocked by allowlist.", label)
        return

    if provider in {"", "console", "log", "stdout"}:
        logger.info(
            "%s email dispatch suppressed for provider=%s.",
            label,
            provider or "console",
        )
        return

    if provider == "smtp":
        _send_via_smtp(email, message.subject, message.text, message.html)
        logger.info("%s email sent via SMTP.", label)
        return

    # Foundation for future providers; keep dev-safe fallback for now.
    logger.warning(
        "Unknown AUTH_EMAIL_PROVIDER='%s'. %s email dispatch suppressed.",
        provider,
        label,
    )


def send_password_reset_email(email: str, reset_link: str, language: str = "sk") -> None:
    ttl_minutes = max(1, round(get_auth_config().password_reset_ttl_seconds / 60))
    _send_auth_email("Password reset", email, email_templates.password_reset(email, reset_link, language, ttl_minutes))


def send_email_verification(email: str, link: str, language: str) -> None:
    _send_auth_email("Email verification", email, email_templates.email_verification(email, link, language))


def send_password_changed_email(email: str, language: str) -> None:
    _send_auth_email("Password changed", email, email_templates.password_changed(email, language))


def send_organization_invite(email: str, link: str, org_name: str, inviter: str, language: str) -> None:
    ttl_days = max(1, round(get_auth_config().org_invite_ttl_seconds / 86400))
    _send_auth_email(
        "Organization invitation",
        email,
        email_templates.organization_invite(email, link, org_name, inviter, language, ttl_days),
    )


def send_org_access_notice(email: str, org_name: str, notice_type: str, language: str) -> None:
    _send_auth_email("Organization access", email, email_templates.org_access_notice(org_name, notice_type, language))
