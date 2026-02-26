import { useEffect, useState } from "react";

import { getAdminModels, getAdminOrgs, getAdminUsers } from "../api/admin";
import "./AdminPanelPage.css";

const TABS = [
  { id: "users", label: "Users", loader: getAdminUsers },
  { id: "orgs", label: "Orgs", loader: getAdminOrgs },
  { id: "models", label: "Models", loader: getAdminModels },
];

function AdminPanelPage() {
  const [activeTab, setActiveTab] = useState("users");
  const [tabState, setTabState] = useState({
    users: { loading: false, error: "", count: 0, items: [] },
    orgs: { loading: false, error: "", count: 0, items: [] },
    models: { loading: false, error: "", count: 0, items: [] },
  });

  useEffect(() => {
    let cancelled = false;
    const current = tabState[activeTab];
    if (current.loading || current.error || current.items.length > 0) {
      return () => {
        cancelled = true;
      };
    }
    const tab = TABS.find((item) => item.id === activeTab);
    if (!tab) return () => {
      cancelled = true;
    };

    setTabState((prev) => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], loading: true, error: "" },
    }));

    const run = async () => {
      try {
        const result = await tab.loader();
        if (cancelled) return;
        setTabState((prev) => ({
          ...prev,
          [activeTab]: {
            loading: false,
            error: "",
            count: Number(result?.count || 0),
            items: Array.isArray(result?.items) ? result.items : [],
          },
        }));
      } catch (error) {
        if (cancelled) return;
        setTabState((prev) => ({
          ...prev,
          [activeTab]: {
            ...prev[activeTab],
            loading: false,
            error: error?.message || "Nepodarilo sa nacitat admin data.",
          },
        }));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const current = tabState[activeTab];

  return (
    <section className="admin-monitor">
      <header className="admin-monitor__header">
        <div>
          <h1>Admin Panel</h1>
          <p>Read-only monitoring. Dostupne len pre super admin allowlist (`SUPER_ADMIN_EMAILS`).</p>
        </div>
      </header>

      <div className="admin-monitor__tabs" role="tablist" aria-label="Admin tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`admin-monitor__tab ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            <span className="admin-monitor__tab-count">{tabState[tab.id].count}</span>
          </button>
        ))}
      </div>

      <section className="admin-monitor__panel" role="tabpanel">
        <div className="admin-monitor__panel-head">
          <h2>{TABS.find((tab) => tab.id === activeTab)?.label}</h2>
          <div className="admin-monitor__count">Count: {current.count}</div>
        </div>

        {current.loading ? <p className="admin-monitor__muted">Nacitam data...</p> : null}
        {!current.loading && current.error ? (
          <p className="admin-monitor__error">{current.error}</p>
        ) : null}
        {!current.loading && !current.error ? (
          <>
            {activeTab === "users" ? <UsersTable rows={current.items} /> : null}
            {activeTab === "orgs" ? <OrgsTable rows={current.items} /> : null}
            {activeTab === "models" ? <ModelsTable rows={current.items} /> : null}
          </>
        ) : null}
      </section>
    </section>
  );
}

function UsersTable({ rows }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Orgs</th>
            <th>Sessions</th>
            <th>Created</th>
            <th>Last login</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.id}>
                <td title={row.id}>{row.email}</td>
                <td>{row.role}</td>
                <td>{row.org_count ?? 0}</td>
                <td>{row.session_count ?? 0}</td>
                <td>{formatValue(row.created_at)}</td>
                <td>{formatValue(row.last_login_at)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="admin-table__empty">No users</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function OrgsTable({ rows }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th>Owners</th>
            <th>Models</th>
            <th>Created by</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row.id}>
                <td title={row.id}>{row.name}</td>
                <td>{row.member_count ?? 0}</td>
                <td>{row.owner_count ?? 0}</td>
                <td>{row.model_count ?? 0}</td>
                <td>{row.created_by_email || row.created_by_user_id || "-"}</td>
                <td>{formatValue(row.created_at)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="admin-table__empty">No orgs</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ModelsTable({ rows }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Org</th>
            <th>Updated</th>
            <th>Created</th>
            <th>ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={`${row.org_id}-${row.id}`}>
                <td>{row.name || "-"}</td>
                <td title={row.org_id}>{row.org_name || row.org_id || "-"}</td>
                <td>{formatValue(row.updated_at)}</td>
                <td>{formatValue(row.created_at)}</td>
                <td className="admin-table__mono">{row.id}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="admin-table__empty">No models</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatValue(value) {
  return value || "-";
}

export default AdminPanelPage;
