from services import model_storage


def test_user_scoped_load_does_not_fallback_to_global_model(tmp_path):
    model_storage.set_base_dir(tmp_path / "models")
    saved = model_storage.save_model(
        name="Global model",
        engine_json={"nodes": []},
        diagram_xml="<xml />",
        model_id="shared-model",
    )

    assert saved["id"] == "shared-model"

    try:
        model_storage.load_model("shared-model", user_id="user-1")
        raise AssertionError("Expected user-scoped load to stay within the user scope.")
    except FileNotFoundError:
        pass


def test_user_scoped_delete_does_not_delete_global_model(tmp_path):
    model_storage.set_base_dir(tmp_path / "models")
    model_storage.save_model(
        name="Global model",
        engine_json={"nodes": []},
        diagram_xml="<xml />",
        model_id="shared-model",
    )

    model_storage.delete_model("shared-model", user_id="user-1")
    loaded = model_storage.load_model("shared-model")

    assert loaded["id"] == "shared-model"
