import { useCallback, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

const MODES = {

  SHADOW: "shadow",

  PREVIEW: "preview",

};

const SOURCES = {

  AI: "AI",

  FRAJER: "FRAJER",

  CUSTOM: "CUSTOM",

};

const createEmptyMapData = () => ({ xml: "", engine: null, meta: {} });

const generateRunId = () => {

  if (typeof crypto !== "undefined" && crypto.randomUUID) {

    return crypto.randomUUID();

  }

  return `run_${Date.now()}`;

};

const mapRiskToSeverity = (risk) => {

  switch ((risk || "").toLowerCase()) {

    case "low":

      return "success";

    case "medium":

      return "warning";

    case "high":

      return "error";

    default:

      return "info";

  }

};

const toAnnotationId = (prefix, id) => `${prefix}_${id || Math.random().toString(36).slice(2, 8)}`;

export function useDualMap() {

  const [layout, setLayout] = useState("split");

  const [topSource, setTopSource] = useState(SOURCES.AI);

  const [bottomSource, setBottomSource] = useState(SOURCES.FRAJER);

  const [aiMode, setAiMode] = useState(MODES.SHADOW);

  const [kbTop, setKbTop] = useState("shadow");

  const [topData, setTopData] = useState(() => createEmptyMapData());

  const [bottomData, setBottomData] = useState(() => createEmptyMapData());

  const [topMeta, setTopMeta] = useState({ variant_requested: "shadow", variant_resolved: "shadow" });

  const [bottomMeta, setBottomMeta] = useState({ variant_requested: "main", variant_resolved: "main" });

  const [loadingTop, setLoadingTop] = useState(false);

  const [loadingBottom, setLoadingBottom] = useState(false);

  const [errorTop, setErrorTop] = useState("");

  const [errorBottom, setErrorBottom] = useState("");

  const [proposals, setProposals] = useState([]);
  const [mentorMeta, setMentorMeta] = useState(null);

  const [validatorIssues, setValidatorIssues] = useState([]);

  const [applyState, setApplyState] = useState({ status: "idle", message: "" });

  const [runId, setRunId] = useState(() => generateRunId());

  const lastInputRef = useRef({ text: "", locale: "sk" });

  const topAbortRef = useRef(null);

  const bottomAbortRef = useRef(null);

  const telemetry = useCallback((event, payload) => {

    if (typeof console !== "undefined" && console.info) {

      console.info(`[dual-map] ${event}`, { ...payload, timestamp: new Date().toISOString() });

    }

  }, []);

  const safeAbort = (ref) => {

    if (ref.current) {

      ref.current.abort();

      ref.current = null;

    }

  };

  const makePreviewRequest = useCallback(

    async ({ text, locale, kbVariant, runIdValue, target, signal }) => {

      const payload = {

        text,

        locale,

        use_kb: true,

        kb: kbVariant,

      };

      const query = new URLSearchParams({

        text,

        locale,

        use_kb: "true",

        kb: kbVariant,

      }).toString();

      const started = performance.now();

      const xmlResponse = await fetch("/frajer/preview-bpmn", {

        method: "POST",

        headers: { "content-type": "application/json" },

        body: JSON.stringify(payload),

        signal,

      });

      if (!xmlResponse.ok) {

        throw new Error(`HTTP ${xmlResponse.status} ${xmlResponse.statusText}`);

      }

      const xml = await xmlResponse.text();

      const headers = xmlResponse.headers;

      const variantRequested = headers.get("x-kb-variant-requested") || kbVariant;

      const variantResolved = headers.get("x-kb-variant") || variantRequested;

      const fallback = headers.get("x-kb-fallback") === "1";

      let engine = null;

      let jsonMeta = null;

      try {

        const jsonResponse = await fetch(`/frajer/preview-json?${query}`, { signal });

        if (jsonResponse.ok) {

          const json = await jsonResponse.json();

          engine = json.after_tidy || json.draft || null;

          jsonMeta = json.meta || null;

        } else if (jsonResponse.status !== 404) {

          throw new Error(`HTTP ${jsonResponse.status} ${jsonResponse.statusText}`);

        }

      } catch (jsonError) {

        if (!(jsonError instanceof DOMException && jsonError.name === "AbortError")) {

          console.warn(`[dual-map] preview-json-error`, jsonError);

        }

      }

      const latency = performance.now() - started;

      telemetry(`fetch-${target}`, {

        runId: runIdValue,

        kbVariant: variantResolved,

        latency,

      });

      return {

        xml,

        engine,

        meta: {

          variant_requested: variantRequested,

          variant_resolved: variantResolved,

          fallback,

          json_meta: jsonMeta,

        },

      };

    },

    [telemetry]

  );

  const fetchBottom = useCallback(

    async ({ text, locale, runIdValue }) => {

      if (!text.trim()) {

        setBottomData(createEmptyMapData());

        setBottomMeta({ variant_requested: "main", variant_resolved: "main" });

                setErrorBottom("Text je prazdny");

        return null;

      }

      safeAbort(bottomAbortRef);

      const controller = new AbortController();

      bottomAbortRef.current = controller;

      setLoadingBottom(true);

      setErrorBottom("");

      try {

        const result = await makePreviewRequest({

          text,

          locale,

          kbVariant: "main",

          runIdValue,

          target: "bottom",

          signal: controller.signal,

        });

        setBottomData(result);

        setBottomMeta(result.meta);

        return result;

      } catch (error) {

        if (controller.signal.aborted) {

          return null;

        }

        const message = error instanceof Error ? error.message : String(error);

        setErrorBottom(message);

        setBottomData(createEmptyMapData());

        telemetry("fetch-bottom-error", { runId: runIdValue, message });

        throw error;

      } finally {

        setLoadingBottom(false);

      }

    },

    [makePreviewRequest, telemetry]

  );

  const fetchProposals = useCallback(

    async ({ text, locale, runIdValue, engine, kbVariant }) => {

      if (!engine) {

        setProposals([]);
        setMentorMeta(null);

        return [];

      }

      try {

        const started = performance.now();

        const response = await fetch(`${API_BASE}/mentor/review`, {

          method: "POST",

          headers: { "content-type": "application/json" },

          body: JSON.stringify({

            text,

            engine_json: engine,

            kb_version: kbVariant || "main",

            telemetry_id: runIdValue,

          }),

        });

        if (!response.ok) {

          throw new Error(`HTTP ${response.status} ${response.statusText}`);

        }

        const data = await response.json();

        const proposalsData = data.proposals || [];

        setProposals(proposalsData);
        setMentorMeta(data.meta || null);

        const latency = performance.now() - started;

        telemetry("mentor-review", { runId: runIdValue, proposals: proposalsData.length, latency });

        return proposalsData;

      } catch (error) {

        const message = error instanceof Error ? error.message : String(error);

        setProposals([]);
        setMentorMeta({ error: message });

        telemetry("mentor-review-error", { runId: runIdValue, message });

        throw error;

      }

    },

    [telemetry]

  );

  const renderEnginePreview = useCallback(

    async ({ engine, locale, runIdValue, signal }) => {

      const response = await fetch("/frajer/preview-engine", {

        method: "POST",

        headers: { "content-type": "application/json" },

        body: JSON.stringify({ engine_json: engine, locale }),

        signal,

      });

      if (!response.ok) {

        throw new Error(HTTP  );

      }

      const data = await response.json();

      telemetry("preview-engine", { runId: runIdValue, locale });

      const preparedEngine = data.after_tidy || data.prepared || data.draft || engine;

      const meta = data.meta || { locale, source: "frajer-ai" };

      return {

        xml: data.xml || "",

        engine: preparedEngine,

        meta,

      };

    },

    [telemetry]

  );


  const fetchTopShadow = useCallback(



    async ({ text, locale, runIdValue }) => {

      safeAbort(topAbortRef);

      const controller = new AbortController();

      topAbortRef.current = controller;

      setLoadingTop(true);

      setErrorTop("");

      setProposals([]);
      setMentorMeta(null);

      setValidatorIssues([]);

      try {

        const result = await makePreviewRequest({

          text,

          locale,

          kbVariant: "shadow",

          runIdValue,

          target: "top-shadow",

          signal: controller.signal,

        });

        setTopData(result);

        setTopMeta(result.meta);

        setKbTop(result.meta.variant_resolved || "shadow");

      } catch (error) {

        if (controller.signal.aborted) {

          return;

        }

        const message = error instanceof Error ? error.message : String(error);

        setErrorTop(message);

        setTopData(createEmptyMapData());

        telemetry("fetch-top-shadow-error", { runId: runIdValue, message });

      } finally {

        setLoadingTop(false);

      }

    },

    [makePreviewRequest, telemetry]

  );

  const fetchTopPreview = useCallback(

    async ({ text, locale, runIdValue, bottomResult }) => {

      setLoadingTop(true);

      setErrorTop("");

      setValidatorIssues([]);

      try {

        let reference = bottomResult;

        if (!reference || !reference.xml) {

          reference = await fetchBottom({ text, locale, runIdValue });

        }

        if (!reference) {

          throw new Error("Bottom map unavailable for preview mode.");

        }

        setTopData(reference);

        setTopMeta(reference.meta);

        setKbTop(reference.meta?.variant_resolved || "main");

        await fetchProposals({

          text,

          locale,

          runIdValue,

          engine: reference.engine,

          kbVariant: reference.meta?.variant_resolved || "main",

        });

      } catch (error) {

        const message = error instanceof Error ? error.message : String(error);

        setErrorTop(message);

        setProposals([]);
        setMentorMeta({ error: message });

        telemetry("fetch-top-preview-error", { runId: runIdValue, message });

      } finally {

        setLoadingTop(false);

      }

    },

    [fetchBottom, fetchProposals, telemetry]

  );

  const fetchTop = useCallback(

    async ({ text, locale, runIdValue, bottomResult, mode, source }) => {

      const effectiveSource = source || topSource;

      const effectiveMode = mode || aiMode;

      if (effectiveSource !== SOURCES.AI) {

        setTopSource(effectiveSource);

        setAiMode(MODES.SHADOW);

        setTopData(bottomResult || bottomData);

        setTopMeta(bottomResult?.meta || bottomMeta);

        setKbTop(bottomResult?.meta?.variant_resolved || "main");

        setProposals([]);
        setMentorMeta(null);

        setValidatorIssues([]);

        return;

      }

      setTopSource(SOURCES.AI);

      if (effectiveMode === MODES.SHADOW) {

        await fetchTopShadow({ text, locale, runIdValue });

      } else if (effectiveMode === MODES.PREVIEW) {

        await fetchTopPreview({ text, locale, runIdValue, bottomResult });
      }

    },

    [aiMode, bottomData, bottomMeta, fetchTopPreview, fetchTopShadow, topSource]

  );

  const generateWithAI = useCallback(

    async ({ text, locale }) => {

      const trimmed = text.trim();

      lastInputRef.current = { text: trimmed, locale };

      if (!trimmed) {

                setErrorTop("Text je prazdny");

                setErrorBottom("Text je prazdny");

        setTopData(createEmptyMapData());

        setBottomData(createEmptyMapData());

        setProposals([]);
        setMentorMeta(null);

        setValidatorIssues([]);

        return;

      }

      const runIdValue = generateRunId();

      setRunId(runIdValue);

      safeAbort(topAbortRef);

      const controller = new AbortController();

      topAbortRef.current = controller;

      setTopSource(SOURCES.AI);

      setAiMode(MODES.PREVIEW);

      setLoadingTop(true);

      setErrorTop("");

      setProposals([]);
      setMentorMeta(null);

      setValidatorIssues([]);

      telemetry("generate-ai", { runId: runIdValue, locale });

      let bottomResult = null;

      try {

        bottomResult = await fetchBottom({ text: trimmed, locale, runIdValue });

      } catch (bottomError) {

        // bottom map errors are handled inside fetchBottom

      }

      try {

        const response = await fetch("/frajer/ai-generate", {

          method: "POST",

          headers: { "content-type": "application/json" },

          body: JSON.stringify({ text: trimmed, language: locale }),

          signal: controller.signal,

        });

        if (!response.ok) {

          const raw = await response.text();

          let errorMessage = raw || `HTTP ${response.status} ${response.statusText}`;

          let warningList = [];

          try {

            const parsed = JSON.parse(raw);

            const detail = parsed?.detail;

            if (typeof detail === 'string') {

              errorMessage = detail;

            } else if (detail && typeof detail === 'object') {

              if (typeof detail.message === 'string') {

                errorMessage = detail.message;

              }

              if (Array.isArray(detail.warnings)) {

                warningList = detail.warnings.filter((item) => typeof item === 'string' && item.trim());

              }

            }

          } catch (parseError) {

            // fallback to raw message

          }

          const fetchError = new Error(errorMessage);

          if (warningList.length) {

            fetchError.warnings = warningList;

          }

          throw fetchError;

        }

        const payload = await response.json();

        const engine = payload.engine_json;

        if (!engine) {

          throw new Error("AI response missing engine_json.");

        }

        const preview = await renderEnginePreview({ engine, locale, runIdValue, signal: controller.signal });

        const aiMeta = payload.meta || {};

        const mergedMeta = { ...preview.meta, ...aiMeta, source: "frajer-ai" };

        setTopData({ ...preview, meta: mergedMeta });

        setTopMeta(mergedMeta);

        setKbTop("frajer-ai");

        const warnings = Array.isArray(aiMeta.warnings) ? aiMeta.warnings : [];

        if (warnings.length) {

          setValidatorIssues(

            warnings.map((message, index) => ({

              id: toAnnotationId("ai-warning", `${runIdValue}_${index}`),

              severity: "warning",

              title: "AI upozornenie",

              description: message,

              tags: ["frajer-ai"],

            }))

          );

        } else {

          setValidatorIssues([]);

        }

        telemetry("generate-ai-success", {

          runId: runIdValue,

          locale,

          nodeCount: preview.engine?.nodes?.length || 0,

        });

        if (bottomResult) {

          // bottom map already refreshed via Frajer

        }

      } catch (error) {

        if (controller.signal.aborted) {

          return;

        }

        const message = error instanceof Error ? error.message : String(error);

        setErrorTop(message);

        setTopData(createEmptyMapData());

        setTopMeta({ source: "frajer-ai", error: message });

        const warningMessages = Array.isArray(error && error.warnings) ? error.warnings : [];

        if (warningMessages.length) {

          setValidatorIssues(

            warningMessages.map((warning, index) => ({

              id: toAnnotationId("ai-warning", `${runIdValue}_error_${index}`),

              severity: "warning",

              title: "AI upozornenie",

              description: warning,

              tags: ["frajer-ai"],

            }))

          );

        } else {

          setValidatorIssues([]);

        }

        telemetry("generate-ai-error", { runId: runIdValue, message });

      } finally {

        setLoadingTop(false);

      }

    },

    [fetchBottom, renderEnginePreview, telemetry]

  );


  const generateAll = useCallback(

    async ({ text, locale }) => {

      const trimmed = text.trim();

      lastInputRef.current = { text: trimmed, locale };

      if (!trimmed) {

                setErrorTop("Text je prazdny");

                setErrorBottom("Text je prazdny");

        setTopData(createEmptyMapData());

        setBottomData(createEmptyMapData());

        setProposals([]);
        setMentorMeta(null);

        setValidatorIssues([]);

        return;

      }

      const newRunId = generateRunId();

      setRunId(newRunId);

      telemetry("generate", { runId: newRunId, source: topSource, mode: aiMode });

      try {

        const bottomResult = await fetchBottom({ text: trimmed, locale, runIdValue: newRunId });

        if (bottomResult) {

          if (topSource === SOURCES.AI) {

            await fetchTop({

              text: trimmed,

              locale,

              runIdValue: newRunId,

              bottomResult,

              mode: aiMode,

              source: SOURCES.AI,

            });

          } else {

            setTopData(bottomResult);

            setTopMeta(bottomResult.meta);

            setKbTop(bottomResult.meta?.variant_resolved || "main");

            setProposals([]);
            setMentorMeta(null);

            setValidatorIssues([]);

          }

        }

      } catch (error) {

        const message = error instanceof Error ? error.message : String(error);

        telemetry("generate-error", { runId: newRunId, message });

      }

    },

    [aiMode, fetchBottom, fetchTop, telemetry, topSource]

  );

  const refreshTop = useCallback(() => {

    const { text, locale } = lastInputRef.current;

    if (!text) return;

    const runIdValue = generateRunId();

    setRunId(runIdValue);

    fetchTop({ text, locale, runIdValue, bottomResult: bottomData, mode: aiMode, source: topSource });

  }, [aiMode, bottomData, fetchTop, topSource]);

  const refreshBottom = useCallback(() => {

    const { text, locale } = lastInputRef.current;

    if (!text) return;

    const runIdValue = generateRunId();

    setRunId(runIdValue);

    fetchBottom({ text, locale, runIdValue });

  }, [fetchBottom]);

  const changeTopSource = useCallback(

    (source) => {

      if (source === topSource) return;

      setTopSource(source);

      if (source !== SOURCES.AI) {

        setAiMode(MODES.SHADOW);

        setProposals([]);
        setMentorMeta(null);

        setValidatorIssues([]);

        if (source === SOURCES.FRAJER) {

          setTopData(bottomData);

          setTopMeta(bottomMeta);

          setKbTop(bottomMeta?.variant_resolved || "main");

        } else {

          setTopData(createEmptyMapData());

          setTopMeta({ variant_requested: "custom", variant_resolved: "custom" });

          setKbTop("n/a");

        }

        return;

      }

      const { text, locale } = lastInputRef.current;

      if (text) {

        const runIdValue = generateRunId();

        setRunId(runIdValue);

        fetchTop({ text, locale, runIdValue, bottomResult: bottomData, mode: aiMode, source: SOURCES.AI });

      }

    },

    [aiMode, bottomData, bottomMeta, fetchTop, topSource]

  );

  const changeBottomSource = useCallback((source) => {

    setBottomSource(source);

  }, []);

  const changeAiMode = useCallback(

    (mode) => {

      if (mode === aiMode) return;

      setAiMode(mode);

      if (topSource !== SOURCES.AI) return;

      const { text, locale } = lastInputRef.current;

      if (!text) return;

      const runIdValue = generateRunId();

      setRunId(runIdValue);

      fetchTop({ text, locale, runIdValue, bottomResult: bottomData, mode, source: SOURCES.AI });

    },

    [aiMode, bottomData, fetchTop, topSource]

  );

  const toggleTopFullscreen = useCallback(() => {

    setLayout((prev) => (prev === "top-fullscreen" ? "split" : "top-fullscreen"));

  }, []);

  const toggleBottomFullscreen = useCallback(() => {

    setLayout((prev) => (prev === "bottom-fullscreen" ? "split" : "bottom-fullscreen"));

  }, []);

  const swapPanels = useCallback(() => {

    setTopData((currentTop) => {

      const newTop = bottomData;

      setBottomData(currentTop);

      return newTop;

    });

    const prevTopMeta = topMeta;

    const prevTopSource = topSource;

    setTopMeta(bottomMeta);

    setBottomMeta(prevTopMeta);

    setTopSource(bottomSource);

    setBottomSource(prevTopSource);

    if (bottomSource !== SOURCES.AI) {

      setAiMode(MODES.SHADOW);

      setProposals([]);
      setMentorMeta(null);

      setValidatorIssues([]);

    }

    setKbTop(bottomMeta?.variant_resolved || "main");

  }, [bottomData, bottomMeta, bottomSource, topMeta, topSource]);

  const downloadEngine = useCallback(

    (target) => {

      const data = target === "top" ? topData : bottomData;

      if (!data || !data.engine) {

        telemetry("download-engine-json-miss", { runId, target });

        return false;

      }

      const blob = new Blob([JSON.stringify(data.engine, null, 2)], { type: "application/json" });

      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");

      link.href = url;

      link.download = `${target === "top" ? "engine_top" : "engine_bottom"}_${runId}.json`;

      document.body.appendChild(link);

      link.click();

      document.body.removeChild(link);

      URL.revokeObjectURL(url);

      telemetry("download-engine-json", { runId, target });

      return true;

    },

    [bottomData, topData, runId, telemetry]

  );

  const applyLowRisk = useCallback(async () => {

    const lowRisk = proposals.filter((p) => (p.risk || "").toLowerCase() === "low");

    if (!lowRisk.length) {

                  setApplyState({ status: "idle", message: "Ziadne navrhy s nizkym rizikom." });

      return;

    }

    try {

                  setApplyState({ status: "loading", message: "Aplikujem navrhy..." });

      const response = await fetch(`${API_BASE}/mentor/apply`, {

        method: "POST",

        headers: { "content-type": "application/json" },

        body: JSON.stringify({ proposals: lowRisk, base_kb_version: "main" }),

      });

      if (!response.ok) {

        const rawText = await response.text();

        if (response.status === 409) {
          try {
            const conflictPayload = JSON.parse(rawText || '{}');
            const conflicts = conflictPayload?.conflicts || conflictPayload?.error || rawText;
            throw new Error(`Conflicts: ${JSON.stringify(conflicts)}`);
          } catch (parseErr) {
            throw new Error(rawText || `HTTP ${response.status}`);
          }
        }

        throw new Error(rawText || `HTTP ${response.status}`);

      }

      const data = await response.json();

      setApplyState({

        status: "success",

        message: `Applied ${lowRisk.length} proposals (commit ${data?.audit?.commit_id?.slice(0, 7) || "n/a"}).`,

      });

      telemetry("mentor-apply", { runId, proposals: lowRisk.length, commit: data?.audit?.commit_id });

    } catch (error) {

      const message = error instanceof Error ? error.message : String(error);

      setApplyState({ status: "error", message });

      telemetry("mentor-apply-error", { runId, message });

    }

  }, [proposals, runId, telemetry]);

  const proposalAnnotations = useMemo(

    () =>

      proposals.map((proposal) => ({

        id: toAnnotationId("proposal", proposal.id),

        severity: mapRiskToSeverity(proposal.risk),

        title: proposal.summary || proposal.type,

        description: `Confidence ${(proposal.confidence ?? 0) * 100}%`.replace("NaN", "0"),

        tags: [proposal.type || "proposal"],

      })),

    [proposals]

  );

  const validatorAnnotations = useMemo(

    () =>

      validatorIssues.map((issue) => ({

        id: issue.id || toAnnotationId("validator", issue.title),

        severity: issue.severity || "info",

        title: issue.title || "Validator",

        description: issue.description || "",

        tags: issue.tags || ["validator"],

      })),

    [validatorIssues]

  );

  const topAnnotations = useMemo(() => {

    if (topSource !== SOURCES.AI) return [];

    if (topMeta?.source === "frajer-ai" && validatorAnnotations.length) {

      return validatorAnnotations;

    }

    if (aiMode === MODES.PREVIEW) return proposalAnnotations;

    return [];

  }, [aiMode, proposalAnnotations, topMeta, topSource, validatorAnnotations]);

  return {

    layout,

    setLayout,

    showSplit: () => setLayout("split"),

    toggleTopFullscreen,

    toggleBottomFullscreen,

    swapPanels,

    topSource,

    changeTopSource,

    bottomSource,

    changeBottomSource,

    aiMode,

    changeAiMode,

    kbTop,

    topData,

    topMeta,

    topAnnotations,

    bottomData,

    bottomMeta,

    loadingTop,

    loadingBottom,

    errorTop,

    errorBottom,

    generateAll,

    generateWithAI,

    refreshTop,

    refreshBottom,

    runId,

    proposals,

    mentorMeta,

    validatorIssues,

    applyState,

    applyLowRisk,

    canDownloadTop: Boolean(topData?.engine),

    canDownloadBottom: Boolean(bottomData?.engine),

    downloadEngine,

    constants: { MODES, SOURCES },

    lastInput: lastInputRef.current,

  };

}




