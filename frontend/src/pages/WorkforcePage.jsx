import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  createEmployee,
  deleteEmployee,
  getMatrix,
  listEmployees,
  updateEmployee,
} from "../api/workforce";
import { listMyOrgs } from "../api/wizard";

const RISK_META = {
  critical: { label: "Kriticke", short: "!", tone: "critical" },
  low: { label: "Slabe pokrytie", short: "~", tone: "low" },
  none: { label: "Pokryte", short: "OK", tone: "none" },
  unassigned: { label: "Nepriradene", short: "0", tone: "unassigned" },
};

const LEVEL_META = {
  primary: { label: "Primarny", short: "P", tone: "primary" },
  backup: { label: "Zaloha", short: "Z", tone: "backup" },
  training: { label: "Zacvik", short: "T", tone: "training" },
};

const RISK_ORDER = ["critical", "low", "unassigned", "none"];

function getStoredActiveOrgId(orgs) {
  if (typeof window === "undefined") return orgs[0]?.id || "";
  const stored = window.localStorage.getItem("ACTIVE_ORG_ID") || "";
  return orgs.find((org) => String(org.id) === String(stored))?.id || orgs[0]?.id || "";
}

function stepKey(step) {
  return `${step.process_node_id || ""}::${step.step_id || ""}`;
}

function employeeLabel(employee) {
  return `${employee.emp_no || ""} ${employee.name || ""} ${employee.position || ""}`.toLowerCase();
}

function stepLabel(step) {
  return `${step.step_name || ""} ${step.step_id || ""} ${step.process_name || ""} ${step.process_node_id || ""}`.toLowerCase();
}

