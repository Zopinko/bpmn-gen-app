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
  createOrg,
  getOrgInviteLink,
  loadOrgModel,
  listOrgModels,
  createOrgModelVersion,
  saveOrgModel,
  getProjectNotes,
  saveProjectNotes,
  addOrgMember,
  listOrgMembers,
  mentorReview,
  mentorApply,
} from "../api/wizard";
import {
  createOrgFolder,
  createOrgProcess,
  createOrgProcessFromOrgModel,
  getOrgModel,
  moveOrgNode,
  renameOrgNode,
  updateOrgProcessModelRef,
} from "../api/orgModel";
import { createDefaultProcessStoryOptions, generateProcessStory } from "../processStory/generateProcessStory";
import { createRelayoutScheduler } from "./linearWizard/relayoutScheduler";
import { applyIncrementalAppend } from "./linearWizard/incrementalAppend";

const HELP_RULES = [
  {
    id: "task",
    title: "Bezny krok (Task)",
    description: "Zvycajna aktivita v procese, ktoru vykona rola alebo system.",
    iconClass: "bpmn-icon-task",
    syntax: "Lubovolny text na riadok",
    example: "Overime identitu zakaznika",
    template: "<krok>",
    fields: [{ key: "krok", label: "Vlastny text", token: "krok", placeholder: "napr. over identitu" }],
  },
  {
    id: "xor",
    title: "Rozhodnutie (XOR gateway)",
    description: "Rozhodovaci bod s presne jednou vybranou vetvou.",
    iconClass: "bpmn-icon-gateway-xor",
    syntax: "Ak/Keď/Ked <podmienka> tak <krok>, inak <krok/koniec>",
    example: "Ak zakaznik schvali ponuku tak priprav zmluvu, inak koniec",
    template: "Ak <podmienka> tak <krok>, inak <inak>",
    fields: [
      { key: "podmienka", label: "Podmienka", token: "podmienka", placeholder: "napr. zakaznik schvali ponuku" },
      { key: "krok", label: "Krok (tak)", token: "krok", placeholder: "napr. priprav zmluvu" },
      { key: "inak", label: "Krok/koniec (inak)", token: "inak", placeholder: "napr. koniec" },
    ],
  },
  {
    id: "and_strict",
    title: "Paralelne kroky (AND) - presny zapis",
    description: "Viac krokov prebieha naraz (paralelne).",
    iconClass: "bpmn-icon-gateway-parallel",
    syntax: "Paralelne: <krok>; <krok>; <krok>",
    example: "Paralelne: priprav zmluvu; over identitu; nastav splatky",
    template: "Paralelne: <krok1>; <krok2>; <krok3>",
    fields: [
      { key: "krok1", label: "Krok 1", token: "krok1", placeholder: "napr. priprav zmluvu" },
      { key: "krok2", label: "Krok 2", token: "krok2", placeholder: "napr. over identitu" },
      { key: "krok3", label: "Krok 3", token: "krok3", placeholder: "napr. nastav splatky" },
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

const isPlaceholderNodeName = (value) => {
  const normalized = normalizeText(value).trim();
  return PLACEHOLDER_NODE_NAMES.has(normalized);
};

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
  const hardFindings = findings.filter((f) => f?.severity === "HARD");
  if (hardFindings.length) {
    const hardInCtx = ctxLaneId
      ? hardFindings.find(
          (f) => getLaneIdForFinding(f, index) === ctxLaneId,
        )
      : null;
    const chosen = hardInCtx || hardFindings[0];
    const laneIdForHard = getLaneIdForFinding(chosen, index);
    const hardMessage = (() => {
      const ruleId = normalizeGuideRuleId(chosen);
      const rawMessage = String(chosen?.message || "");
      const rawProposal = String(chosen?.proposal || "");
      const combined = `${rawMessage} ${rawProposal}`.toLowerCase();
      const isGatewaySingleOutgoing =
        ruleId === "gateway_diverging_needs_two_outgoing" ||
        (combined.includes("diverging gateway") && combined.includes("outgoing"));
      if (isGatewaySingleOutgoing) {
        return (
          "Rozhodovací krok sa musí rozdeliť. " +
          "Z tohto bodu zatiaľ vedie len jedna šípka. " +
          "Pridaj ešte jednu možnosť (napr. „Áno / Nie“), " +
          "alebo tento krok odstráň, ak sa proces nerozdeľuje."
        );
      }
      return `Tu je malá nezrovnalosť: ${chosen.message}${chosen.proposal ? ` ${chosen.proposal}` : ""}. Mrkni na túto rolu a uprav to priamo tam.`;
    })();
    return {
      key: `hard:${chosen.id}`,
      scope: laneIdForHard ? "lane" : "global",
      laneId: laneIdForHard || null,
      title: "Poďme to doladiť",
      message: hardMessage,
      primary: laneIdForHard
        ? { label: "Do roly", action: "OPEN_LANE", payload: { laneId: laneIdForHard } }
        : null,
      secondary: { label: "Neskôr", action: "NOT_NOW" },
    };
  }

  const hasEmptyLane = index.lanes.some(
    (lane) => getLaneTasks(engineJson, lane.id).length === 0,
  );
  if (!hasEmptyLane) {
    const { incoming, outgoing } = buildFlowAdjacency(index);
    const taskNodes = index.nodes.filter((n) => isTaskLike(n));
    const hasEndEvent = index.nodes.some((n) =>
      String(n?.type || "").toLowerCase().includes("end"),
    );
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
        ? danglingNodes.find((n) => String(n?.laneId || "") === ctxLaneId) ||
          danglingNodes[0]
        : danglingNodes[0];
      if (pickNode) {
        const laneId = pickNode?.laneId ? String(pickNode.laneId) : null;
        const label = getNodeLabel(pickNode);
        return {
          key: `missing_end:${pickNode.id}`,
          scope: laneId ? "lane" : "global",
          laneId,
          title: "Chýba koniec",
          message:
            "Chýba nám koniec procesu. Kam to má celé dopadnúť? " +
            "Klikni na posledný krok a daj „Koniec sem“ — nech je proces uzavretý.",
          primary: {
            label: "Na mape",
            action: "FOCUS_NODE",
            payload: { nodeId: pickNode.id, laneId },
          },
          secondary: { label: "Neskôr", action: "NOT_NOW" },
          tertiary: {
            label: "Koniec sem",
            action: "CONNECT_END_HERE",
            payload: { nodeId: pickNode.id },
          },
        };
      }
    }
    const pickTask = (predicate) => {
      if (!taskNodes.length) return null;
      if (ctxLaneId) {
        const inCtx = taskNodes.find(
          (node) => String(node?.laneId || "") === ctxLaneId && predicate(node),
        );
        if (inCtx) return inCtx;
      }
      return taskNodes.find(predicate) || null;
    };
    const missingOutgoingTask = pickTask((node) => {
      const id = node?.id ? String(node.id) : "";
      return id && (outgoing.get(id) || 0) === 0;
    });
    if (missingOutgoingTask) {
      const laneId = missingOutgoingTask?.laneId
        ? String(missingOutgoingTask.laneId)
        : null;
      const label = getNodeLabel(missingOutgoingTask);
      return {
        key: `task_no_out:${missingOutgoingTask.id}`,
        scope: laneId ? "lane" : "global",
        laneId,
        title: "Kam ďalej?",
        message: `Aktivita „${label || "tento krok"}“ nemá pokračovanie. Na mape klikni na krok → Prepojiť (Connect) → potiahni šípku na ďalší krok.`,
        primary: {
          label: "Na mape",
          action: "FOCUS_NODE",
          payload: { nodeId: missingOutgoingTask.id, laneId, nodeName: label || "" },
        },
        secondary: { label: "Neskôr", action: "NOT_NOW" },
        tertiary: {
          label: "Koniec sem",
          action: "CONNECT_END_HERE",
          payload: { nodeId: missingOutgoingTask.id },
        },
      };
    }
    const missingIncomingTask = pickTask((node) => {
      const id = node?.id ? String(node.id) : "";
      return id && (incoming.get(id) || 0) === 0;
    });
    if (missingIncomingTask) {
      const laneId = missingIncomingTask?.laneId
        ? String(missingIncomingTask.laneId)
        : null;
      const label = getNodeLabel(missingIncomingTask);
      return {
        key: `task_no_in:${missingIncomingTask.id}`,
        scope: laneId ? "lane" : "global",
        laneId,
        title: "Odkiaľ to prichádza?",
        message: `Aktivita „${label || "tento krok"}“ nemá predchodcu. Na mape klikni na krok pred tým → Prepojiť (Connect) → potiahni šípku sem.`,
        primary: {
          label: "Na mape",
          action: "FOCUS_NODE",
          payload: { nodeId: missingIncomingTask.id, laneId, nodeName: label || "" },
        },
        secondary: { label: "Neskôr", action: "NOT_NOW" },
      };
    }
  }

  const getLaneTaskCount = (laneId) => {
    if (modelSnapshot?.tasksPerLane instanceof Map) {
      return modelSnapshot.tasksPerLane.get(String(laneId || "")) || 0;
    }
    return getLaneTasks(engineJson, laneId).length;
  };
  const tasks = index.nodes.filter((n) => isTaskLike(n));
  if (!tasks.length && index.lanes.length) {
    const firstEmptyLane = index.lanes.find((lane) => getLaneTaskCount(lane.id) === 0) || null;
    if (!firstEmptyLane) return null;
    return {
      key: "process_empty",
      scope: "global",
      title: "Pridajme prvé kroky",
      message:
        "Super — kostra je hotová ✅ Role už sú pripravené. Teraz spolu dopíšeme do každej roly 2–3 kroky (každý na nový riadok). Z toho spravím aktivity a potom to pospájame do logiky. Tip: píš slovesom — Overím…, Skontrolujem…, Odošlem…",
      primary: firstEmptyLane
        ? { label: "Začať s rolou", action: "OPEN_LANE", payload: { laneId: firstEmptyLane.id } }
        : null,
      secondary: { label: "Neskôr", action: "NOT_NOW" },
    };
  }

  if (ctxLaneId && ctxLane) {
    const laneFindings = findings.filter(
      (f) => getLaneIdForFinding(f, index) === ctxLaneId,
    );
    const laneDone = isLaneDone(engineJson, ctxLaneId, laneFindings);
    const nextLane =
      index.lanes.find((lane) => lane.id !== ctxLaneId && getLaneTaskCount(lane.id) === 0) ||
      pickNextLane(engineJson, findings);
    if (laneDone && nextLane && nextLane.id !== ctxLaneId) {
      return {
        key: `lane_done:${ctxLaneId}->${nextLane.id}`,
        scope: "lane",
        laneId: ctxLaneId,
      title: "Ďalšia rola",
      message: `Paráda — rola „${ctxLane.name || ctxLane.id}“ vyzerá hotová ✅ Poďme ďalej na „${nextLane.name || nextLane.id}“. Potom spravíme prepojenia a budeš mať plynulý proces.`,
      primary: { label: "Pokračovať na ďalšiu rolu", action: "OPEN_LANE", payload: { laneId: nextLane.id } },
      secondary: { label: "Neskôr", action: "NOT_NOW" },
      };
    }
  }

  const emptyLaneFinding = findings.find(
    (f) => normalizeGuideRuleId(f) === "lane_is_empty",
  );
  if (emptyLaneFinding) {
    const laneId = emptyLaneFinding?.target?.id;
    const lane = index.lanes.find((l) => l?.id === laneId);
    if (lane) {
      return {
        key: `lane_empty:${lane.id}`,
        scope: "lane",
        laneId: lane.id,
        title: "Doplň rolu",
        message: `Táto rola je zatiaľ prázdna. Skús napísať aspoň jeden krok, aby sme vedeli, čo tu prebieha.`,
        primary: { label: "Do roly", action: "OPEN_LANE", payload: { laneId: lane.id } },
        secondary: { label: "Neskôr", action: "NOT_NOW" },
      };
    }
  }

  const disconnectedFinding = findings.find(
    (f) => normalizeGuideRuleId(f) === "lane_is_disconnected",
  );
  if (disconnectedFinding) {
    return {
      key: "lanes_disconnected",
      scope: "global",
      title: "Prepojme role",
      message:
        "Kroky už máme 👍 Teraz z toho spravíme plynulý proces: prepoj aktivity tak, aby to tieklo od začiatku až po koniec (aj medzi rolami).",
      primary: { label: "Prepojiť kroky", action: "CONNECT_LANES_HEURISTIC" },
      secondary: { label: "Neskôr", action: "NOT_NOW" },
    };
  }

  const { incoming, outgoing } = buildFlowAdjacency(index);
  const hasEndEvent = index.nodes.some((n) =>
    String(n?.type || "").toLowerCase().includes("end"),
  );
  const taskNodes = index.nodes.filter((n) => isTaskLike(n));
  const hasDanglingTask = taskNodes.some((node) => {
    const id = node?.id ? String(node.id) : "";
    if (!id) return false;
    const hasIn = (incoming.get(id) || 0) > 0;
    const hasOut = (outgoing.get(id) || 0) > 0;
    return !hasIn || !hasOut;
  });
  const hasHardFindings = findings.some((f) => f?.severity === "HARD");
  const hasDisconnectedLanes =
    typeof modelSnapshot?.lanesDisconnected === "boolean"
      ? modelSnapshot.lanesDisconnected
      : findings.some((f) => normalizeGuideRuleId(f) === "lane_is_disconnected");
  const hasAnyEmptyLane = index.lanes.some((lane) => getLaneTaskCount(lane.id) === 0);
  const isFullyConsistent =
    !hasHardFindings &&
    hasEndEvent &&
    !hasDanglingTask &&
    !hasAnyEmptyLane &&
    !hasDisconnectedLanes;
  const isPersistedOrOrg =
    uiContext?.modelSourceKind === "org" || uiContext?.hasUnsavedChanges === false;

  if (isFullyConsistent) {
    const renamableNodes = index.nodes.filter((node) => {
      const type = String(node?.type || "").toLowerCase();
      if (!(type.includes("task") || type.includes("gateway") || type.includes("start") || type.includes("end"))) {
        return false;
      }
      return isPlaceholderNodeName(node?.name || "");
    });
    if (renamableNodes.length) {
      const pickNode = ctxLaneId
        ? renamableNodes.find((node) => String(node?.laneId || "") === String(ctxLaneId)) || renamableNodes[0]
        : renamableNodes[0];
      const laneId = pickNode?.laneId ? String(pickNode.laneId) : null;
      return {
        key: `unnamed_node:${pickNode?.id || "any"}`,
        scope: laneId ? "lane" : "global",
        laneId,
        title: "Pomenujme kroky",
        message:
          "Vyzerá to hotovo ✅ Ešte mrkni na názvy krokov — nech tam neostanú všeobecné názvy ako „Procesný krok“ alebo „Nové rozhodnutie“. Premenuj ich tak, aby bolo hneď jasné, čo sa v procese deje.",
        primary: pickNode?.id
          ? { label: "Na mape", action: "FOCUS_NODE", payload: { nodeId: pickNode.id, laneId } }
          : null,
        secondary: { label: "Neskôr", action: "NOT_NOW" },
      };
    }
  }

  if (isFullyConsistent && !isPersistedOrOrg) {
    return {
      key: "process_ready_for_save",
      scope: "global",
      title: "Pripravené na uloženie",
      message:
        "Výborne — proces je konzistentný a pripravený ✅ Môžeš ho teraz uložiť alebo pokračovať v úpravách.",
      primary: { label: "Uložiť proces", action: "SAVE_PROCESS" },
      secondary: { label: "Neskôr", action: "NOT_NOW" },
    };
  }

  if (isFullyConsistent && isPersistedOrOrg) {
    return {
      key: "process_complete",
      scope: "global",
      title: "Proces je hotový",
      message:
        "Perfektné 👏 Proces je hotový. Môžeme ho nechať v pieskovisku alebo ho presunúť do organizačnej štruktúry.",
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
    text.startsWith("zároveň") ||
    text.startsWith("subezne") ||
    text.startsWith("súbežne") ||
    text.startsWith("paralelne") ||
    text.startsWith("naraz") ||
    text.startsWith("popri tom") ||
    text.startsWith("popritom") ||
    text.includes(" zaroven ") ||
    text.includes(" zároveň ") ||
    text.includes(" subezne ") ||
    text.includes(" súbežne ") ||
    text.includes(" paralelne ") ||
    text.includes(" naraz ") ||
    text.includes(" popri tom ") ||
    text.includes(" popritom ")
  );
};

const countParallelSteps = (line) => {
  const raw = String(line || "").trim();
  if (!raw) return 0;
  const normalized = normalizeText(raw);
  const withoutPrefix = normalized
    .replace(/^paralelne\s*[:,-]?\s*/i, "")
    .replace(/^zaroven\s*[:,-]?\s*/i, "")
    .replace(/^zároveň\s*[:,-]?\s*/i, "")
    .replace(/^subezne\s*[:,-]?\s*/i, "")
    .replace(/^súbežne\s*[:,-]?\s*/i, "")
    .replace(/^naraz\s*[:,-]?\s*/i, "")
    .replace(/^popri tom\s*[:,-]?\s*/i, "")
    .replace(/^popritom\s*[:,-]?\s*/i, "");
  const parts = withoutPrefix.includes(";")
    ? withoutPrefix.split(";")
    : withoutPrefix.split(",");
  let steps = parts.map((p) => p.trim()).filter(Boolean);
  if (steps.length <= 1) {
    steps = withoutPrefix
      .split(/\s+(?:a|aj)\s+/i)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return steps.length;
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

const determineInlineHint = (lines) => {
  const lastLine = [...lines].reverse().find((line) => line.trim());
  if (!lastLine) return null;
  const normalized = normalizeText(lastLine);
  if (detectDecision(lastLine)) {
    const message = normalized.includes(" inak ")
      ? "Rozhodnutie rozpoznané. Ak chceš, vlož vzor."
      : "Vyzerá to na rozhodnutie. Doplň vetvu INAK.";
    return { message, templateType: "decision" };
  }
  if (detectParallel(lastLine)) {
    const message =
      countParallelSteps(lastLine) < 2
        ? "Vyzerá to na paralelu. Pridaj aspoň 2 kroky a oddeľ ich , ; alebo „a“."
        : "Paralela rozpoznaná. Ak chceš, vlož vzor.";
    return { message, templateType: "parallel" };
  }
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
    let stepCount = 0;
    if (ascii.startsWith("paralelne")) {
      stepCount = parts
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean).length;
    } else {
      stepCount = parts
        .split(/,|\ba\b/)
        .map((part) => part.trim())
        .filter(Boolean).length;
    }
    const warning = stepCount < 2 ? "Pridaj aspoň 2 kroky (oddeľ ich ;, , alebo slovom „a“)." : "";
    return {
      type: "and",
      badge: "PARALELNE",
      hint: "Paralela: „Paralelne: krok; krok; krok“ alebo „Zároveň krok, krok a krok“.",
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

const analyzeLaneLines = (text) =>
  (text || "")
    .split(/\r?\n/)
    .map((line, idx) => {
      const analysis = analyzeLaneLine(line);
      if (!analysis) return null;
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

export default function LinearWizardPage() {
  const navigate = useNavigate();
  const { modelId: routeModelId } = useParams();
  const fileInputRef = useRef(null);
  const { setState: setHeaderStepperState } = useHeaderStepper();
  const [processCard, setProcessCard] = useState(() => createEmptyProcessCardState());
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
  const [laneInsertType, setLaneInsertType] = useState("task");
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
  const [orgsModalOpen, setOrgsModalOpen] = useState(false);
  const [myOrgs, setMyOrgs] = useState([]);
  const [myOrgsLoading, setMyOrgsLoading] = useState(false);
  const [myOrgsError, setMyOrgsError] = useState(null);
  const [activeOrgId, setActiveOrgId] = useState(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("ACTIVE_ORG_ID");
  });
  const [activeOrgName, setActiveOrgName] = useState("");
  const [activeOrgRole, setActiveOrgRole] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [addMemberEmail, setAddMemberEmail] = useState("");
  const [addMemberOrgId, setAddMemberOrgId] = useState("");
  const [addMemberRole, setAddMemberRole] = useState("owner");
  const [addMemberLoading, setAddMemberLoading] = useState(false);
  const [addMemberError, setAddMemberError] = useState(null);
  const [addMemberInfo, setAddMemberInfo] = useState(null);
  const [inviteOrgId, setInviteOrgId] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [orgMembersOpen, setOrgMembersOpen] = useState(false);
  const [orgMembers, setOrgMembers] = useState([]);
  const [orgMembersLoading, setOrgMembersLoading] = useState(false);
  const [orgMembersError, setOrgMembersError] = useState(null);
  const [railSections, setRailSections] = useState({
    org: true,
    process: true,
    mentor: false,
    save: false,
    env: false,
    project: false,
  });
  const [guideEnabled, setGuideEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("GUIDE_ENABLED");
    if (stored === null) return true;
    return stored === "true";
  });
  const [guideState, setGuideState] = useState(null);
  const [guideFindings, setGuideFindings] = useState([]);
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
  const [storyOptions, setStoryOptions] = useState(() => createDefaultProcessStoryOptions());
  const [storyDoc, setStoryDoc] = useState(null);
  const [storyStale, setStoryStale] = useState(false);
  const [storyGeneratedAt, setStoryGeneratedAt] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
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
  const [orgMoveModalOpen, setOrgMoveModalOpen] = useState(false);
  const [orgMoveNode, setOrgMoveNode] = useState(null);
  const [orgMoveTargetFolderId, setOrgMoveTargetFolderId] = useState("root");
  const [orgMoveCurrentParentId, setOrgMoveCurrentParentId] = useState("root");
  const [orgMoveLoading, setOrgMoveLoading] = useState(false);
  const [orgMoveError, setOrgMoveError] = useState(null);
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
  const [sidebarWidth, setSidebarWidth] = useState(640);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [processPanelHeight, setProcessPanelHeight] = useState(620);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const [mentorNotes, setMentorNotes] = useState([]);
  const [mentorDoneIds, setMentorDoneIds] = useState([]);
  const [mentorAppliedIds, setMentorAppliedIds] = useState([]);
  const [mentorLoading, setMentorLoading] = useState(false);
  const [mentorError, setMentorError] = useState(null);
  const [mentorApplyingId, setMentorApplyingId] = useState(null);
  const [mentorStatus, setMentorStatus] = useState(null);
  const [mentorStale, setMentorStale] = useState(false);
  const [mentorLastRunAt, setMentorLastRunAt] = useState(null);
  const mentorHighlightRef = useRef(null);
  const mentorReviewedEngineRef = useRef(null);
  const storyEngineRef = useRef(null);
  const guidePatchTimerRef = useRef(null);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const pendingOpenActionRef = useRef(null);
  const pendingOpenResolveRef = useRef(null);
  const pendingOpenCancelRef = useRef(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [previewVersionTag, setPreviewVersionTag] = useState("");
  const [projectNotes, setProjectNotes] = useState([]);
  const [projectNotesLoading, setProjectNotesLoading] = useState(false);
  const [projectNotesSaving, setProjectNotesSaving] = useState(false);
  const [projectNotesError, setProjectNotesError] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyOpenById, setReplyOpenById] = useState({});

  const [replyEditing, setReplyEditing] = useState({ noteId: null, replyId: null, text: "" });
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [lastExportedAt, setLastExportedAt] = useState(null);

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
  const [helpActiveRuleId, setHelpActiveRuleId] = useState(null);
  const [helpMode, setHelpMode] = useState("inline");
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
  const logRenderMode = (mode, reason) => {
    if (!window.__BPMNGEN_DEBUG_RENDER) return;
    // eslint-disable-next-line no-console
    console.log("[render]", mode, reason || "");
  };

  const setXmlFull = (nextXml, reason = "") => {
    renderModeRef.current = "full";
    logRenderMode("full", reason);
    setXml(nextXml);
  };

  const markIncremental = (reason = "") => {
    renderModeRef.current = "incremental";
    logRenderMode("incremental", reason);
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
  };

  const applyLaneTemplate = (template) => {
    if (!template) return;
    setLaneDescription(template.text || "");
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

  const openSingleCard = (cardKey) => {
    setOrgOpen(cardKey === "org");
    setDrawerOpen(cardKey === "drawer");
    setHelpOpen(cardKey === "help");
    setStoryOpen(cardKey === "story");
    setMentorOpen(cardKey === "mentor");
    setLaneOpen(cardKey === "lane");
  };
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("GUIDE_ENABLED", guideEnabled ? "true" : "false");
    if (!guideEnabled) {
      setGuideState(null);
    }
  }, [guideEnabled]);

  const normalizeNodeId = (node) => node?.id || node?.nodeId || node?.refId || null;
  const normalizeFlowSource = (flow) => flow?.source || flow?.sourceRef || flow?.from || null;
  const normalizeFlowTarget = (flow) => flow?.target || flow?.targetRef || flow?.to || null;

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
        lanes: lanes.map(({ _el, ...lane }) => lane),
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
      // eslint-disable-next-line no-console
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
        // eslint-disable-next-line no-console
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
      const runModelVersion = modelVersionRef.current;
      guideLastReasonRef.current = reason;
      const modelSnapshot = collectGuideModelSnapshot();
      const guideEngine = modelSnapshot?.engine || engineJson;
      const generator = processCard?.generatorInput || {};
      const hasEngineModel =
        Boolean((guideEngine?.name || guideEngine?.processName || "").trim()) ||
        (Array.isArray(guideEngine?.lanes) && guideEngine.lanes.length > 0) ||
        (Array.isArray(guideEngine?.nodes) && guideEngine.nodes.length > 0);
      const hasProcessCard =
        (Boolean((generator.processName || "").trim()) && Boolean((generator.roles || "").trim())) ||
        hasEngineModel;
      if (!hasProcessCard && !hasEngineModel) {
        setGuideState({
          key: "process_card",
          scope: "global",
          title: "Začíname spolu",
          message:
            "Najprv si nastavíme základ. Daj procesu názov a pridaj roly (každú na nový riadok). Keď budeš pripravený, vytvoríme model.",
          primary: { label: "Do karty", action: "OPEN_PROCESS_CARD" },
          secondary: { label: "Neskôr", action: "NOT_NOW" },
        });
        return;
      }
      if (!guideEngine) {
        setGuideState(null);
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
          // eslint-disable-next-line no-console
          console.log("[guide:oversize] skipped (dismissed)");
        }
      }
    },
    [
      guideEnabled,
      processCard,
      engineJson,
      laneDescription,
      applyGuideFromFindings,
      collectGuideModelSnapshot,
      detectLayoutOversizeCard,
    ],
  );

  useEffect(() => {
    if (!guideEnabled) return;
    if (!guideState || guideState.key !== "process_card") return;
    const generator = processCard?.generatorInput || {};
    const hasEngineModel =
      Boolean((engineJson?.name || engineJson?.processName || "").trim()) ||
      (Array.isArray(engineJson?.lanes) && engineJson.lanes.length > 0) ||
      (Array.isArray(engineJson?.nodes) && engineJson.nodes.length > 0);
    const hasProcessCard =
      (Boolean((generator.processName || "").trim()) && Boolean((generator.roles || "").trim())) ||
      hasEngineModel;
    if (hasProcessCard || hasEngineModel) {
      const key = [
        engineJson?.processId || "",
        engineJson?.name || engineJson?.processName || "",
        Array.isArray(engineJson?.nodes) ? engineJson.nodes.length : 0,
        Array.isArray(engineJson?.flows) ? engineJson.flows.length : 0,
        Array.isArray(engineJson?.lanes) ? engineJson.lanes.length : 0,
        (generator.processName || "").trim(),
        (generator.roles || "").trim(),
      ].join("|");
      if (guideModelLoadedKeyRef.current === key) return;
      guideModelLoadedKeyRef.current = key;
      setGuideState(null);
      runGuideReview("model_loaded");
    }
  }, [guideEnabled, guideState, engineJson, processCard, runGuideReview]);

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
      setModelsOpen(true);
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
      const selection = modeler.get("selection");
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
          const endW = endShape.width || 0;
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

  useEffect(() => {
    if (!guideEnabled) return;
    if (!engineJson && !guideState) {
      runGuideReview("initial");
    }
  }, [guideEnabled, engineJson, guideState, runGuideReview]);

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
    // eslint-disable-next-line no-console
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

  const prevLaneOpenRef = useRef(laneOpen);
  const lastActiveLaneIdRef = useRef(null);

  useEffect(() => {
    if (laneOpen && selectedLane?.id) {
      setActiveLaneId(selectedLane.id);
      lastActiveLaneIdRef.current = selectedLane.id;
      return;
    }
    if (!laneOpen) {
      setActiveLaneId(null);
    }
  }, [laneOpen, selectedLane]);

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
      const laneElement = elementRegistry.get(selectedLane.id);
      if (laneElement?.businessObject?.$type === "bpmn:Lane") {
        canvas.addMarker(laneElement.id, "lane-selected");
      }
    }
  }, [selectedLane, modelVersion]);

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

  const updateStoryOption = (key, value) =>
    setStoryOptions((prev) => {
      const next = { ...prev, [key]: value };
      if (storyOpen && engineJson) {
        const doc = generateProcessStory(engineJson, next);
        setStoryDoc(doc);
        setStoryGeneratedAt(new Date().toISOString());
        setStoryStale(false);
        storyEngineRef.current = engineJson;
      }
      return next;
    });

  const regenerateStory = useCallback(() => {
    if (!engineJson) {
      setStoryDoc(null);
      setStoryGeneratedAt(null);
      setStoryStale(false);
      storyEngineRef.current = null;
      return;
    }
    const doc = generateProcessStory(engineJson, storyOptions);
    setStoryDoc(doc);
    setStoryGeneratedAt(new Date().toISOString());
    setStoryStale(false);
    storyEngineRef.current = engineJson;
  }, [engineJson, storyOptions]);

  useEffect(() => {
    if (storyOpen && engineJson && !storyDoc) {
      regenerateStory();
    }
  }, [engineJson, regenerateStory, storyDoc, storyOpen]);

  useEffect(() => {
    if (!engineJson || startOptions.length === 0) return;
    const selected = storyOptions.selectedStartId;
    const exists = startOptions.some((opt) => opt.id === selected);
    if (!exists) {
      setStoryOptions((prev) => ({
        ...prev,
        selectedStartId: startOptions[0].id,
      }));
    }
  }, [engineJson, startOptions, storyOptions.selectedStartId]);

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

  const buildStoryText = (doc) => {
    if (!doc) return "";
    const lines = [];
    if (doc.summary?.length) {
      lines.push("Kratke zhrnutie");
      doc.summary.forEach((line) => lines.push(line));
      lines.push("");
    }
    if (doc.mainFlow?.length) {
      lines.push("Hlavny priebeh");
      doc.mainFlow.forEach((line, idx) => lines.push(`${idx + 1}. ${line.text}`));
      lines.push("");
    }
    if (doc.decisions?.length) {
      doc.decisions.forEach((decision) => {
        lines.push(decision.title);
        (decision.branches || []).forEach((branch) => {
          lines.push(`  ${branch.intro}`);
          (branch.steps || []).forEach((step) => lines.push(`    ${step.text}`));
        });
      });
      lines.push("");
    }
    if (doc.parallels?.length) {
      lines.push("Paralely");
      doc.parallels.forEach((parallel) => {
        lines.push(parallel.title);
        (parallel.branches || []).forEach((branch) => {
          lines.push(`- ${branch.label}`);
          (branch.steps || []).forEach((step) => lines.push(`  - ${step.text}`));
          if (branch.truncated) lines.push("  - ...");
        });
        if (parallel.outro) lines.push(parallel.outro);
      });
      lines.push("");
    }
    if (doc.notes?.length) {
      lines.push("Poznamky");
      doc.notes.forEach((note) => lines.push(`- ${note.text}`));
    }
    return lines.join("\n").trim();
  };

  const formatDecisionStepText = (value) => {
    const raw = String(value || "").trim().replace(/^\s*-\s*/, "");
    if (!raw) return "";
    const match = raw.match(/^\(Nasleduje rozhodnutie\)\s+(.+)$/);
    if (match) {
      const name = match[1].trim();
      return `V tejto vetve sa nasledne rozhoduje, ci ${name}.`;
    }
    return raw;
  };

  const buildBranchParagraph = (branch) => {
    const label = String(branch?.label || "").trim() || "moznost";
    const steps = (branch?.steps || [])
      .map((step) => formatDecisionStepText(step?.text))
      .filter(Boolean);
    if (!steps.length) {
      return `Ak ${label}, potom pokracuje dalsia cast procesu.`;
    }
    return `Ak ${label}, potom ${steps.join(" ")}`;
  };

  const handleCopyStory = async () => {
    const text = buildStoryText(storyDoc);
    if (!text) {
      window.alert("Nie je co kopirovat.");
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        window.prompt("Skopiruj text:", text);
      }
    } catch (err) {
      window.prompt("Skopiruj text:", text);
    }
  };

  const updateGeneratorInput = (field, value) => {
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

  const updateLaneDescription = (value) => {
    setLaneDescription(value);
    setHasUnsavedChanges(true);
  };

  const appendLine = (current, text) => {
    const base = (current || "").trimEnd();
    return base ? `${base}\n${text}` : text;
  };

  const insertHelpExample = (text) => {
    const snippet = String(text || "").trim();
    if (!snippet) return;
    setLaneDescription((prev) => {
      const current = String(prev || "");
      if (!current.trim()) return snippet;
      return `${current.trimEnd()}\n${snippet}`;
    });
    setHasUnsavedChanges(true);
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
    let output = rule.template;
    const values = helpInputs[rule.id] || {};
    (rule.fields || []).forEach((field) => {
      const value = (values[field.key] || "").trim();
      output = output.replace(`<${field.token}>`, value || `<${field.token}>`);
    });
    return output;
  };

  const buildHelpTemplateSegments = (rule) => {
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
                ? "Paralelne"
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
                      </label>
                    ))}
                  </div>
                ) : null}
                <div className="wizard-help-syntax-wrap">
                  <span className="wizard-help-code-label">Syntax</span>
                  <code className="wizard-help-syntax">{rule.syntax}</code>
                </div>
                <div className="wizard-help-acc-actions">
                  <button
                    type="button"
                    className="btn btn--small btn-primary wizard-help-insert-btn"
                    onClick={() => insertHelpExample(buildHelpTemplate(rule))}
                  >
                    Vložiť príklad
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
                    Upraviť v poli
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

  const clearHelpInputs = (rule) => {
    setHelpInputs((prev) => ({
      ...prev,
      [rule.id]: (rule.fields || []).reduce((acc, field) => {
        acc[field.key] = "";
        return acc;
      }, {}),
    }));
  };

  const activateHelpRule = (rule) => {
    setHelpActiveRuleId(rule.id);
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
    if (notesOpen) {
      void fetchProjectNotes();
    }
  }, [notesOpen]);

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
    historyRef.current = [];
    setHistoryCount(0);
  };

  const handleNewModel = (options = {}) => {
    const hasWork = Boolean(engineJson || xml || hasUnsavedChanges);
    if (hasWork && !options.skipConfirm) {
      const confirmed = window.confirm("Začať nový model? Neuložené zmeny sa stratia.");
      if (!confirmed) return;
    }
    resetWizardState();
    setHelpOpen(false);
    setMentorOpen(false);
    setStoryOpen(false);
    setOrgOpen(false);
    setLaneOpen(false);
    setDrawerOpen(true);
  };

  const handleStartNewModel = () => handleNewModel({ skipConfirm: true });

  const handleMainMenu = () => {
    requestOpenWithSave(() => {
      resetWizardState();
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

  const moveLane = async (laneId, direction) => {
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
    if (isReadOnlyMode) {
      setInfo("Rezim: len na citanie. Najprv klikni Upravit.");
      return;
    }
    setError(null);
    setInfo(null);
    if (engineJson) {
      const proceed = window.confirm(
        "Model uz mas vytvoreny. Chces ho naozaj vygenerovat znova?",
      );
      if (!proceed) {
        return;
      }
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
      setEngineJson(null);
      setXmlFull("", "handleGenerate:clear");
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
      replies: Array.isArray(note.replies) ? note.replies : [],
    };
  };

  const fetchProjectNotes = async () => {
    setProjectNotesLoading(true);
    setProjectNotesError(null);
    try {
      const resp = await getProjectNotes();
      const incoming = Array.isArray(resp?.notes) ? resp.notes.map(normalizeNote) : [];
      setProjectNotes(incoming);
      setEditingNoteId(null);
      setEditingNoteText("");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa nacitat poznamky.";
      setProjectNotesError(message);
    } finally {
      setProjectNotesLoading(false);
    }
  };

  const persistProjectNotes = async (nextNotes) => {
    const normalized = (nextNotes || []).map(normalizeNote);
    setProjectNotes(normalized);
    setProjectNotesSaving(true);
    setProjectNotesError(null);
    try {
      const resp = await saveProjectNotes(normalized);
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
    const laneElement = elementRegistry?.get(selectedLane.id);
    const processParent = getProcessParent(elementRegistry);

    if (!laneElement || !modeling || !elementFactory || !processParent) {
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
    const lastCreatedElement = getLastCreatedElement(elementRegistry, engineJson);
    const globalRightmost =
      typeof lastCreatedElement?.x === "number"
        ? lastCreatedElement.x
        : computeGlobalRightmost(elementRegistry);

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

    const createdSplit = modeling.createShape(splitShape, splitPos, processParent);
    const createdTaskA = modeling.createShape(taskA, { x: taskX, y: taskATop }, processParent);
    const createdTaskB = modeling.createShape(taskB, { x: taskX, y: taskBTop }, processParent);
    const createdJoin = modeling.createShape(joinShape, { x: joinX, y: joinY }, processParent);

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

    selection?.select(createdJoin);
    if (typeof canvas?.scrollToElement === "function") {
      canvas.scrollToElement(createdJoin);
    }

    scheduleRelayoutKick("insert_block", 150);

    setError(null);
  };

  const isReadOnlyMode = modelSource?.kind === "org" && orgReadOnly;

  const handleEnableOrgEdit_unused2 = () => {
    if (modelSource?.kind !== "org") return;
    if (activeOrgRole !== "owner") {
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
  const canCreateLaneShape =
    Boolean(selectedLane) &&
    activeLaneShape &&
    (!activeLaneShape.nameRequired || laneInsertName.trim());

  const updateLaneInsertName = (value) => {
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

  const computeGlobalRightmost = (elementRegistry) => {
    if (!elementRegistry) return null;
    const allNodes = elementRegistry.getAll().filter((el) => {
      if (!el || el.type === "label") return false;
      const bo = el.businessObject;
      return Boolean(bo?.$instanceOf?.("bpmn:FlowNode"));
    });
    if (!allNodes.length) return null;
    return allNodes.reduce((max, node) => Math.max(max, node.x || 0), 0);
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

  const getPreviewShapeSize = (type) => {
    if (type === "xor" || type === "and") {
      return { width: 220, height: 110 };
    }
    return { width: 160, height: 68 };
  };

  const createPreviewNode = (item, size) => {
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

  const handleLaneShapeCreate = () => {
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
    const laneElement = elementRegistry?.get(selectedLane.id);
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
    const lastCreatedElement = getLastCreatedElement(elementRegistry, engineJson);
    const globalRightmost =
      typeof lastCreatedElement?.x === "number"
        ? lastCreatedElement.x
        : computeGlobalRightmost(elementRegistry);
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

    if (!selectedLane || !laneDescription.trim()) {
      clearLanePreviewOverlays();
      return undefined;
    }

    lanePreviewTimerRef.current = window.setTimeout(() => {
      const modeler = modelerRef.current;
      if (!modeler) return;
      const overlays = modeler.get("overlays");
      const elementRegistry = modeler.get("elementRegistry");
      if (!overlays || !elementRegistry) return;
      const laneElement = elementRegistry.get(selectedLane.id);
      if (!laneElement) {
        clearLanePreviewOverlays();
        return;
      }

      clearLanePreviewOverlays();

      const previewItems = analyzeLaneLines(laneDescription).slice(0, 6);
      if (!previewItems.length) return;

      const laneNodes = collectLaneFlowNodes(laneElement, elementRegistry);
      const orderedNodes = [...laneNodes].sort((a, b) => (a.x || 0) - (b.x || 0));
      const firstNode = orderedNodes[0] || null;
      const lastNode = orderedNodes[orderedNodes.length - 1] || null;
      const globalRightmost = computeGlobalRightmost(elementRegistry);

      const spacing = 36;
      let cursorX = null;
      let cursorY = null;
      let previousWidth = 0;

      let previewRightmost = null;
      previewItems.forEach((item) => {
        const size = getPreviewShapeSize(item.type);
        const base = computeLaneInsertPosition(
          laneElement,
          size,
          "end",
          firstNode,
          lastNode,
          globalRightmost,
        );
        if (cursorX === null) {
          cursorX = base.x;
          cursorY = base.y;
        } else {
          cursorX += previousWidth + spacing;
        }
        const x = cursorX;
        const y = cursorY ?? base.y;
        const html = createPreviewNode(item, size);
        const overlayId = overlays.add(laneElement, {
          position: { top: y - laneElement.y, left: x - laneElement.x },
          html,
        });
        lanePreviewOverlayIdsRef.current.push(overlayId);
        previousWidth = size.width;
        const rightEdge = x + size.width;
        previewRightmost = previewRightmost === null ? rightEdge : Math.max(previewRightmost, rightEdge);
      });

      if (previewRightmost !== null) {
        const canvas = modeler.get("canvas");
        const viewbox = canvas?.viewbox?.();
        if (viewbox) {
          const padding = 120;
          const visibleRight = viewbox.x + viewbox.width - padding;
          if (previewRightmost > visibleRight) {
            const next = { ...viewbox, x: previewRightmost - viewbox.width + padding };
            canvas.viewbox(next);
          }
        }
      }
    }, 350);

    return () => {
      if (lanePreviewTimerRef.current) {
        window.clearTimeout(lanePreviewTimerRef.current);
        lanePreviewTimerRef.current = null;
      }
    };
  }, [laneDescription, selectedLane, engineJson]);

  useEffect(() => () => clearLanePreviewOverlays(), []);

  const handleAppendToLane = async () => {
    if (isLoading || relayouting) return;
    if (isReadOnlyMode) {
      setInfo("Rezim: len na citanie. Najprv klikni Upravit.");
      return;
    }
    if (!selectedLane || !laneDescription.trim()) {
      setError("Vyber lane a doplň aspoň jednu aktivitu.");
      return;
    }
    cancelPendingRelayouts();
    clearLanePreviewOverlays();
    setIsLoading(true);
    setError(null);
    try {
      const currentEngine = engineJsonRef.current || engineJson;
      if (currentEngine && xml && !undoInProgressRef.current) {
        pushHistorySnapshot(currentEngine, xml);
      }
      const laneIds = new Set((currentEngine?.lanes || []).map((l) => String(l?.id)));
      const laneByName = new Map(
        (currentEngine?.lanes || []).map((l) => [String(l?.name || ""), String(l?.id || "")]),
      );
      let laneId = selectedLane.id;
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

      const incrementalResult = canPatchCanvas
        ? applyEngineDiffToCanvas(currentEngine, updatedEngine, modeler)
        : { ok: false, reason: "canvas_patch_unavailable", details: { canPatchCanvas } };

      if (incrementalResult?.ok) {
        setEngineJson(updatedEngine);
        setHasUnsavedChanges(true);
        setLaneDescription("");
        clearLanePreviewOverlays();
        bumpModelVersion();
        setIsLoading(false);
        return;
      }

      console.error("[append-lane] incremental append failed (non-exception)", {
        canPatchCanvas,
        result: incrementalResult,
      });
      const errorMessage = mapIncrementalReasonToMessage(incrementalResult?.reason);
      setError(errorMessage);
      return;
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
    if (!engineJson) {
      setError("Nie je čo uložiť – vygeneruj alebo naimportuj diagram.");
      return;
    }
    const canEditOrg = modelSource?.kind !== "org" || activeOrgRole === "owner";
    if (modelSource?.kind === "org" && !canEditOrg) {
      setInfo("Nemáš právo upravovať org model.");
      return;
    }
    if (modelSource?.kind === "org" && orgReadOnly) {
      setInfo("Rezim: len na citanie. Najprv klikni Upravit.");
      return;
    }
    setError(null);
    setInfo(null);
    setSaveLoading(true);
    try {
      if (!modelerRef.current?.saveXML) {
        throw new Error("Modeler nie je inicializovaný.");
      }
      if (typeof window !== "undefined" && window.__BPMNGEN_DEBUG_LAYOUT_STABILITY) {
        // eslint-disable-next-line no-console
        console.log("[layout-stability] save source", { source: "modeler.saveXML" });
        // eslint-disable-next-line no-console
        console.log(
          "[layout-stability] before save samples",
          sampleSequenceFlowWaypoints(modelerRef.current),
        );
      }
      const { xml: diagramXml } = await modelerRef.current.saveXML({ format: true });
      const payload = {
        name: deriveDefaultName(),
        engine_json: engineJson,
        diagram_xml: diagramXml,
        generator_input: processCard.generatorInput,
        process_meta: processCard.processMeta,
      };
      if (modelSource?.kind === "org") {
        const orgId = modelSource?.orgId;
        const treeNodeId = modelSource?.treeNodeId;
        if (!orgId) {
          throw new Error("Chyba: chyba org kontext.");
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
      } else {
        await saveWizardModel(payload);
      }
      setLastSavedAt(Date.now());
      setInfo("Model bol ulozeny.");
      setHasUnsavedChanges(false);
    } catch (e) {
      const message = e?.message || "Nepodarilo sa ulozit model.";
      setError(message);
    } finally {
      setSaveLoading(false);
    }
  };

  const insertLaneTemplate = useCallback((templateType) => {
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
      onLaneSelect: isReadOnlyMode ? undefined : setSelectedLane,
      onLaneOrderChange: reorderLanesByNames,
      onDiagramChange: handleDiagramChange,
      onUndo: handleUndo,
      canUndo: historyCount > 0,
      onSave: handleSaveModel,
      onMainMenu: handleMainMenu,
      saveDisabled: saveLoading || isReadOnlyMode,
      saveLabel: saveLoading ? "Ukladám..." : "Uložiť",
      onEngineJsonPatch: handleEngineJsonPatch,
      onInsertBlock: insertLaneBlock,
      onXmlImported: handleXmlImported,
      overlayMessage: relayouting ? "Zarovnávam layout…" : "",
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
      handleXmlImported,
      xml,
      modelSource,
      orgReadOnly,
      isReadOnlyMode,
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
      window.alert("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    const name = window.prompt("Nazov priecinka");
    if (!name || !name.trim()) return;
    try {
      const result = await createOrgFolder({ parentId: selectedOrgFolderId, name: name.trim() }, activeOrgId);
      setOrgTree(result?.tree || null);
      setExpandedOrgFolders((prev) => ({ ...prev, [selectedOrgFolderId]: true }));
    } catch (e) {
      window.alert(e?.message || "Nepodarilo sa vytvorit priecinok.");
    }
  };

  const handleCreateOrgProcess = async () => {
    if (!activeOrgId) {
      window.alert("Najprv si vyber alebo vytvor organizaciu.");
      return;
    }
    const name = window.prompt("Nazov procesu");
    if (!name || !name.trim()) return;
    try {
      const result = await createOrgProcess({ parentId: selectedOrgFolderId, name: name.trim() }, activeOrgId);
      setOrgTree(result?.tree || null);
      const modelId = result?.node?.processRef?.modelId;
      if (modelId) {
        requestOpenWithSave(() => {
          navigate(`/model/${modelId}`);
        });
      }
    } catch (e) {
      window.alert(e?.message || "Nepodarilo sa vytvorit proces.");
    }
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
    const parentInfo = findParentFolderInfo(orgTree, node.id);
    setOrgMenuNodeId(null);
    setOrgMoveNode(node);
    setOrgMoveCurrentParentId(parentInfo?.id || "root");
    setOrgMoveTargetFolderId(parentInfo?.id || "root");
    setOrgMoveError(null);
    setOrgMoveModalOpen(true);
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
      const processName = String(node.name || "").trim().toLowerCase();
      const filtered = allItems.filter((item) => {
        const name = String(item?.name || "").trim().toLowerCase();
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
    const treeNodeId = orgVersionsNode?.id || null;
    if (treeNodeId) {
      void loadOrgModelFromTree(modelId, treeNodeId, { preview: true, previewLabel: versionLabel });
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
    const newName = window.prompt("Novy nazov procesu", node.name || "");
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    setOrgMenuNodeId(null);
    try {
      const result = await renameOrgNode(node.id, trimmed, activeOrgId);
      setOrgTree(result?.tree || orgTree);
    } catch (e) {
      setOrgError(e?.message || "Nepodarilo sa premenovat proces.");
    }
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
      applyLoadedModel(resp, {
        source: { kind: "org", orgId: activeOrgId, modelId },
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
    const name = window.prompt("Nový názov procesu", orgPushConflictName || orgPushModel?.name || "");
    if (!name) return;
    setOrgPushConflictOpen(false);
    setOrgPushConflictMatches([]);
    setOrgPushConflictName("");
    setOrgPushConflictSelectedId(null);
    await executePushToOrg({ nameOverride: name.trim(), skipConflictCheck: false });
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
            {(node.children || []).map((child) => renderOrgTreeNode(child, depth + 1))}
          </div>
        </div>
      );
    }
    const modelId = node?.processRef?.modelId;
    const isActive = modelId && routeModelId && String(modelId) === String(routeModelId);
    const pulse = isActive && orgPulseTargetId === node.id;
    const status = getProcessStatus(modelId);
    const prefixDepth = Math.max(depth - 1, 0);
    const isMenuOpen = orgMenuNodeId === node.id;
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
            const confirmed = window.confirm("Chceš otvoriť tento proces?");
            if (!confirmed) return;
            requestOpenWithSave(() => {
              void openOrgProcessByNodeLatest(node.id);
            });
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
          <span className={`org-tree-label ${isActive ? "is-path" : ""}`}>{node.name}</span>
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
            <button type="button" className="org-tree-menu__item" onClick={() => handleRenameOrgProcess(node)}>
              Premenovat
            </button>
            <button type="button" className="org-tree-menu__item" onClick={() => void openOrgVersionsModal(node)}>
              Verzie
            </button>
            <button type="button" className="org-tree-menu__item" onClick={() => openMoveProcessModal(node)}>
              Presunut do...
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  useEffect(() => {
    if (!routeModelId) return;
    if (lastRouteModelIdRef.current === routeModelId) return;
    lastRouteModelIdRef.current = routeModelId;
    void doLoadModelById(routeModelId);
  }, [routeModelId]);

  useEffect(() => {
    if (!orgOpen) return;
    void refreshOrgTree(activeOrgId);
  }, [orgOpen, activeOrgId]);

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
    } else if (item.type === "process" && item.modelId) {
      requestOpenWithSave(() => {
        navigate(`/model/${item.modelId}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    void refreshMyOrgs(activeOrgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedInviteOrgRole = useMemo(() => {
    if (!inviteOrgId) return "";
    const org = myOrgs.find((item) => String(item.id) === String(inviteOrgId));
    return String(org?.role || "").toLowerCase();
  }, [inviteOrgId, myOrgs]);

  const hasAnyAdminOrg = useMemo(
    () => myOrgs.some((org) => ["owner", "admin"].includes(String(org?.role || "").toLowerCase())),
    [myOrgs],
  );
  const adminCapableOrgs = useMemo(
    () => myOrgs.filter((org) => ["owner", "admin"].includes(String(org?.role || "").toLowerCase())),
    [myOrgs],
  );

  const isActiveOrgAdmin = useMemo(
    () => ["owner", "admin"].includes(String(activeOrgRole || "").toLowerCase()),
    [activeOrgRole],
  );

  useEffect(() => {
    if (!orgsModalOpen) return;
    const fallback = activeOrgId || (myOrgs.length ? myOrgs[0].id : "");
    const fallbackInvite =
      activeOrgId && adminCapableOrgs.find((org) => String(org.id) === String(activeOrgId))
        ? activeOrgId
        : (adminCapableOrgs[0]?.id || "");
    if (!addMemberOrgId && fallback) {
      setAddMemberOrgId(fallback);
    }
    if (!inviteOrgId && fallbackInvite) {
      setInviteOrgId(fallbackInvite);
    }
  }, [orgsModalOpen, activeOrgId, myOrgs, addMemberOrgId, inviteOrgId, adminCapableOrgs]);

  const fetchModels = async () => {
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

  const handleDeleteModel = async (id, name) => {
    const confirmed = window.confirm(`Naozaj chcete zmazat tento model?\n\nModel: ${name || id}`);
    if (!confirmed) return;
    setModelsError(null);
    setInfo(null);
    setModelsActionLoading(true);
    try {
      await deleteWizardModel(id);
      await fetchModels();
      setInfo("Model bol zmazany.");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa zmazat model.";
      setModelsError(message);
    } finally {
      setModelsActionLoading(false);
    }
  };

  const handleRenameModel = async (id, currentName) => {
    const newName = window.prompt("Zadajte novy nazov modelu", currentName || "");
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    setModelsError(null);
    setInfo(null);
    setModelsActionLoading(true);
    try {
      await renameWizardModel(id, trimmed);
      await fetchModels();
      setInfo("Model bol premenovany.");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa premenovat model.";
      setModelsError(message);
    } finally {
      setModelsActionLoading(false);
    }
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
    setMyOrgsLoading(true);
    setMyOrgsError(null);
    try {
      const orgs = await listMyOrgs();
      setMyOrgs(orgs || []);
      applyActiveOrgFromList(orgs || [], preferredId);
    } catch (e) {
      setMyOrgsError(e?.message || "Nepodarilo sa nacitat organizacie.");
      setMyOrgs([]);
      setMyOrgsEmpty(null);
    } finally {
      setMyOrgsLoading(false);
    }
  };

  const handleCreateOrg = async () => {
    const name = window.prompt("Nazov organizacie");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setModelsError(null);
    setInfo(null);
    try {
      const created = await createOrg(trimmed);
      setInfo("Organizacia bola vytvorena.");
      await refreshMyOrgs(created?.id || null);
    } catch (e) {
      setModelsError(e?.message || "Nepodarilo sa vytvorit organizaciu.");
    }
  };

  const openOrgsModal = async () => {
    setOrgsModalOpen(true);
    setInviteError(null);
    setInviteCopied(false);
    await refreshMyOrgs(activeOrgId);
  };

  const handleEnableOrgEdit = () => {
    if (modelSource?.kind !== "org") return;
    if (activeOrgRole !== "owner") {
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

  const handleSelectOrg = async (org) => {
    if (!org?.id) return;
    setActiveOrgId(org.id);
    setActiveOrgName(org?.name || "");
    setActiveOrgRole(org?.role || "");
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ACTIVE_ORG_ID", org.id);
      window.localStorage.setItem("ACTIVE_ORG_NAME", org?.name || "");
      window.dispatchEvent(new Event("active-org-changed"));
    }
    setInfo("Aktivna organizacia bola zmenena.");
    setMyOrgsEmpty(false);
    setOrgModelsOpen(false);
    if (orgOpen) {
      await refreshOrgTree(org.id);
    }
  };

  const handleCreateOrgInline = async () => {
    const trimmed = newOrgName.trim();
    if (!trimmed) return;
    setMyOrgsError(null);
    setInfo(null);
    try {
      const created = await createOrg(trimmed);
      setNewOrgName("");
      setInfo("Organizacia bola vytvorena.");
      await refreshMyOrgs(created?.id || null);
      if (created?.id) {
        setActiveOrgId(created.id);
        setActiveOrgName(created?.name || "");
        setActiveOrgRole("owner");
      }
    } catch (e) {
      setMyOrgsError(e?.message || "Nepodarilo sa vytvorit organizaciu.");
    }
  };

  const handleAddOrgMember = async () => {
    const email = addMemberEmail.trim();
    const orgId = addMemberOrgId || activeOrgId;
    if (!email || !orgId) return;
    setAddMemberLoading(true);
    setAddMemberError(null);
    setAddMemberInfo(null);
    try {
      const resp = await addOrgMember(email, orgId, addMemberRole);
      if (resp?.already_member) {
        setAddMemberInfo("Pouzivatel uz je clen organizacie.");
      } else {
        setAddMemberInfo("Pouzivatel bol pridany do organizacie.");
      }
      setAddMemberEmail("");
      await refreshMyOrgs(activeOrgId);
    } catch (e) {
      setAddMemberError(e?.message || "Nepodarilo sa pridat pouzivatela.");
    } finally {
      setAddMemberLoading(false);
    }
  };

  const handleGetInviteLink = async (regenerate = false) => {
    const orgId = inviteOrgId || activeOrgId;
    if (!orgId) {
      setInviteError("Vyber organizaciu.");
      return;
    }
    setInviteLoading(true);
    setInviteError(null);
    setInviteCopied(false);
    try {
      const response = await getOrgInviteLink(orgId, { regenerate });
      const token = response?.token || "";
      if (!token) {
        throw new Error("Nepodarilo sa získať invite token.");
      }
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setInviteLink(`${origin}/join-org/${token}`);
    } catch (e) {
      setInviteError(e?.message || "Nepodarilo sa získať invite link.");
      setInviteLink("");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = inviteLink;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1600);
    } catch {
      setInviteError("Kopírovanie zlyhalo. Skús skopírovať link manuálne.");
    }
  };

  const handleToggleOrgMembers = async () => {
    const nextOpen = !orgMembersOpen;
    setOrgMembersOpen(nextOpen);
    if (!nextOpen) return;
    if (!activeOrgId) {
      setOrgMembers([]);
      setOrgMembersError("Najprv si vyber organizaciu.");
      return;
    }
    setOrgMembersLoading(true);
    setOrgMembersError(null);
    try {
      const members = await listOrgMembers(activeOrgId);
      setOrgMembers(members || []);
    } catch (e) {
      setOrgMembersError(e?.message || "Nepodarilo sa nacitat clenov organizacie.");
      setOrgMembers([]);
    } finally {
      setOrgMembersLoading(false);
    }
  };

  const handleDeactivateOrg = () => {
    setActiveOrgId(null);
    setActiveOrgName("");
    setActiveOrgRole("");
    setOrgTree(null);
    setOrgError("Najprv si vyber alebo vytvor organizaciu.");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("ACTIVE_ORG_ID");
      window.localStorage.removeItem("ACTIVE_ORG_NAME");
      window.dispatchEvent(new Event("active-org-changed"));
    }
    setInfo("Aktivna organizacia bola zrusena.");
  };


  const handleExportBpmn = async () => {
    if (!engineJson) {
      setError("Najprv vygeneruj alebo naimportuj diagram.");
      return;
    }
    if (!modelerRef.current?.saveXML) {
      setError("Modeler nie je inicializovany.");
      return;
    }
    setError(null);
    setInfo(null);
    setExportLoading(true);
    try {
      const { xml: diagramXml } = await modelerRef.current.saveXML({ format: true });

      const name = engineJson.name || engineJson.processName || engineJson.processId || "process";
      await saveWizardModel({
        name,
        engine_json: engineJson,
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
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleImportChange = async (event) => {
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

  const buildMentorText = () => {
    const parts = [];
    const laneText = laneDescription.trim();
    if (laneText) parts.push(laneText);
    return parts.join("\n");
  };

  const runMentorReview = async () => {
    if (!engineJson) {
      setMentorError("Najprv vygeneruj alebo naimportuj diagram.");
      return;
    }
    setMentorLoading(true);
    setMentorError(null);
    setMentorStatus(null);
    try {
      let currentEngine = engineJson;
      const modeler = modelerRef.current;
      if (modeler?.saveXML) {
        try {
          const { xml: diagramXml } = await modeler.saveXML({ format: true });
          if (diagramXml && diagramXml.trim()) {
            const file = new File([diagramXml], "diagram.bpmn", {
              type: "application/bpmn+xml",
            });
            const importResp = await importBpmn(file);
            const importedEngine = importResp?.engine_json || importResp;
            if (importedEngine) {
              currentEngine = importedEngine;
            }
          }
        } catch {
          // Keep current engine_json if sync fails.
        }
      }
      const payload = {
        text: buildMentorText(),
        engine_json: currentEngine,
        kb_version: null,
        telemetry: null,
        telemetry_id: null,
      };
      const response = await mentorReview(payload);
      const findings = response?.findings || [];
      setMentorNotes(findings);
      setMentorDoneIds([]);
      setMentorAppliedIds([]);
      setMentorLastRunAt(Date.now());
      mentorReviewedEngineRef.current = currentEngine;
      setMentorStale(false);
      const meta = response?.meta || {};
      const nodes = meta?.node_count ?? "?";
      const flows = meta?.flow_count ?? "?";
      const lanes = meta?.lane_count ?? "?";
      setMentorStatus(
        `Mentor: ${findings.length} nálezov (nodes: ${nodes}, flows: ${flows}, lanes: ${lanes})`,
      );
      window.setTimeout(() => setMentorStatus(null), 2400);
    } catch (e) {
      const message = e?.message || "Nepodarilo sa spustit mentor kontrolu.";
      setMentorError(message);
    } finally {
      setMentorLoading(false);
    }
  };

  useEffect(() => {
    if (!mentorReviewedEngineRef.current) return;
    if (engineJson !== mentorReviewedEngineRef.current) {
      setMentorStale(true);
    }
  }, [engineJson]);

  const toggleMentorDone = (proposalId) => {
    setMentorDoneIds((prev) =>
      prev.includes(proposalId) ? prev.filter((id) => id !== proposalId) : [...prev, proposalId],
    );
  };

  const handleMentorApply = async (proposal) => {
    if (!engineJson) {
      setMentorError("Najprv vygeneruj alebo naimportuj diagram.");
      return;
    }
    setMentorError(null);
    setMentorStatus(null);
    setMentorApplyingId(proposal.id);
    try {
      if (engineJson && xml && !undoInProgressRef.current) {
        pushHistorySnapshot(engineJson, xml);
      }
      const payload = {
        engine_json: engineJson,
        acceptedFindingIds: [proposal.id],
        findings: [proposal],
      };
      const response = await mentorApply(payload);
      const updatedEngine = response?.engine_json || engineJson;
      setEngineJson(updatedEngine);
      const updatedXml = await renderEngineXml(updatedEngine);
      setXmlFull(updatedXml, "mentorApplyFix");
      setMentorAppliedIds((prev) => (prev.includes(proposal.id) ? prev : [...prev, proposal.id]));
      setMentorDoneIds((prev) => (prev.includes(proposal.id) ? prev : [...prev, proposal.id]));
      setMentorStatus("Oprava bola aplikovana.");
      window.setTimeout(() => setMentorStatus(null), 2400);
    } catch (e) {
      const message = e?.message || "Nepodarilo sa aplikovat opravu.";
      setMentorError(message);
    } finally {
      setMentorApplyingId(null);
    }
  };

  const focusMentorTarget = (proposal) => {
    const targetId = proposal?.target?.id;
    if (!targetId) return;
    const modeler = modelerRef.current;
    if (!modeler) return;
    const elementRegistry = modeler.get("elementRegistry");
    const canvas = modeler.get("canvas");
    const selection = modeler.get("selection");
    const element = elementRegistry?.get(targetId);
    if (!element || !canvas) {
      setMentorError("Nenasiel som ciel na mape.");
      return;
    }
    selection?.select(element);
    if (typeof canvas.scrollToElement === "function") {
      canvas.scrollToElement(element);
    } else {
      canvas.zoom("fit-viewport", "auto");
    }
    if (mentorHighlightRef.current) {
      canvas.removeMarker(mentorHighlightRef.current, "mentor-highlight");
    }
    canvas.addMarker(element.id, "mentor-highlight");
    mentorHighlightRef.current = element.id;
    window.setTimeout(() => {
      if (mentorHighlightRef.current === element.id) {
        canvas.removeMarker(element.id, "mentor-highlight");
        mentorHighlightRef.current = null;
      }
    }, 1800);
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
    () => laneHelperItems.some((item) => Boolean(item.warning)),
    [laneHelperItems],
  );
  const laneWarningCount = useMemo(
    () => laneHelperItems.filter((item) => Boolean(item.warning)).length,
    [laneHelperItems],
  );
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
  const showGuideBanners = modelSource?.kind !== "org" && guideEnabled && guideState?.message;

  return (
    <div className="process-card-layout" ref={layoutRef}>
      <div className="process-card-rail">
        <button className="guide-toggle" type="button" onClick={() => setGuideEnabled((prev) => !prev)}>
          {guideEnabled ? "Pomocník: On" : "Pomocník: Off"}
        </button>
        <div className={`process-card-rail-group ${railSections.org ? "is-open" : ""}`}>
          <button type="button" className="process-card-rail-header" onClick={() => toggleRailSection("org")}>
            <span>ORGANIZÁCIA</span>
            <span className="process-card-rail-chevron">{railSections.org ? "-" : "+"}</span>
          </button>
          {railSections.org ? (
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
              <button type="button" className="process-card-toggle" onClick={openOrgsModal}>
                Organizacie
              </button>
            </div>
          ) : null}
        </div>

        <div className={`process-card-rail-group ${railSections.process ? "is-open" : ""}`}>
          <button type="button" className="process-card-rail-header" onClick={() => toggleRailSection("process")}>
            <span>Proces</span>
            <span className="process-card-rail-chevron">{railSections.process ? "-" : "+"}</span>
          </button>
          {railSections.process ? (
            <div className="process-card-rail-content">
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
                className={`process-card-toggle ${helpOpen ? "is-active" : ""}`}
                style={
                  helpOpen
                    ? {
                        backgroundColor: "#1b3a6b",
                        color: "#fff",
                        borderColor: "#2f5ca0",
                        boxShadow: "0 0 0 1px rgba(47,92,160,0.6)",
                      }
                    : undefined
                }
                onClick={() => toggleSingleCard("help")}
              >
                {helpOpen ? "Skryť pomocník" : "Pomocník"}
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
                className={`process-card-toggle ${mentorOpen ? "is-active" : ""}`}
                style={
                  mentorOpen
                    ? {
                        backgroundColor: "#1b3a6b",
                        color: "#fff",
                        borderColor: "#2f5ca0",
                        boxShadow: "0 0 0 1px rgba(47,92,160,0.6)",
                      }
                    : undefined
                }
                onClick={() => toggleSingleCard("mentor")}
              >
                {mentorOpen ? "Skryť poznámky mentora" : "Poznámky mentora"}
              </button>
              <button
                type="button"
                className={`process-card-toggle process-card-toggle--mentor-review ${mentorStale ? "is-stale" : ""}`}
                onClick={() => {
                  openSingleCard("mentor");
                  runMentorReview();
                }}
                disabled={mentorLoading}
              >
                {mentorLoading ? "Kontrolujem..." : "Spustiť kontrolu"}
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
            <span>Model</span>
            <span className="process-card-rail-chevron">{railSections.save ? "-" : "+"}</span>
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

        <div className={`process-card-rail-group ${railSections.project ? "is-open" : ""}`}>
          <button type="button" className="process-card-rail-header" onClick={() => toggleRailSection("project")}>
            <span>Projekt</span>
            <span className="process-card-rail-chevron">{railSections.project ? "-" : "+"}</span>
          </button>
          {railSections.project ? (
            <div className="process-card-rail-content">
              <button
                type="button"
                className={`process-card-toggle process-card-toggle--notes ${notesOpen ? "is-active" : ""}`}
                onClick={() => setNotesOpen(true)}
              >
                Poznámky
              </button>
            </div>
          ) : null}
        </div>

        <div className={`process-card-rail-group ${railSections.env ? "is-open" : ""}`}>
          <button type="button" className="process-card-rail-header" onClick={() => toggleRailSection("env")}>
            <span>Prostredie</span>
            <span className="process-card-rail-chevron">{railSections.env ? "-" : "+"}</span>
          </button>
          {railSections.env ? (
            <div className="process-card-rail-content">
              <button type="button" className="process-card-toggle" onClick={() => navigate("/")}>
                Karta procesu
              </button>
              <button type="button" className="process-card-toggle" onClick={() => navigate("/text")}
              >
                Text - mapa
              </button>
            </div>
          ) : null}
        </div>
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
              className={`process-card-drawer ${drawerOpen ? "is-open" : ""} ${isReadOnlyMode ? "is-readonly" : ""}`}
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
                    Krátko opíš proces, roly a čo ho spúšťa. Z toho vytvoríme mapu.
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
              <div className="process-card-body">
                <section className="process-card-section">
                  <div className="process-card-section__title">
                    <h2>Začnime základom</h2>
                    <span className="process-card-pill">Základ</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                    {PROCESS_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className="btn btn--small"
                        onClick={() => applyProcessTemplate(template)}
                      >
                        Vzor: {template.label}
                      </button>
                    ))}
                  </div>
                  <label className="wizard-field">
                    <span>Ako sa proces volá?</span>
                    <input
                      value={generatorInput.processName}
                      onChange={(e) => updateGeneratorInput("processName", e.target.value)}
                      placeholder="Napr. Schválenie žiadosti"
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Kto v ňom vystupuje? (každú rolu na nový riadok)</span>
                    <textarea
                      value={generatorInput.roles}
                      onChange={(e) => updateGeneratorInput("roles", e.target.value)}
                      rows={4}
                      placeholder={"Každú rolu napíš na nový riadok"}
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Čo proces spúšťa?</span>
                    <input
                      value={generatorInput.trigger}
                      onChange={(e) => updateGeneratorInput("trigger", e.target.value)}
                      placeholder="Napr. Nová žiadosť od klienta"
                    />
                  </label>
                  <label className="wizard-field">
                    <span>S čím proces pracuje?</span>
                    <textarea
                      value={generatorInput.input}
                      onChange={(e) => updateGeneratorInput("input", e.target.value)}
                      rows={2}
                      placeholder="Aká udalosť je začiatkom procesu?"
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Čo má byť na konci?</span>
                    <textarea
                      value={generatorInput.output}
                      onChange={(e) => updateGeneratorInput("output", e.target.value)}
                      rows={2}
                      placeholder="Aký je výsledok procesu?"
                    />
                  </label>
                  <div className="process-card-grid">
                    <label className="wizard-field">
                      <span>Status</span>
                      <select value={processMeta.status} onChange={(e) => updateProcessMeta("status", e.target.value)} >
                        <option value="Draft">Koncept</option>
                        <option value="Review">Na posúdenie</option>
                        <option value="Approved">Schválený</option>
                        <option value="Deprecated">Zastaraný</option>
                      </select>
                    </label>
                    <label className="wizard-field">
                      <span>Verzia</span>
                      <input value={processMeta.version} onChange={(e) => updateProcessMeta("version", e.target.value)} />
                    </label>
                  </div>
                  <div className="process-card-buttons">
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={handleGenerate}
                        disabled={isLoading || isReadOnlyMode}
                      >
                        {isLoading ? "Vytváram..." : "Vytvoriť model"}
                      </button>
                  </div>
                </section>
                <section className="process-card-section">
                  <div className="process-card-section__title">
                    <h2>Meta udaje o procese</h2>
                    <span className="process-card-pill process-card-pill--muted">Opis</span>
                  </div>
                  <div className="process-card-grid">
                    <label className="wizard-field">
                      <span>Vlastnik procesu</span>
                      <input value={processMeta.owner} onChange={(e) => updateProcessMeta("owner", e.target.value)} />
                    </label>
                    <label className="wizard-field">
                      <span>Oddelenie</span>
                      <input value={processMeta.department} onChange={(e) => updateProcessMeta("department", e.target.value)} />
                    </label>
                    <label className="wizard-field wizard-field--full">
                      <span>Popis procesu</span>
                      <textarea
                        value={processMeta.description}
                        onChange={(e) => updateProcessMeta("description", e.target.value)}
                        rows={4}
                      />
                    </label>
                  </div>
                </section>

                {error ? <div className="wizard-error">{error}</div> : null}
                {info ? <div className="wizard-toast">{info}</div> : null}
                {modelSource?.kind === "org" ? (
                  <div className="wizard-toast" style={{ background: "rgba(15,23,42,0.6)" }}>
                    Režim: {orgReadOnly ? "Len na čítanie" : "Editácia"} (Organizácia)
                    {orgReadOnly && activeOrgRole === "owner" ? (
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
                      Zmenit
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
                  <button type="button" className="btn btn--small" onClick={handleCreateOrgFolder} disabled={!activeOrgId}>
                    + Folder
                  </button>
                  <button type="button" className="btn btn--small" onClick={handleCreateOrgProcess} disabled={!activeOrgId}>
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
                        Organizacie
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
                    Tu doplníš kroky tejto roly. 1 riadok znamená 1 krok v procese.
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
                    className="btn btn--small wizard-lane-v2__header-btn"
                    onClick={() => setLaneInsertOpen(true)}
                    disabled={isReadOnlyMode}
                  >
                    Pridať tvar
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
                    {showGuideBanners &&
                    guideState?.scope === "lane" &&
                    guideState?.laneId &&
                    selectedLane?.id === guideState.laneId ? (
                      <div className="guide-panel">
                        {guideState?.title ? (
                          <div className="guide-panel__title">{guideState.title}</div>
                        ) : null}
                        <div className="guide-panel__text">{guideState.message}</div>
                        <div className="guide-panel__actions">
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
                          {guideState?.secondary ? (
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
                              className="btn btn--small"
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
                    ) : null}
                    <div className="wizard-lane-v2__section">
                      <div className="wizard-lane-v2__section-header">VZORY</div>
                      <div className="wizard-lane-v2__section-sub">Dočasne: výber cez dropdown</div>
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
                    <div className="wizard-lane-v2__section">
                      <div className="wizard-lane-v2__section-header">KROKY ROLY</div>
                      <div className="wizard-lane-v2__section-sub">1 riadok = 1 krok</div>
                      <textarea
                        ref={laneTextareaRef}
                        value={laneDescription}
                        onChange={(e) => updateLaneDescription(e.target.value)}
                        rows={9}
                        placeholder={
                          "Prijmem žiadosť\nOverím identitu\nAk identita nie je platná, zamietnem žiadosť, inak pokračujem..."
                        }
                        onKeyDown={(e) => {
                          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                            e.preventDefault();
                            if (!isLoading && !isReadOnlyMode && laneDescription.trim()) {
                              void handleAppendToLane();
                            }
                          }
                        }}
                        className={`wizard-lane-textarea wizard-lane-v2__textarea ${
                          inlineLaneHint || hasLaneStructure ? "wizard-lane-textarea--structure" : ""
                        } ${laneTemplateFlash ? "wizard-lane-textarea--flash" : ""}`}
                      />
                      <div className="wizard-lane-v2__helper-row">
                        <div className="wizard-lane-v2__badges">
                          <span className="wizard-lane-v2__badge">Rozhodnutia: {laneStructureCounts.decisions}</span>
                          <span className="wizard-lane-v2__badge">Paralely: {laneStructureCounts.parallels}</span>
                        </div>
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
                      {inlineLaneHint ? (
                        <div className="wizard-lane-inline-hint">
                          <span>{inlineLaneHint.message}</span>
                          {inlineLaneHint.templateType ? (
                            <button
                              type="button"
                              className="btn btn--small wizard-lane-inline-btn"
                              onClick={() => insertLaneTemplate(inlineLaneHint.templateType)}
                            >
                              Vložiť vzor
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="wizard-lane-v2__row-actions">
                        <button
                          className="btn btn-primary lane-primary-btn wizard-lane-v2__apply-btn"
                          type="button"
                          onClick={handleAppendToLane}
                          disabled={isLoading || isReadOnlyMode || !laneDescription.trim()}
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
                          KONTROLA KROKOV
                        </span>
                      </div>
                      <div className="wizard-lane-v2__control-body is-compact">
                        {laneDescription.trim() ? (
                          laneHelperItems.length ? (
                            <div className="wizard-lane-v2__control-list">
                              {laneHelperItems.map((item) => (
                                <div key={item.id} className="wizard-lane-v2__control-item">
                                  <div className="wizard-lane-v2__control-line">
                                    <strong>{item.badge}</strong> - {item.text}
                                  </div>
                                  {item.warning ? (
                                    <div className="wizard-lane-v2__control-warning">{item.warning}</div>
                                  ) : null}
                                </div>
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
                      ? `lane ${helpInsertTarget.laneName || helpInsertTarget.laneId || ""}`
                      : "hlavné kroky"}
                  </div>
                  <div className="wizard-help-card-hint">Klikni na „Vložiť" a doplň si vlastný text.</div>
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
                  <div className="process-card-label">Pribeh procesu</div>
                  <div className="process-card-description">
                    Zhrnutie procesu v ludskej reci podla aktualnej mapy.
                  </div>
                </div>
                <button
                  type="button"
                  className="process-card-close"
                  aria-label="Zavriet pribeh procesu"
                  onClick={() => setStoryOpen(false)}
                >
                  x
                </button>
              </div>
              <div className="process-card-body">
                <section className="process-card-section">
                  <div className="process-card-section__title">
                    <h2>Nastavenia</h2>
                    <span className="process-card-pill process-card-pill--muted">Vystup</span>
                  </div>
                  {startOptions.length > 1 ? (
                    <label className="wizard-field">
                      <span>Start</span>
                      <select
                        value={storyOptions.selectedStartId || startOptions[0]?.id || ""}
                        onChange={(e) => updateStoryOption("selectedStartId", e.target.value)}
                      >
                        {startOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <div className="process-story-options">
                    <label className="process-story-toggle">
                      <input
                        type="checkbox"
                        checked={storyOptions.useLanes}
                        onChange={(e) => updateStoryOption("useLanes", e.target.checked)}
                      />
                      <span>Pouzit roly (lanes)</span>
                    </label>
                    <label className="process-story-toggle">
                      <input
                        type="checkbox"
                        checked={storyOptions.summarizeParallels}
                        onChange={(e) => updateStoryOption("summarizeParallels", e.target.checked)}
                      />
                      <span>Zhrnut paralely</span>
                    </label>
                    <label className="process-story-toggle">
                      <input
                        type="checkbox"
                        checked={storyOptions.showBranchEnds}
                        onChange={(e) => updateStoryOption("showBranchEnds", e.target.checked)}
                      />
                      <span>Zobrazit konce vetiev</span>
                    </label>
                    <label className="process-story-toggle">
                      <input
                        type="checkbox"
                        checked={storyOptions.moreDetails}
                        onChange={(e) => updateStoryOption("moreDetails", e.target.checked)}
                      />
                      <span>Viac detailov</span>
                    </label>
                  </div>
                  <div className="process-story-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={regenerateStory}
                      disabled={!engineJson}
                    >
                      Prepocitat
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={handleCopyStory}
                      disabled={!storyDoc}
                    >
                      Kopirovat text
                    </button>
                  </div>
                  {storyStale ? (
                    <div className="process-story-stale">
                      Mapa sa zmenila. Klikni na Prepocitat pre novy pribeh.
                    </div>
                  ) : null}
                  {storyGeneratedAt ? (
                    <div className="process-story-meta">Naposledy generovane: {formatDateTime(storyGeneratedAt)}</div>
                  ) : null}
                </section>

                <section className="process-card-section">
                  <div className="process-card-section__title">
                    <h2>Celý príbeh</h2>
                    <span className="process-card-pill process-card-pill--muted">Text</span>
                  </div>
                  {storyDoc ? (
                    <textarea
                      className="process-story-textarea"
                      value={buildStoryText(storyDoc)}
                      readOnly
                      rows={14}
                    />
                  ) : (
                    <div className="process-story-empty">
                      {engineJson ? "Klikni na Prepočítať pre príbeh." : "Najprv načítaj alebo vytvor mapu."}
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

          {mentorOpen ? (
            <div className="process-card-drawer is-open process-card-mentor">
              <div className="process-card-header">
                <div>
                  <div className="process-card-label">Poznámky mentora</div>
                  <div className="process-card-description">Checklist návrhov a rýchlych opráv.</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    className={`btn btn-mentor-review ${mentorStale ? "is-stale" : ""}`}
                    onClick={runMentorReview}
                    disabled={mentorLoading}
                  >
                    {mentorLoading ? "Kontrolujem..." : "Spustiť kontrolu"}
                  </button>
                  <button
                    type="button"
                    className="process-card-close"
                    aria-label="Zavrieť poznámky mentora"
                    onClick={() => setMentorOpen(false)}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="process-card-body">
                {mentorLoading ? <div>Kontrolujem...</div> : null}
                {mentorError ? (
                  <div className="wizard-error">
                    <div style={{ marginBottom: 8 }}>{mentorError}</div>
                    <button type="button" className="btn btn--small" onClick={runMentorReview}>
                      Skúsiť znova
                    </button>
                  </div>
                ) : null}
                {mentorStatus ? <div className="wizard-toast">{mentorStatus}</div> : null}
                {mentorStale ? (
                  <div className="wizard-toast" style={{ marginBottom: 8 }}>
                    Model sa zmenil. Spust kontrolu znova.
                  </div>
                ) : null}
                {!mentorLoading && !mentorError && mentorNotes.length === 0 ? (
                  <div>Zatiaľ nemám poznámky. Spusti kontrolu.</div>
                ) : null}
                {!mentorLoading && !mentorError && mentorNotes.length ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {mentorNotes.map((proposal) => {
                      const isApplied = mentorAppliedIds.includes(proposal.id);
                      const isDone = isApplied || mentorDoneIds.includes(proposal.id);
                      const hasPatch = Boolean(proposal?.autofix && proposal?.fix_payload);
                      const subtitle = proposal?.proposal;
                      const severityClass =
                        proposal?.severity === "HARD"
                          ? "mentor-note--hard"
                          : proposal?.severity === "SOFT"
                            ? "mentor-note--soft"
                            : "mentor-note--info";
                      return (
                        <div
                          key={proposal.id}
                          className={`mentor-note ${severityClass}`}
                          style={{
                            borderRadius: 12,
                            padding: 12,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <div>
                              <div style={{ fontWeight: 600 }}>
                                {proposal.message || "Poznámka mentora"}
                              </div>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>
                                {proposal.severity || "INFO"}
                              </div>
                              {subtitle ? <div style={{ opacity: 0.8 }}>{subtitle}</div> : null}
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.7, textAlign: "right" }}>
                              <div>Risk: {proposal.risk || "low"}</div>
                              <div>Confidence: {Math.round((proposal.confidence || 0) * 100)}%</div>
                            </div>
                          </div>



                          <div
                            style={{
                              marginTop: 12,
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              flexWrap: "wrap",
                            }}
                          >
                            {proposal?.target?.id ? (
                              <button
                                type="button"
                                className="btn btn--small btn-mentor-focus"
                                onClick={() => focusMentorTarget(proposal)}
                              >
                                Ukaz na mape
                              </button>
                            ) : null}
                            {hasPatch ? (
                              <button
                                type="button"
                                className="btn btn--small btn-primary"
                                onClick={() => handleMentorApply(proposal)}
                                disabled={mentorApplyingId === proposal.id || isApplied}
                              >
                                {mentorApplyingId === proposal.id
                                  ? "Aplikujem..."
                                  : isApplied
                                    ? "Aplikované"
                                    : "Použiť opravu"}
                              </button>
                            ) : null}
                            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <input
                                type="checkbox"
                                checked={isDone}
                                onChange={() => toggleMentorDone(proposal.id)}
                                disabled={isApplied}
                              />
                              <span>{isApplied ? "Hotovo (aplikované)" : "Hotovo"}</span>
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

        <div className="process-card-main">
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
                  {activeOrgRole === "owner"
                    ? "Tento org model je len na čítanie. Ak chceš upravovať, klikni „Upraviť“."
                    : "Tento org model je len na čítanie. Novú verziu môžeš publikovať z pieskoviska cez Push do organizácie."}
                </div>
              </div>
              {activeOrgRole === "owner" ? (
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
                  {guideState?.secondary ? (
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
                        className="btn btn--small"
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
                      <button className="btn btn-primary" type="button" onClick={handleStartNewModel}>
                        Začať nový model
                      </button>
                      <button className="btn" type="button" onClick={openModels}>
                        Pokračovať v rozpracovanom
                      </button>
                    </div>
                    <div className="wizard-welcome__hint">
                      Tip: Rozpracované modely nájdeš v sekcii Uložené modely.
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
                <h3 style={{ margin: 0 }}>Pomocník</h3>
                <button className="btn btn--small" type="button" onClick={() => setLaneInsertOpen(false)}>
                  Zavriet
                </button>
              </div>
              <div className="wizard-shape-meta">
                Vkladáš do: lane {selectedLane.name || selectedLane.id}
              </div>
              <div className="wizard-help-modal-body">
                {renderHelpList()}
              </div>
            </div>
          </div>
        ) : null}


        {modelsOpen ? (
          <div className="wizard-models-modal" onClick={() => setModelsOpen(false)}>
            <div className="wizard-models-panel wizard-models-panel--sandbox" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <div>
                  <h3 style={{ margin: 0 }}>Moje uložené modely (Pieskovisko)</h3>
                  <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
                    Súkromné modely viditeľné len pre teba. Tlačidlom „Push do organizácie“ ich uložíš do organizačnej
                    knižnice.
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
                <div className="wizard-error" style={{ marginTop: 8 }}>
                  Pouzivatel nema organizaciu.
                </div>
              ) : null}
              {myOrgsEmpty === true ? (
                <div style={{ marginTop: 8 }}>
                  <button className="btn btn--small btn-primary" type="button" onClick={handleCreateOrg}>
                    Vytvoriť organizáciu
                  </button>
                </div>
              ) : null}
              <div style={{ overflow: "auto" }}>
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
                                {group.label}
                                {latest?.process_meta?.org_pushes?.length ? (
                                  <span
                                    style={{
                                      marginLeft: 8,
                                      fontSize: 10,
                                      padding: "2px 6px",
                                      borderRadius: 999,
                                      border: "1px solid rgba(59,130,246,0.35)",
                                      background: "rgba(30,58,138,0.2)",
                                      color: "#dbeafe",
                                    }}
                                    title={`Ulozene v ${latest.process_meta.org_pushes.length} organizacii(ach)`}
                                  >
                                    Organizácia
                                  </span>
                                ) : null}
                              </div>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>Verzie: {group.items.length}</div>
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
                                  {isExpanded ? "Skryť verzie" : "Verzie"}
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
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                                    <button
                                      className="btn btn--small"
                                      type="button"
                                      onClick={() => handlePushModelToOrg(latest)}
                                      disabled={!activeOrgId || pushModelLoadingIds.has(latest.id)}
                                    >
                                      {pushModelLoadingIds.has(latest.id) ? "Ukladám..." : "Push do organizácie"}
                                    </button>
                                    {!activeOrgId ? (
                                      <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
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
                                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                                                <button
                                                  className="btn btn--small"
                                                  type="button"
                                                  onClick={() => handlePushModelToOrg(m)}
                                                  disabled={!activeOrgId || pushModelLoadingIds.has(m.id)}
                                                >
                                                  {pushModelLoadingIds.has(m.id) ? "Ukladám..." : "Push do organizácie"}
                                                </button>
                                                {!activeOrgId ? (
                                                  <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
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

        {orgsModalOpen ? (
          <div className="wizard-models-modal" onClick={() => setOrgsModalOpen(false)}>
            <div className="wizard-models-panel" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <h3 style={{ margin: 0 }}>Organizacie</h3>
                <div className="wizard-models-tools">
                  <button className="btn btn--small" type="button" onClick={() => refreshMyOrgs(activeOrgId)} disabled={myOrgsLoading}>
                    {myOrgsLoading ? "Nacitavam..." : "Obnovit"}
                  </button>
                </div>
              </div>
              {myOrgsError ? <div className="wizard-error">{myOrgsError}</div> : null}
              <div style={{ overflow: "auto" }}>
                <table className="wizard-models-table">
                  <thead>
                    <tr>
                      <th>Nazov</th>
                      <th>Rola</th>
                      <th>Stav</th>
                      <th>Akcia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myOrgsLoading ? (
                      <tr>
                        <td colSpan={4}>Nacitavam...</td>
                      </tr>
                    ) : myOrgs.length ? (
                      myOrgs.map((org) => {
                        const isActive = String(org.id) === String(activeOrgId);
                        return (
                          <tr key={org.id}>
                            <td>{org.name || org.id}</td>
                            <td>{org.role || "-"}</td>
                            <td>{isActive ? "Aktivna" : "-"}</td>
                            <td>
                              <div className="wizard-models-actions">
                                <button
                                  className="btn btn--small btn-primary"
                                  type="button"
                                  onClick={() => handleSelectOrg(org)}
                                  disabled={isActive}
                                >
                                  {isActive ? "Aktivna" : "Nastavit aktivnu"}
                                </button>
                                {isActive ? (
                                  <button className="btn btn--small btn-danger" type="button" onClick={handleDeactivateOrg}>
                                    Zrusit aktivnu
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4}>Zatial nemas ziadnu organizaciu.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {isActiveOrgAdmin ? (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Invite link do organizácie</div>
                  {inviteError ? <div className="wizard-error">{inviteError}</div> : null}
                  <div style={{ display: "grid", gap: 8 }}>
                    <select
                      className="wizard-models-search"
                      value={inviteOrgId}
                      onChange={(e) => {
                        setInviteOrgId(e.target.value);
                        setInviteError(null);
                        setInviteCopied(false);
                        setInviteLink("");
                      }}
                    >
                      <option value="">Vyber organizaciu</option>
                      {adminCapableOrgs.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name || org.id}
                        </option>
                      ))}
                    </select>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn btn--small btn-primary"
                        type="button"
                        onClick={() => handleGetInviteLink(false)}
                        disabled={inviteLoading || !inviteOrgId}
                      >
                        {inviteLoading ? "Načítavam..." : "Získať link"}
                      </button>
                      {(selectedInviteOrgRole === "owner" || selectedInviteOrgRole === "admin") ? (
                        <button
                          className="btn btn--small"
                          type="button"
                          onClick={() => handleGetInviteLink(true)}
                          disabled={inviteLoading || !inviteOrgId}
                        >
                          Regenerovať
                        </button>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="text"
                        className="wizard-models-search"
                        value={inviteLink}
                        placeholder="Link sa zobrazí tu..."
                        readOnly
                      />
                      <button
                        className="btn btn--small"
                        type="button"
                        onClick={handleCopyInviteLink}
                        disabled={!inviteLink}
                      >
                        {inviteCopied ? "Skopírované" : "Kopírovať"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              {hasAnyAdminOrg ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Vytvorit organizaciu</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="text"
                      className="wizard-models-search"
                      placeholder="Nazov organizacie"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                    />
                    <button className="btn btn--small btn-primary" type="button" onClick={handleCreateOrgInline}>
                      Vytvorit
                    </button>
                  </div>
                </div>
              ) : null}
              {isActiveOrgAdmin ? (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Pridat pouzivatela do organizacie</div>
                  {addMemberError ? <div className="wizard-error">{addMemberError}</div> : null}
                  {addMemberInfo ? <div className="wizard-info">{addMemberInfo}</div> : null}
                  <div style={{ display: "grid", gap: 8 }}>
                    <input
                      type="email"
                      className="wizard-models-search"
                      placeholder="Email pouzivatela"
                      value={addMemberEmail}
                      onChange={(e) => setAddMemberEmail(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select
                        className="wizard-models-search"
                        value={addMemberOrgId}
                        onChange={(e) => setAddMemberOrgId(e.target.value)}
                      >
                        <option value="">Vyber organizaciu</option>
                        {adminCapableOrgs.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name || org.id}
                          </option>
                        ))}
                      </select>
                      <select
                        className="wizard-models-search"
                        value={addMemberRole}
                        onChange={(e) => setAddMemberRole(e.target.value)}
                      >
                        <option value="owner">owner</option>
                        <option value="member">member</option>
                      </select>
                      <button
                        className="btn btn--small btn-primary"
                        type="button"
                        onClick={handleAddOrgMember}
                        disabled={addMemberLoading || !addMemberEmail.trim() || !addMemberOrgId}
                      >
                        {addMemberLoading ? "Pridavam..." : "Pridat"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Clenovia aktivnej organizacie</div>
                  <button
                    className="btn btn--small"
                    type="button"
                    onClick={handleToggleOrgMembers}
                    disabled={orgMembersLoading}
                  >
                    {orgMembersOpen ? "Skryt" : "Zobrazit"}
                  </button>
                </div>
                {orgMembersError ? <div className="wizard-error">{orgMembersError}</div> : null}
                {orgMembersOpen ? (
                  <div style={{ overflow: "auto" }}>
                    <table className="wizard-models-table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Rola</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orgMembersLoading ? (
                          <tr>
                            <td colSpan={2}>Nacitavam...</td>
                          </tr>
                        ) : orgMembers.length ? (
                          orgMembers.map((member) => (
                            <tr key={`${member.email}-${member.role}`}>
                              <td>{member.email}</td>
                              <td>{member.role || "-"}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={2}>Ziadni clenovia.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button className="btn" type="button" onClick={() => setOrgsModalOpen(false)}>
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
                <h3 style={{ margin: 0 }}>Ulozit do organizacie</h3>
                <button className="btn btn--small" type="button" onClick={closePushModal}>
                  Zavriet
                </button>
              </div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>
                Model: <strong>{orgPushModel?.name || orgPushModel?.id || "-"}</strong>
              </div>
              {orgPushError ? <div className="wizard-error">{orgPushError}</div> : null}
              <div className="org-tree">
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
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button className="btn" type="button" onClick={closePushModal} disabled={orgPushLoading}>
                  Zrusit
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleConfirmPushToOrg}
                  disabled={orgPushLoading || !orgTree}
                >
                  {orgPushLoading ? "Ukladam..." : "Ulozit sem"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {orgPushConflictOpen ? (
          <div className="wizard-models-modal" onClick={handleConflictCloseModal}>
            <div className="wizard-models-panel wizard-models-panel--org-push" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <h3 style={{ margin: 0 }}>Duplicitný názov</h3>
                <button className="btn btn--small" type="button" onClick={handleConflictCloseModal}>
                  Zavrieť
                </button>
              </div>
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>
                V organizačnej vrstve už existuje proces s názvom <strong>{orgPushConflictName}</strong>.
              </div>
              {orgPushConflictMatches.length ? (
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
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
                <h3 style={{ margin: 0 }}>Potvrdiť prepísanie</h3>
                <button className="btn btn--small" type="button" onClick={handleCancelOverwrite}>
                  Zavrieť
                </button>
              </div>
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>
                Ozaj chceš prepísať vybraný proces v organizačnej vrstve?
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 12 }}>
                Ak prepíšeš tento proces, zmeny z tvojho Pieskoviska sa prejavia v organizačnej vrstve.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
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

        {savePromptOpen ? (
          <div className="wizard-models-modal" onClick={handleCancelOpen}>
            <div className="wizard-models-panel wizard-save-prompt" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <h3 style={{ margin: 0 }}>Ulozit model?</h3>
                <button className="btn btn--small" type="button" onClick={handleCancelOpen}>
                  Zavriet
                </button>
              </div>
              <div className="wizard-save-prompt__text">
                Mas rozpracovany model. Chces ho ulozit pred otvorenim ineho?
              </div>
              <div className="wizard-save-prompt__actions">
                <button className="btn" type="button" onClick={handleOpenWithoutSave}>
                  Neulozit
                </button>
                <button className="btn btn-primary" type="button" onClick={handleSaveAndOpen}>
                  Ulozit model
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {orgEditConfirmOpen ? (
          <div className="wizard-models-modal" onClick={handleCancelEnableOrgEdit}>
            <div className="wizard-models-panel wizard-save-prompt" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <h3 style={{ margin: 0 }}>Prepnúť do editácie?</h3>
                <button className="btn btn--small" type="button" onClick={handleCancelEnableOrgEdit}>
                  Zrušiť
                </button>
              </div>
              <div className="wizard-save-prompt__text">
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
                <h3 style={{ margin: 0 }}>Poznámky k projektu</h3>
                <button className="btn btn--small" type="button" onClick={() => setNotesOpen(false)}>
                  Zavrieť
                </button>
              </div>
              <div className="project-notes-body">
                {projectNotesError ? <div className="wizard-error">{projectNotesError}</div> : null}
                <label className="wizard-field">
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
                    Pridat poznamku
                  </button>
                  {projectNotesSaving ? <div style={{ fontSize: 12, opacity: 0.7 }}>Ukladam...</div> : null}
                </div>

                <div className="project-notes-list">
                  {projectNotesLoading ? (
                    <div className="project-notes-empty">Načítavam poznámky...</div>
                  ) : projectNotes.length === 0 ? (
                    <div className="project-notes-empty">
                      Zatiaľ žiadne poznámky. Pridaj prvú vyššie.
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
                            <option value="new">Nove</option>
                            <option value="reviewed">Skontrolovane</option>
                            <option value="agreed">Dohodnute</option>
                          </select>
                          <div className="project-note-actions">
                            <button
                              type="button"
                              className="btn btn--small btn-accent"
                              onClick={() => setReplyOpenById((prev) => ({ ...prev, [note.id]: true }))}
                            >
                              Pridat odpoved
                            </button>
                            <button
                              type="button"
                              className="btn btn--small"
                              onClick={() => startEditProjectNote(note)}
                              disabled={editingNoteId === note.id}
                            >
                              Upravit
                            </button>
                            <button
                              type="button"
                              className="btn btn--small btn-danger"
                              onClick={() => removeProjectNote(note.id)}
                            >
                              Zmazat
                            </button>
                          </div>
                        </div>
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
                                Ulozit
                              </button>
                              <button type="button" className="btn btn--small" onClick={cancelEditProjectNote}>
                                Zrusit
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
                                      Ulozit
                                    </button>
                                    <button type="button" className="btn btn--small" onClick={cancelEditReply}>
                                      Zrusit
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="project-note-reply-row">
                                  <div className="project-note-reply-text">{reply.text}</div>
                                  <div className="project-note-reply-actions">
                                    <button
                                      type="button"
                                      className="btn btn--small"
                                      onClick={() => startEditReply(note.id, reply)}
                                    >
                                      Upravit
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn--small btn-danger"
                                      onClick={() => removeReply(note.id, reply.id)}
                                    >
                                      Zmazat
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
                                placeholder="Napis odpoved..."
                              />
                              <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => addProjectNoteReply(note.id)}
                                disabled={!String(replyDrafts[note.id] || "").trim()}
                              >
                                Ulozit odpoved
                              </button>
                              <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                  setReplyDrafts((prev) => ({ ...prev, [note.id]: "" }));
                                  setReplyOpenById((prev) => ({ ...prev, [note.id]: false }));
                                }}
                              >
                                Zrusit
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

