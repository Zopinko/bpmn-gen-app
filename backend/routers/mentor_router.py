from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from mentor.models import (
    ABEvaluationResponse,
    MentorEngineApplyRequest,
    MentorEngineApplyResponse,
    MentorReviewRequest,
    MentorReviewResponse,
    ValidationRequest,
)
from mentor.service import MentorProviderError, MentorService
from mentor.validator import validate_kb_version

router = APIRouter(tags=["Mentor"])

_service = MentorService()


@router.post("/mentor/review", response_model=MentorReviewResponse)
def review(payload: MentorReviewRequest) -> MentorReviewResponse:
    proposals, meta = _service.review(payload)
    return MentorReviewResponse(proposals=proposals, meta=meta)


@router.post("/mentor/apply", response_model=MentorEngineApplyResponse)
def apply(payload: MentorEngineApplyRequest) -> MentorEngineApplyResponse:  # type: ignore[override]
    if payload.engine_json is None:
        raise HTTPException(status_code=400, detail="engine_json is required")

    try:
        engine_json, audit_log = _service.apply_engine_patches(
            engine_json=payload.engine_json,
            proposals=payload.proposals or [],
            selected_ids=payload.selected_ids or [],
        )
    except MentorProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return MentorEngineApplyResponse(engine_json=engine_json, audit_log=audit_log)


@router.post("/validate")
def validate(payload: ValidationRequest) -> dict:
    response = validate_kb_version(payload.kb_version)
    return response.model_dump(by_alias=True)


@router.get("/ab-eval", response_model=ABEvaluationResponse)
def ab_eval(
    base: int = Query(..., description="Base KB version identifier"),
    candidate: int = Query(..., description="Candidate KB version identifier"),
    window: int = Query(20, ge=1, description="Evaluation window size"),
) -> ABEvaluationResponse:
    _ = window
    return ABEvaluationResponse(base=base, candidate=candidate)
