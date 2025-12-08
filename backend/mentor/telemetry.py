from __future__ import annotations

from .models import TelemetrySubmitResponse, TelemetrySubmission


def submit_telemetry(payload: TelemetrySubmission) -> TelemetrySubmitResponse:
    return TelemetrySubmitResponse()
