from typing import Any, Dict, List

from pydantic import BaseModel


class LinearWizardRequest(BaseModel):
    process_name: str
    roles: List[str]
    start_trigger: str
    output: str
    steps: List[str]


class LinearWizardResponse(BaseModel):
    engine_json: Dict[str, Any]
