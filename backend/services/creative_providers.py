from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List, Optional

from core.config import get_openai_client
from schemas.engine import validate_xml

CreativeProviderResult = Dict[str, Any]
CreativeIssue = Dict[str, Any]

XML_SYSTEM_PROMPT = (
    "You are a BPMN generator. From plain text description of a business process, produce a BPMN model. "
    "Output ONLY BPMN 2.0 XML. Always include StartEvent and EndEvent."
)

JSON_SYSTEM_PROMPT = "You are a BPMN generator. Return ONLY JSON compatible with the engine_json schema for BPMN generation."

JSON_SCHEMA_HINT = {
    "processId": "string",
    "name": "string",
    "lanes": [{"id": "string", "name": "string"}],
    "nodes": [
        {
            "id": "string",
            "type": "startEvent|task|exclusiveGateway|parallelGateway|inclusiveGateway|endEvent",
            "laneId": "string",
            "name": "string",
        }
    ],
    "flows": [
        {"id": "string", "source": "nodeId", "target": "nodeId", "name?": "string"}
    ],
}


class CreativeProviderError(Exception):
    pass


def _as_content(text: str) -> List[Dict[str, str]]:
    return [{"type": "input_text", "text": text}]


def _issue(code: str, message: str, severity: str = "error") -> CreativeIssue:
    return {"code": code, "message": message, "severity": severity}


class StubCreativeProvider:
    def __init__(self, stub_builder):
        self._build_engine = stub_builder

    def generate(
        self, text: str, language: str, max_nodes: int, output: str
    ) -> CreativeProviderResult:
        engine, issues = self._build_engine(text, max_nodes)
        meta = {
            "provider": "stub",
            "mode": "json",
        }
        return {"engine_json": engine, "bpmn_xml": None, "issues": issues, "meta": meta}

    def health(self) -> Dict[str, Any]:
        return {
            "ok": True,
            "provider": "stub",
            "model": None,
            "api_key_present": False,
            "duration_ms": 0,
            "details": {"message": "Stub provider active.", "mode": "json"},
        }


