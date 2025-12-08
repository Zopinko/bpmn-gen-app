from __future__ import annotations

from fastapi import APIRouter

from mentor.models import TelemetrySubmission, TelemetrySubmitResponse
from mentor.telemetry import submit_telemetry

router = APIRouter(prefix="/telemetry", tags=["Telemetry"])


@router.post("/submit", response_model=TelemetrySubmitResponse)
def submit(payload: TelemetrySubmission) -> TelemetrySubmitResponse:
    return submit_telemetry(payload)
