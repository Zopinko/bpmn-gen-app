import os
import pytest
from services.org_employees_storage import (
    create_employee,
    list_employees,
    update_employee,
    delete_employee,
    get_employee,
)
from services.org_competencies_storage import (
    create_competency,
    list_competencies,
    update_competency,
    delete_competency,
    delete_competencies_by_employee,
    build_matrix,
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


def test_update_employee_not_found(tmp_path):
    prev = _set_env(tmp_path)
    try:
        with pytest.raises(LookupError):
            update_employee("org1", "nonexistent-id", name="New Name")
    finally:
        _restore_env(prev)


def test_delete_employee_not_found(tmp_path):
    prev = _set_env(tmp_path)
    try:
        with pytest.raises(LookupError):
            delete_employee("org1", "nonexistent-id")
    finally:
        _restore_env(prev)


def test_create_and_list_competency(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        comp = create_competency("org1", emp["id"], "node_1", "task_1", "primary")
        assert comp["emp_id"] == emp["id"]
        assert comp["step_id"] == "task_1"
        assert comp["level"] == "primary"

        items = list_competencies("org1")
        assert len(items) == 1

        by_process = list_competencies("org1", process_node_id="node_1")
        assert len(by_process) == 1

        by_emp = list_competencies("org1", emp_id=emp["id"])
        assert len(by_emp) == 1
    finally:
        _restore_env(prev)


def test_upsert_competency_changes_level(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        create_competency("org1", emp["id"], "node_1", "task_1", "training")
        upserted = create_competency("org1", emp["id"], "node_1", "task_1", "primary")
        assert upserted["level"] == "primary"
        assert len(list_competencies("org1")) == 1  # no duplicate
    finally:
        _restore_env(prev)


def test_delete_employee_cascades_competencies(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        create_competency("org1", emp["id"], "node_1", "task_1", "primary")
        delete_competencies_by_employee("org1", emp["id"])
        assert list_competencies("org1") == []
    finally:
        _restore_env(prev)


def test_build_matrix_risk_levels(tmp_path):
    prev = _set_env(tmp_path)
    try:
        e1 = create_employee("org1", "E001", "Jana K.")
        e2 = create_employee("org1", "E002", "Peter M.")

        # task_1: primary + backup → risk=none
        create_competency("org1", e1["id"], "node_1", "task_1", "primary")
        create_competency("org1", e2["id"], "node_1", "task_1", "backup")

        # task_2: only primary, no backup → risk=critical
        create_competency("org1", e1["id"], "node_1", "task_2", "primary")

        # task_3: two backups, no primary → risk=low
        create_competency("org1", e1["id"], "node_1", "task_3", "backup")
        create_competency("org1", e2["id"], "node_1", "task_3", "backup")

        matrix = build_matrix("org1")
        risk_map = {r["step_id"]: r["risk"] for r in matrix["risk"]}
        assert risk_map["task_1"] == "none"
        assert risk_map["task_2"] == "critical"
        assert risk_map["task_3"] == "low"

        assert "task_4" not in risk_map
    finally:
        _restore_env(prev)


def test_build_matrix_process_filter(tmp_path):
    prev = _set_env(tmp_path)
    try:
        emp = create_employee("org1", "E001", "Jana K.")
        create_competency("org1", emp["id"], "node_1", "task_1", "primary")
        create_competency("org1", emp["id"], "node_2", "task_x", "backup")

        matrix = build_matrix("org1", process_node_id="node_1")
        step_ids = [s["step_id"] for s in matrix["steps"]]
        assert "task_1" in step_ids
        assert "task_x" not in step_ids
    finally:
        _restore_env(prev)
