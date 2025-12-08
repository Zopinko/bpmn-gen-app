from __future__ import annotations

import copy
import time
from typing import Any, Dict, List, Optional, Tuple

from core.settings import get_settings
from services.controller.validate import validate as controller_validate
from services.creative_providers import (
    StubCreativeProvider,
    get_provider,
)
from services.frajer_kb_engine import FrajerKB
from services.ai_creative import _normalize_engine


class FrajerAIServiceError(Exception):
    def __init__(
        self, status_code: int, message: str, warnings: Optional[List[str]] = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.warnings = warnings or []


def _stub_builder(
    text: str, max_nodes: int
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    engine = {
        "lanes": [{"id": "System", "name": "System"}],
        "nodes": [],
        "flows": [],
    }
    issues = [
        {
            "code": "no_provider",
            "message": "AI provider is not configured.",
            "severity": "error",
        }
    ]
    return engine, issues


AI_INSTRUCTION_PREFIX = (
    "You are Frajer AI, an assistant that converts natural language into a BPMN engine_json draft.\n"
    "- Output MUST be a JSON object with lanes, nodes, flows (engine_json schema).\n"
    "- Include exactly one start_event and one end_event.\n"
    "- Use gateways (exclusive, parallel, inclusive) when the text describes branching, decisions (if/else), "
    "parallel work, or joins.\n"
    "- Use timer or message events only if the text clearly references waiting, deadlines, notifications, or external communication.\n"
    "- Limit names to 28 characters; keep node ids unique.\n"
    '- Each node must reference a lane. Map actors/roles to lanes by name. Unknown actors go to lane "System".\n'
    "- Keep total nodes ≤ 20 and maintain clear sequence flows."
)


class FrajerAIService:
    MAX_NODES = 20
    MAX_NAME_LEN = 28
    SYSTEM_LANE = "System"

    def __init__(self) -> None:
        settings = get_settings().ai_creative
        self.settings = settings
        self.provider = get_provider(settings, _stub_builder)

    def _ensure_provider(self) -> None:
        if isinstance(self.provider, StubCreativeProvider):
            raise FrajerAIServiceError(
                status_code=503, message="AI provider not configured."
            )

    def _trim(self, value: Optional[str]) -> str:
        text = (value or "").strip()
        if not text:
            return text
        return text[: self.MAX_NAME_LEN]

    def _map_lane(
        self, raw_name: Optional[str], mapper: Dict[str, str], warnings: List[str]
    ) -> str:
        if not raw_name:
            return self.SYSTEM_LANE
        key = raw_name.strip().lower()
        if not key:
            return self.SYSTEM_LANE
        canonical = mapper.get(key)
        if canonical:
            return canonical
        warnings.append(f"Lane '{raw_name}' mapped to '{self.SYSTEM_LANE}'.")
        return self.SYSTEM_LANE

    def _lane_mapper(self, locale: str) -> Dict[str, str]:
        kb = FrajerKB(locale=locale)
        mapper: Dict[str, str] = {}
        for canonical, aliases in kb.role_aliases.items():
            canonical_trimmed = self._trim(canonical) or self.SYSTEM_LANE
            mapper[canonical.lower()] = canonical_trimmed
            for alias in aliases:
                mapper[alias.lower()] = canonical_trimmed
        mapper[self.SYSTEM_LANE.lower()] = self.SYSTEM_LANE
        return mapper

    def _prepare_engine(
        self, engine: Dict[str, Any], locale: str
    ) -> Tuple[Dict[str, Any], List[str]]:
        prepared = copy.deepcopy(engine or {})
        mapper = self._lane_mapper(locale)
        warnings: List[str] = []

        lanes_lookup: Dict[str, Dict[str, str]] = {}

        # Normalize lanes first
        for lane in prepared.get("lanes", []) or []:
            raw_name = lane.get("name") or lane.get("id")
            mapped = self._map_lane(raw_name, mapper, warnings)
            trimmed = self._trim(mapped) or self.SYSTEM_LANE
            lane["id"] = trimmed
            lane["name"] = trimmed
            lanes_lookup.setdefault(trimmed, {"id": trimmed, "name": trimmed})

        lanes_lookup.setdefault(
            self.SYSTEM_LANE, {"id": self.SYSTEM_LANE, "name": self.SYSTEM_LANE}
        )

        # Normalize nodes
        for node in prepared.get("nodes", []) or []:
            node_name = self._trim(node.get("name"))
            if node_name:
                node["name"] = node_name
            if "label" in node and isinstance(node["label"], str):
                node["label"] = self._trim(node["label"])
            mapped_lane = self._map_lane(node.get("laneId"), mapper, warnings)
            mapped_lane = self._trim(mapped_lane) or self.SYSTEM_LANE
            node["laneId"] = mapped_lane
            lanes_lookup.setdefault(
                mapped_lane, {"id": mapped_lane, "name": mapped_lane}
            )

        # Normalize flows
        for flow in prepared.get("flows", []) or []:
            if "name" in flow and isinstance(flow["name"], str):
                flow["name"] = self._trim(flow["name"])

        prepared["lanes"] = list(lanes_lookup.values())

        return prepared, warnings

    def generate(
        self, *, text: str, language: str = "sk"
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        cleaned_text = (text or "").strip()
        if not cleaned_text:
            raise FrajerAIServiceError(
                status_code=400, message="Text must not be empty."
            )

        locale = (language or "sk").strip().lower() or "sk"
        self._ensure_provider()

        started = time.perf_counter()
        prompt = f"{AI_INSTRUCTION_PREFIX}\n\nProcess description:\n{cleaned_text}"
        provider_result = self.provider.generate(
            prompt, locale, self.MAX_NODES, "engine_json"
        )
        duration_ms = int((time.perf_counter() - started) * 1000)

        meta = dict(provider_result.get("meta") or {})
        engine = provider_result.get("engine_json")

        if meta.get("provider") == "stub":
            raise FrajerAIServiceError(
                status_code=503,
                message="Frajer AI provider is not configured. Set OPENAI_API_KEY or enable an AI provider.",
            )

        provider_error = meta.get("error")
        fallback_meta = meta.get("fallback")
        fallback_warnings: List[str] = []
        provider_issues = provider_result.get("issues") or []
        provider_issue_messages = [
            issue.get("message")
            for issue in provider_issues
            if isinstance(issue, dict)
            and issue.get("code") == "PROVIDER_ERROR"
            and issue.get("message")
        ]

        if provider_error and not engine:
            warnings: List[str] = []
            if isinstance(fallback_meta, dict):
                fallback_provider = fallback_meta.get("provider") or fallback_meta.get(
                    "mode"
                )
                if fallback_provider:
                    warnings.append(f"Fallback provider {fallback_provider} was used.")
            raise FrajerAIServiceError(
                status_code=502,
                message=f"{meta.get('provider', 'AI provider')} error: {provider_error}",
                warnings=warnings,
            )

        if provider_error and engine:
            provider_name = meta.get("provider", "AI provider")
            fallback_warnings.append(
                f"{provider_name} fallback activated: {provider_error}"
            )
            if isinstance(fallback_meta, dict):
                fallback_provider = fallback_meta.get("provider") or fallback_meta.get(
                    "mode"
                )
                if fallback_provider:
                    fallback_warnings.append(
                        f"Fallback provider {fallback_provider} was used."
                    )
            detail_message = (
                provider_issue_messages[0]
                if provider_issue_messages
                else provider_error
            )
            raise FrajerAIServiceError(
                status_code=502,
                message=f"{provider_name} error: {detail_message}",
                warnings=fallback_warnings or None,
            )

        if not engine:
            raise FrajerAIServiceError(
                status_code=502, message="AI provider returned no engine_json."
            )

        normalized, normalize_issues = _normalize_engine(engine, self.MAX_NODES)
        normalized, lane_warnings = self._prepare_engine(normalized, locale)

        node_count = len(normalized.get("nodes") or [])
        if node_count > self.MAX_NODES:
            raise FrajerAIServiceError(
                status_code=422,
                message=f"AI result exceeds node limit ({node_count} > {self.MAX_NODES}).",
            )

        controller_issues = controller_validate(normalized)
        hard_errors = [
            issue for issue in controller_issues if issue.severity == "error"
        ]
        warning_messages = [
            issue["message"]
            for issue in normalize_issues
            if issue.get("severity") != "error"
        ]
        warning_messages.extend(fallback_warnings)
        warning_messages.extend(lane_warnings)
        warning_messages.extend(
            issue.message for issue in controller_issues if issue.severity == "warning"
        )

        if hard_errors:
            message = "; ".join({issue.message for issue in hard_errors})
            raise FrajerAIServiceError(
                status_code=422, message=message, warnings=warning_messages
            )

        out_meta: Dict[str, Any] = {
            "provider": meta.get("provider", "unknown"),
            "model": meta.get("model"),
            "duration_ms": meta.get("duration_ms") or duration_ms,
            "source": "frajer-ai",
            "node_count": node_count,
        }
        if provider_error:
            out_meta["fallback"] = fallback_meta
            out_meta["provider_error"] = provider_error
        if meta.get("confidence") is not None:
            out_meta["confidence"] = meta.get("confidence")
        if warning_messages:
            out_meta["warnings"] = warning_messages

        return normalized, out_meta

    def status(self) -> Dict[str, Any]:
        health_callable = getattr(self.provider, "health", None)
        if callable(health_callable):
            try:
                health = health_callable()
            except Exception as exc:  # pragma: no cover
                return {
                    "ok": False,
                    "provider": getattr(self.provider, "model", "unknown"),
                    "model": getattr(self.provider, "model", None),
                    "api_key_present": False,
                    "duration_ms": 0,
                    "error": str(exc),
                    "details": {},
                }
            if isinstance(health, dict):
                health.setdefault(
                    "provider", getattr(self.provider, "model", "unknown")
                )
                health.setdefault("model", getattr(self.provider, "model", None))
                health.setdefault("details", {})
                return health
        return {
            "ok": False,
            "provider": getattr(self.provider, "model", "unknown"),
            "model": getattr(self.provider, "model", None),
            "api_key_present": False,
            "duration_ms": 0,
            "error": "health_not_supported",
            "details": {},
        }
