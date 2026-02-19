from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.auth_config import get_auth_config


def apply_cors(app: FastAPI) -> None:
    cfg = get_auth_config()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_allowed_origins,
        allow_credentials=cfg.cors_allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )
