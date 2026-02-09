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
  listWizardModels,
  deleteWizardModel,
  renameWizardModel,
  getProjectNotes,
  saveProjectNotes,
  mentorReview,
  mentorApply,
} from "../api/wizard";
import { createOrgFolder, createOrgProcess, getOrgModel } from "../api/orgModel";
import { createDefaultProcessStoryOptions, generateProcessStory } from "../processStory/generateProcessStory";

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
  const navigate = useNavigate();
  const { modelId: routeModelId } = useParams();
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
  const [storyOpen, setStoryOpen] = useState(false);
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
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const pendingOpenActionRef = useRef(null);
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
  const laneHelperItems = useMemo(() => analyzeLaneLines(laneDescription), [laneDescription]);
  const openSingleCard = (cardKey) => {
    setOrgOpen(cardKey === "org");
    setDrawerOpen(cardKey === "drawer");
    setMetaOpen(cardKey === "meta");
    setHelpOpen(cardKey === "help");
    setStoryOpen(cardKey === "story");
    setMentorOpen(cardKey === "mentor");
  };
  const toggleSingleCard = (cardKey) => {
    const isOpen =
      (cardKey === "org" && orgOpen) ||
      (cardKey === "drawer" && drawerOpen) ||
      (cardKey === "meta" && metaOpen) ||
      (cardKey === "help" && helpOpen) ||
      (cardKey === "story" && storyOpen) ||
      (cardKey === "mentor" && mentorOpen);
    if (isOpen) {
      openSingleCard(null);
      return;
    }
    openSingleCard(cardKey);
  };
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
      lines.push("Rozhodnutia");
      doc.decisions.forEach((decision) => {
        lines.push(decision.title);
        (decision.branches || []).forEach((branch) => {
          lines.push(`- ${branch.intro}`);
          (branch.steps || []).forEach((step) => lines.push(`  - ${step.text}`));
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

  const renderHelpList = () => (
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

    if (!laneElement || !modeling || !elementFactory) {
      setError("Lane sa nepodarilo najst.");
      return;
    }

    const gatewayType = blockType === "and" ? "bpmn:ParallelGateway" : "bpmn:ExclusiveGateway";
    const taskLabelBase = blockType === "and" ? "Paralela" : "Vetva";
    const gatewaySize = { width: 72, height: 72 };
    const taskSize = { width: 190, height: 78 };
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

    const createdSplit = modeling.createShape(splitShape, splitPos, laneElement);
    const createdTaskA = modeling.createShape(taskA, { x: taskX, y: taskATop }, laneElement);
    const createdTaskB = modeling.createShape(taskB, { x: taskX, y: taskBTop }, laneElement);
    const createdJoin = modeling.createShape(joinShape, { x: joinX, y: joinY }, laneElement);

    modeling.updateProperties(createdTaskA, { name: `${taskLabelBase} A` });
    modeling.updateProperties(createdTaskB, { name: `${taskLabelBase} B` });

    if (lastNode) {
      modeling.connect(lastNode, createdSplit);
    }
    modeling.connect(createdSplit, createdTaskA);
    modeling.connect(createdSplit, createdTaskB);
    modeling.connect(createdTaskA, createdJoin);
    modeling.connect(createdTaskB, createdJoin);

    selection?.select(createdJoin);
    if (typeof canvas?.scrollToElement === "function") {
      canvas.scrollToElement(createdJoin);
    }

    setError(null);
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
      onInsertBlock: insertLaneBlock,
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
      insertLaneBlock,
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

  const refreshOrgTree = async () => {
    setOrgLoading(true);
    setOrgError(null);
    try {
      const tree = await getOrgModel();
      setOrgTree(tree);
    } catch (e) {
      setOrgError(e?.message || "Nepodarilo sa nacitat Model organizacie.");
    } finally {
      setOrgLoading(false);
    }
  };

  const toggleOrgFolder = (folderId) => {
    setExpandedOrgFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const handleCreateOrgFolder = async () => {
    const name = window.prompt("Nazov priecinka");
    if (!name || !name.trim()) return;
    try {
      const result = await createOrgFolder({ parentId: selectedOrgFolderId, name: name.trim() });
      setOrgTree(result?.tree || null);
      setExpandedOrgFolders((prev) => ({ ...prev, [selectedOrgFolderId]: true }));
    } catch (e) {
      window.alert(e?.message || "Nepodarilo sa vytvorit priecinok.");
    }
  };

  const handleCreateOrgProcess = async () => {
    const name = window.prompt("Nazov procesu");
    if (!name || !name.trim()) return;
    try {
      const result = await createOrgProcess({ parentId: selectedOrgFolderId, name: name.trim() });
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

  const renderOrgTreeNode = (node, depth = 0) => {
    if (!node) return null;
    if (node.type === "folder") {
      const expanded = Boolean(expandedOrgFolders[node.id] ?? node.id === "root");
      return (
        <div key={node.id}>
          <button
            type="button"
            className={`org-tree-node org-tree-node--folder ${
              selectedOrgFolderId === node.id ? "is-selected" : ""
            }`}
            style={{ paddingLeft: 10 + depth * 14 }}
            onClick={() => {
              setSelectedOrgFolderId(node.id);
              toggleOrgFolder(node.id);
            }}
          >
            <span>{expanded ? "▾" : "▸"}</span>
            <span>{node.name}</span>
          </button>
          {expanded ? (node.children || []).map((child) => renderOrgTreeNode(child, depth + 1)) : null}
        </div>
      );
    }
    const modelId = node?.processRef?.modelId;
    return (
      <button
        key={node.id}
        type="button"
        className="org-tree-node org-tree-node--process"
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => {
          if (!modelId) return;
          requestOpenWithSave(() => {
            navigate(`/model/${modelId}`);
          });
        }}
      >
        <span>•</span>
        <span>{node.name}</span>
      </button>
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
    void refreshOrgTree();
  }, [orgOpen]);

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
            {orgOpen ? "Skryt model organizacie" : "Model organizacie"}
          </button>
        </div>

        <div className="process-card-rail-divider" />

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
            onClick={() => toggleSingleCard("drawer")}
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
            onClick={() => toggleSingleCard("meta")}
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
            {storyOpen ? "Skryt pribeh" : "Pribeh procesu"}
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
          <div className="process-card-rail-title">Prostredie</div>
          <button type="button" className="process-card-toggle" onClick={() => navigate("/")}>
            Karta procesu
          </button>
          <button type="button" className="process-card-toggle" onClick={() => navigate("/text")}>
            Text - mapa
          </button>
        </div>

        <div className="process-card-rail-divider" />

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

      {drawerOpen || metaOpen || helpOpen || mentorOpen || storyOpen || orgOpen ? (
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
                      placeholder="Sem napíš názov procesu"
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Role / swimlanes (po jednej na riadok)</span>
                    <textarea
                      value={generatorInput.roles}
                      onChange={(e) => updateGeneratorInput("roles", e.target.value)}
                      rows={4}
                      placeholder={"Každú rolu napíš na nový riadok"}
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Spúšťač procesu</span>
                    <input
                      value={generatorInput.trigger}
                      onChange={(e) => updateGeneratorInput("trigger", e.target.value)}
                      placeholder="Čo proces spustí?"
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Vstup</span>
                    <textarea
                      value={generatorInput.input}
                      onChange={(e) => updateGeneratorInput("input", e.target.value)}
                      rows={2}
                      placeholder="Aká udalosť je začiatkom procesu?"
                    />
                  </label>
                  <label className="wizard-field">
                    <span>Výstup</span>
                    <textarea
                      value={generatorInput.output}
                      onChange={(e) => updateGeneratorInput("output", e.target.value)}
                      rows={2}
                      placeholder="Aký je výsledok procesu?"
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

          {orgOpen ? (
            <div className="process-card-drawer is-open process-card-org">
              <div className="process-card-header">
                <div>
                  <div className="process-card-label">Model organizacie</div>
                  <div className="process-card-description">
                    Strom procesov. Vyber priecinok a pridaj Folder alebo Process.
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
                <div className="org-sidebar__actions">
                  <button type="button" className="btn btn--small" onClick={handleCreateOrgFolder}>
                    + Folder
                  </button>
                  <button type="button" className="btn btn--small" onClick={handleCreateOrgProcess}>
                    + Process
                  </button>
                  <button type="button" className="btn btn--small" onClick={refreshOrgTree} disabled={orgLoading}>
                    Obnovit
                  </button>
                </div>
                {orgLoading ? <div className="org-sidebar__hint">Nacitavam strom...</div> : null}
                {orgError ? <div className="org-sidebar__hint org-sidebar__hint--error">{orgError}</div> : null}
                <div className="org-tree">{renderOrgTreeNode(orgTree)}</div>
              </div>
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
                    <h2>Kratke zhrnutie</h2>
                  </div>
                  {storyDoc?.summary?.length ? (
                    storyDoc.summary.map((line, idx) => (
                      <p key={`story-summary-${idx}`} className="process-story-paragraph">
                        {line}
                      </p>
                    ))
                  ) : (
                    <div className="process-story-empty">
                      {engineJson ? "Klikni na Prepocitat pre zhrnutie." : "Najprv nacitaj alebo vytvor mapu."}
                    </div>
                  )}
                </section>

                <section className="process-card-section">
                  <div className="process-card-section__title">
                    <h2>Hlavny priebeh</h2>
                  </div>
                  {storyDoc?.mainFlow?.length ? (
                    <ol className="process-story-list">
                      {storyDoc.mainFlow.map((line, idx) => (
                        <li key={`story-main-${idx}`}>{line.text}</li>
                      ))}
                    </ol>
                  ) : (
                    <div className="process-story-empty">Zatial ziadne kroky.</div>
                  )}
                </section>

                <section className="process-card-section">
                  <div className="process-card-section__title">
                    <h2>Rozhodnutia</h2>
                  </div>
                  {storyDoc?.decisions?.length ? (
                    <div className="process-story-paragraphs">
                      {storyDoc.decisions.map((decision, idx) => (
                        <div key={`story-decision-${idx}`}>
                          <p className="process-story-paragraph">
                            <strong>{decision.title}</strong>
                          </p>
                          {decision.branches.map((branch, branchIdx) => (
                            <p key={`story-decision-${idx}-branch-${branchIdx}`} className="process-story-paragraph">
                              {buildBranchParagraph(branch)}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="process-story-empty">Ziadne rozhodnutia.</div>
                  )}
                </section>

                <section className="process-card-section">
                  <div className="process-card-section__title">
                    <h2>Paralely</h2>
                  </div>
                  {storyDoc?.parallels?.length ? (
                    <div className="process-story-blocks">
                      {storyDoc.parallels.map((parallel, idx) => (
                        <div key={`story-parallel-${idx}`} className="process-story-block">
                          <div className="process-story-block__title">{parallel.title}</div>
                          {parallel.branches.map((branch, branchIdx) => (
                            <div key={`story-parallel-${idx}-branch-${branchIdx}`} className="process-story-branch">
                              <div className="process-story-branch__label">{branch.label}</div>
                              <ul>
                                {branch.steps.map((step, stepIdx) => (
                                  <li key={`story-parallel-${idx}-branch-${branchIdx}-step-${stepIdx}`}>{step.text}</li>
                                ))}
                                {branch.truncated ? <li>...</li> : null}
                              </ul>
                            </div>
                          ))}
                          {parallel.outro ? <div className="process-story-block__outro">{parallel.outro}</div> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="process-story-empty">Ziadne paralely.</div>
                  )}
                </section>

                <section className="process-card-section">
                  <div className="process-card-section__title">
                    <h2>Poznamky</h2>
                  </div>
                  {storyDoc?.notes?.length ? (
                    <ul className="process-story-notes">
                      {storyDoc.notes.map((note, idx) => (
                        <li key={`story-note-${idx}`} className={`process-story-note process-story-note--${note.severity}`}>
                          {note.text}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="process-story-empty">Bez poznamok.</div>
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
                    className="btn btn--small btn-primary"
                    onClick={() => setLaneInsertOpen(true)}
                  >
                    Pridat tvar
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn-link wizard-lane-help-btn"
                    onClick={() => {
                      if (helpOpen) {
                        openSingleCard(null);
                        return;
                      }
                      openSingleCard("help");
                      setHelpInsertTarget({
                        type: "lane",
                        laneId: selectedLane.id,
                        laneName: selectedLane.name || selectedLane.id,
                      });
                    }}
                  >
                    Pomocník
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn-link"
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
