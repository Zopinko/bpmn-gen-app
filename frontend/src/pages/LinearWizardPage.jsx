import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapViewer from "../components/MapViewer";
import { useHeaderStepper } from "../components/HeaderStepperContext";
import {
  appendLaneFromDescription,
  generateLinearWizardDiagram,
  importBpmn,
  saveWizardModel,
  loadWizardModel,
  renderEngineXml,
  listWizardModels,
  deleteWizardModel,
  renameWizardModel,
  getProjectNotes,
  saveProjectNotes,
  mentorReview,
  mentorApply,
} from "../api/wizard";

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
  {
    id: "and_free",
    title: "Paralelne kroky (AND) - volny text",
    description: "Paralelne vykonavane kroky zapisane prirodzene.",
    iconClass: "bpmn-icon-gateway-parallel",
    syntax: "Zaroven/Sucasne <krok>, <krok> a <krok>",
    example: "Zaroven priprav zmluvu, over identitu a nastav splatky",
    template: "Zaroven <krok1>, <krok2> a <krok3>",
    fields: [
      { key: "krok1", label: "Krok 1", token: "krok1", placeholder: "napr. priprav zmluvu" },
      { key: "krok2", label: "Krok 2", token: "krok2", placeholder: "napr. over identitu" },
      { key: "krok3", label: "Krok 3", token: "krok3", placeholder: "napr. nastav splatky" },
    ],
  },
];


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

