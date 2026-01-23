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
  subtitleMeta,
  subtitleProminent = false,
  xml,
  loading = false,
  error = "",
  annotations = [],
  onRefresh,
  onLaneSelect,
  onLaneOrderChange,
  onDiagramChange,
  onUndo,
  canUndo = false,
  onModelerReady,
  onInsertBlock,
}) {
  const containerRef = useRef(null);
  const modelerRef = useRef(null);
  const [importError, setImportError] = useState("");
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const hasSubtitle = Boolean(subtitle || subtitleMeta);
  const subtitleClassName = `map-viewer__subtitle${subtitleProminent ? " map-viewer__subtitle--prominent" : ""}`;
  const lastLaneOrderRef = useRef("");
  const lastViewboxRef = useRef(null);
  const hasImportedRef = useRef(false);
  const lastSavedXmlRef = useRef("");
  const laneOrderChangeRef = useRef(onLaneOrderChange);
  const diagramChangeRef = useRef(onDiagramChange);
  const changeTimerRef = useRef(null);
  const skipDiagramChangeRef = useRef(false);
  const laneHandleOverlayIdsRef = useRef([]);
  const laneHandleMapRef = useRef(new Map());
  const laneDragStartMapRef = useRef(new Map());
  const annotationOverlayIdsRef = useRef([]);
  const laneDragStateRef = useRef({
    active: false,
    laneName: "",
    targetIndex: -1,
    indicatorEl: null,
    moveHandler: null,
    upHandler: null,
  });

  useEffect(() => {
    laneOrderChangeRef.current = onLaneOrderChange;
  }, [onLaneOrderChange]);

  useEffect(() => {
    diagramChangeRef.current = onDiagramChange;
  }, [onDiagramChange]);

  const zoomBy = (delta) => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const canvas = modeler.get("canvas");
    const current = canvas.zoom();
    const next = Math.min(2.0, Math.max(0.2, current + delta));
    canvas.zoom(next);
  };

  const zoomFit = () => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const canvas = modeler.get("canvas");
    canvas.zoom("fit-viewport", "auto");
  };

  useEffect(() => {
    const modeler = new BpmnModeler({
      container: containerRef.current,
      palette: { enabled: false },
      contextPad: { enabled: false },
    });
    modelerRef.current = modeler;

    if (typeof onModelerReady === "function") {
      onModelerReady(modeler);
    }

    const eventBus = modeler.get("eventBus");
    const overlays = modeler.get("overlays");
    const elementRegistry = modeler.get("elementRegistry");
    const modeling = modeler.get("modeling");
    const connect = modeler.get("connect");
    const create = modeler.get("create");
    const elementFactory = modeler.get("elementFactory");
    const autoPlace = modeler.get("autoPlace", false);

    let laneHandleOverlayIds = [];
    let contextPadOverlayId = null;
    let contextPadElement = null;
    let contextPadContainer = null;
    let contextPadSuppressed = false;

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

    const suppressContextPad = () => {
      contextPadSuppressed = true;
      contextPadContainer?.classList.add("custom-context-pad--hidden");
    };

    const releaseContextPad = () => {
      contextPadSuppressed = false;
      contextPadContainer?.classList.remove("custom-context-pad--hidden");
    };

    const updateContextPad = (element) => {
      if (!shouldShowContextPad(element)) {
        clearContextPad();
        return;
      }
      if (contextPadElement === element && contextPadContainer) {
        if (!contextPadSuppressed) releaseContextPad();
        return;
      }
      createContextPad(element);
    };

    const clearContextPad = () => {
      if (!overlays || contextPadOverlayId === null) return;
      overlays.remove(contextPadOverlayId);
      contextPadOverlayId = null;
      contextPadElement = null;
      contextPadContainer = null;
      contextPadSuppressed = false;
    };

    const shouldShowContextPad = (element) => {
      if (!element || element.type === "label") return false;
      const boType = element.businessObject?.$type || "";
      if (!boType) return false;
      if (
        boType === "bpmn:Process" ||
        boType === "bpmn:Collaboration" ||
        boType === "bpmn:Participant" ||
        boType === "bpmn:SequenceFlow"
      ) {
        return false;
      }
      if (element === modeler.get("canvas")?.getRootElement()) return false;
      return true;
    };

    const createContextPad = (element) => {
      if (!overlays || !element) return;
      if (contextPadElement === element) return;

      clearContextPad();

      const container = document.createElement("div");
      container.className = "custom-context-pad";
      const boType = element.businessObject?.$type || "";
      const isLane = boType === "bpmn:Lane" || boType === "bpmn:Participant";

      contextPadContainer = container;
      contextPadSuppressed = false;

      const makeButton = (title, iconClass, { onClick, onStart, className, hideOnAction }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `custom-context-pad__btn${className ? ` ${className}` : ""}`;
        btn.title = title;
        btn.setAttribute("aria-label", title);
        const icon = document.createElement("span");
        icon.className = `custom-context-pad__icon ${iconClass}`;
        btn.appendChild(icon);
        const handlePointerDown = (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (hideOnAction && onStart) {
            suppressContextPad();
          }
          if (onStart) {
            onStart(event);
          }
        };
        btn.addEventListener("mousedown", handlePointerDown);
        btn.addEventListener("touchstart", handlePointerDown);
        if (onClick) {
          btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick(event);
          });
        }
        return btn;
      };

      if (isLane) {
        const laneName = element.businessObject?.name || element.businessObject?.id || "";
        const startLaneDrag = laneDragStartMapRef.current.get(element.id);

        const moveLane = (delta) => {
          if (!elementRegistry || !laneName) return;
          const handler = laneOrderChangeRef.current;
          if (typeof handler !== "function") return;
          const lanes = elementRegistry
            .getAll()
            .filter((el) => el.businessObject?.$type === "bpmn:Lane");
          if (!lanes.length) return;
          const ordered = lanes
            .map((lane) => ({
              name: lane.businessObject?.name || lane.businessObject?.id || "",
              y: typeof lane.y === "number" ? lane.y : 0,
            }))
            .filter((entry) => entry.name)
            .sort((a, b) => a.y - b.y);
          const names = ordered.map((entry) => entry.name);
          const index = names.findIndex((name) => name === laneName);
          const nextIndex = index + delta;
          if (index < 0 || nextIndex < 0 || nextIndex >= names.length) return;
          const next = [...names];
          [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
          const key = next.join("|");
          if (key === lastLaneOrderRef.current) return;
          lastLaneOrderRef.current = key;
          handler(next);
        };

        container.appendChild(
          makeButton("Add lane above", "bpmn-icon-lane-insert-above", {
            onClick: () => modeling.addLane(element, "top"),
            hideOnAction: false,
          }),
        );
        container.appendChild(
          makeButton("Add lane below", "bpmn-icon-lane-insert-below", {
            onClick: () => modeling.addLane(element, "bottom"),
            hideOnAction: false,
          }),
        );
        container.appendChild(
          makeButton("Potiahni pre presun", "bpmn-icon-hand-tool", {
            onStart: (event) => startLaneDrag?.(event),
            className: "custom-context-pad__btn--drag",
            hideOnAction: true,
          }),
        );
      } else {
        const appendShape = (type, width, height) => {
          const shape = elementFactory.createShape({ type });
          if (typeof width === "number" && typeof height === "number") {
            shape.width = width;
            shape.height = height;
          }
          const shapeWidth = shape.width || width || 0;
          const shapeHeight = shape.height || height || 0;
          if (autoPlace && typeof autoPlace.append === "function") {
            autoPlace.append(element, shape);
            return;
          }
          const parent = element.parent || element;
          const x = (element.x || 0) + (element.width || 0) + 80;
          const y = (element.y || 0) + ((element.height || 0) / 2) - (shapeHeight / 2);
          modeling.createShape(shape, { x, y }, parent);
        };

        container.appendChild(
          makeButton("Connect", "bpmn-icon-connection-multi", {
            onStart: (event) => connect.start(event, element),
            hideOnAction: true,
          }),
        );

        const addMenu = document.createElement("div");
        addMenu.className = "custom-context-pad__add-menu";

        const addButton = document.createElement("button");
        addButton.type = "button";
        addButton.className = "custom-context-pad__btn custom-context-pad__btn--add";
        addButton.setAttribute("aria-label", "Add object");
        addButton.title = "Add object";
        addButton.textContent = "+";
        addMenu.appendChild(addButton);

        const menu = document.createElement("div");
        menu.className = "custom-context-pad__menu";

        menu.appendChild(
          makeButton("Task", "bpmn-icon-task", {
            onClick: () => appendShape("bpmn:Task", 190, 78),
            hideOnAction: false,
            className: "custom-context-pad__btn--menu",
          }),
        );

        menu.appendChild(
          makeButton("Gateway", "bpmn-icon-gateway-xor", {
            onClick: () => appendShape("bpmn:ExclusiveGateway"),
            hideOnAction: false,
            className: "custom-context-pad__btn--menu",
          }),
        );

        menu.appendChild(
          makeButton("Start event", "bpmn-icon-start-event-none", {
            onClick: () => appendShape("bpmn:StartEvent"),
            hideOnAction: false,
            className: "custom-context-pad__btn--menu",
          }),
        );

        menu.appendChild(
          makeButton("End event", "bpmn-icon-end-event-none", {
            onClick: () => appendShape("bpmn:EndEvent"),
            hideOnAction: false,
            className: "custom-context-pad__btn--menu",
          }),
        );

        addMenu.appendChild(menu);
        container.appendChild(addMenu);

        const blockMenu = document.createElement("div");
        blockMenu.className = "custom-context-pad__add-menu";

        const blockButton = document.createElement("button");
        blockButton.type = "button";
        blockButton.className = "custom-context-pad__btn custom-context-pad__btn--add";
        blockButton.setAttribute("aria-label", "Block");
        blockButton.title = "Block";
        blockButton.textContent = "B";
        blockMenu.appendChild(blockButton);

        const blockList = document.createElement("div");
        blockList.className = "custom-context-pad__menu";
        blockList.appendChild(
          makeButton("XOR blok", "bpmn-icon-gateway-xor", {
            onClick: () => {
              if (typeof onInsertBlock === "function") {
                onInsertBlock("xor");
              }
            },
            hideOnAction: false,
            className: "custom-context-pad__btn--menu",
          }),
        );
        blockList.appendChild(
          makeButton("AND blok", "bpmn-icon-gateway-parallel", {
            onClick: () => {
              if (typeof onInsertBlock === "function") {
                onInsertBlock("and");
              }
            },
            hideOnAction: false,
            className: "custom-context-pad__btn--menu",
          }),
        );
        blockMenu.appendChild(blockList);
        container.appendChild(blockMenu);

        container.appendChild(
          makeButton("Text annotation", "bpmn-icon-text-annotation", {
            onStart: (event) => {
              const shape = elementFactory.createShape({ type: "bpmn:TextAnnotation" });
              create.start(event, shape, { source: element });
            },
            hideOnAction: true,
          }),
        );

        container.appendChild(
          makeButton("Delete", "bpmn-icon-trash", {
            onClick: () => modeling.removeElements([element]),
            hideOnAction: false,
          }),
        );
      }

      contextPadOverlayId = overlays.add(element, "custom-context-pad", {
        position: { top: isLane ? 6 : -8, right: isLane ? 6 : -8 },
        html: container,
      });
      contextPadElement = element;
    };

    const hideLaneHandles = () => {
      laneHandleMapRef.current.forEach((handle) => {
        handle.style.display = "none";
      });
    };

    const showLaneHandle = (laneId) => {
      hideLaneHandles();
      const handle = laneHandleMapRef.current.get(laneId);
      if (handle) {
        handle.style.display = "flex";
      }
    };

    const handleElementClick = (event) => {
      const { element } = event;

      // always remove previous handles
      clearLaneHandles();
      updateContextPad(element);

      const boType = element.businessObject && element.businessObject.$type;
      if (boType === "bpmn:Lane" || boType === "bpmn:Participant") {
        showLaneHandles(element);
        if (typeof onLaneSelect === "function" && boType === "bpmn:Lane") {
          onLaneSelect({
            id: element.id,
            name: element.businessObject?.name || "",
          });
          showLaneHandle(element.id);
        }
      } else if (typeof onLaneSelect === "function") {
        onLaneSelect(null);
        hideLaneHandles();
      }
    };

    const handleCanvasClick = () => {
      clearLaneHandles();
      clearContextPad();
      if (typeof onLaneSelect === "function") {
        onLaneSelect(null);
      }
      hideLaneHandles();
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

    const emitLaneOrder = () => {
      const handler = laneOrderChangeRef.current;
      if (typeof handler !== "function") return;
      const elementRegistry = modeler.get("elementRegistry");
      if (!elementRegistry) return;
      const laneElements = elementRegistry
        .getAll()
        .filter((el) => el.businessObject?.$type === "bpmn:Lane");
      if (!laneElements.length) return;
      const orderedNames = laneElements
        .map((el) => ({
          name: el.businessObject?.name || el.businessObject?.id || "",
          y: typeof el.y === "number" ? el.y : 0,
        }))
        .filter((entry) => entry.name)
        .sort((a, b) => a.y - b.y)
        .map((entry) => entry.name);
      if (!orderedNames.length) return;
      const key = orderedNames.join("|");
      if (key === lastLaneOrderRef.current) return;
      lastLaneOrderRef.current = key;
      handler(orderedNames);
    };

    const handleLaneMoveEnd = (event) => {
      const shape = event?.shape || event?.context?.shape || event?.element;
      const boType = shape?.businessObject?.$type;
      if (boType !== "bpmn:Lane") return;
      emitLaneOrder();
    };

    const handleDiagramChanged = () => {
      if (skipDiagramChangeRef.current) return;
      const handler = diagramChangeRef.current;
      if (typeof handler !== "function") return;
      if (!modelerRef.current?.saveXML) return;
    if (changeTimerRef.current) {
      clearTimeout(changeTimerRef.current);
    }
    changeTimerRef.current = setTimeout(async () => {
      try {
        const { xml: currentXml } = await modelerRef.current.saveXML({ format: true });
        lastSavedXmlRef.current = currentXml || "";
        handler(currentXml);
      } catch {
        // ignore sync errors from temporary model states
      }
    }, 400);
  };

    const handleViewboxChanged = (event) => {
      if (event?.viewbox) {
        lastViewboxRef.current = event.viewbox;
      }
    };

    if (eventBus) {
      eventBus.on("shape.move.start", startGhostStyling);
      eventBus.on("shape.move.move", startGhostStyling);
      eventBus.on("shape.move.end", stopGhostStyling);
      eventBus.on("shape.move.cancel", stopGhostStyling);
      eventBus.on("shape.move.end", handleLaneMoveEnd);
      eventBus.on("connect.start", suppressContextPad);
      eventBus.on("connect.end", releaseContextPad);
      eventBus.on("connect.cancel", releaseContextPad);
      eventBus.on("connect.cleanup", releaseContextPad);
      eventBus.on("create.start", suppressContextPad);
      eventBus.on("create.end", releaseContextPad);
      eventBus.on("create.cancel", releaseContextPad);
      eventBus.on("create.cleanup", releaseContextPad);
      eventBus.on("shape.resize.start", startGhostStyling);
      eventBus.on("shape.resize.move", startGhostStyling);
      eventBus.on("shape.resize.end", stopGhostStyling);
      eventBus.on("shape.resize.cancel", stopGhostStyling);
      eventBus.on("element.click", handleElementClick);
      eventBus.on("canvas.click", handleCanvasClick);
      eventBus.on("canvas.viewbox.changed", handleViewboxChanged);
      eventBus.on("commandStack.changed", handleDiagramChanged);
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
        eventBus.off("shape.move.end", handleLaneMoveEnd);
        eventBus.off("connect.start", suppressContextPad);
        eventBus.off("connect.end", releaseContextPad);
        eventBus.off("connect.cancel", releaseContextPad);
        eventBus.off("connect.cleanup", releaseContextPad);
        eventBus.off("create.start", suppressContextPad);
        eventBus.off("create.end", releaseContextPad);
        eventBus.off("create.cancel", releaseContextPad);
        eventBus.off("create.cleanup", releaseContextPad);
        eventBus.off("shape.resize.start", startGhostStyling);
        eventBus.off("shape.resize.move", startGhostStyling);
        eventBus.off("shape.resize.end", stopGhostStyling);
        eventBus.off("shape.resize.cancel", stopGhostStyling);
        eventBus.off("element.click", handleElementClick);
        eventBus.off("canvas.click", handleCanvasClick);
        eventBus.off("canvas.viewbox.changed", handleViewboxChanged);
        eventBus.off("commandStack.changed", handleDiagramChanged);
      }
      clearLaneHandles();
      clearContextPad();
      stopGhostStyling();
      hideLaneHandles();
      if (changeTimerRef.current) {
        clearTimeout(changeTimerRef.current);
        changeTimerRef.current = null;
      }
      modeler.destroy();
      modelerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!modelerRef.current) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable)
      ) {
        return;
      }

      const { key } = event;
      if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight") {
        return;
      }

      event.preventDefault();
      const canvas = modelerRef.current.get("canvas");
      const viewbox = canvas.viewbox();
      const step = event.shiftKey ? 120 : 60;
      const next = { ...viewbox };

      if (key === "ArrowUp") next.y -= step;
      if (key === "ArrowDown") next.y += step;
      if (key === "ArrowLeft") next.x -= step;
      if (key === "ArrowRight") next.x += step;

      canvas.viewbox(next);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler) return;

    if (!xml) {
      if (modeler.clear) {
        modeler.clear();
      }
      if (laneHandleOverlayIdsRef.current.length) {
        const overlays = modeler.get("overlays");
        laneHandleOverlayIdsRef.current.forEach((id) => overlays.remove(id));
        laneHandleOverlayIdsRef.current = [];
        laneHandleMapRef.current.clear();
        laneDragStartMapRef.current.clear();
      }
      return;
    }

    if (xml === lastSavedXmlRef.current) {
      return;
    }

    let cancelled = false;
    skipDiagramChangeRef.current = true;
    modeler
      .importXML(xml)
      .then(() => {
        if (cancelled) return;
        setImportError("");
        const canvas = modeler.get("canvas");
        if (hasImportedRef.current && lastViewboxRef.current) {
          canvas.viewbox(lastViewboxRef.current);
        } else {
          canvas.zoom("fit-viewport", "auto");
        }
        hasImportedRef.current = true;

        const overlays = modeler.get("overlays");
        const elementRegistry = modeler.get("elementRegistry");
        if (!overlays || !elementRegistry) return;

        laneHandleOverlayIdsRef.current.forEach((id) => overlays.remove(id));
        laneHandleOverlayIdsRef.current = [];
        laneHandleMapRef.current.clear();

        const emitLaneOrder = (orderedNames) => {
          const handler = laneOrderChangeRef.current;
          if (typeof handler !== "function") return;
          const key = orderedNames.join("|");
          if (key === lastLaneOrderRef.current) return;
          lastLaneOrderRef.current = key;
          handler(orderedNames);
        };

        const getLaneMetrics = () => {
          const lanes = elementRegistry
            .getAll()
            .filter((el) => el.businessObject?.$type === "bpmn:Lane");
          if (!lanes.length) return [];
          const viewbox = canvas.viewbox();
          return lanes
            .map((lane) => {
              const name = lane.businessObject?.name || lane.businessObject?.id || "";
              const y = typeof lane.y === "number" ? lane.y : 0;
              const height = typeof lane.height === "number" ? lane.height : 0;
              const top = (y - viewbox.y) * viewbox.scale;
              const mid = (y + height / 2 - viewbox.y) * viewbox.scale;
              const bottom = (y + height - viewbox.y) * viewbox.scale;
              return { name, y, height, top, mid, bottom };
            })
            .filter((entry) => entry.name)
            .sort((a, b) => a.y - b.y);
        };

        const cleanupDrag = () => {
          const dragState = laneDragStateRef.current;
          if (dragState.moveHandler) {
            window.removeEventListener("mousemove", dragState.moveHandler);
          }
          if (dragState.upHandler) {
            window.removeEventListener("mouseup", dragState.upHandler);
          }
          if (dragState.indicatorEl?.parentNode) {
            dragState.indicatorEl.parentNode.removeChild(dragState.indicatorEl);
          }
          laneDragStateRef.current = {
            active: false,
            laneName: "",
            targetIndex: -1,
            indicatorEl: null,
            moveHandler: null,
            upHandler: null,
          };
        };

        const beginLaneDrag = (laneName) => (event) => {
          const handler = laneOrderChangeRef.current;
          if (typeof handler !== "function") return;
          if (!laneName) return;
          event.preventDefault();
          const dragState = laneDragStateRef.current;
          if (dragState.active) return;

          const container = canvas.getContainer();
          if (!container) return;
          const indicator = document.createElement("div");
          indicator.className = "lane-dnd-indicator";
          container.appendChild(indicator);

          const updateIndicator = (clientY) => {
            const metrics = getLaneMetrics();
            if (!metrics.length) return { targetIndex: -1, orderedNames: [] };
            const containerRect = container.getBoundingClientRect();
            const relY = clientY - containerRect.top;
            let targetIndex = metrics.findIndex((entry) => relY < entry.mid);
            if (targetIndex < 0) {
              targetIndex = metrics.length;
            }
            let indicatorTop;
            if (targetIndex === metrics.length) {
              const last = metrics[metrics.length - 1];
              indicatorTop = last.bottom;
            } else {
              indicatorTop = metrics[targetIndex].top;
            }
            indicator.style.top = `${Math.max(0, indicatorTop - 4)}px`;
            return {
              targetIndex,
              orderedNames: metrics.map((entry) => entry.name),
            };
          };

          const moveHandler = (moveEvent) => {
            const { targetIndex } = updateIndicator(moveEvent.clientY);
            laneDragStateRef.current.targetIndex = targetIndex;
          };

          const upHandler = (upEvent) => {
            const { targetIndex, orderedNames } = updateIndicator(upEvent.clientY);
            cleanupDrag();
            if (!orderedNames.length) return;
            const currentIndex = orderedNames.findIndex((name) => name === laneName);
            if (currentIndex < 0 || targetIndex < 0) return;
            const nextOrder = orderedNames.filter((name) => name !== laneName);
            const insertIndex = targetIndex > currentIndex ? targetIndex - 1 : targetIndex;
            nextOrder.splice(Math.min(Math.max(insertIndex, 0), nextOrder.length), 0, laneName);
            emitLaneOrder(nextOrder);
          };

          laneDragStateRef.current = {
            active: true,
            laneName,
            targetIndex: -1,
            indicatorEl: indicator,
            moveHandler,
            upHandler,
          };
          window.addEventListener("mousemove", moveHandler);
          window.addEventListener("mouseup", upHandler);
        };

        const lanes = elementRegistry
          .getAll()
          .filter((el) => el.businessObject?.$type === "bpmn:Lane");
        lanes.forEach((lane) => {
          const laneId = lane.id;
          const laneName = lane.businessObject?.name || lane.businessObject?.id || "";
          if (!laneName) return;
          const handle = document.createElement("div");
          handle.className = "lane-dnd-handle";
          handle.style.display = "none";
          const title = document.createElement("div");
          title.className = "lane-dnd-handle__title";
          title.textContent = laneName;
          const hint = document.createElement("div");
          hint.className = "lane-dnd-handle__hint";
          hint.textContent = "Potiahni pre presun";
          handle.appendChild(title);
          handle.appendChild(hint);
          const dragStart = beginLaneDrag(laneName);
          handle.addEventListener("mousedown", dragStart);
          const id = overlays.add(lane, {
            position: { top: 6, left: 6 },
            html: handle,
          });
          laneHandleOverlayIdsRef.current.push(id);
          laneHandleMapRef.current.set(laneId, handle);
          laneDragStartMapRef.current.set(laneId, dragStart);
        });
        if (!lanes.length && laneHandleOverlayIdsRef.current.length) {
          cleanupDrag();
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err?.message || String(err);
        setImportError(message);
      })
      .finally(() => {
        if (cancelled) return;
        setTimeout(() => {
          skipDiagramChangeRef.current = false;
        }, 0);
      });

    return () => {
      cancelled = true;
      const dragState = laneDragStateRef.current;
      if (dragState.moveHandler) {
        window.removeEventListener("mousemove", dragState.moveHandler);
      }
      if (dragState.upHandler) {
        window.removeEventListener("mouseup", dragState.upHandler);
      }
      if (dragState.indicatorEl?.parentNode) {
        dragState.indicatorEl.parentNode.removeChild(dragState.indicatorEl);
      }
      laneDragStateRef.current = {
        active: false,
        laneName: "",
        targetIndex: -1,
        indicatorEl: null,
        moveHandler: null,
        upHandler: null,
      };
    };
  }, [xml]);

  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const overlays = modeler.get("overlays");
    if (!overlays) return;

    if (annotationOverlayIdsRef.current.length) {
      annotationOverlayIdsRef.current.forEach((id) => overlays.remove(id));
      annotationOverlayIdsRef.current = [];
    }
    if (!annotations?.length) {
      return;
    }

    annotations.forEach((note) => {
      if (!note.nodeId) return;
      const container = document.createElement("div");
      container.className = `map-overlay map-overlay--${note.severity || "info"}`;
      container.title = note.title || "";
      container.textContent = severityIcon(note.severity);
      const id = overlays.add(note.nodeId, {
        position: { top: -12, left: -12 },
        html: container,
      });
      annotationOverlayIdsRef.current.push(id);
    });
  }, [annotations, xml]);

  const displayError = error || importError;
  const handleInsertBlock = (type) => {
    if (typeof onInsertBlock === "function") {
      onInsertBlock(type);
    }
    setBlocksOpen(false);
  };

  return (
    <div className="map-viewer">
      <div className="map-viewer__header">
        <div>
          <div className="map-viewer__title">{title}</div>
          {hasSubtitle ? (
            <div className={subtitleClassName}>
              {subtitle ? <span className="map-viewer__subtitle-name">{subtitle}</span> : null}
              {subtitleMeta ? <span className="map-viewer__subtitle-meta">{subtitleMeta}</span> : null}
            </div>
          ) : null}
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
        <div className="map-toolbar-stack">
          <div className={`map-toolbar ${toolbarCollapsed ? "is-collapsed" : ""}`}>
            <button
              className="map-toolbar__toggle map-toolbar__toggle--primary"
              type="button"
              onClick={() => setToolbarCollapsed((prev) => !prev)}
              title={toolbarCollapsed ? "Zobraziť nástroje" : "Skryť nástroje"}
            >
              {toolbarCollapsed ? "Nástroje" : "Skryť"}
            </button>
            {!toolbarCollapsed ? (
              <div className="map-toolbar__group">
                <button className="map-toolbar__btn" type="button" onClick={() => zoomBy(0.1)} title="Priblížiť">
                  +
                </button>
                <button className="map-toolbar__btn" type="button" onClick={() => zoomBy(-0.1)} title="Oddialiť">
                  -
                </button>
                <button className="map-toolbar__btn" type="button" onClick={zoomFit} title="Prispôsobiť">
                  Fit
                </button>
                {onUndo ? (
                  <button
                    className="map-toolbar__btn map-toolbar__btn--undo"
                    type="button"
                    onClick={onUndo}
                    title="Späť"
                    disabled={!canUndo}
                  >
                    Späť
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="map-toolbar__blocks-panel">
            <button
              className="map-toolbar__toggle map-toolbar__toggle--primary map-toolbar__toggle--blocks"
              type="button"
              onClick={() => setBlocksOpen((prev) => !prev)}
              title="Vložiť blok"
            >
              Bloky
            </button>
            {blocksOpen ? (
              <div className="map-toolbar__blocks-menu">
                <button className="map-toolbar__btn map-toolbar__btn--icon" type="button" onClick={() => handleInsertBlock("xor")}>
                  <span className="map-toolbar__btn-icon bpmn-icon-gateway-xor" aria-hidden="true" />
                  Rozhodnutie
                </button>
                <button className="map-toolbar__btn map-toolbar__btn--icon" type="button" onClick={() => handleInsertBlock("and")}>
                  <span className="map-toolbar__btn-icon bpmn-icon-gateway-parallel" aria-hidden="true" />
                  Paralela
                </button>
              </div>
            ) : null}
          </div>
        </div><div ref={containerRef} className="map-viewer__canvas" />
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


