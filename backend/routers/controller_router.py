from dataclasses import asdict

from fastapi import APIRouter

from services.controller.validate import validate as controller_validate

router = APIRouter(prefix="/controller", tags=["Controller"])


@router.post("/validate")
def validate_endpoint(payload: dict):
    engine = payload.get("engine") or {}
    issues = controller_validate(engine)
    return {"issues": [asdict(issue) for issue in issues]}