const splitLines = (text) =>
  (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const normalizeAscii = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const analyzeLaneLine = (lineText) => {
  const raw = String(lineText || "");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ascii = normalizeAscii(trimmed);
  const isXor = /^(ak|ked)\b/.test(ascii);
  const isAnd = /^(paralelne|zaroven|sucasne)\b/.test(ascii);
  const hasTak = /\btak\b/.test(ascii);
  const hasInak = /\binak\b/.test(ascii);

  if (isXor) {
    let warning = "";
    if (!hasTak || !hasInak) {
      warning = "Dopln format: 'tak' aj 'inak'.";
    }
    return {
      type: "xor",
      badge: "XOR",
      hint: "XOR gateway: Ak <podmienka> tak <krok>, inak <krok/koniec>.",
      warning,
    };
  }

  if (isAnd) {
    const parts = ascii.replace(/^paralelne:?/, "").replace(/^zaroven/, "").replace(/^sucasne/, "");
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
    const warning = stepCount < 2 ? "Pridaj aspon 2 kroky (oddelenie ; alebo , a ...)." : "";
    return {
      type: "and",
      badge: "AND",
      hint: "AND gateway: Paralelne: <krok>; <krok> alebo Zaroven <krok>, <krok> a <krok>.",
      warning,
    };
  }

  return {
    type: "task",
    badge: "TASK",
    hint: "Toto bude aktivita (task) v lane.",
    warning: "",
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
  const fileInputRef = useRef(null);
  const { setState: setHeaderStepperState } = useHeaderStepper();
  const [processCard, setProcessCard] = useState(() => createEmptyProcessCardState());
  const [drawerOpen, setDrawerOpen] = useState(true);
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
  const [loadId, setLoadId] = useState("");
  const modelerRef = useRef(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [modelsActionLoading, setModelsActionLoading] = useState(false);
  const [modelsSearch, setModelsSearch] = useState("");
  const [expandedModelGroups, setExpandedModelGroups] = useState([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [mentorOpen, setMentorOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
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
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const pendingOpenActionRef = useRef(null);
  const [projectNotes, setProjectNotes] = useState([]);
  const [projectNotesLoading, setProjectNotesLoading] = useState(false);
  const [projectNotesSaving, setProjectNotesSaving] = useState(false);
  const [projectNotesError, setProjectNotesError] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteDraftFlags, setNoteDraftFlags] = useState({
    riziko: false,
    blokuje: false,
    doplnit: false,
  });
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [lastExportedAt, setLastExportedAt] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [historyCount, setHistoryCount] = useState(0);
  const verticalResizeStart = useRef({ y: 0, h: 0 });
  const layoutRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const pendingDiagramXmlRef = useRef("");
  const lastSyncedXmlRef = useRef("");
  const historyRef = useRef([]);
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
  const laneHelperItems = useMemo(() => analyzeLaneLines(laneDescription), [laneDescription]);

  useEffect(() => {
    if (!selectedLane) {
      setLaneInsertOpen(false);
    }
  }, [selectedLane]);

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
    }),
    [
      engineJson,
      lastExportedAt,
      lastSavedAt,
      mentorLastRunAt,
      mentorNotes,
      processCard.generatorInput.processName,
    ],
  );

  useEffect(() => {
    setHeaderStepperState(headerStepperState);
  }, [headerStepperState, setHeaderStepperState]);

  useEffect(() => () => setHeaderStepperState(null), [setHeaderStepperState]);

  const updateGeneratorInput = (field, value) =>
    setProcessCard((prev) => ({
      ...prev,
      generatorInput: { ...prev.generatorInput, [field]: value },
    }));

  const updateProcessMeta = (field, value) =>
    setProcessCard((prev) => ({
      ...prev,
      processMeta: { ...prev.processMeta, [field]: value },
    }));

  const appendLine = (current, text) => {
    const base = (current || "").trimEnd();
    return base ? `${base}\n${text}` : text;
  };

  const insertHelpExample = (text) => {
    setLaneDescription((prev) => appendLine(prev, text));
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
    setXml("");
    setSelectedLane(null);
    setLaneDescription("");
    setLoadId("");
    setError(null);
    setInfo(null);
    setIsLoading(false);
    setExportLoading(false);
    setImportLoading(false);
    setSaveLoading(false);
    setLoadLoading(false);
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

  const handleNewModel = () => {
    const confirmed = window.confirm("Začať nový model? Neuložené zmeny sa stratia.");
    if (!confirmed) return;
    resetWizardState();
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
    setXml(snapshot.xml);
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
        setXml(updatedXml);
      } catch (e) {
        const message = e?.message || "Nepodarilo sa nacitat modely.";
        setError(message);
      }
    },
    [engineJson, pushHistorySnapshot, xml],
  );

    const handleDiagramChange = useCallback(
      async (diagramXml) => {
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
            setXml(diagramXml);
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
      [engineJson, pushHistorySnapshot, xml],
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
      setXml(xmlText);
    } catch (e) {
      const message = e?.message || "Failed to generate diagram";
      setError(message);
      setEngineJson(null);
      setXml("");
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

  const fetchProjectNotes = async () => {
    setProjectNotesLoading(true);
    setProjectNotesError(null);
    try {
      const resp = await getProjectNotes();
      setProjectNotes(resp?.notes || []);
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
    setProjectNotes(nextNotes);
    setProjectNotesSaving(true);
    setProjectNotesError(null);
    try {
      const resp = await saveProjectNotes(nextNotes);
      if (Array.isArray(resp?.notes)) {
        setProjectNotes(resp.notes);
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
      status: "working",
      flags: { ...noteDraftFlags },
      createdAt: new Date().toISOString(),
    };
    await persistProjectNotes([next, ...projectNotes]);
    setNoteDraft("");
    setNoteDraftFlags({ riziko: false, blokuje: false, doplnit: false });
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

  const toggleProjectNoteFlag = (id, flag, value) => {
    const next = projectNotes.map((note) =>
      note.id === id
        ? {
            ...note,
            flags: {
              ...note.flags,
              [flag]: value,
            },
          }
        : note,
    );
    void persistProjectNotes(next);
  };

  const removeProjectNote = (id) => {
    const next = projectNotes.filter((note) => note.id !== id);
    void persistProjectNotes(next);
  };

  const viewerProps = useMemo(
    () => ({
      title: "Karta procesu - náhľad",
      subtitle: previewName,
      subtitleMeta: previewVersionLabel,
      subtitleProminent: true,
      xml,
      loading: isLoading && !xml,
      error: error || "",
      onLaneSelect: setSelectedLane,
      onLaneOrderChange: reorderLanesByNames,
      onDiagramChange: handleDiagramChange,
      onUndo: handleUndo,
      canUndo: historyCount > 0,
      onModelerReady: (modeler) => {
        modelerRef.current = modeler;
      },
    }),
    [
      error,
      handleDiagramChange,
      handleUndo,
      historyCount,
      isLoading,
      previewName,
      previewVersionLabel,
      reorderLanesByNames,
      xml,
    ],
  );


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
    return elementRegistry.getAll().filter((el) => {
      if (!el || el.type === "label") return false;
      const bo = el.businessObject;
      if (!bo?.$instanceOf?.("bpmn:FlowNode")) return false;
      let parent = el.parent;
      while (parent) {
        if (parent.id === laneElement.id) return true;
        parent = parent.parent;
      }
      return false;
    });
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

  const computeLaneInsertPosition = (
    laneElement,
    shape,
    mode,
    firstNode,
    lastNode,
    globalRightmost,
  ) => {
    const paddingX = 60;
    const paddingY = 30;
    const laneLeft = laneElement.x + paddingX;
    const laneRight = laneElement.x + laneElement.width - shape.width - paddingX;
    const laneTop = laneElement.y + paddingY;
    const laneBottom = laneElement.y + laneElement.height - shape.height - paddingY;
    const centeredY = laneElement.y + (laneElement.height - shape.height) / 2;
    const y = Math.min(laneBottom, Math.max(laneTop, centeredY));
    let x = laneLeft;

    if (mode === "start" && firstNode) {
      x = firstNode.x - shape.width - 60;
    } else if (lastNode) {
      x = lastNode.x + lastNode.width + 60;
    } else if (typeof globalRightmost === "number") {
      x = globalRightmost;
    }

    x = Math.min(laneRight, Math.max(laneLeft, x));
    return { x, y };
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

    if (!laneElement || !modeling || !elementFactory) {
      setError("Lane sa nepodarilo najst.");
      return;
    }

    const laneNodes = collectLaneFlowNodes(laneElement, elementRegistry);
    const orderedNodes = [...laneNodes].sort((a, b) => (a.x || 0) - (b.x || 0));
    const firstNode = orderedNodes[0];
    const lastNode = orderedNodes[orderedNodes.length - 1];
    const shape = elementFactory.createShape({ type: activeLaneShape.bpmnType });
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
    const created = modeling.createShape(shape, position, laneElement);

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

    setLaneInsertOpen(false);
    setError(null);
  };

  const handleAppendToLane = async () => {
    if (!selectedLane || !laneDescription.trim()) {
      setError("Vyber lane a doplň aspoň jeden krok.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      if (engineJson && xml && !undoInProgressRef.current) {
        pushHistorySnapshot(engineJson, xml);
      }
      const payload = {
        lane_id: selectedLane.id,
        lane_name: selectedLane.name,
        description: laneDescription,
        engine_json: engineJson,
      };
      const response = await appendLaneFromDescription(payload);
      const updatedEngine = response?.engine_json || engineJson;
      setEngineJson(updatedEngine);
      const updatedXml = await renderEngineXml(updatedEngine);
      setXml(updatedXml);
      setLaneDescription("");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa pridať kroky do lane.";
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
    setError(null);
    setInfo(null);
    setSaveLoading(true);
    try {
      if (!modelerRef.current?.saveXML) {
        throw new Error("Modeler nie je inicializovaný.");
      }
      const { xml: diagramXml } = await modelerRef.current.saveXML({ format: true });
      const payload = {
        name: deriveDefaultName(),
        engine_json: engineJson,
        diagram_xml: diagramXml,
        generator_input: processCard.generatorInput,
        process_meta: processCard.processMeta,
      };
      await saveWizardModel(payload);
      setLastSavedAt(Date.now());
      setInfo("Model bol zmazany.");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa zmazat model.";
      setError(message);
    } finally {
      setSaveLoading(false);
    }
  };

  const applyLoadedModel = (resp, { closeModels = false } = {}) => {
    const loadedEngine = resp?.engine_json;
    const diagram = resp?.diagram_xml;
    if (!loadedEngine || !diagram) {
      throw new Error("Model neobsahuje engine_json alebo diagram_xml.");
    }
    if (engineJson && xml && !undoInProgressRef.current) {
      pushHistorySnapshot(engineJson, xml);
    }
    setEngineJson(loadedEngine);
    setXml(diagram);
    setSelectedLane(null);
    setLaneDescription("");
    hydrateProcessCard(resp);
    if (closeModels) {
      setModelsOpen(false);
    }
    setDrawerOpen(false);
  };

  const doLoadModelById = async (id) => {
    setError(null);
      setInfo("Model bol nacitany.");
    setLoadLoading(true);
    try {
      const resp = await loadWizardModel(id);
      applyLoadedModel(resp);
      setInfo("Model bol nacitany.");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa nacitat model.";
      setError(message);
    } finally {
      setLoadLoading(false);
    }
  };

  const handleLoadModel = async () => {
    const trimmed = loadId.trim();
    if (!trimmed) {
      setError("Zadaj ID modelu.");
      return;
    }
    requestOpenWithSave(() => {
      void doLoadModelById(trimmed);
    });
  };

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
    await fetchModels();
  };

  const requestOpenWithSave = (action) => {
    if (!engineJson && !xml) {
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
    const action = pendingOpenActionRef.current;
    pendingOpenActionRef.current = null;
    if (action) {
      window.setTimeout(() => {
        action();
      }, 1000);
    }
  };

  const handleOpenWithoutSave = () => {
    const action = pendingOpenActionRef.current;
    pendingOpenActionRef.current = null;
    setSavePromptOpen(false);
    if (action) {
      action();
    }
  };

  const handleCancelOpen = () => {
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
      if (loadId.trim() === id) {
        setLoadId("");
      }
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

  const doLoadModelFromList = async (id) => {
    setError(null);
    setInfo(null);
    try {
      const resp = await loadWizardModel(id);
      applyLoadedModel(resp, { closeModels: true });
      setInfo("Model bol nacitany.");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa nacitat model.";
      setError(message);
    }
  };

  const loadModelFromList = async (id) => {
    requestOpenWithSave(() => {
      void doLoadModelFromList(id);
    });
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
      setXml(newXml);
      setSelectedLane(null);
      setLaneDescription("");
      setInfo("BPMN model bol importovaný do Karty procesu.");
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
      setXml(updatedXml);
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

  return (
    <div className="process-card-layout" ref={layoutRef}>
      <div className="process-card-rail">
        <div className="process-card-rail-group">
          <div className="process-card-rail-title">Proces</div>
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
            onClick={() => setDrawerOpen((prev) => !prev)}
          >
            {drawerOpen ? "Skryť kartu procesu" : "Karta procesu"}
          </button>
          <button
            type="button"
            className={`process-card-toggle ${metaOpen ? "is-active" : ""}`}
            style={
              metaOpen
                ? {
                    backgroundColor: "#1b3a6b",
                    color: "#fff",
                    borderColor: "#2f5ca0",
                    boxShadow: "0 0 0 1px rgba(47,92,160,0.6)",
                  }
                : undefined
            }
            onClick={() => setMetaOpen((prev) => !prev)}
          >
            {metaOpen ? "Skryt meta udaje" : "Meta udaje"}
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
            onClick={() => setHelpOpen((prev) => !prev)}
          >
            {helpOpen ? "Skryť pomocník" : "Pomocník"}
          </button>
          <button
            type="button"
            className="process-card-toggle process-card-toggle--new-model"
            onClick={handleNewModel}
          >
            Nový model
          </button>
        </div>

        <div className="process-card-rail-divider" />

        <div className="process-card-rail-group">
          <div className="process-card-rail-title">Mentor</div>
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
            onClick={() => setMentorOpen((prev) => !prev)}
          >
            {mentorOpen ? "Skryť poznámky mentora" : "Poznámky mentora"}
          </button>
          <button
            type="button"
            className={`process-card-toggle process-card-toggle--mentor-review ${mentorStale ? "is-stale" : ""}`}
            onClick={() => {
              setMentorOpen(true);
              runMentorReview();
            }}
            disabled={mentorLoading}
          >
            {mentorLoading ? "Kontrolujem..." : "Spustiť kontrolu"}
          </button>
        </div>

        <div className="process-card-rail-divider" />

        <div className="process-card-rail-group">
          <div className="process-card-rail-title">Uloženie</div>
          <button type="button" className="process-card-toggle process-card-toggle--models" onClick={openModels}>
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
        </div>

        <div className="process-card-rail-spacer" />

        <div className="process-card-rail-group">
          <div className="process-card-rail-title">Projekt</div>
          <button
            type="button"
            className={`process-card-toggle process-card-toggle--notes ${notesOpen ? "is-active" : ""}`}
            onClick={() => setNotesOpen(true)}
          >
            Poznámky
          </button>
        </div>
      </div>

      {drawerOpen || metaOpen || helpOpen || mentorOpen ? (
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
              className={`process-card-drawer ${drawerOpen ? "is-open" : ""}`}
              style={{
                height: !helpOpen && !mentorOpen ? "100%" : processPanelHeight,
                minHeight: 320,
                overflow: "auto",
              }}
            >
              <div className="process-card-header">
                <div>
                  <div className="process-card-label">Karta procesu</div>
                  <div className="process-card-description">Vyplň vstupy pre generovanie BPMN a meta údaje.</div>
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
                    <h2>Generovanie BPMN</h2>
                    <span className="process-card-pill">Vstup</span>
                  </div>
                  <label className="wizard-field">
                    <span>Názov procesu</span>
                    <input
                      value={generatorInput.processName}
                      onChange={(e) => updateGeneratorInput("processName", e.target.value)}
                      placeholder="Spracovanie žiadosti"
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Role / swimlanes (po jednej na riadok)</span>
                    <textarea
                      value={generatorInput.roles}
                      onChange={(e) => updateGeneratorInput("roles", e.target.value)}
                      rows={4}
                      placeholder={"Klient\nBack office"}
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Spúšťač procesu</span>
                    <input
                      value={generatorInput.trigger}
                      onChange={(e) => updateGeneratorInput("trigger", e.target.value)}
                      placeholder="Napíšte čo proces spustí"
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Vstup</span>
                    <textarea
                      value={generatorInput.input}
                      onChange={(e) => updateGeneratorInput("input", e.target.value)}
                      rows={2}
                      placeholder="Zoznam vstupov pre proces"
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Výstup</span>
                    <textarea
                      value={generatorInput.output}
                      onChange={(e) => updateGeneratorInput("output", e.target.value)}
                      rows={2}
                      placeholder="Konečný výstup procesu"
                    />
                  </label>
                  <div className="process-card-buttons">
                    <button className="btn btn-primary" type="button" onClick={handleGenerate} disabled={isLoading}>
                      {isLoading ? "Generujem..." : "Vygenerovať BPMN"}
                    </button>
                    <button className="btn" type="button" onClick={handleSaveModel} disabled={saveLoading}>
                      {saveLoading ? "Ukladám..." : "Uložiť model"}
                    </button>
                    <button className="btn btn-danger" type="button" onClick={handleNewModel}>
                      Nový model
                    </button>
                  </div>
                </section>
                <section className="process-card-section process-card-section--actions">
                  <div className="process-card-actions">
                    <button className="btn" type="button" onClick={handleExportBpmn} disabled={exportLoading}>
                      {exportLoading ? "Exportujem..." : "Export BPMN"}
                    </button>
                    <button className="btn" type="button" onClick={handleImportClick} disabled={importLoading}>
                      {importLoading ? "Importujem..." : "Import BPMN"}
                    </button>
                  </div>
                  <div className="process-card-inline-load">
                    <input
                      type="text"
                      placeholder="Model ID"
                      value={loadId}
                      onChange={(e) => setLoadId(e.target.value)}
                      className="wizard-load-input"
                    />
                    <button className="btn btn--small" type="button" onClick={handleLoadModel} disabled={loadLoading}>
                      {loadLoading ? "Načítavam..." : "Načítaj"}
                    </button>
                  </div>
                </section>

                {error ? <div className="wizard-error">{error}</div> : null}
                {info ? <div className="wizard-toast">{info}</div> : null}
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

          {metaOpen ? (
            <div className="process-card-drawer is-open process-card-meta">
              <div className="process-card-header">
                <div>
                  <div className="process-card-label">Meta udaje o procese</div>
                  <div className="process-card-description">Dopln popis a vlastnosti procesu.</div>
                </div>
                <button
                  type="button"
                  className="process-card-close"
                  aria-label="Zavriet meta udaje"
                  onClick={() => setMetaOpen(false)}
                >
                  ?-
                </button>
              </div>
              <div className="process-card-body">
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
                    <label className="wizard-field">
                      <span>Status</span>
                      <select value={processMeta.status} onChange={(e) => updateProcessMeta("status", e.target.value)} >
                        <option value="Draft">Draft</option>
                        <option value="Review">Review</option>
                        <option value="Approved">Approved</option>
                        <option value="Deprecated">Deprecated</option>
                      </select>
                    </label>
                    <label className="wizard-field">
                      <span>Verzia</span>
                      <input value={processMeta.version} onChange={(e) => updateProcessMeta("version", e.target.value)} />
                    </label>
                    <label className="wizard-field">
                      <span>Interne ID</span>
                      <input value={processMeta.internalId} onChange={(e) => updateProcessMeta("internalId", e.target.value)} />
                    </label>
                    <label className="wizard-field">
                      <span>Tagy</span>
                      <input value={processMeta.tags} onChange={(e) => updateProcessMeta("tags", e.target.value)} />
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
                </div>
                <button
                  type="button"
                  className="process-card-close"
                  aria-label="Zavrieť pomocníka"
                  onClick={() => setHelpOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="process-card-body">
                <div className="wizard-help-list">
                  {HELP_RULES.map((rule) => {
                    const segments = buildHelpTemplateSegments(rule);
                    const fieldsByToken = (rule.fields || []).reduce((acc, field) => {
                      acc[field.token] = field;
                      return acc;
                    }, {});
                    const isActive = helpActiveRuleId === rule.id;
                    return (
                      <div key={rule.title} className="wizard-help-item">
                        <div className="wizard-help-head">
                          <div className="wizard-help-head__title">
                            <strong>{rule.title}</strong>
                          </div>
                          <div className="wizard-help-head__icon">
                            {rule.iconClass ? (
                              <span className={`wizard-help-icon ${rule.iconClass}`} aria-hidden="true" />
                            ) : null}
                          </div>
                        </div>
                      <div className="wizard-help-body">
                        {rule.description ? (
                          <div className="wizard-help-line wizard-help-line--desc">
                            {rule.description}
                          </div>
                        ) : null}
                        <div className="wizard-help-line">
                          <span className="wizard-help-label">Priklad:</span>{" "}
                            <button
                              type="button"
                              className="btn btn--small btn-link wizard-help-example-btn"
                              onClick={() =>
                                setHelpActiveRuleId((prev) => (prev === rule.id ? null : rule.id))
                              }
                            >
                              <span>{rule.example}</span>
                              <span className="wizard-help-example-hint">pridaj vlastne</span>
                            </button>
                          </div>
                          <div className="wizard-help-line wizard-help-line--syntax">
                            <span className="wizard-help-label">Syntax:</span>{" "}
                            <code>{rule.syntax}</code>
                          </div>
                          {isActive ? (
                            <div className="wizard-help-builder">
                              <div className="wizard-help-tabs">
                                <button
                                  type="button"
                                  className={`btn btn--small ${helpMode === "slots" ? "btn-primary" : "btn-link"}`}
                                  onClick={() => setHelpMode("slots")}
                                >
                                  Sloty
                                </button>
                                <button
                                  type="button"
                                  className={`btn btn--small ${helpMode === "inline" ? "btn-primary" : "btn-link"}`}
                                  onClick={() => setHelpMode("inline")}
                                >
                                  Riadok
                                </button>
                              </div>
                              {helpMode === "slots" ? (
                                <div className="wizard-help-inputs">
                                  {(rule.fields || []).length ? (
                                    (rule.fields || []).map((field) => (
                                      <label key={`${rule.id}-${field.key}`} className="wizard-help-input">
                                        <span>{field.label}</span>
                                        <input
                                          type="text"
                                          value={helpInputs[rule.id]?.[field.key] || ""}
                                          placeholder={field.placeholder}
                                          onChange={(e) => updateHelpInput(rule.id, field.key, e.target.value)}
                                        />
                                      </label>
                                    ))
                                  ) : (
                                    <div className="wizard-help-empty">Tento vzor nema polia na doplnenie.</div>
                                  )}
                                </div>
                              ) : (
                                <div className="wizard-help-inline">
                                  {segments.map((segment, idx) => {
                                    if (segment.type === "text") {
                                      return (
                                        <span key={`${rule.id}-text-${idx}`} className="wizard-help-inline__text">
                                          {segment.value}
                                        </span>
                                      );
                                    }
                                    const field = fieldsByToken[segment.token];
                                    const fieldKey = field?.key || segment.token;
                                    const placeholder = field?.placeholder || segment.token;
                                    return (
                                      <input
                                        key={`${rule.id}-field-${idx}`}
                                        type="text"
                                        className="wizard-help-inline__input"
                                        value={helpInputs[rule.id]?.[fieldKey] || ""}
                                        placeholder={placeholder}
                                        onChange={(e) => updateHelpInput(rule.id, fieldKey, e.target.value)}
                                      />
                                    );
                                  })}
                                </div>
                              )}
                              <div className="wizard-help-actions">
                                <button
                                  type="button"
                                  className="btn btn--small btn-primary"
                                  onClick={() => insertHelpExample(buildHelpTemplate(rule))}
                                >
                                  Vlozit
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--small btn-link"
                                  onClick={() => clearHelpInputs(rule)}
                                >
                                  Vycistit
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
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
        <div className="wizard-viewer">
          {xml ? (
            <MapViewer {...viewerProps} />
          ) : (
            <div className="wizard-placeholder">Vyplň Kartu procesu a klikni na Vygenerovať BPMN pre náhľad.</div>
          )}
          {selectedLane ? (
            <div className="wizard-lane-panel">
              <div className="wizard-lane-panel__header" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  Lane {selectedLaneIndex >= 0 ? `${selectedLaneIndex + 1}: ` : ""}
                  {selectedLane.name || selectedLane.id}
                </span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => moveLane(selectedLane.id, -1)}
                    disabled={selectedLaneIndex <= 0}
                  >
                    Posunúť vyššie
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => moveLane(selectedLane.id, 1)}
                    disabled={selectedLaneIndex < 0 || !engineJson?.lanes || selectedLaneIndex >= engineJson.lanes.length - 1}
                  >
                    Posunúť nižšie
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn-primary"
                    onClick={() => setLaneInsertOpen(true)}
                  >
                    Pridat tvar
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn-link"
                    onClick={() => {
                      setHelpOpen(true);
                      setHelpInsertTarget({
                        type: "lane",
                        laneId: selectedLane.id,
                        laneName: selectedLane.name || selectedLane.id,
                      });
                    }}
                  >
                    POMOC
                  </button>
                </div>
              </div>
              <div className="wizard-lane-panel__hint">
                Vybraná lane. Môžeš pridať kroky, použiť POMOC alebo posunúť lane vyššie/nižšie.
              </div>

              

              
              <div className="wizard-lane-panel__content">
                <div className="wizard-lane-panel__right">
                  <div className="wizard-lane-panel__section-title">Popis lane</div>
<label className="wizard-field">
                <span>Popíš, čo sa robí v tejto lane (jeden krok na riadok)</span>
                <textarea
                  value={laneDescription}
                  onChange={(e) => setLaneDescription(e.target.value)}
                  rows={6}
                  placeholder={"Krok A\nKrok B\nKrok C"}
                />
              </label>
              <button className="btn btn-primary" type="button" onClick={handleAppendToLane} disabled={isLoading}>
                {isLoading ? "Pridávam..." : "Vytvoriť kroky v tejto lane"}
              </button>
                </div>
                <div className="wizard-lane-panel__left">
                  {laneHelperItems.length ? (
                    <div className="lane-helper">
                      <div className="lane-helper__title">Pomocnik pri zadavani</div>
                      <div className="lane-helper__list">
                        {laneHelperItems.map((item) => (
                          <div key={item.id} className={`lane-helper__row lane-helper__row--${item.type}`}>
                            <div className="lane-helper__badge">{item.badge}</div>
                            <div className="lane-helper__content">
                              <div className="lane-helper__line">
                                <span className="lane-helper__label">Riadok {item.lineNumber}:</span> {item.text}
                              </div>
                              <div className="lane-helper__hint">{item.hint}</div>
                              {item.warning ? <div className="lane-helper__warning">{item.warning}</div> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="lane-helper">
                      <div className="lane-helper__title">Pomocnik pri zadavani</div>
                      <div className="lane-helper__hint">Napis krok a ja ti ukazem, ci to bude task alebo gateway.</div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          ) : null}
        </div>

        {laneInsertOpen && selectedLane ? (
          <div className="wizard-models-modal" onClick={() => setLaneInsertOpen(false)}>
            <div className="wizard-models-panel wizard-shape-panel" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <h3 style={{ margin: 0 }}>Pridat tvar do lane</h3>
                <button className="btn btn--small" type="button" onClick={() => setLaneInsertOpen(false)}>
                  Zavriet
                </button>
              </div>
              <div className="wizard-shape-meta">Lane: {selectedLane.name || selectedLane.id}</div>
              <div className="wizard-shape-body">
                <div className="wizard-shape-list">
                  {laneShapeOptions.map((shape) => (
                    <button
                      key={shape.id}
                      type="button"
                      className={`wizard-shape-item${laneInsertType === shape.id ? " is-active" : ""}`}
                      onClick={() => setLaneInsertType(shape.id)}
                    >
                      {shape.label}
                    </button>
                  ))}
                </div>
                <div className="wizard-shape-form">
                  <label className="wizard-field">
                    <span>{activeLaneShape?.nameLabel || "Nazov"}</span>
                    <input
                      type="text"
                      value={laneInsertName}
                      onChange={(e) => updateLaneInsertName(e.target.value)}
                      placeholder={activeLaneShape?.namePlaceholder || ""}
                    />
                  </label>
                  {activeLaneShape?.helper ? (
                    <div className="wizard-shape-helper">{activeLaneShape.helper}</div>
                  ) : null}
                  <div className="wizard-shape-actions">
                    <button className="btn" type="button" onClick={() => setLaneInsertOpen(false)}>
                      Zrusit
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={handleLaneShapeCreate}
                      disabled={!canCreateLaneShape}
                    >
                      Pridat tvar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}


        {modelsOpen ? (
          <div className="wizard-models-modal" onClick={() => setModelsOpen(false)}>
            <div className="wizard-models-panel" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <h3 style={{ margin: 0 }}>Uložené modely</h3>
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
                                    onClick={() => loadModelFromList(latest.id)}
                                    disabled={loadLoading || modelsActionLoading}
                                  >
                                    Otvoriť poslednú
                                  </button>
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
                                                onClick={() => loadModelFromList(m.id)}
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

        {savePromptOpen ? (
          <div className="wizard-models-modal" onClick={handleCancelOpen}>
            <div className="wizard-models-panel" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <h3 style={{ margin: 0 }}>Ulozit model?</h3>
                <button className="btn btn--small" type="button" onClick={handleCancelOpen}>
                  Zavriet
                </button>
              </div>
              <div style={{ padding: "8px 0" }}>
                Mas rozpracovany model. Chces ho ulozit pred otvorenim ineho?
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
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
                  <div className="project-notes-flags">
                    <label>
                      <input
                        type="checkbox"
                        checked={noteDraftFlags.riziko}
                        onChange={(e) =>
                          setNoteDraftFlags((prev) => ({ ...prev, riziko: e.target.checked }))
                        }
                      />
                      <span>Riziko</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={noteDraftFlags.blokuje}
                        onChange={(e) =>
                          setNoteDraftFlags((prev) => ({ ...prev, blokuje: e.target.checked }))
                        }
                      />
                      <span>Blokuje</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={noteDraftFlags.doplnit}
                        onChange={(e) =>
                          setNoteDraftFlags((prev) => ({ ...prev, doplnit: e.target.checked }))
                        }
                      />
                      <span>Treba doplniť</span>
                    </label>
                  </div>
                  <button className="btn btn-primary" type="button" onClick={addProjectNote} disabled={!noteDraft.trim()}>
                    Pridať poznámku
                  </button>
                  {projectNotesSaving ? <div style={{ fontSize: 12, opacity: 0.7 }}>Ukladám...</div> : null}
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
                            value={note.status}
                            onChange={(e) => updateProjectNote(note.id, { status: e.target.value })}
                          >
                            <option value="working">Pracuje sa</option>
                            <option value="done">Vyriešené</option>
                          </select>
                          <div className="project-note-badges">
                            {note.flags?.riziko ? <span className="project-note-badge is-risk">Riziko</span> : null}
                            {note.flags?.blokuje ? <span className="project-note-badge is-blocker">Blokuje</span> : null}
                            {note.flags?.doplnit ? (
                              <span className="project-note-badge is-todo">Treba doplniť</span>
                            ) : null}
                          </div>
                          <div className="project-note-actions">
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
                        <div className="project-notes-flags">
                          <label>
                            <input
                              type="checkbox"
                              checked={note.flags?.riziko}
                              onChange={(e) => toggleProjectNoteFlag(note.id, "riziko", e.target.checked)}
                            />
                            <span>Riziko</span>
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={note.flags?.blokuje}
                              onChange={(e) => toggleProjectNoteFlag(note.id, "blokuje", e.target.checked)}
                            />
                            <span>Blokuje</span>
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={note.flags?.doplnit}
                              onChange={(e) => toggleProjectNoteFlag(note.id, "doplnit", e.target.checked)}
                            />
                            <span>Treba doplniť</span>
                          </label>
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
