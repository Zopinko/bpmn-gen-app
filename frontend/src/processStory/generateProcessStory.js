const DEFAULT_CONNECTORS = ["Potom", "Nasledne", "Dalej", "V dalsom kroku"];

const normalizeType = (value) => {
  const raw = String(value || "");
  const lower = raw.toLowerCase().replace("bpmn:", "").replace(/[_\s-]+/g, "");
  if (!lower) return "";
  if (lower.includes("startevent") || lower.includes("start")) return "start";
  if (lower.includes("endevent") || lower.includes("end")) return "end";
  if (lower.includes("exclusive") || lower.includes("xor")) return "xor";
  if (lower.includes("parallel") || lower.includes("and")) return "and";
  if (lower.includes("task")) return "task";
  if (lower.includes("gateway")) return "gateway";
  return lower;
};

const normalizeFlowEndpoint = (flow, key) =>
  flow?.[key] || flow?.[`${key}Id`] || flow?.[`${key}Ref`] || flow?.[key.replace("Id", "")] || null;

const asSorted = (items) =>
  [...items].sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));

const toSentence = (text) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const laneLead = (node, laneById, options, laneCount) => {
  if (!options.useLanes) return "";
  const laneName = laneById.get(node?.laneId) || "";
  if (!laneName) return "";
  if (laneCount <= 1) return "";
  return `${laneName} `;
};

