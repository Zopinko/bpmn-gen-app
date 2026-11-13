import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listOrgModels, listWizardModels } from "../api/wizard";
import { getMatrix } from "../api/workforce";
import WorkspaceIcon from "./WorkspaceIcon";

const countRoles = (roles) =>
  String(roles || "")
    .split(/\n|,/)
    .map((r) => r.trim())
    .filter(Boolean).length;

const toTime = (value) => {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
};

function useRelativeTime(language) {
  return useMemo(() => {
    let rtf = null;
    try {
      rtf = new Intl.RelativeTimeFormat(language || "sk", { numeric: "auto" });
    } catch {
      rtf = null;
    }
    const dateFmt = new Intl.DateTimeFormat(language || "sk", { day: "numeric", month: "numeric" });
    return (value) => {
      const time = toTime(value);
      if (!time) return "—";
      const diff = (time - Date.now()) / 1000;
      const abs = Math.abs(diff);
      if (!rtf) return dateFmt.format(time);
      if (abs < 60) return rtf.format(Math.round(diff), "second");
      if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
      if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
      return dateFmt.format(time);
    };
  }, [language]);
}

/**
 * Home screen shown when no model is open: start a process (blank or from a
 * template), continue a recent model, and see what needs attention in the team.
 */
export default function StartDashboard({
  activeOrgId,
  activeOrgName,
  templates = [],
  notesCount = 0,
  pendingCount = 0,
  onNewBlank,
  onTemplate,
  onImport,
  onOpenModel,
  onShowAllModels,
  onOpenNotes,
  onOpenActivity,
  onOpenOrgModel,
  onOpenOrganization,
  onOpenWorkforce,
}) {
  const { t, i18n } = useTranslation();
  const relative = useRelativeTime(i18n.language);
  const [models, setModels] = useState({ loading: true, error: "", items: [] });
  const [orgProcessCount, setOrgProcessCount] = useState(null);
  const [uncoveredSteps, setUncoveredSteps] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listWizardModels({ limit: 50, offset: 0 })
      .then((resp) => {
        if (cancelled) return;
        const items = Array.isArray(resp?.items) ? resp.items : [];
        // one row per model name, newest version first
        const byName = new Map();
        items
          .slice()
          .sort((a, b) => toTime(b.updated_at) - toTime(a.updated_at))
          .forEach((item) => {
            const key = String(item?.name || item?.id || "").trim().toLowerCase();
            if (key && !byName.has(key)) byName.set(key, item);
          });
        setModels({ loading: false, error: "", items: [...byName.values()].slice(0, 6) });
      })
      .catch((e) => {
        if (!cancelled) setModels({ loading: false, error: e?.message || "error", items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeOrgId) {
      setOrgProcessCount(null);
      setUncoveredSteps(null);
      return undefined;
    }
    let cancelled = false;
    listOrgModels(activeOrgId)
      .then((resp) => {
        if (cancelled) return;
        const items = Array.isArray(resp) ? resp : Array.isArray(resp?.items) ? resp.items : [];
        const keys = new Set(items.map((m) => String(m?.tree_node_id || m?.name || m?.id || "")).filter(Boolean));
        setOrgProcessCount(keys.size);
      })
      .catch(() => !cancelled && setOrgProcessCount(null));
    getMatrix(activeOrgId)
      .then((matrix) => {
        if (cancelled) return;
        const steps = Array.isArray(matrix?.steps) ? matrix.steps : [];
        const risks = Array.isArray(matrix?.risk) ? matrix.risk : [];
        const key = (s) => `${s?.process_node_id || ""}::${s?.step_id || s?.id || ""}`;
        const riskByKey = new Map(risks.map((r) => [key(r), r?.risk]));
        const uncovered = steps.filter((s) => {
          const risk = riskByKey.get(key(s)) || "unassigned";
          return risk === "unassigned" || risk === "critical";
        }).length;
        setUncoveredSteps(uncovered);
      })
      .catch(() => !cancelled && setUncoveredSteps(null));
    return () => {
      cancelled = true;
    };
  }, [activeOrgId]);

  const hour = new Date().getHours();
  const greeting =
    hour < 10 ? t("home.greeting_morning") : hour < 18 ? t("home.greeting_day") : t("home.greeting_evening");

  return (
    <div className="home">
      <div className="home__head">
        <div className="home__titles">
          <span className="home__greeting">{greeting}</span>
          <h1 className="home__title">{t("home.title")}</h1>
        </div>
        {activeOrgName ? (
          <span className="home__meta">
            {activeOrgName}
            {orgProcessCount !== null ? ` · ${t("home.org_processes_short", { count: orgProcessCount })}` : ""}
          </span>
        ) : null}
      </div>

      <div className="home__grid">
        <section className="home__section" aria-labelledby="home-new">
          <div className="home__section-head">
            <h2 id="home-new" className="home__section-title">{t("home.new_title")}</h2>
            <span className="home__section-sub">{t("home.new_sub")}</span>
          </div>
          <button type="button" className="home__blank" onClick={onNewBlank}>
            <span className="home__blank-icon" aria-hidden="true">
              <WorkspaceIcon name="plus" size={18} />
            </span>
            <span className="home__blank-text">
              <span className="home__blank-title">{t("home.blank_title")}</span>
              <span className="home__blank-sub">{t("home.blank_sub")}</span>
            </span>
          </button>
          <div className="home__templates">
            {templates.map((template) => (
              <button key={template.id} type="button" className="home__template" onClick={() => onTemplate?.(template)}>
                <span className="home__template-glyph" aria-hidden="true">
                  <span />
                  <span />
                </span>
                <span className="home__template-name">{template.label}</span>
                <span className="home__template-meta">
                  {t("home.template_roles", { count: countRoles(template.roles) })}
                </span>
              </button>
            ))}
            <button type="button" className="home__template home__template--import" onClick={onImport}>
              <span className="home__template-glyph home__template-glyph--import" aria-hidden="true">
                <WorkspaceIcon name="upload" size={14} />
              </span>
              <span className="home__template-name">{t("home.import_title")}</span>
              <span className="home__template-meta">.bpmn</span>
            </button>
          </div>
        </section>

        <section className="home__section" aria-labelledby="home-recent">
          <div className="home__section-head">
            <h2 id="home-recent" className="home__section-title">{t("home.recent_title")}</h2>
            <button type="button" className="home__link" onClick={onShowAllModels}>
              {t("home.recent_all")} →
            </button>
          </div>
          <div className="home__table" role="table" aria-labelledby="home-recent">
            <div className="home__row home__row--head" role="row">
              <span role="columnheader">{t("home.col_name")}</span>
              <span role="columnheader">{t("home.col_version")}</span>
              <span role="columnheader">{t("home.col_updated")}</span>
              <span role="columnheader" aria-label={t("home.col_actions")} />
            </div>
            {models.loading ? (
              <div className="home__empty">{t("home.loading")}</div>
            ) : models.error ? (
              <div className="home__empty">{t("home.recent_error")}</div>
            ) : models.items.length === 0 ? (
              <div className="home__empty">{t("home.recent_empty")}</div>
            ) : (
              models.items.map((model) => {
                const version = model?.process_meta?.version ? String(model.process_meta.version) : "";
                return (
                  <div key={model.id} className="home__row" role="row">
                    <span role="cell" className="home__row-name" title={model.name}>
                      {model.name || model.id}
                    </span>
                    <span role="cell" className="home__mono">{version ? `v${version}` : "—"}</span>
                    <span role="cell" className="home__mono" title={model.updated_at || ""}>
                      {relative(model.updated_at)}
                    </span>
                    <span role="cell" className="home__row-action">
                      <button type="button" className="ws-btn" onClick={() => onOpenModel?.(model.id, version)}>
                        {t("home.open")}
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {activeOrgId ? (
        <section className="home__section" aria-labelledby="home-team">
          <h2 id="home-team" className="home__section-title">
            {t("home.team_title", { name: activeOrgName || activeOrgId })}
          </h2>
          <div className="home__stats">
            <button type="button" className="home__stat" onClick={onOpenOrgModel}>
              <span className="home__stat-label">{t("home.stat_processes")}</span>
              <span className="home__stat-value">{orgProcessCount ?? "—"}</span>
            </button>
            <button type="button" className="home__stat" onClick={onOpenNotes}>
              <span className="home__stat-label">{t("home.stat_notes")}</span>
              <span className="home__stat-value">{notesCount}</span>
            </button>
            <button type="button" className="home__stat" onClick={onOpenActivity}>
              <span className="home__stat-label">{t("home.stat_pending")}</span>
              <span className="home__stat-value">{pendingCount}</span>
            </button>
            <button
              type="button"
              className={`home__stat ${uncoveredSteps ? "home__stat--alert" : ""}`}
              onClick={onOpenWorkforce}
            >
              <span className="home__stat-label">{t("home.stat_uncovered")}</span>
              <span className="home__stat-value">{uncoveredSteps ?? "—"}</span>
            </button>
          </div>
        </section>
      ) : (
        <section className="home__section">
          <button type="button" className="home__org-cta" onClick={onOpenOrganization}>
            <WorkspaceIcon name="organization" />
            <span>
              <strong>{t("home.no_org_title")}</strong>
              <span>{t("home.no_org_sub")}</span>
            </span>
          </button>
        </section>
      )}
    </div>
  );
}
