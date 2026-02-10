from fastapi import FastAPI
import os
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from auth.db import run_auth_migrations
from core.auth_config import get_auth_config
from core.config import apply_cors
from routers.auth_router import router as auth_router
from routers.generate_router import router as generate_router
from routers.org_model_router import router as org_model_router
from routers.orgs_router import router as orgs_router
from routers.nl_router import router as nl_router
from routers.frajer_router import router as frajer_router
from routers.mentor_router import router as mentor_router
from routers.telemetry_router import router as telemetry_router
from routers.controller_router import router as controller_router


def create_app() -> FastAPI:
    app = FastAPI(title="BPMN.GEN")
    auth_db_path = get_auth_config().auth_db_path
    abs_path = Path(auth_db_path).expanduser().resolve()
    print(f"AUTH_DB_PATH={auth_db_path} | abs={abs_path}")
    run_auth_migrations()
    if abs_path.exists():
        size = abs_path.stat().st_size
        print(f"Auth DB exists: true | size: {size}")
    else:
        print("Auth DB exists: false | size: 0")

    apply_cors(app)

    # Routry
    app.include_router(auth_router)
    app.include_router(orgs_router)
    app.include_router(org_model_router)
    app.include_router(generate_router)
    app.include_router(nl_router)
    app.include_router(frajer_router)
    app.include_router(mentor_router)
    app.include_router(telemetry_router)
    app.include_router(controller_router)
    app.mount(
        "/playground", StaticFiles(directory="playground", html=True), name="playground"
    )

    return app


app = create_app()
