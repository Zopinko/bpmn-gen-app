from __future__ import annotations

import logging
import os


logger = logging.getLogger(__name__)


def send_password_reset_email(email: str, reset_link: str) -> None:
    provider = os.getenv("AUTH_EMAIL_PROVIDER", "console").strip().lower()
    if provider in {"", "console", "log", "stdout"}:
        logger.warning(
            "PASSWORD_RESET_EMAIL to=%s provider=console reset_link=%s",
            email,
            reset_link,
        )
        return

    # Foundation for future providers; keep dev-safe fallback for now.
    logger.warning(
        "Unknown AUTH_EMAIL_PROVIDER='%s'. Falling back to console logging. to=%s reset_link=%s",
        provider,
        email,
        reset_link,
    )
