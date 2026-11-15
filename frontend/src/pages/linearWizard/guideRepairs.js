const typeOf = (node) => String(node?.type || "").split(":").pop().toLowerCase();
const isTask = (node) => /task$|activity$/.test(typeOf(node));
const isDecision = (node) => /^(exclusivegateway|gateway)$/.test(typeOf(node));

export function findIncompleteDecision({ nodes = [], flows = [] }) {
  for (const node of nodes.filter((entry) => isDecision(entry) && entry.gatewayDirection !== "Converging")) {
    const outgoing = flows.filter((flow) => flow.source === node.id);
    if (outgoing.length !== 1 || flows.filter((flow) => flow.target === node.id).length !== 1) continue;
    const outcome = String(outgoing[0].name || outgoing[0].label || "")
      .trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const opposite = /^(yes|ano|true)$/.test(outcome) ? "no"
      : /^(no|nie|false)$/.test(outcome) ? "yes" : "";
    return { node, opposite };
  }
  return null;
}

export function findDanglingBranchTask({ nodes = [], flows = [] }) {
  const outgoing = new Map();
  for (const { source, target } of flows) {
    const targets = outgoing.get(source) || [];
    targets.push(target);
    outgoing.set(source, targets);
  }
  const queue = nodes.filter(isDecision).flatMap((node) => outgoing.get(node.id) || []);
  const visited = new Set(queue);
  for (const id of queue) {
    for (const target of outgoing.get(id) || []) {
      if (visited.has(target)) continue;
      visited.add(target);
      queue.push(target);
    }
  }
  return nodes.findLast((node) => isTask(node) && visited.has(node.id) && !outgoing.has(node.id));
}

export function findRepairTargets({ nodes = [], flows = [] }, sourceId) {
  const upstream = new Set([sourceId]);
  const queue = [sourceId];
  for (const id of queue) {
    for (const flow of flows) {
      if (flow.target !== id || upstream.has(flow.source)) continue;
      upstream.add(flow.source);
      queue.push(flow.source);
    }
  }
  return nodes.filter((node) => node.id !== sourceId && isTask(node))
    .sort((a, b) => Number(upstream.has(b.id)) - Number(upstream.has(a.id)));
}
