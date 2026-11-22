from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.csrf import OriginCheckMiddleware

ALLOWED = "https://app.bpmngen.com"


def _client() -> TestClient:
    app = FastAPI()
    app.add_middleware(OriginCheckMiddleware, allowed_origins=[ALLOWED])

    @app.get("/read")
    def read():
        return {"ok": True}

    @app.post("/write")
    def write():
        return {"ok": True}

    @app.delete("/write")
    def delete():
        return {"ok": True}

    return TestClient(app)


def test_foreign_origin_cannot_send_unsafe_requests():
    client = _client()
    assert client.post("/write", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.delete("/write", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/write", headers={"Origin": "null"}).status_code == 403


def test_allowed_origin_and_missing_origin_pass():
    client = _client()
    assert client.post("/write", headers={"Origin": ALLOWED}).status_code == 200
    assert client.post("/write", headers={"Origin": ALLOWED + "/"}).status_code == 200
    assert client.post("/write").status_code == 200


def test_safe_methods_are_not_checked():
    client = _client()
    assert client.get("/read", headers={"Origin": "https://evil.example"}).status_code == 200


def test_app_registers_origin_check():
    from main import app

    assert any(m.cls is OriginCheckMiddleware for m in app.user_middleware)
