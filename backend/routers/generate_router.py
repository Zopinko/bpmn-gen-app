from fastapi import APIRouter, Body, Depends, File, HTTPException, Response, UploadFile
from services.bpmn_svc import (
    append_tasks_to_lane_from_description,
    build_linear_engine_from_wizard,
    generate_bpmn_from_json,
)
from services.architect.normalize import normalize_engine_payload
from services.bpmn_import import bpmn_xml_to_engine
from services.model_storage import (
    delete_model,
    get_user_models_dir,
    list_models as storage_list_models,
    load_model as storage_load_model,
    save_model as storage_save_model,
)
try:
    from services.project_notes_storage import load_project_notes, save_project_notes
except ModuleNotFoundError:
    from backend.services.project_notes_storage import load_project_notes, save_project_notes
from schemas.engine import validate_payload, validate_xml
from services.engine_normalizer import find_gateway_warnings
from schemas.wizard import (
    LaneAppendRequest,
    LaneAppendResponse,
    LinearWizardRequest,
    LinearWizardResponse,
    WizardModelBase,
    WizardModelDetail,
    WizardModelList,
)
import logging
from auth.deps import require_user
from auth.service import AuthUser

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/")
def root():
    return {"message": "BPMN Generator bezi!"}


def _as_bpmn_download(xml_string: str, filename: str):
    return Response(
        content=xml_string,
        media_type="application/bpmn+xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/wizard/linear", response_model=LinearWizardResponse)
def generate_linear_wizard_diagram(
    payload: LinearWizardRequest,
) -> LinearWizardResponse:
    """
    Build a simple linear BPMN diagram from a wizard payload without any AI calls.
    """
    built = build_linear_engine_from_wizard(payload, return_issues=True)
    engine_json = built["engine_json"]
    issues = built.get("issues") or []
    validate_payload(engine_json)
    return LinearWizardResponse(engine_json=engine_json, issues=issues)


@router.post("/wizard/lane/append", response_model=LaneAppendResponse)
def wizard_append_lane(payload: LaneAppendRequest) -> LaneAppendResponse:
    built = append_tasks_to_lane_from_description(payload)
    engine_json = normalize_engine_payload(built["engine_json"])
    if not str(engine_json.get("name") or "").strip():
        engine_json["name"] = str(engine_json.get("processId") or "").strip() or "Proces"
    if not str(engine_json.get("processId") or "").strip():
        engine_json["processId"] = "proc_fallback"
    issues = built.get("issues") or []
    validate_payload(engine_json)
    return LaneAppendResponse(engine_json=engine_json, issues=issues)


@router.post("/wizard/export-bpmn")
def wizard_export_bpmn(payload: dict = Body(...)):
    """
    Export engine_json (wizard) ako BPMN 2.0 XML na stiahnutie.

    Ak klient pošle obálku {"engine_json": {...}}, zoberieme vnútro;
    inak očakávame priamo engine_json.
    """
    engine = payload.get("engine_json") if isinstance(payload, dict) else None
    if not isinstance(engine, dict):
        engine = payload

    validate_payload(engine)
    try:
        xml = generate_bpmn_from_json(engine)
        validate_xml(xml)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    filename = f"{engine.get('processId','process')}.bpmn"
    return _as_bpmn_download(xml, filename)


