import { useCallback, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

const MODES = {
  SHADOW: "shadow",
  PREVIEW: "preview",
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

const toAnnotationId = (prefix, id) =>
  `${prefix}_${id || Math.random().toString(36).slice(2, 8)}`;

export function useDualMap() {
  const [layout] = useState("single");
  const [aiMode, setAiMode] = useState(MODES.SHADOW);
  const [mapData, setMapData] = useState(() => createEmptyMapData());
  const [mapMeta, setMapMeta] = useState({ variant_requested: "main", variant_resolved: "main" });
  const [loadingMap, setLoadingMap] = useState(false);
  const [errorMap, setErrorMap] = useState("");
  const [proposals, setProposals] = useState([]);
  const [mentorMeta, setMentorMeta] = useState(null);
  const [mentorLoading, setMentorLoading] = useState(false);
  const [validatorIssues, setValidatorIssues] = useState([]);
  const [applyState, setApplyState] = useState({ status: "idle", message: "" });
  const [runId, setRunId] = useState(() => generateRunId());

  const lastInputRef = useRef({ text: "", locale: "sk" });

  const telemetry = useCallback((event, payload) => {
    if (typeof console !== "undefined" && console.info) {
      console.info(`[dual-map] ${event}`, { ...payload, timestamp: new Date().toISOString() });
    }
  }, []);

  const makePreviewRequest = useCallback(
    async ({ text, locale, kbVariant, runIdValue, signal }) => {
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
          console.warn("[dual-map] preview-json-error", jsonError);
        }
      }

      const latency = performance.now() - started;
      telemetry("fetch-preview", {
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

  const renderEnginePreview = useCallback(
    async ({ engine, locale, runIdValue, signal }) => {
      const response = await fetch("/frajer/preview-engine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ engine_json: engine, locale }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
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

  const fetchProposals = useCallback(
    async ({ text, locale, runIdValue, engine }) => {
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
            kb_version: "main",
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

  const runMentorReview = useCallback(async () => {
    const engine = mapData?.engine;
    if (!engine) {
      setProposals([]);
      setMentorMeta(null);
      return [];
    }
    const text = lastInputRef.current?.text || "";
    const locale = lastInputRef.current?.locale || "sk";
    const runIdValue = generateRunId();
    setRunId(runIdValue);
    setMentorLoading(true);
    try {
      return await fetchProposals({
        text,
        locale,
        runIdValue,
        engine,
      });
    } finally {
      setMentorLoading(false);
    }
  }, [fetchProposals, mapData?.engine]);

  const generateAll = useCallback(
    async ({ text, locale }) => {
      const trimmed = (text || "").trim();
      lastInputRef.current = { text: trimmed, locale };
      if (!trimmed) {
        setErrorMap("Text je prazdny");
        setMapData(createEmptyMapData());
        setMapMeta({ variant_requested: "main", variant_resolved: "main" });
        setProposals([]);
        setMentorMeta(null);
        setValidatorIssues([]);
        return;
      }

      const runIdValue = generateRunId();
      setRunId(runIdValue);
      setLoadingMap(true);
      setErrorMap("");
      setProposals([]);
      setMentorMeta(null);
      setValidatorIssues([]);

      try {
        const controller = new AbortController();
        const preview = await makePreviewRequest({
          text: trimmed,
          locale,
          kbVariant: "main",
          runIdValue,
          signal: controller.signal,
        });
        setMapData(preview);
        setMapMeta(preview.meta);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setErrorMap(message);
        setMapData(createEmptyMapData());
        setMapMeta({ variant_requested: "main", variant_resolved: "main" });
        telemetry("generate-error", { runId: runIdValue, message });
      } finally {
        setLoadingMap(false);
      }
    },
    [fetchProposals, makePreviewRequest, telemetry]
  );

  const generateWithAI = useCallback(
    async ({ text, locale }) => {
      const trimmed = (text || "").trim();
      lastInputRef.current = { text: trimmed, locale };
      if (!trimmed) {
        setErrorMap("Text je prazdny");
        setMapData(createEmptyMapData());
        setMapMeta({ variant_requested: "frajer-ai", variant_resolved: "frajer-ai" });
        setProposals([]);
        setMentorMeta(null);
        setValidatorIssues([]);
        return;
      }

      const runIdValue = generateRunId();
      setRunId(runIdValue);
      setLoadingMap(true);
      setErrorMap("");
      setProposals([]);
      setMentorMeta(null);
      setValidatorIssues([]);
      telemetry("generate-ai", { runId: runIdValue, locale });

      const controller = new AbortController();
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
            if (typeof detail === "string") {
              errorMessage = detail;
            } else if (detail && typeof detail === "object") {
              if (typeof detail.message === "string") {
                errorMessage = detail.message;
              }
              if (Array.isArray(detail.warnings)) {
                warningList = detail.warnings.filter((item) => typeof item === "string" && item.trim());
              }
            }
          } catch (_ignore) {
            /* fall through */
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

        const preview = await renderEnginePreview({
          engine,
          locale,
          runIdValue,
          signal: controller.signal,
        });

        const aiMeta = payload.meta || {};
        const mergedMeta = { ...preview.meta, ...aiMeta, source: "frajer-ai" };
        setMapData({ ...preview, meta: mergedMeta });
        setMapMeta(mergedMeta);

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
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setErrorMap(message);
        setMapData(createEmptyMapData());
        setMapMeta({ source: "frajer-ai", error: message });

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
        setLoadingMap(false);
      }
    },
    [renderEnginePreview, telemetry]
  );

  const refreshMap = useCallback(async () => {
    const { text, locale } = lastInputRef.current;
    if (!mapData.engine) return;
    const runIdValue = generateRunId();
    setRunId(runIdValue);
    try {
      const previewController = new AbortController();
      const preview = await renderEnginePreview({
        engine: mapData.engine,
        locale: locale || "sk",
        runIdValue,
        signal: previewController.signal,
      });
      setMapData(preview);
      setMapMeta((previous) => ({ ...previous, ...preview.meta }));
      if (text) {
        await fetchProposals({
          text,
          locale: locale || "sk",
          runIdValue,
          engine: preview.engine,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMap(message);
    }
  }, [fetchProposals, mapData.engine, renderEnginePreview]);

  const downloadEngine = useCallback(() => {
    if (!mapData?.engine) {
      telemetry("download-engine-json-miss", { runId, target: "single" });
      return false;
    }
    const blob = new Blob([JSON.stringify(mapData.engine, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `engine_${runId}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    telemetry("download-engine-json", { runId, target: "single" });
    return true;
  }, [mapData?.engine, runId, telemetry]);

  const applyMentorProposals = useCallback(
    async (selectedProposals) => {
      const items = Array.isArray(selectedProposals) ? selectedProposals : [];
      if (!items.length) {
        setApplyState({ status: "idle", message: "Ziadne navrhy na aplikovanie nie su dostupne." });
        return;
      }
      if (!mapData?.engine) {
        setApplyState({ status: "error", message: "Mapa nema nacitany engine JSON." });
        return;
      }

      const selectedIds = items.map((item) => item.id).filter(Boolean);
      const successMessage = (count) => {
        if (count === 1) return "Aplikovaný 1 návrh.";
        if (count >= 2 && count <= 4) return `Aplikované ${count} návrhy.`;
        return `Aplikovaných ${count} návrhov.`;
      };

      setApplyState({ status: "loading", message: "Aplikujem navrhy..." });

      try {
        const response = await fetch(`${API_BASE}/mentor/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            engine_json: mapData.engine,
            selected_ids: selectedIds,
            proposals: items,
          }),
        });

        if (!response.ok) {
          const rawText = await response.text();
          if (response.status === 409) {
            try {
              const conflictPayload = JSON.parse(rawText || "{}");
              const conflicts = conflictPayload?.conflicts || conflictPayload?.error || rawText;
              throw new Error(`Conflicts: ${JSON.stringify(conflicts)}`);
            } catch (parseErr) {
              throw new Error(rawText || `HTTP ${response.status}`);
            }
          }
          throw new Error(rawText || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const appliedCount = Array.isArray(data?.audit_log) ? data.audit_log.length : items.length;
        const updatedEngine = data?.engine_json;

        if (updatedEngine && Object.keys(updatedEngine).length) {
          try {
            const previewController = new AbortController();
            const preview = await renderEnginePreview({
              engine: updatedEngine,
              locale: lastInputRef.current?.locale || "sk",
              runIdValue: runId,
              signal: previewController.signal,
            });
            setMapData(preview);
            setMapMeta((previous) => ({ ...previous, ...preview.meta }));
            await fetchProposals({
              text: lastInputRef.current?.text || "",
              locale: lastInputRef.current?.locale || "sk",
              runIdValue: runId,
              engine: preview.engine,
            });
          } catch (refreshError) {
            console.warn("[dual-map] mentor-refresh-failed", refreshError);
          }
        }

        setApplyState({
          status: "success",
          message: successMessage(appliedCount),
        });
        telemetry("mentor-apply", {
          runId,
          proposals: appliedCount,
          commit: data?.audit?.commit_id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setApplyState({ status: "error", message });
        telemetry("mentor-apply-error", { runId, message });
      }
    },
    [fetchProposals, mapData?.engine, renderEnginePreview, runId, telemetry]
  );

  const applyLowRisk = useCallback(() => {
    const lowRisk = proposals.filter(
      (p) =>
        (p.risk || "").toLowerCase() === "low" &&
        Array.isArray(p.engine_patch) &&
        p.engine_patch.length > 0
    );
    if (!lowRisk.length) {
      setApplyState({
        status: "idle",
        message: "Nenašiel som žiadne návrhy s nízkym rizikom, ktoré by bolo možné automaticky aplikovať.",
      });
      return;
    }
    applyMentorProposals(lowRisk);
  }, [applyMentorProposals, proposals]);

  const applyProposal = useCallback(
    (proposal) => {
      if (proposal) {
        applyMentorProposals([proposal]);
      }
    },
    [applyMentorProposals]
  );

  const mentorAnnotations = useMemo(() => {
    const notes = [];
    proposals.forEach((proposal) => {
      const baseSeverity = mapRiskToSeverity(proposal.risk);
      if (Array.isArray(proposal.annotations) && proposal.annotations.length) {
        proposal.annotations.forEach((annotation, index) => {
          notes.push({
            id: annotation.id || toAnnotationId("proposal", `${proposal.id}_${annotation.nodeId || index}`),
            severity: annotation.severity || baseSeverity,
            title: annotation.title || proposal.summary || proposal.type,
            description: annotation.description || proposal.summary || "",
            tags: [...(annotation.tags || []), proposal.type || "proposal"],
            nodeId: annotation.nodeId,
          });
        });
      } else {
        notes.push({
          id: toAnnotationId("proposal", proposal.id),
          severity: baseSeverity,
          title: proposal.summary || proposal.type,
          description: `Confidence ${(proposal.confidence ?? 0) * 100}%`.replace("NaN", "0"),
          tags: [proposal.type || "proposal"],
        });
      }
    });
    return notes;
  }, [proposals]);

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

  const mapAnnotations = useMemo(() => {
    const combined = [];
    if (mentorAnnotations.length) {
      combined.push(...mentorAnnotations);
    }
    if (validatorAnnotations.length) {
      combined.push(...validatorAnnotations);
    }
    return combined;
  }, [mentorAnnotations, validatorAnnotations]);

  const changeAiMode = useCallback((mode) => {
    if (mode === aiMode) return;
    setAiMode(mode);
  }, [aiMode]);

  return {
    layout,
    aiMode,
    changeAiMode,
    mapData,
    mapMeta,
    loadingMap,
    errorMap,
    generateAll,
    generateWithAI,
    refreshMap,
    proposals,
    mentorMeta,
    mentorLoading,
    validatorIssues,
    runMentorReview,
    applyState,
    applyLowRisk,
    applyProposal,
    downloadEngine,
    runId,
    mapAnnotations,
    constants: { MODES },
    lastInput: lastInputRef.current,
  };
}
