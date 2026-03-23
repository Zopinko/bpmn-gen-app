from __future__ import annotations

from email.message import EmailMessage
import logging
import os
import smtplib
import ssl


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


def _send_via_smtp(email: str, reset_link: str) -> None:
    host = _required_env("AUTH_EMAIL_SMTP_HOST")
    port = int((os.getenv("AUTH_EMAIL_SMTP_PORT") or "").strip() or ("465" if _smtp_security_mode() == "ssl" else "587"))
    username = _required_env("AUTH_EMAIL_SMTP_USERNAME")
    password = _required_env("AUTH_EMAIL_SMTP_PASSWORD")
    from_email = _required_env("AUTH_EMAIL_FROM")
    security = _smtp_security_mode()

    message = EmailMessage()
    message["Subject"] = "Reset hesla"
    message["From"] = from_email
    message["To"] = email
    message.set_content(
        "Dostali sme požiadavku na reset hesla.\n\n"
        f"Pokračovať môžeš tu:\n{reset_link}\n\n"
        "Ak si o reset hesla nežiadal, tento email môžeš ignorovať."
    )

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


def send_password_reset_email(email: str, reset_link: str) -> None:
    provider = os.getenv("AUTH_EMAIL_PROVIDER", "console").strip().lower()
    email_allowlist = _csv_env("AUTH_EMAIL_ALLOWLIST")
    if email_allowlist and email.strip().lower() not in email_allowlist:
        logger.info("Password reset email blocked by allowlist for to=%s.", email)
        return

    if provider in {"", "console", "log", "stdout"}:
        logger.info(
            "Password reset email dispatch suppressed for provider=%s to=%s.",
            provider or "console",
            email,
        )
        return

    if provider == "smtp":
        _send_via_smtp(email, reset_link)
        logger.info("Password reset email sent via SMTP to=%s.", email)
        return

    # Foundation for future providers; keep dev-safe fallback for now.
    logger.warning(
        "Unknown AUTH_EMAIL_PROVIDER='%s'. Password reset email dispatch suppressed for to=%s.",
        provider,
        email,
    )
