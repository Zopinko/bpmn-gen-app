from __future__ import annotations

from dataclasses import dataclass
import os


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _get_str(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None:
        return default
    value = value.strip()
    return value or default


def _get_lower_str(name: str, default: str) -> str:
    return _get_str(name, default).lower()


@dataclass(frozen=True)
class MentorAISettings:
    provider: str = _get_lower_str("MENTOR_AI_PROVIDER", "stub")
    model: str = _get_str("MENTOR_AI_MODEL", "stub-heuristic")
    timeout_s: int = _get_int("MENTOR_AI_TIMEOUT_S", 20)


@dataclass(frozen=True)
class AICreativeSettings:
    provider: str = _get_lower_str("AI_CREATIVE_PROVIDER", "auto")
    model: str = _get_str("AI_CREATIVE_MODEL", "gpt-5")
    output: str = _get_lower_str("AI_CREATIVE_OUTPUT", "auto")
    timeout_s: int = _get_int("AI_CREATIVE_TIMEOUT_S", 25)
    max_tokens: int = _get_int("AI_CREATIVE_MAX_TOKENS", 2000)
    max_nodes: int = _get_int("AI_CREATIVE_MAX_NODES", 50)


@dataclass(frozen=True)
class AppSettings:
    mentor_ai: MentorAISettings = MentorAISettings()
    ai_creative: AICreativeSettings = AICreativeSettings()


_SETTINGS = AppSettings()


def get_settings() -> AppSettings:
    return _SETTINGS
