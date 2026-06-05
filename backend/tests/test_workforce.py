import os
import pytest
from services.org_employees_storage import (
    create_employee,
    list_employees,
    update_employee,
    delete_employee,
    get_employee,
)


def _set_env(tmp_path):
    prev = os.environ.get("BPMN_MODELS_DIR")
    os.environ["BPMN_MODELS_DIR"] = str(tmp_path / "models")
    return prev


def _restore_env(prev):
    if prev is None:
        os.environ.pop("BPMN_MODELS_DIR", None)
    else:
        os.environ["BPMN_MODELS_DIR"] = prev


def test_create_and_list_employee(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", emp_no="E001", name="Jana Kováčová", position="Referentka")
        assert emp["emp_no"] == "E001"
        assert emp["name"] == "Jana Kováčová"
        assert emp["position"] == "Referentka"
        assert "id" in emp
        assert "created_at" in emp

        items = list_employees("org1")
        assert len(items) == 1
        assert items[0]["emp_no"] == "E001"
    finally:
        _restore_env(prev)


def test_duplicate_emp_no_raises(tmp_path):
    prev = _set_env(tmp_path)
    try:
        create_employee("org1", "E001", "Jana K.")
        with pytest.raises(ValueError, match="E001"):
            create_employee("org1", "E001", "Iná Jana")
    finally:
        _restore_env(prev)


def test_update_employee(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.", "Referentka")
        updated = update_employee("org1", emp["id"], name="Jana Nová")
        assert updated["name"] == "Jana Nová"
        assert updated["position"] == "Referentka"  # unchanged
        assert get_employee("org1", emp["id"])["name"] == "Jana Nová"
    finally:
        _restore_env(prev)


def test_delete_employee(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        delete_employee("org1", emp["id"])
        assert list_employees("org1") == []
    finally:
        _restore_env(prev)


def test_employees_are_org_scoped(tmp_path):
    prev = _set_env(tmp_path)
    try:
        create_employee("org1", "E001", "Jana K.")
        create_employee("org2", "E001", "Peter M.")  # same emp_no, different org — OK
        assert len(list_employees("org1")) == 1
        assert len(list_employees("org2")) == 1
    finally:
        _restore_env(prev)
