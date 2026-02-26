from fastapi import FastAPI, HTTPException, Request
import os
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from auth.db import get_connection, run_auth_migrations
from auth.deps import is_admin_panel_available, is_super_admin_user, require_user
from core.auth_config import get_auth_config
from core.config import apply_cors
from routers.auth_router import router as auth_router
from routers.admin_router import router as admin_router
from routers.generate_router import router as generate_router
from routers.org_model_router import router as org_model_router
from routers.orgs_router import router as orgs_router
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
    with get_connection() as conn:
        legacy_org_admin_count = conn.execute(
            "SELECT COUNT(*) AS c FROM organization_members WHERE role = 'admin'"
        ).fetchone()["c"]
    if legacy_org_admin_count:
        print(f"WARNING: legacy organization_members.role='admin' rows: {legacy_org_admin_count}")

    apply_cors(app)

    @app.middleware("http")
    async def admin_super_admin_guard(request: Request, call_next):
        path = request.url.path or ""
        if path == "/api/admin" or path.startswith("/api/admin/"):
            if not is_admin_panel_available():
                return JSONResponse(status_code=404, content={"detail": "Not found"})
            try:
                user = require_user(request)
            except HTTPException:
                return JSONResponse(status_code=404, content={"detail": "Not found"})
            if not is_super_admin_user(user):
                return JSONResponse(status_code=404, content={"detail": "Not found"})
        return await call_next(request)

    # Routry
    app.include_router(auth_router)
    app.include_router(admin_router)
    app.include_router(orgs_router)
    app.include_router(org_model_router)
    app.include_router(generate_router)
    app.include_router(frajer_router)
    app.include_router(mentor_router)
    app.include_router(telemetry_router)
    app.include_router(controller_router)
    app.mount(
        "/playground", StaticFiles(directory="playground", html=True), name="playground"
    )

    return app


app = create_app()
