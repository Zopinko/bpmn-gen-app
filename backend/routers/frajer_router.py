# routers/frajer_router.py
from __future__ import annotations

import re
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from schemas.frajer_schemas import FrajerRequest, FrajerResponse
from services.architect.normalize import (
    normalize_engine_payload,
    postprocess_engine_json,
)
from services.bpmn_svc import generate_bpmn_from_json
from services.frajer_kb_engine import FrajerKB
from services.frajer_services import draft_engine_json_from_text
from services.frajer_ai import FrajerAIService, FrajerAIServiceError

router = APIRouter(prefix="/frajer", tags=["Frajer"])
_frajer_ai_service = FrajerAIService()


class FrajerAIGenerateRequest(BaseModel):
    text: str
    language: Literal["sk", "en"] = "sk"


class FrajerAIGenerateResponse(BaseModel):
    engine_json: Dict[str, Any]
    meta: Dict[str, Any]


class FrajerAIStatusResponse(BaseModel):
    ok: bool
    provider: str
    model: Optional[str] = None
    api_key_present: bool = False
    duration_ms: Optional[int] = None
    error: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)


class PreviewEngineRequest(BaseModel):
    engine_json: Dict[str, Any]
    locale: str = "sk"


def _normalize_node_names(ej: dict) -> dict:
    """If nodes have 'label' but missing 'name', copy label -> name."""
    for n in ej.get("nodes", []):
        if not n.get("name") and n.get("label"):
            n["name"] = n["label"]
    return ej


# ---------------- message (JSON -> engine_json) ----------------
@router.post("/message", response_model=FrajerResponse)
def frajer_message(request: FrajerRequest) -> FrajerResponse:
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text must not be empty.")
    ej = draft_engine_json_from_text(text)
    ej = _normalize_node_names(ej)
    engine_json = postprocess_engine_json(ej, locale="sk")
    return FrajerResponse(engine_json=engine_json)


@router.post("/ai-generate", response_model=FrajerAIGenerateResponse)
def frajer_ai_generate(payload: FrajerAIGenerateRequest) -> FrajerAIGenerateResponse:
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text must not be empty.")
    language = (payload.language or "sk").strip().lower() or "sk"
    try:
        engine_json, meta = _frajer_ai_service.generate(text=text, language=language)
    except FrajerAIServiceError as exc:
        detail: Any
        if exc.warnings:
            detail = {"message": str(exc), "warnings": exc.warnings}
        else:
            detail = str(exc)
        raise HTTPException(status_code=exc.status_code, detail=detail)
    return FrajerAIGenerateResponse(engine_json=engine_json, meta=meta)


@router.get("/ai-status", response_model=FrajerAIStatusResponse)
def frajer_ai_status() -> FrajerAIStatusResponse:
    status = _frajer_ai_service.status()
    return FrajerAIStatusResponse(**status)


# ---------------- helpers ----------------
def _split_sentences(text: str) -> list[str]:
    """Rozsekne text na vety a zachová prepojenie "Inak/Else" s podmienkou."""
    if not text:
        return []
    normalized = re.sub(r"\s+", " ", text.strip())
    if not normalized:
        return []
    raw_parts = re.split(r"(?<=[.!?])\s+|\n+", normalized)
    merged: list[str] = []
    for part in raw_parts:
        segment = part.strip()
        if not segment:
            continue
        lower = segment.lower()
        if merged and re.match(r"^(inak|else|otherwise|potom)\b", lower):
            merged[-1] = merged[-1].rstrip(".") + ". " + segment
        else:
            merged.append(segment)
    return [segment.strip().rstrip(".") for segment in merged if segment.strip()]


