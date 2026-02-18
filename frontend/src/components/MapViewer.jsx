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
  subtitleTag,
  subtitleBadge,
  subtitleBadgeVariant = "sandbox",
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
  onSave,
  onMainMenu,
  saveDisabled = false,
  saveLabel = "Uložiť",
  onEngineJsonPatch,
  onModelerReady,
  onXmlImported,
  overlayMessage,
  onInsertBlock,
  readOnly = false,
}) {
  const ENABLE_LANE_HANDLES = false;
  const ENABLE_GHOST_STYLING = false;
  const containerRef = useRef(null);
  const modelerRef = useRef(null);
  const [importError, setImportError] = useState("");
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const isImportingRef = useRef(false);
  const hasSubtitle = Boolean(subtitle || subtitleMeta || subtitleBadge || subtitleTag);
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
  const nameCacheRef = useRef(new Map());
  const laneCacheRef = useRef(new Map());
  const sampleSequenceFlowWaypoints = (registry, limit = 5) => {
    if (!registry?.getAll) return [];
    return registry
      .getAll()
      .filter((el) => String(el?.businessObject?.$type || el?.type || "").includes("SequenceFlow"))
      .slice(0, limit)
      .map((conn) => ({
        id: conn?.id || null,
        name: conn?.businessObject?.name || "",
        waypoints: (conn?.waypoints || []).map((pt) => ({
          x: Number(pt?.x || 0),
          y: Number(pt?.y || 0),
        })),
      }));
  };

  const emitEnginePatch = (patch) => {
    if (typeof onEngineJsonPatch !== "function") return;
    if (typeof window !== "undefined" && window.__BPMNGEN_DEBUG_SYNC) {
      console.log("[engine-patch]", patch);
    }
    onEngineJsonPatch(patch);
  };

  const getEngineId = (element) => {
    try {
      const attrs = element?.businessObject?.$attrs;
      return attrs ? attrs["data-engine-id"] : null;
    } catch {
      return null;
    }
  };

  const ensureEngineId = (element) => {
    if (!element?.businessObject) return null;
    const existing = getEngineId(element);
    if (existing) return existing;
    const fallback =
      element.businessObject?.id || element.id || `N_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    try {
      const bo = element.businessObject;
      if (bo.$attrs == null || typeof bo.$attrs !== "object") {
        bo.$attrs = {};
      }
      if (bo.$attrs && typeof bo.$attrs === "object") {
        bo.$attrs["data-engine-id"] = fallback;
      }
    } catch {
      // $attrs may be read-only on some elements; fall back to returning id without setting.
    }
    return fallback;
  };

  const mapNodeType = (boType) => {
    if (!boType) return null;
    if (boType.includes("StartEvent")) return "startEvent";
    if (boType.includes("EndEvent")) return "endEvent";
    if (boType.includes("UserTask")) return "userTask";
    if (boType.includes("ServiceTask")) return "serviceTask";
    if (boType.includes("Task")) return "task";
    if (boType.includes("ExclusiveGateway")) return "exclusiveGateway";
    if (boType.includes("ParallelGateway")) return "parallelGateway";
    if (boType.includes("InclusiveGateway")) return "inclusiveGateway";
    if (boType.includes("Gateway")) return "gateway";
    return null;
  };

  const findLaneEngineId = (element, elementRegistry) => {
    if (!elementRegistry) return null;
    const lanes = elementRegistry
      .getAll()
      .filter((el) => String(el?.businessObject?.$type || el?.type).includes("Lane"));
    if (!lanes.length) return null;
    const centerY = (element?.y || 0) + (element?.height || 0) / 2;
    const lane = lanes.find(
      (ln) => centerY >= (ln.y || 0) && centerY <= (ln.y || 0) + (ln.height || 0),
    );
    if (!lane) return null;
    return getEngineId(lane) || ensureEngineId(lane) || lane.id;
  };
  const laneHandleHoverRef = useRef(false);
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

  const fitWithPadding = (padding = 24) => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    const canvas = modeler.get("canvas");
    canvas.zoom("fit-viewport", "auto");
    const viewbox = canvas.viewbox();
    if (!viewbox) return;
    canvas.viewbox({
      x: viewbox.x - padding,
      y: viewbox.y - padding,
      width: viewbox.width + padding * 2,
      height: viewbox.height + padding * 2,
    });
  };

  const zoomFit = () => {
    const modeler = modelerRef.current;
    if (!modeler) return;
    fitWithPadding();
  };

  useEffect(() => {
    const modeler = new BpmnModeler({
      container: containerRef.current,
      palette: { enabled: false },
      contextPad: { enabled: false },
      keyboard: readOnly ? { bindTo: null } : undefined,
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

    const getLaneOfElement = (el) => {
      let cur = el;
      while (cur) {
        const bo = cur.businessObject;
        const type = String(bo?.$type || cur.type || "");
        if (type.includes("Lane")) {
          return (
            bo?.$attrs?.["data-engine-id"] ||
            bo?.id ||
            cur.id ||
            null
          );
        }
        cur = cur.parent;
      }
      return null;
    };

    const routeFlow = (sourceEl, targetEl) => {
      if (!sourceEl || !targetEl) return null;
      const { x: sx = 0, y: sy = 0, width: sw = 0, height: sh = 0 } = sourceEl;
      const { x: tx = 0, y: ty = 0, width: tw = 0, height: th = 0 } = targetEl;
      if (!(sw && sh && tw && th)) return null;
      const H = 30;
      const ALT_BRANCH_X = 60;
      const X_PAD = 30;
      const EPS_Y = 40;
      const srcMidY = sy + sh / 2;
      const tgtMidY = ty + th / 2;
      const srcR = { x: sx + sw, y: srcMidY };
      const tgtL = { x: tx, y: tgtMidY };

      const srcType = String(sourceEl?.businessObject?.$type || sourceEl?.type || "");
      const isGateway = srcType.includes("Gateway");
      const tgtBranch = String(targetEl?.businessObject?.$attrs?.["data-branch"] || "");
      const isAlt =
        isGateway && (tgtBranch === "alt" || tgtMidY > srcMidY + EPS_Y);
      if (isAlt) {
        const branchX = srcR.x + ALT_BRANCH_X;
        return [srcR, { x: branchX, y: srcMidY }, { x: branchX, y: tgtMidY }, tgtL];
      }

      const srcLane = getLaneOfElement(sourceEl);
      const tgtLane = getLaneOfElement(targetEl);
      const sameLane =
        srcLane && tgtLane ? srcLane === tgtLane : Math.abs(srcMidY - tgtMidY) < EPS_Y;

      const forward = tgtL.x > srcR.x + 10;
      const closeY = Math.abs(srcMidY - tgtMidY) < EPS_Y;

      if (sameLane && forward && closeY) {
        return [srcR, tgtL];
      }

      if (sameLane && forward && !closeY) {
        return [srcR, { x: tgtL.x, y: srcMidY }, tgtL];
      }

      if (sameLane && !forward) {
        return [
          srcR,
          { x: srcR.x + H, y: srcMidY },
          { x: srcR.x + H, y: tgtMidY },
          tgtL,
        ];
      }

      return [
        srcR,
        { x: srcR.x + H, y: srcMidY },
        { x: srcR.x + H, y: tgtMidY },
        { x: tgtL.x - X_PAD, y: tgtMidY },
        tgtL,
      ];
    };

    const connectWithRouting = (source, target) => {
      if (!modeling) return null;
      const wps = routeFlow(source, target);
      const conn = modeling.connect(
        source,
        target,
        { type: "bpmn:SequenceFlow" },
        null,
        wps ? { waypoints: wps } : undefined,
      );
      if (window.__BPMNGEN_DEBUG_ROUTE) {
        // eslint-disable-next-line no-console
        console.log("[route] created conn id=", conn?.id);
        // eslint-disable-next-line no-console
        console.log("[route] before waypoints=", conn?.waypoints);
        // eslint-disable-next-line no-console
        console.log("[route] input waypoints=", wps);
      }
      if (conn && wps && typeof modeling.updateWaypoints === "function") {
        modeling.updateWaypoints(conn, wps);
        requestAnimationFrame(() => {
          try {
            modeling.updateWaypoints(conn, wps);
          } catch {
            // ignore
          }
        });
      }
      if (window.__BPMNGEN_DEBUG_ROUTE) {
        // eslint-disable-next-line no-console
        console.log("[route] after waypoints=", conn?.waypoints);
      }
      return conn;
    };
    const rerouteConnection = (connection) => {
      if (!connection) return;
      const boType = String(connection?.businessObject?.$type || connection?.type || "");
      if (!boType.includes("SequenceFlow")) return;
      const source = connection?.source;
      const target = connection?.target;
      if (!source || !target) return;
      if (typeof modeling?.updateWaypoints !== "function") return;
      const wps = routeFlow(source, target);
      if (!wps) return;
      try {
        modeling.updateWaypoints(connection, wps);
        requestAnimationFrame(() => {
          try {
            modeling.updateWaypoints(connection, wps);
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
    };

    modeler.__routeFlow = routeFlow;
    modeler.__connectWithRouting = connectWithRouting;
    modeler.__rerouteConnection = rerouteConnection;

    if (readOnly) {
      const commandStack = modeler.get("commandStack", false);
      if (commandStack) {
        commandStack.execute = () => {};
        commandStack.canExecute = () => false;
      }
      const directEditing = modeler.get("directEditing", false);
      if (directEditing) {
        directEditing.activate = () => {};
      }
      [
        "shape.move.start",
        "shape.move.move",
        "shape.move.end",
        "create.start",
        "create.move",
        "create.end",
        "connect.start",
        "connect.move",
        "connect.end",
        "resize.start",
        "resize.move",
        "resize.end",
        "element.dblclick",
        "commandStack.execute",
      ].forEach((evt) => {
        eventBus.on(evt, 10000, (e) => {
          if (e?.stopPropagation) e.stopPropagation();
          if (e?.preventDefault) e.preventDefault();
          return false;
        });
      });
    }

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
        const addLaneWithPrompt = (position) => {
          const created = modeling.addLane(element, position);
          if (!created) return;
          const currentName = created.businessObject?.name || "";
          const name = window.prompt("Názov lane", currentName);
          if (typeof name === "string" && name.trim()) {
            modeling.updateProperties(created, { name: name.trim() });
          }
        };

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
            onClick: () => addLaneWithPrompt("top"),
            hideOnAction: false,
          }),
        );
        container.appendChild(
          makeButton("Add lane below", "bpmn-icon-lane-insert-below", {
            onClick: () => addLaneWithPrompt("bottom"),
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
          const defaults = {
            "bpmn:Task": "Procesný krok",
            "bpmn:UserTask": "Procesný krok",
            "bpmn:ServiceTask": "Procesný krok",
            "bpmn:ExclusiveGateway": "Nové rozhodnutie",
            "bpmn:ParallelGateway": "Nové rozhodnutie",
            "bpmn:InclusiveGateway": "Nové rozhodnutie",
            "bpmn:Gateway": "Nové rozhodnutie",
            "bpmn:StartEvent": "Začiatok",
            "bpmn:EndEvent": "Koniec",
          };
          const shape = elementFactory.createShape({ type });
          if (shape?.businessObject && defaults[type]) {
            shape.businessObject.name = defaults[type];
          }
          if (typeof width === "number" && typeof height === "number") {
            shape.width = width;
            shape.height = height;
          }
          const shapeWidth = shape.width || width || 0;
          const shapeHeight = shape.height || height || 0;
          if (autoPlace && typeof autoPlace.append === "function") {
            const created = autoPlace.append(element, shape);
            if (created?.businessObject && defaults[type]) {
              modeling.updateProperties(created, { name: defaults[type] });
            }
            return;
          }
          const parent = element.parent || element;
          const x = (element.x || 0) + (element.width || 0) + 80;
          const y = (element.y || 0) + ((element.height || 0) / 2) - (shapeHeight / 2);
          const created = modeling.createShape(shape, { x, y }, parent);
          if (created?.businessObject && defaults[type]) {
            modeling.updateProperties(created, { name: defaults[type] });
          }
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
            onClick: () => appendShape("bpmn:Task", 100, 80),
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
      if (!ENABLE_LANE_HANDLES) return;
      laneHandleMapRef.current.forEach((handle) => {
        handle.style.display = "none";
      });
    };

    const showLaneHandle = (laneId) => {
      if (!ENABLE_LANE_HANDLES) return;
      hideLaneHandles();
      const handle = laneHandleMapRef.current.get(laneId);
      if (handle) {
        handle.style.display = "flex";
      }
    };

    const handleElementClick = (event) => {
      const { element } = event;

      // always remove previous handles
      if (ENABLE_LANE_HANDLES) {
        clearLaneHandles();
      }
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

    const handleElementHover = (event) => {
      const { element } = event;
      const boType = element?.businessObject && element.businessObject.$type;
      if (boType === "bpmn:Lane" || boType === "bpmn:Participant") {
        showLaneHandle(element.id);
      }
    };

    const handleElementOut = () => {
      if (laneHandleHoverRef.current || laneDragStateRef.current.active) return;
      hideLaneHandles();
    };

    const handleCanvasClick = () => {
      if (ENABLE_LANE_HANDLES) {
        clearLaneHandles();
      }
      clearContextPad();
      if (typeof onLaneSelect === "function") {
        onLaneSelect(null);
      }
      hideLaneHandles();
    };

    // Štýlujeme všetky aktuálne drag ghosty (aj pre resize, aj pre move)
    const styleAllDragGhosts = () => {
      if (!ENABLE_GHOST_STYLING) return;
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
      if (!ENABLE_GHOST_STYLING) return;
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
      if (!ENABLE_GHOST_STYLING) return;
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
    const emitCanvasEdit = (reason) => {
      if (skipDiagramChangeRef.current) return;
      const handler = diagramChangeRef.current;
      if (typeof handler !== "function") return;
      handler({
        kind: "canvas_edit",
        ts: Date.now(),
        reason,
      });
    };

    const handleDiagramChanged = () => {
      if (changeTimerRef.current) {
        clearTimeout(changeTimerRef.current);
      }
      changeTimerRef.current = setTimeout(() => {
        emitCanvasEdit("command_stack_changed");
      }, 120);
    };

    const handleViewboxChanged = (event) => {
      if (event?.viewbox) {
        lastViewboxRef.current = event.viewbox;
      }
    };

    const handleShapeAdded = (event) => {
      if (isImportingRef.current) return;
      const element = event?.element;
      if (!element || element?.type === "label") return;
      const boType = element.businessObject?.$type || element.type;
      const nodeType = mapNodeType(boType);
      if (!nodeType) return;
      const id = ensureEngineId(element);
      if (id) {
        nameCacheRef.current.set(String(id), element.businessObject?.name || "");
      }
      const laneId = findLaneEngineId(element, elementRegistry);
      if (id) {
        laneCacheRef.current.set(String(id), laneId || "");
      }
      emitEnginePatch({
        type: "ADD_NODE",
        id,
        nodeType,
        name: element.businessObject?.name || "",
        laneId,
      });
    };

    const handleShapeRemoved = (event) => {
      if (isImportingRef.current) return;
      const element = event?.element;
      if (!element || element?.type === "label") return;
      const boType = element.businessObject?.$type || element.type;
      const nodeType = mapNodeType(boType);
      if (!nodeType) return;
      const id = getEngineId(element) || element?.businessObject?.id || element?.id;
      if (!id) return;
      nameCacheRef.current.delete(String(id));
      laneCacheRef.current.delete(String(id));
      emitEnginePatch({ type: "REMOVE_NODE", id });
      emitCanvasEdit("shape_removed");
    };

    const handleConnectionAdded = (event) => {
      if (isImportingRef.current) return;
      const element = event?.element;
      if (!element || element?.type === "label") return;
      const boType = element.businessObject?.$type || element.type;
      if (!String(boType).includes("SequenceFlow")) return;
      rerouteConnection(element);
      const id = ensureEngineId(element);
      const sourceId = ensureEngineId(element.source);
      const targetId = ensureEngineId(element.target);
      if (!sourceId || !targetId) return;
      if (id) {
        nameCacheRef.current.set(String(id), element.businessObject?.name || "");
      }
      emitEnginePatch({ type: "ADD_FLOW", id, sourceId, targetId });
    };

    const handleConnectionRemoved = (event) => {
      if (isImportingRef.current) return;
      const element = event?.element;
      if (!element || element?.type === "label") return;
      const boType = element.businessObject?.$type || element.type;
      if (!String(boType).includes("SequenceFlow")) return;
      const id = getEngineId(element) || element?.businessObject?.id || element?.id;
      if (!id) return;
      emitEnginePatch({ type: "REMOVE_FLOW", id });
    };

    const handleElementChanged = (event) => {
      if (isImportingRef.current) return;
      const element = event?.element;
      if (!element || element?.type === "label") return;
      const boType = element.businessObject?.$type || element.type;
      const isSequenceFlow = String(boType).includes("SequenceFlow");
      if (isSequenceFlow) {
        const id = ensureEngineId(element);
        if (!id) return;
        const nextName = element.businessObject?.name || "";
        const cacheKey = String(id);
        const prevName = nameCacheRef.current.get(cacheKey);
        if (prevName === nextName) return;
        nameCacheRef.current.set(cacheKey, nextName);
        emitEnginePatch({ type: "RENAME_FLOW", id, name: nextName });
        emitCanvasEdit("element_changed");
        return;
      }
      const nodeType = mapNodeType(boType);
      const isLane = String(boType).includes("Lane");
      if (!nodeType && !isLane) return;
      const id = ensureEngineId(element);
      if (!id) return;
      const nextName = element.businessObject?.name || "";
      const cacheKey = String(id);
      const prevName = nameCacheRef.current.get(cacheKey);
      if (prevName === nextName) return;
      nameCacheRef.current.set(cacheKey, nextName);
      if (isLane) {
        emitEnginePatch({ type: "RENAME_LANE", id, name: nextName });
        emitCanvasEdit("element_changed");
        return;
      }
      const nextLaneId = findLaneEngineId(element, elementRegistry);
      const prevLaneId = laneCacheRef.current.get(cacheKey);
      if (nextLaneId && nextLaneId !== prevLaneId) {
        laneCacheRef.current.set(cacheKey, nextLaneId);
        emitEnginePatch({ type: "UPDATE_NODE_LANE", id, laneId: nextLaneId });
      }
      emitEnginePatch({ type: "RENAME_NODE", id, name: nextName });
      emitCanvasEdit("element_changed");
    };

    if (eventBus) {
      if (ENABLE_GHOST_STYLING) {
        eventBus.on("shape.move.start", startGhostStyling);
        eventBus.on("shape.move.move", startGhostStyling);
        eventBus.on("shape.move.end", stopGhostStyling);
        eventBus.on("shape.move.cancel", stopGhostStyling);
      }
      eventBus.on("shape.move.end", handleLaneMoveEnd);
      eventBus.on("connect.start", suppressContextPad);
      eventBus.on("connect.end", releaseContextPad);
      eventBus.on("connect.cancel", releaseContextPad);
      eventBus.on("connect.cleanup", releaseContextPad);
      eventBus.on("create.start", suppressContextPad);
      eventBus.on("create.end", releaseContextPad);
      eventBus.on("create.cancel", releaseContextPad);
      eventBus.on("create.cleanup", releaseContextPad);
      if (ENABLE_GHOST_STYLING) {
        eventBus.on("shape.resize.start", startGhostStyling);
        eventBus.on("shape.resize.move", startGhostStyling);
        eventBus.on("shape.resize.end", stopGhostStyling);
        eventBus.on("shape.resize.cancel", stopGhostStyling);
      }
      eventBus.on("element.click", handleElementClick);
      eventBus.on("element.hover", handleElementHover);
      eventBus.on("element.out", handleElementOut);
      eventBus.on("canvas.click", handleCanvasClick);
      eventBus.on("canvas.viewbox.changed", handleViewboxChanged);
      eventBus.on("commandStack.changed", handleDiagramChanged);
      eventBus.on("shape.added", handleShapeAdded);
      eventBus.on("shape.removed", handleShapeRemoved);
      eventBus.on("connection.added", handleConnectionAdded);
      eventBus.on("connection.removed", handleConnectionRemoved);
      eventBus.on("element.changed", handleElementChanged);
    }

    return () => {
      if (typeof onModelerReady === "function") {
        onModelerReady(null);
      }
      if (eventBus) {
        if (ENABLE_GHOST_STYLING) {
          eventBus.off("shape.move.start", startGhostStyling);
          eventBus.off("shape.move.move", startGhostStyling);
          eventBus.off("shape.move.end", stopGhostStyling);
          eventBus.off("shape.move.cancel", stopGhostStyling);
        }
        eventBus.off("shape.move.end", handleLaneMoveEnd);
        eventBus.off("connect.start", suppressContextPad);
        eventBus.off("connect.end", releaseContextPad);
        eventBus.off("connect.cancel", releaseContextPad);
        eventBus.off("connect.cleanup", releaseContextPad);
        eventBus.off("create.start", suppressContextPad);
        eventBus.off("create.end", releaseContextPad);
        eventBus.off("create.cancel", releaseContextPad);
        eventBus.off("create.cleanup", releaseContextPad);
        if (ENABLE_GHOST_STYLING) {
          eventBus.off("shape.resize.start", startGhostStyling);
          eventBus.off("shape.resize.move", startGhostStyling);
          eventBus.off("shape.resize.end", stopGhostStyling);
          eventBus.off("shape.resize.cancel", stopGhostStyling);
        }
        eventBus.off("element.click", handleElementClick);
        eventBus.off("element.hover", handleElementHover);
        eventBus.off("element.out", handleElementOut);
        eventBus.off("canvas.click", handleCanvasClick);
        eventBus.off("canvas.viewbox.changed", handleViewboxChanged);
        eventBus.off("commandStack.changed", handleDiagramChanged);
        eventBus.off("shape.added", handleShapeAdded);
        eventBus.off("shape.removed", handleShapeRemoved);
        eventBus.off("connection.added", handleConnectionAdded);
        eventBus.off("connection.removed", handleConnectionRemoved);
        eventBus.off("element.changed", handleElementChanged);
      }
      clearLaneHandles();
      clearContextPad();
      stopGhostStyling();
      hideLaneHandles();
      modeler.__rerouteConnection = null;
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
    isImportingRef.current = true;
    modeler
      .importXML(xml)
      .then(() => {
        if (cancelled) return;
        setImportError("");
        fitWithPadding();
        hasImportedRef.current = true;

        const overlays = modeler.get("overlays");
        const elementRegistry = modeler.get("elementRegistry");
        if (!overlays || !elementRegistry) return;
        const debugLayoutStability =
          typeof window !== "undefined" && Boolean(window.__BPMNGEN_DEBUG_LAYOUT_STABILITY);
        const shouldRerouteOnImport =
          typeof window !== "undefined" && Boolean(window.__BPMNGEN_REROUTE_ON_IMPORT);
        if (debugLayoutStability) {
          // eslint-disable-next-line no-console
          console.log("[layout-stability] importXML loaded samples", sampleSequenceFlowWaypoints(elementRegistry));
        }

        // Keep import geometry stable by default. Enable reroute explicitly only when needed.
        if (shouldRerouteOnImport) {
          // eslint-disable-next-line no-console
          console.warn("[layout] reroute on import enabled; will modify saved geometry");
          const rerouteConnection = modeler.__rerouteConnection;
          elementRegistry
            .getAll()
            .filter((el) => String(el?.businessObject?.$type || el?.type || "").includes("SequenceFlow"))
            .forEach((conn) => {
              if (typeof rerouteConnection === "function") {
                rerouteConnection(conn);
              }
            });
          if (debugLayoutStability) {
            // eslint-disable-next-line no-console
            console.log("[layout-stability] importXML after reroute samples", sampleSequenceFlowWaypoints(elementRegistry));
          }
        }

        nameCacheRef.current.clear();
        laneCacheRef.current.clear();
        elementRegistry.getAll().forEach((el) => {
          const id = getEngineId(el) || el?.businessObject?.id || el?.id;
          if (!id) return;
          nameCacheRef.current.set(String(id), el.businessObject?.name || "");
          const laneId = findLaneEngineId(el, elementRegistry);
          if (laneId) {
            laneCacheRef.current.set(String(id), laneId);
          }
        });

        laneHandleOverlayIdsRef.current.forEach((id) => overlays.remove(id));
        laneHandleOverlayIdsRef.current = [];
        laneHandleMapRef.current.clear();

        if (typeof onXmlImported === "function") {
          onXmlImported(modeler);
        }

        const emitLaneOrder = (orderedNames) => {
          const handler = laneOrderChangeRef.current;
          if (typeof handler !== "function") return;
          const key = orderedNames.join("|");
          if (key === lastLaneOrderRef.current) return;
          lastLaneOrderRef.current = key;
          handler(orderedNames);
        };

        if (!ENABLE_LANE_HANDLES) {
          isImportingRef.current = false;
          return;
        }

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
          event.stopPropagation();
          if (event.nativeEvent?.stopImmediatePropagation) {
            event.nativeEvent.stopImmediatePropagation();
          }
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
          handle.title = "Presunúť lane";
          handle.style.display = "none";
          handle.addEventListener("mouseenter", () => {
            laneHandleHoverRef.current = true;
          });
          handle.addEventListener("mouseleave", () => {
            laneHandleHoverRef.current = false;
          });
          const icon = document.createElement("div");
          icon.className = "lane-dnd-handle__icon";
          handle.appendChild(icon);
          const dragStart = beginLaneDrag(laneName);
          handle.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            dragStart(event);
          });
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
        isImportingRef.current = false;
      })
      .catch((err) => {
        if (cancelled) return;
        const rawMessage = err?.message || String(err);
        const normalizedMessage = String(rawMessage).toLowerCase();
        const message = normalizedMessage.includes("no diagram to display")
          ? "Zatiaľ nie je vytvorený diagram."
          : rawMessage;
        setImportError(message);
        isImportingRef.current = false;
      })
      .finally(() => {
        if (cancelled) return;
        setTimeout(() => {
          skipDiagramChangeRef.current = false;
        }, 0);
        isImportingRef.current = false;
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
              {subtitleBadge ? (
                <span className={`map-viewer__badge map-viewer__badge--${subtitleBadgeVariant}`}>{subtitleBadge}</span>
              ) : null}
              {subtitleTag ? <span className="map-viewer__tag">{subtitleTag}</span> : null}
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
                className="map-toolbar__toggle map-toolbar__toggle--primary map-toolbar__toggle--compact"
                type="button"
                onClick={() => setToolbarCollapsed((prev) => !prev)}
                title={toolbarCollapsed ? "Zobraziť nástroje" : "Skryť nástroje"}
              >
                {toolbarCollapsed ? "Nástroje" : "Skryť"}
              </button>
              {!toolbarCollapsed ? (
                <div className="map-toolbar__group">
                <button className="map-toolbar__btn map-toolbar__btn--zoom" type="button" onClick={() => zoomBy(0.1)} title="Priblížiť">
                  +
                </button>
                <button className="map-toolbar__btn map-toolbar__btn--zoom" type="button" onClick={() => zoomBy(-0.1)} title="Oddialiť">
                  -
                </button>
                <button className="map-toolbar__btn map-toolbar__btn--zoom" type="button" onClick={zoomFit} title="Prispôsobiť">
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
                  {onSave ? (
                    <button
                      className="map-toolbar__btn map-toolbar__btn--save"
                      type="button"
                      onClick={onSave}
                      title="Uložiť"
                      disabled={saveDisabled}
                    >
                      {saveLabel}
                    </button>
                  ) : null}
                  {onMainMenu ? (
                    <button
                      className="map-toolbar__btn"
                      type="button"
                      onClick={onMainMenu}
                      title="Hlavné menu"
                    >
                      Hlavné menu
                    </button>
                  ) : null}
                </div>
              ) : null}
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
            </div>
          </div><div ref={containerRef} className="map-viewer__canvas" />
        {loading ? <div className="map-viewer__status map-viewer__status--loading">Načítavam…</div> : null}
        {overlayMessage ? (
          <div className="map-viewer__status">{overlayMessage}</div>
        ) : null}
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


