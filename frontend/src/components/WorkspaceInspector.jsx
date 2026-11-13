import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getNodeKind } from "./workspaceNodes";

/**
 * Right-hand properties panel for the element selected in the map or tree.
 * `selection` = { id, name, type } as reported by the diagram.
 */
export default function WorkspaceInspector({ selection, engineJson, readOnly, onClose, onOpenLane, onSelectNode }) {
  const { t } = useTranslation();

  const info = useMemo(() => {
    if (!selection?.id) return null;
    const nodes = Array.isArray(engineJson?.nodes) ? engineJson.nodes : [];
    const lanes = Array.isArray(engineJson?.lanes) ? engineJson.lanes : [];
    const flows = Array.isArray(engineJson?.flows) ? engineJson.flows : [];
    const id = String(selection.id);
    const nodesById = new Map(nodes.map((n) => [String(n?.id || ""), n]));
    const lane = lanes.find((l) => String(l?.id || "") === id);
    const kind = lane ? "lane" : getNodeKind(selection.type || nodesById.get(id)?.type);

    if (kind === "lane") {
      const laneId = lane ? id : String(selection.id);
      return {
        kind,
        id: laneId,
        name: lane?.name || selection.name || laneId,
        steps: nodes.filter((n) => String(n?.laneId || "") === laneId),
      };
    }

    const node = nodesById.get(id);
    const nodeLane = lanes.find((l) => String(l?.id || "") === String(node?.laneId || ""));
    const toRef = (nodeId, label) => {
      const n = nodesById.get(String(nodeId));
      return { id: String(nodeId), name: n?.name || t(`workspace.kind_${getNodeKind(n?.type)}`), label };
    };
    return {
      kind,
      id,
      name: node?.name || selection.name || "",
      type: node?.type || selection.type || "",
      laneId: node?.laneId ? String(node.laneId) : "",
      laneName: nodeLane?.name || "",
      inEngine: Boolean(node),
      previous: flows.filter((f) => String(f?.target || "") === id).map((f) => toRef(f.source, f?.name)),
      next: flows.filter((f) => String(f?.source || "") === id).map((f) => toRef(f.target, f?.name)),
    };
  }, [selection, engineJson, t]);

  if (!info) return null;

  const renderRefs = (refs) =>
    refs.length === 0 ? (
      <span className="ws-props__empty">—</span>
    ) : (
      <span className="ws-props__refs">
        {refs.map((ref) => (
          <button key={ref.id} type="button" className="ws-props__ref" onClick={() => onSelectNode?.({ id: ref.id })}>
            {ref.name}
            {ref.label ? <span className="ws-props__ref-label">{ref.label}</span> : null}
          </button>
        ))}
      </span>
    );

  return (
    <aside className="ws-inspector" aria-label={t("workspace.properties")}>
      <div className="ws-inspector__head">
        <div className="ws-inspector__titles">
          <span className="ws-section-label ws-section-label--flush">
            {t(`workspace.kind_${info.kind}`)}
          </span>
          <h2 className="ws-inspector__title">{info.name || t(`workspace.kind_${info.kind}`)}</h2>
        </div>
        <button type="button" className="ws-icon-btn" aria-label={t("workspace.close")} onClick={onClose}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {info.kind === "lane" ? (
        <>
          <dl className="ws-props">
            <div className="ws-props__row">
              <dt>{t("workspace.prop_steps")}</dt>
              <dd>{info.steps.length}</dd>
            </div>
            <div className="ws-props__row">
              <dt>{t("workspace.prop_id")}</dt>
              <dd className="ws-props__mono">{info.id}</dd>
            </div>
          </dl>
          {info.steps.length ? (
            <ol className="ws-props__list">
              {info.steps.map((step) => (
                <li key={step.id}>
                  <button type="button" className="ws-props__ref" onClick={() => onSelectNode?.({ id: step.id })}>
                    {step.name || t(`workspace.kind_${getNodeKind(step.type)}`)}
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
          {!readOnly ? (
            <button type="button" className="ws-btn ws-btn--block" onClick={() => onOpenLane?.(info.id, info.name)}>
              {t("workspace.edit_lane_steps")}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <dl className="ws-props">
            <div className="ws-props__row">
              <dt>{t("workspace.prop_lane")}</dt>
              <dd>
                {info.laneId ? (
                  <button type="button" className="ws-props__ref" onClick={() => onOpenLane?.(info.laneId, info.laneName)}>
                    {info.laneName || info.laneId}
                  </button>
                ) : (
                  <span className="ws-props__empty">—</span>
                )}
              </dd>
            </div>
            <div className="ws-props__row">
              <dt>{t("workspace.prop_type")}</dt>
              <dd className="ws-props__mono">{info.type || "—"}</dd>
            </div>
            <div className="ws-props__row">
              <dt>{t("workspace.prop_previous")}</dt>
              <dd>{renderRefs(info.previous)}</dd>
            </div>
            <div className="ws-props__row">
              <dt>{t("workspace.prop_next")}</dt>
              <dd>{renderRefs(info.next)}</dd>
            </div>
            <div className="ws-props__row">
              <dt>{t("workspace.prop_id")}</dt>
              <dd className="ws-props__mono">{info.id}</dd>
            </div>
          </dl>
          {!info.inEngine ? <p className="ws-props__hint">{t("workspace.not_synced")}</p> : null}
          {info.laneId && !readOnly ? (
            <button type="button" className="ws-btn ws-btn--block" onClick={() => onOpenLane?.(info.laneId, info.laneName)}>
              {t("workspace.edit_lane_steps")}
            </button>
          ) : null}
        </>
      )}
    </aside>
  );
}
