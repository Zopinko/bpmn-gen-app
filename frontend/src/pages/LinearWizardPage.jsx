import { useMemo, useState } from "react";
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
import { useRef } from "react";

const DEFAULTS = {
  processName: "Spracovanie žiadosti o úver",
  roles: ["Klient", "Call centrum", "Back office"],
  startTrigger: "Klient odošle online žiadosť",
  output: "Úver je schválený alebo zamietnutý",
  steps: [
    "Overiť kompletnosť žiadosti",
    "Dohodnúť termín telefonátu s klientom",
    "Vyhodnotiť bonitu",
    "Pripraviť zmluvu a poslať na podpis",
  ],
};

const toMultiline = (items) => items.join("\n");

const splitLines = (text) =>
  (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export default function LinearWizardPage() {
  const fileInputRef = useRef(null);
  const [processName, setProcessName] = useState(DEFAULTS.processName);
  const [rolesRaw, setRolesRaw] = useState(toMultiline(DEFAULTS.roles));
  const [startTrigger, setStartTrigger] = useState(DEFAULTS.startTrigger);
  const [output, setOutput] = useState(DEFAULTS.output);
  const [stepsRaw, setStepsRaw] = useState(toMultiline(DEFAULTS.steps));
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

  const handleGenerate = async () => {
    setError(null);
    setInfo(null);
    setIsLoading(true);
    try {
      const roles = splitLines(rolesRaw);
      const steps = splitLines(stepsRaw);

      const payload = {
        process_name: processName,
        roles,
        start_trigger: startTrigger,
        output,
        steps,
      };

      const response = await generateLinearWizardDiagram(payload);
      setEngineJson(response?.engine_json || null);
      const xmlText = await renderEngineXml(response?.engine_json || payload);
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
      title: "Linear Wizard náhľad",
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
      const loadedEngine = resp?.engine_json;
      const diagram = resp?.diagram_xml;
      if (!loadedEngine || !diagram) {
        throw new Error("Model neobsahuje engine_json alebo diagram_xml.");
      }
      setEngineJson(loadedEngine);
      setXml(diagram);
      setSelectedLane(null);
      setLaneDescription("");
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
      const resp = await listWizardModels({ limit: 50, offset: 0 });
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

  const handleDeleteModel = async (id) => {
    if (!window.confirm("Naozaj chcete zmazat tento model?")) return;
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
      const loadedEngine = resp?.engine_json;
      const diagram = resp?.diagram_xml;
      if (!loadedEngine || !diagram) {
        throw new Error("Model neobsahuje engine_json alebo diagram_xml.");
      }
      setEngineJson(loadedEngine);
      setXml(diagram);
      setSelectedLane(null);
      setLaneDescription("");
      setInfo("Model bol načítaný.");
      setModelsOpen(false);
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
      // 1) Získaj presný BPMN XML z modelera (s DI/layoutom)
      const { xml: diagramXml } = await modelerRef.current.saveXML({ format: true });

      // 2) Ulož model (SAVE) na backend pred exportom
      const name =
        engineJson.name ||
        engineJson.processName ||
        engineJson.processId ||
        "process";
      await saveWizardModel({
        name,
        engine_json: engineJson,
        diagram_xml: diagramXml,
      });

      // 3) Stiahni presne to isté XML lokálne
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
      setInfo("BPMN model bol importovaný do wizzarda.");
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

  return (
    <div className="wizard-layout">
      <div className="wizard-form">
        <h1 className="wizard-heading">Linear Wizard</h1>
        <p className="wizard-subtitle">
          Rýchle zostavenie lineárneho BPMN bez AI. Vyplň role, triggery a kroky, potom klikni na Generovať.
        </p>

        <div className="wizard-section">
          <h2 className="wizard-section__title">Informácie o procese</h2>
          <label className="wizard-field">
            <span>Názov procesu</span>
            <input value={processName} onChange={(e) => setProcessName(e.target.value)} />
          </label>
          <label className="wizard-field">
            <span>Role (po jednej na riadok)</span>
            <textarea
              value={rolesRaw}
              onChange={(e) => setRolesRaw(e.target.value)}
              rows={4}
              placeholder={"Klient\nBack office"}
            />
          </label>
          <label className="wizard-field">
            <span>Spúšťač (start)</span>
            <input value={startTrigger} onChange={(e) => setStartTrigger(e.target.value)} />
          </label>
          <label className="wizard-field">
            <span>Výstup (end)</span>
            <input value={output} onChange={(e) => setOutput(e.target.value)} />
          </label>
        </div>

        <div className="wizard-section">
          <h2 className="wizard-section__title">Hlavné kroky</h2>
          <textarea
            value={stepsRaw}
            onChange={(e) => setStepsRaw(e.target.value)}
            rows={8}
            placeholder={"Krok 1\nKrok 2\nKrok 3"}
            className="wizard-steps"
          />
        </div>

        <div className="wizard-actions">
          <button className="btn btn-primary" type="button" onClick={handleGenerate} disabled={isLoading}>
            {isLoading ? "Generujem..." : "Generovať diagram"}
          </button>
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
          <div className="wizard-load-inline">
            <input
              type="text"
              placeholder="Model ID"
              value={loadId}
              onChange={(e) => setLoadId(e.target.value)}
              className="wizard-load-input"
            />
            <button className="btn btn--small" type="button" onClick={handleLoadModel} disabled={loadLoading}>
              {loadLoading ? "Načítavam..." : "Načítať"}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".bpmn,application/xml"
            style={{ display: "none" }}
            onChange={handleImportChange}
          />
        </div>
        {error ? <div className="wizard-error">{error}</div> : null}
        {info ? <div className="wizard-toast">{info}</div> : null}

        {/* engine_json náhľad bol odstránený podľa zadania */}
      </div>

      <div className="wizard-viewer">
        {xml ? (
          <MapViewer {...viewerProps} />
        ) : (
          <div className="wizard-placeholder">
            Vyplň formulár a klikni na Generovať diagram pre náhľad.
          </div>
        )}
        {selectedLane ? (
          <div className="wizard-lane-panel">
            <div className="wizard-lane-panel__header">
              Lane: {selectedLane.name || selectedLane.id}
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
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleAppendToLane}
              disabled={isLoading}
            >
              {isLoading ? "Pridávam..." : "Vytvoriť kroky v tejto lane"}
            </button>
          </div>
        ) : null}
        {modelsOpen ? (
          <div className="wizard-models-modal" onClick={() => setModelsOpen(false)}>
            <div className="wizard-models-panel" onClick={(e) => e.stopPropagation()}>
              <div className="wizard-models-header">
                <h3 style={{ margin: 0 }}>Uložené modely</h3>
                <button className="btn btn--small" type="button" onClick={fetchModels} disabled={modelsLoading}>
                  {modelsLoading ? "Načítavam..." : "Obnoviť"}
                </button>
              </div>
              {modelsError ? <div className="wizard-error">{modelsError}</div> : null}
              <div style={{ overflow: "auto" }}>
                <table className="wizard-models-table">
                  <thead>
                    <tr>
                      <th>Názov</th>
                      <th>Vytvorené</th>
                      <th>Upravené</th>
                      <th>Akcie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelsLoading ? (
                      <tr>
                        <td colSpan={4}>Načítavam...</td>
                      </tr>
                    ) : models.length ? (
                      models.map((m) => (
                        <tr key={m.id}>
                          <td>{m.name || m.id}</td>
                          <td>{m.created_at}</td>
                          <td>{m.updated_at}</td>
                          <td>
                            <div className="wizard-models-actions">
                              <button
                                className="btn btn--small"
                                type="button"
                                onClick={() => loadModelFromList(m.id)}
                                disabled={loadLoading || modelsActionLoading}
                              >
                                Otvoriť
                              </button>
                              <button
                                className="btn btn--small"
                                type="button"
                                onClick={() => handleRenameModel(m.id, m.name || m.id)}
                                disabled={modelsLoading || modelsActionLoading}
                              >
                                Premenovať
                              </button>
                              <button
                                className="btn btn--small"
                                type="button"
                                onClick={() => handleDeleteModel(m.id)}
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
    </div>
  );
}
