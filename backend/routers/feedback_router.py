from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.deps import require_user

router = APIRouter(prefix="/api/feedback", tags=["Feedback"])


class CreateFeedbackRequest(BaseModel):
    message: str
    page: str = ""


@router.post("")
def submit_feedback(payload: CreateFeedbackRequest, current_user=Depends(require_user)):
    from services.feedback_storage import create_feedback

    try:
        return create_feedback(
            user_id=current_user.id,
            user_email=current_user.email,
            message=payload.message,
            page=payload.page,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
