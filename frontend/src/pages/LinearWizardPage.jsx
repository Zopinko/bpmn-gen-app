import { useEffect, useMemo, useRef, useState } from "react";
import MapViewer from "../components/MapViewer";
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
} from "../api/wizard";

const HELP_RULES = [
  {
    title: "Bežný krok (Task)",
    syntax: "ľubovoľný text na riadok",
    example: "Overíme identitu zákazníka",
  },
  {
    title: "Rozhodnutie (XOR gateway)",
    syntax: "Ak <podmienka> tak <krok>, inak <krok/koniec>",
    example: "Ak zákazník schváli ponuku tak priprav zmluvu, inak koniec",
  },
  {
    title: "Paralelné kroky (AND) – presný zápis",
    syntax: "Paralelne: <krok>; <krok>; <krok>",
    example: "Paralelne: priprav zmluvu; over identitu; nastav splátky",
  },
  {
    title: "Paralelné kroky (AND) – voľný text",
    syntax: "Zároveň/Súčasne <krok>, <krok> a <krok>",
    example: "Zároveň priprav zmluvu, over identitu a nastav splátky",
  },
];

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
  const [loadId, setLoadId] = useState("");
  const modelerRef = useRef(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [modelsActionLoading, setModelsActionLoading] = useState(false);
  const [modelsSearch, setModelsSearch] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpInsertTarget, setHelpInsertTarget] = useState({ type: "process" }); // 'process' or {type:'lane', laneId, laneName}
  const [sidebarWidth, setSidebarWidth] = useState(640);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [processPanelHeight, setProcessPanelHeight] = useState(620);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const verticalResizeStart = useRef({ y: 0, h: 0 });
  const layoutRef = useRef(null);

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
    if (helpInsertTarget?.type === "lane") {
      setLaneDescription((prev) => appendLine(prev, text));
    } else {
      setProcessCard((prev) => ({
        ...prev,
        generatorInput: {
          ...prev.generatorInput,
          mainSteps: appendLine(prev.generatorInput.mainSteps, text),
        },
      }));
    }
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

  const handleGenerate = async () => {
    setError(null);
    setInfo(null);
    setIsLoading(true);
    try {
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

  const viewerProps = useMemo(
    () => ({
      title: "Karta procesu - náhľad",
      subtitle: engineJson?.name || engineJson?.processName || "Náhľad BPMN",
      xml,
      loading: isLoading && !xml,
      error: error || "",
      onLaneSelect: setSelectedLane,
      onModelerReady: (modeler) => {
        modelerRef.current = modeler;
      },
    }),
    [engineJson, error, isLoading, xml],
  );

  const handleAppendToLane = async () => {
    if (!selectedLane || !laneDescription.trim()) {
      setError("Vyber lane a doplň aspoň jeden krok.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
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
      setInfo("Model bol uložený.");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa uložiť model.";
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

  const handleLoadModel = async () => {
    const trimmed = loadId.trim();
    if (!trimmed) {
      setError("Zadaj ID modelu.");
      return;
    }
    setError(null);
    setInfo(null);
    setLoadLoading(true);
    try {
      const resp = await loadWizardModel(trimmed);
      applyLoadedModel(resp);
      setInfo("Model bol načítaný.");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa načítať model.";
      setError(message);
    } finally {
      setLoadLoading(false);
    }
  };

  const fetchModels = async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const resp = await listWizardModels({ limit: 50, offset: 0, search: modelsSearch });
      setModels(resp?.items || []);
    } catch (e) {
      const message = e?.message || "Nepodarilo sa načítať modely.";
      setModelsError(message);
    } finally {
      setModelsLoading(false);
    }
  };

  const openModels = async () => {
    setModelsOpen(true);
    await fetchModels();
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

  const loadModelFromList = async (id) => {
    setError(null);
    setInfo(null);
    try {
      const resp = await loadWizardModel(id);
      applyLoadedModel(resp, { closeModels: true });
      setInfo("Model bol načítaný.");
    } catch (e) {
      const message = e?.message || "Nepodarilo sa načítať model.";
      setError(message);
    }
  };

  const handleExportBpmn = async () => {
    if (!engineJson) {
      setError("Najprv vygeneruj alebo naimportuj diagram.");
      return;
    }
    if (!modelerRef.current?.saveXML) {
      setError("Modeler nie je inicializovaný.");
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
      setInfo("Model bol uložený a BPMN exportovaný.");
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

  const generatorInput = processCard.generatorInput;
  const processMeta = processCard.processMeta;

  return (
    <div className="process-card-layout" ref={layoutRef}>
      <div className="process-card-rail">
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
          {helpOpen ? "Skryť pomoc" : "Pomoc"}
        </button>
      </div>

      {drawerOpen || helpOpen ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            width: "100%",
            maxWidth: 820,
            minWidth: 540,
            flex: "0 0 640px",
            overflow: "auto",
            paddingRight: 16,
          }}
        >
          {drawerOpen ? (
            <div
              className={`process-card-drawer ${drawerOpen ? "is-open" : ""}`}
              style={{ height: processPanelHeight, minHeight: 320, overflow: "auto" }}
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
                  <label className="wizard-field">
                    <span>Hlavné kroky procesu</span>
                    <textarea
                      value={generatorInput.mainSteps}
                      onChange={(e) => updateGeneratorInput("mainSteps", e.target.value)}
                      rows={6}
                      placeholder={"Krok 1\nKrok 2\nKrok 3"}
                    />
                  </label>
                  <div className="process-card-buttons">
                    <button className="btn btn-primary" type="button" onClick={handleGenerate} disabled={isLoading}>
                      {isLoading ? "Generujem..." : "Vygenerovať BPMN"}
                    </button>
                  </div>
                </section>

                <section className="process-card-section">
                  <div className="process-card-section__title">
                    <h2>Meta údaje o procese</h2>
                    <span className="process-card-pill process-card-pill--muted">Opis</span>
                  </div>
                  <div className="process-card-grid">
                    <label className="wizard-field">
                      <span>Vlastník procesu</span>
                      <input value={processMeta.owner} onChange={(e) => updateProcessMeta("owner", e.target.value)} />
                    </label>
                    <label className="wizard-field">
                      <span>Oddelenie</span>
                      <input
                        value={processMeta.department}
                        onChange={(e) => updateProcessMeta("department", e.target.value)}
                      />
                    </label>
                    <label className="wizard-field">
                      <span>Stav procesu</span>
                      <select value={processMeta.status} onChange={(e) => updateProcessMeta("status", e.target.value)}>
                        <option value="Draft">Draft</option>
                        <option value="Schválený">Schválený</option>
                        <option value="Archivovaný">Archivovaný</option>
                      </select>
                    </label>
                    <label className="wizard-field">
                      <span>Verzia</span>
                      <input value={processMeta.version} onChange={(e) => updateProcessMeta("version", e.target.value)} />
                      <small className="field-hint">
                        Verzia sa zobrazí v zozname uložených modelov, aby ste vedeli rozlíšiť jednotlivé verzie procesu.
                      </small>
                    </label>
                    <label className="wizard-field">
                      <span>Interné ID</span>
                      <input
                        value={processMeta.internalId}
                        onChange={(e) => updateProcessMeta("internalId", e.target.value)}
                      />
                    </label>
                    <label className="wizard-field">
                      <span>Tagy (čiarkou oddelené)</span>
                      <input value={processMeta.tags} onChange={(e) => updateProcessMeta("tags", e.target.value)} />
                    </label>
                  </div>
                  <label className="wizard-field">
                    <span>Popis procesu</span>
                    <textarea
                      value={processMeta.description}
                      onChange={(e) => updateProcessMeta("description", e.target.value)}
                      rows={3}
                    />
                  </label>
                </section>

                <section className="process-card-section process-card-section--actions">
                  <div className="process-card-actions">
                    <button className="btn" type="button" onClick={handleExportBpmn} disabled={exportLoading}>
                      {exportLoading ? "Exportujem..." : "Export BPMN"}
                    </button>
                    <button className="btn" type="button" onClick={handleImportClick} disabled={importLoading}>
                      {importLoading ? "Importujem..." : "Import BPMN"}
                    </button>
                    <button className="btn" type="button" onClick={handleSaveModel} disabled={saveLoading}>
                      {saveLoading ? "Ukladám..." : "Uložiť model"}
                    </button>
                    <button className="btn" type="button" onClick={openModels}>
                      Uložené modely
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
              title="Ťahaj pre zmenu výšky Karty procesu vs. Pomoc"
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

          {helpOpen ? (
            <div className="process-card-drawer is-open process-card-help">
              <div className="process-card-header">
                <div>
                  <div className="process-card-label">Pomoc</div>
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
                  aria-label="Zavrieť pomoc"
                  onClick={() => setHelpOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="process-card-body">
                <div className="wizard-help-list">
                  {HELP_RULES.map((rule) => (
                    <div key={rule.title} className="wizard-help-item">
                      <div className="wizard-help-head">
                        <strong>{rule.title}</strong>
                      </div>
                      <div className="wizard-help-body">
                        <div className="wizard-help-line">
                          <span className="wizard-help-label">Syntax:</span>{" "}
                          <code>{rule.syntax}</code>
                        </div>
                        <div className="wizard-help-line">
                          <span className="wizard-help-label">Príklad:</span>{" "}
                          <button
                            type="button"
                            className="btn btn--small btn-link"
                            onClick={() => insertHelpExample(rule.example)}
                          >
                            {rule.example}
                          </button>
                          <button
                            type="button"
                            className="btn btn--small btn-primary"
                            onClick={() => insertHelpExample(rule.example)}
                          >
                            Vložiť
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
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
                <span>Lane: {selectedLane.name || selectedLane.id}</span>
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
          ) : null}
        </div>

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
                        <td colSpan={4}>Načítavam...</td>
                      </tr>
                    ) : models.length ? (
                      [...models]
                        .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
                        .map((m) => (
                          <tr key={m.id}>
                            <td>
                              <span className="wizard-model-name" title={m.name || m.id}>
                                {m.name || m.id}
                              </span>
                            </td>
                          <td>{m.process_meta?.version || "–"}</td>
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
                        ))
                    ) : (
                      <tr>
                        <td colSpan={4}>Žiadne uložené modely.</td>
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
