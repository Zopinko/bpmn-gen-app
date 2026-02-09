from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from auth.db import run_auth_migrations
from core.config import apply_cors
from routers.auth_router import router as auth_router
from routers.generate_router import router as generate_router
from routers.nl_router import router as nl_router
from routers.frajer_router import router as frajer_router
from routers.mentor_router import router as mentor_router
from routers.telemetry_router import router as telemetry_router
from routers.controller_router import router as controller_router


def create_app() -> FastAPI:
    app = FastAPI(title="BPMN.GEN")
    run_auth_migrations()

    apply_cors(app)

    # Routry
    app.include_router(auth_router)
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
