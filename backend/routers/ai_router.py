from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.ai_creative import AICreativeService

router = APIRouter(prefix="/ai", tags=["AI"])
_service = AICreativeService()


class CreativeOptions(BaseModel):
    return_xml: bool = True
    strict_bpmn: bool = False
    max_nodes: Optional[int] = None


class CreativeRequest(BaseModel):
    text: str
    language: str = "auto"
    options: CreativeOptions = CreativeOptions()


class CreativeIssue(BaseModel):
    code: str
    message: str
    severity: str = Field(default="warning")
    hint: Optional[str] = None


class CreativeResponse(BaseModel):
    engine_json: Optional[Dict[str, Any]] = None
    bpmn_xml: Optional[str] = None
    issues: List[CreativeIssue] = Field(default_factory=list)
    meta: Dict[str, Any] = Field(default_factory=dict)


class CreativeStatusResponse(BaseModel):
    ok: bool
    provider: str
    model: Optional[str] = None
    api_key_present: bool = False
    duration_ms: Optional[int] = None
    error: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)


@router.get("/creative/status", response_model=CreativeStatusResponse)
def creative_status() -> CreativeStatusResponse:
    status = _service.status()
    return CreativeStatusResponse(**status)


@router.post("/creative/generate", response_model=CreativeResponse)
def creative_generate(payload: CreativeRequest) -> CreativeResponse:
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text must not be empty.")

    result = _service.generate(text, payload.language, payload.options.model_dump())

    return CreativeResponse(
        engine_json=result.engine_json,
        bpmn_xml=result.bpmn_xml,
        issues=[CreativeIssue(**issue) for issue in result.issues],
        meta=result.meta,
    )
