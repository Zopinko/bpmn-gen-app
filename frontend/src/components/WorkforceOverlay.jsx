import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createCompetency,
  createEmployee,
  deleteCompetency,
  listCompetencies,
  listEmployees,
  updateCompetency,
} from "../api/workforce";

const LEVELS = ["primary", "backup", "training"];

const LEVEL_LABELS = {
  primary: "Primarny",
  backup: "Zaloha",
  training: "Zacvik",
};

export const RISK_BORDER = {
  none: "#16a34a",
  low: "#d97706",
  critical: "#ef4444",
  unassigned: "#475569",
};

export function computeTaskRisk(competencies) {
  const items = Array.isArray(competencies) ? competencies : [];
  if (!items.length) return "unassigned";
  if (items.length === 1) return "critical";
  const levels = new Set(items.map((item) => item.level));
  if (levels.has("primary") && levels.has("backup")) return "none";
  return "low";
}

export default function WorkforceOverlay({ orgId, processNodeId, selectedStepId, stepName, onClose, onChanged }) {
  const [employees, setEmployees] = useState([]);
  const [competencies, setCompetencies] = useState([]);
  const [adding, setAdding] = useState(false);
  const [createNew, setCreateNew] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [newLevel, setNewLevel] = useState("backup");
  const [newEmpNo, setNewEmpNo] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    } catch (e) {
      setError(e?.message || "Nepodarilo sa nacitat kompetencie.");
    } finally {
      setLoading(false);
    }
  }, [orgId, processNodeId, selectedStepId]);

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

  const refreshAfterChange = useCallback(async () => {
    await load();
    if (typeof onChanged === "function") {
      await onChanged();
    }
  }, [load, onChanged]);

  const handleAdd = async () => {
    if (!orgId || !processNodeId || !selectedStepId) return;
    setError("");
    try {
      let empId = selectedEmpId;
      if (createNew) {
        const employee = await createEmployee(orgId, {
          emp_no: newEmpNo,
          name: newName,
          position: "",
        });
        empId = employee.id;
      }
      if (!empId) {
        setError("Vyber alebo vytvor zamestnanca.");
        return;
      }
      await createCompetency(orgId, {
        emp_id: empId,
        process_node_id: processNodeId,
        step_id: selectedStepId,
        level: newLevel,
      });
      setAdding(false);
      setCreateNew(false);
      setSelectedEmpId("");
      setNewEmpNo("");
      setNewName("");
      setNewLevel("backup");
      await refreshAfterChange();
    } catch (e) {
      setError(e?.message || "Nepodarilo sa pridat kompetenciu.");
    }
  };

  const handleLevelChange = async (competencyId, level) => {
    setError("");
    try {
      await updateCompetency(orgId, competencyId, { level });
      await refreshAfterChange();
    } catch (e) {
      setError(e?.message || "Nepodarilo sa zmenit uroven.");
    }
  };

  const handleRemove = async (competencyId) => {
    setError("");
    try {
      await deleteCompetency(orgId, competencyId);
      await refreshAfterChange();
    } catch (e) {
      setError(e?.message || "Nepodarilo sa odstranit kompetenciu.");
    }
  };

  const riskMessage = {
    unassigned: "Nikto nie je priradeny k tomuto kroku.",
    critical: "Len jedna osoba pozna tento krok. Je to riziko vypadku.",
    low: "Chyba primarny vykonavatel alebo zaloha.",
    none: "",
  }[risk];

  return (
    <aside className="workforce-overlay-panel">
      <div className="workforce-overlay-panel__header">
        <div>
          <p className="wizard-dialog-kicker">Zastupitelnost</p>
          <h3>{stepName || selectedStepId}</h3>
        </div>
        <button className="btn btn--small" type="button" onClick={onClose}>
          Zavriet
        </button>
      </div>

      {error ? <p className="auth-message auth-message--error">{error}</p> : null}
      {riskMessage ? <div className={`workforce-overlay-risk is-${risk}`}>{riskMessage}</div> : null}
      {loading ? <p className="organization-hint">Nacitavam...</p> : null}

      <div className="workforce-overlay-list">
        {competencies.map((competency) => {
          const employee = employeesById.get(competency.emp_id);
          return (
            <div key={competency.id} className="workforce-overlay-row">
              <div className="workforce-overlay-row__person">
                <strong>{employee?.emp_no || "-"}</strong>
                <span>{employee?.name || competency.emp_id}</span>
              </div>
              <select value={competency.level} onChange={(event) => handleLevelChange(competency.id, event.target.value)}>
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
              <button className="btn btn--small btn-danger" type="button" onClick={() => handleRemove(competency.id)}>
                X
              </button>
            </div>
          );
        })}
        {!competencies.length && !loading ? <p className="organization-hint">Zatial ziadne priradenia.</p> : null}
      </div>

      {adding ? (
        <div className="workforce-overlay-add">
          <label className="workforce-overlay-check">
            <input type="checkbox" checked={createNew} onChange={(event) => setCreateNew(event.target.checked)} />
            Novy zamestnanec
          </label>
          {createNew ? (
            <>
              <input value={newEmpNo} onChange={(event) => setNewEmpNo(event.target.value)} placeholder="Cislo zamestnanca" />
              <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Meno" />
            </>
          ) : (
            <select value={selectedEmpId} onChange={(event) => setSelectedEmpId(event.target.value)}>
              <option value="">Vyber zamestnanca</option>
              {availableEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.emp_no} {employee.name}
                </option>
              ))}
            </select>
          )}
          <select value={newLevel} onChange={(event) => setNewLevel(event.target.value)}>
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
          <div className="workforce-overlay-add__actions">
            <button className="btn btn-primary btn--small" type="button" onClick={handleAdd}>
              Pridat
            </button>
            <button className="btn btn--small" type="button" onClick={() => setAdding(false)}>
              Zrusit
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-primary btn--small" type="button" onClick={() => setAdding(true)}>
          Pridat zamestnanca
        </button>
      )}
    </aside>
  );
}
