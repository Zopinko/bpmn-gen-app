from __future__ import annotations

from email.headerregistry import Address
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


def _send_via_smtp(email: str, subject: str, body: str) -> None:
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


def _send_auth_email(label: str, email: str, subject: str, body: str) -> None:
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
        _send_via_smtp(email, subject, body)
        logger.info("%s email sent via SMTP.", label)
        return

    # Foundation for future providers; keep dev-safe fallback for now.
    logger.warning(
        "Unknown AUTH_EMAIL_PROVIDER='%s'. %s email dispatch suppressed.",
        provider,
        label,
    )


def send_password_reset_email(email: str, reset_link: str, language: str = "sk") -> None:
    if language == "sk":
        subject = "Reset hesla"
        body = (
            f"Dostali sme požiadavku na reset hesla v BPMN.GEN.\n\nPokračovať môžeš tu:\n{reset_link}\n\n"
            "Ak si o reset hesla nežiadal, tento e-mail môžeš ignorovať."
        )
    else:
        subject = "Reset your BPMN.GEN password"
        body = (
            f"We received a request to reset your BPMN.GEN password.\n\nContinue here:\n{reset_link}\n\n"
            "If you did not request a password reset, you can ignore this email."
        )
    _send_auth_email("Password reset", email, subject, body)


def send_email_verification(email: str, link: str, language: str) -> None:
    if language == "sk":
        subject = "Over svoj e-mail pre BPMN.GEN"
        body = (
            f"Vitaj v BPMN.GEN! Svoju e-mailovú adresu môžeš overiť tu:\n\n{link}\n\n"
            "Odkaz platí 24 hodín od vytvorenia. Ak si si účet nevytvoril, tento e-mail môžeš ignorovať."
        )
    else:
        subject = "Verify your email for BPMN.GEN"
        body = (
            f"Welcome to BPMN.GEN! Verify your email address here:\n\n{link}\n\n"
            "This link expires 24 hours after it was created. If you did not create an account, you can ignore this email."
        )
    _send_auth_email("Email verification", email, subject, body)


def send_password_changed_email(email: str, language: str) -> None:
    if language == "sk":
        subject = "Heslo k tvojmu účtu BPMN.GEN sa zmenilo"
        body = (
            "Heslo k tvojmu účtu BPMN.GEN bolo úspešne zmenené.\n\n"
            "Ak si túto zmenu neurobil, obnov si heslo cez prihlasovaciu stránku BPMN.GEN."
        )
    else:
        subject = "Your BPMN.GEN password changed"
        body = (
            "Your BPMN.GEN account password was changed successfully.\n\n"
            "If you did not make this change, reset your password from the BPMN.GEN sign-in page."
        )
    _send_auth_email("Password changed", email, subject, body)


def send_organization_invite(email: str, link: str, org_name: str, inviter: str, language: str) -> None:
    if language == "sk":
        subject = "Pozvánka do organizácie v BPMN.GEN"
        body = (
            f"{inviter} ťa pozýva do organizácie {org_name} v BPMN.GEN.\n\n"
            f"Pozvánku prijmeš cez tento odkaz:\n{link}\n\n"
            "Prihlás sa účtom s touto overenou e-mailovou adresou. Ak účet ešte nemáš, vytvor si ho na rovnakej adrese."
        )
    else:
        subject = "You're invited to an organization in BPMN.GEN"
        body = (
            f"{inviter} invited you to join {org_name} in BPMN.GEN.\n\n"
            f"Open this link to accept the invitation:\n{link}\n\n"
            "Sign in with this verified email address. If you don't have an account yet, create one with the same address."
        )
    _send_auth_email("Organization invitation", email, subject, body)


ORG_ACCESS_MESSAGES = {
    "sk": {
        "added": ("Pridali ťa do organizácie v BPMN.GEN", "Získal si prístup do organizácie {org_name} v BPMN.GEN."),
        "promoted": ("Pridelili ti rolu vlastníka v BPMN.GEN", "V organizácii {org_name} v BPMN.GEN ti pridelili rolu vlastníka."),
        "removed": ("Tvoj prístup do organizácie v BPMN.GEN bol odobratý", "Prístup do organizácie {org_name} v BPMN.GEN ti bol odobratý."),
    },
    "en": {
        "added": ("You were added to a BPMN.GEN organization", "You were granted access to {org_name} in BPMN.GEN."),
        "promoted": ("You were made an owner of a BPMN.GEN organization", "You were assigned the owner role in {org_name} in BPMN.GEN."),
        "removed": ("Your access to a BPMN.GEN organization was removed", "Your access to {org_name} in BPMN.GEN was removed."),
    },
}


def send_org_access_notice(email: str, org_name: str, notice_type: str, language: str) -> None:
    template = ORG_ACCESS_MESSAGES["sk" if language == "sk" else "en"].get(notice_type)
    if not template:
        raise ValueError("Unknown organization access notice.")
    subject, body = template
    _send_auth_email("Organization access", email, subject, body.format(org_name=org_name))
