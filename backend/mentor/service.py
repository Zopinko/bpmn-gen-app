from __future__ import annotations


import copy
import os

import re

import time

import uuid

from typing import Any, Dict, List, Optional, Tuple


from core.settings import get_settings

from pydantic import ValidationError

from .provider_openai import MentorProviderError, review_llm

from .applier import _apply_json_patch, _load_state as _load_kb_state

from .models import (
    JsonPatchOp,
    MentorReviewRequest,
    Proposal,
    ProposalAction,
    ProposalAnnotation,
    ProposalMatch,
    ProposalMatchPattern,
    Telemetry,
)


_LABEL_RULE_PATTERN = re.compile(r"(?is)\bak\b.*?\binak\b")

_ROLE_ALIAS_MAP: Dict[str, List[str]] = {
    "Manaér": ["manazer", "manaér", "manager", "vedúci", "veduci"],
    "HR": ["oddelenie hr", "people ops", "human resources"],
}

_SOURCE_ID = "mentor_v1.0"

_DEFAULT_LOCALE = "sk"


def _new_proposal_id() -> str:

    return f"proposal_{uuid.uuid4().hex}"


def _resolve_locale(telemetry: Optional[Telemetry]) -> str:

    if telemetry and telemetry.tags.get("locale"):

        return telemetry.tags["locale"]

    return _DEFAULT_LOCALE


def _load_kb_snapshot() -> Dict[str, Any]:

    try:

        state = _load_kb_state()

    except Exception as exc:

        raise MentorProviderError(f"Failed to load KB snapshot: {exc}")

    return state


