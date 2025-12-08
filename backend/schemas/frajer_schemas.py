from typing import Any, Dict, List

from pydantic import BaseModel


class FrajerRequest(BaseModel):
    text: str


class FrajerResponse(BaseModel):
    engine_json: Dict[str, List[Dict[str, Any]]]
