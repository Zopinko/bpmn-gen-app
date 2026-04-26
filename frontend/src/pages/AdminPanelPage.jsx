import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { deleteAdminUser, getAdminModels, getAdminOrgs, getAdminUsers } from "../api/admin";
import "./AdminPanelPage.css";

const TABS = [
  { id: "users", loader: getAdminUsers },
  { id: "orgs", loader: getAdminOrgs },
  { id: "models", loader: getAdminModels },
];

const EMPTY_TAB = { loading: false, error: "", count: 0, items: [], loaded: false };
const RECENT_MODELS_LIMIT = 30;

function AdminPanelPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("users");
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [deleteState, setDeleteState] = useState({ busy: false, error: "" });
  const [tabState, setTabState] = useState({
    users: { ...EMPTY_TAB },
    orgs: { ...EMPTY_TAB },
    models: { ...EMPTY_TAB },
  });

  const loadTab = useCallback(async (tabId, { force = false } = {}) => {
    const tab = TABS.find((item) => item.id === tabId);
    if (!tab) return;

    let shouldLoad = true;
    setTabState((prev) => {
      const current = prev[tabId];
      if (current.loading || (!force && current.loaded)) {
        shouldLoad = false;
        return prev;
      }
      return {
        ...prev,
        [tabId]: {
          ...current,
          loading: true,
          error: "",
        },
      };
    });

    if (!shouldLoad) return;

    try {
      const result = await tab.loader();
      setTabState((prev) => ({
        ...prev,
        [tabId]: {
          loading: false,
          error: "",
          count: Number(result?.count || 0),
          items: Array.isArray(result?.items) ? result.items : [],
          loaded: true,
        },
      }));
    } catch (error) {
      const rawMessage = error?.message || t("admin.error_load");
      const hint = error?.status === 404 ? t("admin.error_api_hint") : "";
      setTabState((prev) => ({
        ...prev,
        [tabId]: {
          ...prev[tabId],
          loading: false,
          error: `${rawMessage}${hint}`,
          loaded: true,
        },
      }));
    }
  }, [t]);

  useEffect(() => {
    TABS.forEach((tab) => {
      void loadTab(tab.id);
    });
  }, [loadTab]);

  useEffect(() => {
    setSelectedItem(null);
    setSearch("");
    setDeleteState({ busy: false, error: "" });
  }, [activeTab]);

  const handleDeleteUser = useCallback(async (item) => {
    if (!item?.id || deleteState.busy) return;
    const confirmed = window.confirm(t("admin.delete_confirm", { email: item.email || "-" }));
    if (!confirmed) return;

    setDeleteState({ busy: true, error: "" });
    try {
      await deleteAdminUser(item.id);
      setSelectedItem(null);
      setDeleteState({ busy: false, error: "" });
      await Promise.all([
        loadTab("users", { force: true }),
        loadTab("orgs", { force: true }),
      ]);
    } catch (error) {
      setDeleteState({
        busy: false,
        error: error?.message || t("admin.delete_error"),
      });
    }
  }, [deleteState.busy, loadTab, t]);

  const current = tabState[activeTab];
  const visibleModels = useMemo(() => {
    return tabState.models.items.slice(0, RECENT_MODELS_LIMIT);
  }, [tabState.models.items]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const baseRows = activeTab === "models" ? visibleModels : current.items;
    if (!needle) return baseRows;
    return baseRows.filter((row) => matchRow(activeTab, row, needle));
  }, [activeTab, current.items, search, visibleModels]);

  const summary = useMemo(() => {
    const activeSessions = tabState.users.items.reduce((sum, row) => sum + Number(row?.session_count || 0), 0);
    const verifiedUsers = tabState.users.items.filter((row) => Boolean(row?.email_verified_at)).length;
    return [
      { id: "users", value: tabState.users.count },
      { id: "orgs", value: tabState.orgs.count },
      { id: "models", value: tabState.models.count },
      { id: "sessions", value: activeSessions },
      { id: "verified", value: verifiedUsers },
    ];
  }, [tabState.models.count, tabState.orgs.count, tabState.users.count, tabState.users.items]);

  const currentLabel = t(`admin.tab_${activeTab}`);

  const relatedContext = useMemo(() => {
    if (!selectedItem) return null;
    if (activeTab === "users") {
      return {
        orgs: tabState.orgs.items.filter((org) => (selectedItem.org_names || []).includes(org.name)),
        models: [],
      };
    }
    if (activeTab === "orgs") {
      return {
        orgs: [],
        models: tabState.models.items.filter((model) => String(model.org_id || "") === String(selectedItem.id || "")),
      };
    }
    return {
      orgs: tabState.orgs.items.filter((org) => String(org.id || "") === String(selectedItem.org_id || "")),
      models: [],
    };
  }, [activeTab, selectedItem, tabState.models.items, tabState.orgs.items]);

  return (
    <section className="admin-monitor">
      <header className="admin-monitor__header">
        <div>
          <h1>Admin panel</h1>
          <p>{t("admin.intro")}</p>
        </div>
      </header>

      <div className="admin-monitor__summary">
        {summary.map((item) => (
          <article key={item.id} className="admin-summary-card">
            <p className="admin-summary-card__label">{t(`admin.summary_${item.id}`)}</p>
            <p className="admin-summary-card__value">{item.value}</p>
          </article>
        ))}
      </div>

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
            {t(`admin.tab_${tab.id}`)}
            <span className="admin-monitor__tab-count">{tabState[tab.id].count}</span>
          </button>
        ))}
      </div>

      <section className="admin-monitor__panel" role="tabpanel">
        <div className="admin-monitor__panel-head">
          <div>
            <h2>{currentLabel}</h2>
            {activeTab === "models" && tabState.models.count > visibleModels.length ? (
              <div className="admin-monitor__count">
                {t("admin.count_recent", { shown: visibleModels.length, total: tabState.models.count })}
              </div>
            ) : (
              <div className="admin-monitor__count">{t("admin.count_all", { count: current.count })}</div>
            )}
          </div>
          <div className="admin-monitor__tools">
            <input
              className="admin-monitor__search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(`admin.search_${activeTab}`)}
            />
            <button
              type="button"
              className="admin-monitor__refresh"
              onClick={() => void loadTab(activeTab, { force: true })}
              disabled={current.loading}
            >
              {current.loading ? t("admin.loading") : t("admin.refresh")}
            </button>
          </div>
        </div>

        {current.loading ? <p className="admin-monitor__muted">{t("admin.loading_data")}</p> : null}
        {!current.loading && current.error ? <p className="admin-monitor__error">{current.error}</p> : null}
        {!current.loading && !current.error ? (
          <div className="admin-monitor__content">
            <div className="admin-monitor__table-column">
              {activeTab === "users" ? (
                <UsersTable rows={filteredRows} onSelect={setSelectedItem} selectedItem={selectedItem} t={t} />
              ) : null}
              {activeTab === "orgs" ? (
                <OrgsTable rows={filteredRows} onSelect={setSelectedItem} selectedItem={selectedItem} t={t} />
              ) : null}
              {activeTab === "models" ? (
                <ModelsTable rows={filteredRows} onSelect={setSelectedItem} selectedItem={selectedItem} t={t} />
              ) : null}
            </div>
            <aside className="admin-detail">
              {selectedItem ? (
                <AdminDetailDrawer
                  activeTab={activeTab}
                  item={selectedItem}
                  relatedContext={relatedContext}
                  deleteState={deleteState}
                  onClose={() => setSelectedItem(null)}
                  onDeleteUser={handleDeleteUser}
                  t={t}
                />
              ) : (
                <div className="admin-detail__empty">
                  {t("admin.empty_detail")}
                </div>
              )}
            </aside>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function UsersTable({ rows, onSelect, selectedItem, t }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Organizations</th>
            <th>Sessions</th>
            <th>Created</th>
            <th>Last login</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr
                key={row.id}
                className={selectedItem?.id === row.id ? "is-selected" : ""}
                onClick={() => onSelect(row)}
              >
                <td title={row.id}>{row.email}</td>
                <td>{row.role}</td>
                <td title={(row.org_names || []).join(", ") || "-"}>{formatOrgContext(row)}</td>
                <td>{row.session_count ?? 0}</td>
                <td>{formatDateTimeValue(row.created_at)}</td>
                <td>{formatDateTimeValue(row.last_login_at)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="admin-table__empty">
                {t("admin.empty_users")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function OrgsTable({ rows, onSelect, selectedItem, t }) {
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
              <tr
                key={row.id}
                className={selectedItem?.id === row.id ? "is-selected" : ""}
                onClick={() => onSelect(row)}
              >
                <td title={row.id}>{row.name}</td>
                <td>{row.member_count ?? 0}</td>
                <td>{row.owner_count ?? 0}</td>
                <td>{row.model_count ?? 0}</td>
                <td>{row.created_by_email || row.created_by_user_id || "-"}</td>
                <td>{formatDateTimeValue(row.created_at)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="admin-table__empty">
                {t("admin.empty_orgs")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ModelsTable({ rows, onSelect, selectedItem, t }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table admin-table--models">
        <thead>
          <tr>
            <th>Model</th>
            <th>Org</th>
            <th>Updated</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr
                key={`${row.org_id}-${row.id}`}
                className={selectedItem?.id === row.id ? "is-selected" : ""}
                onClick={() => onSelect(row)}
              >
                <td>{row.name || "-"}</td>
                <td title={row.org_id}>{row.org_name || row.org_id || "-"}</td>
                <td>{formatDateTimeValue(row.updated_at)}</td>
                <td>{formatDateTimeValue(row.created_at)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="admin-table__empty">
                {t("admin.empty_models")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AdminDetailDrawer({ activeTab, item, relatedContext, onClose, onDeleteUser, deleteState, t }) {
  if (activeTab === "users") {
    return (
      <div className="admin-detail__card">
        <div className="admin-detail__head">
          <div>
            <div className="admin-detail__kicker">{t("admin.kicker_user")}</div>
            <h3>{item.email}</h3>
          </div>
          <button type="button" className="admin-detail__close" onClick={onClose}>
            {t("admin.close")}
          </button>
        </div>
        <DetailList
          items={[
            [t("admin.detail_role"), item.role || "-"],
            [t("admin.detail_sessions"), String(item.session_count ?? 0)],
            [t("admin.detail_created"), formatDateTimeValue(item.created_at)],
            [t("admin.detail_last_login"), formatDateTimeValue(item.last_login_at)],
            [t("admin.detail_verified"), item.email_verified_at ? t("admin.yes") : t("admin.no")],
            [t("admin.detail_created_orgs"), String(item.created_org_count ?? 0)],
            [t("admin.detail_user_id"), item.id || "-"],
          ]}
        />
        {deleteState?.error ? <p className="admin-detail__error">{deleteState.error}</p> : null}
        <div className="admin-detail__actions">
          <button
            type="button"
            className="admin-detail__danger"
            onClick={() => void onDeleteUser(item)}
            disabled={deleteState?.busy}
          >
            {deleteState?.busy ? t("admin.delete_busy") : t("admin.delete_user")}
          </button>
        </div>
        <DetailPills
          title={t("admin.pills_orgs")}
          items={(item.org_names || []).map((name) => ({ key: name, label: name }))}
          emptyLabel={t("admin.pills_user_empty")}
        />
        <DetailPills
          title={t("admin.pills_admin_orgs")}
          items={(relatedContext?.orgs || []).map((org) => ({
            key: org.id,
            label: `${org.name} · ${org.member_count ?? 0} členov`,
          }))}
          emptyLabel={t("admin.pills_user_context_empty")}
        />
      </div>
    );
  }

  if (activeTab === "orgs") {
    return (
      <div className="admin-detail__card">
        <div className="admin-detail__head">
          <div>
            <div className="admin-detail__kicker">{t("admin.kicker_org")}</div>
            <h3>{item.name}</h3>
          </div>
          <button type="button" className="admin-detail__close" onClick={onClose}>
            {t("admin.close")}
          </button>
        </div>
        <DetailList
          items={[
            [t("admin.detail_members"), String(item.member_count ?? 0)],
            [t("admin.detail_owners"), String(item.owner_count ?? 0)],
            [t("admin.detail_models"), String(item.model_count ?? 0)],
            [t("admin.detail_created_by"), item.created_by_email || item.created_by_user_id || "-"],
            [t("admin.detail_created_f"), formatDateTimeValue(item.created_at)],
            [t("admin.detail_org_id"), item.id || "-"],
          ]}
        />
        <DetailPills
          title={t("admin.pills_org_models")}
          items={(relatedContext?.models || []).map((model) => ({
            key: model.id,
            label: model.name || model.id,
          }))}
          emptyLabel={t("admin.pills_org_models_empty")}
        />
      </div>
    );
  }

  return (
    <div className="admin-detail__card">
      <div className="admin-detail__head">
        <div>
          <div className="admin-detail__kicker">{t("admin.kicker_model")}</div>
          <h3>{item.name || item.id}</h3>
        </div>
        <button type="button" className="admin-detail__close" onClick={onClose}>
          {t("admin.close")}
        </button>
      </div>
      <DetailList
        items={[
          [t("admin.detail_org"), item.org_name || item.org_id || "-"],
          [t("admin.detail_updated"), formatDateTimeValue(item.updated_at)],
          [t("admin.detail_created"), formatDateTimeValue(item.created_at)],
          [t("admin.detail_model_id"), item.id || "-"],
        ]}
      />
      <DetailPills
        title={t("admin.pills_model_org")}
        items={(relatedContext?.orgs || []).map((org) => ({
          key: org.id,
          label: `${org.name} · ${org.member_count ?? 0} členov`,
        }))}
        emptyLabel={t("admin.pills_model_empty")}
      />
    </div>
  );
}

function DetailList({ items }) {
  return (
    <div className="admin-detail__list">
      {items.map(([label, value]) => (
        <div key={label} className="admin-detail__list-row">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function DetailPills({ title, items, emptyLabel }) {
  return (
    <div className="admin-detail__block">
      <div className="admin-detail__block-title">{title}</div>
      {items.length ? (
        <div className="admin-detail__pills">
          {items.map((item) => (
            <span key={item.key} className="admin-detail__pill">
              {item.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="admin-detail__empty-note">{emptyLabel}</div>
      )}
    </div>
  );
}

function matchRow(tabId, row, needle) {
  if (tabId === "users") {
    return [row.email, row.role, ...(row.org_names || [])].some((value) =>
      String(value || "").toLowerCase().includes(needle),
    );
  }
  if (tabId === "orgs") {
    return [row.name, row.created_by_email, row.created_by_user_id].some((value) =>
      String(value || "").toLowerCase().includes(needle),
    );
  }
  return [row.name, row.org_name, row.org_id].some((value) => String(value || "").toLowerCase().includes(needle));
}

function formatOrgContext(row) {
  const names = Array.isArray(row?.org_names)
    ? row.org_names.filter((name) => typeof name === "string" && name.trim())
    : [];
  if (!names.length) return "-";
  if (names.length <= 2) return names.join(", ");
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

function formatDateTimeValue(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("sk-SK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export default AdminPanelPage;
