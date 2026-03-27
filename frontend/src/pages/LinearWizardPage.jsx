import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import MapViewer from "../components/MapViewer";
import { useHeaderStepper } from "../components/HeaderStepperContext";
import {
  appendLaneFromDescription,
  generateLinearWizardDiagram,
  importBpmn,
  saveWizardModel,
  loadWizardModel,
  renderEngineXml,
  reflowLayout,
  listWizardModels,
  deleteWizardModel,
  renameWizardModel,
  pushSandboxModelToOrg,
  listMyOrgs,
  loadOrgModel,
  listOrgModels,
  createOrgModelVersion,
  saveOrgModel,
  getProjectNotes,
  saveProjectNotes,
  listOrgActivity,
  approveOrgDeleteRequest,
  rejectOrgDeleteRequest,
  mentorReview,
} from "../api/wizard";
import {
  createOrgFolder,
  getOrgModelPresence,
  createOrgProcess,
  createOrgProcessFromOrgModel,
  deleteOrgNode,
  getOrgModel,
  heartbeatOrgModelPresence,
  moveOrgNode,
  renameOrgNode,
  requestOrgProcessDelete,
  updateOrgProcessModelRef,
} from "../api/orgModel";
import { generateProcessStory } from "../processStory/generateProcessStory";
import { getOrgCapabilities } from "../permissions/orgCapabilities";
import { createRelayoutScheduler } from "./linearWizard/relayoutScheduler";
import { applyIncrementalAppend } from "./linearWizard/incrementalAppend";

const HELP_RULES = [
  {
    id: "task",
    title: "Bežný krok",
    description: "Bežná aktivita v procese, ktorú vykoná rola alebo systém.",
    iconClass: "bpmn-icon-task",
    syntax: "Ľubovoľný text na riadok",
    example: "Overím identitu zákazníka",
    template: "<krok>",
    fields: [{ key: "krok", label: "Vlastný text", token: "krok", placeholder: "napr. overím identitu" }],
  },
  {
    id: "xor",
    title: "Rozhodnutie",
    description: "Keď sa proces môže vydať dvoma smermi, vypíš podmienku a čo sa stane v oboch prípadoch. Do každej vetvy môžeš napísať aj viac činností pod seba.",
    iconClass: "bpmn-icon-gateway-xor",
    syntax: "Zápis: Ak/Ked <otázka>, tak <čo sa stane>, inak <čo sa stane>",
    example: "Ak zákazník schváli ponuku, tak pripravím zmluvu, inak koniec",
    template: "Ak <podmienka> tak <krok>, inak <inak>",
    buildTemplate: (values = {}) => {
      const condition = String(values.podmienka || "").trim() || "<podmienka>";
      const yesBranch = String(values.krok || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(", ") || "<krok>";
      const noBranch = String(values.inak || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(", ") || "<inak>";
      return `Ak ${condition} tak ${yesBranch}, inak ${noBranch}`;
    },
    fields: [
      { key: "podmienka", label: "Otázka (rozhodnutie)", token: "podmienka", placeholder: "napr. Je doklad správny?" },
      {
        key: "krok",
        label: "Ak ÁNO, čo sa stane?",
        token: "krok",
        placeholder: "napr. pripravím zmluvu\npošlem ju na podpis",
        multiline: true,
        rows: 3,
      },
      {
        key: "inak",
        label: "Ak NIE, čo sa stane?",
        token: "inak",
        placeholder: "napr. vrátim žiadosť na doplnenie\nukončím spracovanie",
        multiline: true,
        rows: 3,
      },
    ],
  },
  {
    id: "and_strict",
    title: "Paralelné kroky",
    description: "Keď sa po tomto bode dejú viaceré činnosti naraz, vypíš ich pod seba. Pomocník ich vloží do jedného paralelného riadku.",
    iconClass: "bpmn-icon-gateway-parallel",
    syntax: "Paralelne: <krok>; <krok>; <krok>",
    example: "Paralelne: pripravím zmluvu; overím identitu; nastavím splátky",
    template: "Paralelne: <krok1>; <krok2>; <krok3>",
    buildTemplate: (values = {}) => {
      const steps = String(values.kroky || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const rendered = steps.length ? steps.join("; ") : "<krok1>; <krok2>; <krok3>";
      return `Paralelne: ${rendered}`;
    },
    fields: [
      {
        key: "kroky",
        label: "Kroky, ktoré sa dejú naraz",
        token: "kroky",
        placeholder: "napr. pripravím zmluvu\noverím identitu\nnastavím splátky",
        multiline: true,
        rows: 4,
      },
    ],
  },
];


const STANDARD_TASK_SIZE = { width: 100, height: 80 };

const LANE_SHAPE_OPTIONS = [
  {
    id: "task",
    label: "Uloha",
    bpmnType: "bpmn:Task",
    nameLabel: "Nazov tasku",
    namePlaceholder: "napr. Skontrolovat ziadost",
    helper: "Pomenuj slovesom + predmetom (napr. Skontrolovat fakturu).",
    nameRequired: true,
  },
  {
    id: "xor",
    label: "XOR brana",
    bpmnType: "bpmn:ExclusiveGateway",
    nameLabel: "Rozhodnutie (otazka)",
    namePlaceholder: "napr. Je ziadost kompletna?",
    helper: "Pouzi otazku, aby bolo jasne, o com sa rozhoduje.",
    nameRequired: true,
  },
  {
    id: "parallel",
    label: "Paralelna brana",
    bpmnType: "bpmn:ParallelGateway",
    nameLabel: "Nazov paralelnej casti",
    namePlaceholder: "napr. Spustit paralelne kroky",
    helper: "Nazov je volitelny, ale pomoze pri citatelnosti.",
    nameRequired: false,
  },
  {
    id: "start",
    label: "Start",
    bpmnType: "bpmn:StartEvent",
    nameLabel: "Nazov start eventu",
    namePlaceholder: "napr. Prijata ziadost",
    helper: "Ak nechces, nechaj prazdne.",
    nameRequired: false,
  },
  {
    id: "end",
    label: "Koniec",
    bpmnType: "bpmn:EndEvent",
    nameLabel: "Nazov end eventu",
    namePlaceholder: "napr. Proces ukonceny",
    helper: "Ak nechces, nechaj prazdne.",
    nameRequired: false,
  },
];

const createLaneInsertInputs = () =>
  LANE_SHAPE_OPTIONS.reduce((acc, shape) => {
    acc[shape.id] = "";
    return acc;
  }, {});

function formatDateTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleString("sk-SK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const createEmptyProcessCardState = () => ({
  generatorInput: {
    processName: "",
    roles: "",
    trigger: "",
    input: "",
    output: "",
    mainSteps: "",
  },
  processMeta: {
    owner: "",
    department: "",
    status: "Draft",
    version: "",
    internalId: "",
    tags: "",
    description: "",
  },
});

const PROCESS_TEMPLATES = [
  {
    id: "approval",
    label: "Schválenie",
    processName: "Schválenie žiadosti",
    roles: "Klient\nPracovník\nManažér",
    trigger: "Nová žiadosť od klienta",
    input: "Žiadosť + údaje klienta",
    output: "Schválená alebo zamietnutá žiadosť",
  },
  {
    id: "complaint",
    label: "Reklamácia",
    processName: "Reklamácia tovaru",
    roles: "Zákazník\nPodpora\nSklad",
    trigger: "Zákazník podá reklamáciu",
    input: "Reklamačný formulár + doklad",
    output: "Ukončená reklamácia",
  },
  {
    id: "onboarding",
    label: "Nástup",
    processName: "Nástup nového zamestnanca",
    roles: "HR\nIT\nTímový líder",
    trigger: "Nový zamestnanec nastupuje",
    input: "Zmluva + požiadavky",
    output: "Zamestnanec pripravený na prácu",
  },
];

const LANE_TEMPLATES = [
  {
    id: "approve_basic",
    label: "Žiadosť",
    text:
      "Prijmem žiadosť\n" +
      "Overím identitu\n" +
      "Paralelne: overím bonitu; skontrolujem register dlžníkov; pripravím návrh podmienok\n" +
      "Ak identita nie je platná tak zamietnem žiadosť, inak pokračujem v spracovaní\n" +
      "Spracujem žiadosť\n" +
      "Oznámim výsledok žiadateľovi",
  },
  {
    id: "complaint_basic",
    label: "Reklamácia",
    text:
      "Prijmem reklamáciu\n" +
      "Overím doklad o kúpe\n" +
      "Ak doklad chýba tak vyžiadam doplnenie, inak pokračujem\n" +
      "Posúdim stav výrobku\n" +
      "Oznámim výsledok zákazníkovi",
  },
  {
    id: "order_basic",
    label: "Objednávka",
    text:
      "Prijmem objednávku\n" +
      "Skontrolujem dostupnosť\n" +
      "Ak nie je skladom tak ponúknem alternatívu, inak pokračujem\n" +
      "Pripravím zásielku\n" +
      "Odošlem zásielku zákazníkovi",
  },
  {
    id: "invoice_basic",
    label: "Faktúra",
    text:
      "Skontrolujem podklady\n" +
      "Vystavím faktúru\n" +
      "Ak sú údaje neúplné tak vyžiadam doplnenie, inak pokračujem\n" +
      "Odošlem faktúru\n" +
      "Zaznamenám odoslanie",
  },
  {
    id: "onboarding_basic",
    label: "Nástup",
    text:
      "Pripravím onboarding plán\n" +
      "Zriadim prístupy\n" +
      "Ak chýbajú podklady tak vyžiadam doplnenie, inak pokračujem\n" +
      "Zabezpečím školenie\n" +
      "Potvrdím nástup",
  },
  {
    id: "parallel_only_basic",
    label: "Paralelný blok",
    text:
      "Prijmem podnet\n" +
      "Paralelne: skontrolujem dokumenty; overím údaje; pripravím návrh riešenia\n" +
      "Zlúčim výsledky paralelných krokov\n" +
      "Ukončím spracovanie",
  },
];

const splitLines = (text) =>
  (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const normalizeEngineForBackend = (engine) => {
  if (!engine) return engine;
  const mapType = (raw) => {
    if (!raw) return raw;
    const base = String(raw).split(":").pop() || String(raw);
    const lower = base.toLowerCase();
    if (lower === "start") return "startEvent";
    if (lower === "endevent" || lower === "end") return "endEvent";
    if (lower === "task") return "task";
    if (lower === "usertask") return "userTask";
    if (lower === "servicetask") return "serviceTask";
    if (lower === "exclusivegateway") return "exclusiveGateway";
    if (lower === "parallelgateway") return "parallelGateway";
    if (lower === "inclusivegateway") return "inclusiveGateway";
    if (lower === "gateway") return "gateway";
    return raw;
  };
  const nodes = Array.isArray(engine.nodes)
    ? engine.nodes.map((n) => ({ ...n, type: mapType(n?.type) }))
    : engine.nodes;
  return { ...engine, nodes };
};

const applyEnginePatch = (prevEngine, patch) => {
  if (!prevEngine || !patch) return prevEngine;
  const next = { ...prevEngine };
  const nodes = Array.isArray(next.nodes) ? [...next.nodes] : [];
  const flows = Array.isArray(next.flows) ? [...next.flows] : [];
  const lanes = Array.isArray(next.lanes) ? [...next.lanes] : [];

  const findNodeIndex = (id) => nodes.findIndex((n) => String(n?.id) === String(id));
  const findFlowIndex = (id) => flows.findIndex((f) => String(f?.id) === String(id));
  const findLaneIndex = (id) => lanes.findIndex((l) => String(l?.id) === String(id));

  switch (patch.type) {
    case "ADD_NODE": {
      if (!patch.id) return prevEngine;
      if (findNodeIndex(patch.id) >= 0) return prevEngine;
      nodes.push({
        id: patch.id,
        type: patch.nodeType,
        name: patch.name || "",
        laneId: patch.laneId || undefined,
      });
      next.nodes = nodes;
      return next;
    }
    case "REMOVE_NODE": {
      if (!patch.id) return prevEngine;
      const idx = findNodeIndex(patch.id);
      if (idx < 0) return prevEngine;
      nodes.splice(idx, 1);
      next.nodes = nodes;
      next.flows = flows.filter(
        (f) => String(f?.source) !== String(patch.id) && String(f?.target) !== String(patch.id),
      );
      return next;
    }
    case "RENAME_NODE": {
      if (!patch.id) return prevEngine;
      const idx = findNodeIndex(patch.id);
      if (idx < 0) return prevEngine;
      nodes[idx] = { ...nodes[idx], name: patch.name || "" };
      next.nodes = nodes;
      return next;
    }
    case "ADD_FLOW": {
      if (!patch.id || !patch.sourceId || !patch.targetId) return prevEngine;
      if (findFlowIndex(patch.id) >= 0) return prevEngine;
      flows.push({
        id: patch.id,
        type: "SequenceFlow",
        source: patch.sourceId,
        target: patch.targetId,
        name: patch.name || "",
      });
      next.flows = flows;
      return next;
    }
    case "UPDATE_NODE_LANE": {
      if (!patch.id) return prevEngine;
      const idx = findNodeIndex(patch.id);
      if (idx < 0) return prevEngine;
      nodes[idx] = { ...nodes[idx], laneId: patch.laneId || undefined };
      next.nodes = nodes;
      return next;
    }
    case "RENAME_LANE": {
      if (!patch.id) return prevEngine;
      const idx = findLaneIndex(patch.id);
      if (idx < 0) return prevEngine;
      const nextName = (patch.name || "").trim();
      lanes[idx] = { ...lanes[idx], name: nextName };
      next.lanes = lanes;
      return next;
    }
    case "REMOVE_FLOW": {
      if (!patch.id) return prevEngine;
      const idx = findFlowIndex(patch.id);
      if (idx < 0) return prevEngine;
      flows.splice(idx, 1);
      next.flows = flows;
      return next;
    }
    case "RENAME_FLOW": {
      if (!patch.id) return prevEngine;
      const idx = findFlowIndex(patch.id);
      if (idx < 0) return prevEngine;
      flows[idx] = { ...flows[idx], name: patch.name || "" };
      next.flows = flows;
      return next;
    }
    default:
      return prevEngine;
  }
};

const GUIDE_DISMISS_MS = 90 * 1000;
const GUIDE_MIN_TASKS_PER_LANE = 2;

const getGuideDismissKey = (key) => `guide.dismiss.${key}`;

const wasGuideDismissedRecently = (key) => {
  if (!key || typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(getGuideDismissKey(key));
  const ts = raw ? Number(raw) : 0;
  if (!ts) return false;
  return Date.now() - ts < GUIDE_DISMISS_MS;
};

const dismissGuideCard = (key) => {
  if (!key || typeof window === "undefined") return;
  window.localStorage.setItem(getGuideDismissKey(key), String(Date.now()));
};

const normalizeGuideRuleId = (finding) => {
  const id = String(finding?.id || "");
  const idx = id.indexOf(":");
  return idx >= 0 ? id.slice(0, idx) : id;
};

const buildGuideIndex = (engineJson) => {
  const nodes = Array.isArray(engineJson?.nodes) ? engineJson.nodes : [];
  const flows = Array.isArray(engineJson?.flows) ? engineJson.flows : [];
  const lanes = Array.isArray(engineJson?.lanes) ? engineJson.lanes : [];
  const nodesById = new Map();
  const flowsById = new Map();
  nodes.forEach((n) => {
    if (n?.id) nodesById.set(String(n.id), n);
  });
  flows.forEach((f) => {
    if (f?.id) flowsById.set(String(f.id), f);
  });
  return { nodes, flows, lanes, nodesById, flowsById };
};

const getLaneIdForFinding = (finding, index) => {
  const target = finding?.target || {};
  const targetId = target?.id ? String(target.id) : null;
  if (!targetId) return null;
  if (target.type === "lane") return targetId;
  if (target.type === "sequenceFlow" || target.type === "messageFlow") {
    const flow = index.flowsById.get(targetId);
    if (!flow) return null;
    const sourceNode = index.nodesById.get(String(flow.source || ""));
    if (sourceNode?.laneId) return String(sourceNode.laneId);
    const targetNode = index.nodesById.get(String(flow.target || ""));
    if (targetNode?.laneId) return String(targetNode.laneId);
    return null;
  }
  const node = index.nodesById.get(targetId);
  return node?.laneId ? String(node.laneId) : null;
};

const isTaskLike = (node) => {
  const t = String(node?.type || "").toLowerCase();
  return t.includes("task") || t.includes("activity");
};

const getLaneTasks = (engineJson, laneId) => {
  const nodes = Array.isArray(engineJson?.nodes) ? engineJson.nodes : [];
  return nodes.filter((n) => n?.laneId === laneId && isTaskLike(n));
};

const isLaneDone = (engineJson, laneId, findingsForLane) => {
  const tasks = getLaneTasks(engineJson, laneId);
  if (!tasks.length || tasks.length < GUIDE_MIN_TASKS_PER_LANE) return false;
  return !findingsForLane.some((f) => f?.severity === "HARD");
};

const pickNextLane = (engineJson, findings) => {
  const { lanes } = buildGuideIndex(engineJson);
  if (!lanes.length) return null;
  const emptyLane = lanes.find((lane) => getLaneTasks(engineJson, lane.id).length === 0);
  if (emptyLane) {
    return emptyLane;
  }
  for (const lane of lanes) {
    const laneFindings = findings.filter(
      (f) => getLaneIdForFinding(f, buildGuideIndex(engineJson)) === lane.id,
    );
    if (!isLaneDone(engineJson, lane.id, laneFindings)) {
      return lane;
    }
  }
  return null;
};

const getNodeLabel = (node) =>
  String(node?.name || node?.label || node?.id || "").trim();

const PLACEHOLDER_NODE_NAMES = new Set(["procesny krok", "nova brana", "nove rozhodnutie", "zaciatok", "koniec"]);
const ANGLE_PLACEHOLDER_REGEX = /<[^<>]+>/g;

const isPlaceholderNodeName = (value) => {
  const normalized = normalizeText(value).trim();
  return PLACEHOLDER_NODE_NAMES.has(normalized);
};

const extractAnglePlaceholderTokens = (value) => {
  const matches = String(value || "").match(ANGLE_PLACEHOLDER_REGEX);
  return matches ? matches.map((item) => item.trim()).filter(Boolean) : [];
};

const hasAnglePlaceholderToken = (value) => extractAnglePlaceholderTokens(value).length > 0;

const buildFlowAdjacency = (index) => {
  const incoming = new Map();
  const outgoing = new Map();
  index.nodes.forEach((node) => {
    if (!node?.id) return;
    const id = String(node.id);
    if (!incoming.has(id)) incoming.set(id, 0);
    if (!outgoing.has(id)) outgoing.set(id, 0);
  });
  index.flows.forEach((flow) => {
    const sourceId = flow?.source ? String(flow.source) : null;
    const targetId = flow?.target ? String(flow.target) : null;
    if (sourceId) outgoing.set(sourceId, (outgoing.get(sourceId) || 0) + 1);
    if (targetId) incoming.set(targetId, (incoming.get(targetId) || 0) + 1);
  });
  return { incoming, outgoing };
};

const determineGuidePhase = ({
  hardFindings,
  hasTasks,
  hasAnyEmptyLane,
  missingIncomingTask,
  missingOutgoingTask,
  hasEndEvent,
  hasDisconnectedLanes,
  placeholderNamedNodes,
  renamableNodes,
  isFullyConsistent,
}) => {
  if (hardFindings.length) return "repair";
  if (!hasTasks) return "skeleton";
  if (hasAnyEmptyLane) return "lane_fill";
  if (missingIncomingTask || missingOutgoingTask || !hasEndEvent || hasDisconnectedLanes) return "connections";
  if (placeholderNamedNodes.length || renamableNodes.length) return "refinement";
  if (isFullyConsistent) return "ready";
  return "progress";
};

const pickGuideCard = ({
  engineJson,
  findings,
  activeLaneId,
  lastEditedLaneId,
  uiContext,
  modelSnapshot,
}) => {
  if (!engineJson) return null;
  const index = buildGuideIndex(engineJson);
  const ctxLaneId = activeLaneId || lastEditedLaneId || null;
  const ctxLane = ctxLaneId
    ? index.lanes.find((l) => l?.id === ctxLaneId) || null
    : null;
  const getLaneTaskCount = (laneId) => {
    if (modelSnapshot?.tasksPerLane instanceof Map) {
      return modelSnapshot.tasksPerLane.get(String(laneId || "")) || 0;
    }
    return getLaneTasks(engineJson, laneId).length;
  };
  const { incoming, outgoing } = buildFlowAdjacency(index);
  const taskNodes = index.nodes.filter((n) => isTaskLike(n));
  const hasTasks = taskNodes.length > 0;
  const hardFindings = findings.filter((f) => f?.severity === "HARD");
  const hasEndEvent = index.nodes.some((n) =>
    String(n?.type || "").toLowerCase().includes("end"),
  );
  const hasAnyEmptyLane = index.lanes.some((lane) => getLaneTaskCount(lane.id) === 0);
  const pickTask = (predicate) => {
    if (!taskNodes.length) return null;
    if (ctxLaneId) {
      const inCtx = taskNodes.find(
        (node) => String(node?.laneId || "") === String(ctxLaneId) && predicate(node),
      );
      if (inCtx) return inCtx;
    }
    return taskNodes.find(predicate) || null;
  };
  const missingOutgoingTask = pickTask((node) => {
    const id = node?.id ? String(node.id) : "";
    return id && (outgoing.get(id) || 0) === 0;
  });
  const missingIncomingTask = pickTask((node) => {
    const id = node?.id ? String(node.id) : "";
    return id && (incoming.get(id) || 0) === 0;
  });
  const hasDanglingTask = Boolean(missingIncomingTask || missingOutgoingTask);
  const hasDisconnectedLanes =
    typeof modelSnapshot?.lanesDisconnected === "boolean"
      ? modelSnapshot.lanesDisconnected
      : findings.some((f) => normalizeGuideRuleId(f) === "lane_is_disconnected");
  const placeholderNamedNodes = index.nodes.filter((node) => {
    const type = String(node?.type || "").toLowerCase();
    if (!(type.includes("task") || type.includes("gateway") || type.includes("start") || type.includes("end"))) {
      return false;
    }
    return hasAnglePlaceholderToken(node?.name || node?.label || "");
  });
  const renamableNodes = index.nodes.filter((node) => {
    const type = String(node?.type || "").toLowerCase();
    if (!(type.includes("task") || type.includes("gateway") || type.includes("start") || type.includes("end"))) {
      return false;
    }
    return isPlaceholderNodeName(node?.name || "");
  });
  const isFullyConsistent =
    !hardFindings.length &&
    hasEndEvent &&
    !hasDanglingTask &&
    !hasAnyEmptyLane &&
    !hasDisconnectedLanes;
  const phase = determineGuidePhase({
    hardFindings,
    hasTasks,
    hasAnyEmptyLane,
    missingIncomingTask,
    missingOutgoingTask,
    hasEndEvent,
    hasDisconnectedLanes,
    placeholderNamedNodes,
    renamableNodes,
    isFullyConsistent,
  });

  if (phase === "repair") {
    const hardInCtx = ctxLaneId
      ? hardFindings.find((f) => getLaneIdForFinding(f, index) === ctxLaneId)
      : null;
    const chosen = hardInCtx || hardFindings[0];
    const laneIdForHard = getLaneIdForFinding(chosen, index);
    const ruleId = normalizeGuideRuleId(chosen);
    const rawMessage = String(chosen?.message || "");
    const rawProposal = String(chosen?.proposal || "");
    const combined = `${rawMessage} ${rawProposal}`.toLowerCase();
    const isGatewaySingleOutgoing =
      ruleId === "gateway_diverging_needs_two_outgoing" ||
      (combined.includes("diverging gateway") && combined.includes("outgoing"));
    return {
      key: `hard:${chosen.id}`,
      phase,
      scope: laneIdForHard ? "lane" : "global",
      laneId: laneIdForHard || null,
      title: "Poďme opraviť tento bod",
      message: isGatewaySingleOutgoing
        ? "Máme tu rozhodnutie, ktoré ešte nie je dokončené. Zatiaľ z neho vedie len jedna možnosť. Poďme doplniť druhú vetvu, aby bolo jasné, čo sa stane pri inom výsledku."
        : `Na tomto mieste máme malú nezrovnalosť: ${chosen.message}${chosen.proposal ? ` ${chosen.proposal}` : ""}. Poďme ju upraviť skôr, než pôjdeme ďalej.`,
      primary: laneIdForHard
        ? { label: "Otvoriť rolu", action: "OPEN_LANE", payload: { laneId: laneIdForHard } }
        : null,
    };
  }

  if (phase === "skeleton" && index.lanes.length) {
    const firstEmptyLane = index.lanes.find((lane) => getLaneTaskCount(lane.id) === 0) || null;
    if (!firstEmptyLane) return null;
    return {
      key: "process_empty",
      phase,
      scope: "global",
      title: "Kostra je hotová",
      message:
        `Máme pripravenú kostru procesu. Poďme začať rolou „${firstEmptyLane.name || firstEmptyLane.id}“ a doplniť do nej aspoň 2 až 3 konkrétne kroky. Rolu si otvoríme kliknutím na ňu v mape alebo tlačidlom vpravo. Píšme krátko a slovesom, napríklad Overím..., Skontrolujem..., Odošlem....`,
      primary: firstEmptyLane
        ? { label: "Otvoriť prvú rolu", action: "OPEN_LANE", payload: { laneId: firstEmptyLane.id } }
        : null,
    };
  }

  if (phase === "lane_fill" && ctxLaneId && ctxLane) {
    const laneFindings = findings.filter(
      (f) => getLaneIdForFinding(f, index) === ctxLaneId,
    );
    const laneDone = isLaneDone(engineJson, ctxLaneId, laneFindings);
    const currentLaneTaskCount = getLaneTaskCount(ctxLaneId);
    const nextLane =
      index.lanes.find((lane) => lane.id !== ctxLaneId && getLaneTaskCount(lane.id) === 0) ||
      pickNextLane(engineJson, findings);
    if (!laneDone && currentLaneTaskCount > 0 && currentLaneTaskCount < GUIDE_MIN_TASKS_PER_LANE) {
      return {
        key: `lane_progress:${ctxLaneId}`,
        phase,
        scope: "lane",
        laneId: ctxLaneId,
        title: "Ešte chvíľu zostaň v tejto role",
        message: `Máme základ role „${ctxLane.name || ctxLane.id}“. Poďme do nej doplniť ešte aspoň jeden krok, aby bolo jasné, čo sa tu deje od začiatku po odovzdanie ďalej.`,
        primary: { label: "Pokračovať v role", action: "OPEN_LANE", payload: { laneId: ctxLaneId } },
      };
    }
    if (laneDone && nextLane && nextLane.id !== ctxLaneId) {
      return {
        key: `lane_done:${ctxLaneId}->${nextLane.id}`,
        phase,
        scope: "lane",
        laneId: ctxLaneId,
        title: "Poďme na ďalšiu rolu",
        message: `Rola „${ctxLane.name || ctxLane.id}“ už vyzerá dobre. Teraz poďme otvoriť rolu „${nextLane.name || nextLane.id}“ a doplniť jej hlavné kroky, aby bol proces kompletný naprieč všetkými účastníkmi.`,
        primary: { label: "Otvoriť ďalšiu rolu", action: "OPEN_LANE", payload: { laneId: nextLane.id } },
      };
    }
  }

  if (phase === "lane_fill") {
    const emptyLaneFinding = findings.find(
      (f) => normalizeGuideRuleId(f) === "lane_is_empty",
    );
    if (emptyLaneFinding) {
      const laneId = emptyLaneFinding?.target?.id;
      const lane = index.lanes.find((l) => l?.id === laneId);
      if (lane) {
        return {
          key: `lane_empty:${lane.id}`,
          phase,
          scope: "lane",
          laneId: lane.id,
          title: "Táto rola ešte čaká na kroky",
          message: `V role „${lane.name || lane.id}“ ešte nemáme žiadne kroky. Poďme ju otvoriť a doplniť aspoň prvý konkrétny krok, aby bolo jasné, čo sa tu deje a čo má táto rola odovzdať ďalej.`,
          primary: { label: "Otvoriť rolu", action: "OPEN_LANE", payload: { laneId: lane.id } },
        };
      }
    }
  }

  if (phase === "connections") {
    const danglingNodes = index.nodes.filter((n) => {
      const id = n?.id ? String(n.id) : "";
      if (!id) return false;
      const type = String(n?.type || "").toLowerCase();
      if (type.includes("end")) return false;
      const hasIn = (incoming.get(id) || 0) > 0;
      const hasOut = (outgoing.get(id) || 0) > 0;
      return hasIn && !hasOut;
    });
    const inReview = Boolean(uiContext?.mentorOpen || uiContext?.storyOpen);
    if (!hasEndEvent && (danglingNodes.length > 0 || inReview)) {
      const pickNode = ctxLaneId
        ? danglingNodes.find((n) => String(n?.laneId || "") === ctxLaneId) || danglingNodes[0]
        : danglingNodes[0];
      if (pickNode) {
        const laneId = pickNode?.laneId ? String(pickNode.laneId) : null;
        const label = getNodeLabel(pickNode);
        return {
          key: `missing_end:${pickNode.id}`,
          phase,
          scope: laneId ? "lane" : "global",
          laneId,
          title: "Poďme uzavrieť proces",
          message: `Kostra už sa pekne črtá. Ak je aktivita „${label || "tento krok"}“ posledný bod procesu, poďme kliknúť na ňu na mape a potom použiť tlačidlo „Koniec sem“. Tým jasne určíme, kde sa tok procesu uzatvára.`,
          primary: {
            label: "Ukáž miesto",
            action: "FOCUS_NODE",
            payload: { nodeId: pickNode.id, laneId, nodeName: label || "" },
          },
          tertiary: {
            label: "Koniec sem",
            action: "CONNECT_END_HERE",
            payload: { nodeId: pickNode.id, nodeName: label || "", laneId },
          },
        };
      }
    }
    if (missingOutgoingTask) {
      const laneId = missingOutgoingTask?.laneId ? String(missingOutgoingTask.laneId) : null;
      const label = getNodeLabel(missingOutgoingTask);
      return {
        key: `task_no_out:${missingOutgoingTask.id}`,
        phase,
        scope: laneId ? "lane" : "global",
        laneId,
        title: "Tu chýba ďalší krok",
        message: `Aktivita „${label || "tento krok"}“ zatiaľ nemá pokračovanie. Poďme kliknúť na tento krok na mape a rozhodnúť: buď z neho potiahneme pokračovanie na ďalší krok, alebo použijeme „Koniec sem“, ak sa proces uzatvára práve tu.`,
        primary: {
          label: "Ukáž miesto",
          action: "FOCUS_NODE",
          payload: { nodeId: missingOutgoingTask.id, laneId, nodeName: label || "" },
        },
        tertiary: {
          label: "Koniec sem",
          action: "CONNECT_END_HERE",
          payload: { nodeId: missingOutgoingTask.id, laneId, nodeName: label || "" },
        },
      };
    }
    if (missingIncomingTask) {
      const laneId = missingIncomingTask?.laneId ? String(missingIncomingTask.laneId) : null;
      const label = getNodeLabel(missingIncomingTask);
      return {
        key: `task_no_in:${missingIncomingTask.id}`,
        phase,
        scope: laneId ? "lane" : "global",
        laneId,
        title: "Tomuto kroku ešte niečo predchádza",
        message: `Aktivita „${label || "tento krok"}“ ešte nemá predchodcu. Poďme sa na mape pozrieť, z ktorého kroku sem má prísť tok procesu, aby bola väzba medzi rolami alebo krokmi jasná.`,
        primary: {
          label: "Ukáž miesto",
          action: "FOCUS_NODE",
          payload: { nodeId: missingIncomingTask.id, laneId, nodeName: label || "" },
        },
      };
    }
    const disconnectedFinding = findings.find(
      (f) => normalizeGuideRuleId(f) === "lane_is_disconnected",
    );
    if (disconnectedFinding) {
      const nextLane = pickNextLane(engineJson, findings);
      return {
        key: "lanes_disconnected",
        phase,
        scope: nextLane ? "lane" : "global",
        laneId: nextLane?.id || null,
        title: "Poďme spojiť role do jedného toku",
        message: nextLane
          ? `Máme doplnené kroky. Teraz z nich poďme spraviť plynulý proces od začiatku po koniec. Začneme v role „${nextLane.name || nextLane.id}“, kde ešte chýba väzba na ďalšiu časť procesu.`
          : "Máme doplnené kroky. Teraz z nich poďme spraviť plynulý proces od začiatku po koniec a doplniť väzby medzi rolami tam, kde ešte chýbajú.",
        primary: nextLane
          ? { label: "Otvoriť rolu", action: "OPEN_LANE", payload: { laneId: nextLane.id } }
          : null,
      };
    }
  }

  if (phase === "refinement") {
    if (placeholderNamedNodes.length) {
      const pickNode = ctxLaneId
        ? placeholderNamedNodes.find((node) => String(node?.laneId || "") === String(ctxLaneId)) || placeholderNamedNodes[0]
        : placeholderNamedNodes[0];
      const laneId = pickNode?.laneId ? String(pickNode.laneId) : null;
      const placeholderTokens = Array.from(
        new Set(
          placeholderNamedNodes.flatMap((node) =>
            extractAnglePlaceholderTokens(node?.name || node?.label || ""),
          ),
        ),
      );
      const exampleToken = placeholderTokens[0] || "<podmienka>";
      const count = placeholderNamedNodes.length;
      return {
        key: `placeholder_node:${pickNode?.id || "any"}`,
        phase,
        scope: laneId ? "lane" : "global",
        laneId,
        title: "Poďme doladiť názvy",
        message:
          count > 1
            ? `Máme ešte ${count} placeholder názvy, napríklad ${exampleToken}. Teraz už nejde o kostru, ale o spresnenie detailov. Poďme ich premenovať na reálne pomenovania, aby bol proces zrozumiteľný aj pre ďalších ľudí.`
            : `Máme tu ešte placeholder názov, napríklad ${exampleToken}. Poďme doladiť detail a premenovať ho na reálny názov.`,
        primary: pickNode?.id
          ? { label: "Ukáž miesto", action: "FOCUS_NODE", payload: { nodeId: pickNode.id, laneId } }
          : null,
      };
    }
    if (renamableNodes.length) {
      const pickNode = ctxLaneId
        ? renamableNodes.find((node) => String(node?.laneId || "") === String(ctxLaneId)) || renamableNodes[0]
        : renamableNodes[0];
      const laneId = pickNode?.laneId ? String(pickNode.laneId) : null;
      return {
        key: `unnamed_node:${pickNode?.id || "any"}`,
        phase,
        scope: laneId ? "lane" : "global",
        laneId,
        title: "Ešte spresnime pomenovania",
        message: "Proces už vyzerá dobre. Teraz poďme doladiť posledné všeobecné názvy ako „Procesný krok“ alebo „Nové rozhodnutie“, aby bolo hneď jasné, čo sa v procese deje.",
        primary: pickNode?.id
          ? { label: "Ukáž miesto", action: "FOCUS_NODE", payload: { nodeId: pickNode.id, laneId } }
          : null,
      };
    }
  }

  if (phase === "progress" && ctxLane && getLaneTaskCount(ctxLane.id) < GUIDE_MIN_TASKS_PER_LANE) {
    return {
      key: `lane_progress:${ctxLane.id}`,
      phase,
      scope: "lane",
      laneId: ctxLane.id,
      title: "Ešte jeden alebo dva kroky",
      message: `V role „${ctxLane.name || ctxLane.id}“ už niečo máme. Poďme v nej ešte chvíľu zostať a pridať jeden alebo dva kroky, aby bol jej priebeh jasnejší, a potom sa posunieme ďalej.`,
      primary: { label: "Pokračovať v role", action: "OPEN_LANE", payload: { laneId: ctxLane.id } },
    };
  }

  const isPersistedOrOrg =
    uiContext?.modelSourceKind === "org" || uiContext?.hasUnsavedChanges === false;
  if (phase === "ready" && !isPersistedOrOrg) {
    return {
      key: "process_ready_for_save",
      phase,
      scope: "global",
      title: "Proces je pripravený",
      message: "Máme konzistentnú mapu, ktorá pôsobí ucelene. Teraz je správny moment uložiť proces. Potom sa spolu rozhodneme, či s ním budeme ďalej pracovať v pieskovisku alebo ho presunieme do organizácie.",
      primary: { label: "Uložiť proces", action: "SAVE_PROCESS" },
    };
  }

  if (phase === "ready" && isPersistedOrOrg) {
    return {
      key: "process_complete",
      phase,
      scope: "global",
      title: "Proces pôsobí hotovo",
      message: "Vyzerá to dobre. Máme ucelený a pomenovaný proces pripravený na ďalší krok. Teraz sa už len rozhodneme, či ho necháme v pieskovisku alebo ho presunieme do organizácie.",
      primary: { label: "Presunúť do organizácie", action: "MOVE_TO_ORG" },
      secondary: { label: "Zostať v pieskovisku", action: "STAY_IN_SANDBOX" },
    };
  }

  return null;
};

const normalizeAscii = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const detectDecision = (line) => {
  const text = normalizeText(line).trim();
  return /^(ak|ked)\b/.test(text);
};

const detectParallel = (line) => {
  const text = normalizeText(line);
  return (
    text.startsWith("zaroven") ||
    text.startsWith("sucasne") ||
    text.startsWith("zároveň") ||
    text.startsWith("súčasne") ||
    text.startsWith("subezne") ||
    text.startsWith("súbežne") ||
    text.startsWith("paralelne") ||
    text.startsWith("naraz") ||
    text.startsWith("popri tom") ||
    text.startsWith("popritom") ||
    text.includes(" zaroven ") ||
    text.includes(" sucasne ") ||
    text.includes(" zároveň ") ||
    text.includes(" súčasne ") ||
    text.includes(" subezne ") ||
    text.includes(" súbežne ") ||
    text.includes(" paralelne ") ||
    text.includes(" naraz ") ||
    text.includes(" popri tom ") ||
    text.includes(" popritom ")
  );
};

const countStructures = (lines) => {
  let decisions = 0;
  let parallels = 0;
  lines.forEach((line) => {
    if (detectDecision(line)) decisions += 1;
    if (detectParallel(line)) parallels += 1;
  });
  return { decisions, parallels };
};

const countParallelHintItems = (line) => {
  const normalized = normalizeText(line).trim();
  if (!normalized) return 0;
  const triggerMatch = normalized.match(/\b(paralelne|sucasne|naraz)\b/i);
  if (!triggerMatch) return 0;
  const triggerStart = typeof triggerMatch.index === "number" ? triggerMatch.index : 0;
  const afterTrigger = normalized.slice(triggerStart);
  const body = afterTrigger.replace(
    /^(paralelne|sucasne|naraz)\s*[:,-]?\s*/i,
    "",
  );
  if (!body.trim()) return 0;
  return body
    .split(/\s*;\s*|\s*,\s*/i)
    .map((part) => part.trim())
    .filter(Boolean).length;
};

const determineInlineHint = (lines) => {
  const lastLine = [...lines].reverse().find((line) => line.trim());
  if (!lastLine) return null;
  const normalizedLine = normalizeText(lastLine);
  const decisionMatch = normalizedLine.match(/\b(ak|ked)\b/);
  const parallelMatch = normalizedLine.match(/\b(paralelne|sucasne|naraz)\b/);

  const decisionHint = (() => {
    if (!decisionMatch) return null;
    const decisionIdx = typeof decisionMatch.index === "number" ? decisionMatch.index : 0;
    const afterTrigger = normalizedLine.slice(decisionIdx).replace(/^(ak|ked)\b\s*/i, "");
    const hasTak = /\btak\b/.test(afterTrigger);
    const hasInak = /\binak\b/.test(afterTrigger);
    const beforeTak = hasTak ? afterTrigger.split(/\btak\b/i)[0] || "" : afterTrigger;
    const afterTak = hasTak ? (afterTrigger.split(/\btak\b/i)[1] || "") : "";
    const beforeInak = hasInak ? (afterTrigger.split(/\binak\b/i)[0] || "") : afterTak;
    const afterInak = hasInak ? (afterTrigger.split(/\binak\b/i)[1] || "") : "";
    const trimmedAfterTrigger = afterTrigger.trim();
    const conditionLen = beforeTak.replace(/[,\s]+/g, "").length;
    const isTooShort = conditionLen < 2;
    const yesStepText = String(beforeInak || "")
      .replace(/^(\s*[,;:-]\s*)+/, "")
      .trim();
    const noStepText = String(afterInak || "")
      .replace(/^(\s*[,;:-]\s*)+/, "")
      .trim();
    const yesHasMultiple = /,\s*\S/.test(yesStepText);
    const noHasMultiple = /,\s*\S/.test(noStepText);
    if (isTooShort) {
      return {
        kind: "decision",
        state: "D0",
        complete: false,
        message:
          trimmedAfterTrigger.length <= 2
            ? "Vyzerá to na rozhodnutie. Najprv dopíš, kedy sa to stane. Napríklad: „Ak je žiadosť úplná ...“."
            : "Dobre. Teraz pokračuj slovom „tak“, aby bolo jasné, čo sa stane potom.",
      };
    }
    if (!hasTak) {
      return {
        kind: "decision",
        state: "D1",
        complete: false,
        message: "Teraz dopíš „tak“ a hneď zaň prvý krok. Napríklad: „tak schválim žiadosť“.",
      };
    }
    if (!yesStepText) {
      return {
        kind: "decision",
        state: "D1A",
        complete: false,
        message: "Za „tak“ dopíš prvý krok, ktorý sa má stať potom.",
      };
    }
    if (!hasInak) {
      return {
        kind: "decision",
        state: "D2",
        complete: false,
        message: yesHasMultiple
          ? "Táto časť vyzerá dobre. Teraz dopíš „inak“ a potom prvý krok v druhom prípade."
          : "Ak po „tak“ nasledujú ešte ďalšie kroky, oddeľ ich čiarkou. Keď máš túto časť hotovú, dopíš „inak“.",
      };
    }
    if (!noStepText) {
      return {
        kind: "decision",
        state: "D2A",
        complete: false,
        message: "Za „inak“ dopíš prvý krok. Napríklad: „inak vrátim žiadosť na doplnenie“.",
      };
    }
    return {
      kind: "decision",
      state: "D3",
      complete: true,
      message: noHasMultiple
        ? "Rozhodnutie je OK ✅ Obe časti sú vyplnené a môžeš ich ešte spresniť."
        : "Rozhodnutie je OK ✅ Ak po „inak“ nasledujú ešte ďalšie kroky, oddeľ ich čiarkou.",
    };
  })();

  const parallelHint = (() => {
    if (!parallelMatch) return null;
    const itemCount = countParallelHintItems(lastLine);
    if (itemCount <= 0) {
      return {
        kind: "parallel",
        state: "P0",
        complete: false,
        message: "Vyzerá to na súbežné kroky. Doplň aspoň 2 činnosti a oddeľ ich čiarkou alebo slovom „a“.",
      };
    }
    if (itemCount === 1) {
      return {
        kind: "parallel",
        state: "P1",
        complete: false,
        message: "Máme prvú súbežnú činnosť. Pridaj ešte jednu, aby bolo jasné, čo sa deje naraz.",
      };
    }
    return {
      kind: "parallel",
      state: "P2",
      complete: true,
      message: "Súbežné kroky sú OK ✅ Ak chceš, ďalšiu činnosť pridáš po čiarke.",
    };
  })();

  if (decisionHint && parallelHint) {
    if (!decisionHint.complete) return { message: decisionHint.message };
    if (!parallelHint.complete) return { message: parallelHint.message };
    return { message: decisionHint.message };
  }
  if (decisionHint) return { message: decisionHint.message };
  if (parallelHint) return { message: parallelHint.message };
  return null;
};

const analyzeLaneLine = (lineText) => {
  const raw = String(lineText || "");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ascii = normalizeAscii(trimmed);
  const isXor = /^(ak|ked)\b/.test(ascii);
  const isAnd = /^(paralelne|zaroven|sucasne|subezne|naraz|popritom|popri)\b/.test(ascii);
  const hasTak = /\btak\b/.test(ascii);
  const hasInak = /\binak\b/.test(ascii);

  if (isXor) {
    let warning = "";
    if (!hasTak || !hasInak) {
      warning = "Dopln format: 'tak' aj 'inak'.";
    }
    return {
      type: "xor",
      badge: "ROZHODNUTIE",
      hint: "Rozhodnutie: „Ak <podmienka> tak <krok>, inak <krok/koniec>“.",
      warning,
      success: warning ? "" : "Super, toto je rozhodnutie v procese.",
    };
  }

  if (isAnd) {
    const parts = ascii
      .replace(/^paralelne:?/, "")
      .replace(/^zaroven/, "")
      .replace(/^sucasne/, "")
      .replace(/^subezne/, "")
      .replace(/^naraz/, "")
      .replace(/^popritom/, "")
      .replace(/^popri/, "");
    const stepCount = parts
      .split(/\s*;\s*|\s*,\s*/i)
      .map((part) => part.trim())
      .filter(Boolean).length;
    const warning = stepCount < 2 ? "Pridaj aspoň 2 kroky a oddeľ ich ; alebo ,." : "";
    return {
      type: "and",
      badge: "PARALELNE",
      hint: "Paralela: „Paralelne: krok; krok; krok“ alebo „Paralelne: krok, krok, krok“.",
      warning,
      success: warning ? "" : "Super, toto je paralelné rozdelenie.",
    };
  }

  return {
    type: "task",
    badge: "KROK",
    hint: "Toto bude bežný krok v procese.",
    warning: "",
    success: "",
  };
};

const splitLinearLaneSteps = (lineText) =>
  String(lineText || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const splitLaneBlocks = (text) =>
  String(text || "")
    .split(/\r?\n/)
    .flatMap((line) =>
      String(line || "")
        .split(/\.\s+/)
        .map((part) => part.trim().replace(/\.$/, ""))
        .filter(Boolean),
    );

const splitInlineSpecialLaneStep = (lineText) => {
  const text = String(lineText || "").trim();
  if (!text) return { prefixSteps: [], specialStep: null };
  const specialMatch = text.match(
    /\b(Ak|Keď|Ked|paralelne|zároveň|zaroven|súčasne|sucasne|súbežne|subezne|naraz|popri tom|popritom)\b/i,
  );
  if (!specialMatch || typeof specialMatch.index !== "number" || specialMatch.index <= 0) {
    return { prefixSteps: [], specialStep: null };
  }
  const prefix = text.slice(0, specialMatch.index).trim().replace(/,+\s*$/, "");
  if (!prefix) return { prefixSteps: [], specialStep: null };
  return {
    prefixSteps: splitLinearLaneSteps(prefix),
    specialStep: text.slice(specialMatch.index).trim() || null,
  };
};

const analyzeLaneLines = (text) =>
  splitLaneBlocks(text)
    .flatMap((line, idx) => {
      const { prefixSteps, specialStep } = splitInlineSpecialLaneStep(line);
      if (prefixSteps.length && specialStep) {
        const prefixItems = prefixSteps.map((taskText, taskIdx) => ({
          id: `${idx}-prefix-${taskIdx}-${taskText.length}`,
          lineNumber: idx + 1,
          text: taskText,
          type: "task",
          badge: "KROK",
          hint: "Toto bude bežný krok v procese.",
          warning: "",
          success: "",
        }));
        const specialAnalysis = analyzeLaneLine(specialStep);
        if (!specialAnalysis) return prefixItems;
        return [
          ...prefixItems,
          {
            id: `${idx}-special-${specialStep.length}`,
            lineNumber: idx + 1,
            text: specialStep.trim(),
            ...specialAnalysis,
          },
        ];
      }
      const analysis = analyzeLaneLine(line);
      if (!analysis) return [];
      if (analysis.type === "task") {
        const taskSteps = splitLinearLaneSteps(line);
        const items = (taskSteps.length ? taskSteps : [line.trim()]).map((taskText, taskIdx) => ({
          id: `${idx}-${taskIdx}-${taskText.length}`,
          lineNumber: idx + 1,
          text: taskText,
          ...analysis,
        }));
        return items;
      }
      return {
        id: `${idx}-${line.length}`,
        lineNumber: idx + 1,
        text: line.trim(),
        ...analysis,
      };
    })
    .filter(Boolean);

const mapGeneratorInputToPayload = (generatorInput) => {
  const roles = splitLines(generatorInput.roles);
  const steps = splitLines(generatorInput.mainSteps);
  const processName = (generatorInput.processName || "").trim() || "Process";
  return {
    process_name: processName,
    roles,
    start_trigger: generatorInput.trigger,
    input: generatorInput.input,
    output: generatorInput.output,
    steps,
  };
};

const DEMO_LIMITS = {
  maxRoles: 2,
  maxStepsPerLane: 5,
  maxObjectsPerLane: 5,
  maxDecisions: 1,
  maxNodes: 12,
  maxFlows: 15,
};

const DEMO_DEFAULTS = {
  processName: "Schválenie žiadosti",
  roles: "Žiadateľ\nSpracovateľ",
  trigger: "Prišla nová žiadosť",
  output: "Žiadosť je schválená alebo zamietnutá",
};

const DEMO_TEMPLATES = [
  {
    id: "approval",
    label: "Schválenie žiadosti",
    processName: "Schválenie žiadosti",
    roles: "Žiadateľ\nSpracovateľ",
    trigger: "Prišla nová žiadosť",
    output: "Žiadosť je schválená alebo zamietnutá",
  },
  {
    id: "invoice",
    label: "Spracovanie faktúry",
    processName: "Spracovanie faktúry",
    roles: "Dodávateľ\nÚčtovník",
    trigger: "Prišla faktúra od dodávateľa",
    output: "Faktúra je schválená a zaúčtovaná",
  },
  {
    id: "ticket",
    label: "Podpora zákazníka",
    processName: "Riešenie zákazníckeho ticketu",
    roles: "Zákazník\nPodpora",
    trigger: "Zákazník vytvorí ticket",
    output: "Ticket je vyriešený a uzatvorený",
  },
  {
    id: "order",
    label: "Objednávka",
    processName: "Spracovanie objednávky",
    roles: "Zákazník\nSkladník",
    trigger: "Prijatá nová objednávka",
    output: "Objednávka je expedovaná",
  },
  {
    id: "onboarding",
    label: "Nástup zamestnanca",
    processName: "Nástup nového zamestnanca",
    roles: "HR\nIT",
    trigger: "Podpísaná pracovná zmluva",
    output: "Zamestnanec má prístupy a onboarding plán",
  },
];

const HOME_GUIDE_MESSAGES = [
  "Pomôžem ti začať od názvu procesu a rolí, aby kostra dávala zmysel hneď od začiatku.",
  "Keď sa zasekneš, navediem ťa na ďalší krok, ktorý má teraz najväčší zmysel.",
  "Strážim, aby sa z rozpracovaných krokov stal plynulý proces od začiatku po koniec.",
  "Ukážem ti, kde chýba pokračovanie, kde sa proces uzatvára a čo ešte treba doplniť.",
  "Pomôžem ti pomenovať kroky tak, aby mapa bola zrozumiteľná aj pre ďalších ľudí v tíme.",
  "Keď doplníš kostru, posuniem ťa do role alebo miesta, ktoré sa oplatí riešiť ako ďalšie.",
  "Nevypisujem len chyby. Snažím sa povedať, čo už máš dobre a čo je teraz najbližší užitočný krok.",
  "Keď otvoríš rozpracovaný model, pomôžem ti zorientovať sa a nadviazať tam, kde si skončil.",
  "Z BPMN nechcem robiť technický labyrint. Cieľ je, aby si vždy vedel, čo spraviť ďalej.",
  "Som tu na to, aby sa z nápadu postupne stala čistá procesná mapa, nie chaotická kresba.",
];

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const countExclusiveGateways = (engine) =>
  (Array.isArray(engine?.nodes) ? engine.nodes : []).filter((node) =>
    String(node?.type || "").toLowerCase().includes("exclusivegateway"),
  ).length;

const countLaneObjects = (engine, laneId) =>
  (Array.isArray(engine?.nodes) ? engine.nodes : []).filter(
    (node) => String(node?.laneId || "") === String(laneId || ""),
  ).length;

export default function LinearWizardPage({ currentUser = null, isDemo = false }) {
  const navigate = useNavigate();
  const { modelId: routeModelId } = useParams();
  const isDemoMode = Boolean(isDemo);
  const fileInputRef = useRef(null);
  const { setState: setHeaderStepperState } = useHeaderStepper();
  const [processCard, setProcessCard] = useState(() => createEmptyProcessCardState());
  const [demoSetupOpen, setDemoSetupOpen] = useState(isDemoMode);
  const [demoBuilding, setDemoBuilding] = useState(false);
  const [demoBuildStep, setDemoBuildStep] = useState(0);
  const [demoIntroError, setDemoIntroError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [engineJson, setEngineJson] = useState(null);
  const [xml, setXml] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [loadLoading, setLoadLoading] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [selectedLane, setSelectedLane] = useState(null);
  const [laneDescription, setLaneDescription] = useState("");
  const [laneInsertOpen, setLaneInsertOpen] = useState(false);
  const [laneInsertType, _setLaneInsertType] = useState("task");
  const [laneInsertInputs, setLaneInsertInputs] = useState(() => createLaneInsertInputs());
  const modelerRef = useRef(null);
  const engineJsonRef = useRef(null);
  const relayoutSchedulerRef = useRef(null);
  const [relayouting, setRelayouting] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [modelsActionLoading, setModelsActionLoading] = useState(false);
  const [pushModelLoadingIds, setPushModelLoadingIds] = useState(() => new Set());
  const [myOrgsEmpty, setMyOrgsEmpty] = useState(null);
  const [modelsSearch, setModelsSearch] = useState("");
  const renderModeRef = useRef("full");
  const [myOrgs, setMyOrgs] = useState([]);
  const [activeOrgId, setActiveOrgId] = useState(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("ACTIVE_ORG_ID");
  });
  const [activeOrgName, setActiveOrgName] = useState("");
  const [activeOrgRole, setActiveOrgRole] = useState("");
  const activeOrgCapabilities = useMemo(() => getOrgCapabilities(activeOrgRole), [activeOrgRole]);
  const [railSections, setRailSections] = useState({
    org: false,
    process: false,
    mentor: false,
    save: false,
    env: false,
    project: false,
  });
  const guideEnabled = true;
  const [guideState, setGuideState] = useState(null);
  const [guideFindings, setGuideFindings] = useState([]);
  const [guideHighlight, setGuideHighlight] = useState(null);
  const [homeGuideMessageIndex, setHomeGuideMessageIndex] = useState(0);
  const [activeLaneId, setActiveLaneId] = useState(null);
  const [modelVersion, setModelVersion] = useState(0);
  const [lastEditedLaneId, setLastEditedLaneId] = useState(null);
  const [modelSource, setModelSource] = useState({ kind: "sandbox" });
  const [orgReadOnly, setOrgReadOnly] = useState(false);
  const [expandedModelGroups, setExpandedModelGroups] = useState([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mentorOpen, setMentorOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [laneOpen, setLaneOpen] = useState(false);
  const [storyDoc, setStoryDoc] = useState(null);
  const [storyStale, setStoryStale] = useState(false);
  const [storyGeneratedAt, setStoryGeneratedAt] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgTree, setOrgTree] = useState(null);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgError, setOrgError] = useState(null);
  const [selectedOrgFolderId, setSelectedOrgFolderId] = useState("root");
  const [expandedOrgFolders, setExpandedOrgFolders] = useState({ root: true });
  const [orgMenuNodeId, setOrgMenuNodeId] = useState(null);
  const [orgMenuAnchor, setOrgMenuAnchor] = useState(null);
  const [orgVersionsOpen, setOrgVersionsOpen] = useState(false);
  const [orgVersionsNode, setOrgVersionsNode] = useState(null);
  const [orgVersionsItems, setOrgVersionsItems] = useState([]);
  const [orgVersionsLoading, setOrgVersionsLoading] = useState(false);
  const [orgVersionsError, setOrgVersionsError] = useState(null);
  const [orgVersionPreview, setOrgVersionPreview] = useState(null);
  const [orgEditorPresence, setOrgEditorPresence] = useState({});
  const [orgMoveModalOpen, setOrgMoveModalOpen] = useState(false);
  const [orgMoveNode, setOrgMoveNode] = useState(null);
  const [orgMoveTargetFolderId, setOrgMoveTargetFolderId] = useState("root");
  const [orgMoveCurrentParentId, setOrgMoveCurrentParentId] = useState("root");
  const [orgMoveLoading, setOrgMoveLoading] = useState(false);
  const [orgMoveError, setOrgMoveError] = useState(null);
  const [orgDeleteConfirmOpen, setOrgDeleteConfirmOpen] = useState(false);
  const [orgDeleteFinalConfirmOpen, setOrgDeleteFinalConfirmOpen] = useState(false);
  const [orgDeleteNode, setOrgDeleteNode] = useState(null);
  const [orgDeleteLoading, setOrgDeleteLoading] = useState(false);
  const [orgDeleteError, setOrgDeleteError] = useState(null);
  const [orgDeleteRequestReason, setOrgDeleteRequestReason] = useState("");
  const [orgPushModalOpen, setOrgPushModalOpen] = useState(false);
  const [orgPushModel, setOrgPushModel] = useState(null);
  const [orgPushTargetFolderId, setOrgPushTargetFolderId] = useState("root");
  const [orgPushLoading, setOrgPushLoading] = useState(false);
  const [orgPushError, setOrgPushError] = useState(null);
  const [orgPushExpandedFolders, setOrgPushExpandedFolders] = useState({ root: true });
  const [orgPushConflictOpen, setOrgPushConflictOpen] = useState(false);
  const [orgPushConflictMatches, setOrgPushConflictMatches] = useState([]);
  const [orgPushConflictName, setOrgPushConflictName] = useState("");
  const [orgPushConflictSelectedId, setOrgPushConflictSelectedId] = useState(null);
  const [orgPushOverwriteConfirmOpen, setOrgPushOverwriteConfirmOpen] = useState(false);
  const [orgEditConfirmOpen, setOrgEditConfirmOpen] = useState(false);
  const [orgToast, setOrgToast] = useState("");
  const orgToastTimerRef = useRef(null);
  const orgTreeRef = useRef(null);
  const [orgPulseTargetId, setOrgPulseTargetId] = useState(null);
  const [orgMoveHighlightFolderId, setOrgMoveHighlightFolderId] = useState(null);
  const [processStatusByModelId, setProcessStatusByModelId] = useState(() => new Map());
  const [orgSearchQuery, setOrgSearchQuery] = useState("");
  const [helpInsertTarget, setHelpInsertTarget] = useState({ type: "process" }); // 'process' or {type:'lane', laneId, laneName}
  const [_sidebarWidth, setSidebarWidth] = useState(640);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [processPanelHeight, setProcessPanelHeight] = useState(620);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const [mentorNotes, setMentorNotes] = useState([]);
  const [mentorLastRunAt, setMentorLastRunAt] = useState(null);
  const storyEngineRef = useRef(null);
  const guidePatchTimerRef = useRef(null);
  const guideHighlightTimerRef = useRef(null);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [openOrgProcessConfirmNode, setOpenOrgProcessConfirmNode] = useState(null);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);
  const [newModelConfirmOpen, setNewModelConfirmOpen] = useState(false);
  const [wizardInputModal, setWizardInputModal] = useState(null);
  const [wizardInputValue, setWizardInputValue] = useState("");
  const [wizardInputError, setWizardInputError] = useState("");
  const [wizardConfirmModal, setWizardConfirmModal] = useState(null);
  const wizardInputSubmitRef = useRef(null);
  const wizardConfirmActionRef = useRef(null);
  const pendingOpenActionRef = useRef(null);
  const pendingOpenResolveRef = useRef(null);
  const pendingOpenCancelRef = useRef(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [previewVersionTag, setPreviewVersionTag] = useState("");
  const [projectNotes, setProjectNotes] = useState([]);
  const [projectNotesLoading, setProjectNotesLoading] = useState(false);
  const [projectNotesSaving, setProjectNotesSaving] = useState(false);
  const [projectNotesError, setProjectNotesError] = useState(null);
  const [projectNotesLastSeenAt, setProjectNotesLastSeenAt] = useState("");
  const [projectActivityItems, setProjectActivityItems] = useState([]);
  const [projectActivityLoading, setProjectActivityLoading] = useState(false);
  const [projectActivityError, setProjectActivityError] = useState(null);
  const [projectActivityActionId, setProjectActivityActionId] = useState(null);
  const [projectActivityFilter, setProjectActivityFilter] = useState("all");
  const [notesBadgePulse, setNotesBadgePulse] = useState(false);
  const [activityBadgePulse, setActivityBadgePulse] = useState(false);
  const [activityRequestsPulse, setActivityRequestsPulse] = useState(false);
  const activityPendingIdsRef = useRef(new Set());
  const notesUnreadIdsRef = useRef(new Set());
  const notesPulseTimerRef = useRef(null);
  const activityPulseTimerRef = useRef(null);
  const activityRequestsPulseTimerRef = useRef(null);
  const notesPollingStartedRef = useRef(false);
  const activityPollingStartedRef = useRef(false);
  const pendingRequestCountRef = useRef(0);
  const [noteDraft, setNoteDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyOpenById, setReplyOpenById] = useState({});

  const [replyEditing, setReplyEditing] = useState({ noteId: null, replyId: null, text: "" });
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [lastExportedAt, setLastExportedAt] = useState(null);
  const previousActiveOrgIdRef = useRef(null);

  const sampleSequenceFlowWaypoints = useCallback((activeModeler, limit = 5) => {
    const elementRegistry = activeModeler?.get?.("elementRegistry");
    if (!elementRegistry?.getAll) return [];
    return elementRegistry
      .getAll()
      .filter((el) => String(el?.businessObject?.$type || el?.type || "").includes("SequenceFlow"))
      .slice(0, limit)
      .map((conn) => ({
        id: conn?.id || null,
        name: conn?.businessObject?.name || "",
        waypoints: (conn?.waypoints || []).map((pt) => ({
          x: Number(pt?.x || 0),
          y: Number(pt?.y || 0),
        })),
      }));
  }, []);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [historyCount, setHistoryCount] = useState(0);
  const lanePreviewOverlayIdsRef = useRef([]);
  const lanePreviewTimerRef = useRef(null);
  const demoAppendStatsRef = useRef({
    attempts: 0,
    fallbacks: 0,
    sanityFails: 0,
    incrementalFails: 0,
  });
  const verticalResizeStart = useRef({ y: 0, h: 0 });
  const layoutRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const pendingDiagramXmlRef = useRef("");
  const lastSyncedXmlRef = useRef("");
  const historyRef = useRef([]);
  const lastRouteModelIdRef = useRef(null);
  const undoInProgressRef = useRef(false);
  const [helpInputs, setHelpInputs] = useState(() =>
    HELP_RULES.reduce((acc, rule) => {
      acc[rule.id] = (rule.fields || []).reduce((fieldsAcc, field) => {
        fieldsAcc[field.key] = "";
        return fieldsAcc;
      }, {});
      return acc;
    }, {}),
  );
  const [_helpActiveRuleId, _setHelpActiveRuleId] = useState(null);
  const [_helpMode, _setHelpMode] = useState("inline");
  const [helpAccordionOpen, setHelpAccordionOpen] = useState(() => ({
    task: false,
    xor: false,
    and_strict: false,
  }));
  const [helpIntent, setHelpIntent] = useState(null);
  const [activeHelpSection, setActiveHelpSection] = useState("");
  const [helpHighlightSection, setHelpHighlightSection] = useState("");
  const helpSectionRefs = useRef({});
  const helpFirstInputRefs = useRef({});
  const laneHelperItems = useMemo(() => analyzeLaneLines(laneDescription), [laneDescription]);
  const laneLines = useMemo(
    () =>
      (laneDescription || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [laneDescription],
  );
  const laneStructureCounts = useMemo(() => countStructures(laneLines), [laneLines]);
  const inlineLaneHint = useMemo(() => determineInlineHint(laneLines), [laneLines]);
  const hasLaneStructure =
    laneStructureCounts.decisions > 0 || laneStructureCounts.parallels > 0;
  const laneTextareaRef = useRef(null);
  const lanePanelScrollRef = useRef(null);
  const [laneTemplateChoice, setLaneTemplateChoice] = useState("");
  const [laneHelpTipDismissed, setLaneHelpTipDismissed] = useState(false);
  const [laneTemplateFlash, setLaneTemplateFlash] = useState(false);
  const laneTemplateFlashTimerRef = useRef(null);
  const focusLaneLine = useCallback((lineNumber) => {
    const textarea = laneTextareaRef.current;
    if (!textarea || !Number.isFinite(lineNumber) || lineNumber < 1) return;
    const rawLines = String(laneDescription || "").split(/\r?\n/);
    const targetIndex = Math.min(rawLines.length, Math.max(1, lineNumber)) - 1;
    let start = 0;
    for (let i = 0; i < targetIndex; i += 1) {
      start += rawLines[i].length + 1;
    }
    const targetLine = rawLines[targetIndex] || "";
    const end = start + targetLine.length;
    try {
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const lineHeight = 26;
      textarea.scrollTop = Math.max(0, targetIndex * lineHeight - lineHeight);
    } catch {
      // ignore focus/selection errors
    }
  }, [laneDescription]);
  const logRenderMode = (mode, reason) => {
    if (!window.__BPMNGEN_DEBUG_RENDER) return;
    console.log("[render]", mode, reason || "");
  };

  const setXmlFull = (nextXml, reason = "") => {
    renderModeRef.current = "full";
    logRenderMode("full", reason);
    setXml(nextXml);
  };

  const bumpModelVersion = useCallback(() => {
    setModelVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    engineJsonRef.current = engineJson;
  }, [engineJson]);

  if (!relayoutSchedulerRef.current) {
    relayoutSchedulerRef.current = createRelayoutScheduler({
      modelerRef,
      engineJsonRef,
      normalizeEngineForBackend,
      reflowLayout,
      setEngineJson,
      setXmlFull,
      setRelayouting,
      setError,
    });
  }
  const {
    restoreRelayoutContext,
    scheduleRelayoutKick,
    cancelPendingRelayouts,
    dispose: disposeRelayoutScheduler,
  } = relayoutSchedulerRef.current;

  useEffect(() => () => disposeRelayoutScheduler(), [disposeRelayoutScheduler]);

  const applyProcessTemplate = (template) => {
    if (!template) return;
    if (isReadOnlyMode) {
      setInfo(
        activeOrgCapabilities.canToggleOrgEdit
          ? "Režim: len na čítanie. Najprv klikni Upraviť."
          : "Tento org model je len na čítanie. Ako pozorovateľ ho nemôžeš upravovať.",
      );
      return;
    }
    setProcessCard((prev) => ({
      ...prev,
      generatorInput: {
        ...prev.generatorInput,
        processName: template.processName || "",
        roles: template.roles || "",
        trigger: template.trigger || "",
        input: template.input || "",
        output: template.output || "",
      },
    }));
    setHasUnsavedChanges(true);
  };

  const applyLaneTemplate = (template) => {
    if (!template) return;
    const applyTemplateText = () => {
      updateLaneDescription(template.text || "");
      setHasUnsavedChanges(true);
      setLaneTemplateFlash(true);
      if (laneTemplateFlashTimerRef.current) {
        window.clearTimeout(laneTemplateFlashTimerRef.current);
      }
      laneTemplateFlashTimerRef.current = window.setTimeout(() => {
        setLaneTemplateFlash(false);
      }, 900);
      const roleName = selectedLane?.name || selectedLane?.id || "rola";
      setInfo(`Vložené do roly: ${roleName}`);
      window.requestAnimationFrame(() => {
        const textarea = laneTextareaRef.current;
        if (!textarea) return;
        try {
          textarea.focus();
          const end = textarea.value.length;
          textarea.setSelectionRange(end, end);
          textarea.scrollTop = textarea.scrollHeight;
        } catch {
          // ignore focus/selection errors
        }
      });
    };
    const currentDraft = String(laneDescription || "").trim();
    const nextDraft = String(template.text || "").trim();
    if (currentDraft && currentDraft !== nextDraft) {
      openWizardConfirmModal(
        {
          kicker: "Rola",
          title: "Prepísať rozpísané kroky?",
          message:
            "V tejto role už máš rozpísaný draft. Ak budeš pokračovať, vzor nahradí aktuálny text v paneli.",
          confirmLabel: "Áno, použiť vzor",
          cancelLabel: "Nechať môj text",
          warning: true,
        },
        applyTemplateText,
      );
      return;
    }
    applyTemplateText();
  };

  const openSingleCard = (cardKey) => {
    setOrgOpen(cardKey === "org");
    setDrawerOpen(cardKey === "drawer");
    setHelpOpen(cardKey === "help");
    setStoryOpen(cardKey === "story");
    setMentorOpen(cardKey === "mentor");
    setLaneOpen(cardKey === "lane");
  };
  const getSelectedLaneKey = useCallback(
    (lane = selectedLane) => String(lane?.engineId || lane?.id || "").trim(),
    [selectedLane],
  );
  const resolveLaneElement = useCallback((elementRegistry, lane = selectedLane) => {
    if (!elementRegistry || !lane) return null;
    const engineId = String(lane?.engineId || lane?.id || "").trim();
    const canvasId = String(lane?.canvasId || "").trim();
    if (canvasId) {
      const directCanvas = elementRegistry.get(canvasId);
      if (directCanvas) return directCanvas;
    }
    if (engineId) {
      const direct = elementRegistry.get(engineId);
      if (direct) return direct;
      const all = elementRegistry.getAll?.() || [];
      const byEngine = all.find(
        (el) => String(el?.businessObject?.$attrs?.["data-engine-id"] || "") === engineId,
      );
      if (byEngine) return byEngine;
    }
    return null;
  }, [selectedLane]);
  const mapHelpIntentTypeToSection = (type) => {
    if (type === "XOR") return "xor";
    if (type === "AND") return "and_strict";
    return "task";
  };
  const inferLaneHelpIntentType = () => {
    const lastItem = laneHelperItems.length ? laneHelperItems[laneHelperItems.length - 1] : null;
    if (lastItem?.type === "xor") return "XOR";
    if (lastItem?.type === "and") return "AND";
    if (lastItem?.warning) {
      const warning = String(lastItem.warning || "").toLowerCase();
      if (warning.includes("inak") || warning.includes("tak")) return "XOR";
      if (warning.includes("paralel") || warning.includes("kroky")) return "AND";
    }
    return "TASK";
  };
  const openLaneHelper = (intent = null) => {
    setHelpInsertTarget({
      type: "lane",
      laneId: selectedLane?.id,
      laneName: selectedLane?.name || selectedLane?.id,
    });
    setLaneHelpTipDismissed(true);
    if (intent?.type) {
      setHelpIntent({ type: intent.type, nonce: Date.now() });
    }
    openSingleCard("help");
  };
  const toggleSingleCard = (cardKey) => {
    const isOpen =
      (cardKey === "org" && orgOpen) ||
      (cardKey === "drawer" && drawerOpen) ||
      (cardKey === "help" && helpOpen) ||
      (cardKey === "story" && storyOpen) ||
      (cardKey === "mentor" && mentorOpen) ||
      (cardKey === "lane" && laneOpen);
    if (isOpen) {
      openSingleCard(null);
      return;
    }
    openSingleCard(cardKey);
  };

  const toggleRailSection = (key) => {
    setRailSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const normalizeNodeId = (node) => node?.id || node?.nodeId || node?.refId || null;

  const guideRequestIdRef = useRef(0);
  const guideLastSignatureRef = useRef({ sig: null, ts: 0 });
  const guideModelLoadedKeyRef = useRef(null);
  const guideLastReasonRef = useRef("init");
  const modelVersionRef = useRef(modelVersion);

  useEffect(() => {
    modelVersionRef.current = modelVersion;
  }, [modelVersion]);

  const collectGuideModelSnapshot = useCallback(() => {
    const modeler = modelerRef.current;
    const elementRegistry = modeler?.get?.("elementRegistry");
    if (!elementRegistry?.getAll) return null;
    const all = elementRegistry.getAll();
    const lanes = all
      .filter((el) => String(el?.businessObject?.$type || el?.type || "").includes("Lane"))
      .map((laneEl) => {
        const laneBo = laneEl?.businessObject;
        const laneId = String(laneBo?.$attrs?.["data-engine-id"] || laneBo?.id || laneEl?.id || "");
        return {
          id: laneId,
          name: String(laneBo?.name || laneId || ""),
          _el: laneEl,
        };
      })
      .filter((lane) => lane.id);
    const tasksPerLane = new Map(lanes.map((lane) => [String(lane.id), 0]));
    const nodes = [];
    const flows = [];
    const findLaneByNode = (nodeEl) => {
      const lane = findLaneForNode(elementRegistry, nodeEl);
      const laneBo = lane?.businessObject;
      return String(laneBo?.$attrs?.["data-engine-id"] || laneBo?.id || lane?.id || "");
    };

    all.forEach((el) => {
      if (!el || el.type === "label") return;
      const type = String(el?.businessObject?.$type || el?.type || "");
      if (type.includes("SequenceFlow")) {
        const sourceId = String(el?.businessObject?.sourceRef?.id || el?.source?.id || "");
        const targetId = String(el?.businessObject?.targetRef?.id || el?.target?.id || "");
        flows.push({
          id: String(el?.businessObject?.id || el?.id || ""),
          source: sourceId,
          target: targetId,
          name: String(el?.businessObject?.name || ""),
        });
        return;
      }
      if (!el?.businessObject?.$instanceOf?.("bpmn:FlowNode")) return;
      const nodeId = String(el?.businessObject?.id || el?.id || "");
      if (!nodeId) return;
      const laneId = findLaneByNode(el) || null;
      const node = {
        id: nodeId,
        type,
        name: String(el?.businessObject?.name || ""),
        laneId,
      };
      nodes.push(node);
      if (isTaskLike(node) && laneId) {
        tasksPerLane.set(laneId, (tasksPerLane.get(laneId) || 0) + 1);
      }
    });

    const incomingCount = new Map();
    const outgoingCount = new Map();
    nodes.forEach((node) => {
      incomingCount.set(String(node.id), 0);
      outgoingCount.set(String(node.id), 0);
    });
    flows.forEach((flow) => {
      const sourceId = String(flow?.source || "");
      const targetId = String(flow?.target || "");
      if (sourceId) outgoingCount.set(sourceId, (outgoingCount.get(sourceId) || 0) + 1);
      if (targetId) incomingCount.set(targetId, (incomingCount.get(targetId) || 0) + 1);
    });

    const taskNodes = nodes.filter((node) => isTaskLike(node));
    const tasksMissingOutgoing = taskNodes
      .filter((node) => (outgoingCount.get(String(node.id)) || 0) === 0)
      .map((node) => String(node.id));
    const tasksMissingIncoming = taskNodes
      .filter((node) => (incomingCount.get(String(node.id)) || 0) === 0)
      .map((node) => String(node.id));
    const hasEndEvent = nodes.some((node) => String(node?.type || "").toLowerCase().includes("end"));
    const laneByNodeId = new Map(nodes.map((node) => [String(node.id), String(node?.laneId || "")]));
    const laneAdj = new Map(lanes.map((lane) => [String(lane.id), new Set()]));
    flows.forEach((flow) => {
      const sourceLane = laneByNodeId.get(String(flow?.source || "")) || "";
      const targetLane = laneByNodeId.get(String(flow?.target || "")) || "";
      if (!sourceLane || !targetLane || sourceLane === targetLane) return;
      if (!laneAdj.has(sourceLane)) laneAdj.set(sourceLane, new Set());
      if (!laneAdj.has(targetLane)) laneAdj.set(targetLane, new Set());
      laneAdj.get(sourceLane).add(targetLane);
      laneAdj.get(targetLane).add(sourceLane);
    });
    const lanesWithTasks = lanes.map((lane) => String(lane.id)).filter((laneId) => (tasksPerLane.get(laneId) || 0) > 0);
    let lanesDisconnected = false;
    if (lanesWithTasks.length > 1) {
      const seen = new Set();
      const stack = [lanesWithTasks[0]];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || seen.has(cur)) continue;
        seen.add(cur);
        const neighbors = laneAdj.get(cur);
        if (!neighbors) continue;
        neighbors.forEach((next) => {
          if (!seen.has(next)) stack.push(next);
        });
      }
      lanesDisconnected = lanesWithTasks.some((laneId) => !seen.has(laneId));
    }

    return {
      totalTasks: taskNodes.length,
      tasksPerLane,
      hasEndEvent,
      tasksMissingIncoming,
      tasksMissingOutgoing,
      lanesDisconnected,
      engine: {
        ...(engineJson || {}),
        lanes: lanes.map(({ _el: _ignoredEl, ...lane }) => lane),
        nodes,
        flows,
      },
    };
  }, [engineJson]);

  const detectLayoutOversizeCard = useCallback(() => {
    const modeler = modelerRef.current;
    const elementRegistry = modeler?.get?.("elementRegistry");
    if (!elementRegistry?.getAll) return null;
    const all = elementRegistry.getAll();
    const lanes = all.filter((el) =>
      String(el?.businessObject?.$type || el?.type || "").includes("Lane"),
    );
    const shapes = all.filter((el) => {
      const t = String(el?.businessObject?.$type || el?.type || "");
      if (!t) return false;
      if (
        t.includes("Lane") ||
        t.includes("Label") ||
        t.includes("SequenceFlow") ||
        t.includes("Participant")
      ) {
        return false;
      }
      return true;
    });
    if (!lanes.length || !shapes.length) return null;
    const bounds = (els) => {
      const xs = els.map((e) => e.x || 0);
      const ys = els.map((e) => e.y || 0);
      const ws = els.map((e) => (e.x || 0) + (e.width || 0));
      const hs = els.map((e) => (e.y || 0) + (e.height || 0));
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...ws),
        maxY: Math.max(...hs),
      };
    };
    const content = bounds(shapes);
    const laneBounds = bounds(lanes);
    const laneWidth = laneBounds.maxX - laneBounds.minX;
    const laneHeight = laneBounds.maxY - laneBounds.minY;
    const contentWidth = content.maxX - content.minX;
    const contentHeight = content.maxY - content.minY;
    const extraRight = laneBounds.maxX - content.maxX;
    const extraBottom = laneBounds.maxY - content.maxY;
    const extraLeft = content.minX - laneBounds.minX;
    const extraTop = content.minY - laneBounds.minY;
    const extraW = Math.max(extraRight, extraLeft);
    const extraH = Math.max(extraBottom, extraTop);
    const widthRatio = laneWidth / Math.max(1, contentWidth);
    const heightRatio = laneHeight / Math.max(1, contentHeight);
    const areaRatio =
      (contentWidth * contentHeight) / Math.max(1, laneWidth * laneHeight);
    if (window.__BPMNGEN_DEBUG_GUIDE) {
      console.log("[guide:oversize]", {
        laneWidth,
        laneHeight,
        contentWidth,
        contentHeight,
        extraLeft,
        extraRight,
        extraTop,
        extraBottom,
        extraW,
        extraH,
        widthRatio,
        heightRatio,
        areaRatio,
      });
    }
    const isOversized =
      (extraW > 180 || extraH > 120) &&
      (widthRatio > 1.2 || heightRatio > 1.2 || areaRatio < 0.7);
    if (!isOversized) {
      if (window.__BPMNGEN_DEBUG_GUIDE) {
        console.log("[guide:oversize] not triggered");
      }
      return null;
    }
    return {
      key: "layout_oversize",
      scope: "global",
      title: "Mapa je hotová 👍",
      message:
        "Ak chceš upratať voľné miesto, klikni najprv na rolu alebo celý proces (prípadne použi tlačidlo na mape), aby sa označil.\nPotom môžeš potiahnuť jeho okraj a zmenšiť ho podľa obsahu.",
      primary: { label: "Na mape", action: "FOCUS_OVERSIZE_TARGET" },
      secondary: { label: "Neskôr", action: "NOT_NOW" },
    };
  }, []);

  const applyGuideFromFindings = useCallback(
    (findings, laneId = null, options = {}) => {
      const force = Boolean(options.force);
      const guideEngine = options.guideEngine || engineJson;
      const card = pickGuideCard({
        engineJson: guideEngine,
        findings,
        activeLaneId: laneId || activeLaneId,
        lastEditedLaneId,
        modelSnapshot: options.modelSnapshot || null,
        uiContext: { mentorOpen, storyOpen, hasUnsavedChanges, modelSourceKind: modelSource?.kind },
      });
      if (!card) {
        setGuideState(null);
        return null;
      }
      if (!force && wasGuideDismissedRecently(card.key)) {
        setGuideState(null);
        return null;
      }
      setGuideState(card);
      return card;
    },
    [engineJson, activeLaneId, lastEditedLaneId, mentorOpen, storyOpen, hasUnsavedChanges, modelSource?.kind],
  );

  const runGuideReview = useCallback(
    async (reason = "manual", laneId = null) => {
      if (!guideEnabled) return;
      const guideWorkspaceActive =
        Boolean(engineJson) || drawerOpen || laneOpen || helpOpen || storyOpen || mentorOpen;
      if (!guideWorkspaceActive) {
        setGuideState(null);
        return;
      }
      const runModelVersion = modelVersionRef.current;
      guideLastReasonRef.current = reason;
      const modelSnapshot = collectGuideModelSnapshot();
      const guideEngine = modelSnapshot?.engine || engineJson;
      const generator = processCard?.generatorInput || {};
      const processNameFilled = Boolean((generator.processName || "").trim());
      const rolesValue = String(generator.roles || "").trim();
      const rolesLines = rolesValue
        ? rolesValue.split(/\r?\n/).map((line) => String(line || "").trim()).filter(Boolean)
        : [];
      const rolesFilled = rolesLines.length > 0;
      const triggerFilled = Boolean((generator.trigger || "").trim());
      const outputFilled = Boolean((generator.output || "").trim());
      const hasEngineModel =
        Boolean((guideEngine?.name || guideEngine?.processName || "").trim()) ||
        (Array.isArray(guideEngine?.lanes) && guideEngine.lanes.length > 0) ||
        (Array.isArray(guideEngine?.nodes) && guideEngine.nodes.length > 0);
      const hasProcessCard =
        (processNameFilled && rolesFilled) ||
        hasEngineModel;
      if (!hasProcessCard && !hasEngineModel) {
        const partialCardStarted =
          processNameFilled || rolesFilled || triggerFilled || outputFilled;
        setGuideState({
          key: partialCardStarted ? "process_card_progress" : "process_card",
          scope: "global",
          title: partialCardStarted ? "Poďme krok po kroku" : "Začíname spolu",
          message: !processNameFilled
            ? "Poďme začať názvom procesu. Jednou vetou pomenujeme, čo ideme modelovať."
            : !rolesFilled
              ? "Máme názov procesu. Teraz poďme doplniť roly, každú na nový riadok, aby bolo jasné, kto v procese vystupuje."
              : !triggerFilled
                ? `Máme názov aj roly. Teraz poďme doplniť, čo proces „${generator.processName}“ spúšťa.`
                : !outputFilled
                  ? "Máme začiatok procesu. Ešte poďme doplniť, čo má byť na konci procesu alebo aký má byť jeho výsledok."
                  : "Máme pripravený základ kostry. Poďme skontrolovať názov procesu, roly, začiatok a koniec a potom klikneme na „Vytvoriť model“.",
          primary: { label: "Do karty", action: "OPEN_PROCESS_CARD" },
        });
        return;
      }
      if (!guideEngine) {
        const key =
          processNameFilled && rolesFilled && triggerFilled && outputFilled
            ? "process_card_ready"
            : !processNameFilled
              ? "process_card_missing_name"
              : !rolesFilled
                ? "process_card_missing_roles"
                : !triggerFilled
                  ? "process_card_missing_trigger"
                  : !outputFilled
                    ? "process_card_missing_output"
                : "process_card";
        const message =
          processNameFilled && rolesFilled && triggerFilled && outputFilled
            ? "Máme pripravený základ kostry. Poďme skontrolovať názov procesu, roly, začiatok a koniec a potom kliknúť na „Vytvoriť model“, aby sme z toho spravili prvú mapu."
            : !processNameFilled
              ? "Poďme začať názvom procesu. Jednou vetou pomenujeme, čo ideme modelovať."
              : !rolesFilled
                ? "Máme názov procesu. Teraz poďme doplniť roly, každú na nový riadok, aby sme vedeli vytvoriť kostru procesu."
                : !triggerFilled
                  ? `Máme názov aj roly. Teraz poďme doplniť, čo proces „${generator.processName}“ spúšťa.`
                  : !outputFilled
                    ? "Máme začiatok procesu. Ešte poďme doplniť, čo má byť na konci procesu alebo aký má byť jeho výsledok."
                    : "Najprv si spolu nastavíme základ. Dáme procesu názov a pridáme roly, každú na nový riadok. Keď budeme pripravení, vytvoríme model.";
        setGuideState({
          key,
          scope: "global",
          title:
            processNameFilled && rolesFilled && triggerFilled && outputFilled
              ? "Základ je pripravený"
              : "Poďme doplniť kostru",
          message,
          primary: { label: "Do karty", action: "OPEN_PROCESS_CARD" },
        });
        return;
      }
      const nodesCount = Array.isArray(guideEngine?.nodes) ? guideEngine.nodes.length : 0;
      const flowsCount = Array.isArray(guideEngine?.flows) ? guideEngine.flows.length : 0;
      const lanesCount = Array.isArray(guideEngine?.lanes) ? guideEngine.lanes.length : 0;
      const laneText = (laneDescription || "").trim();
      const signature = [
        reason,
        laneId || "",
        guideEngine?.processId || guideEngine?.name || guideEngine?.processName || "",
        nodesCount,
        flowsCount,
        lanesCount,
        laneText,
      ].join("|");
      const now = Date.now();
      if (
        guideLastSignatureRef.current.sig === signature &&
        now - guideLastSignatureRef.current.ts < 1500
      ) {
        return;
      }
      guideLastSignatureRef.current = { sig: signature, ts: now };
      const requestId = ++guideRequestIdRef.current;
      let findings = [];
      try {
        const payload = {
          text: (laneDescription || "").trim() || null,
          engine_json: guideEngine,
          kb_version: null,
          telemetry: null,
          telemetry_id: null,
        };
        const response = await mentorReview(payload);
        findings = response?.findings || [];
      } catch {
        findings = [];
      }
      if (requestId !== guideRequestIdRef.current) return;
      if (modelVersionRef.current !== runModelVersion) return;
      setGuideFindings(findings);
      const forceGuide = reason === "skeleton_generated";
      const currentCard = applyGuideFromFindings(findings, laneId, {
        force: forceGuide,
        guideEngine,
        modelSnapshot,
      });
      const oversizeCard = detectLayoutOversizeCard();
      const canOverrideWithOversize =
        !currentCard ||
        currentCard?.key === "process_ready_for_save" ||
        currentCard?.key === "process_complete" ||
        String(currentCard?.key || "").startsWith("unnamed_node:");
      if (oversizeCard && canOverrideWithOversize) {
        if (!wasGuideDismissedRecently(oversizeCard.key)) {
          setGuideState(oversizeCard);
        } else if (window.__BPMNGEN_DEBUG_GUIDE) {
          console.log("[guide:oversize] skipped (dismissed)");
        }
      }
    },
    [
      guideEnabled,
      processCard,
      engineJson,
      drawerOpen,
      laneOpen,
      helpOpen,
      storyOpen,
      mentorOpen,
      laneDescription,
      applyGuideFromFindings,
      collectGuideModelSnapshot,
      detectLayoutOversizeCard,
    ],
  );

  useEffect(() => {
    if (!guideEnabled) return;
    if (!guideState || !String(guideState.key || "").startsWith("process_card")) return;
    const generator = processCard?.generatorInput || {};
    const partialCardStarted =
      Boolean((generator.processName || "").trim()) ||
      Boolean(String(generator.roles || "").trim()) ||
      Boolean((generator.trigger || "").trim()) ||
      Boolean((generator.output || "").trim());
    const hasEngineModel =
      Boolean((engineJson?.name || engineJson?.processName || "").trim()) ||
      (Array.isArray(engineJson?.lanes) && engineJson.lanes.length > 0) ||
      (Array.isArray(engineJson?.nodes) && engineJson.nodes.length > 0);
    const hasProcessCard =
      (Boolean((generator.processName || "").trim()) && Boolean((generator.roles || "").trim())) ||
      hasEngineModel;
    if (partialCardStarted || hasProcessCard || hasEngineModel) {
      const key = [
        engineJson?.processId || "",
        engineJson?.name || engineJson?.processName || "",
        Array.isArray(engineJson?.nodes) ? engineJson.nodes.length : 0,
        Array.isArray(engineJson?.flows) ? engineJson.flows.length : 0,
        Array.isArray(engineJson?.lanes) ? engineJson.lanes.length : 0,
        (generator.processName || "").trim(),
        (generator.roles || "").trim(),
        (generator.trigger || "").trim(),
        (generator.output || "").trim(),
      ].join("|");
      if (guideModelLoadedKeyRef.current === key) return;
      guideModelLoadedKeyRef.current = key;
      setGuideState(null);
      runGuideReview(partialCardStarted && !hasEngineModel ? "process_card_progress" : "model_loaded");
    }
  }, [guideEnabled, guideState, engineJson, processCard, runGuideReview]);

  useEffect(
    () => () => {
      if (guideHighlightTimerRef.current) {
        window.clearTimeout(guideHighlightTimerRef.current);
        guideHighlightTimerRef.current = null;
      }
    },
    [],
  );

  const applyGuideHighlight = useCallback((nextHighlight, ttlMs = null) => {
    if (guideHighlightTimerRef.current) {
      window.clearTimeout(guideHighlightTimerRef.current);
      guideHighlightTimerRef.current = null;
    }
    setGuideHighlight(nextHighlight || null);
    if (ttlMs && nextHighlight) {
      const token = String(nextHighlight?.token || "");
      guideHighlightTimerRef.current = window.setTimeout(() => {
        setGuideHighlight((current) => {
          if (!current) return null;
          if (token && String(current?.token || "") !== token) return current;
          return null;
        });
        guideHighlightTimerRef.current = null;
      }, ttlMs);
    }
  }, []);

  useEffect(() => {
    if (!guideEnabled || !guideState) {
      applyGuideHighlight(null);
      return;
    }

    const key = String(guideState?.key || "");
    const message = String(guideState?.message || "").toLowerCase();
    const actions = [guideState?.primary, guideState?.secondary, guideState?.tertiary].filter(Boolean);
    const openLaneAction = actions.find((action) => action?.action === "OPEN_LANE");
    const focusNodeAction = actions.find((action) => action?.action === "FOCUS_NODE");
    const connectEndAction = actions.find((action) => action?.action === "CONNECT_END_HERE");
    const laneIdHint =
      openLaneAction?.payload?.laneId || guideState?.laneId || activeLaneId || selectedLane?.id || null;

    let hardFinding = null;
    if (key.startsWith("hard:")) {
      const hardId = key.slice("hard:".length);
      hardFinding = (guideFindings || []).find((finding) => String(finding?.id || "") === hardId) || null;
    }
    const hardRule = hardFinding ? normalizeGuideRuleId(hardFinding) : "";
    const hardTargetId = hardFinding?.target?.id ? String(hardFinding.target.id) : null;
    const hardLaneId = hardFinding ? getLaneIdForFinding(hardFinding, buildGuideIndex(engineJson)) : null;
    const isGatewayBranchHint = hardRule === "gateway_diverging_needs_two_outgoing";
    const missingEndNodeId = key.startsWith("missing_end:") ? key.slice("missing_end:".length) : "";

    const isConnectGuide =
      key === "lanes_disconnected" ||
      key.startsWith("task_no_") ||
      key.startsWith("missing_end") ||
      actions.some((action) => action?.action === "CONNECT_LANES_HEURISTIC" || action?.action === "CONNECT_END_HERE");

    const isWriteGuide =
      key === "process_empty" ||
      key.startsWith("lane_empty:") ||
      (message.includes("krok") && (message.includes("nap") || message.includes("dop")));

    const highlight = {
      token: `${key}:${Date.now()}`,
      map: null,
      laneInputLaneId: null,
      processCardField: null,
    };

    if (key.startsWith("process_card")) {
      if (key === "process_card" || key === "process_card_missing_name") {
        highlight.processCardField = "processName";
      } else if (key === "process_card_missing_roles") {
        highlight.processCardField = "roles";
      } else if (key === "process_card_missing_trigger") {
        highlight.processCardField = "trigger";
      } else if (key === "process_card_missing_output") {
        highlight.processCardField = "output";
      } else if (key === "process_card_progress") {
        if (!String(processCard?.generatorInput?.processName || "").trim()) {
          highlight.processCardField = "processName";
        } else if (!String(processCard?.generatorInput?.roles || "").trim()) {
          highlight.processCardField = "roles";
        } else if (!String(processCard?.generatorInput?.trigger || "").trim()) {
          highlight.processCardField = "trigger";
        } else if (!String(processCard?.generatorInput?.output || "").trim()) {
          highlight.processCardField = "output";
        }
      }
    }

    if (isGatewayBranchHint) {
      highlight.map = {
        type: "upper_branch",
        nodeId: hardTargetId || null,
        laneId: hardLaneId || laneIdHint || null,
        pulse: true,
      };
    } else if (missingEndNodeId || connectEndAction?.payload?.nodeId) {
      highlight.map = {
        type: "missing_end",
        nodeId: String(missingEndNodeId || connectEndAction?.payload?.nodeId || ""),
        nodeName: String(connectEndAction?.payload?.nodeName || ""),
        laneId: connectEndAction?.payload?.laneId || laneIdHint || null,
        pulse: true,
      };
    } else if (focusNodeAction?.payload?.nodeId) {
      highlight.map = {
        type: "node",
        nodeId: String(focusNodeAction.payload.nodeId),
        pulse: true,
      };
    } else if (openLaneAction?.payload?.laneId || guideState?.laneId) {
      highlight.map = {
        type: "lane",
        laneId: String(openLaneAction?.payload?.laneId || guideState?.laneId),
        pulse: true,
      };
    } else if (isConnectGuide) {
      highlight.map = { type: "connect" };
    }

    if (
      isWriteGuide &&
      laneIdHint &&
      selectedLane?.id &&
      String(selectedLane.id) === String(laneIdHint)
    ) {
      highlight.laneInputLaneId = String(laneIdHint);
    }

    applyGuideHighlight(highlight);
  }, [guideEnabled, guideState, guideFindings, engineJson, activeLaneId, selectedLane, processCard, applyGuideHighlight]);

  const runConnectHeuristic = useCallback(() => {
    const modeler = modelerRef.current;
    if (!modeler) return false;
    const elementRegistry = modeler.get("elementRegistry");
    const modeling = modeler.get("modeling");
    if (!elementRegistry || !modeling) return false;
    const lanes = engineJson?.lanes || [];
    const nodes = engineJson?.nodes || [];
    const tasks = nodes.filter((n) => /task/i.test(String(n?.type || "")));
    if (lanes.length < 2 || tasks.length < 2) return false;
    const laneTasks = (laneIdValue) =>
      tasks
        .filter((t) => t?.laneId === laneIdValue)
        .map((t) => elementRegistry.get(normalizeNodeId(t)))
        .filter(Boolean)
        .sort((a, b) => (a.x || 0) - (b.x || 0));
    const firstLane = lanes[0];
    const secondLane = lanes.find((l) => l.id !== firstLane.id);
    const firstLaneTasks = laneTasks(firstLane.id);
    const secondLaneTasks = secondLane ? laneTasks(secondLane.id) : [];
    if (!firstLaneTasks.length || !secondLaneTasks.length) return false;
    const sourceShape = firstLaneTasks[firstLaneTasks.length - 1];
    const targetShape = secondLaneTasks[0];
    modeling.connect(sourceShape, targetShape, { type: "bpmn:SequenceFlow" });
    return true;
  }, [engineJson]);

  const handleGuideAction = async (actionId, payload) => {
    if (actionId === "CONNECT_END_HERE") {
      console.log("[Guide] handleGuideAction click", { actionId, payload });
    }
    if (!guideState || !actionId) return;
    if (isDemoMode && (actionId === "SAVE_PROCESS" || actionId === "MOVE_TO_ORG" || actionId === "STAY_IN_SANDBOX")) {
      setInfo("DEMO režim: uloženie a organizácie sú dostupné až po registrácii.");
      setGuideState(null);
      return;
    }
    if (actionId === "NOT_NOW") {
      dismissGuideCard(guideState.key);
      setGuideState(null);
      runGuideReview("end_added");
      return;
    }
    if (actionId === "OPEN_PROCESS_CARD") {
      openSingleCard("drawer");
      setGuideState(null);
      return;
    }
    if (actionId === "SAVE_PROCESS") {
      await handleSaveModel();
      setGuideState(null);
      return;
    }
    if (actionId === "MOVE_TO_ORG") {
      if (modelSource?.kind === "org") {
        openSingleCard("org");
        setGuideState(null);
        return;
      }
      if (!activeOrgId) {
        setInfo("Najprv si vyber alebo vytvor organizaciu.");
        setGuideState(null);
        return;
      }
      const saveResult = await handleSaveModel();
      const savedModelId = saveResult?.modelId || routeModelId || null;
      if (!savedModelId) {
        return;
      }
      await openPushToOrgModal({
        id: String(savedModelId),
        name: String(saveResult?.name || deriveDefaultName() || "Proces"),
      });
      setGuideState(null);
      return;
    }
    if (actionId === "STAY_IN_SANDBOX") {
      setGuideState(null);
      return;
    }
    if (actionId === "OPEN_LANE") {
      const laneIdValue = payload?.laneId;
      if (laneIdValue && engineJson?.lanes) {
        const lane = engineJson.lanes.find((l) => String(l?.id || "") === String(laneIdValue));
        if (lane) {
          setSelectedLane(lane);
          setActiveLaneId(String(lane.id));
          setLastEditedLaneId(String(lane.id));
          openSingleCard("lane");
          applyGuideHighlight(
            {
              token: `open_lane:${lane.id}:${Date.now()}`,
              map: { type: "lane", laneId: String(lane.id), pulse: true },
              laneInputLaneId: String(lane.id),
            },
            2200,
          );
          window.setTimeout(() => {
            runGuideReview("cta_lane_opened", String(lane.id));
          }, 0);
        }
      }
      setGuideState(null);
      return;
    }
    if (actionId === "ADD_END_EVENT" || actionId === "MARK_TASK_AS_END") {
      const modeler = modelerRef.current;
      if (!modeler) return;
      const elementRegistry = modeler.get("elementRegistry");
      const modeling = modeler.get("modeling");
      const elementFactory = modeler.get("elementFactory");
      if (!elementRegistry || !modeling || !elementFactory) return;
      const nodes = engineJson?.nodes || [];
      const tasks = nodes.filter((n) => /task/i.test(String(n?.type || "")));
      let targetTaskId = null;
      if (actionId === "MARK_TASK_AS_END" && payload?.nodeId) {
        targetTaskId = payload.nodeId;
      }
      if (!targetTaskId && tasks.length) {
        const shapes = tasks
          .map((t) => elementRegistry.get(normalizeNodeId(t)))
          .filter(Boolean)
          .sort((a, b) => (a.x || 0) - (b.x || 0));
        targetTaskId = shapes.length ? shapes[shapes.length - 1].id : null;
      }
      if (!targetTaskId) return;
      const sourceShape = elementRegistry.get(targetTaskId);
      if (!sourceShape) return;
      const configuredEndName = String(processCard?.generatorInput?.output || "").trim();
      const endShape = elementFactory.createShape({ type: "bpmn:EndEvent" });
      if (configuredEndName && endShape?.businessObject) {
        endShape.businessObject.name = configuredEndName;
      }
      const position = { x: (sourceShape.x || 0) + 160, y: (sourceShape.y || 0) };
      const processParent = getProcessParent(elementRegistry);
      if (!processParent) return;
      const createdEnd = modeling.createShape(endShape, position, processParent);
      if (configuredEndName && createdEnd) {
        try {
          modeling.updateProperties(createdEnd, { name: configuredEndName });
        } catch {
          // ignore name update errors
        }
      }
      const laneForSource = findLaneForNode(elementRegistry, sourceShape);
      if (laneForSource && createdEnd) {
        attachNodeToLane(laneForSource, createdEnd, modeling);
      }
      modeling.connect(sourceShape, createdEnd, { type: "bpmn:SequenceFlow" });
      setGuideState(null);
      return;
    }
    if (actionId === "CONNECT_LANES_HEURISTIC") {
      applyGuideHighlight(
        {
          token: `connect_hint:${Date.now()}`,
          map: { type: "connect" },
          laneInputLaneId: null,
        },
        1800,
      );
      runConnectHeuristic();
      setGuideState(null);
      runGuideReview("connect_lanes");
      return;
    }
    if (actionId === "FOCUS_OVERSIZE_TARGET") {
      const modeler = modelerRef.current;
      if (!modeler) return;
      const elementRegistry = modeler.get("elementRegistry");
      const selection = modeler.get("selection");
      const canvas = modeler.get("canvas");
      if (!elementRegistry) return;
      const getByIdOrEngineId = (id) => {
        if (!id) return null;
        const direct = elementRegistry.get(id);
        if (direct) return direct;
        return (
          elementRegistry
            .getAll()
            .find((el) => String(el?.businessObject?.$attrs?.["data-engine-id"] || "") === String(id)) || null
        );
      };
      const laneHintId = activeLaneId || selectedLane?.id || null;
      const laneEl = laneHintId ? getByIdOrEngineId(laneHintId) : null;
      const participantEl =
        elementRegistry
          .getAll()
          .find((el) => String(el?.businessObject?.$type || el?.type || "").includes("Participant")) || null;
      const target = laneEl || participantEl;
      if (target) {
        selection?.select(target);
        try {
          canvas?.zoom?.("fit-viewport", target);
        } catch {
          // ignore zoom errors
        }
        canvas?.scrollToElement?.(target);
      }
      setGuideState(null);
      return;
    }
    if (actionId === "FOCUS_NODE") {
      const modeler = modelerRef.current;
      if (!modeler) return;
      const elementRegistry = modeler.get("elementRegistry");
      const selection = modeler.get("selection");
      const canvas = modeler.get("canvas");
      const getByIdOrEngineId = (id) => {
        if (!id || !elementRegistry) return null;
        const direct = elementRegistry.get(id);
        if (direct) return direct;
        return (
          elementRegistry
            .getAll()
            .find((el) => String(el?.businessObject?.$attrs?.["data-engine-id"] || "") === String(id)) || null
        );
      };
      const nodeId = payload?.nodeId;
      const laneId = payload?.laneId;
      const nodeName = String(payload?.nodeName || "").trim();
      let element = nodeId ? getByIdOrEngineId(nodeId) : null;
      const laneEl = laneId ? getByIdOrEngineId(laneId) : null;
      if (!element && nodeName && elementRegistry) {
        const all = elementRegistry.getAll();
        const candidates = all.filter((el) => {
          if (!el || el.type === "label") return false;
          const boType = String(el?.businessObject?.$type || el?.type || "");
          if (
            !boType.includes("Task") &&
            !boType.includes("Gateway") &&
            !boType.includes("Event")
          ) {
            return false;
          }
          return String(el?.businessObject?.name || "").trim() === nodeName;
        });
        element =
          candidates.find((el) => {
            if (!laneEl) return true;
            const laneForNode = findLaneForNode(elementRegistry, el);
            return Boolean(laneForNode && laneForNode.id === laneEl.id);
          }) || candidates[0] || null;
      }
      const target = element || laneEl;
      if (target) {
        applyGuideHighlight(
          {
            token: `focus_node:${target.id || Date.now()}`,
            map: {
              type: "node",
              nodeId: String(target.id || ""),
              pulse: true,
            },
            laneInputLaneId: null,
          },
          2000,
        );
        selection?.select(target);
        if (typeof canvas?.zoom === "function") {
          try {
            canvas.zoom("fit-viewport", target);
          } catch {
            // ignore zoom errors
          }
        }
        if (typeof canvas?.scrollToElement === "function") {
          canvas.scrollToElement(target);
        }
      }
      return;
    }
    if (actionId === "CONNECT_END_HERE") {
      console.log("[Guide][CONNECT_END_HERE] start", { actionId, payload });
      const modeler = modelerRef.current;
      if (!modeler) {
        console.warn("[Guide][CONNECT_END_HERE] missing modelerRef.current");
        return;
      }
      const elementRegistry = modeler.get("elementRegistry");
      const modeling = modeler.get("modeling");
      const elementFactory = modeler.get("elementFactory");
      const selection = modeler.get("selection");
      if (!elementRegistry || !modeling) {
        console.warn("[Guide][CONNECT_END_HERE] missing services", {
          hasElementRegistry: Boolean(elementRegistry),
          hasModeling: Boolean(modeling),
          hasElementFactory: Boolean(elementFactory),
          hasSelection: Boolean(selection),
        });
        return;
      }
      const getByIdOrEngineId = (id) => {
        if (!id) return null;
        const direct = elementRegistry.get(id);
        if (direct) return direct;
        return (
          elementRegistry
            .getAll()
            .find(
              (el) =>
                String(el?.businessObject?.$attrs?.["data-engine-id"] || "") ===
                String(id),
            ) || null
        );
      };
      const isFlowNode = (el) => Boolean(el?.businessObject?.$instanceOf?.("bpmn:FlowNode"));
      const isEndEvent = (el) =>
        String(el?.businessObject?.$type || el?.type || "").includes("EndEvent");
      const isConnectableNode = (el) => isFlowNode(el) && !isEndEvent(el);
      const selectedRaw = selection?.get?.() || [];
      console.log("[Guide][CONNECT_END_HERE] selection", {
        count: selectedRaw.length,
        items: selectedRaw.map((el) => ({
          id: el?.id,
          type: el?.businessObject?.$type || el?.type || "",
        })),
      });

      const selected = selectedRaw.find((el) => isConnectableNode(el));
      let sourceShape = selected || getByIdOrEngineId(payload?.nodeId);
      const hasExplicitPayloadNode = Boolean(payload?.nodeId);
      if (!sourceShape && hasExplicitPayloadNode) {
        console.warn("[Guide][CONNECT_END_HERE] payload node unresolved; skip lane fallback", {
          payloadNodeId: payload?.nodeId || null,
        });
        return;
      }
      if (!sourceShape) {
        const laneIdHint =
          payload?.laneId || activeLaneId || selectedLane?.id || lastEditedLaneId || null;
        const laneEl = getByIdOrEngineId(laneIdHint);
        if (laneEl) {
          const laneNodes = collectLaneFlowNodes(laneEl, elementRegistry)
            .filter((el) => isConnectableNode(el))
            .sort((a, b) => (a.x || 0) - (b.x || 0));
          const taskNodes = laneNodes.filter((el) =>
            String(el?.businessObject?.$type || el?.type || "").includes("Task"),
          );
          sourceShape =
            (taskNodes.length
              ? taskNodes[taskNodes.length - 1]
              : laneNodes[laneNodes.length - 1]) || null;
        }
      }
      if (!sourceShape) {
        console.warn("[Guide][CONNECT_END_HERE] sourceShape unresolved", {
          payloadNodeId: payload?.nodeId || null,
          payloadLaneId: payload?.laneId || null,
          activeLaneId: activeLaneId || null,
          selectedLaneId: selectedLane?.id || null,
          lastEditedLaneId: lastEditedLaneId || null,
        });
        return;
      }
      const processParent = getProcessParent(elementRegistry);
      const laneForSource = findLaneForNode(elementRegistry, sourceShape);
      const createParent = laneForSource || processParent;
      console.log("[Guide][CONNECT_END_HERE] resolved source/parents", {
        sourceId: sourceShape?.id || null,
        sourceType: sourceShape?.businessObject?.$type || sourceShape?.type || "",
        sourceLaneId: laneForSource?.id || null,
        processParentId: processParent?.id || null,
        processParentType: processParent?.businessObject?.$type || processParent?.type || "",
        createParentId: createParent?.id || null,
        createParentType: createParent?.businessObject?.$type || createParent?.type || "",
      });
      if (!createParent) {
        console.warn("[Guide][CONNECT_END_HERE] missing create parent");
        return;
      }
      const laneNodes = laneForSource
        ? collectLaneFlowNodes(laneForSource, elementRegistry)
        : [];
      const configuredEndName = String(processCard?.generatorInput?.output || "").trim();
      let endShape = laneNodes.find((el) => isEndEvent(el)) || null;
      if (!endShape && elementFactory) {
        try {
          const endDef = elementFactory.createShape({ type: "bpmn:EndEvent" });
          if (configuredEndName && endDef?.businessObject) {
            endDef.businessObject.name = configuredEndName;
          }
          const sourceX = sourceShape.x || 0;
          const sourceY = sourceShape.y || 0;
          const sourceW = sourceShape.width || 0;
          const sourceH = sourceShape.height || 0;
          const endW = endDef.width || 36;
          const endH = endDef.height || 36;
          const position = {
            x: sourceX + sourceW + 60,
            y: sourceY + sourceH / 2 - endH / 2,
          };
          console.log("[Guide][CONNECT_END_HERE] createShape input", {
            position,
            source: { id: sourceShape?.id || null, x: sourceX, y: sourceY, w: sourceW, h: sourceH },
            endDef: { width: endW, height: endH },
          });
          endShape = modeling.createShape(endDef, position, createParent);
          console.log("[Guide][CONNECT_END_HERE] createShape output", {
            id: endShape?.id || null,
            type: endShape?.businessObject?.$type || endShape?.type || "",
            inRegistry: Boolean(endShape?.id ? elementRegistry.get(endShape.id) : null),
          });
          if (laneForSource && endShape) {
            attachNodeToLane(laneForSource, endShape, modeling);
          }
        } catch (error) {
          console.error("[Guide][CONNECT_END_HERE] createShape failed", error);
          endShape = null;
        }
      }
      if (!endShape) {
        console.warn("[Guide][CONNECT_END_HERE] endShape unresolved");
        return;
      }
      if (configuredEndName) {
        try {
          modeling.updateProperties(endShape, { name: configuredEndName });
        } catch {
          // ignore name update errors
        }
      }
      try {
        if (typeof modeling.moveShape === "function") {
          const sourceX = sourceShape.x || 0;
          const sourceY = sourceShape.y || 0;
          const sourceW = sourceShape.width || 0;
          const sourceH = sourceShape.height || 0;
          const _endW = endShape.width || 0;
          const endH = endShape.height || 0;
          const targetX = sourceX + sourceW + 60;
          const targetY = sourceY + sourceH / 2 - endH / 2;
          const dx = targetX - (endShape.x || 0);
          const dy = targetY - (endShape.y || 0);
          console.log("[Guide][CONNECT_END_HERE] move endShape", { dx, dy, targetX, targetY });
          modeling.moveShape(endShape, { x: dx, y: dy }, createParent);
          const label = endShape.label || elementRegistry.get(`${endShape.id}_label`);
          if (label) {
            modeling.moveShape(label, { x: dx, y: dy }, createParent);
          }
        }
        const alreadyLinked = Array.isArray(sourceShape.outgoing)
          ? sourceShape.outgoing.some((conn) => conn?.target?.id === endShape.id)
          : false;
        if (!alreadyLinked) {
          console.log("[Guide][CONNECT_END_HERE] connecting", {
            sourceId: sourceShape?.id || null,
            targetId: endShape?.id || null,
          });
          modeling.connect(sourceShape, endShape, { type: "bpmn:SequenceFlow" });
          console.log("[Guide][CONNECT_END_HERE] connect success");
        }
        ensureLaneRightPaddingAfterInsert(laneForSource || createParent, endShape, modeler, modeling);
        try {
          await syncEngineFromCanvas();
        } catch (syncError) {
          console.warn("[Guide][CONNECT_END_HERE] syncEngineFromCanvas failed", syncError);
        }
      } catch (error) {
        console.error("[Guide][CONNECT_END_HERE] move/connect failed", error);
      }
      setGuideState(null);
      bumpModelVersion();
      window.setTimeout(() => {
        runGuideReview("end_added");
      }, 200);
      return;
    }
  };

  const handleEngineJsonPatch = useCallback(
    (patch) => {
      const patchLaneId = patch?.laneId || patch?.payload?.laneId;
      if (patchLaneId) {
        setLastEditedLaneId(patchLaneId);
      }
      setEngineJson((prev) => {
        const next = applyEnginePatch(prev, patch);
        if (next && !String(next.name || "").trim()) {
          const fallbackName =
            String(processCard?.generatorInput?.processName || "").trim() ||
            String(next.processId || "").trim() ||
            "Proces";
          next.name = fallbackName;
        }
        if (patch?.type === "RENAME_LANE" && next?.lanes) {
          setProcessCard((prevCard) => ({
            ...prevCard,
            generatorInput: {
              ...prevCard.generatorInput,
              roles: next.lanes.map((lane) => lane.name || lane.id).join("\n"),
            },
          }));
        }
        if (patch?.type === "RENAME_NODE" && next?.nodes) {
          const renamedNode = next.nodes.find((node) => String(node?.id) === String(patch?.id));
          const nodeType = String(renamedNode?.type || "").toLowerCase();
          if (renamedNode && nodeType.includes("start")) {
            setProcessCard((prevCard) => ({
              ...prevCard,
              generatorInput: {
                ...prevCard.generatorInput,
                trigger: String(renamedNode?.name || ""),
              },
            }));
          } else if (renamedNode && nodeType.includes("end")) {
            setProcessCard((prevCard) => ({
              ...prevCard,
              generatorInput: {
                ...prevCard.generatorInput,
                output: String(renamedNode?.name || ""),
              },
            }));
          }
        }
        return next;
      });
      setHasUnsavedChanges(true);
      bumpModelVersion();
      if (guideEnabled) {
        if (guidePatchTimerRef.current) {
          window.clearTimeout(guidePatchTimerRef.current);
        }
        guidePatchTimerRef.current = window.setTimeout(() => {
          runGuideReview("canvas_edit", patchLaneId || null);
        }, 500);
      }
    },
    [guideEnabled, runGuideReview, bumpModelVersion],
  );

  const findCanvasElementByEngineId = useCallback((engineId) => {
    if (!engineId) return null;
    const modeler = modelerRef.current;
    const elementRegistry = modeler?.get?.("elementRegistry", false);
    if (!elementRegistry?.get) return null;
    const direct = elementRegistry.get(engineId);
    if (direct) return direct;
    const all = elementRegistry.getAll?.() || [];
    return (
      all.find(
        (element) =>
          String(element?.businessObject?.$attrs?.["data-engine-id"] || "") === String(engineId),
      ) || null
    );
  }, []);

  const renameCanvasElementByEngineId = useCallback((engineId, nextName) => {
    const element = findCanvasElementByEngineId(engineId);
    const modeler = modelerRef.current;
    const modeling = modeler?.get?.("modeling", false);
    if (!element || !modeling?.updateProperties) return false;
    try {
      modeling.updateProperties(element, { name: nextName });
      return true;
    } catch {
      return false;
    }
  }, [findCanvasElementByEngineId]);

  const syncEngineFromCanvas = useCallback(async () => {
    const modeler = modelerRef.current;
    if (!modeler?.saveXML) return null;
    const { xml: diagramXml } = await modeler.saveXML({ format: true });
    if (!diagramXml || !diagramXml.trim()) return null;
    const file = new File([diagramXml], "diagram.bpmn", { type: "application/bpmn+xml" });
    const importResp = await importBpmn(file);
    const importedEngine = importResp?.engine_json || importResp;
    if (!importedEngine) return null;
    setEngineJson(importedEngine);
    setXmlFull(diagramXml, "syncEngineFromCanvas");
    setHasUnsavedChanges(true);
    bumpModelVersion();
    return importedEngine;
  }, [bumpModelVersion]);

  const getSyncedCanvasSnapshot = useCallback(async () => {
    const modeler = modelerRef.current;
    if (!modeler?.saveXML) {
      throw new Error("Modeler nie je inicializovaný.");
    }
    const { xml: diagramXml } = await modeler.saveXML({ format: true });
    if (!diagramXml || !diagramXml.trim()) {
      throw new Error("Diagram sa nepodarilo serializovať.");
    }
    const file = new File([diagramXml], "diagram.bpmn", { type: "application/bpmn+xml" });
    const importResp = await importBpmn(file);
    const syncedEngine = importResp?.engine_json || importResp;
    if (!syncedEngine) {
      throw new Error("Nepodarilo sa zosynchronizovať model pred uložením.");
    }
    setEngineJson(syncedEngine);
    setXmlFull(diagramXml, "save_snapshot_sync");
    return { engine: syncedEngine, diagramXml };
  }, []);

  useEffect(() => {
    if (!guideEnabled) return;
    const guideWorkspaceActive =
      Boolean(engineJson) || drawerOpen || laneOpen || helpOpen || storyOpen || mentorOpen;
    if (!guideWorkspaceActive) {
      setGuideState(null);
      return;
    }
    if (!engineJson && !guideState) {
      runGuideReview("initial");
    }
  }, [guideEnabled, engineJson, guideState, runGuideReview, drawerOpen, laneOpen, helpOpen, storyOpen, mentorOpen]);

  useEffect(() => {
    if (!guideEnabled) return;
    if (!guideState?.key || !engineJson) return;
    if (guideState.key.startsWith("task_no_")) {
      runGuideReview("engine_change");
    }
  }, [guideEnabled, guideState, engineJson, runGuideReview]);

  useEffect(() => {
    if (!guideEnabled) return;
    if (!engineJson) return;
    if (modelVersion <= 0) return;
    runGuideReview("model_change", activeLaneId || null);
  }, [guideEnabled, engineJson, modelVersion, activeLaneId, runGuideReview]);

  useEffect(() => {
    if (!guideEnabled) return;
    if (typeof window === "undefined") return;
    if (!window.__BPMNGEN_GUIDE_DEBUG) return;
    const nodesCount = Array.isArray(engineJson?.nodes) ? engineJson.nodes.length : 0;
    const flowsCount = Array.isArray(engineJson?.flows) ? engineJson.flows.length : 0;
    const lanesCount = Array.isArray(engineJson?.lanes) ? engineJson.lanes.length : 0;
    console.log(
      "[guide] state=%s reason=%s details=%o",
      guideState?.key || "none",
      guideLastReasonRef.current || "unknown",
      {
        scope: guideState?.scope || null,
        laneId: guideState?.laneId || null,
        findingsCount: Array.isArray(guideFindings) ? guideFindings.length : 0,
        nodesCount,
        flowsCount,
        lanesCount,
        activeLaneId: activeLaneId || null,
        lastEditedLaneId: lastEditedLaneId || null,
      },
    );
  }, [guideEnabled, guideState, guideFindings, engineJson, activeLaneId, lastEditedLaneId]);

  useEffect(() => {
    if (xml) return undefined;
    if (HOME_GUIDE_MESSAGES.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setHomeGuideMessageIndex((current) => (current + 1) % HOME_GUIDE_MESSAGES.length);
    }, 12000);
    return () => {
      window.clearInterval(timer);
    };
  }, [xml]);

  const prevLaneOpenRef = useRef(laneOpen);
  const lastActiveLaneIdRef = useRef(null);

  useEffect(() => {
    if (laneOpen && selectedLane?.id) {
      const laneKey = getSelectedLaneKey(selectedLane);
      setActiveLaneId(laneKey || null);
      lastActiveLaneIdRef.current = laneKey || null;
      return;
    }
    if (!laneOpen) {
      setActiveLaneId(null);
    }
  }, [laneOpen, selectedLane, getSelectedLaneKey]);

  useEffect(() => {
    if (prevLaneOpenRef.current && !laneOpen) {
      runGuideReview("lane_closed", lastActiveLaneIdRef.current);
    }
    prevLaneOpenRef.current = laneOpen;
  }, [laneOpen, runGuideReview]);
  const startOptions = useMemo(() => {
    const nodes = engineJson?.nodes || [];
    const starts = nodes.filter((node) => String(node?.type || "").toLowerCase().includes("start"));
    const sorted = [...starts].sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
    return sorted.map((node, idx) => ({
      id: node.id,
      label: (String(node?.name || "").trim() || `Start ${idx + 1}`),
    }));
  }, [engineJson]);

  const endOptions = useMemo(() => {
    const nodes = engineJson?.nodes || [];
    const ends = nodes.filter((node) => String(node?.type || "").toLowerCase().includes("end"));
    const sorted = [...ends].sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
    return sorted.map((node, idx) => ({
      id: node.id,
      label: (String(node?.name || "").trim() || `Koniec ${idx + 1}`),
    }));
  }, [engineJson]);

  const liveRoleItems = useMemo(
    () =>
      Array.isArray(engineJson?.lanes)
        ? engineJson.lanes.map((lane, idx) => ({
            id: lane?.id || `lane-${idx + 1}`,
            name: String(lane?.name || "").trim() || `Rola ${idx + 1}`,
          }))
        : [],
    [engineJson],
  );

  const primaryStartOption = startOptions[0] || null;
  const primaryEndOption = endOptions[0] || null;
  const hasGeneratedModel = Boolean(engineJson);
  const canonicalStoryOptions = useMemo(
    () => ({
      useLanes: true,
      summarizeParallels: true,
      showEnds: true,
      showBranchEnds: true,
      moreDetails: true,
      selectedStartId: primaryStartOption?.id || null,
    }),
    [primaryStartOption?.id],
  );

  useEffect(() => {
    if (!selectedLane) {
      setLaneInsertOpen(false);
    }
  }, [selectedLane]);

  useEffect(() => {
    if (!selectedLane?.id) return;
    if (lanePanelScrollRef.current) {
      lanePanelScrollRef.current.scrollTop = 0;
    }
    setLaneTemplateChoice("");
    setLaneHelpTipDismissed(false);
  }, [selectedLane?.id]);

  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const canvas = modeler.get("canvas");
    const elementRegistry = modeler.get("elementRegistry");
    if (!canvas || !elementRegistry) return;
    const allElements = elementRegistry.getAll?.() || [];
    allElements
      .filter((element) => element?.businessObject?.$type === "bpmn:Lane")
      .forEach((laneElement) => {
        canvas.removeMarker(laneElement.id, "lane-selected");
      });
    if (selectedLane?.id) {
      const laneElement = resolveLaneElement(elementRegistry, selectedLane);
      if (laneElement?.businessObject?.$type === "bpmn:Lane") {
        canvas.addMarker(laneElement.id, "lane-selected");
      }
    }
  }, [selectedLane, modelVersion, resolveLaneElement]);

  const headerStepperState = useMemo(
    () => ({
      processName:
        (processCard.generatorInput.processName || "").trim() ||
        engineJson?.processName ||
        engineJson?.name ||
        "",
      lanes: engineJson?.lanes || [],
      nodes: engineJson?.nodes || [],
      flows: engineJson?.flows || [],
      mentorNotes,
      mentorLastRunAt,
      lastSavedAt,
      lastExportedAt,
      storyGeneratedAt,
    }),
    [
      engineJson,
      lastExportedAt,
      lastSavedAt,
      storyGeneratedAt,
      mentorLastRunAt,
      mentorNotes,
      processCard.generatorInput.processName,
    ],
  );

  useEffect(() => {
    setHeaderStepperState(headerStepperState);
  }, [headerStepperState, setHeaderStepperState]);

  useEffect(() => () => setHeaderStepperState(null), [setHeaderStepperState]);

  const regenerateStory = useCallback(() => {
    if (!engineJson) {
      setStoryDoc(null);
      setStoryGeneratedAt(null);
      setStoryStale(false);
      storyEngineRef.current = null;
      return;
    }
    const doc = generateProcessStory(engineJson, canonicalStoryOptions);
    setStoryDoc(doc);
    setStoryGeneratedAt(new Date().toISOString());
    setStoryStale(false);
    storyEngineRef.current = engineJson;
  }, [engineJson, canonicalStoryOptions]);

  useEffect(() => {
    if (storyOpen && engineJson && !storyDoc) {
      regenerateStory();
    }
  }, [engineJson, regenerateStory, storyDoc, storyOpen]);

  useEffect(() => {
    if (engineJson) return;
    setStoryDoc(null);
    setStoryGeneratedAt(null);
    setStoryStale(false);
    storyEngineRef.current = null;
  }, [engineJson]);

  useEffect(() => {
    if (!storyOpen || !storyDoc) return;
    if (storyEngineRef.current && storyEngineRef.current !== engineJson) {
      setStoryStale(true);
    }
  }, [engineJson, storyDoc, storyOpen]);

  const buildStoryParagraphs = (doc) => (Array.isArray(doc?.narrative) ? doc.narrative.filter(Boolean) : []);

  const buildStoryText = (doc) => buildStoryParagraphs(doc).join("\n\n").trim();

  const handleCopyStory = async () => {
    const text = buildStoryText(storyDoc);
    if (!text) {
      setInfo("Príbeh procesu zatiaľ nie je pripravený na kopírovanie.");
      return;
    }
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("clipboard_unavailable");
      }
      await navigator.clipboard.writeText(text);
      setInfo("Príbeh procesu bol skopírovaný.");
    } catch (_err) {
      setInfo("Nepodarilo sa skopírovať príbeh procesu.");
    }
  };

  const updateGeneratorInput = (field, value) => {
    if (isDemoMode && field === "roles") {
      const lines = String(value || "").split(/\r?\n/);
      if (lines.length > DEMO_LIMITS.maxRoles) {
        setInfo(`DEMO limit: maximálne ${DEMO_LIMITS.maxRoles} roly.`);
      }
      value = lines.slice(0, DEMO_LIMITS.maxRoles).join("\n");
    }
    setProcessCard((prev) => ({
      ...prev,
      generatorInput: { ...prev.generatorInput, [field]: value },
    }));
    setHasUnsavedChanges(true);
  };

  const updateProcessMeta = (field, value) => {
    setProcessCard((prev) => ({
      ...prev,
      processMeta: { ...prev.processMeta, [field]: value },
    }));
    setHasUnsavedChanges(true);
  };

  const handleStructuredProcessNameChange = useCallback((value) => {
    updateGeneratorInput("processName", value);
    if (!engineJson) return;
    const modeler = modelerRef.current;
    const modeling = modeler?.get?.("modeling", false);
    const elementRegistry = modeler?.get?.("elementRegistry", false);
    if (modeling?.updateProperties && elementRegistry?.getAll) {
      try {
        const candidate =
          elementRegistry
            .getAll()
            .find((element) =>
              String(element?.businessObject?.$type || element?.type || "").includes("Participant"),
            ) ||
          modeler?.get?.("canvas", false)?.getRootElement?.() ||
          null;
        if (candidate) {
          modeling.updateProperties(candidate, { name: value });
        }
      } catch {
        // keep local state update even if canvas root rename is unavailable
      }
    }
    const nextName = String(value || "").trim();
    setEngineJson((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        name: nextName || String(prev?.processId || "").trim() || "Proces",
      };
    });
    bumpModelVersion();
  }, [engineJson, bumpModelVersion]);

  const handleStructuredNodeFieldChange = useCallback((field, nodeId, value) => {
    updateGeneratorInput(field, value);
    if (!engineJson || !nodeId) return;
    const renamed = renameCanvasElementByEngineId(nodeId, value);
    if (!renamed) {
      handleEngineJsonPatch({ type: "RENAME_NODE", id: nodeId, name: value });
    }
  }, [engineJson, handleEngineJsonPatch, renameCanvasElementByEngineId]);

  const handleStructuredLaneRename = useCallback((laneId, value) => {
    if (!laneId) return;
    const renamed = renameCanvasElementByEngineId(laneId, value);
    if (!renamed) {
      handleEngineJsonPatch({ type: "RENAME_LANE", id: laneId, name: value });
    }
  }, [handleEngineJsonPatch, renameCanvasElementByEngineId]);

  const updateLaneDescription = (value) => {
    if (isDemoMode) {
      const lines = String(value || "").split(/\r?\n/);
      if (lines.length > DEMO_LIMITS.maxStepsPerLane) {
        setInfo(`DEMO limit: maximálne ${DEMO_LIMITS.maxStepsPerLane} kroky na rolu.`);
      }
      value = lines.slice(0, DEMO_LIMITS.maxStepsPerLane).join("\n");
    }
    setLaneDescription(value);
  };

  const _appendLine = (current, text) => {
    const base = (current || "").trimEnd();
    return base ? `${base}\n${text}` : text;
  };

  const insertHelpExample = (text) => {
    const snippet = String(text || "").trim();
    if (!snippet) return;
    setLaneDescription((prev) => {
      const current = String(prev || "");
      if (!current.trim()) return snippet;
      const next = `${current.trimEnd()}\n${snippet}`;
      if (!isDemoMode) return next;
      const lines = next.split(/\r?\n/);
      if (lines.length > DEMO_LIMITS.maxStepsPerLane) {
        setInfo(`DEMO limit: maximálne ${DEMO_LIMITS.maxStepsPerLane} kroky na rolu.`);
      }
      return lines.slice(0, DEMO_LIMITS.maxStepsPerLane).join("\n");
    });
    const roleName = helpInsertTarget?.laneName || helpInsertTarget?.laneId || "rola";
    setInfo(`Vložené do roly: ${roleName}`);
    if (helpInsertTarget?.type === "lane") {
      openSingleCard("lane");
    }
    window.requestAnimationFrame(() => {
      const textarea = laneTextareaRef.current;
      if (!textarea) return;
      try {
        textarea.focus();
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
        textarea.scrollTop = textarea.scrollHeight;
      } catch {
        // ignore focus/selection errors
      }
    });
  };

  const findOrgProcessMatchesByName = (tree, name) => {
    if (!tree || !name) return [];
    const target = name.trim().toLowerCase();
    if (!target) return [];
    const matches = [];
    const buildPathLabel = (path) =>
      path
        .filter((node) => node?.type === "folder")
        .map((node) => node.name || node.id)
        .join(" / ") || "root";
    const visit = (node, path = []) => {
      if (!node) return;
      const nextPath = [...path, node];
      if (node.type === "process") {
        const nodeName = String(node.name || "").trim().toLowerCase();
        if (nodeName && nodeName === target) {
          matches.push({ node, path: nextPath, pathLabel: buildPathLabel(nextPath) });
        }
      }
      (node.children || []).forEach((child) => visit(child, nextPath));
    };
    visit(tree);
    return matches;
  };

  const buildHelpTemplate = (rule) => {
    if (!rule?.template) return "";
    if (typeof rule.buildTemplate === "function") {
      return String(rule.buildTemplate(helpInputs[rule.id] || {}));
    }
    let output = rule.template;
    const values = helpInputs[rule.id] || {};
    (rule.fields || []).forEach((field) => {
      const value = (values[field.key] || "").trim();
      output = output.replace(`<${field.token}>`, value || `<${field.token}>`);
    });
    return output;
  };

  const _buildHelpTemplateSegments = (rule) => {
    const template = rule?.template || "";
    const segments = [];
    const tokenRegex = /<([^>]+)>/g;
    let lastIndex = 0;
    let match;
    while ((match = tokenRegex.exec(template))) {
      if (match.index > lastIndex) {
        segments.push({ type: "text", value: template.slice(lastIndex, match.index) });
      }
      segments.push({ type: "field", token: match[1] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < template.length) {
      segments.push({ type: "text", value: template.slice(lastIndex) });
    }
    return segments;
  };

  const renderHelpList = () => (
    <div className="wizard-help-accordion">
      {HELP_RULES.map((rule) => {
        const isOpen = Boolean(helpAccordionOpen[rule.id]);
        const tag =
          rule.id === "task"
            ? "Krok"
            : rule.id === "xor"
              ? "Rozhodnutie"
              : rule.id.includes("and")
                ? "Paralelné"
                : "Pravidlo";
        return (
          <section
            key={rule.id}
            ref={(el) => {
              if (el) {
                helpSectionRefs.current[rule.id] = el;
              }
            }}
            className={`wizard-help-acc-item ${isOpen ? "is-open" : ""} ${activeHelpSection === rule.id ? "is-active" : ""} ${helpHighlightSection === rule.id ? "helper-highlight" : ""}`}
          >
            <button
              type="button"
              className="wizard-help-acc-head"
              onClick={() => setHelpAccordionOpen((prev) => ({ ...prev, [rule.id]: !prev[rule.id] }))}
            >
              <div className="wizard-help-acc-head__left">
                {rule.iconClass ? <span className={`wizard-help-icon ${rule.iconClass}`} aria-hidden="true" /> : null}
                <span className="wizard-help-acc-title">{rule.title}</span>
                <span className="wizard-help-acc-tag">{tag}</span>
              </div>
              <span className="wizard-help-acc-chevron" aria-hidden>{isOpen ? "˄" : "˅"}</span>
            </button>
            {isOpen ? (
              <div className="wizard-help-acc-body">
                {rule.description ? <div className="wizard-help-acc-desc">{rule.description}</div> : null}
                {(rule.fields || []).length ? (
                  <div className="wizard-help-skeleton-inputs">
                    {(rule.fields || []).map((field, index) => (
                      <label key={`${rule.id}-${field.key}`} className="wizard-help-skeleton-input">
                        <span>{field.label}</span>
                        {field.multiline ? (
                          <textarea
                            ref={(el) => {
                              if (el && index === 0) {
                                helpFirstInputRefs.current[rule.id] = el;
                              }
                            }}
                            rows={field.rows || 3}
                            value={helpInputs[rule.id]?.[field.key] || ""}
                            placeholder={field.placeholder}
                            onChange={(e) => updateHelpInput(rule.id, field.key, e.target.value)}
                          />
                        ) : (
                          <input
                            ref={(el) => {
                              if (el && index === 0) {
                                helpFirstInputRefs.current[rule.id] = el;
                              }
                            }}
                            type="text"
                            value={helpInputs[rule.id]?.[field.key] || ""}
                            placeholder={field.placeholder}
                            onChange={(e) => updateHelpInput(rule.id, field.key, e.target.value)}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                ) : null}
                <div className="wizard-help-syntax-wrap">
                  <span className="wizard-help-code-label">Odporúčaný zápis</span>
                  <code className="wizard-help-syntax">{rule.syntax}</code>
                </div>
                <div className="wizard-help-acc-actions">
                  <button
                    type="button"
                    className="btn btn--small btn-primary wizard-help-insert-btn"
                    onClick={() => insertHelpExample(buildHelpTemplate(rule))}
                  >
                    Vložiť do textu
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn-link"
                    onClick={() => {
                      if (helpInsertTarget?.type === "lane") {
                        openSingleCard("lane");
                      }
                    }}
                  >
                    Späť do písania
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );

  const updateHelpInput = (ruleId, key, value) => {
    setHelpInputs((prev) => ({
      ...prev,
      [ruleId]: { ...(prev[ruleId] || {}), [key]: value },
    }));
  };

  const _clearHelpInputs = (rule) => {
    setHelpInputs((prev) => ({
      ...prev,
      [rule.id]: (rule.fields || []).reduce((acc, field) => {
        acc[field.key] = "";
        return acc;
      }, {}),
    }));
  };

  const _activateHelpRule = (rule) => {
    _setHelpActiveRuleId(rule.id);
  };

  useEffect(() => {
    if (selectedLane) {
      setHelpInsertTarget({
        type: "lane",
        laneId: selectedLane.id,
        laneName: selectedLane.name || selectedLane.id,
      });
    } else {
      setHelpInsertTarget({ type: "process" });
    }
  }, [selectedLane]);

  useEffect(() => {
    if (activityOpen) {
      void fetchProjectActivity();
    }
  }, [activityOpen, activeOrgId]);

  useEffect(() => () => {
    if (notesPulseTimerRef.current) {
      window.clearTimeout(notesPulseTimerRef.current);
      notesPulseTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!activeOrgCapabilities.canApproveDeleteRequests) {
      activityPendingIdsRef.current = new Set();
      activityPollingStartedRef.current = false;
      setActivityBadgePulse(false);
      setActivityRequestsPulse(false);
      return undefined;
    }
    if (!String(activeOrgId || "").trim()) {
      return undefined;
    }
    void fetchProjectActivity({ silent: true });
    const intervalId = window.setInterval(() => {
      void fetchProjectActivity({ silent: true });
    }, 10000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeOrgCapabilities.canApproveDeleteRequests, activeOrgId]);

  useEffect(
    () => () => {
      if (activityPulseTimerRef.current) {
        window.clearTimeout(activityPulseTimerRef.current);
      }
      if (activityRequestsPulseTimerRef.current) {
        window.clearTimeout(activityRequestsPulseTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isResizingSidebar) return;
    const onMove = (e) => {
      const rect = layoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      const offset = e.clientX - rect.left;
      const clamped = Math.min(820, Math.max(540, offset));
      setSidebarWidth(clamped);
    };
    const stop = () => setIsResizingSidebar(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (!isResizingPanels) return;
    const onMove = (e) => {
      const delta = e.clientY - verticalResizeStart.current.y;
      const next = Math.min(1200, Math.max(320, verticalResizeStart.current.h + delta));
      setProcessPanelHeight(next);
    };
    const stop = () => setIsResizingPanels(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
    };
  }, [isResizingPanels]);

  const hydrateProcessCard = (payload) => {
    const next = createEmptyProcessCardState();
    const generatorInput = payload?.generator_input || payload?.generatorInput;
    const processMeta = payload?.process_meta || payload?.processMeta;
    if (generatorInput && typeof generatorInput === "object") {
      next.generatorInput = { ...next.generatorInput, ...generatorInput };
    }
    if (processMeta && typeof processMeta === "object") {
      next.processMeta = { ...next.processMeta, ...processMeta };
    }
    setProcessCard(next);
  };

  const resetWizardState = () => {
    setProcessCard(createEmptyProcessCardState());
    setEngineJson(null);
    setXmlFull("", "resetWizardState");
    setSelectedLane(null);
    setLaneDescription("");
    setModelSource({ kind: "sandbox" });
    setOrgReadOnly(false);
    setError(null);
    setInfo(null);
    setIsLoading(false);
    setExportLoading(false);
    setImportLoading(false);
    setSaveLoading(false);
    setLoadLoading(false);
    setHasUnsavedChanges(false);
    setPreviewVersionTag("");
    setMentorNotes([]);
    setMentorDoneIds([]);
    setMentorAppliedIds([]);
    setMentorLoading(false);
    setMentorError(null);
    setMentorApplyingId(null);
    setMentorStatus(null);
    setMentorLastRunAt(null);
    setLastSavedAt(null);
    setLastExportedAt(null);
    setGuideState(null);
    setGuideFindings([]);
    historyRef.current = [];
    setHistoryCount(0);
  };

  const resetDemoState = useCallback(() => {
    resetWizardState();
    setDemoIntroError("");
    setDemoBuildStep(0);
    setDemoBuilding(false);
    setDemoSetupOpen(true);
    setGuideState(null);
    openSingleCard(null);
  }, []);

  const runDemoGenerate = useCallback(async () => {
    const processName = String(processCard?.generatorInput?.processName || "").trim();
    const roleLines = splitLines(processCard?.generatorInput?.roles || "");
    if (!processName) {
      setDemoIntroError("Doplň názov procesu.");
      return;
    }
    if (!roleLines.length) {
      setDemoIntroError("Doplň aspoň 1 rolu.");
      return;
    }
    if (roleLines.length > DEMO_LIMITS.maxRoles) {
      setDemoIntroError(`DEMO limit: maximálne ${DEMO_LIMITS.maxRoles} roly.`);
      return;
    }

    setDemoIntroError("");
    setError(null);
    setInfo(null);
    setDemoBuilding(true);
    setDemoBuildStep(0);
    setIsLoading(true);
    try {
      const payload = mapGeneratorInputToPayload({
        ...processCard.generatorInput,
        processName,
        roles: roleLines.join("\n"),
      });
      const generatePromise = generateLinearWizardDiagram(payload);
      await sleep(450);
      setDemoBuildStep(1);
      await sleep(450);
      setDemoBuildStep(2);
      const response = await generatePromise;
      const generatedEngine = response?.engine_json;
      if (!generatedEngine) {
        throw new Error("Chýba engine_json v odpovedi.");
      }
      const xmlText = await renderEngineXml(generatedEngine);
      setEngineJson(generatedEngine);
      setXmlFull(xmlText, "demo_generate");
      setModelSource({ kind: "sandbox" });
      setSelectedLane(null);
      setLaneDescription("");
      setGuideState({
        key: "demo_skeleton_ready",
        scope: "global",
        title: "Skeleton ready ✅",
        message: "Klikni na rolu a doplň kroky (max 5 objektov na rolu). Potom daj „Vytvoriť aktivity“.",
      });
      setDemoSetupOpen(false);
      setHasUnsavedChanges(true);
      setDrawerOpen(false);
      setHelpOpen(false);
      setMentorOpen(false);
      setStoryOpen(false);
      setOrgOpen(false);
      setLaneOpen(false);
    } catch (e) {
      const message = e?.message || "Nepodarilo sa vytvoriť demo model.";
      setDemoIntroError(message);
      setEngineJson(null);
      setXmlFull("", "demo_generate:clear");
    } finally {
      setDemoBuilding(false);
      setIsLoading(false);
    }
  }, [processCard]);

  const applyDemoTemplate = useCallback((template) => {
    if (!template) return;
    setProcessCard((prev) => ({
      ...prev,
      generatorInput: {
        ...prev.generatorInput,
        processName: template.processName || "",
        roles: template.roles || "",
        trigger: template.trigger || "",
        output: template.output || "",
      },
    }));
    setDemoIntroError("");
    setInfo(`Doplnený vzor: ${template.label}`);
  }, []);

  useEffect(() => {
    if (!isDemoMode) return;
    setProcessCard((prev) => ({
      ...prev,
      generatorInput: {
        ...prev.generatorInput,
        processName: DEMO_DEFAULTS.processName,
        roles: DEMO_DEFAULTS.roles,
        trigger: DEMO_DEFAULTS.trigger,
        output: DEMO_DEFAULTS.output,
      },
    }));
    setDrawerOpen(false);
    setHelpOpen(false);
    setMentorOpen(false);
    setStoryOpen(false);
    setOrgOpen(false);
    setModelsOpen(false);
  }, [isDemoMode]);

  useEffect(() => {
    if (!isDemoMode || typeof window === "undefined") return undefined;
    const onReset = () => resetDemoState();
    const onInfo = () => {
      setDemoSetupOpen(true);
      setDemoIntroError("");
    };
    window.addEventListener("demo-reset-requested", onReset);
    window.addEventListener("demo-info-requested", onInfo);
    return () => {
      window.removeEventListener("demo-reset-requested", onReset);
      window.removeEventListener("demo-info-requested", onInfo);
    };
  }, [isDemoMode, resetDemoState]);

  const handleNewModel = (options = {}) => {
    if (isDemoMode) {
      resetDemoState();
      return;
    }
    const hasWork = Boolean(engineJson || xml || hasUnsavedChanges);
    if (hasWork && !options.skipConfirm) {
      setNewModelConfirmOpen(true);
      return;
    }
    resetWizardState();
    setHelpOpen(false);
    setMentorOpen(false);
    setStoryOpen(false);
    setOrgOpen(false);
    setLaneOpen(false);
    setDrawerOpen(true);
  };

  const handleConfirmNewModel = () => {
    setNewModelConfirmOpen(false);
    handleNewModel({ skipConfirm: true });
  };

  const handleStartNewModel = () => handleNewModel({ skipConfirm: true });

  const handleMainMenu = () => {
    if (isDemoMode) {
      resetDemoState();
      return;
    }
    requestOpenWithSave(() => {
      resetWizardState();
      setGuideState(null);
      setGuideFindings([]);
      setHelpOpen(false);
      setMentorOpen(false);
      setStoryOpen(false);
      setOrgOpen(false);
      setLaneOpen(false);
      setDrawerOpen(false);
    });
  };

  const pushHistorySnapshot = useCallback((engine, diagramXml) => {
    if (!engine || !diagramXml) return;
    const last = historyRef.current[historyRef.current.length - 1];
    if (last?.xml === diagramXml) return;
    let snapshot = null;
    try {
      snapshot = { engine: JSON.parse(JSON.stringify(engine)), xml: diagramXml };
    } catch {
      return;
    }
    const next = [...historyRef.current, snapshot].slice(-5);
    historyRef.current = next;
    setHistoryCount(next.length);
  }, []);

  const handleUndo = () => {
    if (!historyRef.current.length) return;
    const snapshot = historyRef.current.pop();
    setHistoryCount(historyRef.current.length);
    if (!snapshot) return;
    undoInProgressRef.current = true;
    setEngineJson(snapshot.engine);
    setXmlFull(snapshot.xml, "undo_snapshot");
    lastSyncedXmlRef.current = snapshot.xml;
    if (Array.isArray(snapshot.engine?.lanes) && snapshot.engine.lanes.length) {
      setProcessCard((prev) => ({
        ...prev,
        generatorInput: {
          ...prev.generatorInput,
          roles: snapshot.engine.lanes.map((lane) => lane.name || lane.id).join("\n"),
        },
      }));
    }
    window.setTimeout(() => {
      undoInProgressRef.current = false;
    }, 0);
  };

  const applyLaneOrder = useCallback(
    async (nextLanes) => {
      if (!engineJson) return;
      if (!undoInProgressRef.current) {
        pushHistorySnapshot(engineJson, xml);
      }
      setHasUnsavedChanges(true);
      const updatedEngine = { ...engineJson, lanes: nextLanes };
      setEngineJson(updatedEngine);
      setProcessCard((prev) => ({
        ...prev,
        generatorInput: {
          ...prev.generatorInput,
          roles: nextLanes.map((lane) => lane.name || lane.id).join("\n"),
        },
      }));
      try {
        const updatedXml = await renderEngineXml(updatedEngine);
        setXmlFull(updatedXml, "applyLaneOrder");
      } catch (e) {
        const message = e?.message || "Nepodarilo sa nacitat modely.";
        setError(message);
      }
    },
    [engineJson, pushHistorySnapshot, xml],
  );

  const handleDiagramChange = useCallback(
    async (diagramXmlOrEvent) => {
      if (
        diagramXmlOrEvent &&
        typeof diagramXmlOrEvent === "object" &&
        diagramXmlOrEvent.kind === "canvas_edit"
      ) {
        bumpModelVersion();
        setHasUnsavedChanges(true);
        const modeler = modelerRef.current;
        const elementRegistry = modeler?.get?.("elementRegistry");
        if (!elementRegistry || !engineJson) return;

        const laneElements = elementRegistry
          .getAll()
          .filter((el) => String(el?.businessObject?.$type || el?.type || "").includes("Lane"));

        const laneMetas = laneElements
          .map((el) => {
            const engineId = String(el?.businessObject?.$attrs?.["data-engine-id"] || "").trim();
            const boId = String(el?.businessObject?.id || "").trim();
            const elementId = String(el?.id || "").trim();
            const name = String(el?.businessObject?.name || "").trim();
            const keys = [engineId, boId, elementId].filter(Boolean);
            return {
              keys,
              name,
              y: Number(el?.y || 0),
            };
          })
          .sort((a, b) => a.y - b.y);

        const findLaneMetaForModelLane = (lane) => {
          const laneId = String(lane?.id || "").trim();
          const laneName = String(lane?.name || "").trim();
          let found = null;
          if (laneId) {
            found = laneMetas.find((meta) => meta.keys.includes(laneId)) || null;
          }
          if (!found && laneName) {
            found = laneMetas.find((meta) => meta.name === laneName) || null;
          }
          return found;
        };

        const prevLanes = Array.isArray(engineJson?.lanes) ? engineJson.lanes : [];
        let nextLanes = prevLanes
          .map((lane) => {
            const match = findLaneMetaForModelLane(lane);
            if (!match) return null;
            return {
              ...lane,
              name: match.name || lane.name || lane.id,
            };
          })
          .filter(Boolean);

        if (!nextLanes.length && laneMetas.length) {
          nextLanes = laneMetas.map((meta, idx) => {
            const fallbackId = meta.keys[0] || `lane_${idx + 1}`;
            return {
              id: fallbackId,
              name: meta.name || fallbackId,
            };
          });
        }

        const laneIds = new Set(nextLanes.map((lane) => String(lane?.id || "")).filter(Boolean));
        const activeLaneDeleted = activeLaneId && !laneIds.has(String(activeLaneId));
        const selectedLaneDeleted = selectedLane?.id && !laneIds.has(String(selectedLane.id));
        const lastEditedLaneDeleted = lastEditedLaneId && !laneIds.has(String(lastEditedLaneId));

        if (activeLaneDeleted || selectedLaneDeleted) {
          setLaneOpen(false);
          setLaneInsertOpen(false);
        }
        if (activeLaneDeleted) {
          setActiveLaneId(null);
        }
        if (selectedLaneDeleted) {
          setSelectedLane(null);
        }
        if (lastEditedLaneDeleted) {
          setLastEditedLaneId(null);
        }

        const lanesChanged =
          nextLanes.length !== prevLanes.length ||
          nextLanes.some((lane, idx) => {
            const prev = prevLanes[idx];
            return !prev || String(prev.id || "") !== String(lane.id || "") || String(prev.name || "") !== String(lane.name || "");
          });

        if (lanesChanged) {
          setEngineJson((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              lanes: nextLanes,
            };
          });
          setProcessCard((prev) => ({
            ...prev,
            generatorInput: {
              ...prev.generatorInput,
              roles: nextLanes.map((lane) => lane.name || lane.id).join("\n"),
            },
          }));
          setHasUnsavedChanges(true);
        }
        return;
      }

      const diagramXml = typeof diagramXmlOrEvent === "string" ? diagramXmlOrEvent : "";
      pendingDiagramXmlRef.current = diagramXml;
      if (!diagramXml || !diagramXml.trim()) return;
      if (syncInFlightRef.current) return;
      if (undoInProgressRef.current) return;
      if (diagramXml === lastSyncedXmlRef.current) return;
      if (!engineJson) return;
      pushHistorySnapshot(engineJson, xml);
      syncInFlightRef.current = true;
      try {
        const file = new File([diagramXml], "diagram.bpmn", {
          type: "application/bpmn+xml",
        });
        const response = await importBpmn(file);
        const importedEngine = response?.engine_json || response;
        if (importedEngine) {
          setEngineJson(importedEngine);
          if (diagramXml !== xml) {
          setXmlFull(diagramXml, "applyLoadedModel:diagram");
          }
          if (Array.isArray(importedEngine.lanes) && importedEngine.lanes.length) {
            setProcessCard((prev) => ({
              ...prev,
              generatorInput: {
                ...prev.generatorInput,
                roles: importedEngine.lanes.map((lane) => lane.name || lane.id).join("\n"),
              },
            }));
          }
          lastSyncedXmlRef.current = diagramXml;
          setHasUnsavedChanges(true);
        }
      } catch (e) {
        const message = e?.message || "Nepodarilo sa synchronizovať zmeny v diagrame.";
        setError(message);
      } finally {
        syncInFlightRef.current = false;
        const pendingXml = pendingDiagramXmlRef.current;
        if (pendingXml && pendingXml !== diagramXml && pendingXml !== lastSyncedXmlRef.current) {
          pendingDiagramXmlRef.current = "";
          window.setTimeout(() => handleDiagramChange(pendingXml), 0);
        }
      }
    },
    [
      activeLaneId,
      bumpModelVersion,
      engineJson,
      lastEditedLaneId,
      pushHistorySnapshot,
      selectedLane,
      xml,
    ],
  );

  const findLaneIndex = (laneRef, lanes) => {
    if (!laneRef || !Array.isArray(lanes)) return -1;
    const refId = (laneRef.id || laneRef.laneId || laneRef).toString().trim();
    const refName = (laneRef.name || "").toString().trim();
    if (refId) {
      const byId = lanes.findIndex((lane) => lane.id === refId);
      if (byId >= 0) return byId;
    }
    if (refName) {
      const refLower = refName.toLowerCase();
      return lanes.findIndex((lane) => (lane.name || lane.id || "").toLowerCase() === refLower);
    }
    return -1;
  };

  const _moveLane = async (laneId, direction) => {
    if (!engineJson?.lanes?.length) return;
    const currentIndex = findLaneIndex(laneId, engineJson.lanes);
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= engineJson.lanes.length) return;
    const nextLanes = [...engineJson.lanes];
    const [lane] = nextLanes.splice(currentIndex, 1);
    nextLanes.splice(nextIndex, 0, lane);
    await applyLaneOrder(nextLanes);
  };

  const reorderLanesByNames = useCallback(
    async (laneNames) => {
      if (!engineJson?.lanes?.length || !Array.isArray(laneNames) || !laneNames.length) {
        return;
      }
      const usedIndexes = new Set();
      const ordered = [];
      laneNames.forEach((name) => {
        const idx = engineJson.lanes.findIndex(
          (lane, laneIndex) => !usedIndexes.has(laneIndex) && (lane.name || lane.id) === name,
        );
        if (idx >= 0) {
          usedIndexes.add(idx);
          ordered.push(engineJson.lanes[idx]);
        }
      });
      engineJson.lanes.forEach((lane, laneIndex) => {
        if (!usedIndexes.has(laneIndex)) {
          ordered.push(lane);
        }
      });
      const unchanged =
        ordered.length === engineJson.lanes.length &&
        ordered.every((lane, idx) => lane.id === engineJson.lanes[idx].id);
      if (unchanged) return;
      await applyLaneOrder(ordered);
    },
    [applyLaneOrder, engineJson],
  );

  const handleGenerate = async () => {
    setDrawerOpen(false);
    if (isDemoMode) {
      await runDemoGenerate();
      return;
    }
    if (isReadOnlyMode) {
      setInfo("Rezim: len na citanie. Najprv klikni Upravit.");
      return;
    }
    setError(null);
    setInfo(null);
    if (engineJson) {
      setRegenerateConfirmOpen(true);
      return;
    }
    setIsLoading(true);
    try {
      if (engineJson && xml && !undoInProgressRef.current) {
        pushHistorySnapshot(engineJson, xml);
      }
      const payload = mapGeneratorInputToPayload(processCard.generatorInput);
      const response = await generateLinearWizardDiagram(payload);
      const generatedEngine = response?.engine_json;
      if (!generatedEngine) {
        throw new Error("Chýba engine_json v odpovedi.");
      }
      setEngineJson(generatedEngine);
      const xmlText = await renderEngineXml(generatedEngine);
      setXmlFull(xmlText, "handleGenerate");
      setHasUnsavedChanges(true);
    } catch (e) {
      const message = e?.message || "Failed to generate diagram";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmRegenerate = async () => {
    setRegenerateConfirmOpen(false);
    setIsLoading(true);
    try {
      if (engineJson && xml && !undoInProgressRef.current) {
        pushHistorySnapshot(engineJson, xml);
      }
      const payload = mapGeneratorInputToPayload(processCard.generatorInput);
      const response = await generateLinearWizardDiagram(payload);
      const generatedEngine = response?.engine_json;
      if (!generatedEngine) {
        throw new Error("Chýba engine_json v odpovedi.");
      }
      setEngineJson(generatedEngine);
      const xmlText = await renderEngineXml(generatedEngine);
      setXmlFull(xmlText, "handleGenerate");
      setHasUnsavedChanges(true);
    } catch (e) {
      const message = e?.message || "Failed to generate diagram";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const previewName =
    engineJson?.name ||
    engineJson?.processName ||
    processCard.generatorInput.processName?.trim() ||
    "Náhľad BPMN";
  const previewVersion = (processCard.processMeta?.version || "").trim();
  const previewVersionLabel = previewVersion ? `Verzia: ${previewVersion}` : "";

  const normalizeNoteStatus = (value) => {
    const raw = String(value || "").toLowerCase();
    if (raw === "reviewed" || raw === "skontrolovane") return "reviewed";
    if (raw === "agreed" || raw === "dohodnute") return "agreed";
    return "new";
  };

  const normalizeNote = (note) => {
    if (!note || typeof note !== "object") return note;
    return {
      ...note,
      status: normalizeNoteStatus(note.status),
      replies: Array.isArray(note.replies)
        ? note.replies.map((reply) => (reply && typeof reply === "object" ? reply : null)).filter(Boolean)
        : [],
    };
  };

  const getCurrentUserNoteAuthor = () => {
    const email = String(currentUser?.email || "").trim();
    const name = String(currentUser?.name || currentUser?.full_name || "").trim();
    if (name) {
      return { createdByName: name, createdByEmail: email || undefined };
    }
    if (email) {
      return { createdByName: email, createdByEmail: email };
    }
    return { createdByName: "Neznamy pouzivatel" };
  };

  const formatNoteMetaLine = (item) => {
    if (!item || typeof item !== "object") return "";
    const actor =
      String(item.createdByName || item.created_by_name || item.createdByEmail || item.created_by_email || "").trim();
    const createdAt = item.createdAt || item.created_at;
    const parts = [];
    if (actor) parts.push(`Pridal: ${actor}`);
    if (createdAt) {
      const when = formatDateTime(createdAt);
      if (when) parts.push(when);
    }
    return parts.join(" · ");
  };

  const getProjectNotesSeenStorageKey = (orgId) => `PROJECT_NOTES_LAST_SEEN:${String(orgId || "").trim()}`;

  const readProjectNotesLastSeen = useCallback((orgId) => {
    const scopedOrgId = String(orgId || "").trim();
    if (!scopedOrgId || typeof window === "undefined") return "";
    return window.localStorage.getItem(getProjectNotesSeenStorageKey(scopedOrgId)) || "";
  }, []);

  const markProjectNotesSeen = useCallback((orgId, seenAt = new Date().toISOString()) => {
    const scopedOrgId = String(orgId || "").trim();
    if (!scopedOrgId || typeof window === "undefined") return;
    window.localStorage.setItem(getProjectNotesSeenStorageKey(scopedOrgId), seenAt);
    setProjectNotesLastSeenAt(seenAt);
    notesUnreadIdsRef.current = new Set();
    notesPollingStartedRef.current = true;
    setNotesBadgePulse(false);
    if (notesPulseTimerRef.current) {
      window.clearTimeout(notesPulseTimerRef.current);
      notesPulseTimerRef.current = null;
    }
  }, []);

  const fetchProjectNotes = async ({ silent = false } = {}) => {
    const scopedOrgId = String(activeOrgId || "").trim();
    if (!scopedOrgId) {
      setProjectNotes([]);
      setProjectNotesError(null);
      if (!silent) {
        setProjectNotesLoading(false);
      }
      setEditingNoteId(null);
      setEditingNoteText("");
      notesUnreadIdsRef.current = new Set();
      notesPollingStartedRef.current = false;
      return;
    }
    if (!silent) {
      setProjectNotesLoading(true);
      setProjectNotesError(null);
    }
    try {
      const resp = await getProjectNotes(scopedOrgId);
      const incoming = Array.isArray(resp?.notes) ? resp.notes.map(normalizeNote) : [];
      setProjectNotes(incoming);
      if (!silent) {
        setEditingNoteId(null);
        setEditingNoteText("");
      }
      const selfEmail = String(currentUser?.email || "").trim().toLowerCase();
      const resolvedSeenAt = readProjectNotesLastSeen(scopedOrgId);
      if (resolvedSeenAt !== projectNotesLastSeenAt) {
        setProjectNotesLastSeenAt(resolvedSeenAt);
      }
      const seenAtMs = resolvedSeenAt ? Date.parse(resolvedSeenAt) : Number.NaN;
      const hasSeenMarker = Number.isFinite(seenAtMs);
      const nextUnreadIds = new Set();
      incoming.forEach((note) => {
        const noteActorEmail = String(note?.createdByEmail || note?.created_by_email || "").trim().toLowerCase();
        const noteCreatedAt = Date.parse(note?.createdAt || note?.created_at || "");
        if ((!selfEmail || noteActorEmail !== selfEmail) && Number.isFinite(noteCreatedAt) && (!hasSeenMarker || noteCreatedAt > seenAtMs)) {
          nextUnreadIds.add(`note:${note.id}`);
        }
        (note?.replies || []).forEach((reply) => {
          const replyActorEmail = String(reply?.createdByEmail || reply?.created_by_email || "").trim().toLowerCase();
          const replyCreatedAt = Date.parse(reply?.createdAt || reply?.created_at || "");
          if ((!selfEmail || replyActorEmail !== selfEmail) && Number.isFinite(replyCreatedAt) && (!hasSeenMarker || replyCreatedAt > seenAtMs)) {
            nextUnreadIds.add(`reply:${note.id}:${reply.id}`);
          }
        });
      });
      const hasNewUnread =
        notesPollingStartedRef.current &&
        Array.from(nextUnreadIds).some((id) => !notesUnreadIdsRef.current.has(id));
      notesUnreadIdsRef.current = nextUnreadIds;
      notesPollingStartedRef.current = true;
      if (hasNewUnread && !notesOpen) {
        setNotesBadgePulse(true);
        if (notesPulseTimerRef.current) {
          window.clearTimeout(notesPulseTimerRef.current);
        }
        notesPulseTimerRef.current = window.setTimeout(() => {
          setNotesBadgePulse(false);
          notesPulseTimerRef.current = null;
        }, 1600);
      }
    } catch (e) {
      const message = e?.message || "Nepodarilo sa nacitat poznamky.";
      setProjectNotesError(message);
    } finally {
      if (!silent) {
        setProjectNotesLoading(false);
      }
    }
  };

  useEffect(() => {
    setProjectNotesLastSeenAt(readProjectNotesLastSeen(activeOrgId));
    notesUnreadIdsRef.current = new Set();
    notesPollingStartedRef.current = false;
    setNotesBadgePulse(false);
  }, [activeOrgId, readProjectNotesLastSeen]);

  useEffect(() => {
    if (notesOpen) {
      void fetchProjectNotes();
      markProjectNotesSeen(activeOrgId);
    }
  }, [notesOpen, activeOrgId, markProjectNotesSeen]);

  useEffect(() => {
    const scopedOrgId = String(activeOrgId || "").trim();
    if (!scopedOrgId) return undefined;
    const timerId = window.setInterval(() => {
      void fetchProjectNotes({ silent: true });
    }, 10000);
    return () => window.clearInterval(timerId);
  }, [activeOrgId]);

  const persistProjectNotes = async (nextNotes) => {
    const scopedOrgId = String(activeOrgId || "").trim();
    if (!scopedOrgId) {
      setProjectNotesError("Najprv si zvoľ aktívnu organizáciu.");
      return;
    }
    const normalized = (nextNotes || []).map(normalizeNote);
    setProjectNotes(normalized);
    setProjectNotesSaving(true);
    setProjectNotesError(null);
    try {
      const resp = await saveProjectNotes(normalized, scopedOrgId);
      if (Array.isArray(resp?.notes)) {
        setProjectNotes(resp.notes.map(normalizeNote));
      }
    } catch (e) {
      const message = e?.message || "Nepodarilo sa ulozit poznamky.";
      setProjectNotesError(message);
    } finally {
      setProjectNotesSaving(false);
    }
  };

  const addProjectNote = async () => {
    const text = noteDraft.trim();
    if (!text) return;
    const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const next = {
      id,
      text,
      status: "new",
      replies: [],
      createdAt: new Date().toISOString(),
      ...getCurrentUserNoteAuthor(),
    };
    await persistProjectNotes([next, ...projectNotes]);
    setNoteDraft("");
  };

  const startEditProjectNote = (note) => {
    setEditingNoteId(note.id);
    setEditingNoteText(note.text || "");
  };

  const cancelEditProjectNote = () => {
    setEditingNoteId(null);
    setEditingNoteText("");
  };

  const saveEditProjectNote = (id) => {
    const text = editingNoteText.trim();
    if (!text) return;
    updateProjectNote(id, { text });
    cancelEditProjectNote();
  };

  const updateProjectNote = (id, updates) => {
    const next = projectNotes.map((note) => (note.id === id ? { ...note, ...updates } : note));
    void persistProjectNotes(next);
  };

  const addProjectNoteReply = (id) => {
    const text = String(replyDrafts[id] || "").trim();
    if (!text) return;
    const reply = {
      id: `reply_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text,
      createdAt: new Date().toISOString(),
      ...getCurrentUserNoteAuthor(),
    };
    const next = projectNotes.map((note) =>
      note.id === id
        ? {
            ...note,
            replies: [...(note.replies || []), reply],
          }
        : note,
    );
    setReplyDrafts((prev) => ({ ...prev, [id]: "" }));
    setReplyOpenById((prev) => ({ ...prev, [id]: false }));
    void persistProjectNotes(next);
  };


  const startEditReply = (noteId, reply) => {
    setReplyEditing({ noteId, replyId: reply.id, text: reply.text || "" });
  };

  const cancelEditReply = () => {
    setReplyEditing({ noteId: null, replyId: null, text: "" });
  };

  const saveEditReply = () => {
    const { noteId, replyId, text } = replyEditing;
    const nextText = String(text || "").trim();
    if (!noteId || !replyId || !nextText) return;
    const next = projectNotes.map((note) => {
      if (note.id != noteId) return note;
      const replies = (note.replies || []).map((r) => (r.id === replyId ? { ...r, text: nextText } : r));
      return { ...note, replies };
    });
    void persistProjectNotes(next);
    cancelEditReply();
  };

  const removeReply = (noteId, replyId) => {
    const next = projectNotes.map((note) => {
      if (note.id != noteId) return note;
      const replies = (note.replies || []).filter((r) => r.id !== replyId);
      return { ...note, replies };
    });
    void persistProjectNotes(next);
  };

  const removeProjectNote = (id) => {
    const next = projectNotes.filter((note) => note.id !== id);
    void persistProjectNotes(next);
  };

  const insertLaneBlock = (blockType) => {
    if (isReadOnlyMode) {
      setInfo("Rezim: len na citanie. Najprv klikni Upravit.");
      return;
    }
    if (!selectedLane) {
      setError("Najprv vyber lane, do ktorej chces vlozit blok.");
      return;
    }
    if (!modelerRef.current) {
      setError("Modeler nie je pripraveny.");
      return;
    }
    const modeler = modelerRef.current;
    const elementRegistry = modeler.get("elementRegistry");
    const modeling = modeler.get("modeling");
    const elementFactory = modeler.get("elementFactory");
    const selection = modeler.get("selection");
    const canvas = modeler.get("canvas");
    const laneElement = resolveLaneElement(elementRegistry, selectedLane);
    if (!laneElement || !modeling || !elementFactory) {
      setError("Lane sa nepodarilo najst.");
      return;
    }

    const gatewayType = blockType === "and" ? "bpmn:ParallelGateway" : "bpmn:ExclusiveGateway";
    const taskLabelBase = blockType === "and" ? "Paralela" : "Vetva";
    const gatewaySize = { width: 72, height: 72 };
    const taskSize = { ...STANDARD_TASK_SIZE };
    const gapX = 120;
    const branchOffset = taskSize.height + 20;

    const laneNodes = collectLaneFlowNodes(laneElement, elementRegistry);
    const orderedNodes = [...laneNodes].sort((a, b) => (a.x || 0) - (b.x || 0));
    const firstNode = orderedNodes[0] || null;
    const lastNode = orderedNodes[orderedNodes.length - 1] || null;
    const globalRightmost = computeCrossLaneAnchorX(laneElement, elementRegistry, engineJson);

    const base = computeLaneInsertPosition(
      laneElement,
      gatewaySize,
      "end",
      firstNode,
      lastNode,
      globalRightmost,
    );

    const centerY = base.y + gatewaySize.height / 2;
    let taskATop = centerY - branchOffset - taskSize.height / 2;
    let taskBTop = centerY + branchOffset - taskSize.height / 2;
    const laneTop = laneElement.y + 30;
    const laneBottom = laneElement.y + laneElement.height - taskSize.height - 30;
    if (taskATop < laneTop) {
      const shift = laneTop - taskATop;
      taskATop += shift;
      taskBTop += shift;
    }
    if (taskBTop > laneBottom) {
      const shift = taskBTop - laneBottom;
      taskATop -= shift;
      taskBTop -= shift;
    }

    const splitShape = elementFactory.createShape({ type: gatewayType, ...gatewaySize });
    const joinShape = elementFactory.createShape({ type: gatewayType, ...gatewaySize });
    const taskA = elementFactory.createShape({ type: "bpmn:Task", ...taskSize });
    const taskB = elementFactory.createShape({ type: "bpmn:Task", ...taskSize });

    const splitPos = { x: base.x, y: base.y };
    const taskX = splitPos.x + gatewaySize.width + gapX;
    const joinX = taskX + taskSize.width + gapX;
    const joinY = base.y;

    const createdSplit = modeling.createShape(splitShape, splitPos, laneElement);
    const createdTaskA = modeling.createShape(taskA, { x: taskX, y: taskATop }, laneElement);
    const createdTaskB = modeling.createShape(taskB, { x: taskX, y: taskBTop }, laneElement);
    const createdJoin = modeling.createShape(joinShape, { x: joinX, y: joinY }, laneElement);

    attachNodeToLane(laneElement, createdSplit, modeling);
    attachNodeToLane(laneElement, createdTaskA, modeling);
    attachNodeToLane(laneElement, createdTaskB, modeling);
    attachNodeToLane(laneElement, createdJoin, modeling);

    modeling.updateProperties(createdTaskA, { name: `${taskLabelBase} A` });
    modeling.updateProperties(createdTaskB, { name: `${taskLabelBase} B` });

    if (lastNode) {
      modeling.connect(lastNode, createdSplit);
    }
    const flowA = modeling.connect(createdSplit, createdTaskA);
    const flowB = modeling.connect(createdSplit, createdTaskB);
    modeling.connect(createdTaskA, createdJoin);
    modeling.connect(createdTaskB, createdJoin);
    if (gatewayType === "bpmn:ExclusiveGateway") {
      try {
        modeling.updateProperties(flowA, { name: "Áno" });
        modeling.updateProperties(flowB, { name: "Nie" });
      } catch {
        // ignore label update errors
      }
    }
    fitLaneHeightAfterInsert(laneElement, modeler, modeling);

    selection?.select(createdJoin);
    if (typeof canvas?.scrollToElement === "function") {
      canvas.scrollToElement(createdJoin);
    }

    scheduleRelayoutKick("insert_block", 150);

    setError(null);
  };
  const fitLaneHeightAfterInsert = (laneElement, modeler, modeling) => {
    if (!laneElement?.id || !modeler || !modeling) return;
    const PADDING_BOTTOM = 100;
    const EXTRA_MARGIN = 10;
    const MIN_LANE_HEIGHT = 220;
    const elementRegistry = modeler.get("elementRegistry");
    if (!elementRegistry) return;
    const currentLane = elementRegistry.get(laneElement.id);
    if (!currentLane) return;
    const oldTop = Number(currentLane.y || 0);
    const oldHeight = Number(currentLane.height || 0);
    const oldBottom = oldTop + oldHeight;
    const laneLeft = Number(currentLane.x || 0);
    const laneRight = laneLeft + Number(currentLane.width || 0);
    const laneNodes = elementRegistry
      .getAll()
      .filter((el) => {
        if (!el || el.type === "label") return false;
        const bo = el.businessObject;
        if (!bo?.$instanceOf?.("bpmn:FlowNode")) return false;
        const cx = Number(el.x || 0) + Number(el.width || 0) / 2;
        const cy = Number(el.y || 0) + Number(el.height || 0) / 2;
        return cx >= laneLeft && cx <= laneRight && cy >= oldTop && cy <= oldBottom;
      });
    if (!laneNodes.length) return;
    const maxBottomRaw = laneNodes.reduce(
      (maxY, el) => Math.max(maxY, Number(el.y || 0) + Number(el.height || 0)),
      oldBottom,
    );
    const maxBottom = maxBottomRaw + EXTRA_MARGIN;
    const computedHeight = Math.ceil((maxBottom - oldTop) + PADDING_BOTTOM);
    const neededHeight = Math.max(MIN_LANE_HEIGHT, computedHeight);
    if (neededHeight <= oldHeight + 1) return;
    const deltaY = neededHeight - oldHeight;
    try {
      if (typeof modeling.resizeShape === "function") {
        modeling.resizeShape(currentLane, {
          x: Number(currentLane.x || 0),
          y: oldTop,
          width: Number(currentLane.width || 0),
          height: neededHeight,
        });
      } else {
        modeling.updateProperties(currentLane, { height: neededHeight });
      }
    } catch {
      return;
    }
    const refreshedLane = elementRegistry.get(currentLane.id) || currentLane;
    const allLanes = elementRegistry
      .getAll()
      .filter((el) => String(el?.businessObject?.$type || el?.type || "").includes("Lane"));
    const lanesBelow = allLanes
      .filter((ln) => ln.id !== refreshedLane.id && Number(ln.y || 0) >= oldBottom - 1)
      .sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
    lanesBelow.forEach((ln) => {
      try {
        if (typeof modeling.moveShape === "function") {
          modeling.moveShape(ln, { x: 0, y: deltaY }, ln.parent || refreshedLane.parent);
        }
      } catch {
        // ignore lane shift errors
      }
    });
    const container = refreshedLane.parent || null;
    if (!container) return;
    const cX = Number(container.x || 0);
    const cY = Number(container.y || 0);
    const cW = Number(container.width || 0);
    const cH = Number(container.height || 0);
    if (!(cW > 0 && cH > 0)) return;
    try {
      if (typeof modeling.resizeShape === "function") {
        modeling.resizeShape(container, { x: cX, y: cY, width: cW, height: cH + deltaY });
      } else {
        modeling.updateProperties(container, { height: cH + deltaY });
      }
    } catch {
      // ignore container resize errors
    }
  };

  const fetchProjectActivity = async ({ silent = false } = {}) => {
    const scopedOrgId = String(activeOrgId || "").trim();
    if (!scopedOrgId) {
      setProjectActivityItems([]);
      setProjectActivityError(null);
      setProjectActivityLoading(false);
      activityPendingIdsRef.current = new Set();
      activityPollingStartedRef.current = false;
      return;
    }
    if (!silent) {
      setProjectActivityLoading(true);
      setProjectActivityError(null);
    }
    try {
      const resp = await listOrgActivity(scopedOrgId, 20);
      const items = Array.isArray(resp?.items) ? resp.items : [];
      setProjectActivityItems(items);
      const resolvedRequestIds = new Set();
      items.forEach((item) => {
        const type = String(item?.event_type || "").toLowerCase();
        const requestId = item?.metadata?.request_id;
        if ((type === "delete_request_approved" || type === "delete_request_rejected") && requestId) {
          resolvedRequestIds.add(String(requestId));
        }
      });
      const nextPendingIds = new Set(
        items
          .filter((item) => {
            const type = String(item?.event_type || "").toLowerCase();
            return type === "delete_requested" && item?.id && !resolvedRequestIds.has(String(item.id));
          })
          .map((item) => String(item.id)),
      );
      const previousPendingIds = activityPendingIdsRef.current;
      const hasNewPending =
        activityPollingStartedRef.current &&
        Array.from(nextPendingIds).some((id) => !previousPendingIds.has(id));
      activityPendingIdsRef.current = nextPendingIds;
      activityPollingStartedRef.current = true;
      if (hasNewPending) {
        setActivityBadgePulse(true);
        setActivityRequestsPulse(true);
        if (activityPulseTimerRef.current) {
          window.clearTimeout(activityPulseTimerRef.current);
        }
        if (activityRequestsPulseTimerRef.current) {
          window.clearTimeout(activityRequestsPulseTimerRef.current);
        }
        activityPulseTimerRef.current = window.setTimeout(() => {
          setActivityBadgePulse(false);
          activityPulseTimerRef.current = null;
        }, 1600);
        activityRequestsPulseTimerRef.current = window.setTimeout(() => {
          setActivityRequestsPulse(false);
          activityRequestsPulseTimerRef.current = null;
        }, 2200);
      }
    } catch (e) {
      setProjectActivityItems([]);
      setProjectActivityError(e?.message || "Nepodarilo sa nacitat aktivitu.");
    } finally {
      if (!silent) {
        setProjectActivityLoading(false);
      }
    }
  };

  const describeProjectActivity = (item) => {
    const actor = item?.actor_email || "Neznamy pouzivatel";
    const name = item?.entity_name || item?.entity_id || "polozka";
    const type = String(item?.event_type || "").toLowerCase();
    if (type === "process_created") return `${actor} vytvoril proces "${name}".`;
    if (type === "process_renamed") return `${actor} premenoval proces na "${name}".`;
    if (type === "process_moved") return `${actor} presunul proces "${name}".`;
    if (type === "process_deleted") return `${actor} odstranil proces "${name}".`;
    if (type === "model_pushed_to_org") return `${actor} pushol model "${name}" do organizacie.`;
    if (type === "member_added") return `${actor} pridal clena "${name}".`;
    if (type === "member_removed") return `${actor} odstranil clena "${name}".`;
    if (type === "invite_link_created") return `${actor} vytvoril invite link.`;
    if (type === "invite_link_regenerated") return `${actor} regeneroval invite link.`;
    if (type === "delete_requested") return `${actor} poziadal o odstranenie procesu "${name}".`;
    if (type === "delete_request_approved") return `${actor} schvalil odstranenie procesu "${name}".`;
    if (type === "delete_request_rejected") return `${actor} zamietol odstranenie procesu "${name}".`;
    return `${actor} vykonal akciu "${type || "unknown"}".`;
  };

  const getProjectActivityCategory = useCallback((item) => {
    const type = String(item?.event_type || "").toLowerCase();
    if (type.startsWith("delete_request") || type === "delete_requested") return "requests";
    if (type.startsWith("process_") || type === "model_pushed_to_org" || type.startsWith("folder_")) return "models";
    if (type.startsWith("member_") || type.startsWith("invite_")) return "members";
    return "other";
  }, []);

  const resolvedDeleteRequestIds = useMemo(() => {
    const ids = new Set();
    projectActivityItems.forEach((item) => {
      const type = String(item?.event_type || "").toLowerCase();
      const requestId = item?.metadata?.request_id;
      if ((type === "delete_request_approved" || type === "delete_request_rejected") && requestId) {
        ids.add(String(requestId));
      }
    });
    return ids;
  }, [projectActivityItems]);

  const isPendingDeleteRequest = useCallback(
    (item) =>
      String(item?.event_type || "").toLowerCase() === "delete_requested" &&
      item?.id &&
      !resolvedDeleteRequestIds.has(String(item.id)),
    [resolvedDeleteRequestIds],
  );

  const getProjectActivityStatus = useCallback(
    (item) => {
      const type = String(item?.event_type || "").toLowerCase();
      if (type === "delete_requested") {
        return isPendingDeleteRequest(item)
          ? { label: "Caka na rozhodnutie", tone: "pending" }
          : { label: "Vybavene", tone: "muted" };
      }
      if (type === "delete_request_approved") {
        return { label: "Schvalene", tone: "approved" };
      }
      if (type === "delete_request_rejected") {
        return { label: "Zamietnute", tone: "rejected" };
      }
      if (type === "process_deleted") {
        return { label: "Odstranene", tone: "danger" };
      }
      if (type === "model_pushed_to_org") {
        return { label: "Push do org", tone: "info" };
      }
      return null;
    },
    [isPendingDeleteRequest],
  );

  const getProjectActivityCardClass = useCallback(
    (item) => {
      const type = String(item?.event_type || "").toLowerCase();
      if (type === "delete_requested" && isPendingDeleteRequest(item)) {
        return "project-activity-item--pending";
      }
      if (type === "delete_request_approved") {
        return "project-activity-item--approved";
      }
      if (type === "delete_request_rejected") {
        return "project-activity-item--rejected";
      }
      return "";
    },
    [isPendingDeleteRequest],
  );

  const handleOrgDeleteRequestDecision = async (item, decision) => {
    if (!activeOrgId || !item?.id) return;
    setProjectActivityActionId(`${decision}:${item.id}`);
    setProjectActivityError(null);
    try {
      if (decision === "approve") {
        await approveOrgDeleteRequest(item.id, activeOrgId);
        await refreshOrgTree(activeOrgId);
        setInfo(`Odstranenie procesu "${item.entity_name || "proces"}" bolo schvalene.`);
      } else {
        await rejectOrgDeleteRequest(item.id, activeOrgId);
        setInfo(`Ziadost o odstranenie procesu "${item.entity_name || "proces"}" bola zamietnuta.`);
      }
      await fetchProjectActivity();
    } catch (e) {
      setProjectActivityError(e?.message || "Nepodarilo sa spracovat ziadost.");
    } finally {
      setProjectActivityActionId(null);
    }
  };

  const pendingDeleteRequests = useMemo(
    () => projectActivityItems.filter((item) => isPendingDeleteRequest(item)),
    [projectActivityItems, isPendingDeleteRequest],
  );

  const unreadProjectNotesCount = useMemo(() => notesUnreadIdsRef.current.size, [projectNotes, projectNotesLastSeenAt]);
  const visibleActivityPendingCount = activeOrgCapabilities.canApproveDeleteRequests ? pendingDeleteRequests.length : 0;
  const totalTeamUnreadCount = unreadProjectNotesCount + visibleActivityPendingCount;

  const nonRequestActivityItems = useMemo(
    () =>
      projectActivityItems.filter((item) => {
        const type = String(item?.event_type || "").toLowerCase();
        return !(type === "delete_requested" && isPendingDeleteRequest(item));
      }),
    [projectActivityItems, isPendingDeleteRequest],
  );

  const filteredPendingDeleteRequests = useMemo(() => {
    if (projectActivityFilter === "all" || projectActivityFilter === "requests") {
      return pendingDeleteRequests;
    }
    return [];
  }, [pendingDeleteRequests, projectActivityFilter]);

  useEffect(() => {
    const previousCount = pendingRequestCountRef.current;
    const nextCount = pendingDeleteRequests.length;
    if (
      activeOrgCapabilities.canApproveDeleteRequests &&
      nextCount > previousCount &&
      !railSections.project
    ) {
      setRailSections((prev) => ({ ...prev, project: true }));
    }
    pendingRequestCountRef.current = nextCount;
  }, [activeOrgCapabilities.canApproveDeleteRequests, pendingDeleteRequests.length, railSections.project]);

  const filteredNonRequestActivityItems = useMemo(() => {
    if (projectActivityFilter === "all") {
      return nonRequestActivityItems;
    }
    return nonRequestActivityItems.filter((item) => getProjectActivityCategory(item) === projectActivityFilter);
  }, [getProjectActivityCategory, nonRequestActivityItems, projectActivityFilter]);

  const ensureLaneRightPaddingAfterInsert = (laneElement, anchorElement, modeler, modeling) => {
    if (!laneElement?.id || !modeler || !modeling) return;
    const elementRegistry = modeler.get("elementRegistry");
    if (!elementRegistry) return;

    const lane = elementRegistry.get(laneElement.id);
    if (!lane) return;

    const RIGHT_PADDING = 84;
    const MIN_DELTA = 24;
    const MAX_DELTA = 220;

    const laneX = Number(lane.x || 0);
    const laneW = Number(lane.width || 0);
    const _laneY = Number(lane.y || 0);
    const laneH = Number(lane.height || 0);
    if (!(laneW > 0 && laneH > 0)) return;

    const laneNodes = collectLaneFlowNodes(lane, elementRegistry);
    const laneRightByNodes = laneNodes.reduce((max, el) => {
      const right = Number(el.x || 0) + Number(el.width || 0);
      return Math.max(max, right);
    }, Number(anchorElement?.x || 0) + Number(anchorElement?.width || 0));

    const requiredRight = laneRightByNodes + RIGHT_PADDING;
    const currentRight = laneX + laneW;
    const rawDelta = Math.ceil(requiredRight - currentRight);
    if (rawDelta <= 0) return;
    const delta = Math.max(MIN_DELTA, Math.min(MAX_DELTA, rawDelta));

    const applyResizeWidth = (shape, width) => {
      try {
        if (typeof modeling.resizeShape === "function") {
          modeling.resizeShape(shape, {
            x: Number(shape.x || 0),
            y: Number(shape.y || 0),
            width,
            height: Number(shape.height || 0),
          });
        } else {
          modeling.updateProperties(shape, { width });
        }
      } catch {
        // ignore resize errors
      }
    };

    applyResizeWidth(lane, laneW + delta);

    const refreshedLane = elementRegistry.get(lane.id) || lane;
    const container = refreshedLane.parent || null;
    if (!container) return;

    const siblingLanes = elementRegistry
      .getAll()
      .filter((el) => {
        if (!el || el.id === refreshedLane.id) return false;
        const isLane = String(el?.businessObject?.$type || el?.type || "").includes("Lane");
        return isLane && (el.parent?.id || "") === (container.id || "");
      });
    siblingLanes.forEach((sibling) => {
      const sW = Number(sibling.width || 0);
      const sH = Number(sibling.height || 0);
      if (!(sW > 0 && sH > 0)) return;
      applyResizeWidth(sibling, sW + delta);
    });

    const cW = Number(container.width || 0);
    const cH = Number(container.height || 0);
    if (!(cW > 0 && cH > 0)) return;
    applyResizeWidth(container, cW + delta);
  };

  const isReadOnlyMode = modelSource?.kind === "org" && orgReadOnly;

  const _handleEnableOrgEdit_unused2 = () => {
    if (modelSource?.kind !== "org") return;
    if (!activeOrgCapabilities.canToggleOrgEdit) {
      setInfo("Nemáš právo upravovať org model.");
      return;
    }
    setOrgEditConfirmOpen(true);
  };

  const laneShapeOptions = useMemo(() => LANE_SHAPE_OPTIONS, []);
  const activeLaneShape = useMemo(
    () => laneShapeOptions.find((shape) => shape.id === laneInsertType) || laneShapeOptions[0],
    [laneInsertType, laneShapeOptions],
  );
  const laneInsertName = laneInsertInputs[laneInsertType] || "";
  const _canCreateLaneShape =
    Boolean(selectedLane) &&
    activeLaneShape &&
    (!activeLaneShape.nameRequired || laneInsertName.trim());

  const _updateLaneInsertName = (value) => {
    setLaneInsertInputs((prev) => ({ ...prev, [laneInsertType]: value }));
  };

  const collectLaneFlowNodes = (laneElement, elementRegistry) => {
    if (!laneElement || !elementRegistry) return [];
    const laneBo = laneElement.businessObject;
    const laneRefs = Array.isArray(laneBo?.flowNodeRef) ? laneBo.flowNodeRef : [];
    const laneRefIds = new Set(laneRefs.map((ref) => String(ref?.id || ref)));
    return elementRegistry.getAll().filter((el) => {
      if (!el || el.type === "label") return false;
      const bo = el.businessObject;
      if (!bo?.$instanceOf?.("bpmn:FlowNode")) return false;
      if (laneRefIds.has(String(bo?.id))) return true;
      // Fallback for older diagrams where flow nodes were parented under lane.
      let parent = el.parent;
      while (parent) {
        if (parent.id === laneElement.id) return true;
        parent = parent.parent;
      }
      return false;
    });
  };

  const getProcessParent = (elementRegistry) => {
    if (!elementRegistry) return null;
    const all = elementRegistry.getAll();
    return all.find((el) => Array.isArray(el?.businessObject?.flowElements)) || null;
  };

  const attachNodeToLane = (laneElement, nodeElement, modeling) => {
    if (!laneElement || !nodeElement || !modeling) return;
    const laneBo = laneElement.businessObject;
    const nodeBo = nodeElement.businessObject;
    if (!laneBo || !nodeBo) return;
    const existing = Array.isArray(laneBo.flowNodeRef) ? [...laneBo.flowNodeRef] : [];
    if (!existing.some((ref) => ref?.id === nodeBo.id)) {
      existing.push(nodeBo);
      modeling.updateProperties(laneElement, { flowNodeRef: existing });
    }
  };

  const findLaneForNode = (elementRegistry, nodeElement) => {
    if (!elementRegistry || !nodeElement) return null;
    const nodeBo = nodeElement.businessObject;
    if (!nodeBo) return null;
    const all = elementRegistry.getAll();
    const lanes = all.filter((el) =>
      String(el?.businessObject?.$type || el?.type || "").includes("Lane"),
    );
    return (
      lanes.find((lane) =>
        Array.isArray(lane?.businessObject?.flowNodeRef)
          ? lane.businessObject.flowNodeRef.some((ref) => ref?.id === nodeBo.id)
          : false,
      ) || null
    );
  };

  const getLastCreatedElement = (elementRegistry, engineJson) => {
    const nodes = engineJson?.nodes || [];
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const nodeId = nodes[i]?.id;
      if (!nodeId) continue;
      const element = elementRegistry?.get(nodeId);
      if (element?.businessObject?.$instanceOf?.("bpmn:FlowNode")) {
        return element;
      }
    }
    return null;
  };

  const _computeGlobalRightmost = (elementRegistry) => {
    if (!elementRegistry) return null;
    const allNodes = elementRegistry.getAll().filter((el) => {
      if (!el || el.type === "label") return false;
      const bo = el.businessObject;
      return Boolean(bo?.$instanceOf?.("bpmn:FlowNode"));
    });
    if (!allNodes.length) return null;
    return allNodes.reduce((max, node) => Math.max(max, node.x || 0), 0);
  };

  const computeCrossLaneAnchorX = (laneElement, elementRegistry, currentEngineJson) => {
    if (!laneElement || !elementRegistry) return null;
    const lanes = elementRegistry
      .getAll()
      .filter((el) => String(el?.businessObject?.$type || "").includes("Lane"))
      .sort((a, b) => (a.y || 0) - (b.y || 0));
    const laneIndex = lanes.findIndex((ln) => String(ln?.id || "") === String(laneElement?.id || ""));

    if (laneIndex > 0) {
      for (let idx = laneIndex - 1; idx >= 0; idx -= 1) {
        const previousLane = lanes[idx];
        const previousLaneNodes = collectLaneFlowNodes(previousLane, elementRegistry).sort(
          (a, b) => (a.x || 0) - (b.x || 0),
        );
        const previousLast = previousLaneNodes[previousLaneNodes.length - 1];
        if (typeof previousLast?.x === "number") {
          return Number(previousLast.x || 0) + Number(previousLast.width || 0) / 2;
        }
      }
    }

    const lastCreatedElement = getLastCreatedElement(elementRegistry, currentEngineJson);
    const lastCreatedCenterX =
      typeof lastCreatedElement?.x === "number"
        ? Number(lastCreatedElement.x || 0) + Number(lastCreatedElement.width || 0) / 2
        : null;
    const allFlowNodes = elementRegistry
      .getAll()
      .filter((el) => el && el.type !== "label" && el?.businessObject?.$instanceOf?.("bpmn:FlowNode"));
    const rightmostNode = allFlowNodes.reduce((winner, node) => {
      if (!winner) return node;
      const right = Number(node?.x || 0) + Number(node?.width || 0);
      const winnerRight = Number(winner?.x || 0) + Number(winner?.width || 0);
      return right > winnerRight ? node : winner;
    }, null);
    const rightmostCenterX =
      typeof rightmostNode?.x === "number"
        ? Number(rightmostNode.x || 0) + Number(rightmostNode.width || 0) / 2
        : null;

    if (typeof lastCreatedCenterX === "number" && typeof rightmostCenterX === "number") {
      return Math.max(lastCreatedCenterX, rightmostCenterX);
    }
    if (typeof lastCreatedCenterX === "number") return lastCreatedCenterX;
    if (typeof rightmostCenterX === "number") return rightmostCenterX;
    return null;
  };

  const getLaneCenterMidY = (laneElement) => {
    const y = Number(laneElement?.y || 0);
    const h = Number(laneElement?.height || 0);
    return y + h / 2;
  };
  const computeLaneInsertPosition = (
    laneElement,
    shape,
    mode,
    firstNode,
    lastNode,
    globalRightmost,
  ) => {
    const paddingX = 60;
    const paddingY = 0;
    const laneLeft = laneElement.x + paddingX;
    const laneTop = laneElement.y + paddingY;
    const laneBottom = laneElement.y + laneElement.height - shape.height - paddingY;
    const baselineMidY = getLaneCenterMidY(laneElement);
    const desiredY = baselineMidY - shape.height / 2;
    const y = Math.min(laneBottom, Math.max(laneTop, desiredY));
    let x = laneLeft;

    if (mode === "start" && firstNode) {
      x = firstNode.x - shape.width - 60;
    } else if (lastNode) {
      x = lastNode.x + lastNode.width + 60;
    } else if (typeof globalRightmost === "number") {
      x = globalRightmost;
    }

    x = Math.max(laneLeft, x);
    return { x, y };
  };

  const clearLanePreviewOverlays = () => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const overlays = modeler.get("overlays");
    if (!overlays) return;
    lanePreviewOverlayIdsRef.current.forEach((id) => overlays.remove(id));
    lanePreviewOverlayIdsRef.current = [];
  };

  const _getPreviewShapeSize = (type) => {
    if (type === "xor" || type === "and") {
      return { width: 220, height: 110 };
    }
    return { width: 160, height: 68 };
  };

  const _createPreviewNode = (item, size) => {
    const container = document.createElement("div");
    const isGateway = item.type === "xor" || item.type === "and";
    container.className = `lane-preview-shape lane-preview-shape--${isGateway ? "gateway" : "task"}`;
    container.style.width = `${size.width}px`;
    container.style.height = `${size.height}px`;
    if (isGateway) {
      const diamond = document.createElement("div");
      diamond.className = "lane-preview-shape__diamond";

      const content = document.createElement("div");
      content.className = "lane-preview-shape__content";

      const badge = document.createElement("div");
      badge.className = "lane-preview-shape__badge";
      badge.textContent = item.type === "and" ? "AND" : "XOR";
      content.appendChild(badge);

      const label = document.createElement("div");
      label.className = "lane-preview-shape__label";
      label.textContent = item.text;
      content.appendChild(label);

      diamond.appendChild(content);
      container.appendChild(diamond);

      const branchTop = document.createElement("div");
      branchTop.className = "lane-preview-branch lane-preview-branch--top";
      container.appendChild(branchTop);

      const branchBottom = document.createElement("div");
      branchBottom.className = "lane-preview-branch lane-preview-branch--bottom";
      container.appendChild(branchBottom);
    } else {
      const content = document.createElement("div");
      content.className = "lane-preview-shape__content";
      const label = document.createElement("div");
      label.className = "lane-preview-shape__label";
      label.textContent = item.text;
      content.appendChild(label);
      container.appendChild(content);
    }
    return container;
  };

  const _handleLaneShapeCreate = () => {
    if (!activeLaneShape) return;
    if (!selectedLane) {
      setError("Vyber lane.");
      return;
    }
    if (!modelerRef.current) {
      setError("Modeler nie je pripraveny.");
      return;
    }
    const name = laneInsertName.trim();
    if (activeLaneShape.nameRequired && !name) {
      setError("Dopln nazov.");
      return;
    }

    const modeler = modelerRef.current;
    const elementRegistry = modeler.get("elementRegistry");
    const modeling = modeler.get("modeling");
    const elementFactory = modeler.get("elementFactory");
    const selection = modeler.get("selection");
    const canvas = modeler.get("canvas");
    const laneElement = resolveLaneElement(elementRegistry, selectedLane);
    const processParent = getProcessParent(elementRegistry);

    if (!laneElement || !modeling || !elementFactory || !processParent) {
      setError("Lane sa nepodarilo najst.");
      return;
    }

    const laneNodes = collectLaneFlowNodes(laneElement, elementRegistry);
    const orderedNodes = [...laneNodes].sort((a, b) => (a.x || 0) - (b.x || 0));
    const firstNode = orderedNodes[0];
    const lastNode = orderedNodes[orderedNodes.length - 1];
    const shapeProps = { type: activeLaneShape.bpmnType };
    if (String(activeLaneShape.bpmnType || "").includes("Task")) {
      shapeProps.width = STANDARD_TASK_SIZE.width;
      shapeProps.height = STANDARD_TASK_SIZE.height;
    }
    const shape = elementFactory.createShape(shapeProps);
    const globalRightmost = computeCrossLaneAnchorX(laneElement, elementRegistry, engineJson);
    const position = computeLaneInsertPosition(
      laneElement,
      shape,
      activeLaneShape.id,
      firstNode,
      lastNode,
      globalRightmost,
    );
    const created = modeling.createShape(shape, position, processParent);
    attachNodeToLane(laneElement, created, modeling);

    if (name) {
      modeling.updateProperties(created, { name });
    }

    if (activeLaneShape.id === "start") {
      if (firstNode) {
        modeling.connect(created, firstNode);
      }
    } else if (lastNode) {
      modeling.connect(lastNode, created);
    }

    selection?.select(created);
    if (typeof canvas?.scrollToElement === "function") {
      canvas.scrollToElement(created);
    }

    scheduleRelayoutKick("insert_shape", 150);

    setLaneInsertOpen(false);
    setError(null);
  };


  useEffect(() => {
    if (lanePreviewTimerRef.current) {
      window.clearTimeout(lanePreviewTimerRef.current);
      lanePreviewTimerRef.current = null;
    }

    // Lane typing preview overlay is deprecated; always keep it disabled.
    clearLanePreviewOverlays();
    return undefined;
  }, [laneDescription, selectedLane, engineJson]);

  useEffect(() => () => clearLanePreviewOverlays(), []);

  const handleAppendToLane = async () => {
    if (isLoading || relayouting) return;
    if (isReadOnlyMode) {
      setInfo(
        activeOrgCapabilities.canToggleOrgEdit
          ? "Režim: len na čítanie. Najprv klikni Upraviť."
          : "Tento org model je len na čítanie. Ako pozorovateľ ho nemôžeš upravovať.",
      );
      return;
    }
    if (!selectedLane || !laneDescription.trim()) {
      setError("Vyber lane a doplň aspoň jednu aktivitu.");
      return;
    }
    if (laneSubmitGuardMessage) {
      setError(laneSubmitGuardMessage);
      return;
    }
    const laneLines = splitLines(laneDescription);
    if (isDemoMode && laneLines.length > DEMO_LIMITS.maxStepsPerLane) {
      setError(`DEMO limit: maximálne ${DEMO_LIMITS.maxStepsPerLane} kroky na rolu.`);
      return;
    }
    cancelPendingRelayouts();
    clearLanePreviewOverlays();
    setIsLoading(true);
    setError(null);
    try {
      if (isDemoMode) {
        demoAppendStatsRef.current.attempts += 1;
      }
      const currentEngine = engineJsonRef.current || engineJson;
      if (isDemoMode) {
        const existingDecisions = countExclusiveGateways(currentEngine);
        const typedDecisions = laneLines.filter((line) => detectDecision(line)).length;
        if (existingDecisions + typedDecisions > DEMO_LIMITS.maxDecisions) {
          setError(`DEMO limit: maximálne ${DEMO_LIMITS.maxDecisions} rozhodnutie (XOR) v celom modeli.`);
          setIsLoading(false);
          return;
        }
      }
      if (currentEngine && xml && !undoInProgressRef.current) {
        pushHistorySnapshot(currentEngine, xml);
      }
      const laneIds = new Set((currentEngine?.lanes || []).map((l) => String(l?.id)));
      const laneByName = new Map(
        (currentEngine?.lanes || []).map((l) => [String(l?.name || ""), String(l?.id || "")]),
      );
      let laneId = getSelectedLaneKey(selectedLane);
      if (laneId && !laneIds.has(String(laneId))) {
        const mapped = laneByName.get(String(laneId));
        if (mapped) laneId = mapped;
      }
      if (selectedLane.name && (!laneId || !laneIds.has(String(laneId)))) {
        const mapped = laneByName.get(String(selectedLane.name));
        if (mapped) laneId = mapped;
      }
      const safeEngine = normalizeEngineForBackend(currentEngine);
      if (!String(safeEngine?.name || "").trim()) {
        const fallbackName =
          String(processCard?.generatorInput?.processName || "").trim() ||
          String(safeEngine?.processId || "").trim() ||
          "Proces";
        safeEngine.name = fallbackName;
      }
      if (!String(safeEngine?.processId || "").trim()) {
        safeEngine.processId = `proc_${Date.now()}`;
      }
      const payload = {
        lane_id: laneId,
        lane_name: selectedLane.name,
        description: laneDescription,
        engine_json: safeEngine,
      };
      const response = await appendLaneFromDescription(payload);
      const updatedEngine = response?.engine_json || engineJson;
      if (isDemoMode) {
        const laneObjects = countLaneObjects(updatedEngine, laneId);
        if (laneObjects > DEMO_LIMITS.maxObjectsPerLane) {
          setError(`DEMO limit: maximálne ${DEMO_LIMITS.maxObjectsPerLane} objektov v jednej role.`);
          return;
        }
        const nodesCount = Array.isArray(updatedEngine?.nodes) ? updatedEngine.nodes.length : 0;
        const flowsCount = Array.isArray(updatedEngine?.flows) ? updatedEngine.flows.length : 0;
        const decisionsCount = countExclusiveGateways(updatedEngine);
        if (nodesCount > DEMO_LIMITS.maxNodes) {
          setError(`DEMO limit: maximálne ${DEMO_LIMITS.maxNodes} objektov v modeli.`);
          return;
        }
        if (flowsCount > DEMO_LIMITS.maxFlows) {
          setError(`DEMO limit: maximálne ${DEMO_LIMITS.maxFlows} prepojení.`);
          return;
        }
        if (decisionsCount > DEMO_LIMITS.maxDecisions) {
          setError(`DEMO limit: maximálne ${DEMO_LIMITS.maxDecisions} rozhodnutie (XOR).`);
          return;
        }
      }
      const modeler = modelerRef.current;
      const canPatchCanvas = Boolean(modeler && xml);

      const applyEngineDiffToCanvas = (prevEngine, nextEngine, activeModeler) =>
        applyIncrementalAppend({
          prevEngine,
          nextEngine,
          modeler: activeModeler,
          xml,
          standardTaskSize: STANDARD_TASK_SIZE,
          getLaneCenterMidY,
          attachNodeToLane,
        });

      const mapIncrementalReasonToMessage = (reason) => {
        if (!reason) return "Nepodarilo sa pridať kroky bez prepočtu mapy.";
        if (reason === "missing_process_parent") return "Chýba pool/proces pre vloženie krokov.";
        if (reason === "missing_required_node") return "Niektorý krok v mape chýba (pravdepodobne bol zmazaný).";
        if (reason === "connect_failed" || reason === "connect_exception") return "Prepojenie krokov zablokovali BPMN pravidlá.";
        if (reason === "create_shape_failed" || reason === "create_shape_exception") return "Nepodarilo sa vytvoriť nové kroky v lane.";
        if (reason === "missing_modeler_services") return "Editor mapy nie je pripravený.";
        if (reason === "invalid_input") return "Neplatné dáta pre pridanie krokov.";
        return `Nepodarilo sa pridať kroky (${reason}).`;
      };

      const logDemoFallback = (reason, details = {}) => {
        if (!isDemoMode) return;
        demoAppendStatsRef.current.fallbacks += 1;
        if (reason === "sanity_check_failed") demoAppendStatsRef.current.sanityFails += 1;
        else demoAppendStatsRef.current.incrementalFails += 1;
        const stats = demoAppendStatsRef.current;
        const ratio = stats.attempts
          ? Number(((stats.fallbacks / stats.attempts) * 100).toFixed(1))
          : 0;
        console.warn("[demo:append:fallback]", {
          reason,
          attempts: stats.attempts,
          fallbacks: stats.fallbacks,
          sanityFails: stats.sanityFails,
          incrementalFails: stats.incrementalFails,
          fallbackRatioPct: ratio,
          ...details,
        });
      };

      const runDemoSanityCheck = (activeModeler, nextEngine) => {
        if (!isDemoMode) return { ok: true };
        const elementRegistry = activeModeler?.get?.("elementRegistry");
        if (!elementRegistry || !Array.isArray(nextEngine?.nodes)) {
          return { ok: false, reason: "missing_sanity_context", missingNodeIds: [] };
        }
        const all = elementRegistry.getAll();
        const hasNode = (nodeId) =>
          Boolean(
            elementRegistry.get(String(nodeId)) ||
              all.find((el) => String(el?.businessObject?.$attrs?.["data-engine-id"] || "") === String(nodeId)),
          );
        const missingNodeIds = nextEngine.nodes
          .map((n) => String(n?.id || ""))
          .filter(Boolean)
          .filter((nodeId) => !hasNode(nodeId));
        if (missingNodeIds.length) {
          return { ok: false, reason: "missing_nodes_after_incremental", missingNodeIds };
        }
        return { ok: true };
      };

      const incrementalResult = canPatchCanvas
        ? applyEngineDiffToCanvas(currentEngine, updatedEngine, modeler)
        : { ok: false, reason: "canvas_patch_unavailable", details: { canPatchCanvas } };

      if (incrementalResult?.ok) {
        if (isDemoMode) {
          const sanity = runDemoSanityCheck(modeler, updatedEngine);
          if (!sanity.ok) {
            logDemoFallback("sanity_check_failed", sanity);
            try {
              const fullXml = await renderEngineXml(updatedEngine);
              setEngineJson(updatedEngine);
              setXmlFull(fullXml, "appendLane:demo_sanity_fallback_full_rerender");
              setHasUnsavedChanges(true);
              setLaneDescription("");
              clearLanePreviewOverlays();
              setInfo("Kroky boli pridané (fallback render).");
              setLaneOpen(false);
              bumpModelVersion();
              return;
            } catch (fallbackError) {
              console.error("[append-lane] demo sanity fallback full rerender failed", fallbackError);
              setError("Nepodarilo sa pridať kroky po kontrole mapy.");
              return;
            }
          }
        }
        setEngineJson(updatedEngine);
        setHasUnsavedChanges(true);
        setLaneDescription("");
        clearLanePreviewOverlays();
        setLaneOpen(false);
        if (isDemoMode) {
          const lanes = Array.isArray(updatedEngine?.lanes) ? updatedEngine.lanes : [];
          if (lanes.length > 1) {
            const nextLane = lanes.find(
              (lane) =>
                String(lane?.id || "") !== String(selectedLane?.id || "") &&
                getLaneTasks(updatedEngine, lane?.id).length === 0,
            );
            if (nextLane?.id) {
              setGuideState({
                key: `demo_next_lane:${nextLane.id}`,
                scope: "global",
                title: "Pokračuj na druhú rolu",
                message: `Hotovo ✅ Teraz klikni na rolu „${nextLane.name || nextLane.id}“ a pridaj jej kroky.`,
              });
            } else {
              setGuideState({
                key: "demo_finish_hint",
                scope: "global",
                title: "Demo hotové",
                message: "Model je pripravený. Pre plnú verziu (uloženie, export, organizácie) si vytvor účet.",
              });
            }
          }
        }
        bumpModelVersion();
        setIsLoading(false);
        return;
      }

      console.error("[append-lane] incremental append failed (non-exception)", {
        canPatchCanvas,
        result: incrementalResult,
      });
      if (isDemoMode) {
        logDemoFallback("incremental_failed", {
          incrementalReason: incrementalResult?.reason || null,
        });
      }
      try {
        const fullXml = await renderEngineXml(updatedEngine);
        setEngineJson(updatedEngine);
        setXmlFull(fullXml, "appendLane:fallback_full_rerender");
        setHasUnsavedChanges(true);
        setLaneDescription("");
        clearLanePreviewOverlays();
        setInfo("Kroky boli pridané (fallback render).");
        setLaneOpen(false);
        if (isDemoMode) {
          const lanes = Array.isArray(updatedEngine?.lanes) ? updatedEngine.lanes : [];
          if (lanes.length > 1) {
            const nextLane = lanes.find(
              (lane) =>
                String(lane?.id || "") !== String(selectedLane?.id || "") &&
                getLaneTasks(updatedEngine, lane?.id).length === 0,
            );
            if (nextLane?.id) {
              setGuideState({
                key: `demo_next_lane:${nextLane.id}`,
                scope: "global",
                title: "Pokračuj na druhú rolu",
                message: `Hotovo ✅ Teraz klikni na rolu „${nextLane.name || nextLane.id}“ a pridaj jej kroky.`,
              });
            }
          }
        }
        bumpModelVersion();
        return;
      } catch (fallbackError) {
        console.error("[append-lane] fallback full rerender failed", fallbackError);
        const errorMessage = mapIncrementalReasonToMessage(incrementalResult?.reason);
        setError(errorMessage);
        return;
      }
    } catch (e) {
      console.error("[append-lane] incremental append failed (exception)", e);
      const message = e?.message || "Nepodarilo sa pridať aktivity do lane.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const deriveDefaultName = () => {
    if (processCard.generatorInput.processName?.trim()) return processCard.generatorInput.processName.trim();
    if (engineJson?.name) return engineJson.name;
    if (engineJson?.processName) return engineJson.processName;
    const start = (engineJson?.nodes || []).find((n) => (n.type || "").toLowerCase().includes("start"));
    if (start?.name) return start.name;
    return "Process";
  };

  const handleSaveModel = async () => {
    if (isDemoMode) {
      setInfo("DEMO režim: ukladanie je vypnuté.");
      return;
    }
    if (!engineJson) {
      setError("Nie je čo uložiť – vygeneruj alebo naimportuj diagram.");
      return;
    }
    const canEditOrg = modelSource?.kind !== "org" || activeOrgCapabilities.canEditOrgModels;
    if (modelSource?.kind === "org" && !canEditOrg) {
      setInfo("Nemáš právo upravovať org model.");
      return;
    }
    if (modelSource?.kind === "org" && orgReadOnly) {
      setInfo(
        activeOrgCapabilities.canToggleOrgEdit
          ? "Režim: len na čítanie. Najprv klikni Upraviť."
          : "Tento org model je len na čítanie. Ako pozorovateľ ho nemôžeš upravovať.",
      );
      return;
    }
    setError(null);
    setInfo(null);
    setSaveLoading(true);
    try {
      if (typeof window !== "undefined" && window.__BPMNGEN_DEBUG_LAYOUT_STABILITY) {
        console.log("[layout-stability] save source", { source: "modeler.saveXML" });
        console.log(
          "[layout-stability] before save samples",
          sampleSequenceFlowWaypoints(modelerRef.current),
        );
      }
      const { engine: syncedEngine, diagramXml } = await getSyncedCanvasSnapshot();
      const configuredProcessName = String(processCard?.generatorInput?.processName || "").trim();
      const payload = {
        name:
          configuredProcessName ||
          syncedEngine?.name ||
          syncedEngine?.processName ||
          syncedEngine?.processId ||
          deriveDefaultName(),
        engine_json: syncedEngine,
        diagram_xml: diagramXml,
        generator_input: processCard.generatorInput,
        process_meta: processCard.processMeta,
      };
      let saveResult = null;
      if (modelSource?.kind === "org") {
        const orgId = modelSource?.orgId;
        const treeNodeId = modelSource?.treeNodeId;
        const baseModelId = modelSource?.modelId;
        if (!orgId) {
          throw new Error("Chyba: chyba org kontext.");
        }
        if (treeNodeId && !baseModelId) {
          throw new Error("Chyba: chyba verzia org modelu.");
        }
        if (treeNodeId) {
          payload.tree_node_id = treeNodeId;
          payload.base_model_id = baseModelId;
        }
        const created = await createOrgModelVersion(orgId, payload);
        const newModelId = created?.org_model_id;
        if (!newModelId) {
          throw new Error("Nepodarilo sa vytvorit novu verziu modelu.");
        }
        if (treeNodeId) {
          await updateOrgProcessModelRef(treeNodeId, newModelId, orgId);
          await refreshOrgTree(orgId);
        }
        setOrgVersionPreview(null);
        setPreviewVersionTag("");
        setModelSource((prev) => ({
          ...(prev || {}),
          kind: "org",
          orgId,
          modelId: newModelId,
          treeNodeId: treeNodeId || prev?.treeNodeId,
        }));
        if (routeModelId && String(routeModelId) !== String(newModelId)) {
          lastRouteModelIdRef.current = newModelId;
          navigate(`/model/${newModelId}`);
        }
        saveResult = { ok: true, modelId: newModelId, name: payload.name, source: "org" };
      } else {
        const saved = await saveWizardModel(payload);
        saveResult = { ok: true, modelId: saved?.id || null, name: payload.name, source: "sandbox" };
      }
      setLastSavedAt(Date.now());
      setInfo("Model bol ulozeny.");
      setHasUnsavedChanges(false);
      return saveResult;
    } catch (e) {
      const message =
        e?.status === 409
          ? e?.message || "Proces bol medzicasom zmeneny inym pouzivatelom. Obnov najnovsiu verziu a skus ulozit znova."
          : e?.message || "Nepodarilo sa ulozit model.";
      setError(message);
      return null;
    } finally {
      setSaveLoading(false);
    }
  };

  const _insertLaneTemplate = useCallback((templateType) => {
    const templates = {
      decision: "Ak <podmienka> tak <krok>, inak <krok/koniec>",
      parallel: "Zároveň <krok>, <krok> a <krok>",
    };
    const template = templates[templateType];
    if (!template) return;
    const textarea = laneTextareaRef.current;
    setLaneDescription((prev) => {
      const value = String(prev || "");
      if (!textarea || typeof textarea.selectionStart !== "number") {
        return value ? `${value}\n${template}` : template;
      }
      const start = textarea.selectionStart;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEndIdx = value.indexOf("\n", start);
      const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
      const next = `${value.slice(0, lineStart)}${template}${value.slice(lineEnd)}`;
      window.requestAnimationFrame(() => {
        try {
          textarea.focus();
          const rangeStart = lineStart;
          const rangeEnd = lineStart + template.length;
          textarea.setSelectionRange(rangeStart, rangeEnd);
          if (laneTemplateFlashTimerRef.current) {
            window.clearTimeout(laneTemplateFlashTimerRef.current);
          }
          setLaneTemplateFlash(true);
          laneTemplateFlashTimerRef.current = window.setTimeout(() => {
            try {
              textarea.setSelectionRange(rangeEnd, rangeEnd);
            } catch {
              // ignore selection errors
            }
            setLaneTemplateFlash(false);
            laneTemplateFlashTimerRef.current = null;
          }, 1000);
        } catch {
          // ignore selection errors
        }
      });
      return next;
    });
  }, []);

  const handleXmlImported = useCallback(
    (modeler) => {
      restoreRelayoutContext(modeler);
      bumpModelVersion();
    },
    [restoreRelayoutContext, bumpModelVersion],
  );

  const handleViewerLaneSelect = useCallback(
    (lane) => {
      setSelectedLane(
        lane
          ? {
              ...lane,
              id: String(lane?.engineId || lane?.id || ""),
              engineId: String(lane?.engineId || lane?.id || ""),
              canvasId: String(lane?.canvasId || ""),
            }
          : null,
      );
      if (!lane?.id) return;
      const laneKey = String(lane?.engineId || lane?.id || "");
      setActiveLaneId(laneKey);
      setLastEditedLaneId(laneKey);
      openSingleCard("lane");

      if (!guideEnabled || !guideState) return;
      const key = String(guideState?.key || "");
      const message = String(guideState?.message || "").toLowerCase();
      const isWriteGuide =
        key === "process_empty" ||
        key.startsWith("lane_empty:") ||
        key.startsWith("lane_progress:") ||
        (message.includes("krok") &&
          (message.includes("nap") || message.includes("dop") || message.includes("zosta")));
      if (!isWriteGuide) return;

      applyGuideHighlight(
        {
          token: `lane_click:${laneKey}:${Date.now()}`,
          map: { type: "lane", laneId: laneKey, pulse: true },
          laneInputLaneId: laneKey,
        },
        2200,
      );
    },
    [guideEnabled, guideState, applyGuideHighlight],
  );

  const viewerProps = useMemo(
    () => ({
      title: "Karta procesu - náhľad",
      subtitle: previewName,
      subtitleMeta: previewVersionLabel,
      subtitleTag: previewVersionTag,
      subtitleBadge: modelSource?.kind === "org" ? "Organizácia" : "Pieskovisko",
      subtitleBadgeVariant: modelSource?.kind === "org" ? "org" : "sandbox",
      subtitleProminent: true,
      xml,
      loading: isLoading && !xml,
      error: error || "",
      readOnly: modelSource?.kind === "org" && orgReadOnly,
      onLaneSelect: isReadOnlyMode ? undefined : handleViewerLaneSelect,
      onLaneOrderChange: reorderLanesByNames,
      onDiagramChange: handleDiagramChange,
      onUndo: handleUndo,
      canUndo: historyCount > 0,
      onSave: isDemoMode ? undefined : handleSaveModel,
      onEditStructure: isDemoMode ? undefined : () => openSingleCard("drawer"),
      onMainMenu: handleMainMenu,
      saveDisabled: isDemoMode || saveLoading || isReadOnlyMode,
      saveLabel: isDemoMode ? "Demo režim" : saveLoading ? "Ukladám..." : "Uložiť",
      editStructureDisabled: false,
      onEngineJsonPatch: handleEngineJsonPatch,
      onInsertBlock: insertLaneBlock,
      onXmlImported: handleXmlImported,
      overlayMessage: relayouting ? "Zarovnávam layout…" : "",
      guideHighlight: guideHighlight?.map || null,
      onModelerReady: (modeler) => {
        modelerRef.current = modeler;
      },
    }),
    [
      error,
      handleDiagramChange,
      handleSaveModel,
      handleUndo,
      historyCount,
      isLoading,
      previewName,
      previewVersionLabel,
      previewVersionTag,
      reorderLanesByNames,
      insertLaneBlock,
      saveLoading,
      relayouting,
      guideHighlight,
      handleXmlImported,
      handleViewerLaneSelect,
      xml,
      modelSource,
      orgReadOnly,
      isReadOnlyMode,
      isDemoMode,
      openSingleCard,
    ],
  );

  const applyLoadedModel = (resp, { closeModels = false, source = null, versionTag = "" } = {}) => {
    const loadedEngine = resp?.engine_json;
    const diagram = resp?.diagram_xml;
    if (!loadedEngine || !diagram) {
      throw new Error("Model neobsahuje engine_json alebo diagram_xml.");
    }
    if (engineJson && xml && !undoInProgressRef.current) {
      pushHistorySnapshot(engineJson, xml);
    }
    setEngineJson(loadedEngine);
    setXmlFull(diagram, "applyLoadedModel");
    setSelectedLane(null);
    setLaneDescription("");
    hydrateProcessCard(resp);
    setPreviewVersionTag(versionTag || "");
    setHasUnsavedChanges(false);
    if (source) {
      setModelSource(source);
      setOrgReadOnly(source.kind === "org");
    }
    if (closeModels) {
      setModelsOpen(false);
    }
    setDrawerOpen(false);
  };

  const showMissingDiagram = useCallback((message) => {
    setError(message);
    setInfo(null);
    setEngineJson(null);
    setXmlFull("", "showMissingDiagram");
    setSelectedLane(null);
    setLaneDescription("");
    setProcessCard(createEmptyProcessCardState());
    setModelSource({ kind: "sandbox" });
    setOrgReadOnly(false);
    setHasUnsavedChanges(false);
    setPreviewVersionTag("");
  }, []);

  const isMissingDiagramError = (err) => {
    const message = String(err?.message || "");
    const lower = message.toLowerCase();
    if (err?.status === 404 || lower.includes("http 404") || lower.includes("not found")) return true;
    if (lower.includes("diagram_xml") || lower.includes("engine_json")) return true;
    if (lower.includes("nie je vytvoren") && lower.includes("diagram")) return true;
    return false;
  };

  const doLoadModelById = async (id) => {
    setError(null);
    setLoadLoading(true);
    try {
      const resp = await loadWizardModel(id);
      applyLoadedModel(resp, { source: { kind: "sandbox" } });
      setInfo("Model bol nacitany.");
    } catch (e) {
      const isNotFound =
        e?.status === 404 || (typeof e?.message === "string" && e.message.includes("HTTP 404"));
      if (isNotFound && activeOrgId) {
        try {
          const orgResp = await loadOrgModel(id, activeOrgId);
          applyLoadedModel(orgResp, { source: { kind: "org", orgId: activeOrgId, modelId: id } });
          setOrgVersionPreview(null);
          setPreviewVersionTag("");
          setInfo("Model bol nacitany.");
          return;
        } catch (orgErr) {
          if (isMissingDiagramError(orgErr)) {
            showMissingDiagram("Tento diagram nie je dostupný.");
            return;
          }
          const message = orgErr?.message || "Nepodarilo sa nacitat model.";
          setError(message);
          return;
        }
      }
      if (isMissingDiagramError(e)) {
        showMissingDiagram("Tento diagram nie je dostupný.");
        return;
      }
      const message = e?.message || "Nepodarilo sa nacitat model.";
      setError(message);
    } finally {
      setLoadLoading(false);
    }
  };

  const refreshOrgTree = async (orgId = activeOrgId) => {
    setOrgLoading(true);
    setOrgError(null);
    if (!orgId) {
      setOrgLoading(false);
      setOrgTree(null);
      setOrgError("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    try {
      const tree = await getOrgModel(orgId);
      setOrgTree(tree);
    } catch (e) {
      const status = e?.status;
      if (status === 403) {
        setOrgError("Pouzivatel nema pristup k organizacii. Skus prepnúť organizaciu.");
        void refreshMyOrgs(activeOrgId);
      } else {
        setOrgError(e?.message || "Nepodarilo sa nacitat Model organizacie.");
      }
    } finally {
      setOrgLoading(false);
    }
  };

  const toggleOrgFolder = (folderId) => {
    setExpandedOrgFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const expandAllOrgFolders = () => {
    if (!orgTree) return;
    const next = { root: true };
    const visit = (node) => {
      if (!node) return;
      if (node.type === "folder") {
        next[node.id] = true;
        (node.children || []).forEach(visit);
      }
    };
    visit(orgTree);
    setExpandedOrgFolders((prev) => ({ ...prev, ...next }));
  };

  const collapseAllOrgFolders = () => {
    setExpandedOrgFolders({ root: true });
  };

  const isOrgTreeFullyExpanded = useMemo(() => {
    if (!orgTree) return false;
    const allIds = new Set();
    const visit = (node) => {
      if (!node) return;
      if (node.type === "folder") {
        allIds.add(node.id);
        (node.children || []).forEach(visit);
      }
    };
    visit(orgTree);
    if (!allIds.size) return true;
    return Array.from(allIds).every((id) => expandedOrgFolders[id]);
  }, [orgTree, expandedOrgFolders]);

  const toggleOrgTreeExpand = () => {
    if (isOrgTreeFullyExpanded) {
      collapseAllOrgFolders();
    } else {
      expandAllOrgFolders();
    }
  };

  const handleCreateOrgFolder = async () => {
    if (!activeOrgId) {
      setOrgError("Najprv si vyber alebo vytvor organizáciu.");
      return;
    }
    if (!activeOrgCapabilities.canEditOrgModels) {
      setOrgError("Nemáš právo upravovať model organizácie.");
      return;
    }
    openWizardInputModal(
      {
        kicker: "Model organizácie",
        title: "Vytvoriť priečinok",
        label: "Názov priečinka",
        confirmLabel: "Vytvoriť priečinok",
      },
      async (value) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "Zadaj názov priečinka.";
        try {
          const result = await createOrgFolder({ parentId: selectedOrgFolderId, name: trimmed }, activeOrgId);
          setOrgTree(result?.tree || null);
          setExpandedOrgFolders((prev) => ({ ...prev, [selectedOrgFolderId]: true }));
          setOrgError(null);
          return null;
        } catch (e) {
          const message = e?.message || "Nepodarilo sa vytvoriť priečinok.";
          setOrgError(message);
          return message;
        }
      },
    );
  };

  const handleCreateOrgProcess = async () => {
    if (!activeOrgId) {
      setOrgError("Najprv si vyber alebo vytvor organizáciu.");
      return;
    }
    if (!activeOrgCapabilities.canEditOrgModels) {
      setOrgError("Nemáš právo upravovať model organizácie.");
      return;
    }
    openWizardInputModal(
      {
        kicker: "Model organizácie",
        title: "Vytvoriť proces",
        label: "Názov procesu",
        confirmLabel: "Vytvoriť proces",
      },
      async (value) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "Zadaj názov procesu.";
        try {
          const result = await createOrgProcess({ parentId: selectedOrgFolderId, name: trimmed }, activeOrgId);
          setOrgTree(result?.tree || null);
          setOrgError(null);
          const modelId = result?.node?.processRef?.modelId;
          if (modelId) {
            requestOpenWithSave(() => {
              navigate(`/model/${modelId}`);
            });
          }
          return null;
        } catch (e) {
          const message = e?.message || "Nepodarilo sa vytvoriť proces.";
          setOrgError(message);
          return message;
        }
      },
    );
  };

  const findParentFolderInfo = (rootNode, processNodeId, currentFolder = null) => {
    if (!rootNode) return null;
    if (rootNode.type === "process" && rootNode.id === processNodeId) {
      return currentFolder ? { id: currentFolder.id, name: currentFolder.name } : null;
    }
    const children = rootNode.children || [];
    for (const child of children) {
      const result = findParentFolderInfo(
        child,
        processNodeId,
        rootNode.type === "folder" ? rootNode : currentFolder,
      );
      if (result) return result;
    }
    return null;
  };

  const findProcessPathByModelId = (node, modelId, path = []) => {
    if (!node || !modelId) return null;
    const nextPath = [...path, node];
    if (node.type === "process" && String(node?.processRef?.modelId || "") === String(modelId)) {
      return nextPath;
    }
    const children = node.children || [];
    for (const child of children) {
      const result = findProcessPathByModelId(child, modelId, nextPath);
      if (result) return result;
    }
    return null;
  };

  const findProcessNodeById = (node, nodeId) => {
    if (!node || !nodeId) return null;
    if (node.type === "process" && String(node.id) === String(nodeId)) {
      return node;
    }
    const children = node.children || [];
    for (const child of children) {
      const result = findProcessNodeById(child, nodeId);
      if (result) return result;
    }
    return null;
  };

  const openMoveProcessModal = (node) => {
    if (!node || node.type !== "process") return;
    if (!activeOrgCapabilities.canEditOrgModels) {
      setOrgError("Nemáš právo upravovať model organizácie.");
      return;
    }
    const parentInfo = findParentFolderInfo(orgTree, node.id);
    setOrgMenuNodeId(null);
    setOrgMoveNode(node);
    setOrgMoveCurrentParentId(parentInfo?.id || "root");
    setOrgMoveTargetFolderId(parentInfo?.id || "root");
    setOrgMoveError(null);
    setOrgMoveModalOpen(true);
  };

  const refreshOrgPresence = useCallback(async (orgId = activeOrgId) => {
    if (!orgId) {
      setOrgEditorPresence({});
      return;
    }
    try {
      const response = await getOrgModelPresence(orgId);
      setOrgEditorPresence(response?.items || {});
    } catch {
      // Presence is best-effort UI state; ignore failures and keep last known snapshot.
    }
  }, [activeOrgId]);

  const openDeleteProcessModal = (node) => {
    if (!node || node.type !== "process") return;
    setOrgMenuNodeId(null);
    setOrgDeleteNode(node);
    setOrgDeleteRequestReason("");
    setOrgDeleteError(
      activeOrgCapabilities.canDirectDeleteOrgProcess
        ? null
        : "Ako člen organizácie nemôžeš proces odstrániť priamo. Pošli túto požiadavku vlastníkovi.",
    );
    setOrgDeleteConfirmOpen(true);
    setOrgDeleteFinalConfirmOpen(false);
  };

  const closeDeleteProcessModal = () => {
    if (orgDeleteLoading) return;
    setOrgDeleteConfirmOpen(false);
    setOrgDeleteFinalConfirmOpen(false);
    setOrgDeleteNode(null);
    setOrgDeleteRequestReason("");
    setOrgDeleteError(null);
  };

  const openFinalDeleteConfirmModal = () => {
    if (!activeOrgCapabilities.canDirectDeleteOrgProcess) {
      return;
    }
    setOrgDeleteConfirmOpen(false);
    setOrgDeleteFinalConfirmOpen(true);
  };

  const closeOrgVersionsModal = () => {
    setOrgVersionsOpen(false);
    setOrgVersionsNode(null);
    setOrgVersionsItems([]);
    setOrgVersionsLoading(false);
    setOrgVersionsError(null);
  };

  const openOrgVersionsModal = async (node) => {
    if (!node || node.type !== "process") return;
    if (!activeOrgId) {
      setOrgError("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    setOrgMenuNodeId(null);
    setOrgVersionsNode(node);
    setOrgVersionsItems([]);
    setOrgVersionsError(null);
    setOrgVersionsLoading(true);
    setOrgVersionsOpen(true);
    try {
      const resp = await listOrgModels(activeOrgId);
      const allItems = Array.isArray(resp) ? resp : [];
      const currentModelId = String(node?.processRef?.modelId || "").trim();
      const treeNodeId = String(node?.id || "").trim();
      const treeScopedItems = allItems.filter((item) => String(item?.tree_node_id || "").trim() === treeNodeId);
      const fallbackItems = allItems.filter((item) => String(item?.id || "").trim() === currentModelId);
      const filtered =
        treeScopedItems.length || fallbackItems.length
          ? allItems.filter(
              (item) =>
                String(item?.tree_node_id || "").trim() === treeNodeId ||
                String(item?.id || "").trim() === currentModelId,
            )
          : allItems.filter((item) => {
              const name = String(item?.name || "").trim().toLowerCase();
              const processName = String(node.name || "").trim().toLowerCase();
              return processName ? name === processName : false;
            });
      const sorted = filtered.sort((a, b) => new Date(b?.updated_at || 0) - new Date(a?.updated_at || 0));
      setOrgVersionsItems(sorted);
    } catch (e) {
      setOrgVersionsError(e?.message || "Nepodarilo sa nacitat verzie.");
    } finally {
      setOrgVersionsLoading(false);
    }
  };

  const handleOpenOrgVersion = (modelId, versionLabel = "") => {
    if (!modelId) return;
    const processNode = orgVersionsNode || null;
    const treeNodeId = processNode?.id || null;
    const latestModelId = processNode?.processRef?.modelId || null;
    const isLatestVersion = latestModelId && String(latestModelId) === String(modelId);
    if (treeNodeId) {
      void loadOrgModelFromTree(modelId, treeNodeId, {
        preview: !isLatestVersion,
        previewLabel: isLatestVersion ? "" : versionLabel,
      });
    } else {
      void loadOrgModelDirect(modelId);
    }
    closeOrgVersionsModal();
  };

  const handleRenameOrgProcess = async (node) => {
    if (!node || node.type !== "process") return;
    if (!activeOrgId) {
      setOrgError("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    if (!activeOrgCapabilities.canEditOrgModels) {
      setOrgError("Nemáš právo upravovať model organizácie.");
      return;
    }
    openWizardInputModal(
      {
        kicker: "Model organizácie",
        title: "Premenovať proces",
        label: "Nový názov procesu",
        initialValue: node.name || "",
        confirmLabel: "Uložiť názov",
      },
      async (value) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "Zadaj nový názov procesu.";
        setOrgMenuNodeId(null);
        try {
          const result = await renameOrgNode(node.id, trimmed, activeOrgId);
          setOrgTree(result?.tree || orgTree);
          setOrgError(null);
          return null;
        } catch (e) {
          const message = e?.message || "Nepodarilo sa premenovať proces.";
          setOrgError(message);
          return message;
        }
      },
    );
  };

  const loadOrgModelFromTree = async (modelId, treeNodeId, options = {}) => {
    const { preview = false, previewLabel = "" } = options;
    if (!activeOrgId) {
      setError("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    setError(null);
    setInfo(null);
    setLoadLoading(true);
    try {
      const resp = await loadOrgModel(modelId, activeOrgId);
      applyLoadedModel(resp, {
        source: { kind: "org", orgId: activeOrgId, modelId, treeNodeId },
      });
      if (preview) {
        setOrgVersionPreview({
          isPreview: true,
          modelId,
          treeNodeId: treeNodeId || null,
          label: previewLabel || "",
        });
        if (previewLabel) {
          setPreviewVersionTag(previewLabel);
        }
      } else {
        setOrgVersionPreview(null);
        setPreviewVersionTag("");
      }
      lastRouteModelIdRef.current = modelId;
      navigate(`/model/${modelId}`);
      setInfo("Model bol nacitany.");
    } catch (e) {
      if (isMissingDiagramError(e)) {
        showMissingDiagram("Tento diagram nie je dostupný.");
        return;
      }
      const message = e?.message || "Nepodarilo sa nacitat model.";
      setError(message);
    } finally {
      setLoadLoading(false);
    }
  };

  const openOrgProcessByNodeLatest = async (treeNodeId) => {
    if (!activeOrgId || !treeNodeId) {
      setError("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    let latestTree = orgTree;
    try {
      latestTree = await getOrgModel(activeOrgId);
      setOrgTree(latestTree);
    } catch {
      // Fallback to current FE tree snapshot if refresh fails.
    }
    const processNode = findProcessNodeById(latestTree, treeNodeId);
    const latestModelId = processNode?.processRef?.modelId;
    if (!latestModelId) {
      setError("Nepodarilo sa nájsť aktuálnu verziu procesu.");
      return;
    }
    await loadOrgModelFromTree(latestModelId, treeNodeId, { preview: false });
  };

  const loadOrgModelDirect = async (modelId) => {
    if (!activeOrgId) {
      setError("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    setError(null);
    setInfo(null);
    setLoadLoading(true);
    try {
      const resp = await loadOrgModel(modelId, activeOrgId);
      const treeNodeId =
        String(resp?.tree_node_id || "").trim() ||
        String(findProcessPathByModelId(orgTree, modelId, [])?.slice(-1)?.[0]?.id || "").trim();
      applyLoadedModel(resp, {
        source: { kind: "org", orgId: activeOrgId, modelId, ...(treeNodeId ? { treeNodeId } : {}) },
      });
      setOrgVersionPreview(null);
      setPreviewVersionTag("");
      lastRouteModelIdRef.current = modelId;
      navigate(`/model/${modelId}`);
      setInfo("Model bol nacitany.");
    } catch (e) {
      if (isMissingDiagramError(e)) {
        showMissingDiagram("Tento diagram nie je dostupný.");
        return;
      }
      const message = e?.message || "Nepodarilo sa nacitat model.";
      setError(message);
    } finally {
      setLoadLoading(false);
    }
  };

  const openPushToOrgModal = async (model) => {
    if (!activeOrgId) {
      setInfo("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    setOrgPushModel(model);
    setOrgPushTargetFolderId("root");
    setOrgPushExpandedFolders({ root: true });
    setOrgPushError(null);
    setOrgPushModalOpen(true);
    if (!orgTree) {
      await refreshOrgTree(activeOrgId);
    }
  };

  const closePushModal = () => {
    setOrgPushModalOpen(false);
    setOrgPushModel(null);
    setOrgPushError(null);
    setOrgPushConflictOpen(false);
    setOrgPushConflictMatches([]);
    setOrgPushConflictName("");
    setOrgPushConflictSelectedId(null);
    setOrgPushOverwriteConfirmOpen(false);
  };

  const buildExpandedFoldersMap = (tree) => {
    const next = { root: true };
    const visit = (node) => {
      if (!node) return;
      if (node.type === "folder") {
        next[node.id] = true;
        (node.children || []).forEach(visit);
      }
    };
    visit(tree);
    return next;
  };

  const expandAllOrgPushFolders = () => {
    if (!orgTree) return;
    setOrgPushExpandedFolders(buildExpandedFoldersMap(orgTree));
  };

  const collapseAllOrgPushFolders = () => {
    setOrgPushExpandedFolders({ root: true });
  };

  const isOrgPushTreeFullyExpanded = useMemo(() => {
    if (!orgTree) return false;
    const allIds = new Set();
    const visit = (node) => {
      if (!node) return;
      if (node.type === "folder") {
        allIds.add(node.id);
        (node.children || []).forEach(visit);
      }
    };
    visit(orgTree);
    if (!allIds.size) return true;
    return Array.from(allIds).every((id) => orgPushExpandedFolders[id]);
  }, [orgTree, orgPushExpandedFolders]);

  const toggleOrgPushTreeExpand = () => {
    if (isOrgPushTreeFullyExpanded) {
      collapseAllOrgPushFolders();
    } else {
      expandAllOrgPushFolders();
    }
  };

  const executePushToOrg = async ({ nameOverride = null, overwriteModelId = null, skipConflictCheck = false } = {}) => {
    if (!orgPushModel?.id) return;
    if (!activeOrgId) {
      setOrgPushError("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    const baseName = (nameOverride || orgPushModel?.name || "").trim();
    if (!skipConflictCheck && orgTree && baseName) {
      const matches = findOrgProcessMatchesByName(orgTree, baseName);
      if (matches.length) {
        setOrgPushConflictMatches(matches);
        setOrgPushConflictName(baseName);
        setOrgPushConflictSelectedId(matches[0]?.node?.id || null);
        setOrgPushConflictOpen(true);
        return;
      }
    }
    setPushLoading(orgPushModel.id, true);
    setOrgPushLoading(true);
    setOrgPushError(null);
    try {
      if (overwriteModelId) {
        const sandboxModel = await loadWizardModel(orgPushModel.id);
        const payload = {
          name: (nameOverride || sandboxModel?.name || orgPushModel?.name || orgPushModel.id || "Process").trim(),
          engine_json: sandboxModel?.engine_json || {},
          diagram_xml: sandboxModel?.diagram_xml || "",
          generator_input: sandboxModel?.generator_input,
          process_meta: sandboxModel?.process_meta,
        };
        await saveOrgModel(overwriteModelId, activeOrgId, payload);
        await refreshOrgTree(activeOrgId);
        setInfo("Proces v organizácii bol prepísaný.");
      } else {
        const pushResp = await pushSandboxModelToOrg(orgPushModel.id, nameOverride || orgPushModel?.name, activeOrgId);
        const orgModelId = pushResp?.org_model_id;
        if (!orgModelId) {
          throw new Error("Org model ID nebol vrateny.");
        }
        const treeResp = await createOrgProcessFromOrgModel(
          {
            parentId: orgPushTargetFolderId,
            modelId: orgModelId,
            name: (nameOverride || orgPushModel?.name || "Process").trim(),
          },
          activeOrgId,
        );
        setOrgTree(treeResp?.tree || orgTree);
        setExpandedOrgFolders((prev) => ({ ...prev, root: true, [orgPushTargetFolderId]: true }));
        setInfo("Model bol ulozeny do organizacie.");
      }
      await fetchModels();
      setOrgPushModalOpen(false);
      setOrgPushModel(null);
      setOrgPushConflictOpen(false);
      setOrgPushConflictMatches([]);
      setOrgPushConflictName("");
      setOrgPushConflictSelectedId(null);
      setOrgPushOverwriteConfirmOpen(false);
    } catch (e) {
      if (e?.status === 403) {
        setInfo("Nemas organizaciu alebo nemas pristup.");
      } else if (e?.status === 401) {
        setInfo("Nie si prihlaseny.");
      } else {
        setOrgPushError(e?.message || "Nepodarilo sa ulozit model do organizacie.");
      }
    } finally {
      setOrgPushLoading(false);
      if (orgPushModel?.id) {
        window.setTimeout(() => setPushLoading(orgPushModel.id, false), 400);
      }
    }
  };

  const handleConfirmPushToOrg = async () => {
    await executePushToOrg();
  };

  const handleConflictRename = async () => {
    openWizardInputModal(
      {
        kicker: "Organizácia",
        title: "Premenovať názov procesu",
        label: "Nový názov procesu",
        initialValue: orgPushConflictName || orgPushModel?.name || "",
        confirmLabel: "Použiť nový názov",
      },
      async (value) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "Zadaj nový názov procesu.";
        setOrgPushConflictOpen(false);
        setOrgPushConflictMatches([]);
        setOrgPushConflictName("");
        setOrgPushConflictSelectedId(null);
        await executePushToOrg({ nameOverride: trimmed, skipConflictCheck: false });
        return null;
      },
    );
  };

  const handleConflictOverwrite = async () => {
    if (!orgPushConflictSelectedId) {
      setOrgPushError("Najprv vyber proces na prepisanie.");
      return;
    }
    setOrgPushOverwriteConfirmOpen(true);
  };

  const handleConflictProceed = async () => {
    setOrgPushConflictOpen(false);
    setOrgPushConflictMatches([]);
    setOrgPushConflictName("");
    setOrgPushConflictSelectedId(null);
    setOrgPushOverwriteConfirmOpen(false);
    await executePushToOrg({ skipConflictCheck: true });
  };

  const handleConflictCloseModal = () => {
    setOrgPushConflictOpen(false);
    setOrgPushConflictMatches([]);
    setOrgPushConflictName("");
    setOrgPushConflictSelectedId(null);
    setOrgPushOverwriteConfirmOpen(false);
  };

  const handleConfirmOverwrite = async () => {
    const match = orgPushConflictMatches.find((m) => m?.node?.id === orgPushConflictSelectedId);
    if (!match) {
      setOrgPushError("Nenasiel sa existujuci proces na prepisanie.");
      setOrgPushOverwriteConfirmOpen(false);
      return;
    }
    setOrgPushOverwriteConfirmOpen(false);
    setOrgPushConflictOpen(false);
    setOrgPushConflictMatches([]);
    setOrgPushConflictName("");
    setOrgPushConflictSelectedId(null);
    await executePushToOrg({ overwriteModelId: match.node.processRef.modelId, skipConflictCheck: true });
  };

  const handleCancelOverwrite = () => {
    setOrgPushOverwriteConfirmOpen(false);
  };

  const handleConfirmMoveProcess = async () => {
    if (!orgMoveNode?.id || !orgMoveTargetFolderId) return;
    if (!activeOrgId) {
      setOrgMoveError("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    setOrgMoveLoading(true);
    setOrgMoveError(null);
    try {
      const response = await moveOrgNode(
        {
          nodeId: orgMoveNode.id,
          targetParentId: orgMoveTargetFolderId,
        },
        activeOrgId,
      );
      setOrgTree(response?.tree || null);
      setExpandedOrgFolders((prev) => ({ ...prev, root: true, [orgMoveTargetFolderId]: true }));
      const targetInfo = findParentFolderInfo(response?.tree || orgTree, orgMoveNode.id);
      setOrgMoveHighlightFolderId(orgMoveTargetFolderId);
      window.setTimeout(() => setOrgMoveHighlightFolderId(null), 700);
      setOrgToast(`✅ Presunute do ${targetInfo?.name || "priecinka"}`);
      if (orgToastTimerRef.current) {
        window.clearTimeout(orgToastTimerRef.current);
      }
      orgToastTimerRef.current = window.setTimeout(() => {
        setOrgToast("");
        orgToastTimerRef.current = null;
      }, 2000);
      setOrgMoveModalOpen(false);
      setOrgMoveNode(null);
    } catch (e) {
      setOrgMoveError(e?.message || "Nepodarilo sa presunut proces.");
    } finally {
      setOrgMoveLoading(false);
    }
  };

  const handleConfirmDeleteProcess = async () => {
    if (!orgDeleteNode?.id) return;
    if (!activeOrgId) {
      setOrgDeleteError("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    setOrgDeleteLoading(true);
    setOrgDeleteError(null);
    try {
      if (activeOrgCapabilities.canDirectDeleteOrgProcess) {
        const response = await deleteOrgNode(orgDeleteNode.id, activeOrgId);
        if (response?.tree) {
          setOrgTree(response.tree);
        } else {
          await refreshOrgTree(activeOrgId);
        }
        setInfo("Proces bol odstránený.");
      } else {
        await requestOrgProcessDelete(orgDeleteNode.id, activeOrgId, orgDeleteRequestReason);
        setInfo("Žiadosť o odstránenie procesu bola odoslaná vlastníkovi.");
      }
      setOrgDeleteConfirmOpen(false);
      setOrgDeleteFinalConfirmOpen(false);
      setOrgDeleteNode(null);
    } catch (e) {
      setOrgDeleteError(e?.message || "Nepodarilo sa odstranit proces.");
    } finally {
      setOrgDeleteLoading(false);
    }
  };

  const renderOrgFolderPickerNode = (node, depth = 0, options = {}) => {
    if (!node || node.type !== "folder") return null;
    const mode = options.mode || "move";
    const expanded =
      mode === "push"
        ? Boolean((options.expandedMap || {})[node.id] ?? node.id === "root")
        : Boolean(expandedOrgFolders[node.id] ?? node.id === "root");
    const selectedId = mode === "push" ? options.selectedId : orgMoveTargetFolderId;
    const setSelectedId = mode === "push" ? options.setSelectedId : setOrgMoveTargetFolderId;
    const toggleExpanded =
      mode === "push"
        ? options.toggleExpanded
        : (id) => setExpandedOrgFolders((prev) => ({ ...prev, [id]: !prev[id] }));
    const prefixDepth = Math.max(depth, 0);
    const processCount = orgProcessCountMap.get(node.id) || 0;
    return (
      <div
        key={`picker-${node.id}`}
        className="org-tree-entry"
        data-depth={depth}
        style={{ "--org-depth": depth }}
      >
        <div
          className="org-tree-row"
          role="button"
          tabIndex={0}
          onClick={() => {
            setSelectedId(node.id);
            toggleExpanded(node.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setSelectedId(node.id);
              toggleExpanded(node.id);
            }
          }}
        >
          <div className="org-tree-prefix" aria-hidden>
            {Array.from({ length: prefixDepth }).map((_, idx) => (
              <span key={`${node.id}-pp-${idx}`} className="org-tree-prefix-col">
                <span className="org-tree-prefix-vert" />
              </span>
            ))}
            {prefixDepth > 0 ? <span className="org-tree-prefix-connector" /> : null}
          </div>
          <div className={`org-tree-node org-tree-node--folder ${selectedId === node.id ? "is-selected" : ""}`}>
            <span className="org-tree-level-slot">
              <span className={`org-tree-level ${depth >= 1 ? `org-tree-level--l${depth}` : ""}`} aria-hidden>
                {depth === 0 ? "ROOT" : `L${depth}`}
              </span>
            </span>
            <span className="org-tree-label">{node.name}</span>
            {processCount > 0 ? <span className="org-tree-badge">{processCount}</span> : null}
          </div>
          <button
            type="button"
            className="org-tree-chev-btn"
            aria-label={expanded ? "Zbaliť" : "Rozbaliť"}
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(node.id);
            }}
          >
            <span className={`org-tree-icon org-tree-icon--chev ${expanded ? "is-open" : ""}`} aria-hidden>
              {expanded ? "v" : ">"}
            </span>
          </button>
        </div>
        {expanded
          ? (node.children || [])
              .filter((child) => child?.type === "folder")
              .map((child) => renderOrgFolderPickerNode(child, depth + 1, options))
          : null}
      </div>
    );
  };

  const renderOrgTreeNode = (node, depth = 0) => {
    if (!node) return null;
    if (node.type === "folder") {
      const expanded = Boolean(expandedOrgFolders[node.id] ?? node.id === "root");
      const isActivePath = activeOrgFolderIds.has(node.id);
      const processCount = orgProcessCountMap.get(node.id) || 0;
      const prefixDepth = Math.max(depth, 0);
      const rawChildren = Array.isArray(node.children) ? node.children.filter(Boolean) : [];
      const directProcesses = rawChildren.filter((child) => child?.type === "process");
      const directFolders = rawChildren.filter((child) => child?.type === "folder");
      const orderedChildren = [...directProcesses, ...directFolders];
      return (
        <div key={node.id} className="org-tree-entry" data-depth={depth} style={{ "--org-depth": depth }}>
          <div
            className="org-tree-row"
            data-folder-id={node.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              setSelectedOrgFolderId(node.id);
              toggleOrgFolder(node.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelectedOrgFolderId(node.id);
                toggleOrgFolder(node.id);
              }
            }}
          >
            <div className="org-tree-prefix" aria-hidden>
              {Array.from({ length: prefixDepth }).map((_, idx) => (
                <span key={`${node.id}-p-${idx}`} className="org-tree-prefix-col">
                  <span className="org-tree-prefix-vert" />
                </span>
              ))}
              {prefixDepth > 0 ? <span className="org-tree-prefix-connector" /> : null}
            </div>
            <div
              className={`org-tree-node org-tree-node--folder ${
                selectedOrgFolderId === node.id ? "is-selected" : ""
              } ${isActivePath ? "is-path" : ""} ${orgMoveHighlightFolderId === node.id ? "is-move-highlight" : ""}`}
            >
              <span className="org-tree-level-slot">
                <span
                className={`org-tree-level ${depth >= 1 ? `org-tree-level--l${depth}` : ""}`}
                title={
                  depth === 1
                    ? "L1 – Najvyššia procesná úroveň (doména / divízia)"
                    : depth === 2
                      ? "L2 – Procesná oblasť"
                      : depth === 3
                        ? "L3 – Podprocesná skupina"
                        : depth === 4
                          ? "L4 – Konkrétny proces (BPMN model)"
                          : undefined
                }
                aria-hidden
              >
                {depth === 0 ? "ROOT" : `L${depth}`}
                </span>
              </span>
              <span className={`org-tree-label ${isActivePath ? "is-path" : ""}`}>{node.name}</span>
              {processCount > 0 ? <span className="org-tree-badge">{processCount}</span> : null}
            </div>
            <button
              type="button"
              className="org-tree-chev-btn"
              aria-label={expanded ? "Zbaliť" : "Rozbaliť"}
              onClick={(e) => {
                e.stopPropagation();
                toggleOrgFolder(node.id);
              }}
            >
              <span className={`org-tree-icon org-tree-icon--chev ${expanded ? "is-open" : ""}`} aria-hidden>
                {expanded ? "v" : ">"}
              </span>
            </button>
          </div>
          <div className={`org-tree-children ${expanded ? "is-open" : ""}`}>
            {orderedChildren.map((child) => renderOrgTreeNode(child, depth + 1))}
          </div>
        </div>
      );
    }
    const modelId = node?.processRef?.modelId;
    const isActive = modelId && routeModelId && String(modelId) === String(routeModelId);
    const pulse = isActive && orgPulseTargetId === node.id;
    const status = getProcessStatus(modelId);
    const prefixDepth = Math.max(depth, 0);
    const isMenuOpen = orgMenuNodeId === node.id;
    const editors = Array.isArray(orgEditorPresence?.[node.id]) ? orgEditorPresence[node.id] : [];
    const selfEmail = String(currentUser?.email || "").trim().toLowerCase();
    const selfEditors = editors.filter((item) => String(item?.email || "").trim().toLowerCase() === selfEmail);
    const otherEditors = editors.filter((item) => String(item?.email || "").trim().toLowerCase() !== selfEmail);
    const isEditedBySelf = selfEditors.length > 0;
    const isEditedByOthers = otherEditors.length > 0;
    const processPresenceTitle = isEditedByOthers
      ? `Práve upravuje: ${otherEditors.map((item) => item.email).join(", ")}`
      : isEditedBySelf
        ? "Tento proces práve upravuješ."
        : "";
    return (
      <div
        key={node.id}
        className={`org-tree-entry org-tree-entry--process org-tree-process-row ${pulse ? "is-pulse" : ""} ${
          isMenuOpen ? "is-menu-open" : ""
        }`}
        data-depth={depth}
        data-process-id={node.id}
        data-active={isActive ? "true" : "false"}
        style={{ "--org-depth": prefixDepth }}
        onMouseLeave={() => {
          setOrgMenuNodeId((prev) => (prev === node.id ? null : prev));
          setOrgMenuAnchor(null);
        }}
      >
        <button
          type="button"
          className={`org-tree-node org-tree-node--process ${isActive ? "is-active" : ""}`}
          onClick={() => {
            setOpenOrgProcessConfirmNode({ id: node.id, name: node.name || "Proces" });
          }}
        >
          <div className="org-tree-prefix" aria-hidden>
            {Array.from({ length: prefixDepth }).map((_, idx) => (
              <span key={`${node.id}-pp-${idx}`} className="org-tree-prefix-col">
                <span className="org-tree-prefix-vert" />
              </span>
            ))}
            {prefixDepth > 0 ? <span className="org-tree-prefix-connector" /> : null}
          </div>
          <span className="org-tree-process-slot" aria-hidden>
            <span
              className={`org-tree-process-dot ${getProcessStatusClass(status)}`}
              title={getProcessStatusLabel(status)}
              aria-hidden
            />
            <span className="org-tree-process-badge">P</span>
          </span>
          <span
            className={`org-tree-label ${isActive ? "is-path" : ""} ${
              isEditedBySelf ? "is-editing-self" : isEditedByOthers ? "is-editing-other" : ""
            }`}
            title={processPresenceTitle || undefined}
          >
            {node.name}
          </span>
        </button>
        <button
          type="button"
          className="org-tree-menu-btn"
          aria-label="Menu procesu"
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setOrgMenuAnchor({ x: rect.left, y: rect.top });
            setOrgMenuNodeId((prev) => (prev === node.id ? null : node.id));
          }}
        >
          ...
        </button>
        {isMenuOpen ? (
          <div
            className="org-tree-menu"
            style={{
              position: "fixed",
              left: Math.max(12, (orgMenuAnchor?.x || 0) - 170),
              top: Math.max(12, (orgMenuAnchor?.y || 0) - 6),
              zIndex: 1000,
            }}
          >
            <button
              type="button"
              className="org-tree-menu__item"
              onClick={() => handleRenameOrgProcess(node)}
              disabled={!activeOrgCapabilities.canEditOrgModels}
            >
              Premenovat
            </button>
            <button type="button" className="org-tree-menu__item" onClick={() => void openOrgVersionsModal(node)}>
              Verzie
            </button>
            <button
              type="button"
              className="org-tree-menu__item"
              onClick={() => openMoveProcessModal(node)}
              disabled={!activeOrgCapabilities.canEditOrgModels}
            >
              Presunut do...
            </button>
            <div className="org-tree-menu__divider" />
            <button
              type="button"
              className="org-tree-menu__item org-tree-menu__item--danger"
              onClick={() => openDeleteProcessModal(node)}
            >
              Odstranit proces
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  useEffect(() => {
    if (isDemoMode) return;
    if (!routeModelId) return;
    if (lastRouteModelIdRef.current === routeModelId) return;
    lastRouteModelIdRef.current = routeModelId;
    void doLoadModelById(routeModelId);
  }, [routeModelId, isDemoMode]);

  useEffect(() => {
    if (isDemoMode) return;
    if (!orgOpen) return;
    void refreshOrgTree(activeOrgId);
    void refreshOrgPresence(activeOrgId);
  }, [orgOpen, activeOrgId, isDemoMode, refreshOrgPresence]);

  useEffect(() => {
    if (isDemoMode) return undefined;
    if (!orgOpen || !activeOrgId) return undefined;
    void refreshOrgPresence(activeOrgId);
    const intervalId = window.setInterval(() => {
      void refreshOrgPresence(activeOrgId);
    }, 25000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeOrgId, isDemoMode, orgOpen, refreshOrgPresence]);

  useEffect(() => {
    if (isDemoMode) return undefined;
    if (modelSource?.kind !== "org") return undefined;
    if (orgReadOnly) return undefined;
    const orgId = modelSource?.orgId;
    const treeNodeId = modelSource?.treeNodeId;
    if (!orgId || !treeNodeId) return undefined;

    let isClosed = false;
    const sendHeartbeat = async (active = true) => {
      try {
        await heartbeatOrgModelPresence(treeNodeId, orgId, active);
        if (active && !isClosed) {
          void refreshOrgPresence(orgId);
        }
      } catch {
        // ignore best-effort presence failures
      }
    };

    void sendHeartbeat(true);
    const intervalId = window.setInterval(() => {
      void sendHeartbeat(true);
    }, 25000);

    return () => {
      isClosed = true;
      window.clearInterval(intervalId);
      void sendHeartbeat(false);
    };
  }, [isDemoMode, modelSource, orgReadOnly, refreshOrgPresence]);

  const activeOrgPath = useMemo(() => {
    if (!orgTree || !routeModelId) return null;
    return findProcessPathByModelId(orgTree, routeModelId, []);
  }, [orgTree, routeModelId]);

  const activeOrgFolderIds = useMemo(() => {
    if (!activeOrgPath?.length) return new Set();
    const ids = new Set();
    activeOrgPath.forEach((node) => {
      if (node.type === "folder") {
        ids.add(node.id);
      }
    });
    return ids;
  }, [activeOrgPath]);

  const orgProcessCountMap = useMemo(() => {
    if (!orgTree) return new Map();
    const map = new Map();
    const countProcesses = (node) => {
      if (!node) return 0;
      if (node.type === "process") return 1;
      const children = node.children || [];
      let total = 0;
      children.forEach((child) => {
        total += countProcesses(child);
      });
      map.set(node.id, total);
      return total;
    };
    countProcesses(orgTree);
    return map;
  }, [orgTree]);

  useEffect(() => {
    if (!routeModelId) return;
    const status = processCard?.processMeta?.status || "Approved";
    setProcessStatusByModelId((prev) => {
      const next = new Map(prev);
      next.set(String(routeModelId), status);
      return next;
    });
  }, [routeModelId, processCard?.processMeta?.status]);

  const getProcessStatus = (modelId) =>
    processStatusByModelId.get(String(modelId)) || "Approved";

  const getProcessStatusClass = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "draft") return "org-tree-process-dot--draft";
    if (normalized === "review") return "org-tree-process-dot--review";
    if (normalized === "deprecated") return "org-tree-process-dot--deprecated";
    return "org-tree-process-dot--approved";
  };

  const getProcessStatusLabel = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "draft") return "Koncept";
    if (normalized === "review") return "Na posúdenie";
    if (normalized === "approved") return "Schválený";
    if (normalized === "deprecated") return "Zastaraný";
    return status || "";
  };

  const filteredOrgTree = useMemo(() => {
    if (!orgTree) return null;
    const query = orgSearchQuery.trim().toLowerCase();
    if (!query) return orgTree;
    const filterNode = (node) => {
      if (!node) return null;
      if (node.type === "process") {
        const name = String(node.name || "").toLowerCase();
        return name.includes(query) ? { ...node } : null;
      }
      if (node.type === "folder") {
        const children = (node.children || []).map(filterNode).filter(Boolean);
        if (children.length) {
          return { ...node, children };
        }
      }
      return null;
    };
    return filterNode(orgTree) || orgTree;
  }, [orgTree, orgSearchQuery]);

  const filteredOrgExpandedMap = useMemo(() => {
    if (!filteredOrgTree) return {};
    const map = {};
    const visit = (node) => {
      if (!node) return;
      if (node.type === "folder") {
        map[node.id] = true;
        (node.children || []).forEach(visit);
      }
    };
    visit(filteredOrgTree);
    return map;
  }, [filteredOrgTree]);

  useEffect(() => {
    if (!orgOpen || !orgTree || !routeModelId) return;
    const path = activeOrgPath;
    if (!path?.length) return;
    setExpandedOrgFolders((prev) => {
      const next = { ...prev, root: true };
      path.forEach((node) => {
        if (node.type === "folder") {
          next[node.id] = true;
        }
      });
      return next;
    });
    const lastFolder = [...path].reverse().find((node) => node.type === "folder");
    if (lastFolder) {
      setSelectedOrgFolderId(lastFolder.id);
    }
  }, [orgOpen, orgTree, routeModelId, activeOrgPath]);

  useEffect(() => {
    if (!orgOpen || !orgTreeRef.current || !orgTree) return;
    const container = orgTreeRef.current;
    const activeProcess = container.querySelector('.org-tree-process-row[data-active="true"]');
    const activeFolder =
      activeOrgPath?.length
        ? container.querySelector(
            `.org-tree-row[data-folder-id="${activeOrgPath[activeOrgPath.length - 2]?.id || ""}"]`,
          )
        : null;
    const scrollTarget = activeProcess || activeFolder;
    if (scrollTarget) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = scrollTarget.getBoundingClientRect();
      const offsetTop = targetRect.top - containerRect.top;
      const desired =
        container.scrollTop + offsetTop - container.clientHeight / 2 + targetRect.height / 2;
      if (typeof container.scrollTo === "function") {
        container.scrollTo({ top: desired, behavior: "smooth" });
      } else {
        container.scrollTop = desired;
      }
    }

    if (activeProcess) {
      const id = activeProcess.getAttribute("data-process-id");
      if (id) {
        setOrgPulseTargetId(id);
        window.setTimeout(() => {
          setOrgPulseTargetId(null);
        }, 650);
      }
    }
  }, [orgOpen, orgTree, activeOrgPath]);

  useEffect(() => {
    const query = orgSearchQuery.trim();
    if (!query) return;
    setExpandedOrgFolders((prev) => ({ ...prev, root: true, ...filteredOrgExpandedMap }));
  }, [orgSearchQuery, filteredOrgExpandedMap]);

  const orgBreadcrumbItems = useMemo(() => {
    if (!orgTree) return [];
    const path = activeOrgPath && activeOrgPath.length ? activeOrgPath : [orgTree];
    return path.map((node) => ({
      id: node.id,
      name: node.name || "Model organizacie",
      type: node.type,
      modelId: node?.processRef?.modelId,
    }));
  }, [orgTree, activeOrgPath]);

  const handleOrgBreadcrumbClick = (item) => {
    if (!item) return;
    if (item.type === "folder") {
      setSelectedOrgFolderId(item.id);
      setExpandedOrgFolders((prev) => ({ ...prev, [item.id]: true, root: true }));
    } else if (item.type === "process" && item.id) {
      requestOpenWithSave(() => {
        void openOrgProcessByNodeLatest(item.id);
      });
    }
  };

  useEffect(
    () => () => {
      if (orgToastTimerRef.current) {
        window.clearTimeout(orgToastTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedLane) {
      openSingleCard("lane");
    } else {
      setLaneOpen(false);
    }
  }, [selectedLane]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    window.__FLOWMATE_REQUEST_SAVE__ = () => {
      if (!hasUnsavedChanges) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        pendingOpenResolveRef.current = resolve;
        pendingOpenCancelRef.current = () => resolve(false);
        pendingOpenActionRef.current = null;
        setSavePromptOpen(true);
      });
    };
    return () => {
      if (window.__FLOWMATE_REQUEST_SAVE__) {
        delete window.__FLOWMATE_REQUEST_SAVE__;
      }
    };
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (isDemoMode) return;
    void refreshMyOrgs(activeOrgId);
  }, [isDemoMode]);

  const fetchModels = async () => {
    if (isDemoMode) {
      setModels([]);
      setModelsError("DEMO režim: uložené modely sú vypnuté.");
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const resp = await listWizardModels({ limit: 50, offset: 0, search: modelsSearch });
      setModels(resp?.items || []);
    } catch (e) {
      const message = e?.message || "Nepodarilo sa nacitat modely.";
      setModelsError(message);
    } finally {
      setModelsLoading(false);
    }
  };

  const toggleModelGroup = (key) => {
    setExpandedModelGroups((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const openModels = async () => {
    if (isDemoMode) {
      setInfo("DEMO režim: uložené modely sú vypnuté.");
      return;
    }
    setModelsOpen(true);
    setMyOrgsEmpty(null);
    await refreshMyOrgs(activeOrgId);
    await fetchModels();
  };

  const requestOpenWithSave = (action) => {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    pendingOpenActionRef.current = action;
    setSavePromptOpen(true);
  };

  const handleSaveAndOpen = async () => {
    if (isDemoMode) {
      setSavePromptOpen(false);
      handleOpenWithoutSave();
      return;
    }
    setSavePromptOpen(false);
    await handleSaveModel();
    setInfo("Model bol ulozeny.");
    setHasUnsavedChanges(false);
    const resolve = pendingOpenResolveRef.current;
    pendingOpenResolveRef.current = null;
    pendingOpenCancelRef.current = null;
    if (resolve) {
      resolve(true);
    }
    const action = pendingOpenActionRef.current;
    pendingOpenActionRef.current = null;
    if (action) {
      window.setTimeout(() => {
        action();
      }, 1000);
    }
  };

  const handleOpenWithoutSave = () => {
    const resolve = pendingOpenResolveRef.current;
    pendingOpenResolveRef.current = null;
    pendingOpenCancelRef.current = null;
    if (resolve) {
      resolve(true);
    }
    const action = pendingOpenActionRef.current;
    pendingOpenActionRef.current = null;
    setSavePromptOpen(false);
    if (action) {
      action();
    }
  };

  const handleCancelOpen = () => {
    const cancel = pendingOpenCancelRef.current;
    pendingOpenResolveRef.current = null;
    pendingOpenCancelRef.current = null;
    if (cancel) {
      cancel();
    }
    pendingOpenActionRef.current = null;
    setSavePromptOpen(false);
  };

  const openWizardInputModal = useCallback((config, onSubmit) => {
    wizardInputSubmitRef.current = typeof onSubmit === "function" ? onSubmit : null;
    setWizardInputModal({
      kicker: config?.kicker || "",
      title: config?.title || "Zadaj hodnotu",
      label: config?.label || "Názov",
      confirmLabel: config?.confirmLabel || "Uložiť",
      placeholder: config?.placeholder || "",
      warning: config?.warning || "",
    });
    setWizardInputValue(config?.initialValue || "");
    setWizardInputError("");
  }, []);

  const closeWizardInputModal = useCallback(() => {
    setWizardInputModal(null);
    setWizardInputValue("");
    setWizardInputError("");
    wizardInputSubmitRef.current = null;
  }, []);

  const submitWizardInputModal = useCallback(async () => {
    const submit = wizardInputSubmitRef.current;
    if (typeof submit !== "function") {
      closeWizardInputModal();
      return;
    }
    const result = await submit(wizardInputValue);
    if (typeof result === "string" && result.trim()) {
      setWizardInputError(result);
      return;
    }
    closeWizardInputModal();
  }, [closeWizardInputModal, wizardInputValue]);

  const openWizardConfirmModal = useCallback((config, onConfirm) => {
    wizardConfirmActionRef.current = typeof onConfirm === "function" ? onConfirm : null;
    setWizardConfirmModal({
      kicker: config?.kicker || "",
      title: config?.title || "Potvrdiť akciu?",
      message: config?.message || "",
      confirmLabel: config?.confirmLabel || "Potvrdiť",
      cancelLabel: config?.cancelLabel || "Zrušiť",
      warning: Boolean(config?.warning),
    });
  }, []);

  const closeWizardConfirmModal = useCallback(() => {
    setWizardConfirmModal(null);
    wizardConfirmActionRef.current = null;
  }, []);

  const submitWizardConfirmModal = useCallback(async () => {
    const action = wizardConfirmActionRef.current;
    closeWizardConfirmModal();
    if (typeof action === "function") {
      await action();
    }
  }, [closeWizardConfirmModal]);

  const handleDeleteModel = async (id, name) => {
    openWizardConfirmModal(
      {
        kicker: "Pieskovisko",
        title: "Zmazať model?",
        message: `Naozaj chceš zmazať model ${name || id}?`,
        confirmLabel: "Áno, zmazať",
        cancelLabel: "Ponechať model",
        warning: true,
      },
      async () => {
        setModelsError(null);
        setInfo(null);
        setModelsActionLoading(true);
        try {
          await deleteWizardModel(id);
          await fetchModels();
          setInfo("Model bol zmazaný.");
        } catch (e) {
          const message = e?.message || "Nepodarilo sa zmazať model.";
          setModelsError(message);
        } finally {
          setModelsActionLoading(false);
        }
      },
    );
  };

  const handleRenameModel = async (id, currentName) => {
    openWizardInputModal(
      {
        kicker: "Pieskovisko",
        title: "Premenovať model",
        label: "Nový názov modelu",
        initialValue: currentName || "",
        confirmLabel: "Uložiť názov",
      },
      async (value) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "Zadaj názov modelu.";
        setModelsError(null);
        setInfo(null);
        setModelsActionLoading(true);
        try {
          await renameWizardModel(id, trimmed);
          await fetchModels();
          setInfo("Model bol premenovaný.");
          return null;
        } catch (e) {
          const message = e?.message || "Nepodarilo sa premenovať model.";
          setModelsError(message);
          return message;
        } finally {
          setModelsActionLoading(false);
        }
      },
    );
  };

  const setPushLoading = (id, isLoading) => {
    setPushModelLoadingIds((prev) => {
      const next = new Set(prev);
      if (isLoading) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handlePushModelToOrg = async (model) => {
    const id = model?.id;
    if (!id) return;
    if (!activeOrgId) {
      setInfo("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    setModelsError(null);
    setInfo(null);
    await openPushToOrgModal(model);
  };

  const doLoadModelFromList = async (id, versionTag = "") => {
    setError(null);
    setInfo(null);
    try {
      const resp = await loadWizardModel(id);
      const fallbackTag = resp?.process_meta?.version ? String(resp.process_meta.version) : "";
      applyLoadedModel(resp, { closeModels: true, source: { kind: "sandbox" }, versionTag: versionTag || fallbackTag });
      setInfo("Model bol nacitany.");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa nacitat model.";
      setError(message);
    }
  };

  const loadModelFromList = async (id, versionTag = "") => {
    requestOpenWithSave(() => {
      void doLoadModelFromList(id, versionTag);
    });
  };

  const applyActiveOrgFromList = (orgs, preferredId) => {
    if (!orgs || orgs.length === 0) {
      setActiveOrgId(null);
      setActiveOrgName("");
      setActiveOrgRole("");
      setMyOrgsEmpty(true);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("ACTIVE_ORG_ID");
        window.localStorage.removeItem("ACTIVE_ORG_NAME");
        window.dispatchEvent(new Event("active-org-changed"));
      }
      return;
    }
    const preferred = preferredId ? orgs.find((o) => String(o.id) === String(preferredId)) : null;
    const active = preferred || orgs[0];
    setActiveOrgId(active?.id || null);
    setActiveOrgName(active?.name || "");
    setActiveOrgRole(active?.role || "");
    setMyOrgsEmpty(false);
    if (active?.id && typeof window !== "undefined") {
      window.localStorage.setItem("ACTIVE_ORG_ID", active.id);
      window.localStorage.setItem("ACTIVE_ORG_NAME", active?.name || "");
      window.dispatchEvent(new Event("active-org-changed"));
    }
  };

  const refreshMyOrgs = async (preferredId = activeOrgId) => {
    if (isDemoMode) {
      setMyOrgs([]);
      setMyOrgsEmpty(null);
      return;
    }
    try {
      const orgs = await listMyOrgs();
      setMyOrgs(orgs || []);
      applyActiveOrgFromList(orgs || [], preferredId);
    } catch (_e) {
      setMyOrgs([]);
      setMyOrgsEmpty(null);
    }
  };

  useEffect(() => {
    const previousOrgId = previousActiveOrgIdRef.current;
    const nextOrgId = activeOrgId || null;
    previousActiveOrgIdRef.current = nextOrgId;
    if (!previousOrgId || String(previousOrgId) === String(nextOrgId || "")) {
      return;
    }
    setSelectedOrgFolderId("root");
    setExpandedOrgFolders({ root: true });
    setOrgMenuNodeId(null);
    setOrgMenuAnchor(null);
    setOrgVersionsOpen(false);
    setOrgVersionsNode(null);
    setOrgVersionsItems([]);
    setOrgVersionsError(null);
    setOrgVersionPreview(null);
    setOrgMoveModalOpen(false);
    setOrgMoveNode(null);
    setOrgMoveTargetFolderId("root");
    setOrgMoveCurrentParentId("root");
    setOrgMoveError(null);
    setOrgDeleteConfirmOpen(false);
    setOrgDeleteFinalConfirmOpen(false);
    setOrgDeleteNode(null);
    setOrgDeleteRequestReason("");
    setOrgDeleteError(null);
    setOrgPushModalOpen(false);
    setOrgPushModel(null);
    setOrgPushTargetFolderId("root");
    setOrgPushError(null);
    setOrgPushConflictOpen(false);
    setOrgPushConflictMatches([]);
    setOrgPushConflictName("");
    setOrgPushConflictSelectedId(null);
    setOrgPushOverwriteConfirmOpen(false);
    setOrgSearchQuery("");
  }, [activeOrgId]);

  const openOrgsModal = () => {
    if (isDemoMode) {
      setInfo("DEMO režim: organizácie sú vypnuté.");
      return;
    }
    navigate("/organization");
  };

  const handleEnableOrgEdit = () => {
    if (modelSource?.kind !== "org") return;
    if (!activeOrgCapabilities.canToggleOrgEdit) {
      setInfo("Nemáš právo upravovať org model.");
      return;
    }
    setOrgEditConfirmOpen(true);
  };

  const handleConfirmEnableOrgEdit = () => {
    setOrgEditConfirmOpen(false);
    setOrgReadOnly(false);
    setInfo("Režim: editácia.");
  };

  const handleCancelEnableOrgEdit = () => {
    setOrgEditConfirmOpen(false);
  };

  const handleExportBpmn = async () => {
    if (isDemoMode) {
      setInfo("DEMO režim: export BPMN je vypnutý.");
      return;
    }
    if (!engineJson) {
      setError("Najprv vygeneruj alebo naimportuj diagram.");
      return;
    }
    setError(null);
    setInfo(null);
    setExportLoading(true);
    try {
      const { engine: syncedEngine, diagramXml } = await getSyncedCanvasSnapshot();
      const name = syncedEngine?.name || syncedEngine?.processName || syncedEngine?.processId || "process";
      await saveWizardModel({
        name,
        engine_json: syncedEngine,
        diagram_xml: diagramXml,
        generator_input: processCard.generatorInput,
        process_meta: processCard.processMeta,
      });
      setLastExportedAt(Date.now());

      const safeName = (name || "process").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
      const filename = `${safeName || "process"}.bpmn`;
      const blob = new Blob([diagramXml], { type: "application/bpmn+xml" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setInfo("Model bol nacitany.");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa exportovať BPMN.";
      setError(message);
    } finally {
      setExportLoading(false);
    }
  };

  const handleImportClick = () => {
    if (isDemoMode) {
      setInfo("DEMO režim: import BPMN je vypnutý.");
      return;
    }
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncActiveOrgFromStorage = () => {
      const nextId = window.localStorage.getItem("ACTIVE_ORG_ID");
      const nextName = window.localStorage.getItem("ACTIVE_ORG_NAME") || "";
      setActiveOrgId(nextId || null);
      setActiveOrgName(nextName);
      if (!nextId) {
        setActiveOrgRole("");
        return;
      }
      const matched = myOrgs.find((org) => String(org.id) === String(nextId));
      if (matched) {
        setActiveOrgRole(matched.role || "");
      }
    };
    syncActiveOrgFromStorage();
    window.addEventListener("active-org-changed", syncActiveOrgFromStorage);
    window.addEventListener("storage", syncActiveOrgFromStorage);
    return () => {
      window.removeEventListener("active-org-changed", syncActiveOrgFromStorage);
      window.removeEventListener("storage", syncActiveOrgFromStorage);
    };
  }, [myOrgs]);

  const handleImportChange = async (event) => {
    if (isDemoMode) {
      if (event.target) {
        event.target.value = "";
      }
      setInfo("DEMO režim: import BPMN je vypnutý.");
      return;
    }
    const file = event.target?.files?.[0];
    if (!file) return;
    setError(null);
    setInfo(null);
    setImportLoading(true);
    try {
      if (engineJson && xml && !undoInProgressRef.current) {
        pushHistorySnapshot(engineJson, xml);
      }
      const response = await importBpmn(file);
      const importedEngine = response?.engine_json || response;
      setEngineJson(importedEngine);
      const newXml = await renderEngineXml(importedEngine);
      setXmlFull(newXml, "importBpmn");
      setSelectedLane(null);
      setLaneDescription("");
      setInfo("BPMN model bol importovaný do Karty procesu.");
      setHasUnsavedChanges(true);
    } catch (e) {
      const message = e?.message || "Nepodarilo sa importovať BPMN.";
      setError(message);
    } finally {
      setImportLoading(false);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const generatorInput = processCard.generatorInput;
  const processMeta = processCard.processMeta;
  const selectedLaneIndex = selectedLane ? findLaneIndex(selectedLane, engineJson?.lanes || []) : -1;
  const laneRoleDisplayName = useMemo(
    () => String(selectedLane?.name || selectedLane?.id || "Rola").trim() || "Rola",
    [selectedLane],
  );
  const laneSubtitle = useMemo(
    () => (selectedLaneIndex >= 0 ? `Rola / Lane ${selectedLaneIndex + 1}` : "Rola / Lane"),
    [selectedLaneIndex],
  );
  const laneHasWarnings = useMemo(
    () => laneHelperItems.some((item) => Boolean(item.warning)) || hasAnglePlaceholderToken(laneDescription),
    [laneDescription, laneHelperItems],
  );
  const laneSubmitGuardMessage = useMemo(() => {
    const firstBlockingWarning = laneHelperItems.find((item) => Boolean(item.warning));
    if (firstBlockingWarning?.warning) {
      return `Riadok ${firstBlockingWarning.lineNumber}: ${firstBlockingWarning.warning}`;
    }
    if (hasAnglePlaceholderToken(laneDescription)) {
      return "V texte máš placeholder ako <podmienka>. Nahraď ho reálnym pomenovaním skôr, než pridáš kroky do mapy.";
    }
    return "";
  }, [laneDescription, laneHelperItems]);
  const laneWarningCount = useMemo(
    () => laneHelperItems.filter((item) => Boolean(item.warning)).length + (hasAnglePlaceholderToken(laneDescription) ? 1 : 0),
    [laneDescription, laneHelperItems],
  );
  const lanePlaceholderWarning = useMemo(() => {
    if (!hasAnglePlaceholderToken(laneDescription)) return "";
    return "Vyzerá to ako vzor. Nezabudni nahradiť <podmienka> / <krok> vlastným textom.";
  }, [laneDescription]);
  const showLaneHelpTip = laneWarningCount > 0 && !helpOpen && !laneHelpTipDismissed;
  const laneControlStatus = useMemo(() => {
    if (!laneDescription.trim()) return "idle";
    if (laneHasWarnings) return "warning";
    return "ok";
  }, [laneDescription, laneHasWarnings]);
  const laneApplyButtonLabel = useMemo(() => {
    const roleName = String(selectedLane?.name || selectedLane?.id || "").trim();
    if (!roleName) return "Vytvoriť aktivity pre túto rolu";
    const compactName = roleName.length > 28 ? `${roleName.slice(0, 28)}...` : roleName;
    return `Vytvoriť aktivity pre: ${compactName}`;
  }, [selectedLane]);
  useEffect(() => {
    if (!laneWarningCount) {
      setLaneHelpTipDismissed(false);
    }
  }, [laneWarningCount]);
  useEffect(() => {
    if (helpOpen && laneWarningCount > 0) {
      setLaneHelpTipDismissed(true);
    }
  }, [helpOpen, laneWarningCount]);
  useEffect(() => {
    if (!helpOpen || !helpIntent?.type) return;
    const targetSection = mapHelpIntentTypeToSection(helpIntent.type);
    setActiveHelpSection(targetSection);
    setHelpAccordionOpen((prev) => ({ ...prev, [targetSection]: true }));
    setHelpHighlightSection(targetSection);
    const clearTimer = window.setTimeout(() => {
      setHelpHighlightSection((current) => (current === targetSection ? "" : current));
    }, 1800);
    window.requestAnimationFrame(() => {
      const sectionEl = helpSectionRefs.current[targetSection];
      if (sectionEl?.scrollIntoView) {
        sectionEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      const inputEl = helpFirstInputRefs.current[targetSection];
      if (inputEl?.focus) {
        inputEl.focus();
      }
    });
    return () => {
      window.clearTimeout(clearTimer);
    };
  }, [helpIntent, helpOpen]);
  const modelGroups = useMemo(() => {
    const groups = new Map();
    models.forEach((model) => {
      const label = (model.name || "").trim() || model.id;
      const key = label;
      const group = groups.get(key) || { key, label, items: [] };
      group.items.push(model);
      groups.set(key, group);
    });
    return Array.from(groups.values())
      .map((group) => {
        const items = [...group.items].sort(
          (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0),
        );
        return { ...group, items, latest: items[0] };
      })
      .sort((a, b) => new Date(b.latest?.updated_at || 0) - new Date(a.latest?.updated_at || 0));
  }, [models]);

  const orgVersionRows = useMemo(() => {
    const total = orgVersionsItems.length;
    return orgVersionsItems.map((item, index) => ({
      ...item,
      versionLabel: `#${Math.max(total - index, 1)}`,
    }));
  }, [orgVersionsItems]);
  const guideWorkspaceActive =
    Boolean(engineJson) || drawerOpen || laneOpen || helpOpen || storyOpen || mentorOpen;
  const showGuideBanners =
    modelSource?.kind !== "org" && guideEnabled && guideWorkspaceActive && guideState?.message;
  const showHomeGuideBanner =
    modelSource?.kind !== "org" && guideEnabled && !guideWorkspaceActive && !xml;
  const homeGuideMessage =
    HOME_GUIDE_MESSAGES[homeGuideMessageIndex % HOME_GUIDE_MESSAGES.length] || HOME_GUIDE_MESSAGES[0];

  return (
    <div className="process-card-layout" ref={layoutRef}>
      <div className="process-card-rail">
        {isDemoMode ? (
          <div className="process-card-rail-group is-open">
            <button type="button" className="process-card-rail-header" onClick={() => setDemoSetupOpen(true)}>
              <span>DEMO</span>
            </button>
            <div className="process-card-rail-content">
              <button type="button" className="process-card-toggle" onClick={() => setDemoSetupOpen(true)}>
                Demo info
              </button>
              <button type="button" className="process-card-toggle process-card-toggle--new-model" onClick={resetDemoState}>
                Reset demo
              </button>
              <a className="process-card-toggle" href="/register">
                Create account
              </a>
            </div>
          </div>
        ) : (
          <>
        <div className={`process-card-rail-group ${railSections.process ? "is-open" : ""}`}>
          <button type="button" className="process-card-rail-header" onClick={() => toggleRailSection("process")}>
            <span>Tvorba</span>
          </button>
          {railSections.process ? (
            <div className="process-card-rail-content">
              <button
                type="button"
                className={`process-card-toggle ${orgOpen ? "is-active" : ""}`}
                style={
                  orgOpen
                    ? {
                        backgroundColor: "#1b3a6b",
                        color: "#fff",
                        borderColor: "#2f5ca0",
                        boxShadow: "0 0 0 1px rgba(47,92,160,0.6)",
                      }
                    : undefined
                }
                onClick={() => toggleSingleCard("org")}
              >
                {orgOpen ? "Skryť model organizacie" : "Model organizacie"}
              </button>
              <button
                type="button"
                className={`process-card-toggle ${drawerOpen ? "is-active" : ""}`}
                style={
                  drawerOpen
                    ? {
                        backgroundColor: "#1b3a6b",
                        color: "#fff",
                        borderColor: "#2f5ca0",
                        boxShadow: "0 0 0 1px rgba(47,92,160,0.6)",
                      }
                    : undefined
                }
                onClick={() => toggleSingleCard("drawer")}
              >
                {drawerOpen ? "Skryť kartu procesu" : "Karta procesu"}
              </button>

              <button
                type="button"
                className={`process-card-toggle process-card-toggle--story ${storyOpen ? "is-active" : ""}`}
                style={
                  storyOpen
                    ? {
                        backgroundColor: "#1b3a6b",
                        color: "#fff",
                        borderColor: "#2f5ca0",
                        boxShadow: "0 0 0 1px rgba(47,92,160,0.6)",
                      }
                    : undefined
                }
                onClick={() => toggleSingleCard("story")}
              >
                {storyOpen ? "Skryť príbeh" : "Príbeh procesu"}
              </button>
              <button
                type="button"
                className="process-card-toggle process-card-toggle--new-model"
                onClick={handleNewModel}
              >
                Nový model
              </button>
            </div>
          ) : null}
        </div>

        <div className={`process-card-rail-group ${railSections.save ? "is-open" : ""}`}>
          <button type="button" className="process-card-rail-header" onClick={() => toggleRailSection("save")}>
            <span>Modely</span>
          </button>
          {railSections.save ? (
            <div className="process-card-rail-content">
              <button
                type="button"
                className="process-card-toggle process-card-toggle--models"
                onClick={openModels}
              >
                Uložené modely
              </button>
              <button
                type="button"
                className="process-card-toggle process-card-toggle--save"
                onClick={handleSaveModel}
                disabled={saveLoading}
              >
                {saveLoading ? "Ukladám..." : "Uložiť model"}
              </button>
              <div className="process-card-rail-hover">
                <button type="button" className="process-card-toggle process-card-toggle--io">
                  Export / Import BPMN
                </button>
                <div className="process-card-rail-popover">
                  <button className="btn" type="button" onClick={handleExportBpmn} disabled={exportLoading}>
                    {exportLoading ? "Exportujem..." : "Export BPMN"}
                  </button>
                  <button className="btn" type="button" onClick={handleImportClick} disabled={importLoading}>
                    {importLoading ? "Importujem..." : "Import BPMN"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className={`process-card-rail-group process-card-rail-group--team ${railSections.project ? "is-open" : ""}`}>
          <button type="button" className="process-card-rail-header" onClick={() => toggleRailSection("project")}>
            <span>Tím</span>
            {totalTeamUnreadCount > 0 ? (
              <span
                className="process-card-rail-header__badge"
                aria-label={`${totalTeamUnreadCount} noviniek v time`}
              >
                {totalTeamUnreadCount}
              </span>
            ) : null}
          </button>
          {railSections.project ? (
            <div className="process-card-rail-content process-card-rail-content--team">
              <button
                type="button"
                className={`process-card-toggle process-card-toggle--notes process-card-toggle--team-notes ${notesOpen ? "is-active" : ""} ${notesBadgePulse ? "is-pulse" : ""}`}
                onClick={() => setNotesOpen(true)}
              >
                Poznámky
                {unreadProjectNotesCount > 0 ? (
                  <span className="process-card-toggle__badge" aria-label={`${unreadProjectNotesCount} novych poznamok`}>
                    {unreadProjectNotesCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className={`process-card-toggle process-card-toggle--notes process-card-toggle--team-activity ${activityOpen ? "is-active" : ""} ${activityBadgePulse ? "is-pulse" : ""}`}
                onClick={() => setActivityOpen(true)}
              >
                Aktivita
                {visibleActivityPendingCount > 0 ? (
                  <span className="process-card-toggle__badge" aria-label={`${visibleActivityPendingCount} cakajucich poziadaviek`}>
                    {visibleActivityPendingCount}
                  </span>
                ) : null}
              </button>
              <button type="button" className="process-card-toggle process-card-toggle--team" onClick={openOrgsModal}>
                Sprava organizacie
              </button>
            </div>
          ) : null}
        </div>
          </>
        )}

      </div>

      {drawerOpen || helpOpen || mentorOpen || storyOpen || orgOpen || laneOpen ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            width: "auto",
            maxWidth: "none",
            minWidth: 0,
            flex: "0 0 auto",
            overflow: "auto",
            paddingRight: 0,
          }}
        >
          {drawerOpen ? (
            <div
              className={`process-card-drawer process-card-process ${drawerOpen ? "is-open" : ""} ${isReadOnlyMode ? "is-readonly" : ""}`}
              style={{
                height: !helpOpen && !mentorOpen ? "100%" : processPanelHeight,
                minHeight: 320,
                overflow: "auto",
              }}
            >
              <div className="process-card-header">
                <div>
                  <div className="process-card-label process-card-label-row">
                    <span>Karta procesu</span>
                    <span className={`process-card-badge ${modelSource?.kind === "org" ? "is-org" : "is-sandbox"}`}>
                      {modelSource?.kind === "org" ? "Organizácia" : "Pieskovisko"}
                    </span>
                  </div>
                  <div className="process-card-description">
                    {hasGeneratedModel
                      ? "Upravuješ základnú kostru existujúceho procesu a jeho hlavné údaje."
                      : "Krátko opíš proces, roly a čo ho spúšťa. Z toho vytvoríme mapu."}
                  </div>
                </div>
                <button
                  type="button"
                  className="process-card-close"
                  aria-label="Zavrieť kartu procesu"
                  onClick={() => setDrawerOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="process-card-body process-card-process__body">
                <div className="wizard-lane-v2__card process-card-process__card">
                {hasGeneratedModel ? (
                  <div className="process-card-edit-banner">
                    <div className="process-card-edit-banner__eyebrow">Editácia kostry procesu</div>
                    <div className="process-card-edit-banner__title">
                      Tento model už existuje. Teraz upravuješ jeho základnú kostru, nie vytváraš nový model.
                    </div>
                  </div>
                ) : null}
                <section className="process-card-section process-card-process__section">
                  <div className="process-card-section__title">
                    <h2>{hasGeneratedModel ? "Kostra procesu" : "Začnime základom"}</h2>
                    <span className="process-card-pill">{hasGeneratedModel ? "Živý model" : "Základ"}</span>
                  </div>
                  <div className="process-card-description process-card-description--panel">
                    {hasGeneratedModel
                      ? "Model už existuje. Táto karta teraz spravuje základnú kostru procesu a zobrazuje údaje priamo z mapy."
                      : "Krátko opíš proces, roly a čo ho spúšťa. Z toho vytvoríme kostru mapy."}
                  </div>
                  {!hasGeneratedModel ? (
                    <div className="process-card-process__template-row">
                      {PROCESS_TEMPLATES.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          className="btn btn--small process-card-process__template-btn"
                          onClick={() => applyProcessTemplate(template)}
                          disabled={isReadOnlyMode}
                        >
                          Vzor: {template.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <label
                    className={`wizard-field ${
                      guideHighlight?.processCardField === "processName" ? "guide-highlight-input" : ""
                    }`}
                  >
                    <span>{hasGeneratedModel ? "Názov procesu v modeli" : "Ako sa proces volá?"}</span>
                    <input
                      value={generatorInput.processName}
                      onChange={(e) =>
                        hasGeneratedModel
                          ? handleStructuredProcessNameChange(e.target.value)
                          : updateGeneratorInput("processName", e.target.value)
                      }
                      placeholder="Napr. Schválenie žiadosti"
                      disabled={isReadOnlyMode}
                    />
                  </label>
                  {!hasGeneratedModel ? (
                    <label
                      className={`wizard-field ${
                        guideHighlight?.processCardField === "roles" ? "guide-highlight-input" : ""
                      }`}
                    >
                      <span>Kto v ňom vystupuje? (každú rolu na nový riadok)</span>
                      <textarea
                        value={generatorInput.roles}
                        onChange={(e) => updateGeneratorInput("roles", e.target.value)}
                        rows={4}
                        placeholder={"Každú rolu napíš na nový riadok"}
                        disabled={isReadOnlyMode}
                      />
                    </label>
                  ) : (
                    <div className="wizard-field wizard-field--full">
                      <span>Roly v modeli</span>
                      <div className="process-card-role-list">
                        {liveRoleItems.map((lane, index) => (
                          <label key={lane.id} className="process-card-role-item">
                            <span className="process-card-role-item__label">Rola {index + 1}</span>
                            <input
                              value={lane.name}
                              onChange={(e) => handleStructuredLaneRename(lane.id, e.target.value)}
                              placeholder={`Rola ${index + 1}`}
                              disabled={isReadOnlyMode}
                            />
                          </label>
                        ))}
                      </div>
                      <div className="process-card-inline-note">
                        Nové roly budeme dopĺňať ako samostatnú funkciu. Zatiaľ tu vieš upraviť názvy rolí, ktoré už v modeli existujú.
                      </div>
                    </div>
                  )}
                  <label
                    className={`wizard-field ${
                      guideHighlight?.processCardField === "trigger" ? "guide-highlight-input" : ""
                    }`}
                  >
                    <span>{hasGeneratedModel ? "Začiatok procesu v modeli" : "Čo proces spúšťa?"}</span>
                    <input
                      value={generatorInput.trigger}
                      onChange={(e) =>
                        hasGeneratedModel
                          ? handleStructuredNodeFieldChange("trigger", primaryStartOption?.id, e.target.value)
                          : updateGeneratorInput("trigger", e.target.value)
                      }
                      placeholder="Napr. Nová žiadosť od klienta"
                      disabled={isReadOnlyMode || (hasGeneratedModel && !primaryStartOption)}
                    />
                    {hasGeneratedModel && startOptions.length > 1 ? (
                      <div className="process-card-inline-note">
                        Upravuješ prvý štart v modeli. Spolu sú v mape {startOptions.length} štarty.
                      </div>
                    ) : null}
                  </label>
                  <label
                    className={`wizard-field ${
                      guideHighlight?.processCardField === "output" ? "guide-highlight-input" : ""
                    }`}
                  >
                    <span>{hasGeneratedModel ? "Koniec procesu v modeli" : "Čo má byť na konci?"}</span>
                    <textarea
                      value={generatorInput.output}
                      onChange={(e) =>
                        hasGeneratedModel
                          ? handleStructuredNodeFieldChange("output", primaryEndOption?.id, e.target.value)
                          : updateGeneratorInput("output", e.target.value)
                      }
                      rows={2}
                      placeholder="Aký je výsledok procesu?"
                      disabled={isReadOnlyMode}
                    />
                    {hasGeneratedModel && !primaryEndOption ? (
                      <div className="process-card-inline-note">
                        V modeli zatiaľ nemáš koncový prvok. Text si vieš pripraviť už teraz a keď koniec doplníš, budeš ho vedieť prepojiť aj s mapou.
                      </div>
                    ) : null}
                    {hasGeneratedModel && endOptions.length > 1 ? (
                      <div className="process-card-inline-note">
                        Upravuješ prvý koniec v modeli. Spolu sú v mape {endOptions.length} konce.
                      </div>
                    ) : null}
                  </label>
                  <div className="process-card-grid">
                    <label className="wizard-field">
                      <span>Status</span>
                      <select
                        value={processMeta.status}
                        onChange={(e) => updateProcessMeta("status", e.target.value)}
                        disabled={isReadOnlyMode}
                      >
                        <option value="Draft">Koncept</option>
                        <option value="Review">Na posúdenie</option>
                        <option value="Approved">Schválený</option>
                        <option value="Deprecated">Zastaraný</option>
                      </select>
                    </label>
                    <label className="wizard-field">
                      <span>Verzia</span>
                      <input
                        value={processMeta.version}
                        onChange={(e) => updateProcessMeta("version", e.target.value)}
                        disabled={isReadOnlyMode}
                      />
                    </label>
                  </div>
                  <div className="process-card-buttons">
                      <button
                        className={`btn ${hasGeneratedModel ? "btn--warning" : "btn-primary"}`}
                        type="button"
                        onClick={handleGenerate}
                        disabled={isLoading || isReadOnlyMode}
                      >
                        {isLoading ? "Vytváram..." : hasGeneratedModel ? "Vytvoriť model znova" : "Vytvoriť model"}
                      </button>
                  </div>
                </section>
                <section className="process-card-section process-card-process__section">
                  <div className="process-card-section__title">
                    <h2>Meta udaje o procese</h2>
                    <span className="process-card-pill process-card-pill--muted">Opis</span>
                  </div>
                  <div className="process-card-grid">
                    <label className="wizard-field">
                      <span>Vlastnik procesu</span>
                      <input
                        value={processMeta.owner}
                        onChange={(e) => updateProcessMeta("owner", e.target.value)}
                        disabled={isReadOnlyMode}
                      />
                    </label>
                    <label className="wizard-field">
                      <span>Oddelenie</span>
                      <input
                        value={processMeta.department}
                        onChange={(e) => updateProcessMeta("department", e.target.value)}
                        disabled={isReadOnlyMode}
                      />
                    </label>
                    <label className="wizard-field wizard-field--full">
                      <span>Popis procesu</span>
                      <textarea
                        value={processMeta.description}
                        onChange={(e) => updateProcessMeta("description", e.target.value)}
                        rows={4}
                        disabled={isReadOnlyMode}
                      />
                    </label>
                  </div>
                </section>

                {error ? <div className="wizard-error">{error}</div> : null}
                {info ? <div className="wizard-toast">{info}</div> : null}
                {modelSource?.kind === "org" ? (
                  <div className="wizard-toast" style={{ background: "rgba(15,23,42,0.6)" }}>
                    Režim: {orgReadOnly ? "Len na čítanie" : "Editácia"} (Organizácia)
                    {orgReadOnly ? (
                      <button
                        className="btn btn--small"
                        style={{ marginLeft: 8 }}
                        type="button"
                        onClick={handleEnableOrgEdit}
                      >
                        Upraviť
                      </button>
                    ) : null}
                  </div>
                ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {drawerOpen && helpOpen ? (
            <div
              style={{
                height: 9,
                cursor: "row-resize",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: isResizingPanels
                  ? "linear-gradient(90deg, rgba(47,92,160,0.5), rgba(47,92,160,0.35))"
                  : "linear-gradient(90deg, rgba(47,92,160,0.28), rgba(47,92,160,0.18))",
                transition: "background 120ms ease",
                borderTop: "1px solid rgba(255,255,255,0.08)",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                boxShadow: isResizingPanels ? "0 0 0 1px rgba(47,92,160,0.4) inset" : "none",
              }}
              onMouseDown={(e) => {
                verticalResizeStart.current = { y: e.clientY, h: processPanelHeight };
                setIsResizingPanels(true);
              }}
              title="Ťahaj pre zmenu výšky Karty procesu vs. Pomocník"
            >
              <span
                style={{
                  height: 4,
                  width: 48,
                  borderRadius: 12,
                  background: "repeating-linear-gradient(90deg, rgba(255,255,255,0.45), rgba(255,255,255,0.45) 6px, rgba(255,255,255,0.15) 6px, rgba(255,255,255,0.15) 12px)",
                }}
              />
            </div>
          ) : null}

          {orgOpen ? (
            <div className="process-card-drawer is-open process-card-org">
              <div className="process-card-header">
                <div>
                  <div className="process-card-label">Model organizacie</div>
                  <div className="process-card-description">
                    Strom procesov. Vyber priecinok a pridaj Folder alebo Process.
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                    <span>
                      Aktivna organizacia: {activeOrgId ? activeOrgName || activeOrgId : "Ziadna organizacia"}
                    </span>
                    <button className="btn btn--small" type="button" onClick={openOrgsModal}>
                      Sprava
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="process-card-close"
                  aria-label="Zavriet model organizacie"
                  onClick={() => setOrgOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="process-card-body">
                {orgBreadcrumbItems.length ? (
                  <div className="org-breadcrumb">
                    {orgBreadcrumbItems.map((item, idx) => {
                      const isLast = idx === orgBreadcrumbItems.length - 1;
                      const isFolder = item.type === "folder";
                      const isDisabled = item.type === "process" && isLast;
                      return (
                        <span key={`${item.id}-${idx}`} className="org-breadcrumb__item-wrap">
                          <button
                            type="button"
                            className={`org-breadcrumb__item ${isFolder ? "is-folder" : "is-process"} ${
                              isLast ? "is-current" : ""
                            }`}
                            onClick={() => handleOrgBreadcrumbClick(item)}
                            disabled={isDisabled}
                            title={item.name}
                          >
                            {item.name}
                          </button>
                          {!isLast ? <span className="org-breadcrumb__sep">/</span> : null}
                        </span>
                      );
                    })}
                  </div>
                ) : null}
                <div className="org-sidebar__actions">
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={handleCreateOrgFolder}
                    disabled={!activeOrgId || !activeOrgCapabilities.canEditOrgModels}
                  >
                    + Folder
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={handleCreateOrgProcess}
                    disabled={!activeOrgId || !activeOrgCapabilities.canEditOrgModels}
                  >
                    + Process
                  </button>
                  <button type="button" className="btn btn--small" onClick={toggleOrgTreeExpand} disabled={!orgTree}>
                    {isOrgTreeFullyExpanded ? "Zbalit strom" : "Rozbalit strom"}
                  </button>
                </div>
                <div className="org-sidebar__search">
                  <input
                    type="search"
                    className="org-search-input"
                    placeholder="Hľadať proces..."
                    value={orgSearchQuery}
                    onChange={(e) => setOrgSearchQuery(e.target.value)}
                  />
                </div>
                {orgToast ? <div className="org-sidebar__hint org-sidebar__hint--success">{orgToast}</div> : null}
                {orgLoading ? <div className="org-sidebar__hint">Nacitavam strom...</div> : null}
                {orgError ? <div className="org-sidebar__hint org-sidebar__hint--error">{orgError}</div> : null}
                {!activeOrgId ? (
                  <div className="org-sidebar__hint org-sidebar__hint--error">
                    Najprv si vyber alebo vytvor organizaciu.
                    <div style={{ marginTop: 6 }}>
                      <button className="btn btn--small" type="button" onClick={openOrgsModal}>
                        Sprava organizacie
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="org-tree" ref={orgTreeRef}>
                  {renderOrgTreeNode(filteredOrgTree)}
                </div>
              </div>
            </div>
          ) : null}

          {laneOpen && selectedLane ? (
            <div className={`process-card-drawer is-open process-card-lane ${isReadOnlyMode ? "is-readonly" : ""}`}>
              <div className="process-card-header">
                <div className="wizard-lane-v2__title-wrap">
                  <div className="wizard-lane-v2__title">{laneRoleDisplayName}</div>
                  <div className="wizard-lane-v2__subtitle">{laneSubtitle}</div>
                  <div className="wizard-lane-v2__hint">
                    Tu doplníš kroky tejto roly. Ďalší krok môžeš oddeliť čiarkou alebo pokračovať na novom riadku.
                  </div>
                </div>
                <div className="wizard-lane-v2__header-actions">
                  <button
                    type="button"
                    className="btn btn--small wizard-lane-v2__header-btn"
                    onClick={() => {
                      openLaneHelper({ type: inferLaneHelpIntentType() });
                    }}
                  >
                    Pomocník
                  </button>
                  <button
                    type="button"
                    className="process-card-close wizard-lane-v2__close"
                    aria-label="Zavrieť panel lane"
                    onClick={() => {
                      setSelectedLane(null);
                      setLaneDescription("");
                      setLaneInsertOpen(false);
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="process-card-body wizard-lane-v2__body" ref={lanePanelScrollRef}>
                <div className="wizard-lane-v2__card">
                    <div className="wizard-lane-v2__onboarding">
                      <div className="wizard-lane-v2__onboarding-title">Ako písať kroky v role</div>
                      <div className="wizard-lane-v2__onboarding-list">
                        <div className="wizard-lane-v2__type-copy">
                          Píš jednoducho to, čo táto rola robí. Ďalší krok môžeš oddeliť čiarkou alebo pokračovať na novom riadku.
                        </div>
                        <div className="wizard-lane-v2__type-copy">
                          Keď sa proces rozhoduje, začni vetu slovom <strong>ak</strong> alebo <strong>keď</strong>. Modrý pomocník pod poľom ti potom napovie, ako pokračovať.
                        </div>
                        <div className="wizard-lane-v2__type-copy">
                          Keď sa deje viac vecí naraz, začni vetu slovom <strong>paralelne</strong>, <strong>súčasne</strong> alebo <strong>naraz</strong>.
                        </div>
                        <div className="wizard-lane-v2__type-copy">
                          Ak si nie si istý, napíš to vlastnými slovami. Kontrola zápisu dole ti priebežne ukáže, ako textu rozumie.
                        </div>
                      </div>
                    </div>
                    <div className="wizard-lane-v2__section">
                      <div className="wizard-lane-v2__section-header">KROKY ROLY</div>
                      <div className="wizard-lane-v2__section-sub">
                        Píš stručne a vecne. Stačí opísať, čo táto rola robí a v akom poradí to nasleduje.
                      </div>
                      {isDemoMode ? (
                        <div className="wizard-lane-v2__section-sub">Demo limit: max {DEMO_LIMITS.maxObjectsPerLane} objektov na rolu.</div>
                      ) : null}
                      <textarea
                        ref={laneTextareaRef}
                        value={laneDescription}
                        onChange={(e) => updateLaneDescription(e.target.value)}
                        rows={9}
                        placeholder={
                          "Prijmem žiadosť, overím identitu\nAk identita nie je platná, zamietnem žiadosť, inak pokračujem..."
                        }
                        onKeyDown={(e) => {
                          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                            e.preventDefault();
                            if (!isLoading && !(isReadOnlyMode && !isDemoMode) && laneDescription.trim()) {
                              void handleAppendToLane();
                            }
                          }
                        }}
                        className={`wizard-lane-textarea wizard-lane-v2__textarea ${
                          inlineLaneHint || hasLaneStructure ? "wizard-lane-textarea--structure" : ""
                        } ${laneTemplateFlash ? "wizard-lane-textarea--flash" : ""} ${
                          guideHighlight?.laneInputLaneId &&
                          selectedLane?.id &&
                          String(guideHighlight.laneInputLaneId) === String(selectedLane.id)
                            ? "guide-highlight-input"
                            : ""
                        }`}
                      />
                      {inlineLaneHint ? (
                        <div className="wizard-lane-inline-hint" role="status" aria-live="polite">
                          <span>{inlineLaneHint.message}</span>
                        </div>
                      ) : null}
                      <div className="wizard-lane-v2__helper-row">
                        <button
                          type="button"
                          className={`btn btn--small wizard-lane-v2__link-btn ${showLaneHelpTip ? "is-nudged" : ""}`}
                          title="Otvorí pomocníka, kde si vieš vložiť vzor alebo vyplniť konštrukciu."
                          onClick={() => {
                            openLaneHelper({ type: inferLaneHelpIntentType() });
                          }}
                        >
                          Pomôž mi napísať krok
                        </button>
                        {showLaneHelpTip ? <span className="wizard-lane-v2__tip-badge">1 tip</span> : null}
                      </div>
                      {lanePlaceholderWarning && !inlineLaneHint ? (
                        <div className="wizard-lane-v2__control-warning">{lanePlaceholderWarning}</div>
                      ) : null}
                      {laneSubmitGuardMessage && !inlineLaneHint ? (
                        <div className="wizard-lane-v2__control-warning">{laneSubmitGuardMessage}</div>
                      ) : null}
                      <div className="wizard-lane-v2__row-actions">
                        <button
                          className="btn btn-primary lane-primary-btn wizard-lane-v2__apply-btn"
                          type="button"
                          onClick={handleAppendToLane}
                          disabled={
                            isLoading ||
                            (isReadOnlyMode && !isDemoMode) ||
                            !laneDescription.trim() ||
                            Boolean(laneSubmitGuardMessage)
                          }
                        >
                          {isLoading ? "Pridávam..." : laneApplyButtonLabel}
                        </button>
                        {laneDescription.trim() ? (
                          <button
                            className="btn btn--small wizard-lane-v2__clear-btn"
                            type="button"
                            onClick={() => setLaneDescription("")}
                            disabled={isLoading}
                          >
                            Vyčistiť
                          </button>
                        ) : null}
                      </div>
                      {!laneDescription.trim() ? (
                        <div className="wizard-lane-v2__disabled-hint">Najprv napíš aspoň 1 krok.</div>
                      ) : null}
                    </div>
                    {!isDemoMode ? (
                    <div className="wizard-lane-v2__section">
                      <div className="wizard-lane-v2__section-header">VZORY</div>
                      <div className="wizard-lane-v2__section-sub">Dočasná pomôcka, keď si chceš rýchlo predvyplniť text.</div>
                      <div className="wizard-lane-v2__template-select-wrap">
                        <select
                          className="wizard-lane-v2__template-select"
                          value={laneTemplateChoice}
                          onChange={(e) => {
                            const selectedId = e.target.value;
                            setLaneTemplateChoice(selectedId);
                            const template = LANE_TEMPLATES.find((item) => item.id === selectedId);
                            if (template) {
                              applyLaneTemplate(template);
                            }
                          }}
                          disabled={isReadOnlyMode}
                        >
                          <option value="">Vyber vzor...</option>
                          {LANE_TEMPLATES.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    ) : null}

                    <div className="wizard-lane-v2__section">
                      <div className="wizard-lane-v2__control-head">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span
                            className={`wizard-lane-v2__status-dot ${
                              laneControlStatus === "ok"
                                ? "is-ok"
                                : laneControlStatus === "warning"
                                  ? "is-warning"
                                  : "is-idle"
                            }`}
                            aria-hidden
                          />
                          Kontrola zápisu
                        </span>
                      </div>
                      <div className="wizard-lane-v2__control-body is-compact">
                        {laneDescription.trim() ? (
                          laneHelperItems.length ? (
                            <div className="wizard-lane-v2__control-list">
                              {laneHelperItems.map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  className={`wizard-lane-v2__control-item ${item.warning ? "is-warning" : ""}`}
                                  onClick={() => focusLaneLine(item.lineNumber)}
                                >
                                  <div className="wizard-lane-v2__control-line">
                                    <span className="wizard-lane-v2__control-meta">Riadok {item.lineNumber}</span>
                                    <strong>{item.badge}</strong> - {item.text}
                                  </div>
                                  {item.warning && !inlineLaneHint ? (
                                    <div className="wizard-lane-v2__control-warning">{item.warning}</div>
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="wizard-lane-v2__control-ok">Kroky vyzerajú konzistentne.</div>
                          )
                        ) : (
                          <div className="wizard-lane-v2__muted">
                            Začni písať kroky a kontrola ti ukáže typy krokov a upozornenia.
                          </div>
                        )}
                      </div>
                    </div>
                </div>
              </div>
            </div>
          ) : null}

          {helpOpen ? (
            <div className="process-card-drawer is-open process-card-help">
              <div className="process-card-header">
                <div>
                  <div className="process-card-label">Pomocník</div>
                  <div className="process-card-description">
                    Vkladáš do:{" "}
                    {helpInsertTarget?.type === "lane"
                      ? `roly ${helpInsertTarget.laneName || helpInsertTarget.laneId || ""}`
                      : "hlavné kroky"}
                  </div>
                  <div className="wizard-help-card-hint">
                    Vyber typ zápisu, doplň vlastné slová a vlož ho do textu. Potom ho už len upravíš podľa svojho procesu.
                  </div>
                </div>
                <div className="process-card-header-actions">
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => {
                      if (selectedLane?.id) {
                        openSingleCard("lane");
                        return;
                      }
                      setHelpOpen(false);
                    }}
                  >
                    Späť
                  </button>
                </div>
              </div>
              <div className="process-card-body">
                {renderHelpList()}
              </div>
            </div>
          ) : null}

          

          {storyOpen ? (
            <div className="process-card-drawer is-open process-card-story">
              <div className="process-card-header">
                <div>
                  <div className="process-card-label">Príbeh procesu</div>
                  <div className="process-card-description">
                    Zhrnutie procesu v ľudskej reči podľa aktuálnej mapy.
                  </div>
                </div>
                <button
                  type="button"
                  className="process-card-close"
                  aria-label="Zavrieť príbeh procesu"
                  onClick={() => setStoryOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="process-card-body">
                <section className="process-card-section process-story-panel">
                  <div className="process-story-panel__hero">
                    <div className="process-story-panel__copy">
                      <div className="process-card-section__title">
                        <h2>Opis procesu</h2>
                        <span className="process-card-pill process-card-pill--muted">Automatický výstup</span>
                      </div>
                      <p className="process-story-panel__intro">
                        Tento panel automaticky vytvára čistý opis procesu podľa aktuálnej mapy. Cieľom je text, pri ktorom si používateľ povie: áno, presne takto to robíme.
                      </p>
                    </div>
                    <div className="process-story-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={regenerateStory}
                        disabled={!engineJson}
                      >
                        Obnoviť príbeh
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={handleCopyStory}
                        disabled={!storyDoc}
                      >
                        Kopírovať text
                      </button>
                    </div>
                  </div>

                  <div className="process-story-status">
                    {storyStale ? (
                      <div className="process-story-stale">
                        Mapa sa zmenila. Obnov príbeh procesu podľa aktuálneho stavu modelu.
                      </div>
                    ) : null}
                    {storyGeneratedAt ? (
                      <div className="process-story-meta">Naposledy generované: {formatDateTime(storyGeneratedAt)}</div>
                    ) : null}
                  </div>
                </section>

                <section className="process-card-section process-story-output">
                  <div className="process-card-section__title">
                    <h2>Čistý opis procesu</h2>
                    <span className="process-card-pill process-card-pill--muted">Dokument</span>
                  </div>
                  {storyDoc ? (
                    <div className="process-story-document">
                      {buildStoryParagraphs(storyDoc).map((paragraph, index) => (
                        <p key={`story-paragraph-${index}`} className="process-story-document__paragraph">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <div className="process-story-empty">
                      {engineJson ? "Klikni na „Obnoviť príbeh“ a vygeneruj si opis procesu." : "Najprv načítaj alebo vytvor mapu."}
                    </div>
                  )}
                </section>
              </div>
            </div>
          ) : null}
{helpOpen && mentorOpen ? (
            <div
              style={{
                height: 1,
                background: "linear-gradient(90deg, rgba(47,92,160,0.2), rgba(47,92,160,0.4), rgba(47,92,160,0.2))",
              }}
            />
          ) : null}

        </div>
      ) : null}

        <div className="process-card-main">
          {isDemoMode ? (
            <div className="demo-banner">
              <div className="demo-banner__text">
                <strong>DEMO MODE</strong> - nic sa neuklada. Limity: 2 role, max 5 objektov na rolu, max 1 rozhodnutie.
              </div>
              <div className="demo-banner__actions">
                <button className="btn btn--small" type="button" onClick={resetDemoState}>
                  Reset demo
                </button>
                <a className="btn btn--small btn-primary" href="/register">
                  Create account
                </a>
              </div>
            </div>
          ) : null}
          {isReadOnlyMode ? (
            <div
              style={{
                marginBottom: 10,
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(15, 23, 42, 0.8)",
                border: "1px solid rgba(94, 234, 212, 0.25)",
                color: "#e2e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>READ-ONLY režim</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {activeOrgCapabilities.canToggleOrgEdit
                    ? "Tento org model je len na čítanie. Ak chceš upravovať, klikni „Upraviť“."
                    : "Tento org model je len na čítanie. Ako pozorovateľ ho nemôžeš upravovať."}
                </div>
              </div>
              {activeOrgCapabilities.canToggleOrgEdit ? (
                <button className="btn btn--small" type="button" onClick={handleEnableOrgEdit}>
                  Upraviť
                </button>
              ) : null}
            </div>
          ) : null}
          {modelSource?.kind === "org" && orgVersionPreview?.isPreview ? (
            <div
              style={{
                marginBottom: 10,
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(120, 53, 15, 0.18)",
                border: "1px solid rgba(251, 191, 36, 0.45)",
                color: "#fef3c7",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ fontWeight: 600 }}>
                Pozeráš staršiu verziu {orgVersionPreview?.label || ""}. 
              </div>
              <button
                className="btn btn--small"
                type="button"
                onClick={() => void openOrgProcessByNodeLatest(orgVersionPreview?.treeNodeId || modelSource?.treeNodeId)}
              >
                Otvoriť najnovšiu
              </button>
            </div>
          ) : null}
          <div className="wizard-viewer">
            {showGuideBanners ? (
              <div className="guide-bar">
                <div className="guide-bar__text">
                  {guideState?.title ? (
                    <div className="guide-bar__title">{guideState.title}</div>
                  ) : null}
                  <div>{guideState.message}</div>
                </div>
                <div className="guide-bar__actions">
                  {guideState?.primary ? (
                    <button
                      className="btn btn--small btn-primary"
                      type="button"
                      onClick={() =>
                        handleGuideAction(
                          guideState.primary.action,
                          guideState.primary.payload,
                        )
                      }
                    >
                      {guideState.primary.label}
                    </button>
                  ) : null}
                  {guideState?.secondary && guideState.secondary.action !== "NOT_NOW" ? (
                    <button
                      className="btn btn--small"
                      type="button"
                      onClick={() =>
                        handleGuideAction(
                          guideState.secondary.action,
                          guideState.secondary.payload,
                        )
                      }
                    >
                      {guideState.secondary.label}
                    </button>
                  ) : null}
                    {guideState?.tertiary ? (
                      <button
                        className={`btn btn--small ${guideState?.tertiary?.action === "CONNECT_END_HERE" ? "btn-guide-cta" : ""}`}
                        type="button"
                        onClick={() => {
                          console.log("[Guide] tertiary click", {
                            action: guideState?.tertiary?.action,
                            payload: guideState?.tertiary?.payload || null,
                          });
                          handleGuideAction(
                            guideState.tertiary.action,
                            guideState.tertiary.payload,
                          );
                        }}
                      >
                        {guideState.tertiary.label}
                      </button>
                    ) : null}
                </div>
              </div>
            ) : showHomeGuideBanner ? (
              <div className="guide-bar guide-bar--welcome">
                <div className="guide-bar__text">
                  <div className="guide-bar__title">Ahoj, ja som tvoj sprievodca</div>
                  <div>{homeGuideMessage}</div>
                </div>
                <div className="guide-bar__actions">
                  <button
                    className="btn btn--small btn-primary"
                    type="button"
                    onClick={handleStartNewModel}
                  >
                    Vytvoriť model
                  </button>
                </div>
              </div>
            ) : null}
            {xml ? (
              <MapViewer
                key={`${modelSource?.kind || "sandbox"}-${modelSource?.kind === "org" && orgReadOnly ? "ro" : "rw"}`}
                {...viewerProps}
              />
            ) : (
              <div
                style={{
                  minHeight: "60vh",
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                }}
              >
                {!xml && error ? (
                  <div
                    className="wizard-error"
                    style={{
                      padding: "14px 16px",
                      borderRadius: 12,
                      fontWeight: 800,
                      fontSize: 15,
                      letterSpacing: 0.2,
                      background: "linear-gradient(135deg, rgba(59,130,246,0.35), rgba(30,58,138,0.55))",
                      border: "1px solid rgba(96,165,250,0.6)",
                      color: "#eff6ff",
                      boxShadow: "0 10px 30px rgba(30, 58, 138, 0.25)",
                      maxWidth: 520,
                    }}
                  >
                    {error}
                  </div>
                ) : null}
                <div className="wizard-welcome">
                  <div className="wizard-welcome__orb" aria-hidden />
                  <div className="wizard-welcome__card">
                    <div className="wizard-welcome__eyebrow">flowmate · BPMNGen</div>
                    <div className="wizard-welcome__title">Vitaj znova v BPMNGen</div>
                    <div className="wizard-welcome__subtitle">Čo ideme robiť dnes?</div>
                    <div className="wizard-welcome__actions">
                      {isDemoMode ? (
                        <>
                          <button className="btn btn-primary" type="button" onClick={() => setDemoSetupOpen(true)}>
                            Otvoriť demo setup
                          </button>
                          <a className="btn" href="/register">
                            Create account
                          </a>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-primary" type="button" onClick={handleStartNewModel}>
                            Vytvoriť mapu procesu
                          </button>
                          <button className="btn" type="button" onClick={openModels}>
                            Pokračovať v rozpracovanom
                          </button>
                        </>
                      )}
                    </div>
                    <div className="wizard-welcome__hint">
                      {isDemoMode
                        ? "Demo je dočasné a po obnovení stránky sa vymaže."
                        : (
                          <>
                            <div>Tip: Rozpracované modely nájdeš v sekcii Uložené modely.</div>
                            <div>Tip: napíš proces bežným jazykom. My ho premeníme na BPMN mapu.</div>
                          </>
                        )}
                    </div>
                  </div>
                </div>
              </div>
          )}
        </div>

        {laneInsertOpen && selectedLane ? (
          <div className="wizard-models-modal" onClick={() => setLaneInsertOpen(false)}>
            <div className="wizard-models-panel wizard-help-panel" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <h3>Pomocník</h3>
                <button className="btn btn--small" type="button" onClick={() => setLaneInsertOpen(false)}>
                  Zavriet
                </button>
              </div>
              <div className="wizard-shape-meta">
                Vkladáš do: lane {selectedLane.name || selectedLane.id}
              </div>
              <div className="wizard-help-card-hint wizard-help-card-hint--modal">
                Vyber typ zápisu, doplň vlastné slová a vlož ho do textu. Potom ho už len upravíš podľa svojho procesu.
              </div>
              <div className="wizard-help-modal-body">
                {renderHelpList()}
              </div>
            </div>
          </div>
        ) : null}

        {isDemoMode && demoSetupOpen ? (
          <div className="wizard-models-modal demo-setup-modal">
            <div className="wizard-models-panel demo-setup-panel" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div>
                  <h3 style={{ margin: 0 }}>Guided lightweight sandbox</h3>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                    Zadaj názov procesu a max 2 roly. Potom vytvoríme skeleton mapy.
                  </div>
                </div>
                {xml ? (
                  <button className="btn btn--small" type="button" onClick={() => setDemoSetupOpen(false)}>
                    Zavrieť
                  </button>
                ) : null}
              </div>
              <div className="demo-setup-content">
                <div className="demo-setup-form">
                  <label className="wizard-field">
                    <span>Názov procesu</span>
                    <input
                      value={processCard.generatorInput.processName}
                      onChange={(e) => updateGeneratorInput("processName", e.target.value)}
                      placeholder="Napr. Schválenie žiadosti"
                      disabled={demoBuilding}
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Role (každá na nový riadok, max 2)</span>
                    <textarea
                      value={processCard.generatorInput.roles}
                      onChange={(e) => updateGeneratorInput("roles", e.target.value)}
                      rows={4}
                      disabled={demoBuilding}
                    />
                  </label>
                  {demoIntroError ? <div className="wizard-error">{demoIntroError}</div> : null}
                  {demoBuilding ? (
                    <div className="demo-build-steps">
                      <div className={demoBuildStep >= 0 ? "is-active" : ""}>1. Creating skeleton...</div>
                      <div className={demoBuildStep >= 1 ? "is-active" : ""}>2. Adding roles...</div>
                      <div className={demoBuildStep >= 2 ? "is-active" : ""}>3. Generating BPMN...</div>
                    </div>
                  ) : null}
                  <div className="demo-setup-actions">
                    <button className="btn btn-primary" type="button" onClick={() => void runDemoGenerate()} disabled={demoBuilding}>
                      {demoBuilding ? "Building..." : "Generate demo model"}
                    </button>
                  </div>
                </div>
                <aside className="demo-template-panel">
                  <div className="demo-template-panel__title">Vybrať vzor</div>
                  <div className="demo-template-panel__list">
                    {DEMO_TEMPLATES.map((template) => {
                      const isActive =
                        processCard.generatorInput.processName?.trim() === template.processName &&
                        processCard.generatorInput.roles?.trim() === template.roles;
                      return (
                        <button
                          key={template.id}
                          type="button"
                          className={`demo-template-item ${isActive ? "is-active" : ""}`}
                          onClick={() => applyDemoTemplate(template)}
                          disabled={demoBuilding}
                        >
                          <span className="demo-template-item__label">{template.label}</span>
                          <span className="demo-template-item__meta" aria-hidden />
                        </button>
                      );
                    })}
                  </div>
                </aside>
              </div>
            </div>
          </div>
        ) : null}


        {modelsOpen ? (
          <div className="wizard-models-modal" onClick={() => setModelsOpen(false)}>
            <div className="wizard-models-panel wizard-models-panel--sandbox" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-models-copy">
                  <h3 className="wizard-models-title">Moje uložené modely (Pieskovisko)</h3>
                  <div className="wizard-models-subtitle">
                    Súkromné modely viditeľné len pre teba. Tlačidlom „Uložiť do organizácie“ ich uložíš do
                    organizačnej knižnice.
                  </div>
                </div>
                <div className="wizard-models-tools">
                  <input
                    type="text"
                    className="wizard-models-search"
                    placeholder="Hľadať podľa názvu…"
                    value={modelsSearch}
                    onChange={(e) => setModelsSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        fetchModels();
                      }
                    }}
                  />
                  <button className="btn btn--small" type="button" onClick={fetchModels} disabled={modelsLoading}>
                    {modelsLoading ? "Načítavam..." : "Hľadať"}
                  </button>
                  <button className="btn btn--small" type="button" onClick={fetchModels} disabled={modelsLoading}>
                    {modelsLoading ? "Načítavam..." : "Obnoviť"}
                  </button>
                </div>
              </div>
              {modelsError ? <div className="wizard-error">{modelsError}</div> : null}
              {myOrgsEmpty === true ? (
                <div className="wizard-error wizard-error--compact">Používateľ nemá organizáciu.</div>
              ) : null}
              {myOrgsEmpty === true ? (
                <div className="wizard-models-empty-actions">
                  <button className="btn btn--small btn-primary" type="button" onClick={openOrgsModal}>
                    Spravovať organizáciu
                  </button>
                </div>
              ) : null}
              <div className="wizard-models-table-wrap">
                <table className="wizard-models-table">
                  <thead>
                    <tr>
                      <th>Názov modelu</th>
                      <th>Verzia</th>
                      <th>Vytvorený</th>
                      <th>Naposledy upravený</th>
                      <th>Akcie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelsLoading ? (
                      <tr>
                        <td colSpan={5}>Načítavam...</td>
                      </tr>
                    ) : modelGroups.length ? (
                      modelGroups.flatMap((group) => {
                        const latest = group.latest;
                        const isExpanded = expandedModelGroups.includes(group.key);
                        return [
                          <tr key={`${group.key}_row`}>
                            <td>
                              <div className="wizard-model-name" title={group.label}>
                                <span className="wizard-model-name__title">{group.label}</span>
                                {latest?.process_meta?.org_pushes?.length ? (
                                  <span
                                    className="wizard-model-org-badge"
                                    title={`Uložené v ${latest.process_meta.org_pushes.length} organizácii(ách)`}
                                  >
                                    V organizácii
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td>{latest?.process_meta?.version || "–"}</td>
                            <td>{formatDateTime(latest?.created_at)}</td>
                            <td>{formatDateTime(latest?.updated_at)}</td>
                            <td>
                              <div className="wizard-models-actions">
                                <button
                                  className={`btn btn--small btn-versions-toggle ${isExpanded ? "is-active" : ""}`}
                                  type="button"
                                  onClick={() => toggleModelGroup(group.key)}
                                >
                                  <span>{isExpanded ? "Skryť verzie" : "Verzie"}</span>
                                  <span className="wizard-model-count">{group.items.length}</span>
                                </button>
                                {latest ? (
                                  <button
                                    className="btn btn--small btn-primary"
                                    type="button"
                                    onClick={() => loadModelFromList(latest.id, `#${group.items.length}`)}
                                    disabled={loadLoading || modelsActionLoading}
                                  >
                                    Otvoriť poslednú
                                  </button>
                                ) : null}
                                {latest?.process_meta?.org_pushes?.find((p) => p.org_id === activeOrgId)?.org_model_id ? (
                                  <button
                                    className="btn btn--small"
                                    type="button"
                                    onClick={() =>
                                      loadOrgModelDirect(
                                        latest.process_meta.org_pushes.find((p) => p.org_id === activeOrgId).org_model_id,
                                      )
                                    }
                                    disabled={loadLoading || modelsActionLoading}
                                  >
                                    Otvoriť org verziu
                                  </button>
                                ) : null}
                                {latest ? (
                                  <div className="wizard-model-action-stack">
                                    <button
                                      className="btn btn--small"
                                      type="button"
                                      onClick={() => handlePushModelToOrg(latest)}
                                      disabled={!activeOrgId || pushModelLoadingIds.has(latest.id)}
                                    >
                                      {pushModelLoadingIds.has(latest.id) ? "Ukladám..." : "Uložiť do organizácie"}
                                    </button>
                                    {!activeOrgId ? (
                                      <div className="wizard-model-action-hint">
                                        Nemáš žiadnu organizáciu
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>,
                          isExpanded ? (
                            <tr key={`${group.key}_versions`}>
                              <td colSpan={5}>
                                <div className="wizard-models-versions">
                                  <table className="wizard-models-table">
                                    <thead>
                                      <tr>
                                        <th>Verzia</th>
                                        <th>Vytvorený</th>
                                        <th>Naposledy upravený</th>
                                        <th>Akcie</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.items.map((m, index) => (
                                        <tr key={m.id}>
                                          <td>{m.process_meta?.version || `#${group.items.length - index}`}</td>
                                          <td>{formatDateTime(m.created_at)}</td>
                                          <td>{formatDateTime(m.updated_at)}</td>
                                          <td>
                                            <div className="wizard-models-actions">
                                              <button
                                                className="btn btn--small btn-primary"
                                                type="button"
                                                onClick={() =>
                                                  loadModelFromList(
                                                    m.id,
                                                    m.process_meta?.version || `#${group.items.length - index}`,
                                                  )
                                                }
                                                disabled={loadLoading || modelsActionLoading}
                                              >
                                                Otvoriť
                                              </button>
                                              <button
                                                className="btn btn--small btn-link"
                                                type="button"
                                                onClick={() => handleRenameModel(m.id, m.name || m.id)}
                                                disabled={modelsLoading || modelsActionLoading}
                                              >
                                                Premenovať
                                              </button>
                                              <button
                                                className="btn btn--small btn-danger"
                                                type="button"
                                                onClick={() => handleDeleteModel(m.id, m.name || m.id)}
                                                disabled={modelsLoading || modelsActionLoading}
                                              >
                                                Zmazať
                                              </button>
                                              <div className="wizard-model-action-stack">
                                                <button
                                                  className="btn btn--small"
                                                  type="button"
                                                  onClick={() => handlePushModelToOrg(m)}
                                                  disabled={!activeOrgId || pushModelLoadingIds.has(m.id)}
                                                >
                                                  {pushModelLoadingIds.has(m.id) ? "Ukladám..." : "Uložiť do organizácie"}
                                                </button>
                                                {!activeOrgId ? (
                                                  <div className="wizard-model-action-hint">
                                                    Nemáš žiadnu organizáciu
                                                  </div>
                                                ) : null}
                                              </div>
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          ) : null,
                        ].filter(Boolean);
                      })
                    ) : (
                      <tr>
                        <td colSpan={5}>Žiadne uložené modely.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="btn" type="button" onClick={() => setModelsOpen(false)}>
                  Zavrieť
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {orgVersionsOpen ? (
          <div className="wizard-models-modal" onClick={closeOrgVersionsModal}>
            <div className="wizard-models-panel" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div>
                  <h3 style={{ margin: 0 }}>Verzie procesu</h3>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                    {orgVersionsNode?.name || "Proces"} · organizacne verzie
                  </div>
                </div>
                <div className="wizard-models-tools">
                  <button
                    className="btn btn--small"
                    type="button"
                    onClick={() => void openOrgVersionsModal(orgVersionsNode)}
                    disabled={orgVersionsLoading}
                  >
                    {orgVersionsLoading ? "Nacitavam..." : "Obnovit"}
                  </button>
                </div>
              </div>
              {orgVersionsError ? <div className="wizard-error">{orgVersionsError}</div> : null}
              <div style={{ overflow: "auto" }}>
                <table className="wizard-models-table">
                  <thead>
                    <tr>
                      <th>Verzia</th>
                      <th>ID</th>
                      <th>Vytvoreny</th>
                      <th>Naposledy upraveny</th>
                      <th>Akcie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgVersionsLoading ? (
                      <tr>
                        <td colSpan={5}>Nacitavam...</td>
                      </tr>
                    ) : orgVersionRows.length ? (
                      orgVersionRows.map((item) => (
                        <tr key={item.id}>
                          <td>{item.versionLabel}</td>
                          <td>{item.id}</td>
                          <td>{formatDateTime(item.created_at)}</td>
                          <td>{formatDateTime(item.updated_at)}</td>
                          <td>
                            <div className="wizard-models-actions">
                              <button
                                className="btn btn--small btn-primary"
                                type="button"
                                onClick={() => handleOpenOrgVersion(item.id, item.versionLabel)}
                                disabled={loadLoading}
                              >
                                Otvorit
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5}>Pre tento proces zatial neexistuju dalsie verzie.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="btn" type="button" onClick={closeOrgVersionsModal}>
                  Zavriet
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {orgMoveModalOpen ? (
          <div className="wizard-models-modal" onClick={() => setOrgMoveModalOpen(false)}>
            <div className="wizard-models-panel" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <h3 style={{ margin: 0 }}>Presunut do...</h3>
                <button className="btn btn--small" type="button" onClick={() => setOrgMoveModalOpen(false)}>
                  Zavriet
                </button>
              </div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>
                Proces: <strong>{orgMoveNode?.name || "-"}</strong>
              </div>
              {orgMoveError ? <div className="wizard-error">{orgMoveError}</div> : null}
              {orgMoveTargetFolderId === orgMoveCurrentParentId ? (
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
                  Proces uz je v tomto priecinku.
                </div>
              ) : null}
              <div className="org-tree">{renderOrgFolderPickerNode(orgTree)}</div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button className="btn" type="button" onClick={() => setOrgMoveModalOpen(false)} disabled={orgMoveLoading}>
                  Zrusit
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleConfirmMoveProcess}
                  disabled={orgMoveLoading || orgMoveTargetFolderId === orgMoveCurrentParentId}
                >
                  {orgMoveLoading ? "Presuvam..." : "Presunut sem"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {orgPushModalOpen ? (
          <div className="wizard-models-modal" onClick={closePushModal}>
            <div className="wizard-models-panel wizard-models-panel--org-push" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Organizácia</p>
                  <h3 className="wizard-dialog-title">Uložiť do organizácie</h3>
                  <p className="wizard-dialog-subtitle">Vyber miesto v tímovom strome, kam sa uloží aktuálny model zo sandboxu.</p>
                </div>
                <button className="btn btn--small" type="button" onClick={closePushModal}>
                  Zavriet
                </button>
              </div>
              <div className="wizard-dialog-meta">
                <div className="wizard-dialog-meta__chip">
                  <span className="wizard-dialog-meta__label">Model</span>
                  <strong>{orgPushModel?.name || orgPushModel?.id || "-"}</strong>
                </div>
              </div>
              {orgPushError ? <div className="wizard-error">{orgPushError}</div> : null}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
                <button
                  className="btn btn--small"
                  type="button"
                  onClick={toggleOrgPushTreeExpand}
                  disabled={!orgTree || orgPushLoading}
                >
                  {isOrgPushTreeFullyExpanded ? "Zbaliť strom" : "Rozbaliť strom"}
                </button>
              </div>
              <div className="org-tree wizard-dialog-section wizard-dialog-scroll">
                {orgTree
                  ? renderOrgFolderPickerNode(orgTree, 0, {
                      mode: "push",
                      selectedId: orgPushTargetFolderId,
                      setSelectedId: setOrgPushTargetFolderId,
                      expandedMap: orgPushExpandedFolders,
                      toggleExpanded: (id) =>
                        setOrgPushExpandedFolders((prev) => ({ ...prev, [id]: !prev[id] })),
                    })
                  : null}
              </div>
              <div className="wizard-dialog-actions">
                <button className="btn" type="button" onClick={closePushModal} disabled={orgPushLoading}>
                  Zrušiť
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleConfirmPushToOrg}
                  disabled={orgPushLoading || !orgTree}
                >
                  {orgPushLoading ? "Ukladám..." : "Uložiť sem"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {orgPushConflictOpen ? (
          <div className="wizard-models-modal" onClick={handleConflictCloseModal}>
            <div className="wizard-models-panel wizard-models-panel--org-push" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Konflikt</p>
                  <h3 className="wizard-dialog-title">Duplicitný názov</h3>
                  <p className="wizard-dialog-subtitle">V organizácii už existuje proces s týmto názvom. Vyber, ako sa má pokračovať.</p>
                </div>
                <button className="btn btn--small" type="button" onClick={handleConflictCloseModal}>
                  Zavrieť
                </button>
              </div>
              <div className="wizard-dialog-section wizard-dialog-section--warning">
                V organizačnej vrstve už existuje proces s názvom <strong>{orgPushConflictName}</strong>.
              </div>
              {orgPushConflictMatches.length ? (
                <div className="wizard-dialog-section">
                  <div style={{ marginBottom: 6 }}>Nájdené zhody:</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                    {orgPushConflictMatches.map((match) => (
                      <li key={match.node.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="radio"
                          name="org-push-conflict"
                          checked={orgPushConflictSelectedId === match.node.id}
                          onChange={() => setOrgPushConflictSelectedId(match.node.id)}
                        />
                        <span>
                          <strong>{match.node.name || match.node.id}</strong>
                          <span style={{ opacity: 0.7 }}> — {match.pathLabel}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="wizard-dialog-actions">
                <button
                  className="btn"
                  type="button"
                  onClick={handleConflictOverwrite}
                  disabled={!orgPushConflictSelectedId}
                >
                  Prepísať
                </button>
                <button className="btn" type="button" onClick={handleConflictProceed}>
                  Vložiť aj tak
                </button>
                <button className="btn btn-primary" type="button" onClick={handleConflictRename}>
                  Premenovať názov procesu
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {orgPushOverwriteConfirmOpen ? (
          <div className="wizard-models-modal" onClick={handleCancelOverwrite}>
            <div className="wizard-models-panel wizard-models-panel--org-push" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Potvrdenie</p>
                  <h3 className="wizard-dialog-title">Potvrdiť prepísanie</h3>
                </div>
                <button className="btn btn--small" type="button" onClick={handleCancelOverwrite}>
                  Zavrieť
                </button>
              </div>
              <div className="wizard-dialog-section wizard-dialog-section--warning">
                Ozaj chceš prepísať vybraný proces v organizačnej vrstve?
              </div>
              <div className="wizard-dialog-subtitle">
                Ak prepíšeš tento proces, zmeny z tvojho Pieskoviska sa prejavia v organizačnej vrstve.
              </div>
              <div className="wizard-dialog-actions">
                <button className="btn" type="button" onClick={handleCancelOverwrite}>
                  Zrušiť
                </button>
                <button className="btn btn-danger" type="button" onClick={handleConfirmOverwrite}>
                  Áno, prepísať
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {orgDeleteConfirmOpen ? (
          <div className="wizard-models-modal" onClick={closeDeleteProcessModal}>
            <div className="wizard-models-panel wizard-models-panel--org-push" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Proces</p>
                  <h3 className="wizard-dialog-title">
                    {activeOrgCapabilities.canDirectDeleteOrgProcess ? "Odstrániť proces?" : "Požiadať o odstránenie?"}
                  </h3>
                  <p className="wizard-dialog-subtitle">
                    {activeOrgCapabilities.canDirectDeleteOrgProcess
                      ? "Priame odstránenie je dostupné len pre roly s oprávnením mazať organizačné procesy."
                      : "Táto požiadavka sa odošle vlastníkovi organizácie na schválenie."}
                  </p>
                </div>
                <button className="btn btn--small" type="button" onClick={closeDeleteProcessModal} disabled={orgDeleteLoading}>
                  Zavrieť
                </button>
              </div>
              <div className={`wizard-dialog-section ${activeOrgCapabilities.canDirectDeleteOrgProcess ? "wizard-dialog-section--danger" : "wizard-dialog-section--warning"}`}>
                {activeOrgCapabilities.canDirectDeleteOrgProcess
                  ? `Proces "${orgDeleteNode?.name || "-"}" bude odstránený zo stromu organizácie.`
                  : `Proces "${orgDeleteNode?.name || "-"}" nemôžeš odstrániť priamo.`}
              </div>
              <div className="wizard-dialog-subtitle">
                {activeOrgCapabilities.canDirectDeleteOrgProcess
                  ? "Táto akcia sa nedá vrátiť späť."
                  : "Pošli vlastníkovi krátky dôvod, prečo má byť proces odstránený."}
              </div>
              {!activeOrgCapabilities.canDirectDeleteOrgProcess ? (
                <div className="wizard-dialog-section" style={{ display: "grid", gap: 6 }}>
                  <label htmlFor="org-delete-request-reason" style={{ fontSize: 12, opacity: 0.82 }}>
                    Dôvod žiadosti
                  </label>
                  <textarea
                    id="org-delete-request-reason"
                    className="project-notes-textarea"
                    style={{ minHeight: 100 }}
                    value={orgDeleteRequestReason}
                    onChange={(e) => setOrgDeleteRequestReason(e.target.value)}
                    placeholder="Stručne napíš, prečo má byť proces odstránený..."
                    maxLength={500}
                  />
                </div>
              ) : null}
              {orgDeleteError ? <div className="wizard-error">{orgDeleteError}</div> : null}
              <div className="wizard-dialog-actions">
                <button className="btn" type="button" onClick={closeDeleteProcessModal} disabled={orgDeleteLoading}>
                  {activeOrgCapabilities.canDirectDeleteOrgProcess ? "Zrušiť" : "Zavrieť"}
                </button>
                {activeOrgCapabilities.canDirectDeleteOrgProcess ? (
                  <button className="btn btn-danger" type="button" onClick={openFinalDeleteConfirmModal} disabled={orgDeleteLoading}>
                    Odstrániť
                  </button>
                ) : (
                  <button className="btn btn-danger" type="button" onClick={handleConfirmDeleteProcess} disabled={orgDeleteLoading}>
                    {orgDeleteLoading ? "Odosielam..." : "Požiadať o odstránenie"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {orgDeleteFinalConfirmOpen ? (
          <div className="wizard-models-modal" onClick={closeDeleteProcessModal}>
            <div className="wizard-models-panel wizard-models-panel--org-push" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Posledné potvrdenie</p>
                  <h3 className="wizard-dialog-title">Potvrdiť odstránenie procesu?</h3>
                </div>
                <button className="btn btn--small" type="button" onClick={closeDeleteProcessModal} disabled={orgDeleteLoading}>
                  Zavrieť
                </button>
              </div>
              <div className="wizard-dialog-section wizard-dialog-section--danger">
                Naozaj chceš odstrániť proces "{orgDeleteNode?.name || "-"}"?
              </div>
              <div className="wizard-dialog-subtitle">
                Táto akcia sa nedá vrátiť späť.
              </div>
              {orgDeleteError ? <div className="wizard-error">{orgDeleteError}</div> : null}
              <div className="wizard-dialog-actions">
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    if (orgDeleteLoading) return;
                    setOrgDeleteFinalConfirmOpen(false);
                    setOrgDeleteConfirmOpen(true);
                  }}
                  disabled={orgDeleteLoading}
                >
                  Späť
                </button>
                <button className="btn btn-danger" type="button" onClick={handleConfirmDeleteProcess} disabled={orgDeleteLoading}>
                  {orgDeleteLoading ? "Odstraňujem..." : "Áno, odstrániť"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {savePromptOpen ? (
          <div className="wizard-models-modal" onClick={handleCancelOpen}>
            <div className="wizard-models-panel wizard-models-panel--compact wizard-save-prompt" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Sandbox</p>
                  <h3 className="wizard-dialog-title">Uložiť model?</h3>
                </div>
                <button className="btn btn--small" type="button" onClick={handleCancelOpen}>
                  Zavrieť
                </button>
              </div>
              <div className="wizard-save-prompt__text wizard-dialog-section">
                Máš rozpracovaný model. Chceš ho uložiť pred otvorením iného?
              </div>
              <div className="wizard-save-prompt__actions">
                <button className="btn" type="button" onClick={handleOpenWithoutSave}>
                  Neuložiť
                </button>
                <button className="btn btn-primary" type="button" onClick={handleSaveAndOpen}>
                  Uložiť model
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {regenerateConfirmOpen ? (
          <div className="wizard-models-modal" onClick={() => setRegenerateConfirmOpen(false)}>
            <div className="wizard-models-panel wizard-models-panel--compact wizard-save-prompt wizard-save-prompt--wide" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Karta procesu</p>
                  <h3 className="wizard-dialog-title">Vytvoriť model znova?</h3>
                </div>
                <button className="btn btn--small" type="button" onClick={() => setRegenerateConfirmOpen(false)}>
                  Zrušiť
                </button>
              </div>
              <div className="wizard-save-prompt__text wizard-dialog-section wizard-dialog-section--warning">
                Model už existuje. Ak budeš pokračovať, kostra procesu sa vygeneruje znova podľa aktuálnych údajov v karte procesu.
              </div>
              <div className="wizard-save-prompt__actions">
                <button className="btn" type="button" onClick={() => setRegenerateConfirmOpen(false)}>
                  Nechať pôvodný model
                </button>
                <button className="btn btn-primary" type="button" onClick={handleConfirmRegenerate}>
                  Vytvoriť znova
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {newModelConfirmOpen ? (
          <div className="wizard-models-modal" onClick={() => setNewModelConfirmOpen(false)}>
            <div className="wizard-models-panel wizard-models-panel--compact wizard-save-prompt wizard-save-prompt--wide" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Sandbox</p>
                  <h3 className="wizard-dialog-title">Začať nový model?</h3>
                </div>
                <button className="btn btn--small" type="button" onClick={() => setNewModelConfirmOpen(false)}>
                  Zrušiť
                </button>
              </div>
              <div className="wizard-save-prompt__text wizard-dialog-section wizard-dialog-section--warning">
                Máš rozpracovaný model. Ak budeš pokračovať, neuložené zmeny sa stratia a otvorí sa nová prázdna karta procesu.
              </div>
              <div className="wizard-save-prompt__actions">
                <button className="btn" type="button" onClick={() => setNewModelConfirmOpen(false)}>
                  Ostať v aktuálnom modeli
                </button>
                <button className="btn btn--warning" type="button" onClick={handleConfirmNewModel}>
                  Áno, nový model
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {wizardInputModal ? (
          <div className="wizard-models-modal" onClick={closeWizardInputModal}>
            <div className="wizard-models-panel wizard-models-panel--compact wizard-save-prompt wizard-save-prompt--wide" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  {wizardInputModal.kicker ? <p className="wizard-dialog-kicker">{wizardInputModal.kicker}</p> : null}
                  <h3 className="wizard-dialog-title">{wizardInputModal.title}</h3>
                </div>
                <button className="btn btn--small" type="button" onClick={closeWizardInputModal}>
                  Zrušiť
                </button>
              </div>
              <div className="wizard-save-prompt__text wizard-dialog-section">
                <label className="wizard-field wizard-field--full">
                  <span>{wizardInputModal.label}</span>
                  <input
                    value={wizardInputValue}
                    onChange={(e) => {
                      setWizardInputValue(e.target.value);
                      if (wizardInputError) setWizardInputError("");
                    }}
                    placeholder={wizardInputModal.placeholder || ""}
                    autoFocus
                  />
                </label>
                {wizardInputModal.warning ? <div className="process-card-inline-note">{wizardInputModal.warning}</div> : null}
                {wizardInputError ? <div className="wizard-error wizard-error--compact">{wizardInputError}</div> : null}
              </div>
              <div className="wizard-save-prompt__actions">
                <button className="btn" type="button" onClick={closeWizardInputModal}>
                  Zrušiť
                </button>
                <button className="btn btn-primary" type="button" onClick={() => void submitWizardInputModal()}>
                  {wizardInputModal.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {wizardConfirmModal ? (
          <div className="wizard-models-modal" onClick={closeWizardConfirmModal}>
            <div className="wizard-models-panel wizard-models-panel--compact wizard-save-prompt wizard-save-prompt--wide" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  {wizardConfirmModal.kicker ? <p className="wizard-dialog-kicker">{wizardConfirmModal.kicker}</p> : null}
                  <h3 className="wizard-dialog-title">{wizardConfirmModal.title}</h3>
                </div>
                <button className="btn btn--small" type="button" onClick={closeWizardConfirmModal}>
                  Zrušiť
                </button>
              </div>
              <div className={`wizard-save-prompt__text wizard-dialog-section ${wizardConfirmModal.warning ? "wizard-dialog-section--warning" : ""}`}>
                {wizardConfirmModal.message}
              </div>
              <div className="wizard-save-prompt__actions">
                <button className="btn" type="button" onClick={closeWizardConfirmModal}>
                  {wizardConfirmModal.cancelLabel}
                </button>
                <button
                  className={`btn ${wizardConfirmModal.warning ? "btn--warning" : "btn-primary"}`}
                  type="button"
                  onClick={() => void submitWizardConfirmModal()}
                >
                  {wizardConfirmModal.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {openOrgProcessConfirmNode ? (
          <div className="wizard-models-modal" onClick={() => setOpenOrgProcessConfirmNode(null)}>
            <div className="wizard-models-panel wizard-models-panel--compact wizard-save-prompt" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Model organizácie</p>
                  <h3 className="wizard-dialog-title">Otvoriť proces?</h3>
                </div>
                <button className="btn btn--small" type="button" onClick={() => setOpenOrgProcessConfirmNode(null)}>
                  Zrušiť
                </button>
              </div>
              <div className="wizard-save-prompt__text wizard-dialog-section">
                Otvorí sa najnovšia verzia procesu <strong>{openOrgProcessConfirmNode.name}</strong>.
              </div>
              <div className="wizard-save-prompt__actions">
                <button className="btn" type="button" onClick={() => setOpenOrgProcessConfirmNode(null)}>
                  Zavrieť
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => {
                    const nodeId = openOrgProcessConfirmNode?.id;
                    setOpenOrgProcessConfirmNode(null);
                    if (!nodeId) return;
                    requestOpenWithSave(() => {
                      void openOrgProcessByNodeLatest(nodeId);
                    });
                  }}
                >
                  Otvoriť proces
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {orgEditConfirmOpen ? (
          <div className="wizard-models-modal" onClick={handleCancelEnableOrgEdit}>
            <div className="wizard-models-panel wizard-models-panel--compact wizard-save-prompt" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Organizácia</p>
                  <h3 className="wizard-dialog-title">Prepnúť do editácie?</h3>
                </div>
                <button className="btn btn--small" type="button" onClick={handleCancelEnableOrgEdit}>
                  Zrušiť
                </button>
              </div>
              <div className="wizard-save-prompt__text wizard-dialog-section">
                Zmeny sa budú ukladať do organizácie. Chceš pokračovať?
              </div>
              <div className="wizard-save-prompt__actions">
                <button className="btn" type="button" onClick={handleCancelEnableOrgEdit}>
                  Zrušiť
                </button>
                <button className="btn btn-primary" type="button" onClick={handleConfirmEnableOrgEdit}>
                  Áno, upraviť
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {notesOpen ? (
          <div className="wizard-models-modal" onClick={() => setNotesOpen(false)}>
            <div className="wizard-models-panel project-notes-panel" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Tím</p>
                  <h3 className="wizard-dialog-title">Poznámky k projektu</h3>
                  <p className="wizard-dialog-subtitle">Zachytávajte dohody, otázky a rozhodnutia, aby ich videl celý tím.</p>
                </div>
                <button className="btn btn--small" type="button" onClick={() => setNotesOpen(false)}>
                  Zavrieť
                </button>
              </div>
              <div className="project-notes-body">
                {projectNotesError ? <div className="wizard-error">{projectNotesError}</div> : null}
                <div className="project-notes-toolbar">
                  <div className="project-notes-toolbar__top">
                    <div className="project-notes-toolbar__title">
                      <h4>Zdieľané poznámky</h4>
                      <p>Organizácia: {activeOrgName || "Nezvolená"}</p>
                    </div>
                    {activeOrgId ? (
                      <div className="wizard-dialog-meta">
                        <div className="wizard-dialog-meta__chip">
                          <span className="wizard-dialog-meta__label">Neprečítané</span>
                          <strong>{unreadProjectNotesCount}</strong>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                {activeOrgId ? (
                  <>
                    <label className="wizard-field wizard-dialog-section">
                      <span>Nová poznámka</span>
                      <textarea
                        className="project-notes-textarea project-notes-textarea--draft"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder={"Dohody, otvorené otázky, rozhodnutia...\n- \n- "}
                        rows={6}
                      />
                    </label>
                    <div className="project-notes-actions">
                      <button className="btn btn-primary" type="button" onClick={addProjectNote} disabled={!noteDraft.trim()}>
                        Pridať poznámku
                      </button>
                      {projectNotesSaving ? <div className="project-notes-saving">Ukladám...</div> : null}
                    </div>
                  </>
                ) : (
                  <div className="project-notes-empty" style={{ marginBottom: 8 }}>
                    Poznámky sú viazané na organizáciu. Najprv si zvoľ aktívnu organizáciu.
                  </div>
                )}

                <div className="project-notes-list">
                  {projectNotesLoading ? (
                    <div className="project-notes-empty">Načítavam poznámky...</div>
                  ) : !activeOrgId ? (
                    <div className="project-notes-empty">Po výbere organizácie sa zobrazia jej poznámky.</div>
                  ) : projectNotes.length === 0 ? (
                    <div className="project-notes-empty">
                      Táto organizácia zatiaľ nemá poznámky. Pridaj prvú vyššie.
                    </div>
                  ) : (
                    projectNotes.map((note) => (
                      <div
                        key={note.id}
                        className={`project-note-item project-note-item--${note.status}`}
                      >
                        <div className="project-note-header">
                          <select
                            value={normalizeNoteStatus(note.status)}
                            onChange={(e) => updateProjectNote(note.id, { status: e.target.value })}
                          >
                            <option value="new">Nové</option>
                            <option value="reviewed">Skontrolované</option>
                            <option value="agreed">Dohodnuté</option>
                          </select>
                          <div className="project-note-actions">
                            <button
                              type="button"
                              className="btn btn--small btn-accent"
                              onClick={() => setReplyOpenById((prev) => ({ ...prev, [note.id]: true }))}
                            >
                              Pridať odpoveď
                            </button>
                            <button
                              type="button"
                              className="btn btn--small"
                              onClick={() => startEditProjectNote(note)}
                              disabled={editingNoteId === note.id}
                            >
                              Upraviť
                            </button>
                            <button
                              type="button"
                              className="btn btn--small btn-danger"
                              onClick={() => removeProjectNote(note.id)}
                            >
                              Zmazať
                            </button>
                          </div>
                        </div>
                        {formatNoteMetaLine(note) ? <div className="project-note-meta">{formatNoteMetaLine(note)}</div> : null}
                        {editingNoteId === note.id ? (
                          <div className="project-note-edit">
                            <textarea
                              className="project-note-edit__textarea"
                              value={editingNoteText}
                              onChange={(e) => setEditingNoteText(e.target.value)}
                              rows={4}
                            />
                            <div className="project-note-edit__actions">
                              <button
                                type="button"
                                className="btn btn--small btn-primary"
                                onClick={() => saveEditProjectNote(note.id)}
                                disabled={!editingNoteText.trim()}
                              >
                                Uložiť
                              </button>
                              <button type="button" className="btn btn--small" onClick={cancelEditProjectNote}>
                                Zrušiť
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="project-note-text">{note.text}</div>
                        )}
                        <div className="project-note-replies">
                          {(note.replies || []).map((reply) => (
                            <div key={reply.id} className="project-note-reply">
                              {replyEditing.replyId === reply.id && replyEditing.noteId === note.id ? (
                                <div className="project-note-reply-edit">
                                  <input
                                    type="text"
                                    value={replyEditing.text}
                                    onChange={(e) => setReplyEditing((prev) => ({ ...prev, text: e.target.value }))}
                                  />
                                  <div className="project-note-reply-actions">
                                    <button
                                      type="button"
                                      className="btn btn--small btn-primary"
                                      onClick={saveEditReply}
                                      disabled={!String(replyEditing.text || "").trim()}
                                    >
                                      Uložiť
                                    </button>
                                    <button type="button" className="btn btn--small" onClick={cancelEditReply}>
                                      Zrušiť
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="project-note-reply-row">
                                  <div className="project-note-reply-content">
                                    <div className="project-note-reply-text">{reply.text}</div>
                                    {formatNoteMetaLine(reply) ? (
                                      <div className="project-note-meta project-note-meta--reply">{formatNoteMetaLine(reply)}</div>
                                    ) : null}
                                  </div>
                                  <div className="project-note-reply-actions">
                                    <button
                                      type="button"
                                      className="btn btn--small"
                                      onClick={() => startEditReply(note.id, reply)}
                                    >
                                      Upraviť
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn--small btn-danger"
                                      onClick={() => removeReply(note.id, reply.id)}
                                    >
                                      Zmazať
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                          {replyOpenById[note.id] ? (
                            <div className="project-note-reply-form">
                              <input
                                type="text"
                                value={replyDrafts[note.id] || ""}
                                onChange={(e) =>
                                  setReplyDrafts((prev) => ({ ...prev, [note.id]: e.target.value }))
                                }
                                placeholder="Napíš odpoveď..."
                              />
                              <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => addProjectNoteReply(note.id)}
                                disabled={!String(replyDrafts[note.id] || "").trim()}
                              >
                                Uložiť odpoveď
                              </button>
                              <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                  setReplyDrafts((prev) => ({ ...prev, [note.id]: "" }));
                                  setReplyOpenById((prev) => ({ ...prev, [note.id]: false }));
                                }}
                              >
                                Zrušiť
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activityOpen ? (
          <div className="wizard-models-modal" onClick={() => setActivityOpen(false)}>
            <div className="wizard-models-panel project-notes-panel" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div className="wizard-dialog-copy">
                  <p className="wizard-dialog-kicker">Tím</p>
                  <h3 className="wizard-dialog-title">Aktivita organizácie</h3>
                  <p className="wizard-dialog-subtitle">Prehľad zmien, požiadaviek a tímovej aktivity v aktuálnej organizácii.</p>
                </div>
                <button className="btn btn--small" type="button" onClick={() => setActivityOpen(false)}>
                  Zavrieť
                </button>
              </div>
              <div className="project-notes-body">
                <div className="project-notes-toolbar">
                  <div className="project-notes-toolbar__top">
                    <div className="project-notes-toolbar__title">
                      <h4>Tímová aktivita</h4>
                      <p>Organizácia: {activeOrgName || "Nezvolená"}</p>
                    </div>
                    <div className="wizard-dialog-meta">
                      {activeOrgCapabilities.canApproveDeleteRequests ? (
                        <div className="wizard-dialog-meta__chip">
                          <span className="wizard-dialog-meta__label">Na schválenie</span>
                          <strong>{visibleActivityPendingCount}</strong>
                        </div>
                      ) : null}
                      <div className="wizard-dialog-meta__chip">
                        <span className="wizard-dialog-meta__label">Udalosti</span>
                        <strong>{projectActivityItems.length}</strong>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="project-activity-filters">
                  <button
                    type="button"
                    className={`project-activity-filter ${projectActivityFilter === "all" ? "is-active" : ""}`}
                    onClick={() => setProjectActivityFilter("all")}
                  >
                    Všetko
                  </button>
                  <button
                    type="button"
                    className={`project-activity-filter ${projectActivityFilter === "requests" ? "is-active" : ""}`}
                    onClick={() => setProjectActivityFilter("requests")}
                  >
                    Požiadavky
                  </button>
                  <button
                    type="button"
                    className={`project-activity-filter ${projectActivityFilter === "models" ? "is-active" : ""}`}
                    onClick={() => setProjectActivityFilter("models")}
                  >
                    Modely
                  </button>
                  <button
                    type="button"
                    className={`project-activity-filter ${projectActivityFilter === "members" ? "is-active" : ""}`}
                    onClick={() => setProjectActivityFilter("members")}
                  >
                    Členovia
                  </button>
                </div>
                {projectActivityError ? <div className="wizard-error">{projectActivityError}</div> : null}
                {projectActivityLoading ? (
                  <div className="project-notes-empty">Načítavam aktivitu...</div>
                ) : !activeOrgId ? (
                  <div className="project-notes-empty">Po výbere organizácie sa zobrazí aktivita tímu.</div>
                ) : projectActivityItems.length === 0 ? (
                  <div className="project-notes-empty">Zatiaľ tu nie sú žiadne zaznamenané udalosti.</div>
                ) : (
                  <div className="project-notes-list">
                    {activeOrgCapabilities.canApproveDeleteRequests ? (
                      <div className={`project-activity-section ${activityRequestsPulse ? "is-pulse" : ""}`}>
                        <div className="project-activity-section__header">
                          <h4 className="project-activity-section__title">
                            Požiadavky na odstránenie
                            {filteredPendingDeleteRequests.length > 0 ? (
                              <span className="project-activity-badge is-pending project-activity-badge--count">
                                {filteredPendingDeleteRequests.length}
                              </span>
                            ) : null}
                          </h4>
                        </div>
                        {filteredPendingDeleteRequests.length === 0 ? (
                          <div className="project-notes-empty">Žiadne požiadavky na odstránenie.</div>
                        ) : (
                          <div className="project-notes-list">
                            {filteredPendingDeleteRequests.map((item) => {
                              const status = getProjectActivityStatus(item);
                              const itemClass = getProjectActivityCardClass(item);
                              return (
                                <div key={item.id} className={`project-note-item project-activity-item ${itemClass}`.trim()}>
                                  <div className="project-activity-item__header">
                                    <div className="project-activity-item__text">{describeProjectActivity(item)}</div>
                                    {status ? (
                                      <span className={`project-activity-badge is-${status.tone}`}>
                                        {status.label}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="project-note-meta">{formatDateTime(item.created_at)}</div>
                                  {item?.metadata?.reason ? (
                                    <div className="project-activity-reason">
                                      Dovod: {item.metadata.reason}
                                    </div>
                                  ) : null}
                                  <div className="project-activity-item__actions">
                                    <button
                                      type="button"
                                      className="btn btn--small"
                                      disabled={projectActivityActionId === `approve:${item.id}` || projectActivityActionId === `reject:${item.id}`}
                                      onClick={() => void handleOrgDeleteRequestDecision(item, "approve")}
                                    >
                                      {projectActivityActionId === `approve:${item.id}` ? "Schvalujem..." : "Schvalit odstranenie"}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn--small"
                                      disabled={projectActivityActionId === `approve:${item.id}` || projectActivityActionId === `reject:${item.id}`}
                                      onClick={() => void handleOrgDeleteRequestDecision(item, "reject")}
                                    >
                                      {projectActivityActionId === `reject:${item.id}` ? "Zamietam..." : "Zamietnut"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : null}

                    <div className="project-activity-section">
                      <div className="project-activity-section__header">
                        <h4 className="project-activity-section__title">Ostatna aktivita</h4>
                      </div>
                      {filteredNonRequestActivityItems.length === 0 ? (
                        <div className="project-notes-empty">Zatial tu nie je dalsia aktivita.</div>
                      ) : (
                        <div className="project-notes-list">
                          {filteredNonRequestActivityItems.map((item) => {
                            const status = getProjectActivityStatus(item);
                            const itemClass = getProjectActivityCardClass(item);
                            return (
                              <div key={item.id} className={`project-note-item project-activity-item ${itemClass}`.trim()}>
                                <div className="project-activity-item__header">
                                  <div className="project-activity-item__text">{describeProjectActivity(item)}</div>
                                  {status ? (
                                    <span className={`project-activity-badge is-${status.tone}`}>
                                      {status.label}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="project-note-meta">{formatDateTime(item.created_at)}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".bpmn,application/xml"
        style={{ display: "none" }}
        onChange={handleImportChange}
      />
    </div>
  );
}


