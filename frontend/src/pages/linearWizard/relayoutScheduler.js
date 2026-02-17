export function createRelayoutScheduler({
  modelerRef,
  engineJsonRef,
  normalizeEngineForBackend,
  reflowLayout,
  setEngineJson,
  setXmlFull,
  setRelayouting,
  setError,
}) {
  const relayoutViewRef = { current: null };
  const relayoutSelectionRef = { current: null };
  const relayoutOverlayTimerRef = { current: null };
  const relayoutDebounceRef = { current: null };
  const relayoutKickTimerRef = { current: null };

  const captureRelayoutContext = () => {
    const modeler = modelerRef?.current;
    if (!modeler) return;
    const canvas = modeler.get("canvas");
    const selection = modeler.get("selection");
    const viewbox = canvas?.viewbox?.();
    relayoutViewRef.current = viewbox ? { ...viewbox } : null;
    const selected = selection?.get?.() || [];
    relayoutSelectionRef.current = selected.map((el) => el.id);
  };

  const restoreRelayoutContext = (modeler) => {
    if (!modeler) return;
    const canvas = modeler.get("canvas");
    const selection = modeler.get("selection");
    const elementRegistry = modeler.get("elementRegistry");
    const viewbox = relayoutViewRef.current;
    if (viewbox && typeof canvas?.viewbox === "function") {
      canvas.viewbox(viewbox);
    }
    const ids = relayoutSelectionRef.current;
    if (Array.isArray(ids) && ids.length && selection && elementRegistry) {
      const elements = ids.map((id) => elementRegistry.get(id)).filter(Boolean);
      if (elements.length) {
        selection.select(elements);
      }
    }
    relayoutViewRef.current = null;
    relayoutSelectionRef.current = null;
  };

  const runFullRelayout = async (engine, reason = "") => {
    if (!engine) return;
    captureRelayoutContext();
    setRelayouting(true);
    try {
      const resp = await reflowLayout(normalizeEngineForBackend(engine));
      const nextEngine = resp?.engine_json || engine;
      const nextXml = resp?.diagram_xml || resp?.xml || "";
      if (!nextXml) throw new Error("Relayout vrátil prázdne XML.");
      setEngineJson(nextEngine);
      setXmlFull(nextXml, `relayout:${reason}`);
    } catch (e) {
      const message = e?.message || "Nepodarilo sa prepočítať layout.";
      setError(message);
    } finally {
      if (relayoutOverlayTimerRef.current) {
        window.clearTimeout(relayoutOverlayTimerRef.current);
      }
      relayoutOverlayTimerRef.current = window.setTimeout(() => {
        setRelayouting(false);
      }, 450);
    }
  };

  const requestRelayout = (reason = "") => {
    if (relayoutDebounceRef.current) {
      window.clearTimeout(relayoutDebounceRef.current);
    }
    relayoutDebounceRef.current = window.setTimeout(() => {
      const current = engineJsonRef?.current;
      if (current) {
        runFullRelayout(current, reason);
      }
    }, 120);
  };

  const scheduleRelayoutKick = (reason = "", delay = 150) => {
    if (relayoutKickTimerRef.current) {
      window.clearTimeout(relayoutKickTimerRef.current);
    }
    relayoutKickTimerRef.current = window.setTimeout(() => {
      relayoutKickTimerRef.current = null;
      requestRelayout(reason);
    }, delay);
  };

  const cancelPendingRelayouts = () => {
    if (relayoutKickTimerRef.current) {
      window.clearTimeout(relayoutKickTimerRef.current);
      relayoutKickTimerRef.current = null;
    }
    if (relayoutDebounceRef.current) {
      window.clearTimeout(relayoutDebounceRef.current);
      relayoutDebounceRef.current = null;
    }
  };

  const dispose = () => {
    cancelPendingRelayouts();
    if (relayoutOverlayTimerRef.current) {
      window.clearTimeout(relayoutOverlayTimerRef.current);
      relayoutOverlayTimerRef.current = null;
    }
  };

  return {
    restoreRelayoutContext,
    runFullRelayout,
    requestRelayout,
    scheduleRelayoutKick,
    cancelPendingRelayouts,
    dispose,
    refs: {
      relayoutDebounceRef,
      relayoutOverlayTimerRef,
      relayoutKickTimerRef,
    },
  };
}
