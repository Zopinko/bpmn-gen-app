from typing import Optional, List
from pydantic import BaseModel


class NLTask(BaseModel):
    name: str


class NLLane(BaseModel):
    name: str
    tasks: List[NLTask]


class NLProcess(BaseModel):
    process_name: str
    lanes: List[NLLane]


class SessionReply(BaseModel):
    session_id: str
    assistant_message: str


class UserMessage(BaseModel):
    session_id: str
    message: str


class NLResponse(BaseModel):
    session_id: str
    assistant_message: str
    pending: bool = True
    simple_json: Optional[dict] = None
    engine_json: Optional[dict] = None
    bpmn_xml: Optional[str] = None
