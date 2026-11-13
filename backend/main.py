try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import asyncio
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI
import os
from pathlib import Path
import logging
from sqlite3 import Error as SQLiteError
from fastapi.staticfiles import StaticFiles
from auth.db import get_connection, run_auth_migrations
from auth.email_outbox import deliver_next_auth_email
from auth.email_service import smtp_email_enabled
from auth.security import ensure_org_invite_secret_configured
from core.auth_config import get_auth_config
from core.config import apply_cors
from routers.auth_router import router as auth_router
from routers.admin_router import router as admin_router
from routers.admin_mfa_router import router as admin_mfa_router
from routers.generate_router import router as generate_router
from routers.org_model_router import router as org_model_router
from routers.orgs_router import router as orgs_router
from routers.frajer_router import router as frajer_router
from routers.mentor_router import router as mentor_router
from routers.telemetry_router import router as telemetry_router
from routers.controller_router import router as controller_router
from routers.org_workforce_router import router as org_workforce_router
from routers.feedback_router import router as feedback_router

logger = logging.getLogger(__name__)


async def _deliver_auth_emails() -> None:
    while True:
        try:
            pending = await asyncio.to_thread(deliver_next_auth_email)
        except SQLiteError as exc:
            logger.warning("Auth email queue unavailable: %s", type(exc).__name__)
            pending = False
        await asyncio.sleep(0.2 if pending else 5)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    task = asyncio.create_task(_deliver_auth_emails()) if smtp_email_enabled() else None
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


def mount_playground(app: FastAPI, playground_dir: Path | None = None) -> None:
    directory = playground_dir or (Path(__file__).resolve().parent / "playground")
    if not directory.exists():
        logger.warning("Skipping playground mount because directory does not exist: %s", directory)
        return
    app.mount("/playground", StaticFiles(directory=str(directory), html=True), name="playground")


def create_app() -> FastAPI:
    app = FastAPI(title="BPMN.GEN", lifespan=_lifespan)
    cfg = get_auth_config()
    abs_path = Path(cfg.auth_db_path).expanduser().resolve()
    run_auth_migrations()
    if abs_path.exists():
        logger.info("Auth DB is configured and present; size_bytes=%s", abs_path.stat().st_size)
    else:
        logger.warning("Auth DB path is configured but file does not exist yet.")
    with get_connection() as conn:
        legacy_org_admin_count = conn.execute(
            "SELECT COUNT(*) AS c FROM organization_members WHERE LOWER(role) NOT IN ('owner', 'member')"
        ).fetchone()["c"]
    if legacy_org_admin_count:
        logger.warning(
            "Found legacy organization_members rows with unsupported role count=%s",
            legacy_org_admin_count,
        )

    ensure_org_invite_secret_configured()
    apply_cors(app)

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok"}

    # Routry
    app.include_router(auth_router)
    app.include_router(admin_router)
    app.include_router(admin_mfa_router)
    app.include_router(orgs_router)
    app.include_router(org_model_router)
    app.include_router(generate_router)
    app.include_router(frajer_router)
    app.include_router(mentor_router)
    app.include_router(telemetry_router)
    app.include_router(controller_router)
    app.include_router(org_workforce_router)
    app.include_router(feedback_router)
    mount_playground(app)

    return app


app = create_app()