@router.post("/wizard/import-bpmn")
async def wizard_import_bpmn(file: UploadFile = File(...)):
    """
    Načíta BPMN XML (.bpmn) a skonvertuje ho na engine_json použiteľné vo wizarde.
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Súbor je prázdny.")

    try:
        xml_text = content.decode("utf-8")
    except UnicodeDecodeError:
        xml_text = content.decode("utf-8", errors="replace")

    try:
        engine = bpmn_xml_to_engine(xml_text)
        validate_payload(engine)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"engine_json": engine}


@router.post("/wizard/models", response_model=WizardModelBase)
def create_wizard_model(
    payload: dict = Body(...),
    current_user: AuthUser = Depends(require_user),
):
    """
    Uloží model s engine_json a aktuálnym BPMN XML (DI) do perzistentného úložiska.
    """
    name = payload.get("name") or "Process"
    engine = payload.get("engine_json")
    xml = payload.get("diagram_xml")
    generator_input = payload.get("generator_input") if isinstance(payload, dict) else None
    process_meta = payload.get("process_meta") if isinstance(payload, dict) else None

    if not isinstance(engine, dict):
        raise HTTPException(status_code=400, detail="engine_json je povinné a musí byť objekt.")
    if not isinstance(xml, str) or not xml.strip():
        raise HTTPException(status_code=400, detail="diagram_xml je povinné a musí byť string.")

    validate_payload(engine)
    model = storage_save_model(
        name=name,
        engine_json=engine,
        diagram_xml=xml,
        model_id=payload.get("id"),
        generator_input=generator_input,
        process_meta=process_meta,
        user_id=current_user.id,
    )
    return {
        "id": model["id"],
        "name": model["name"],
        "created_at": model["created_at"],
        "updated_at": model["updated_at"],
    }


@router.get("/wizard/models/{model_id}", response_model=WizardModelDetail)
def get_wizard_model(model_id: str, current_user: AuthUser = Depends(require_user)):
    try:
        model = storage_load_model(model_id, user_id=current_user.id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Model nenájdený.")
    return model


@router.get("/wizard/models", response_model=WizardModelList)
def list_wizard_models(
    limit: int = 20,
    offset: int = 0,
    search: str | None = None,
    current_user: AuthUser = Depends(require_user),
):
    """
    Jednoduché listovanie uložených modelov (perzistentné úložisko).
    """
    items = storage_list_models(search=search, user_id=current_user.id)
    total = len(items)
    sliced = items[offset : offset + limit]
    try:
        path = get_user_models_dir(current_user.id)
    except Exception:
        path = "unknown"
    logger.info("Listing sandbox models user=%s path=%s count=%s", current_user.id, path, total)
    return {"items": sliced, "total": total, "limit": limit, "offset": offset}


@router.delete("/wizard/models/{model_id}")
def delete_wizard_model(model_id: str, current_user: AuthUser = Depends(require_user)):
    try:
        storage_load_model(model_id, user_id=current_user.id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Model nenájdený.")
    delete_model(model_id, user_id=current_user.id)
    return {"ok": True}


@router.patch("/wizard/models/{model_id}", response_model=WizardModelDetail)
def rename_wizard_model(
    model_id: str,
    payload: dict = Body(...),
    current_user: AuthUser = Depends(require_user),
):
    new_name = payload.get("name") if isinstance(payload, dict) else None
    if not isinstance(new_name, str) or not new_name.strip():
        raise HTTPException(status_code=400, detail="name je povinné a musí byť string.")

    try:
        existing = storage_load_model(model_id, user_id=current_user.id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Model nenájdený.")

    updated = storage_save_model(
        name=new_name.strip(),
        engine_json=existing.get("engine_json") or {},
        diagram_xml=existing.get("diagram_xml") or "",
        model_id=model_id,
        generator_input=existing.get("generator_input"),
        process_meta=existing.get("process_meta"),
        user_id=current_user.id,
    )
    return updated


@router.get("/wizard/project-notes")
def get_project_notes():
    notes = load_project_notes()
    return {"notes": notes}


@router.put("/wizard/project-notes")
def put_project_notes(payload: dict = Body(...)):
    notes = payload.get("notes") if isinstance(payload, dict) else None
    if not isinstance(notes, list):
        raise HTTPException(status_code=400, detail="notes je povinne a musi byt list.")
    saved = save_project_notes(notes)
    return {"notes": saved}


@router.post("/generate")
async def generate(payload: dict = Body(...)):
    if not payload:
        raise HTTPException(status_code=400, detail="Payload je povinný.")

    # Normalize engine-like payloads (auto processId + node type aliases)
    engine = normalize_engine_payload(payload)

    # Optional: warn if gateways are malformed (no incoming/outgoing flows)
    for w in find_gateway_warnings(engine.get("nodes", []), engine.get("flows", [])):
        try:
            logger.warning(w)  # if you have a logger
        except NameError:
            print(f"[GW-WARN] {w}")

    # 3) Ak nemáme nič, error
    if not engine:
        raise HTTPException(400, "Payload musí obsahovať engine_json alebo simple_json")

    # 4) Validácia + BPMN generovanie
    validate_payload(engine)
    try:
        xml = generate_bpmn_from_json(engine)
        validate_xml(xml)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return _as_bpmn_download(xml, filename=f"{engine.get('processId','process')}.bpmn")


@router.post("/layout/reflow")
async def reflow_layout(payload: dict = Body(...)):
    if not payload:
        raise HTTPException(status_code=400, detail="Payload je povinný.")

    engine = payload.get("engine_json") if isinstance(payload, dict) else None
    if not isinstance(engine, dict):
        engine = payload if isinstance(payload, dict) else None

    if not isinstance(engine, dict):
        raise HTTPException(
            status_code=400,
            detail="Payload musí obsahovať engine_json alebo engine objekt.",
        )

    engine = normalize_engine_payload(engine)

    for w in find_gateway_warnings(engine.get("nodes", []), engine.get("flows", [])):
        try:
            logger.warning(w)
        except NameError:
            print(f"[GW-WARN] {w}")

    validate_payload(engine)
    try:
        xml = generate_bpmn_from_json(engine)
        validate_xml(xml)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"engine_json": engine, "diagram_xml": xml}


@router.post("/autogenerate")
async def autogenerate(payload: dict = Body(...)):
    """
    Convenience endpoint:
    - expects payload with engine_json
    - generates BPMN XML and returns it as download
    """
    engine = payload.get("engine_json") if isinstance(payload, dict) else None
    if not isinstance(engine, dict):
        raise HTTPException(
            status_code=400,
            detail="Payload musi obsahovat engine_json (object).",
        )

    engine = normalize_engine_payload(engine)

    for w in find_gateway_warnings(engine.get("nodes", []), engine.get("flows", [])):
        try:
            logger.warning(w)
        except NameError:
            print(f"[GW-WARN] {w}")

    validate_payload(engine)
    try:
        xml = generate_bpmn_from_json(engine)
        validate_xml(xml)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return _as_bpmn_download(xml, filename=f"{engine.get('processId','process')}.bpmn")
