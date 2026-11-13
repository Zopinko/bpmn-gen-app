import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getNodeKind } from "./workspaceNodes";

const SEVERITY_ORDER = { HARD: 0, SOFT: 1, INFO: 2 };

function NodeGlyph({ kind }) {
  return <span className={`ws-glyph ws-glyph--${kind}`} aria-hidden="true" />;
}

/** Orders nodes of one lane by following the flows from the earliest node. */
const orderLaneNodes = (laneNodes, flows) => {
  if (laneNodes.length < 2) return laneNodes;
  const ids = new Set(laneNodes.map((n) => String(n.id)));
  const incoming = new Map();
  const next = new Map();
  flows.forEach((f) => {
    const s = String(f?.source || "");
    const t = String(f?.target || "");
    if (!ids.has(s) || !ids.has(t)) return;
    incoming.set(t, (incoming.get(t) || 0) + 1);
    if (!next.has(s)) next.set(s, []);
    next.get(s).push(t);
  });
  const byId = new Map(laneNodes.map((n) => [String(n.id), n]));
  const ordered = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push(byId.get(id));
    (next.get(id) || []).forEach(visit);
  };
  laneNodes.filter((n) => !incoming.get(String(n.id))).forEach((n) => visit(String(n.id)));
  laneNodes.forEach((n) => visit(String(n.id)));
  return ordered;
};

export default function WorkspaceStructure({
  engineJson,
  processName,
  findings = [],
  selectedId = "",
  onSelectLane,
  onSelectNode,
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => new Set());

  const lanes = useMemo(() => {
    const laneList = Array.isArray(engineJson?.lanes) ? engineJson.lanes : [];
    const nodes = Array.isArray(engineJson?.nodes) ? engineJson.nodes : [];
    const flows = Array.isArray(engineJson?.flows) ? engineJson.flows : [];
    const laneIds = new Set(laneList.map((l) => String(l?.id || "")));
    const result = laneList.map((lane) => {
      const laneId = String(lane?.id || "");
      return {
        id: laneId,
        name: String(lane?.name || laneId),
        nodes: orderLaneNodes(
          nodes.filter((n) => String(n?.laneId || "") === laneId),
          flows,
        ),
      };
    });
    const orphans = nodes.filter((n) => !laneIds.has(String(n?.laneId || "")));
    if (orphans.length) {
      result.push({ id: "", name: t("workspace.no_lane"), nodes: orderLaneNodes(orphans, flows) });
    }
    return result;
  }, [engineJson, t]);

  const issues = useMemo(
    () =>
      (Array.isArray(findings) ? findings : [])
        .filter((f) => f && f.message)
        .slice()
        .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)),
    [findings],
  );

  const toggleLane = (laneId) => {
    setCollapsed((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(laneId)) nextSet.delete(laneId);
      else nextSet.add(laneId);
      return nextSet;
    });
  };

  const selectFinding = (finding) => {
    const target = finding?.target || {};
    const targetId = String(target?.id || "");
    if (!targetId) return;
    if (target.type === "lane") {
      const lane = lanes.find((l) => l.id === targetId);
      if (lane) onSelectLane?.(lane);
      return;
    }
    onSelectNode?.({ id: targetId });
  };

  return (
    <aside className="ws-structure" aria-label={t("workspace.structure")}>
      <div className="ws-section-label">{t("workspace.structure")}</div>
      <div className="ws-tree" role="tree">
        <div className="ws-tree__row ws-tree__row--root" role="treeitem" aria-expanded="true">
          <span className="ws-tree__name">{processName}</span>
        </div>
        {lanes.map((lane) => {
          const isOpen = !collapsed.has(lane.id);
          const isSelected = lane.id && selectedId === lane.id;
          return (
            <div key={lane.id || "__orphans"} role="group">
              <div
                className={`ws-tree__row ws-tree__row--lane ${isSelected ? "is-selected" : ""}`}
                role="treeitem"
                aria-expanded={isOpen}
                aria-selected={Boolean(isSelected)}
              >
                <button
                  type="button"
                  className={`ws-tree__chevron ${isOpen ? "is-open" : ""}`}
                  aria-label={isOpen ? t("workspace.collapse") : t("workspace.expand")}
                  onClick={() => toggleLane(lane.id)}
                />
                <button
                  type="button"
                  className="ws-tree__label"
                  onClick={() => (lane.id ? onSelectLane?.(lane) : toggleLane(lane.id))}
                >
                  <span className="ws-tree__name">{lane.name}</span>
                  <span className="ws-tree__count">{lane.nodes.length}</span>
                </button>
              </div>
              {isOpen
                ? lane.nodes.map((node) => {
                    const nodeId = String(node?.id || "");
                    const kind = getNodeKind(node?.type);
                    const nodeSelected = selectedId === nodeId;
                    return (
                      <div
                        key={nodeId}
                        className={`ws-tree__row ws-tree__row--node ${nodeSelected ? "is-selected" : ""}`}
                        role="treeitem"
                        aria-selected={nodeSelected}
                      >
                        <button type="button" className="ws-tree__label" onClick={() => onSelectNode?.(node)}>
                          <NodeGlyph kind={kind} />
                          <span className="ws-tree__name">{node?.name || t(`workspace.kind_${kind}`)}</span>
                        </button>
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>

      <div className="ws-section-label ws-section-label--sep">{t("workspace.checks")}</div>
      <ul className="ws-checks">
        {issues.length === 0 ? (
          <li className="ws-check">
            <span className="ws-check__mark ws-check__mark--ok">OK</span>
            <span>{t("workspace.checks_ok")}</span>
          </li>
        ) : (
          issues.map((finding, index) => (
            <li key={finding.id || index} className="ws-check">
              <button type="button" className="ws-check__btn" onClick={() => selectFinding(finding)}>
                <span
                  className={`ws-check__mark ws-check__mark--${String(finding.severity || "INFO").toLowerCase()}`}
                >
                  {finding.severity === "HARD" ? "!!" : finding.severity === "SOFT" ? "!" : "i"}
                </span>
                <span>{finding.message}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}
