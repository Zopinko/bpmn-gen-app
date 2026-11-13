export const getNodeKind = (type) => {
  const t = String(type || "").toLowerCase();
  if (t.includes("lane") || t.includes("participant")) return "lane";
  if (t.includes("gateway")) return "gateway";
  if (t.includes("startevent")) return "start";
  if (t.includes("endevent")) return "end";
  if (t.includes("event")) return "event";
  if (t.includes("subprocess")) return "subprocess";
  return "task";
};

/** Engine id stored on a bpmn-js element (falls back to the diagram id). */
export const getElementEngineId = (element) => {
  const bo = element?.businessObject;
  return String(bo?.$attrs?.["data-engine-id"] || bo?.id || element?.id || "");
};

/** Finds the diagram element for an engine id in a bpmn-js modeler. */
export const findDiagramElement = (modeler, engineId) => {
  const registry = modeler?.get?.("elementRegistry");
  if (!registry || !engineId) return null;
  const id = String(engineId);
  return (
    registry.get(id) ||
    registry.find?.((el) => el?.type !== "label" && getElementEngineId(el) === id) ||
    null
  );
};
