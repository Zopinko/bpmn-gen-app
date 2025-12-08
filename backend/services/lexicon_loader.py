# services/lexicon_loader.py
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import unicodedata
from typing import Any, Dict

import yaml

# Fallback locations for config/lexicon directories relative to the repo or cwd.
LEXICON_DIR_CANDIDATES = [
    Path(__file__).resolve().parents[1] / "config" / "lexicon",
    Path.cwd() / "config" / "lexicon",
]


def _strip_diacritics(value: str) -> str:
    """Return the value without diacritics so ASCII variants can match."""
    normalized = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def _normalize_phrases(values: list[Any]) -> list[str]:
    """Lowercase phrases and add ASCII duplicates when they differ."""
    seen: set[str] = set()
    result: list[str] = []
    for item in values:
        phrase = str(item).strip().lower()
        for variant in {phrase, _strip_diacritics(phrase)}:
            if variant and variant not in seen:
                seen.add(variant)
                result.append(variant)
    return result


def _find_lexicon_path(lang: str) -> Path:
    fname = f"{lang}.yml"
    for base in LEXICON_DIR_CANDIDATES:
        candidate = base / fname
        if candidate.exists():
            return candidate
    searched = ", ".join(
        str((base / fname).resolve()) for base in LEXICON_DIR_CANDIDATES
    )
    raise FileNotFoundError(
        f"Could not find lexicon for language '{lang}'. Searched: {searched}"
    )


@lru_cache(maxsize=8)
def get_lexicon(lang: str = "sk") -> Dict[str, Any]:
    """Load and normalize the YAML lexicon for the given language."""
    path = _find_lexicon_path(lang)
    with path.open("r", encoding="utf-8") as handle:
        data: Dict[str, Any] = yaml.safe_load(handle) or {}

    for key, val in list(data.items()):
        if isinstance(val, list):
            data[key] = _normalize_phrases(val)
        elif isinstance(val, dict):
            data[key] = {
                nested_key: (
                    _normalize_phrases(nested_val)
                    if isinstance(nested_val, list)
                    else nested_val
                )
                for nested_key, nested_val in val.items()
            }
    return data


__all__ = ["get_lexicon"]