const isStateLike = (name) => {
  const words = String(name || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return false;
  const suffixes = ["any", "eny", "uty", "ity", "aty", "ene", "ny", "ty", "te", "ne"];
  return words.some((word) => suffixes.some((sfx) => word.endsWith(sfx)));
};

const withFallback = (value, fallback) => {
  const text = String(value || "").trim();
  return text || fallback;
};

const buildNote = (message, severity = "warn") => ({ severity, text: message });

const buildLine = ({ text, nodeIds, flowIds }) => ({ text, refs: { nodeIds, flowIds } });

const indentPrefix = (depth) => "  ".repeat(Math.max(0, depth));

const bulletLine = (text, depth) => `${indentPrefix(depth)}- ${text}`;

const applyMainFlowConnectors = (lines, laneNames, lineTypes) =>
  lines.map((line, index) => {
    const raw = String(line.text || "").trim();
    if (!raw) return line;
    const type = lineTypes[index] || "";
    if (type === "end") {
      if (raw.startsWith("Na zaver ")) return line;
      return { ...line, text: `Na zaver ${raw}` };
    }
    if (index === 0) {
      return line;
    }
    const prefix = DEFAULT_CONNECTORS[(index - 1) % DEFAULT_CONNECTORS.length];
    const startsWithPrefix = DEFAULT_CONNECTORS.some((p) => raw.startsWith(`${p} `));
    if (startsWithPrefix) return line;
    const startsWithLane = laneNames.some((lane) => raw.startsWith(`${lane} `));
    if (startsWithLane) {
      return { ...line, text: `${prefix} ${raw}` };
    }
    return { ...line, text: `${prefix} ${raw}` };
  });

const dedupeSentences = (sentences) => {
  const seen = new Set();
  return sentences.filter((s) => {
    const key = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildSummary = ({ startLine, taskLines, endLine, mainFlowTexts }) => {
  const sentences = [];
  if (startLine && taskLines[0]) {
    const merged = `${startLine.replace(/\.$/, "")}, nasledne ${taskLines[0].replace(/\.$/, "")}.`;
    sentences.push(merged);
  } else if (startLine) {
    sentences.push(startLine);
  }
  if (taskLines[1]) {
    sentences.push(taskLines[1]);
  }
  if (endLine) {
    sentences.push(endLine);
  }
  const mainSet = new Set((mainFlowTexts || []).map((s) => String(s || "").trim()));
  const filtered = dedupeSentences(sentences).filter((s) => !mainSet.has(String(s || "").trim()));
  const endSentence =
    filtered.find((s) => s.startsWith("Na zaver") || s.toLowerCase().includes("proces sa konci")) || "";
  const nonEnd = filtered.filter((s) => s !== endSentence);
  const paragraphs = [];
  if (nonEnd.length) {
    paragraphs.push(nonEnd.join(" "));
  }
  if (endSentence) {
    paragraphs.push(endSentence);
  }
  return paragraphs.slice(0, 2);
};

const postProcessText = (doc, laneNames, lineTypes) => {
  const mainFlow = applyMainFlowConnectors(doc.mainFlow || [], laneNames, lineTypes).map((line) => ({
    ...line,
    text: toSentence(line.text),
  }));
  const summary = dedupeSentences(doc.summary || []);
  return { ...doc, summary, mainFlow };
};

const buildIndex = (engineJson) => {
  const nodes = Array.isArray(engineJson?.nodes) ? engineJson.nodes : [];
  const flows = Array.isArray(engineJson?.flows) ? engineJson.flows : [];
  const lanes = Array.isArray(engineJson?.lanes) ? engineJson.lanes : [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const laneById = new Map(lanes.map((lane) => [lane.id, lane.name || lane.label || lane.id]));
  const outgoing = new Map();
  const incoming = new Map();
  flows.forEach((flow) => {
    const sourceId = normalizeFlowEndpoint(flow, "sourceId") || normalizeFlowEndpoint(flow, "source");
    const targetId = normalizeFlowEndpoint(flow, "targetId") || normalizeFlowEndpoint(flow, "target");
    if (!sourceId || !targetId) return;
    const out = outgoing.get(sourceId) || [];
    out.push({ ...flow, sourceId, targetId });
    outgoing.set(sourceId, out);
    const inc = incoming.get(targetId) || [];
    inc.push({ ...flow, sourceId, targetId });
    incoming.set(targetId, inc);
  });
  return { nodes, flows, lanes, nodeById, laneById, outgoing, incoming };
};

const pickStartNode = (nodes, notes, selectedStartId) => {
  const starts = nodes.filter((node) => normalizeType(node.type) === "start");
  const startsSorted = asSorted(starts);
  if (starts.length > 1) {
    const selectedIdx = startsSorted.findIndex((n) => n.id === selectedStartId);
    const selectedNode = selectedIdx >= 0 ? startsSorted[selectedIdx] : null;
    const name = String(selectedNode?.name || "").trim();
    const label = name || (selectedIdx >= 0 ? `Start ${selectedIdx + 1}` : "hlavny start");
    notes.push(buildNote(`Proces ma viac startov - pribeh je generovany zo startu: ${label}.`, "warn"));
  }
  if (selectedStartId) {
    const selected = startsSorted.find((node) => node.id === selectedStartId);
    if (selected) return selected;
  }
  const [start] = startsSorted;
  return start || null;
};

const chooseNext = (flows) => {
  if (!flows?.length) return null;
  return [...flows].sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")))[0];
};

const findJoinNode = ({ splitId, outgoing, incoming, nodeById, type }) => {
  const branches = outgoing.get(splitId) || [];
  if (!branches.length) return null;
  const branchTargets = branches.map((flow) => flow.targetId).filter(Boolean);
  if (branchTargets.length < 2) return null;
  const visitedSets = branchTargets.map((startId) => {
    const seen = new Set();
    const queue = [{ id: startId, depth: 0 }];
    while (queue.length) {
      const { id, depth } = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const nextFlows = outgoing.get(id) || [];
      nextFlows.forEach((flow) => {
        if (flow.targetId && depth < 50) queue.push({ id: flow.targetId, depth: depth + 1 });
      });
    }
    return seen;
  });
  const intersection = [...visitedSets[0]].filter((id) => visitedSets.every((set) => set.has(id)));
  if (!intersection.length) return null;
  const candidates = intersection
    .map((id) => ({ id, node: nodeById.get(id) }))
    .filter((item) => item.node)
    .filter((item) => {
      const nodeType = normalizeType(item.node.type);
      if (type === "xor" && nodeType === "xor" && (incoming.get(item.id) || []).length > 1) return true;
      if (type === "and" && nodeType === "and" && (incoming.get(item.id) || []).length > 1) return true;
      return false;
    });
  if (candidates.length) {
    return candidates.sort((a, b) => String(a.id).localeCompare(String(b.id)))[0].node;
  }
  return nodeById.get(intersection.sort()[0]) || null;
};

const buildNodeSentence = (node, laneById, options, laneCount) => {
  const type = normalizeType(node?.type);
  if (type === "start") {
    const name = withFallback(node?.name, "spustenim udalosti");
    return toSentence(`Proces sa zacne, ked ${name}`);
  }
  if (type === "end") {
    const name = withFallback(node?.name, "proces sa tymto krokom uzatvori");
    if (!node?.name) {
      return toSentence("Na zaver sa proces uzatvara.");
    }
    if (isStateLike(name)) {
      return toSentence(`Na zaver sa proces uzatvara: ${name}`);
    }
    return toSentence(`Proces sa konci tym, ze ${name}`);
  }
  if (type === "task") {
    const taskName = withFallback(node?.name, "Nespecifikovany krok");
    const lead = laneLead(node, laneById, options, laneCount);
    const adjusted = lead ? taskName.charAt(0).toLowerCase() + taskName.slice(1) : taskName;
    return toSentence(`${lead}${adjusted}`);
  }
  if (type === "xor") {
    return toSentence("V tomto bode nasleduje rozhodnutie");
  }
  if (type === "and") {
    return toSentence("Potom sa proces rozdeli na paralelne kroky");
  }
  return toSentence(withFallback(node?.name, "Nespecifikovany krok"));
};

const buildDecisionLines = ({
  gatewayNode,
  depth,
  laneById,
  options,
  outgoing,
  incoming,
  nodeById,
  notes,
  laneCount,
  mainFlowNodeIds,
  visitedDecisionIds,
  fallbackStopId,
}) => {
  const lines = [];
  const title = `(Nasleduje rozhodnutie) ${withFallback(gatewayNode?.name, "Rozhodnutie")}`;
  lines.push(buildLine({ text: toSentence(bulletLine(title, depth)), nodeIds: [gatewayNode.id] }));
  const flows = outgoing.get(gatewayNode.id) || [];
  const joinNode = findJoinNode({ splitId: gatewayNode.id, outgoing, incoming, nodeById, type: "xor" });
  const stopId = joinNode?.id || fallbackStopId || null;
  flows.forEach((flow, idx) => {
    const label = formatBranchLabel(flow, idx);
    const intro = bulletLine(`Ak ${label}, pokracuje sa takto:`, depth + 1);
    lines.push(buildLine({ text: toSentence(intro), flowIds: [flow.id] }));
    const branchSteps = buildBranchSteps({
      startId: flow.targetId,
      stopId,
      laneById,
      options,
      outgoing,
      incoming,
      nodeById,
      notes,
      maxSteps: options.moreDetails ? 100 : 6,
      laneCount,
      decisionDepth: depth + 2,
      mainFlowNodeIds,
      visitedDecisionIds,
    });
    lines.push(...branchSteps);
  });
  return lines;
};

const buildBranchSteps = ({
  startId,
  stopId,
  laneById,
  options,
  outgoing,
  incoming,
  nodeById,
  notes,
  maxSteps,
  laneCount,
  decisionDepth = 0,
  mainFlowNodeIds,
  visitedDecisionIds,
}) => {
  const lines = [];
  const visited = new Set();
  let currentId = startId;
  let steps = 0;
  while (currentId) {
    if (currentId === stopId) break;
    if (visited.has(currentId)) {
      notes.push(buildNote("Proces obsahuje opakovanie/cyklus - vetva bola skratena.", "warn"));
      break;
    }
    if (mainFlowNodeIds && mainFlowNodeIds.has(currentId)) {
      break;
    }
    visited.add(currentId);
    const node = nodeById.get(currentId);
    if (!node) break;
    const type = normalizeType(node.type);
    if (type === "xor" || type === "and") {
      if (type === "xor") {
        if (visitedDecisionIds?.has(node.id)) {
          notes.push(buildNote("Proces obsahuje opakovanie/cyklus - rozhodnutie bolo skratene.", "warn"));
          break;
        }
        if (visitedDecisionIds) visitedDecisionIds.add(node.id);
        const nested = buildDecisionLines({
          gatewayNode: node,
          depth: decisionDepth,
          laneById,
          options,
          outgoing,
          incoming,
          nodeById,
          notes,
          laneCount,
          mainFlowNodeIds,
          visitedDecisionIds,
          fallbackStopId: stopId,
        });
        lines.push(...nested);
        break;
      }
      lines.push(buildLine({ text: toSentence(bulletLine("Nasleduje dalsia paralela.", decisionDepth)), nodeIds: [node.id] }));
      break;
    }
    if (type === "end" && !options.showEnds) {
      break;
    }
    const sentence = buildNodeSentence(node, laneById, options, laneCount);
    lines.push(buildLine({ text: bulletLine(sentence, decisionDepth), nodeIds: [node.id] }));
    steps += 1;
    if (maxSteps && steps >= maxSteps) {
      break;
    }
    const nextFlow = chooseNext(outgoing.get(currentId) || []);
    currentId = nextFlow?.targetId || null;
  }
  return lines;
};

const formatBranchLabel = (flow, index) => {
  const label = String(flow?.name || flow?.label || "").trim();
  if (label) return label;
  const letter = String.fromCharCode(65 + index);
  return `Moznost ${letter}`;
};

export const createDefaultProcessStoryOptions = () => ({
  useLanes: true,
  summarizeParallels: true,
  showEnds: true,
  showBranchEnds: true,
  moreDetails: true,
  selectedStartId: null,
});

export const generateProcessStory = (engineJson, options = {}) => {
  const opts = { ...createDefaultProcessStoryOptions(), ...options };
  const notes = [];
  if (!engineJson || !Array.isArray(engineJson.nodes) || !engineJson.nodes.length) {
    return {
      summary: ["Proces nema ziadne kroky na zobrazenie."],
      mainFlow: [],
      decisions: [],
      parallels: [],
      notes: [buildNote("Engine JSON je prazdny alebo neobsahuje uzly.", "warn")],
    };
  }

  const { nodes, nodeById, laneById, outgoing, incoming } = buildIndex(engineJson);
  const laneCount = Array.isArray(engineJson?.lanes) ? engineJson.lanes.length : 0;
  const laneNames = Array.from(laneById.values()).filter(Boolean);
  const mainFlow = [];
  const mainFlowItems = [];
  const decisions = [];
  const parallels = [];

  const startNode = pickStartNode(nodes, notes, opts.selectedStartId);
  if (!startNode) {
    return {
      summary: ["Proces nema start event."],
      mainFlow: [],
      decisions: [],
      parallels: [],
      notes: [buildNote("Proces nema start event, pribeh sa neda vytvorit.", "warn")],
    };
  }

  const visited = new Set();
  let currentId = startNode.id;
  while (currentId) {
    if (visited.has(currentId)) {
      notes.push(buildNote("Proces obsahuje opakovanie/cyklus - pribeh moze byt skrateni.", "warn"));
      break;
    }
    visited.add(currentId);
    const node = nodeById.get(currentId);
    if (!node) break;
    const type = normalizeType(node.type);

    if (type === "end") {
      if (opts.showEnds) {
        const line = buildLine({ text: buildNodeSentence(node, laneById, opts, laneCount), nodeIds: [node.id] });
        mainFlow.push(line);
        mainFlowItems.push({ ...line, type: "end" });
      }
      break;
    }

    if (type === "xor") {
      const line = buildLine({ text: buildNodeSentence(node, laneById, opts, laneCount), nodeIds: [node.id] });
      mainFlow.push(line);
      mainFlowItems.push({ ...line, type: "xor" });
      const flows = outgoing.get(node.id) || [];
      const branchMissingLabel = flows.some((flow) => !(flow?.name || flow?.label));
      if (branchMissingLabel) {
        notes.push(buildNote("Niektore vetvy rozhodnutia nemaju nazov.", "warn"));
      }
      const joinNode = findJoinNode({ splitId: node.id, outgoing, incoming, nodeById, type: "xor" });
      const decision = {
        title: `Rozhodnutie: ${withFallback(node?.name, "Rozhodnutie")}`,
        branches: flows.map((flow, idx) => {
          const label = formatBranchLabel(flow, idx);
          const branchSteps = buildBranchSteps({
            startId: flow.targetId,
            stopId: joinNode?.id || null,
            laneById,
            options: { ...opts, showEnds: opts.showBranchEnds },
            outgoing,
            incoming,
            nodeById,
            notes,
            maxSteps: opts.moreDetails ? 100 : 6,
            laneCount,
            decisionDepth: 0,
            mainFlowNodeIds: new Set(mainFlowItems.map((item) => item.refs?.nodeIds?.[0]).filter(Boolean)),
            visitedDecisionIds: new Set([node.id]),
          });
          return {
            label,
            intro: `Ak ${label}, pokracuje sa takto:`,
            steps: branchSteps,
          };
        }),
      };
      decisions.push(decision);
      const nextFlow = joinNode ? chooseNext(outgoing.get(joinNode.id) || []) : null;
      currentId = nextFlow?.targetId || null;
      continue;
    }

    if (type === "and") {
      const line = buildLine({ text: buildNodeSentence(node, laneById, opts, laneCount), nodeIds: [node.id] });
      mainFlow.push(line);
      mainFlowItems.push({ ...line, type: "and" });
      const flows = outgoing.get(node.id) || [];
      const joinNode = findJoinNode({ splitId: node.id, outgoing, incoming, nodeById, type: "and" });
      const maxSteps = opts.summarizeParallels && !opts.moreDetails ? 1 : 20;
      const parallel = {
        title: `Paralela: ${withFallback(node?.name, "Paralela")}`,
        branches: flows.map((flow, idx) => {
          const branchSteps = buildBranchSteps({
            startId: flow.targetId,
            stopId: joinNode?.id || null,
            laneById,
            options: { ...opts, showEnds: opts.showBranchEnds },
            outgoing,
            incoming,
            nodeById,
            notes,
            maxSteps,
            laneCount,
            decisionDepth: 0,
            mainFlowNodeIds: new Set(mainFlowItems.map((item) => item.refs?.nodeIds?.[0]).filter(Boolean)),
            visitedDecisionIds: new Set(),
          });
          const truncated = branchSteps.length >= maxSteps && (outgoing.get(flow.targetId) || []).length;
          return {
            label: `Vetva ${idx + 1}`,
            steps: branchSteps,
            truncated,
          };
        }),
        outro: joinNode ? "Ked su paralelne kroky hotove, proces pokracuje dalej." : "",
      };
      parallels.push(parallel);
      const nextFlow = joinNode ? chooseNext(outgoing.get(joinNode.id) || []) : null;
      currentId = nextFlow?.targetId || null;
      continue;
    }

    const line = buildLine({ text: buildNodeSentence(node, laneById, opts, laneCount), nodeIds: [node.id] });
    mainFlow.push(line);
    mainFlowItems.push({ ...line, type: normalizeType(node.type) });
    const nextFlow = chooseNext(outgoing.get(node.id) || []);
    currentId = nextFlow?.targetId || null;
  }

  const startLine = mainFlowItems.find((item) => item.type === "start")?.text || "";
  const taskLines = mainFlowItems.filter((item) => item.type === "task").map((item) => item.text);
  const endLine = mainFlowItems.find((item) => item.type === "end")?.text || "";
  const mainFlowTexts = mainFlow.map((line) => line.text);
  const summary = buildSummary({ startLine, taskLines, endLine, mainFlowTexts });

  const doc = {
    summary,
    mainFlow,
    decisions,
    parallels,
    notes,
  };
  const lineTypes = mainFlowItems.map((item) => item.type);
  return postProcessText(doc, laneNames, lineTypes);
};
