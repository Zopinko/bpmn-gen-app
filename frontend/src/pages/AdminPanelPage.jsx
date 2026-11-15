import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { deleteAdminUser, getAdminFeedback, getAdminModels, getAdminOrgs, getAdminUsers, updateAdminFeedbackStatus } from "../api/admin";
import "./AdminPanelPage.css";

const TABS = [
  { id: "users", loader: getAdminUsers },
  { id: "orgs", loader: getAdminOrgs },
  { id: "models", loader: getAdminModels },
  { id: "feedback", loader: getAdminFeedback },
];

const EMPTY_TAB = { loading: false, error: "", count: 0, items: [], loaded: false };
const RECENT_MODELS_LIMIT = 30;

function AdminPanelPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("users");
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const userDetailTrigger = useRef(null);
  const userDetailHeading = useRef(null);
  const selectedUserId = activeTab === "users" ? selectedItem?.id : null;
  const [deleteState, setDeleteState] = useState({ busy: false, error: "" });
  const [feedbackUpdate, setFeedbackUpdate] = useState(null);
  const [tabState, setTabState] = useState({
    users: { ...EMPTY_TAB },
    orgs: { ...EMPTY_TAB },
    models: { ...EMPTY_TAB },
    feedback: { ...EMPTY_TAB },
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

  useEffect(() => {
    if (selectedUserId) userDetailHeading.current?.focus();
  }, [selectedUserId]);

  function selectUser(item, trigger) {
    userDetailTrigger.current = trigger;
    setDeleteState({ busy: false, error: "" });
    setSelectedItem(item);
  }

  function closeDetail() {
    setSelectedItem(null);
    if (activeTab === "users") userDetailTrigger.current?.focus();
  }

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
  const openFeedbackCount = tabState.feedback.items.filter((item) => !item.resolved).length;
  const detailItem = activeTab === "feedback"
    ? current.items.find((item) => item.id === selectedItem?.id)
    : selectedItem;

  async function changeFeedbackStatus(item) {
    if (feedbackUpdate?.busy) return;
    setFeedbackUpdate({ id: item.id, busy: true });
    try {
      const updated = await updateAdminFeedbackStatus(item.id, !item.resolved);
      setTabState((previous) => ({
        ...previous,
        feedback: {
          ...previous.feedback,
          items: previous.feedback.items.map((row) =>
            row.id === updated.id ? { ...row, resolved: updated.resolved } : row,
          ),
        },
      }));
      setFeedbackUpdate(null);
    } catch {
      setFeedbackUpdate({ id: item.id, busy: false, error: t("admin.feedback_update_error") });
    }
  }
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
    const users = tabState.users;
    const activeSessions = users.items.reduce((sum, row) => sum + Number(row?.session_count || 0), 0);
    const verifiedUsers = users.items.filter((row) => Boolean(row?.email_verified_at)).length;
    const hasSandboxCounts = users.loaded && !users.error &&
      users.items.every((row) => Number.isInteger(row.sandbox_model_count));
    const orgs = tabState.orgs;
    const orgsWithModels = orgs.items.filter((org) => Number(org.model_count) > 0).length;
    return [
      { id: "users", value: users.count },
      { id: "orgs", value: orgs.count },
      {
        id: "orgs_with_models",
        value: orgs.loaded && !orgs.error
          ? t("admin.summary_orgs_with_models_value", { count: orgsWithModels, total: orgs.count })
          : "—",
      },
      { id: "models", value: tabState.models.count },
      {
        id: "sandbox_models",
        value: hasSandboxCounts
          ? users.items.reduce((sum, row) => sum + row.sandbox_model_count, 0)
          : "—",
      },
      { id: "feedback", value: tabState.feedback.count },
      { id: "sessions", value: activeSessions },
      { id: "verified", value: verifiedUsers },
    ];
  }, [t, tabState.feedback.count, tabState.models.count, tabState.orgs, tabState.users]);

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
          <h1>{t("admin.title")}</h1>
          <p>{t("admin.intro")}</p>
        </div>
        <button type="button" className="admin-monitor__back" onClick={() => navigate("/")}>
          <span aria-hidden="true">←</span> {t("admin.mfa.back")}
        </button>
      </header>

      <div className="admin-monitor__summary">
        {summary.map((item) => (
          <article key={item.id} className="admin-summary-card">
            <p className="admin-summary-card__label">{t(`admin.summary_${item.id}`)}</p>
            <p className="admin-summary-card__value">{item.value}</p>
          </article>
        ))}
      </div>

      <div className="admin-monitor__tabs" role="tablist" aria-label={t("admin.title")}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`admin-monitor__tab ${activeTab === tab.id ? "is-active" : ""} ${tab.id === "feedback" && openFeedbackCount > 0 ? "has-alert" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {t(`admin.tab_${tab.id}`)}
            {tab.id === "feedback" ? (
              openFeedbackCount > 0 && (
                <span className="admin-monitor__tab-alert" aria-label={t("admin.feedback_open_count", { count: openFeedbackCount })}>
                  {openFeedbackCount}
                </span>
              )
            ) : (
              <span className="admin-monitor__tab-count">{tabState[tab.id].count}</span>
            )}
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
              <div className="admin-monitor__count" aria-live="polite">
                {search.trim()
                  ? t("admin.count_filtered", { shown: filteredRows.length, total: current.count })
                  : t("admin.count_all", { count: current.count })}
              </div>
            )}
          </div>
          <div className="admin-monitor__tools">
            <input
              className="admin-monitor__search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t(`admin.search_${activeTab}`)}
              placeholder={t(`admin.search_${activeTab}`)}
            />
            <button
              type="button"
              className="admin-monitor__refresh"
              onClick={() => void loadTab(activeTab, { force: true })}
              disabled={current.loading || (activeTab === "feedback" && feedbackUpdate?.busy)}
            >
              {current.loading ? t("admin.loading") : t("admin.refresh")}
            </button>
          </div>
        </div>

        {current.loading ? <p className="admin-monitor__muted">{t("admin.loading_data")}</p> : null}
        {!current.loading && current.error ? <p className="admin-monitor__error">{current.error}</p> : null}
        {!current.loading && !current.error ? (
          <div className={`admin-monitor__content ${activeTab === "users" ? "admin-monitor__content--users" : ""} ${detailItem ? "has-detail" : ""}`}>
            <div className="admin-monitor__table-column">
              {activeTab === "users" ? (
                <UsersTable rows={filteredRows} onSelect={selectUser} selectedId={selectedUserId}
                  detailBusy={deleteState.busy} locale={i18n.resolvedLanguage} t={t} />
              ) : null}
              {activeTab === "orgs" ? (
                <OrgsTable rows={filteredRows} onSelect={setSelectedItem} selectedItem={selectedItem} t={t} />
              ) : null}
              {activeTab === "models" ? (
                <ModelsTable rows={filteredRows} onSelect={setSelectedItem} selectedItem={selectedItem} t={t} />
              ) : null}
              {activeTab === "feedback" ? (
                <FeedbackTable rows={filteredRows} onSelect={setSelectedItem} selectedItem={detailItem}
                  locale={i18n.resolvedLanguage} t={t} />
              ) : null}
            </div>
            {detailItem || activeTab !== "users" ? <aside className="admin-detail" id="admin-item-detail">
              {detailItem ? (
                <AdminDetailDrawer
                  activeTab={activeTab}
                  item={detailItem}
                  relatedContext={relatedContext}
                  deleteState={deleteState}
                  onClose={closeDetail}
                  userDetailHeading={userDetailHeading}
                  locale={i18n.resolvedLanguage}
                  onDeleteUser={handleDeleteUser}
                  onChangeFeedbackStatus={changeFeedbackStatus}
                  feedbackUpdate={feedbackUpdate}
                  t={t}
                />
              ) : (
                <div className="admin-detail__empty">
                  {t("admin.empty_detail")}
                </div>
              )}
            </aside> : null}
          </div>
        ) : null}
      </section>
    </section>
  );
}

function UsersTable({ rows, onSelect, selectedId, detailBusy, locale, t }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table admin-table--users">
        <thead>
          <tr>
            <th scope="col">{t("admin.kicker_user")}</th>
            <th scope="col" className="admin-table__secondary">{t("admin.detail_role")}</th>
            <th scope="col" className="admin-table__secondary">{t("admin.tab_orgs")}</th>
            <th scope="col" className="admin-table__secondary">{t("admin.detail_sessions")}</th>
            <th scope="col" className="admin-table__last-login">{t("admin.detail_last_login")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr
                key={row.id}
                className={selectedId === row.id ? "is-selected" : ""}
                onClick={(event) => {
                  if (!detailBusy && !event.target.closest("button")) {
                    onSelect(row, event.currentTarget.querySelector("button"));
                  }
                }}
              >
                <td>
                  <div className="admin-user-account">
                    <button className="admin-user-account__link" type="button"
                      aria-expanded={selectedId === row.id}
                      aria-controls={selectedId === row.id ? "admin-item-detail" : undefined}
                      disabled={detailBusy}
                      onClick={(event) => onSelect(row, event.currentTarget)}>
                      {row.email}
                    </button>
                    <span className={`admin-user-account__status ${row.email_verified_at ? "is-verified" : ""}`}>
                      {t(row.email_verified_at ? "admin.email_verified" : "admin.email_unverified")}
                    </span>
                  </div>
                </td>
                <td className="admin-table__secondary">{formatUserRole(row.role, t)}</td>
                <td className="admin-table__secondary" title={(row.org_names || []).join(", ")}>{formatOrgContext(row)}</td>
                <td className="admin-table__secondary">{row.session_count ?? 0}</td>
                <td className="admin-table__last-login">
                  {row.last_login_at ? formatDateTimeValue(row.last_login_at, locale) : t("admin.never_logged_in")}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="admin-table__empty">
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

function FeedbackTable({ rows, onSelect, selectedItem, locale, t }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table admin-table--feedback">
        <thead>
          <tr>
            <th scope="col">{t("admin.kicker_user")}</th>
            <th scope="col">{t("admin.feedback_message")}</th>
            <th scope="col">{t("admin.feedback_page")}</th>
            <th scope="col">{t("admin.feedback_sent")}</th>
            <th scope="col">{t("admin.feedback_status")}</th>
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
                <td>
                  <button type="button" className="admin-user-account__link" aria-expanded={selectedItem?.id === row.id}>
                    {row.user_email || row.user_id || "—"}
                  </button>
                </td>
                <td className="admin-table__message-preview">{row.message ? row.message.slice(0, 120) : "-"}</td>
                <td className="admin-table__page">{row.page || "-"}</td>
                <td>{formatDateTimeValue(row.created_at, locale)}</td>
                <td><FeedbackStatus resolved={row.resolved} t={t} /></td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="admin-table__empty">
                {t("admin.feedback_empty")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function FeedbackStatus({ resolved, t }) {
  return <span className={`admin-user-account__status ${resolved ? "is-verified" : ""}`}>
    {t(resolved ? "admin.feedback_resolved" : "admin.feedback_open")}
  </span>;
}

function AdminDetailDrawer({ activeTab, item, relatedContext, onClose, onDeleteUser, deleteState,
  onChangeFeedbackStatus, feedbackUpdate, userDetailHeading, locale, t }) {
  if (activeTab === "users") {
    return (
      <div className="admin-detail__card">
        <div className="admin-detail__head">
          <div>
            <div className="admin-detail__kicker">{t("admin.kicker_user")}</div>
            <h3 ref={userDetailHeading} tabIndex={-1}>{item.email}</h3>
          </div>
          <button type="button" className="admin-detail__close" onClick={onClose}>
            {t("admin.close")}
          </button>
        </div>
        <DetailList
          items={[
            [t("admin.detail_role"), formatUserRole(item.role, t)],
            [t("admin.detail_sessions"), String(item.session_count ?? 0)],
            [t("admin.summary_sandbox_models"), item.sandbox_model_count ?? "—"],
            [t("admin.detail_created"), formatDateTimeValue(item.created_at, locale)],
            [t("admin.detail_last_login"), item.last_login_at ? formatDateTimeValue(item.last_login_at, locale) : t("admin.never_logged_in")],
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

  if (activeTab === "feedback") {
    return (
      <div className="admin-detail__card">
        <div className="admin-detail__head">
          <div>
            <div className="admin-detail__kicker">{t("admin.tab_feedback")}</div>
            <h3>{item.user_email || item.user_id || "-"}</h3>
          </div>
          <button type="button" className="admin-detail__close" onClick={onClose}>
            {t("admin.close")}
          </button>
        </div>
        <DetailList
          items={[
            [t("admin.feedback_page"), item.page || "—"],
            [t("admin.feedback_sent"), formatDateTimeValue(item.created_at, locale)],
            [t("admin.feedback_status"), <FeedbackStatus resolved={item.resolved} t={t} />],
          ]}
        />
        <div className="admin-detail__block">
          <div className="admin-detail__block-title">{t("admin.feedback_message")}</div>
          <p className="admin-detail__feedback-body">{item.message || "-"}</p>
        </div>
        {feedbackUpdate?.id === item.id && feedbackUpdate.error ? (
          <p className="admin-detail__error" role="alert">{feedbackUpdate.error}</p>
        ) : null}
        <div className="admin-detail__actions">
          <button type="button" className="admin-monitor__refresh" disabled={feedbackUpdate?.busy}
            onClick={() => void onChangeFeedbackStatus(item)}>
            {t(item.resolved ? "admin.feedback_reopen" : "admin.feedback_mark_resolved")}
          </button>
        </div>
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
  if (tabId === "feedback") {
    return [row.user_email, row.message, row.page].some((value) =>
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

function formatUserRole(role, t) {
  return ["user", "admin", "super_admin", "superadmin"].includes(role)
    ? t(`admin.role_${role === "superadmin" ? "super_admin" : role}`)
    : role || "–";
}

function formatDateTimeValue(value, locale = "sk-SK") {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export default AdminPanelPage;
