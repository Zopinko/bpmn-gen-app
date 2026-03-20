import importlib
import logging
import os

from services import model_storage, project_notes_storage


def test_org_invite_secret_warns_once_in_production_when_missing(caplog, monkeypatch):
    monkeypatch.delenv("ORG_INVITE_TOKEN_SECRET", raising=False)
    monkeypatch.setenv("APP_ENV", "production")

    from auth import security as security_module

    security = importlib.reload(security_module)
    caplog.set_level(logging.WARNING)

    security.make_org_invite_public_token("invite-1")
    security.make_org_invite_public_token("invite-2")

    warnings = [record for record in caplog.records if "ORG_INVITE_TOKEN_SECRET is not configured" in record.getMessage()]
    assert len(warnings) == 1


def test_corrupt_storage_files_are_skipped_with_warning(tmp_path, caplog):
    model_storage.set_base_dir(tmp_path / "models")
    bad_model = model_storage.get_user_models_dir("user-1") / "broken.json"
    bad_model.write_text("{broken", encoding="utf-8")

    original_notes_dir = os.environ.get("BPMN_PROJECT_NOTES_DIR")
    os.environ["BPMN_PROJECT_NOTES_DIR"] = str(tmp_path / "notes")
    try:
        bad_notes = tmp_path / "notes" / "org_org-1.json"
        bad_notes.parent.mkdir(parents=True, exist_ok=True)
        bad_notes.write_text("{broken", encoding="utf-8")

        caplog.set_level(logging.WARNING)
        models = model_storage.list_models(user_id="user-1")
        notes = project_notes_storage.load_project_notes("org-1")

        assert models == []
        assert notes == []
        messages = [record.getMessage() for record in caplog.records]
        assert any("Failed to read model file while listing" in message for message in messages)
        assert any("Failed to read project notes file" in message for message in messages)
    finally:
        if original_notes_dir is None:
            os.environ.pop("BPMN_PROJECT_NOTES_DIR", None)
        else:
            os.environ["BPMN_PROJECT_NOTES_DIR"] = original_notes_dir
