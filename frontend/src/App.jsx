import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import AiModeSwitch from "./components/AiModeSwitch";
import OverlayLegend from "./components/OverlayLegend";
import MapViewer from "./components/MapViewer";
import { useDualMap } from "./hooks/useDualMap";
import LinearWizardPage from "./pages/LinearWizardPage";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const DEFAULT_TEXT =
  "System vyhodnoti test. Ak je uspesny, HR pripravi ponuku. Inak HR odosle zamietnutie.";
const STORAGE_KEY_TEXT = "bpmn-gen:last-text";

const loadInitialText = () => {
  if (typeof window === "undefined") {
    return DEFAULT_TEXT;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY_TEXT) || DEFAULT_TEXT;
  } catch (error) {
    console.warn("Neviem \č\íta\ť posledn\ý text zo storage:", error);
    return DEFAULT_TEXT;
  }
};

function GeneratorPage() {
  const [text, setText] = useState(() => loadInitialText());
  const [locale, setLocale] = useState("sk");
  const [apiStatus, setApiStatus] = useState({ state: "loading", error: null });
  const [expandedProposals, setExpandedProposals] = useState({});
  const dual = useDualMap();

  useEffect(() => {
    const controller = new AbortController();

    async function fetchStatus() {
      try {
        const response = await fetch(`${API_BASE}/frajer/ai-status`, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const active = Boolean(data?.ok && data?.api_key_present !== false);
        setApiStatus({ state: active ? "active" : "inactive", error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setApiStatus({ state: "inactive", error: message });
      }
    }

    fetchStatus();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      if (text.trim()) {
        window.localStorage.setItem(STORAGE_KEY_TEXT, text);
      } else {
        window.localStorage.removeItem(STORAGE_KEY_TEXT);
      }
    } catch (error) {
      console.warn("Neviem ulo\ži\ť text do storage:", error);
    }
  }, [text]);

  const handleGenerate = () => {
    dual.generateAll({ text, locale });
  };

  const handleGenerateAI = () => {
    dual.generateWithAI({ text, locale });
  };

  const handleDownload = () => {
    const ok = dual.downloadEngine();
    if (!ok) {
      window.alert("Engine JSON e\šte nie je k dispoz\ícii.");
    }
  };

  const apiStatusLabel = useMemo(() => {
    if (apiStatus.state === "loading") {
      return "Kontrolujem";
    }
    if (apiStatus.state === "active") {
      return "Akt\ívny";
    }
    return "Neakt\ívny";
  }, [apiStatus.state]);

  const mapSubtitle = useMemo(() => {
    const fallback = dual.mapMeta?.fallback ? " (n\áhradn\ý re\žim)" : "";
    return `KB: ${dual.mapMeta?.variant_resolved || "main"}${fallback}`;
  }, [dual.mapMeta]);

  const mentorInfo = useMemo(() => {
    const meta = dual.mentorMeta;
    if (!meta) {
      return dual.proposals.length
        ? "Mentor re\žim: nahr\ávam \údaje..."
        : "Mentor re\žim: \čak\á na n\áh\ľad.";
    }
    const modeLabel = meta.mode === "llm" ? "AI" : "Heuristick\ý";
    const provider = meta.provider || "nezn\ámy";
    const modelPart = meta.model ? ` / ${meta.model}` : "";
    const fallback = meta.fallback ? " (n\áhradn\ý re\žim)" : "";
    const errorPart = meta.error ? ` a ${meta.error}` : "";
    return `Mentor re\žim: ${modeLabel}${fallback} [${provider}${modelPart}]${errorPart}`;
  }, [dual.mentorMeta, dual.proposals.length]);

  const mapTitle = (() => {
    const suffix = dual.mapMeta?.source === "frajer-ai" ? " (Frajer AI)" : "";
    if (dual.aiMode === "shadow") {
      return `Mapa - konzervat\ívny re\žim${suffix}`;
    }
    if (dual.aiMode === "preview") {
      return `Mapa - kreat\ívny re\žim${suffix}`;
    }
    return `Mapa${suffix}`;
  })();

  const mapProps = {
    title: mapTitle,
    subtitle: mapSubtitle,
    xml: dual.mapData.xml,
    loading: dual.loadingMap,
    error: dual.errorMap,
    annotations: dual.mapAnnotations,
    onRefresh: dual.lastInput?.text ? dual.refreshMap : undefined,
  };

  return (
    <div className="app">
      <aside className="control-panel">
        <div className={`api-status api-status--${apiStatus.state}`}>
          <span className="api-status__label">API key:</span>
          <span className="api-status__value">{apiStatusLabel}</span>
        </div>
        {apiStatus.error ? <p className="api-status__hint">{apiStatus.error}</p> : null}

        <section className="control-section">
          <h2 className="control-title">Popis procesu</h2>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="control-textarea"
            placeholder="Zadaj popis procesu v prirodzenom jazyku"
            rows={6}
          />
          <div className="control-row">
            <label className="control-label">Jazyk</label>
            <select value={locale} onChange={(event) => setLocale(event.target.value)} className="control-select">
              <option value="sk">Sloven\čina</option>
              <option value="en">Angli\čtina</option>
            </select>
          </div>
          <div className="control-row control-row--buttons">
            <button type="button" className="btn btn-primary" onClick={handleGenerate}>
              Generova\ť mapu
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleGenerateAI}
              disabled={dual.loadingMap || apiStatus.state !== "active"}
              title={apiStatus.state !== "active" ? "Frajer AI nie je dostupn\ý" : undefined}
            >
              Generova\ť s AI
            </button>
            <button type="button" className="btn" onClick={dual.refreshMap} disabled={!dual.lastInput?.text}>
              Obnovi\ť mapu
            </button>
          </div>
          <div className="control-run-id">ID behu: {dual.runId}</div>
        </section>

        <section className="control-section">
          <h2 className="control-title">Re\žim generovania</h2>
          <AiModeSwitch value={dual.aiMode} onChange={dual.changeAiMode} disabled={false} />
        </section>

        <section className="control-section">
          <h2 className="control-title">N\ávrhy mentora</h2>
          <p className="control-note">{mentorInfo}</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={dual.runMentorReview}
            disabled={dual.mentorLoading || !dual.mapData?.engine}
          >
            Spusti? mentora
          </button>
          {dual.proposals.length ? (
            <ul className="proposals-list">
              {dual.proposals.map((proposal) => (
                <li key={proposal.id} className={`proposal proposal--${(proposal.risk || "low").toLowerCase()}`}>
                  <div className="proposal__title">{proposal.summary || proposal.type}</div>
                  <div className="proposal__meta">
                    <span>Typ: {proposal.type}</span>
                    <span>Riziko: {proposal.risk}</span>
                    <span>D\ôvera: {Math.round((proposal.confidence ?? 0) * 100)}%</span>
                  </div>
                  {proposal.annotations?.length ? (
                    <ul className="proposal__annotations">
                      {proposal.annotations.map((annotation) => (
                        <li key={annotation.id || `${proposal.id}-${annotation.nodeId || annotation.title}`}>
                          <div className="proposal__annotation-title">{annotation.title}</div>
                          {annotation.description ? (
                            <div className="proposal__annotation-description">{annotation.description}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="proposal__actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn--small"
                      onClick={() =>
                        setExpandedProposals((prev) => ({
                          ...prev,
                          [proposal.id]: !prev[proposal.id],
                        }))
                      }
                    >
                      {expandedProposals[proposal.id] ? "Skry\ť detaily" : "Zobrazi\ť detaily"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn--small"
                      onClick={() => dual.applyProposal(proposal)}
                      disabled={dual.applyState.status === "loading"}
                    >
                      Pou\ži\ť
                    </button>
                  </div>
                  {expandedProposals[proposal.id] ? (
                    <div className="proposal__details">
                      {proposal.engine_patch ? (
                        <pre className="proposal__patch-preview">
                          {JSON.stringify(proposal.engine_patch, null, 2)}
                        </pre>
                      ) : (
                        <div className="proposal__patch-preview proposal__patch-preview--empty">
                          \Žiadna engine patch sekcia.
                        </div>
                      )}
                      {Array.isArray(proposal.engine_patch) && dual.mapData?.engine?.nodes ? (
                        (() => {
                          const nodes = dual.mapData.engine.nodes || [];
                          const nameChanges = proposal.engine_patch
                            .map((op) => {
                              const path = op?.path || "";
                              const match = typeof path === "string" ? path.match(/^\/nodes\/(\d+)\/name$/) : null;
                              if (!match) return null;
                              const idx = Number(match[1]);
                              const node = nodes[idx] || {};
                              const oldValue = node?.name;
                              const newValue = op?.value;
                              return { idx, oldValue, newValue };
                            })
                            .filter(Boolean);
                          return nameChanges.length ? (
                            <ul className="proposal__name-diff">
                              {nameChanges.map((change) => (
                                <li key={`${proposal.id}-node-${change.idx}`}>
                                  <div>Pred: {change.oldValue ?? "(pr\ázdne)"}</div>
                                  <div>Po: {change.newValue ?? "(pr\ázdne)"}</div>
                                </li>
                              ))}
                            </ul>
                          ) : null;
                        })()
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="control-note">
              Pre zobrazenie n\ávrhov klikni na Generova\ť mapu alebo Generova\ť s AI.
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={dual.applyLowRisk}
            disabled={!dual.proposals.length || dual.applyState.status === "loading"}
          >
            Pou\ži\ť n\ávrhy s n\ízkym rizikom
          </button>
          {dual.applyState?.message ? (
            <div className={`apply-status apply-status--${dual.applyState.status}`}>
              {dual.applyState.message}
            </div>
          ) : null}
        </section>

        <section className="control-section">
          <h2 className="control-title">Stiahnutie</h2>
          <button type="button" className="btn" onClick={handleDownload}>
            Stiahnu\ť Engine JSON
          </button>
        </section>

        <section className="control-section">
          <OverlayLegend />
        </section>
      </aside>

      <main className="map-panel">
        <MapViewer {...mapProps} />
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="app-nav">
          <div className="app-nav__brand">BPMN.GEN</div>
          <nav className="app-nav__links">
            <Link to="/" className="app-nav__link">
              Text → mapa
            </Link>
            <Link to="/wizard/linear" className="app-nav__link">
              Karta procesu
            </Link>
          </nav>
        </header>
        <main className="app-shell__body">
          <Routes>
            <Route path="/" element={<GeneratorPage />} />
            <Route path="/wizard/linear" element={<LinearWizardPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
