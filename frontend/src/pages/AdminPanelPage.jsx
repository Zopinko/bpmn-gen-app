import { useCallback, useEffect, useMemo, useState } from "react";

import { getAdminModels, getAdminOrgs, getAdminUsers } from "../api/admin";
import "./AdminPanelPage.css";

const TABS = [
  { id: "users", label: "Používatelia", loader: getAdminUsers },
  { id: "orgs", label: "Organizácie", loader: getAdminOrgs },
  { id: "models", label: "Modely", loader: getAdminModels },
];

const EMPTY_TAB = { loading: false, error: "", count: 0, items: [], loaded: false };
const RECENT_MODELS_LIMIT = 30;

function AdminPanelPage() {
  const [activeTab, setActiveTab] = useState("users");
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
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
      const rawMessage = error?.message || "Nepodarilo sa načítať admin dáta.";
      const hint =
        error?.status === 404
          ? " Admin API pravdepodobne nie je zapnuté alebo tvoj účet nie je v SUPER_ADMIN_EMAILS."
          : "";
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
  }, []);

  useEffect(() => {
    TABS.forEach((tab) => {
      void loadTab(tab.id);
    });
  }, [loadTab]);

  useEffect(() => {
    setSelectedItem(null);
    setSearch("");
  }, [activeTab]);

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
      { id: "users", label: "Používatelia", value: tabState.users.count },
      { id: "orgs", label: "Organizácie", value: tabState.orgs.count },
      { id: "models", label: "Modely", value: tabState.models.count },
      { id: "sessions", label: "Aktívne sessions", value: activeSessions },
      { id: "verified", label: "Overené účty", value: verifiedUsers },
    ];
  }, [tabState.models.count, tabState.orgs.count, tabState.users.count, tabState.users.items]);

  const currentLabel = TABS.find((tab) => tab.id === activeTab)?.label || "";
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
          <p>
            Prehľad ľudí, organizácií a modelov na jednom mieste. Panel je dostupný len pre super admin
            allowlist a dnes slúži hlavne na monitoring a rýchlu orientáciu.
          </p>
        </div>
      </header>

      <div className="admin-monitor__summary">
        {summary.map((item) => (
          <article key={item.id} className="admin-summary-card">
            <p className="admin-summary-card__label">{item.label}</p>
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
            {tab.label}
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
                Zobrazené: posledných {visibleModels.length} / {tabState.models.count}
              </div>
            ) : (
              <div className="admin-monitor__count">Count: {current.count}</div>
            )}
          </div>
          <div className="admin-monitor__tools">
            <input
              className="admin-monitor__search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={getSearchPlaceholder(activeTab)}
            />
            <button
              type="button"
              className="admin-monitor__refresh"
              onClick={() => void loadTab(activeTab, { force: true })}
              disabled={current.loading}
            >
              {current.loading ? "Načítavam..." : "Obnoviť"}
            </button>
          </div>
        </div>

        {current.loading ? <p className="admin-monitor__muted">Načítavam dáta...</p> : null}
        {!current.loading && current.error ? <p className="admin-monitor__error">{current.error}</p> : null}
        {!current.loading && !current.error ? (
          <div className="admin-monitor__content">
            <div className="admin-monitor__table-column">
              {activeTab === "users" ? (
                <UsersTable rows={filteredRows} onSelect={setSelectedItem} selectedItem={selectedItem} />
              ) : null}
              {activeTab === "orgs" ? (
                <OrgsTable rows={filteredRows} onSelect={setSelectedItem} selectedItem={selectedItem} />
              ) : null}
              {activeTab === "models" ? (
                <ModelsTable rows={filteredRows} onSelect={setSelectedItem} selectedItem={selectedItem} />
              ) : null}
            </div>
            <aside className="admin-detail">
              {selectedItem ? (
                <AdminDetailDrawer
                  activeTab={activeTab}
                  item={selectedItem}
                  relatedContext={relatedContext}
                  onClose={() => setSelectedItem(null)}
                />
              ) : (
                <div className="admin-detail__empty">
                  Klikni na riadok a otvorí sa detail s kontextom.
                </div>
              )}
            </aside>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function UsersTable({ rows, onSelect, selectedItem }) {
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
                Nenašli sa žiadni používatelia.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function OrgsTable({ rows, onSelect, selectedItem }) {
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
                Nenašli sa žiadne organizácie.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ModelsTable({ rows, onSelect, selectedItem }) {
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
                Nenašli sa žiadne modely.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AdminDetailDrawer({ activeTab, item, relatedContext, onClose }) {
  if (activeTab === "users") {
    return (
      <div className="admin-detail__card">
        <div className="admin-detail__head">
          <div>
            <div className="admin-detail__kicker">Používateľ</div>
            <h3>{item.email}</h3>
          </div>
          <button type="button" className="admin-detail__close" onClick={onClose}>
            Zavrieť
          </button>
        </div>
        <DetailList
          items={[
            ["Rola", item.role || "-"],
            ["Sessions", String(item.session_count ?? 0)],
            ["Vytvorený", formatDateTimeValue(item.created_at)],
            ["Posledné prihlásenie", formatDateTimeValue(item.last_login_at)],
            ["Overený email", item.email_verified_at ? "Áno" : "Nie"],
            ["User ID", item.id || "-"],
          ]}
        />
        <DetailPills
          title="Organizácie"
          items={(item.org_names || []).map((name) => ({ key: name, label: name }))}
          emptyLabel="Používateľ zatiaľ nie je v žiadnej organizácii."
        />
        <DetailPills
          title="Načítané organizácie z adminu"
          items={(relatedContext?.orgs || []).map((org) => ({
            key: org.id,
            label: `${org.name} · ${org.member_count ?? 0} členov`,
          }))}
          emptyLabel="K tejto osobe zatiaľ nemáme ďalší kontext."
        />
      </div>
    );
  }

  if (activeTab === "orgs") {
    return (
      <div className="admin-detail__card">
        <div className="admin-detail__head">
          <div>
            <div className="admin-detail__kicker">Organizácia</div>
            <h3>{item.name}</h3>
          </div>
          <button type="button" className="admin-detail__close" onClick={onClose}>
            Zavrieť
          </button>
        </div>
        <DetailList
          items={[
            ["Členovia", String(item.member_count ?? 0)],
            ["Owneri", String(item.owner_count ?? 0)],
            ["Modely", String(item.model_count ?? 0)],
            ["Vytvoril", item.created_by_email || item.created_by_user_id || "-"],
            ["Vytvorená", formatDateTimeValue(item.created_at)],
            ["Org ID", item.id || "-"],
          ]}
        />
        <DetailPills
          title="Načítané modely tejto organizácie"
          items={(relatedContext?.models || []).map((model) => ({
            key: model.id,
            label: model.name || model.id,
          }))}
          emptyLabel="K tejto organizácii sa v načítaných admin dátach zatiaľ nenašli modely."
        />
      </div>
    );
  }

  return (
    <div className="admin-detail__card">
      <div className="admin-detail__head">
        <div>
          <div className="admin-detail__kicker">Model</div>
          <h3>{item.name || item.id}</h3>
        </div>
        <button type="button" className="admin-detail__close" onClick={onClose}>
          Zavrieť
        </button>
      </div>
      <DetailList
        items={[
          ["Organizácia", item.org_name || item.org_id || "-"],
          ["Aktualizovaný", formatDateTimeValue(item.updated_at)],
          ["Vytvorený", formatDateTimeValue(item.created_at)],
          ["Model ID", item.id || "-"],
        ]}
      />
      <DetailPills
        title="Organizácia"
        items={(relatedContext?.orgs || []).map((org) => ({
          key: org.id,
          label: `${org.name} · ${org.member_count ?? 0} členov`,
        }))}
        emptyLabel="K modelu sa zatiaľ nenašiel ďalší org kontext."
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

function getSearchPlaceholder(tabId) {
  if (tabId === "users") return "Hľadať podľa e-mailu alebo organizácie";
  if (tabId === "orgs") return "Hľadať podľa názvu organizácie";
  return "Hľadať podľa názvu modelu alebo organizácie";
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