class OpenAICreativeProvider:
    def __init__(
        self,
        model: str,
        timeout_s: int,
        max_tokens: int,
        fallback_provider: StubCreativeProvider,
    ):
        self.model = model or "gpt-5"
        self.timeout_s = timeout_s or 25
        self.max_tokens = max_tokens or 2000
        self._fallback = fallback_provider

    def _client(self):
        client = get_openai_client()
        try:
            return client.with_options(timeout=self.timeout_s)
        except AttributeError:  # older SDK compatibility
            client.timeout = self.timeout_s
            return client

    def health(self) -> Dict[str, Any]:
        started = time.perf_counter()
        api_key_present = bool(os.getenv("OPENAI_API_KEY"))
        try:
            client = self._client()
            client.models.list()
        except Exception as exc:
            return {
                "ok": False,
                "provider": "openai",
                "model": self.model,
                "api_key_present": api_key_present,
                "duration_ms": int((time.perf_counter() - started) * 1000),
                "error": str(exc),
                "details": {"stage": "models.list"},
            }
        return {
            "ok": True,
            "provider": "openai",
            "model": self.model,
            "api_key_present": api_key_present,
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "details": {"stage": "models.list"},
        }

    def _extract_text(self, response) -> str:
        if hasattr(response, "output_text"):
            return response.output_text
        if hasattr(response, "output"):
            parts: List[str] = []
            for item in response.output or []:
                for block in getattr(item, "content", []) or []:
                    text = getattr(block, "text", None)
                    if text:
                        parts.append(text)
            if parts:
                return "".join(parts)
        if hasattr(response, "choices"):
            contents = []
            for choice in getattr(response, "choices", []) or []:
                message = getattr(choice, "message", None)
                if message and hasattr(message, "content"):
                    contents.append(message.content)
            if contents:
                return "".join(contents)
        raise CreativeProviderError("Unable to extract text from OpenAI response")

    def _call_openai(
        self, messages: List[Dict[str, Any]], max_output_tokens: Optional[int] = None
    ) -> str:
        client = self._client()
        payload: Dict[str, Any] = {
            "model": self.model,
            "input": messages,
        }
        tokens = max_output_tokens if max_output_tokens is not None else self.max_tokens
        if tokens:
            payload["max_output_tokens"] = tokens
        response = client.responses.create(**payload)
        return self._extract_text(response).strip()

    def _generate_xml(self, text: str) -> str:
        messages = [
            {"role": "system", "content": _as_content(XML_SYSTEM_PROMPT)},
            {"role": "user", "content": _as_content(text)},
        ]
        return self._call_openai(messages)

    def _generate_engine_json(self, text: str, max_nodes: int) -> Dict[str, Any]:
        schema_hint = json.dumps(JSON_SCHEMA_HINT, indent=2)
        user_prompt = (
            "Process description:\n"
            f"{text}\n\n"
            "Return a single JSON object matching the engine_json schema. "
            "Include processId, name, lanes, nodes, flows. "
            "Every node must have id, type, laneId, name. "
            "Every flow must have id, source, target. "
            f"Limit the total number of nodes to {max_nodes}. "
            "Always include exactly one StartEvent and one EndEvent. "
            "Respond with JSON only."
        )
        messages = [
            {"role": "system", "content": _as_content(JSON_SYSTEM_PROMPT)},
            {
                "role": "user",
                "content": _as_content(f"Schema hint:\n{schema_hint}\n\n{user_prompt}"),
            },
        ]
        raw = self._call_openai(messages)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.lower().startswith("json"):
                raw = raw[4:].lstrip()
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:  # pragma: no cover
            raise CreativeProviderError(f"Invalid JSON returned by provider: {exc}")
        if not isinstance(parsed, dict):
            raise CreativeProviderError("Provider returned non-object JSON payload")
        return parsed

    def _fallback_stub(
        self,
        text: str,
        language: str,
        max_nodes: int,
        output: str,
        issues: List[CreativeIssue],
        error: Exception,
        started: float,
    ) -> CreativeProviderResult:
        fallback_result = self._fallback.generate(text, language, max_nodes, output)
        combined_issues = list(issues)
        combined_issues.append(_issue("PROVIDER_ERROR", str(error)))
        combined_issues.extend(fallback_result.get("issues") or [])
        total_duration = int((time.perf_counter() - started) * 1000)
        fallback_meta = dict(fallback_result.get("meta", {}))
        meta = {
            "provider": "openai",
            "model": self.model,
            "mode": fallback_meta.get("mode", "stub"),
            "duration_ms": total_duration,
            "error": "provider_failed",
            "fallback": fallback_meta,
        }
        return {
            "engine_json": fallback_result.get("engine_json"),
            "bpmn_xml": fallback_result.get("bpmn_xml"),
            "issues": combined_issues,
            "meta": meta,
        }

    def generate(
        self, text: str, language: str, max_nodes: int, output: str
    ) -> CreativeProviderResult:
        started = time.perf_counter()
        issues: List[CreativeIssue] = []
        wants_xml = output in {"auto", "bpmn_xml"}
        xml_text: Optional[str] = None

        if wants_xml:
            try:
                xml_text = self._generate_xml(text)
            except Exception as exc:  # pragma: no cover
                return self._fallback_stub(
                    text, language, max_nodes, output, issues, exc, started
                )
            try:
                validate_xml(xml_text)
            except Exception as exc:
                issues.append(_issue("XML_INVALID", str(exc)))
                xml_text = None
            else:
                duration = int((time.perf_counter() - started) * 1000)
                meta = {
                    "provider": "openai",
                    "model": self.model,
                    "mode": "xml",
                    "duration_ms": duration,
                }
                return {
                    "engine_json": None,
                    "bpmn_xml": xml_text,
                    "issues": issues,
                    "meta": meta,
                }

        wants_json = output in {"auto", "engine_json"} or xml_text is None
        if wants_json:
            try:
                engine_json = self._generate_engine_json(text, max_nodes)
            except Exception as exc:  # pragma: no cover
                return self._fallback_stub(
                    text, language, max_nodes, output, issues, exc, started
                )
            duration = int((time.perf_counter() - started) * 1000)
            meta = {
                "provider": "openai",
                "model": self.model,
                "mode": "json",
                "duration_ms": duration,
            }
            return {
                "engine_json": engine_json,
                "bpmn_xml": None,
                "issues": issues,
                "meta": meta,
            }

        # If neither XML nor JSON was requested, fall back to stub
        return self._fallback_stub(
            text,
            language,
            max_nodes,
            output,
            issues,
            CreativeProviderError("unsupported_output"),
            started,
        )


def get_provider(settings, stub_builder):
    stub = StubCreativeProvider(stub_builder)
    provider = (settings.provider or "auto").lower()
    api_key_present = bool(os.getenv("OPENAI_API_KEY"))

    if provider in {"openai", "auto"} and (api_key_present or provider == "openai"):
        return OpenAICreativeProvider(
            settings.model, settings.timeout_s, settings.max_tokens, stub
        )

    return stub