def _build_engine_json_with_kb(
    text: str, locale: str = "sk", kb_variant: str = "main"
) -> tuple[dict, dict]:
    """Deterministicky skladá engine_json cez FrajerKB vrátane KB metadát."""
    engine = FrajerKB(locale=locale, kb_variant=kb_variant)
    sentences = _split_sentences(text)

    lanes: dict[str, dict[str, str]] = {}
    nodes: list[dict] = []
    flows: list[dict] = []

    default_lane_name = (engine.default_lane or "Main").strip() or "Main"

    def ensure_lane(raw_lane: Optional[str]) -> str:
        lane_name = (raw_lane or default_lane_name).strip() or default_lane_name
        if lane_name not in lanes:
            lanes[lane_name] = {"id": lane_name, "name": lane_name}
        return lane_name

    # Start
    start_lane = ensure_lane(default_lane_name)
    start_id = "start_event_main"
    nodes.append(
        {
            "id": start_id,
            "type": "start_event",
            "label": "Start",
            "laneId": start_lane,
        }
    )
    previous = start_id

    # Per-veta
    for sentence in sentences:
        hinted_lane = engine._lane_hint(sentence)
        ensure_lane(hinted_lane)
        new_nodes, new_flows, previous = engine.compile_sentence(sentence, previous)
        nodes.extend(new_nodes)
        flows.extend(new_flows)
        for generated_node in new_nodes:
            ensure_lane(generated_node.get("laneId"))

    # End
    end_id = "end_event_main"
    nodes.append(
        {"id": end_id, "type": "end_event", "label": "End", "laneId": start_lane}
    )
    flows.append({"id": "flow_to_end", "source": previous, "target": end_id})

    business_nodes = [
        n for n in nodes if n.get("type") not in {"start_event", "end_event"}
    ]
    if business_nodes:
        first_lane = ensure_lane(business_nodes[0].get("laneId"))
        last_lane = ensure_lane(business_nodes[-1].get("laneId"))
        nodes[0]["laneId"] = first_lane
        nodes[-1]["laneId"] = last_lane

    used_lane_ids = {n.get("laneId") for n in nodes if n.get("laneId")}
    lanes_list = [lane for lane in lanes.values() if lane["id"] in used_lane_ids]

    engine_json = {
        "lanes": [
            {
                "id": lane_meta["id"],
                "name": lane_meta["name"],
                "label": lane_meta["name"],
            }
            for lane_meta in lanes_list
        ],
        "nodes": nodes,
        "flows": flows,
    }

    kb_meta = {
        "variant_requested": engine.kb_variant_requested,
        "variant_resolved": engine.kb_variant_resolved,
        "meta": engine.kb_meta,
    }

    return engine_json, kb_meta


def _to_str(value) -> str:
    return value if isinstance(value, str) else ("" if value is None else str(value))


def _coerce_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"1", "true", "yes", "y"}
    return bool(value)


async def _resolve_preview_params(request: Request) -> tuple[str, bool, str, str]:
    if request.method == "POST":
        raw = await request.json()
    else:
        raw = request.query_params
    text = _to_str(raw.get("text")).strip()
    use_kb = _coerce_bool(raw.get("use_kb", False))
    locale = _to_str(raw.get("locale") or "sk").strip() or "sk"
    kb_variant = _to_str(raw.get("kb") or "main").strip() or "main"
    if not text:
        raise HTTPException(status_code=400, detail="Text must not be empty.")
    return text, use_kb, locale, kb_variant


def _build_preview_artifacts(
    *, text: str, use_kb: bool, locale: str, kb_variant: str
) -> dict:
    if use_kb:
        draft, kb_meta = _build_engine_json_with_kb(
            text, locale=locale, kb_variant=kb_variant
        )
    else:
        draft = draft_engine_json_from_text(text, locale=locale, kb_variant=kb_variant)
        kb_meta = {
            "variant_requested": kb_variant,
            "variant_resolved": "main",
            "meta": {},
        }
    draft = _normalize_node_names(draft)
    normalized = normalize_engine_payload(draft)
    processed = postprocess_engine_json(normalized, locale=locale)
    prepared = dict(processed)
    prepared.setdefault("processId", normalized.get("processId"))
    prepared.setdefault("name", normalized.get("name") or "Frajer Preview")
    prepared["locale"] = locale
    xml_payload = generate_bpmn_from_json(prepared)
    return {
        "draft": draft,
        "normalized": normalized,
        "after_tidy": processed,
        "prepared": prepared,
        "xml": xml_payload,
        "kb_meta": kb_meta,
        "locale": locale,
        "use_kb": use_kb,
    }


def _build_artifacts_from_engine(*, engine_json: Dict[str, Any], locale: str) -> dict:
    normalized = normalize_engine_payload(engine_json or {})
    processed = postprocess_engine_json(normalized, locale=locale)
    prepared = dict(processed)
    prepared.setdefault("processId", normalized.get("processId"))
    prepared.setdefault("name", normalized.get("name") or "Frajer AI Preview")
    prepared["locale"] = locale
    xml_payload = generate_bpmn_from_json(prepared)
    return {
        "draft": engine_json,
        "normalized": normalized,
        "after_tidy": processed,
        "prepared": prepared,
        "xml": xml_payload,
        "meta": {
            "locale": locale,
            "source": "frajer-ai",
        },
    }


# ---------------- preview-bpmn (GET aj POST) -------------------
@router.api_route("/preview-bpmn", methods=["GET", "POST"], response_class=Response)
async def frajer_preview_bpmn(request: Request) -> Response:
    """Render BPMN preview for Frajer with optional KB variant selection."""

    text, use_kb, locale, kb_variant = await _resolve_preview_params(request)
    artifacts = _build_preview_artifacts(
        text=text, use_kb=use_kb, locale=locale, kb_variant=kb_variant
    )
    kb_meta = artifacts["kb_meta"]

    headers = {
        "X-KB-Variant-Requested": kb_meta.get("variant_requested", "main"),
        "X-KB-Variant": kb_meta.get(
            "variant_resolved", kb_meta.get("variant_requested", "main")
        ),
        "X-KB-Fallback": (
            "1"
            if kb_meta.get("variant_resolved")
            and kb_meta.get("variant_requested")
            and kb_meta.get("variant_resolved") != kb_meta.get("variant_requested")
            else "0"
        ),
    }

    return Response(
        content=artifacts["xml"],
        media_type="application/xml; charset=utf-8",
        headers=headers,
    )


