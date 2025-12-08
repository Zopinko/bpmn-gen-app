import { useEffect, useRef, useState } from "react";
import BpmnModeler from "bpmn-js/lib/Modeler";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-codes.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";

const severityIcon = (severity) => {
  switch (severity) {
    case "success":
      return "🟢";
    case "warning":
      return "🟡";
    case "error":
      return "🔴";
    default:
      return "ℹ️";
  }
};

export default function MapViewer({
  title,
  subtitle,
  xml,
  loading = false,
  error = "",
  annotations = [],
  onRefresh,
  onLaneSelect,
  onModelerReady,
}) {
  const containerRef = useRef(null);
  const modelerRef = useRef(null);
  const [importError, setImportError] = useState("");

  useEffect(() => {
    const modeler = new BpmnModeler({
      container: containerRef.current,
    });
    modelerRef.current = modeler;

    if (typeof onModelerReady === "function") {
      onModelerReady(modeler);
    }

    const eventBus = modeler.get("eventBus");
    const overlays = modeler.get("overlays");

    let laneHandleOverlayIds = [];

    const clearLaneHandles = () => {
      if (!overlays) return;
      laneHandleOverlayIds.forEach((id) => overlays.remove(id));
      laneHandleOverlayIds = [];
    };

    const showLaneHandles = (element) => {
      if (!overlays || !element) return;

      const boType = element.businessObject && element.businessObject.$type;
      if (boType !== "bpmn:Lane" && boType !== "bpmn:Participant") {
        return;
      }

      clearLaneHandles();

      const createGuide = (width, height) => {
        const div = document.createElement("div");
        div.className = "bpmn-lane-resize-guide";
        div.style.width = `${width}px`;
        div.style.height = `${height}px`;
        return div;
      };

      const { width, height } = element;
      if (!width || !height) return;

      const EDGE_THICKNESS = 6; // px – vizuálna šírka hitbox pásika

      // top edge guide
      laneHandleOverlayIds.push(
        overlays.add(element, "lane-handle-overlay", {
          position: { top: -EDGE_THICKNESS / 2, left: 0 },
          html: createGuide(width, EDGE_THICKNESS),
        }),
      );

      // bottom edge guide
      laneHandleOverlayIds.push(
        overlays.add(element, "lane-handle-overlay", {
          position: { bottom: -EDGE_THICKNESS / 2, left: 0 },
          html: createGuide(width, EDGE_THICKNESS),
        }),
      );

      // left edge guide
      laneHandleOverlayIds.push(
        overlays.add(element, "lane-handle-overlay", {
          position: { top: 0, left: -EDGE_THICKNESS / 2 },
          html: createGuide(EDGE_THICKNESS, height),
        }),
      );

      // right edge guide
      laneHandleOverlayIds.push(
        overlays.add(element, "lane-handle-overlay", {
          position: { top: 0, right: -EDGE_THICKNESS / 2 },
          html: createGuide(EDGE_THICKNESS, height),
        }),
      );
    };

    const handleElementClick = (event) => {
      const { element } = event;

      // always remove previous handles
      clearLaneHandles();

      const boType = element.businessObject && element.businessObject.$type;
      if (boType === "bpmn:Lane" || boType === "bpmn:Participant") {
        showLaneHandles(element);
        if (typeof onLaneSelect === "function" && boType === "bpmn:Lane") {
          onLaneSelect({
            id: element.id,
            name: element.businessObject?.name || "",
          });
        }
      } else if (typeof onLaneSelect === "function") {
        onLaneSelect(null);
      }
    };

    const handleCanvasClick = () => {
      clearLaneHandles();
      if (typeof onLaneSelect === "function") {
        onLaneSelect(null);
      }
    };

    // Štýlujeme všetky aktuálne drag ghosty (aj pre resize, aj pre move)
    const styleAllDragGhosts = () => {
      // collect all possible ghost roots (dragger nodes + current visual from event context)
      const roots = Array.from(document.querySelectorAll(".djs-dragger"));
      if (lastDragEvent?.context?.visual) {
        roots.push(lastDragEvent.context.visual);
      }
      if (lastDragEvent?.context?.gfx) {
        roots.push(lastDragEvent.context.gfx);
      }

      if (!roots.length) return;

      roots.forEach((ghostRoot) => {
        if (!ghostRoot || !ghostRoot.querySelectorAll) return;

        ghostRoot.style.background = "transparent";
        ghostRoot.style.backgroundColor = "transparent";

        ghostRoot.querySelectorAll("*").forEach((el) => {
          el.style.background = "transparent";
          el.style.backgroundColor = "transparent";
        });

        ghostRoot.querySelectorAll("rect, path, polygon, circle, ellipse").forEach((el) => {
          el.style.stroke = "#ff0000";
          el.style.strokeWidth = 2;
          el.style.fill = "none";
          el.style.fillOpacity = 0;
          el.setAttribute("stroke", "#ff0000");
          el.setAttribute("stroke-width", "2");
          el.setAttribute("fill", "none");
          el.setAttribute("fill-opacity", "0");
        });

        ghostRoot.querySelectorAll("text").forEach((el) => {
          el.style.fill = "#ff0000";
          el.setAttribute("fill", "#ff0000");
        });
      });
    };

    // Spustíme štýlovanie až v ďalšom ticku,
    // aby už boli vytvorené všetky .djs-dragger nody
    const useRaf = typeof requestAnimationFrame === "function";
    let ghostStylingHandle = null;
    let lastDragEvent = null;

    const stopGhostStyling = () => {
      if (ghostStylingHandle !== null) {
        if (useRaf) {
          cancelAnimationFrame(ghostStylingHandle);
        } else {
          clearInterval(ghostStylingHandle);
        }
        ghostStylingHandle = null;
      }
      lastDragEvent = null;
    };

    const startGhostStyling = (event) => {
      lastDragEvent = event || null;
      if (ghostStylingHandle !== null) return;

      if (useRaf) {
        const loop = () => {
          styleAllDragGhosts();
          ghostStylingHandle = requestAnimationFrame(loop);
        };
        ghostStylingHandle = requestAnimationFrame(loop);
      } else {
        ghostStylingHandle = setInterval(styleAllDragGhosts, 16);
      }
    };

    if (eventBus) {
      eventBus.on("shape.move.start", startGhostStyling);
      eventBus.on("shape.move.move", startGhostStyling);
      eventBus.on("shape.move.end", stopGhostStyling);
      eventBus.on("shape.move.cancel", stopGhostStyling);
      eventBus.on("shape.resize.start", startGhostStyling);
      eventBus.on("shape.resize.move", startGhostStyling);
      eventBus.on("shape.resize.end", stopGhostStyling);
      eventBus.on("shape.resize.cancel", stopGhostStyling);
      eventBus.on("element.click", handleElementClick);
      eventBus.on("canvas.click", handleCanvasClick);
    }

    return () => {
      if (typeof onModelerReady === "function") {
        onModelerReady(null);
      }
      if (eventBus) {
        eventBus.off("shape.move.start", startGhostStyling);
        eventBus.off("shape.move.move", startGhostStyling);
        eventBus.off("shape.move.end", stopGhostStyling);
        eventBus.off("shape.move.cancel", stopGhostStyling);
        eventBus.off("shape.resize.start", startGhostStyling);
        eventBus.off("shape.resize.move", startGhostStyling);
        eventBus.off("shape.resize.end", stopGhostStyling);
        eventBus.off("shape.resize.cancel", stopGhostStyling);
        eventBus.off("element.click", handleElementClick);
        eventBus.off("canvas.click", handleCanvasClick);
      }
      clearLaneHandles();
      stopGhostStyling();
      modeler.destroy();
      modelerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler) return;

    if (!xml) {
      if (modeler.clear) {
        modeler.clear();
      }
      return;
    }

    let cancelled = false;
    modeler
      .importXML(xml)
      .then(() => {
        if (cancelled) return;
        setImportError("");
        const canvas = modeler.get("canvas");
        canvas.zoom("fit-viewport", "auto");
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err?.message || String(err);
        setImportError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [xml]);

  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const overlays = modeler.get("overlays");
    if (!overlays) return;

    overlays.clear();
    if (!annotations?.length) {
      return;
    }

    annotations.forEach((note) => {
      if (!note.nodeId) return;
      const container = document.createElement("div");
      container.className = `map-overlay map-overlay--${note.severity || "info"}`;
      container.title = note.title || "";
      container.textContent = severityIcon(note.severity);
      overlays.add(note.nodeId, {
        position: { top: -12, left: -12 },
        html: container,
      });
    });
  }, [annotations, xml]);

  const displayError = error || importError;

  return (
    <div className="map-viewer">
      <div className="map-viewer__header">
        <div>
          <div className="map-viewer__title">{title}</div>
          {subtitle ? <div className="map-viewer__subtitle">{subtitle}</div> : null}
        </div>
        {onRefresh ? (
          <button
            className="map-viewer__refresh"
            onClick={onRefresh}
            type="button"
            title="Obnoviť mapu"
          >
            Obnoviť
          </button>
        ) : null}
      </div>
      <div className="map-viewer__body">
        <div ref={containerRef} className="map-viewer__canvas" />
        {loading ? <div className="map-viewer__status map-viewer__status--loading">Načítavam…</div> : null}
        {displayError ? <div className="map-viewer__status map-viewer__status--error">{displayError}</div> : null}
        {annotations?.length ? (
          <div className="map-viewer__annotations">
            {annotations.map((note) => (
              <div key={note.id} className={`map-note map-note--${note.severity || "info"}`}>
                <div className="map-note__line">
                  <span className="map-note__icon" aria-hidden>
                    {severityIcon(note.severity)}
                  </span>
                  <span className="map-note__title">{note.title}</span>
                </div>
                {note.description ? <div className="map-note__description">{note.description}</div> : null}
                {note.tags?.length ? (
                  <div className="map-note__tags">
                    {note.tags.map((tag) => (
                      <span key={tag} className="map-note__tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
