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