@router.api_route("/preview-json", methods=["GET", "POST"])
async def frajer_preview_json(request: Request) -> dict:
    text, use_kb, locale, kb_variant = await _resolve_preview_params(request)
    artifacts = _build_preview_artifacts(
        text=text, use_kb=use_kb, locale=locale, kb_variant=kb_variant
    )
    kb_meta = artifacts["kb_meta"]

    return {
        "draft": artifacts["draft"],
        "normalized": artifacts["normalized"],
        "after_tidy": artifacts["after_tidy"],
        "prepared": artifacts["prepared"],
        "meta": {
            "locale": locale,
            "use_kb": use_kb,
            "kb_variant_requested": kb_meta.get("variant_requested"),
            "kb_variant_resolved": kb_meta.get("variant_resolved"),
            "kb": kb_meta,
        },
    }


@router.post("/preview-engine")
def frajer_preview_engine(payload: PreviewEngineRequest) -> Dict[str, Any]:
    engine = payload.engine_json or {}
    if not isinstance(engine, dict) or not engine:
        raise HTTPException(status_code=400, detail="engine_json must not be empty.")
    locale = (payload.locale or "sk").strip() or "sk"
    artifacts = _build_artifacts_from_engine(engine_json=engine, locale=locale)
    return artifacts


@router.get("/debug-kb")
def frajer_debug_kb(locale: str = "sk"):
    eng = FrajerKB(locale=locale)
    kb = eng.kb
    return {
        "loaded": True,
        "patterns": len(kb.get("pat", {}).get("constructs", [])),
        "templates": len(kb.get("tpl", {})),
        "roles": len(kb.get("roles", {}).get("aliases", {})),
        "default_lane": eng.default_lane,
    }


@router.get("/debug-kb-templates")
def frajer_debug_kb_templates(locale: str = "sk"):
    eng = FrajerKB(locale=locale)
    tpl = eng.kb.get("tpl", {})
    return {"count": len(tpl), "keys": list(tpl.keys())[:50]}  # prvĂ˝ch 50 kÄľĂşÄŤov


@router.get("/ping")
def frajer_ping():
    return {"ok": True}


@router.api_route("/debug-parse", methods=["GET", "POST"])
async def frajer_debug_parse(request: Request):
    """
    Ultra-safe debug (GET aj POST).
    Nikdy 500: na chybu vrĂˇti {"error": "...", "stack": "..."}.
    GET:  /frajer/debug-parse?text=...&locale=sk
    POST: {"text":"...", "locale":"sk"}
    """
    import json
    import traceback

    # --- vstup ---
    try:
        if request.method == "POST":
            try:
                data = await request.json()
            except Exception:
                raw = await request.body()
                data = json.loads(raw.decode("utf-8"))
            text = (data.get("text") or "").strip()
            locale = (data.get("locale") or "sk").strip() or "sk"
        else:
            q = request.query_params
            text = (q.get("text") or "").strip()
            locale = (q.get("locale") or "sk").strip() or "sk"
    except Exception as e:
        return {"sentences": [], "error": f"input_error: {e.__class__.__name__}: {e}"}

    try:
        engine = FrajerKB(locale=locale)
        sentences = _split_sentences(text)

        out = []
        prev = None
        for s in sentences:
            try:
                construct = engine.detect_construct(s)
                row = {
                    "sentence": s,
                    "construct": construct,
                    "slots": {},
                    "detected_template_in_kb": False,
                    "nodes_preview": [],
                    "flows_preview": [],
                }

                if not construct:
                    lane = engine._lane_hint(s)
                    row["nodes_preview"] = [
                        {"type": "task", "label": s, "laneId": lane}
                    ]
                    out.append(row)
                    continue

                tpl_name = construct["template"]
                slots = engine.fill_slots(s, tpl_name)
                row["slots"] = slots
                tpl_exists = tpl_name in engine.kb.get("tpl", {})
                row["detected_template_in_kb"] = tpl_exists

                if tpl_exists:
                    nodes, flows, last = engine.apply_template(tpl_name, slots, prev)
                    row["nodes_preview"] = [
                        {
                            "type": n["type"],
                            "label": n.get("label"),
                            "laneId": n.get("laneId"),
                        }
                        for n in nodes
                    ]
                    row["flows_preview"] = [
                        {"source": f["source"], "target": f["target"]} for f in flows
                    ]
                    prev = last

                out.append(row)
            except Exception as e:
                out.append(
                    {
                        "sentence": s,
                        "error": f"{e.__class__.__name__}: {e}",
                        "stack": traceback.format_exc(),
                    }
                )

        return {"sentences": out}

    except Exception as e:
        return {
            "sentences": [],
            "error": f"handler_error: {e.__class__.__name__}: {e}",
            "stack": traceback.format_exc(),
        }
