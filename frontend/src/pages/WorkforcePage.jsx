import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { createEmployee, deleteEmployee, getMatrix, updateEmployee } from "../api/workforce";
import { listMyOrgs } from "../api/wizard";
import WorkforceCoverage from "../components/WorkforceCoverage";

const EMPTY_FORM = { emp_no: "", name: "", position: "" };

function WorkforceWorkspace({ orgId }) {
  const { t } = useTranslation();
  const [matrix, setMatrix] = useState(null);
  const [tab, setTab] = useState("matrix");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const employees = matrix?.employees || [];

  const refreshMatrix = useCallback(async () => {
    const request = ++requestId.current;
    setRefreshing(true);
    setError("");
    try {
      const data = await getMatrix(orgId);
      if (request === requestId.current) setMatrix(data);
    } catch (err) {
      if (request === requestId.current) setError(err?.message || t("workforce.error_refresh_data"));
    } finally {
      if (request === requestId.current) setRefreshing(false);
    }
  }, [orgId, t]);

  useEffect(() => {
    void refreshMatrix();
    return () => { requestId.current += 1; };
  }, [refreshMatrix]);

  const resetForm = () => {
    setEditId("");
    setDeleteConfirmId("");
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (editId) {
        await updateEmployee(orgId, editId, { name: form.name, position: form.position });
      } else {
        await createEmployee(orgId, form);
      }
      resetForm();
      await refreshMatrix();
    } catch (err) {
      setError(err?.message || t("workforce.error_save_employee"));
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
    setDeleteConfirmId("");
    setError("");
    try {
      await deleteEmployee(orgId, employee.id);
      if (editId === employee.id) resetForm();
      await refreshMatrix();
    } catch (err) {
      setError(err?.message || t("workforce.error_delete_employee"));
    }
  };

  return (
    <>
      <div className="workforce-workspace-bar">
        <div className="workforce-tabs workforce-tabs--dashboard">
          <button className={tab === "matrix" ? "is-active" : ""} aria-pressed={tab === "matrix"} type="button" onClick={() => setTab("matrix")}>
            {t("workforce.tab_risk_overview")}
          </button>
          <button className={tab === "employees" ? "is-active" : ""} aria-pressed={tab === "employees"} type="button" onClick={() => setTab("employees")}>
            {t("workforce.tab_employees")}
          </button>
        </div>
        <button className="btn btn--small" type="button" onClick={refreshMatrix} disabled={refreshing}>
          {t("workforce.refresh")}
        </button>
      </div>
      {error ? <p className="auth-message auth-message--error" role="alert">{error}</p> : null}
      {refreshing && !matrix ? <div className="app-shell-loading" role="status">{t("workforce.loading")}</div> : null}
      {matrix ? (
        <div hidden={tab !== "matrix"}>
          <WorkforceCoverage matrix={matrix} orgId={orgId} onChanged={refreshMatrix} />
        </div>
      ) : null}
      {tab === "employees" && matrix ? (
        <div className="workforce-grid workforce-grid--employees">
          <form className="auth-card workforce-form" onSubmit={handleSubmit}>
            <h2>{editId ? t("workforce.edit_person") : t("workforce.add_person")}</h2>
            <label className="wizard-field">
              <span>{t("workforce.person_number")}</span>
              <input
                value={form.emp_no}
                onChange={(event) => setForm((prev) => ({ ...prev, emp_no: event.target.value }))}
                placeholder="E001"
                disabled={Boolean(editId)}
                required
              />
            </label>
            <label className="wizard-field">
              <span>{t("workforce.person_name")}</span>
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Jane Smith"
                required
              />
            </label>
            <label className="wizard-field">
              <span>{t("workforce.person_position")}</span>
              <input
                value={form.position}
                onChange={(event) => setForm((prev) => ({ ...prev, position: event.target.value }))}
                placeholder="Clerk"
              />
            </label>
            <div className="workforce-form__actions">
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? t("workforce.saving") : editId ? t("workforce.save_changes") : t("workforce.add")}
              </button>
              {editId ? (
                <button className="btn" type="button" onClick={resetForm}>
                  {t("workforce.cancel")}
                </button>
              ) : null}
            </div>
          </form>

          <div className="auth-card workforce-table-card">
            <div className="organization-section-head">
              <h2>{t("workforce.people_title")}</h2>
              <span className="organization-section-subtle">{t("workforce.records", { count: employees.length })}</span>
            </div>
            <div className="organization-table-wrap">
              <table className="wizard-models-table">
                <thead>
                  <tr>
                    <th>{t("workforce.col_number")}</th>
                    <th>{t("workforce.col_name")}</th>
                    <th>{t("workforce.col_position")}</th>
                    <th>{t("workforce.col_actions")}</th>
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
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("workforce.confirm_delete")}</span>
                            <button className="btn btn--small btn-danger" type="button" onClick={() => handleDeleteConfirm(employee)}>
                              {t("workforce.yes")}
                            </button>
                            <button className="btn btn--small" type="button" onClick={() => setDeleteConfirmId("")}>
                              {t("workforce.no")}
                            </button>
                          </div>
                        ) : (
                          <div className="organization-inline-actions">
                            <button className="btn btn--small" type="button" onClick={() => handleEdit(employee)}>
                              {t("workforce.edit")}
                            </button>
                            <button className="btn btn--small btn-danger" type="button" onClick={() => setDeleteConfirmId(employee.id)}>
                              {t("workforce.delete")}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!employees.length ? (
                    <tr>
                      <td colSpan={4}>{t("workforce.no_people")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function WorkforcePage() {
  const { t } = useTranslation();
  const [orgs, setOrgs] = useState(null);
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState(false);
  const activeOrg = orgs?.find((org) => org.id === orgId);

  useEffect(() => {
    let active = true;
    listMyOrgs().then((items) => {
      if (!active) return;
      const organizations = Array.isArray(items) ? items : [];
      const storedId = window.localStorage.getItem("ACTIVE_ORG_ID");
      setOrgs(organizations);
      setOrgId(organizations.find((org) => org.id === storedId)?.id || organizations[0]?.id || "");
    }).catch(() => {
      if (active) setError(true);
    });
    return () => { active = false; };
  }, []);

  const handleOrgChange = (event) => {
    const nextOrgId = event.target.value;
    const nextOrg = orgs.find((org) => org.id === nextOrgId);
    setOrgId(nextOrgId);
    window.localStorage.setItem("ACTIVE_ORG_ID", nextOrgId);
    window.localStorage.setItem("ACTIVE_ORG_NAME", nextOrg?.name || "");
    window.dispatchEvent(new Event("active-org-changed"));
  };

  return (
    <section className="workforce-page">
      <div className="workforce-page__header workforce-page__header--dashboard">
        <div>
          <p className="wizard-dialog-kicker">{t("workforce.kicker")}</p>
          <h1>{t("workforce.title")}</h1>
          <p className="workforce-page__subtitle">{t("workforce.subtitle")}</p>
        </div>
        <div className="workforce-page__actions">
          <Link className="btn btn--small" to="/">{t("workforce.back_to_map")}</Link>
          <Link className="btn btn--small" to="/organization">{t("workforce.organization")}</Link>
        </div>
      </div>

      {orgs?.length ? (
        <div className="workforce-page__bar workforce-page__bar--dashboard">
          <label className="wizard-field workforce-page__org-select">
            <span>{t("workforce.active_organization")}</span>
            <select value={orgId} onChange={handleOrgChange}>
              {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
          </label>
          {activeOrg ? <span className="organization-chip">{t("workforce.role", { role: activeOrg.role })}</span> : null}
        </div>
      ) : null}

      {!orgs && !error ? <div className="app-shell-loading" role="status">{t("workforce.loading")}</div> : null}
      {error ? <p className="auth-message auth-message--error" role="alert">{t("workforce.error_load_data")}</p> : null}
      {orgs && !orgId ? (
        <div className="auth-card workforce-page__empty">
          <h2>{t("workforce.no_org_title")}</h2>
          <p className="organization-hint">{t("workforce.no_org_hint")}</p>
        </div>
      ) : null}
      {orgId ? <WorkforceWorkspace key={orgId} orgId={orgId} /> : null}
    </section>
  );
}
