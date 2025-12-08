from typing import Any, List

from pydantic import BaseModel


class LinearWizardRequest(BaseModel):
    process_name: str
    roles: List[str]
    start_trigger: str
    output: str
    steps: List[str]


class LinearWizardResponse(BaseModel):
    engine_json: Any
    issues: list[dict] | None = None


class LaneAppendRequest(BaseModel):
    lane_id: str | None = None
    lane_name: str | None = None
    description: str
    engine_json: dict


class LaneAppendResponse(BaseModel):
    engine_json: Any
    issues: list[dict] | None = None
