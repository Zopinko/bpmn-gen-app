from pathlib import Path

from services.storage_io import atomic_write_json, atomic_write_text


def test_atomic_write_json_writes_payload_and_leaves_no_temp_files(tmp_path):
    path = tmp_path / "nested" / "data.json"

    atomic_write_json(path, {"name": "test", "items": [1, 2, 3]}, ensure_ascii=False, indent=2)

    assert path.exists()
    assert '"name": "test"' in path.read_text(encoding="utf-8")
    assert list(path.parent.glob("*.tmp")) == []


def test_atomic_write_text_replaces_existing_content(tmp_path):
    path = tmp_path / "tree.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("old", encoding="utf-8")

    atomic_write_text(path, "new", encoding="utf-8")

    assert path.read_text(encoding="utf-8") == "new"
    assert list(Path(tmp_path).glob("*.tmp")) == []