export default function WorkforcePage() {
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState("");
  const [employees, setEmployees] = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [tab, setTab] = useState("matrix");
  const [form, setForm] = useState({ emp_no: "", name: "", position: "" });
  const [editId, setEditId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [stepQuery, setStepQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [processFilter, setProcessFilter] = useState("all");
  const [deleteConfirmId, setDeleteConfirmId] = useState("");

  const activeOrg = useMemo(
    () => orgs.find((org) => String(org.id) === String(orgId)) || null,
    [orgId, orgs],
  );

  const loadEmployees = useCallback(async (activeOrgId = orgId) => {
    if (!activeOrgId) {
      setEmployees([]);
      return;
    }
    const items = await listEmployees(activeOrgId);
    setEmployees(Array.isArray(items) ? items : []);
  }, [orgId]);

  const loadMatrix = useCallback(async (activeOrgId = orgId) => {
    if (!activeOrgId) {
      setMatrix(null);
      return;
    }
    setMatrix(await getMatrix(activeOrgId));
  }, [orgId]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const items = await listMyOrgs();
      const nextOrgs = Array.isArray(items) ? items : [];
      const nextOrgId = getStoredActiveOrgId(nextOrgs);
      setOrgs(nextOrgs);
      setOrgId(nextOrgId);
      await Promise.all([loadEmployees(nextOrgId), loadMatrix(nextOrgId)]);
    } catch (e) {
      setError(e?.message || "Nepodarilo sa nacitat workforce.");
    } finally {
      setLoading(false);
    }
  }, [loadEmployees, loadMatrix]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!orgId) return;
    setError("");
    void loadEmployees(orgId).catch((e) => setError(e?.message || "Nepodarilo sa nacitat zamestnancov."));
    void loadMatrix(orgId).catch((e) => setError(e?.message || "Nepodarilo sa nacitat maticu."));
  }, [loadEmployees, loadMatrix, orgId]);

  const handleOrgChange = (event) => {
    const nextOrgId = event.target.value;
    setOrgId(nextOrgId);
    if (typeof window !== "undefined") {
      const nextOrg = orgs.find((org) => String(org.id) === String(nextOrgId));
      window.localStorage.setItem("ACTIVE_ORG_ID", nextOrgId);
      window.localStorage.setItem("ACTIVE_ORG_NAME", nextOrg?.name || "");
      window.dispatchEvent(new Event("active-org-changed"));
    }
  };

  const resetForm = () => {
    setEditId("");
    setDeleteConfirmId("");
    setForm({ emp_no: "", name: "", position: "" });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!orgId || saving) return;
    setSaving(true);
    setError("");
    try {
      if (editId) {
        await updateEmployee(orgId, editId, { name: form.name, position: form.position });
      } else {
        await createEmployee(orgId, form);
      }
      resetForm();
      await Promise.all([loadEmployees(orgId), loadMatrix(orgId)]);
    } catch (e) {
      setError(e?.message || "Nepodarilo sa ulozit zamestnanca.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (employee) => {
    setDeleteConfirmId("");
    setEditId(employee.id);
    setForm({
      emp_no: employee.emp_no || "",
      name: employee.name || "",
      position: employee.position || "",
    });
  };

  const handleDeleteConfirm = async (employee) => {
    if (!orgId || !employee?.id) return;
    setDeleteConfirmId("");
    setError("");
    try {
      await deleteEmployee(orgId, employee.id);
      if (editId === employee.id) resetForm();
      await Promise.all([loadEmployees(orgId), loadMatrix(orgId)]);
    } catch (e) {
      setError(e?.message || "Nepodarilo sa odstranit zamestnanca.");
    }
  };

  const refreshAll = async () => {
    setError("");
    try {
      await Promise.all([loadEmployees(orgId), loadMatrix(orgId)]);
    } catch (e) {
      setError(e?.message || "Nepodarilo sa obnovit data.");
    }
  };

  const riskByStep = useMemo(() => {
    const map = new Map();
    (matrix?.risk || []).forEach((entry) => {
      map.set(`${entry.process_node_id || ""}::${entry.step_id}`, entry.risk || "none");
    });
    return map;
  }, [matrix]);

  const processOptions = useMemo(() => {
    const options = new Map();
    (matrix?.steps || []).forEach((step) => {
      if (!step.process_node_id) return;
      options.set(String(step.process_node_id), step.process_name || step.process_node_id);
    });
    return Array.from(options.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [matrix]);

  const visibleSteps = useMemo(() => {
    const query = stepQuery.trim().toLowerCase();
    return (matrix?.steps || []).filter((step) => {
      const risk = riskByStep.get(stepKey(step)) || "none";
      const matchesRisk = riskFilter === "all" || risk === riskFilter;
      const matchesProcess = processFilter === "all" || String(step.process_node_id || "") === processFilter;
      const text = stepLabel(step);
      const matchesQuery = !query || text.includes(query);
      return matchesRisk && matchesProcess && matchesQuery;
    });
  }, [matrix?.steps, processFilter, riskByStep, riskFilter, stepQuery]);

  const visibleEmployees = useMemo(() => {
    const query = employeeQuery.trim().toLowerCase();
    const items = matrix?.employees?.length ? matrix.employees : employees;
    return (items || []).filter((employee) => !query || employeeLabel(employee).includes(query));
  }, [employeeQuery, employees, matrix?.employees]);

  const employeesById = useMemo(() => {
    const map = new Map();
    (matrix?.employees?.length ? matrix.employees : employees).forEach((employee) => {
      map.set(String(employee.id), employee);
    });
    return map;
  }, [employees, matrix?.employees]);

  const visibleEmployeeIds = useMemo(
    () => new Set(visibleEmployees.map((employee) => String(employee.id))),
    [visibleEmployees],
  );

  const assignmentsByStep = useMemo(() => {
    const map = new Map();
    (matrix?.cells || []).forEach((cell) => {
      if (!visibleEmployeeIds.has(String(cell.emp_id))) return;
      const employee = employeesById.get(String(cell.emp_id));
      if (!employee) return;
      const key = `${cell.process_node_id || ""}::${cell.step_id || ""}`;
      const current = map.get(key) || { primary: [], backup: [], training: [] };
      const level = LEVEL_META[cell.level] ? cell.level : "training";
      map.set(key, {
        ...current,
        [level]: [...current[level], employee],
      });
    });
    return map;
  }, [employeesById, matrix?.cells, visibleEmployeeIds]);

  const riskSections = useMemo(() => {
    return RISK_ORDER.map((risk) => {
      const meta = RISK_META[risk] || RISK_META.none;
      const steps = visibleSteps
        .filter((step) => (riskByStep.get(stepKey(step)) || "none") === risk)
        .sort((a, b) => {
          const processCompare = String(a.process_name || a.process_node_id || "").localeCompare(
            String(b.process_name || b.process_node_id || ""),
          );
          if (processCompare !== 0) return processCompare;
          return String(a.step_name || a.step_id || "").localeCompare(String(b.step_name || b.step_id || ""));
        });
      return { risk, meta, steps };
    }).filter((section) => section.steps.length > 0);
  }, [riskByStep, visibleSteps]);

  const matrixStats = useMemo(() => {
    const riskCounts = { critical: 0, low: 0, none: 0, unassigned: 0 };
    (matrix?.risk || []).forEach((entry) => {
      const key = entry.risk || "none";
      riskCounts[key] = (riskCounts[key] || 0) + 1;
    });
    const assignedCells = (matrix?.cells || []).length;
    const totalSlots = Math.max(1, (matrix?.employees || []).length * (matrix?.steps || []).length);
    const coveragePct = Math.round((assignedCells / totalSlots) * 100);
    return {
      employees: (matrix?.employees || employees).length,
      steps: (matrix?.steps || []).length,
      assignedCells,
      coveragePct,
      riskCounts,
    };
  }, [employees, matrix]);

  const renderPeople = (people) => {
    if (!people?.length) return <span className="workforce-cell-empty">-</span>;
    return (
      <div className="workforce-people-list">
        {people.map((employee) => (
          <span key={employee.id} className="workforce-person-pill" title={`${employee.emp_no || ""} ${employee.name || ""}`}>
            <strong>{employee.emp_no}</strong>
            <span>{employee.name}</span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <section className="workforce-page">
      <div className="workforce-page__header workforce-page__header--dashboard">
        <div>
          <p className="wizard-dialog-kicker">Workforce</p>
          <h1>Matica zastupitelnosti</h1>
          <p className="workforce-page__subtitle">
            Rizikovy prehlad krokov, kde treba doplnit primarneho cloveka, zalohu alebo zacvik.
          </p>
        </div>
        <div className="workforce-page__actions">
          <button className="btn btn--small" type="button" onClick={refreshAll}>
            Obnovit
          </button>
          <Link className="btn btn--small" to="/">
            Spat na mapu
          </Link>
          <Link className="btn btn--small" to="/organization">
            Organizacia
          </Link>
        </div>
      </div>

      <div className="workforce-page__bar workforce-page__bar--dashboard">
        <label className="wizard-field workforce-page__org-select">
          <span>Aktivna organizacia</span>
          <select value={orgId} onChange={handleOrgChange} disabled={!orgs.length}>
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
        {activeOrg ? <span className="organization-chip">Rola: {activeOrg.role}</span> : null}
      </div>

      {loading ? <div className="app-shell-loading">Nacitavam workforce...</div> : null}
      {error ? <p className="auth-message auth-message--error">{error}</p> : null}

      {!loading && !orgId ? (
        <div className="auth-card workforce-page__empty">
          <h2>Nie je vybrana organizacia</h2>
          <p className="organization-hint">Najprv vytvor alebo vyber organizaciu.</p>
        </div>
      ) : null}

      {!loading && orgId ? (
        <>
          <div className="workforce-summary">
            <div className="workforce-stat">
              <span>Zamestnanci</span>
              <strong>{matrixStats.employees}</strong>
            </div>
            <div className="workforce-stat">
              <span>Procesne kroky</span>
              <strong>{matrixStats.steps}</strong>
            </div>
            <div className="workforce-stat">
              <span>Priradenia</span>
              <strong>{matrixStats.assignedCells}</strong>
            </div>
            <div className="workforce-stat">
              <span>Pokrytie</span>
              <strong>{matrixStats.coveragePct}%</strong>
            </div>
            <div className="workforce-stat is-critical">
              <span>Kriticke kroky</span>
              <strong>{matrixStats.riskCounts.critical || 0}</strong>
            </div>
          </div>

          <div className="workforce-tabs workforce-tabs--dashboard">
            <button className={tab === "matrix" ? "is-active" : ""} type="button" onClick={() => setTab("matrix")}>
              Rizikovy prehlad
            </button>
            <button className={tab === "employees" ? "is-active" : ""} type="button" onClick={() => setTab("employees")}>
              Zamestnanci
            </button>
          </div>

          {tab === "matrix" ? (
            <div className="workforce-matrix-layout">
              <aside className="workforce-side-panel">
                <div className="workforce-side-panel__section">
                  <h2>Filtre</h2>
                  <label className="wizard-field">
                    <span>Zamestnanec</span>
                    <input
                      value={employeeQuery}
                      onChange={(event) => setEmployeeQuery(event.target.value)}
                      placeholder="Meno, cislo, pozicia"
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Krok alebo proces</span>
                    <input
                      value={stepQuery}
                      onChange={(event) => setStepQuery(event.target.value)}
                      placeholder="task_ alebo node_"
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Proces</span>
                    <select value={processFilter} onChange={(event) => setProcessFilter(event.target.value)}>
                      <option value="all">Vsetky procesy</option>
                      {processOptions.map((process) => (
                        <option key={process.id} value={process.id}>
                          {process.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="wizard-field">
                    <span>Riziko</span>
                    <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
                      <option value="all">Vsetky urovne</option>
                      <option value="critical">Kriticke</option>
                      <option value="low">Slabe pokrytie</option>
                      <option value="none">Pokryte</option>
                      <option value="unassigned">Nepriradene</option>
                    </select>
                  </label>
                </div>

                <div className="workforce-side-panel__section">
                  <h2>Legenda</h2>
                  <div className="workforce-legend">
                    {Object.entries(LEVEL_META).map(([key, meta]) => (
                      <div key={key} className="workforce-legend__item">
                        <span className={`workforce-level-pill is-${meta.tone}`}>{meta.short}</span>
                        <span>{meta.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="workforce-legend workforce-legend--risk">
                    {Object.entries(RISK_META).map(([key, meta]) => (
                      <div key={key} className="workforce-legend__item">
                        <span className={`workforce-risk-dot is-${meta.tone}`}>{meta.short}</span>
                        <span>{meta.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>

              <div className="auth-card workforce-matrix-card workforce-matrix-card--dashboard">
                <div className="workforce-card-head">
                  <div>
                    <h2>Rizikovy prehlad zastupitelnosti</h2>
                    <p>{visibleSteps.length} krokov po filtroch, {visibleEmployees.length} zamestnancov v rozsahu</p>
                  </div>
                </div>
                {!matrix?.steps?.length ? (
                  <div className="workforce-empty-state">
                    <h3>Matica je prazdna</h3>
                    <p>Pridaj kompetencie cez overlay v procesnej mape. Tu sa potom automaticky zlozi celkovy prehlad.</p>
                  </div>
                ) : !visibleSteps.length || !visibleEmployees.length ? (
                  <div className="workforce-empty-state">
                    <h3>Ziadne vysledky pre filtre</h3>
                    <p>Uprav filtre alebo obnov data.</p>
                  </div>
                ) : (
                  <div className="workforce-coverage-list">
                    {riskSections.map((section) => (
                      <section key={section.risk} className={`workforce-process-group is-${section.meta.tone}`}>
                        <div className="workforce-process-group__head">
                          <h3>
                            <span className={`workforce-risk-dot is-${section.meta.tone}`}>{section.meta.short}</span>
                            {section.meta.label}
                          </h3>
                          <span>{section.steps.length} krokov</span>
                        </div>
                        <div className="workforce-coverage-header" aria-hidden="true">
                          <span>Proces / krok</span>
                          <span>Stav</span>
                          <span>Primarny</span>
                          <span>Zaloha</span>
                          <span>Zacvik</span>
                        </div>
                        {section.steps.map((step) => {
                          const key = stepKey(step);
                          const risk = riskByStep.get(key) || "none";
                          const riskMeta = RISK_META[risk] || RISK_META.none;
                          const assignments = assignmentsByStep.get(key) || { primary: [], backup: [], training: [] };
                          return (
                            <div key={key} className="workforce-coverage-row">
                              <div className="workforce-coverage-step-main">
                                <strong>{step.step_name || step.step_id}</strong>
                                <span>{step.process_name || step.process_node_id}</span>
                              </div>
                              <div className="workforce-coverage-risk">
                                <span>{riskMeta.label}</span>
                              </div>
                              <div>{renderPeople(assignments.primary)}</div>
                              <div>{renderPeople(assignments.backup)}</div>
                              <div>{renderPeople(assignments.training)}</div>
                            </div>
                          );
                        })}
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "employees" ? (
            <div className="workforce-grid workforce-grid--employees">
              <form className="auth-card workforce-form" onSubmit={handleSubmit}>
                <h2>{editId ? "Upravit zamestnanca" : "Pridat zamestnanca"}</h2>
                <label className="wizard-field">
                  <span>Cislo zamestnanca</span>
                  <input
                    value={form.emp_no}
                    onChange={(event) => setForm((prev) => ({ ...prev, emp_no: event.target.value }))}
                    placeholder="E001"
                    disabled={Boolean(editId)}
                    required
                  />
                </label>
                <label className="wizard-field">
                  <span>Meno</span>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Jana Novakova"
                    required
                  />
                </label>
                <label className="wizard-field">
                  <span>Pozicia</span>
                  <input
                    value={form.position}
                    onChange={(event) => setForm((prev) => ({ ...prev, position: event.target.value }))}
                    placeholder="Referentka"
                  />
                </label>
                <div className="workforce-form__actions">
                  <button className="btn btn-primary" type="submit" disabled={saving}>
                    {saving ? "Ukladam..." : editId ? "Ulozit zmeny" : "Pridat"}
                  </button>
                  {editId ? (
                    <button className="btn" type="button" onClick={resetForm}>
                      Zrusit
                    </button>
                  ) : null}
                </div>
              </form>

              <div className="auth-card workforce-table-card">
                <div className="organization-section-head">
                  <h2>Zamestnanci</h2>
                  <span className="organization-section-subtle">{employees.length} zaznamov</span>
                </div>
                <div className="organization-table-wrap">
                  <table className="wizard-models-table">
                    <thead>
                      <tr>
                        <th>Cislo</th>
                        <th>Meno</th>
                        <th>Pozicia</th>
                        <th>Akcie</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((employee) => (
                        <tr key={employee.id}>
                          <td>{employee.emp_no}</td>
                          <td>{employee.name}</td>
                          <td>{employee.position || "-"}</td>
                          <td>
                            {deleteConfirmId === employee.id ? (
                              <div className="organization-inline-actions">
                                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Naozaj zmazat?</span>
                                <button className="btn btn--small btn-danger" type="button" onClick={() => handleDeleteConfirm(employee)}>
                                  Ano
                                </button>
                                <button className="btn btn--small" type="button" onClick={() => setDeleteConfirmId("")}>
                                  Nie
                                </button>
                              </div>
                            ) : (
                              <div className="organization-inline-actions">
                                <button className="btn btn--small" type="button" onClick={() => handleEdit(employee)}>
                                  Upravit
                                </button>
                                <button className="btn btn--small btn-danger" type="button" onClick={() => setDeleteConfirmId(employee.id)}>
                                  Zmazat
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!employees.length ? (
                        <tr>
                          <td colSpan={4}>Zatial nie su pridani zamestnanci.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