class MentorService:
    """Generates mentor proposals based on configured provider."""

    def __init__(self) -> None:

        settings = get_settings().mentor_ai

        desired_provider = (settings.provider or "stub").lower()

        desired_model = settings.model or "stub-heuristic"

        provider = desired_provider

        model = desired_model

        fallback_reason = None

        if provider == "openai":

            if not model or model.lower() == "stub-heuristic":

                model = "gpt-4o-mini"

            if not os.getenv("OPENAI_API_KEY"):

                fallback_reason = "missing_api_key"

                provider = "stub"

        self.provider = provider

        self.model = model

        self.timeout_s = settings.timeout_s

        self._desired_provider = desired_provider

        self._desired_model = desired_model

        self._fallback_reason = fallback_reason

    def review(
        self, payload: MentorReviewRequest
    ) -> Tuple[List[Proposal], Dict[str, object]]:

        started = time.perf_counter()

        text = (payload.text or "").strip()

        telemetry = payload.telemetry

        locale = _resolve_locale(telemetry)

        engine_json = payload.engine_json

        telemetry_dump = telemetry.model_dump() if telemetry else None

        meta: Dict[str, object] = {
            "provider": self.provider,
            "model": self.model,
            "mode": "llm" if self.provider == "openai" else "heuristic",
        }

        if self._fallback_reason:

            meta["fallback"] = True

            meta["fallback_reason"] = self._fallback_reason

            meta["desired_provider"] = self._desired_provider

            meta["desired_model"] = self._desired_model

        proposals: List[Proposal] = []

        error: Optional[str] = None

        if text and self.provider == "openai":

            try:

                kb_snapshot = _load_kb_snapshot()

                llm_output = review_llm(
                    text=text,
                    engine_json=engine_json,
                    telemetry=telemetry_dump,
                    kb_snapshot=kb_snapshot,
                    locale=locale,
                    model=self.model,
                    timeout_s=self.timeout_s,
                )

                parsed: List[Proposal] = []

                for item in llm_output:

                    if isinstance(item, Proposal):

                        parsed.append(item)

                        continue

                    if isinstance(item, dict):

                        normalized = dict(item)

                    elif isinstance(item, str):

                        normalized = {
                            "id": _new_proposal_id(),
                            "type": "naming_rule",
                            "summary": item,
                            "match": {"patterns": [], "context": []},
                            "targets": [],
                            "action": {"op": "comment", "params": {"message": item}},
                            "confidence": 0.5,
                            "risk": "low",
                            "evidence": [item],
                            "rollback_hint": None,
                            "source": _SOURCE_ID,
                        }

                    else:

                        raise MentorProviderError(
                            f"invalid_proposal_payload: unexpected item type {type(item)!r}"
                        )

                    normalized.setdefault("id", _new_proposal_id())

                    normalized.setdefault("type", "naming_rule")

                    normalized.setdefault("summary", str(normalized.get("type")))

                    match = normalized.get("match")

                    if not isinstance(match, dict):

                        match = {"patterns": [], "context": []}

                    patterns_raw = match.get("patterns", [])
                    if isinstance(patterns_raw, dict):
                        patterns_raw = [patterns_raw]
                    elif not isinstance(patterns_raw, list):
                        patterns_raw = []

                    normalized_patterns = []
                    for pattern in patterns_raw:
                        if isinstance(pattern, str):
                            normalized_patterns.append(
                                {"value": pattern, "mode": "contains"}
                            )
                        elif isinstance(pattern, dict):
                            pattern = dict(pattern)
                            if "value" in pattern:
                                pattern.setdefault("mode", "contains")
                                normalized_patterns.append(pattern)
                    match["patterns"] = normalized_patterns

                    context_raw = match.get("context", [])
                    if isinstance(context_raw, str):
                        context_raw = [context_raw]
                    elif not isinstance(context_raw, list):
                        context_raw = []
                    match["context"] = context_raw

                    normalized["match"] = match

                    normalized.setdefault("targets", [])

                    normalized.setdefault("confidence", 0.5)

                    risk = normalized.get("risk")

                    if isinstance(risk, str):

                        risk_lower = risk.strip().lower()

                        if "high" in risk_lower:

                            normalized["risk"] = "high"

                        elif "medium" in risk_lower or "mid" in risk_lower:

                            normalized["risk"] = "medium"

                        elif "low" in risk_lower:

                            normalized["risk"] = "low"

                        else:

                            normalized["risk"] = "low"

                    else:

                        normalized["risk"] = "low"

                    evidence = normalized.get("evidence")

                    if isinstance(evidence, str):

                        normalized["evidence"] = [evidence]

                    elif not isinstance(evidence, list):

                        normalized["evidence"] = []

                    normalized.setdefault("rollback_hint", None)

                    normalized.setdefault("source", _SOURCE_ID)

                    action = normalized.get("action")

                    if isinstance(action, str):

                        normalized["action"] = {"op": action}

                    elif not isinstance(action, dict):

                        normalized["action"] = {
                            "op": "comment",
                            "params": {"message": normalized["summary"]},
                        }

                    try:

                        parsed.append(Proposal.model_validate(normalized))

                    except ValidationError as exc:

                        raise MentorProviderError(
                            f"invalid_proposal_payload: {exc}"
                        ) from exc

                proposals = parsed

                meta["mode"] = "llm"

            except MentorProviderError as exc:

                error = str(exc)

            except Exception as exc:

                error = str(exc)

            if error:

                meta["fallback"] = True

                meta["error"] = error

                meta["mode"] = "heuristic"

                proposals = self._heuristic_proposals(text, locale, engine_json)

        else:

            proposals = self._heuristic_proposals(text, locale, engine_json)

        allowed_types = {
            "label_rule",
            "alias",
            "join_hint",
            "naming_rule",
            "engine_patch",
        }

        filtered = [
            p for p in proposals if p.type in allowed_types and p.confidence >= 0.5
        ]

        meta["duration_ms"] = int((time.perf_counter() - started) * 1000)

        meta["proposal_count"] = len(filtered)

        return filtered, meta

    def _heuristic_proposals(
        self, text: str, locale: str, engine_json: Optional[Dict[str, Any]]
    ) -> List[Proposal]:

        raw: List[Proposal] = []

        raw.extend(self._label_rule_proposals(text, locale, engine_json))

        raw.extend(self._alias_proposals(text, locale))

        raw.extend(self._engine_gateway_label_proposals(engine_json, locale))

        return raw

    def _label_rule_proposals(
        self,
        text: str,
        locale: str,
        engine_json: Optional[Dict[str, Any]] = None,
    ) -> List[Proposal]:

        if not text:

            return []

        match = _LABEL_RULE_PATTERN.search(text)

        if not match:

            return []

        snippet = " ".join(match.group(0).split())

        patterns = [
            ProposalMatchPattern(value="ak", mode="contains"),
            ProposalMatchPattern(value="inak", mode="contains"),
        ]

        match_meta = ProposalMatch(locale=locale, patterns=patterns, context=[snippet])

        action = ProposalAction(
            op="set_branch_labels",
            params={"labels": ["Áno", "Nie"], "target": "exclusive_gateway"},
        )

        proposal = Proposal(
            id=_new_proposal_id(),
            type="label_rule",
            summary="Navrhni pomenovanie vetiev Áno/Nie pre podmienku 'ak ... inak ...'.",
            match=match_meta,
            targets=["exclusive_gateway"],
            action=action,
            confidence=0.95,
            risk="low",
            evidence=[snippet],
            rollback_hint="Obnov pôvodné menovky gateway, aby si revertoval zmenu.",
            source=_SOURCE_ID,
        )

        if engine_json:

            annotation = self._build_text_annotation_for_gateway(
                engine_json,
                title="Chýba označenie vetiev",
                description="Navrhni doplnenie menoviek Áno/Nie na vetvy podmienky.",
            )

            if annotation:

                proposal.annotations = [annotation]

        return [proposal]

    def _alias_proposals(self, text: str, locale: str) -> List[Proposal]:
        if not text:
            return []
        text_cf = text.casefold()
        proposals: List[Proposal] = []

        for canonical, aliases in _ROLE_ALIAS_MAP.items():

            matched = [alias for alias in aliases if alias.casefold() in text_cf]

            if not matched:

                continue

            patterns = [
                ProposalMatchPattern(value=alias, mode="contains") for alias in matched
            ]

            match_meta = ProposalMatch(
                locale=locale, patterns=patterns, context=matched
            )

            action = ProposalAction(
                op="add_alias",
                params={"role": canonical, "aliases": aliases, "locale": locale},
            )

            evidence = [f"Detegovaný výraz: '{alias}'" for alias in matched]

            proposal = Proposal(
                id=_new_proposal_id(),
                type="alias",
                summary=f"Doplni aliasy pre rolu {canonical}.",
                match=match_meta,
                targets=[canonical],
                action=action,
                confidence=0.95,
                risk="low",
                evidence=evidence,
                rollback_hint="Odstráò aliasy z KB, aby si revertoval zmenu.",
                source=_SOURCE_ID,
            )

            proposals.append(proposal)

        return proposals

    def _build_text_annotation_for_gateway(
        self,
        engine_json: Dict[str, Any],
        title: str,
        description: str,
    ) -> Optional[ProposalAnnotation]:
        nodes = engine_json.get("nodes") or []
        for node in nodes:
            if (node.get("type") or "").lower() != "exclusive_gateway":
                continue
            gateway_id = node.get("id")
            if not gateway_id:
                continue
            return ProposalAnnotation(
                nodeId=gateway_id,
                title=title,
                description=description,
                severity="warning",
                tags=["mentor"],
            )
        return None

    def _engine_gateway_label_proposals(
        self, engine_json: Optional[Dict[str, Any]], locale: str
    ) -> List[Proposal]:
        if not engine_json:
            return []
        nodes = engine_json.get("nodes") or []
        flows = engine_json.get("flows") or []
        proposals: List[Proposal] = []
        labels = ["Áno", "Nie"]

        for node in nodes:
            if (node.get("type") or "").lower() != "exclusive_gateway":
                continue
            gateway_id = node.get("id")
            if not gateway_id:
                continue
            outgoing = [
                (idx, flow)
                for idx, flow in enumerate(flows)
                if flow.get("source") == gateway_id
            ]
            if len(outgoing) < 2:
                continue

            patch_ops: List[JsonPatchOp] = []
            annotations: List[ProposalAnnotation] = [
                ProposalAnnotation(
                    nodeId=gateway_id,
                    title="Rozhodnutie potrebuje menovky",
                    description="Doplň menovky Áno/Nie na vetvy rozhodnutia.",
                    severity="warning",
                    tags=[gateway_id],
                )
            ]
            updated = False
            for offset, (flow_idx, flow) in enumerate(outgoing[:2]):
                desired = labels[offset] if offset < len(labels) else labels[-1]
                current_label = (flow.get("label") or flow.get("name") or "").strip()
                if current_label == desired:
                    continue
                op_label = "replace" if "label" in flow else "add"
                op_name = "replace" if "name" in flow else "add"
                patch_ops.append(
                    JsonPatchOp(
                        op=op_label, path=f"/flows/{flow_idx}/label", value=desired
                    )
                )
                patch_ops.append(
                    JsonPatchOp(
                        op=op_name, path=f"/flows/{flow_idx}/name", value=desired
                    )
                )
                annotations.append(
                    ProposalAnnotation(
                        nodeId=flow.get("id") or f"flow_{flow_idx}",
                        title=f"Označ vetvu {desired}",
                        description=f"Nastav menovku na '{desired}'.",
                        severity="warning",
                        tags=[gateway_id],
                    )
                )
                updated = True

            if not updated:
                continue

            proposal = Proposal(
                id=_new_proposal_id(),
                type="engine_patch",
                summary="Doplniť menovky Áno/Nie na rozhodnutí.",
                match=ProposalMatch(locale=locale, patterns=[], context=[]),
                targets=[gateway_id],
                action=ProposalAction(
                    op="engine_patch", params={"gateway": gateway_id, "labels": labels}
                ),
                engine_patch=patch_ops,
                confidence=0.8,
                risk="low",
                evidence=[f"gateway {gateway_id} bez menoviek"],
                rollback_hint="Obnov pôvodné hodnoty menoviek.",
                source=_SOURCE_ID,
                annotations=annotations,
            )
            proposals.append(proposal)

        return proposals

    def apply_engine_patches(
        self,
        engine_json: Dict[str, Any],
        proposals: List[Proposal],
        selected_ids: List[str],
    ) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
        if engine_json is None:
            raise MentorProviderError("engine_json is required")

        current = copy.deepcopy(engine_json)
        audit_log: List[Dict[str, str]] = []

        if not proposals or not selected_ids:
            return current, audit_log

        selected = set(selected_ids)

        for proposal in proposals:
            if proposal.id not in selected:
                continue
            if not proposal.engine_patch:
                continue

            patch_ops: List[Dict[str, Any]] = []
            for op in proposal.engine_patch:
                if hasattr(op, "model_dump"):
                    patch_ops.append(op.model_dump(by_alias=True))
                elif isinstance(op, dict):
                    patch_ops.append(dict(op))

            if not patch_ops:
                continue

            try:
                current = _apply_json_patch(current, patch_ops)
            except ValueError as exc:
                raise MentorProviderError(
                    f"Failed to apply engine patch for proposal {proposal.id}: {exc}"
                )

            audit_log.append(
                {"id": proposal.id, "type": proposal.type, "risk": proposal.risk}
            )

        return current, audit_log
