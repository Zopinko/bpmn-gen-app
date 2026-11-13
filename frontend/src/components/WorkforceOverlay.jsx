import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createCompetency,
  createEmployee,
  deleteCompetency,
  listCompetencies,
  listEmployees,
  updateCompetency,
} from "../api/workforce";
import { computeTaskRisk } from "./workforceUtils";

const LEVELS = ["primary", "backup", "training"];

const LEVEL_LABELS = {
  primary: "workforce.col_primary",
  backup: "workforce.col_backup",
  training: "workforce.col_training",
};

export default function WorkforceOverlay({
  orgId, processNodeId, selectedStepId, stepName, processName,
  startAdding = false, initialLevel = "backup", onClose, onChanged,
}) {
  const { t } = useTranslation();
  const [employees, setEmployees] = useState([]);
  const [competencies, setCompetencies] = useState([]);
  const [adding, setAdding] = useState(startAdding);
  const [createNew, setCreateNew] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [createdEmployee, setCreatedEmployee] = useState(null);
  const [newLevel, setNewLevel] = useState(initialLevel);
  const [newEmpNo, setNewEmpNo] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId || !processNodeId || !selectedStepId) return;
    setLoading(true);
    setError("");
    try {
      const [employeeItems, competencyItems] = await Promise.all([
        listEmployees(orgId),
        listCompetencies(orgId, { process_node_id: processNodeId }),
      ]);
      setEmployees(Array.isArray(employeeItems) ? employeeItems : []);
      setCompetencies((Array.isArray(competencyItems) ? competencyItems : []).filter((item) => item.step_id === selectedStepId));
      setLoaded(true);
    } catch (e) {
      setLoaded(false);
      setError(e?.message || t("workforce.error_load_assignments"));
    } finally {
      setLoading(false);
    }
  }, [orgId, processNodeId, selectedStepId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const employeesById = useMemo(() => {
    const map = new Map();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const assignedEmpIds = useMemo(() => new Set(competencies.map((item) => item.emp_id)), [competencies]);
  const availableEmployees = useMemo(
    () => employees.filter((employee) => !assignedEmpIds.has(employee.id)),
    [assignedEmpIds, employees],
  );
  const risk = useMemo(() => computeTaskRisk(competencies), [competencies]);
  const useNewPerson = createNew || !availableEmployees.length;
  const retryEmployee = !useNewPerson && selectedEmpId === createdEmployee?.id ? createdEmployee : null;

  const refreshAfterChange = useCallback(async () => {
    await load();
    if (typeof onChanged === "function") {
      await onChanged();
    }
  }, [load, onChanged]);

  const saveAssignment = async (action, errorKey) => {
    if (!loaded || loading || saving) return;
    setSaving(true);
    setError("");
    try {
      await action();
      await refreshAfterChange();
    } catch (e) {
      setError(e?.message || t(errorKey));
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async (event) => {
    event.preventDefault();
    if (!orgId || !processNodeId || !selectedStepId) return;
    await saveAssignment(async () => {
      let empId = selectedEmpId;
      let savedEmployee = retryEmployee;
      if (useNewPerson) {
        const employee = await createEmployee(orgId, {
          emp_no: newEmpNo,
          name: newName,
          position: "",
        });
        empId = employee.id;
        savedEmployee = employee;
        // Keep the new person available if saving the assignment fails.
        setEmployees((items) => [...items, employee]);
        setCreatedEmployee(employee);
        setSelectedEmpId(empId);
        setCreateNew(false);
      }
      try {
        await createCompetency(orgId, {
          emp_id: empId,
          process_node_id: processNodeId,
          step_id: selectedStepId,
          level: newLevel,
          step_name: stepName || "",
        });
      } catch (e) {
        if (!savedEmployee) throw e;
        if (useNewPerson) await onChanged?.();
        throw new Error(t("workforce.error_partial_assignment", {
          name: savedEmployee.name,
          reason: e?.message || t("workforce.error_save_assignment"),
        }));
      }
      setAdding(false);
      setCreateNew(false);
      setCreatedEmployee(null);
      setSelectedEmpId("");
      setNewEmpNo("");
      setNewName("");
      setNewLevel("backup");
    }, "workforce.error_save_assignment");
  };

  const riskMessage = risk === "none" ? "" : t(`workforce.overlay_risk_${risk}`);
  const busy = !loaded || loading || saving;
  const submitLabel = retryEmployee ? "workforce.retry_assignment" : "workforce.add_assignment";

  return (
    <aside className="workforce-overlay-panel">
      <div className="workforce-overlay-panel__header">
        <div>
          <p className="wizard-dialog-kicker">{processName || t("workforce.title")}</p>
          <h3>{stepName || selectedStepId}</h3>
        </div>
        <button className="btn btn--small" type="button" onClick={onClose}>
          {t("workforce.close")}
        </button>
      </div>

      {error ? <p className="auth-message auth-message--error" role="alert">{error}</p> : null}
      {loaded && !loading && riskMessage ? <div className={`workforce-overlay-risk is-${risk}`}>{riskMessage}</div> : null}
      {loading ? <p className="organization-hint">{t("workforce.loading")}</p> : null}
      {!loaded && !loading ? <button className="btn btn--small" type="button" onClick={load}>{t("workforce.refresh")}</button> : null}

      <div className="workforce-overlay-list">
        {competencies.map((competency) => {
          const employee = employeesById.get(competency.emp_id);
          return (
            <div key={competency.id} className="workforce-overlay-row">
              <div className="workforce-overlay-row__person">
                <strong>{employee?.emp_no || "-"}</strong>
                <span>{employee?.name || competency.emp_id}</span>
              </div>
              <select aria-label={t("workforce.assignment_level_for", { name: employee?.name || competency.emp_id })} value={competency.level} disabled={busy} onChange={(event) => {
                const level = event.target.value;
                void saveAssignment(() => updateCompetency(orgId, competency.id, { level }), "workforce.error_save_assignment");
              }}>
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(LEVEL_LABELS[level])}
                  </option>
                ))}
              </select>
              <button className="btn btn--small btn-danger" type="button" disabled={busy} aria-label={t("workforce.delete_assignment")} onClick={() => void saveAssignment(() => deleteCompetency(orgId, competency.id), "workforce.error_delete_assignment")}>
                X
              </button>
            </div>
          );
        })}
        {loaded && !competencies.length && !loading ? <p className="organization-hint">{t("workforce.no_assignments")}</p> : null}
      </div>

      {adding && loaded ? (
        <form className="workforce-overlay-add" onSubmit={handleAdd}>
          {availableEmployees.length ? (
            <label className="workforce-overlay-check">
              <input type="checkbox" checked={createNew} onChange={(event) => setCreateNew(event.target.checked)} disabled={busy} />
              {t("workforce.new_person")}
            </label>
          ) : null}
          {useNewPerson ? (
            <>
              <label className="wizard-field">
                <span>{t("workforce.person_number")}</span>
                <input value={newEmpNo} onChange={(event) => setNewEmpNo(event.target.value)} required disabled={busy} />
              </label>
              <label className="wizard-field">
                <span>{t("workforce.person_name")}</span>
                <input value={newName} onChange={(event) => setNewName(event.target.value)} required disabled={busy} />
              </label>
            </>
          ) : (
            <label className="wizard-field">
              <span>{t("workforce.select_person")}</span>
              <select aria-label={t("workforce.select_person")} value={selectedEmpId} onChange={(event) => setSelectedEmpId(event.target.value)} required disabled={busy}>
                <option value="">{t("workforce.select_person")}</option>
                {availableEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.emp_no} {employee.name}</option>)}
              </select>
            </label>
          )}
          <label className="wizard-field">
            <span>{t("workforce.assignment_level")}</span>
            <select aria-label={t("workforce.assignment_level")} value={newLevel} onChange={(event) => setNewLevel(event.target.value)} disabled={busy}>
              {LEVELS.map((level) => <option key={level} value={level}>{t(LEVEL_LABELS[level])}</option>)}
            </select>
          </label>
          <div className="workforce-overlay-add__actions">
            <button className="btn btn-primary btn--small" type="submit" disabled={busy}>
              {saving ? t("workforce.saving") : t(submitLabel)}
            </button>
            <button className="btn btn--small" type="button" onClick={() => setAdding(false)} disabled={saving}>
              {t("workforce.cancel")}
            </button>
          </div>
        </form>
      ) : loaded ? (
        <button className="btn btn-primary btn--small" type="button" disabled={busy} onClick={() => setAdding(true)}>
          {t("workforce.add_assignment")}
        </button>
      ) : null}
    </aside>
  );
}
