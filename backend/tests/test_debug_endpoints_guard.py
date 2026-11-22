from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.frajer_router import router as frajer_router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(frajer_router)
    return TestClient(app)


def test_debug_endpoints_hidden_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    client = _client()
    assert client.get("/frajer/debug-kb").status_code == 404
    assert client.get("/frajer/debug-kb-templates").status_code == 404
    assert client.get("/frajer/debug-parse", params={"text": "x"}).status_code == 404
    assert client.post("/frajer/debug-parse", json={"text": "x"}).status_code == 404
    assert client.get("/frajer/ping").status_code == 200


def test_debug_endpoints_available_in_development(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    client = _client()
    assert client.get("/frajer/debug-kb").status_code == 200
