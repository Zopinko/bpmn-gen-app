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


class WizardModelBase(BaseModel):
    id: str
    name: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    process_meta: dict | None = None


class WizardModelDetail(WizardModelBase):
    engine_json: Any
    diagram_xml: str
    generator_input: dict | None = None
    process_meta: dict | None = None


class WizardModelList(BaseModel):
    items: list[WizardModelBase]
    total: int
    limit: int
    offset: int
