from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
import re

from core.config import get_openai_client

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


class MentorProviderError(RuntimeError):
    pass


def _build_messages(
    text: str,
    engine_json: Optional[Dict[str, Any]],
    kb_snapshot: Optional[Dict[str, Any]],
    locale: str,
) -> List[Dict[str, Any]]:
    engine_part = json.dumps(
        engine_json or {}, separators=(",", ":"), ensure_ascii=False
    )
    kb_part = json.dumps(kb_snapshot or {}, ensure_ascii=False)
    user_text = (
        f"Locale: {locale}\n"
        f"Text:\n{text}\n\n"
        f"Engine JSON:\n{engine_part}\n\n"
        f"KB Snapshot:\n{kb_part}"
    )
    return [
        {
            "role": "system",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        "You are a BPMN Mentor. Compare the input text and current engine_json. "
                        'Respond with a single JSON object of the form {"proposals": [...]} with no Markdown fences or additional text. '
                        "Each proposal must include: id, type, summary, match, targets, action, confidence, risk, evidence, rollback_hint, source. "
                        "Use type in {label_rule, alias, join_hint, naming_rule, remove_rule}. "
                        "Populate match.patterns/context when referring to text fragments.\n"
                        f"User interface locale: {locale}. You must respond in Slovak when locale starts with 'sk'."
                    ),
                }
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": user_text,
                }
            ],
        },
    ]


def _extract_json_payload(raw: str) -> str:
    cleaned = raw.strip()
    match = _JSON_BLOCK_RE.search(cleaned)
    if match:
        cleaned = match.group(1).strip()
    start_idx = None
    for ch in ("{", "["):
        idx = cleaned.find(ch)
        if idx != -1:
            start_idx = idx if start_idx is None else min(start_idx, idx)
    if start_idx is not None and start_idx > 0:
        cleaned = cleaned[start_idx:]
    end_idx = None
    for ch in ("}", "]"):
        idx = cleaned.rfind(ch)
        if idx != -1:
            end_idx = idx if end_idx is None else max(end_idx, idx)
    if end_idx is not None:
        cleaned = cleaned[: end_idx + 1]
    return cleaned.strip()


def _extract_response_text(response: Any) -> str:
    if hasattr(response, "output_text"):
        return response.output_text
    if hasattr(response, "output"):
        chunks: List[str] = []
        for item in response.output or []:
            for block in getattr(item, "content", []) or []:
                value = getattr(block, "text", None)
                if value:
                    chunks.append(value)
        if chunks:
            return "".join(chunks)
    if hasattr(response, "choices"):
        parts: List[str] = []
        for choice in getattr(response, "choices", []) or []:
            message = getattr(choice, "message", None)
            if message and hasattr(message, "content"):
                parts.append(message.content)
        if parts:
            return "".join(parts)
    raise MentorProviderError("Unable to extract response text")


def review_llm(
    text: str,
    engine_json: Optional[Dict[str, Any]],
    telemetry: Optional[Dict[str, Any]],  # unused but kept for signature compatibility
    kb_snapshot: Optional[Dict[str, Any]],
    locale: str,
    model: str = "gpt-5-thinking",
    timeout_s: int = 25,
    max_output_tokens: int = 1024,
) -> List[Dict[str, Any]]:
    client = get_openai_client()
    try:
        client = client.with_options(timeout=timeout_s)
    except AttributeError:
        client.timeout = timeout_s

    messages = _build_messages(text, engine_json, kb_snapshot, locale)
    payload = {
        "model": model,
        "input": messages,
        "max_output_tokens": max_output_tokens,
    }

    try:
        response = client.responses.create(**payload)
    except Exception as exc:  # pragma: no cover
        raise MentorProviderError(str(exc))

    raw_text = _extract_response_text(response).strip()
    if not raw_text:
        raise MentorProviderError("Mentor model returned empty response")

    cleaned = _extract_json_payload(raw_text)

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:  # pragma: no cover
        raise MentorProviderError(f"Invalid JSON from mentor model: {exc}")

    if isinstance(parsed, dict) and "proposals" in parsed:
        proposals = parsed.get("proposals")
    else:
        proposals = parsed

    if not isinstance(proposals, list):
        raise MentorProviderError("Mentor model did not return proposals list")

    return proposals
