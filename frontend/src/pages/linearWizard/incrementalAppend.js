const NO_BRANCH_LABELS = new Set(["nie", "no", "false"]);

const normalizeBranchLabel = (value) => String(value || "").trim().toLowerCase();

const isNoBranchLabel = (value) => NO_BRANCH_LABELS.has(normalizeBranchLabel(value));
const BASELINE_RATIO_IN_LANE = 0.38;

export function applyIncrementalAppend({
  prevEngine,
  nextEngine,
  modeler,
  xml,
  standardTaskSize,
  getLaneCenterMidY,
  attachNodeToLane,
}) {
  const fail = (reason, details = null) => ({ ok: false, reason, details });
  const ok = (details = null) => ({ ok: true, details });
  if (!prevEngine || !nextEngine || !modeler || !xml) {
    return fail("invalid_input", {
      hasPrevEngine: Boolean(prevEngine),
      hasNextEngine: Boolean(nextEngine),
      hasModeler: Boolean(modeler),
      hasXml: Boolean(xml),
    });
  }
  const elementRegistry = modeler.get("elementRegistry");
  const modeling = modeler.get("modeling");
  const elementFactory = modeler.get("elementFactory");
  const canvas = modeler.get("canvas");
  if (!elementRegistry || !modeling || !elementFactory) {
    return fail("missing_modeler_services", {
      hasElementRegistry: Boolean(elementRegistry),
      hasModeling: Boolean(modeling),
      hasElementFactory: Boolean(elementFactory),
    });
  }
  const routeFlow = modeler.__routeFlow;

  const prevNodes = Array.isArray(prevEngine.nodes) ? prevEngine.nodes : [];
  const nextNodes = Array.isArray(nextEngine.nodes) ? nextEngine.nodes : [];
  const prevFlows = Array.isArray(prevEngine.flows) ? prevEngine.flows : [];
  const nextFlows = Array.isArray(nextEngine.flows) ? nextEngine.flows : [];

  const prevNodeIds = new Set(prevNodes.map((n) => String(n?.id)));
  const prevFlowIds = new Set(prevFlows.map((f) => String(f?.id)));

  const newNodes = nextNodes.filter((n) => n?.id && !prevNodeIds.has(String(n.id)));
  const newFlows = nextFlows.filter((f) => f?.id && !prevFlowIds.has(String(f.id)));

  if (!newNodes.length && !newFlows.length) return ok({ reason: "no_changes" });

  const allElements = elementRegistry.getAll();
  const getEngineIdAttr = (el) => String(el?.businessObject?.$attrs?.["data-engine-id"] || "");
  const getBoType = (el) => String(el?.businessObject?.$type || el?.type || "");

  const findElementByEngineId = (engineId) => {
    if (!engineId) return null;
    const direct = elementRegistry.get(engineId);
    if (direct) return direct;
    const all = elementRegistry.getAll();
    return all.find((el) => getEngineIdAttr(el) === String(engineId)) || null;
  };

  const laneElements = allElements.filter((el) =>
    String(el?.businessObject?.$type || el?.type || "").includes("Lane"),
  );
  const laneById = new Map();
  laneElements.forEach((el) => {
    const engineId = getEngineIdAttr(el);
    if (engineId) laneById.set(engineId, el);
    laneById.set(String(el.id), el);
  });

  const isFlowNode = (el) => Boolean(el?.businessObject?.$instanceOf?.("bpmn:FlowNode"));

  const isInLane = (el, laneEl) => {
    if (!el || !laneEl) return false;
    const cx = (el.x || 0) + (el.width || 0) / 2;
    const cy = (el.y || 0) + (el.height || 0) / 2;
    return (
      cx >= (laneEl.x || 0) &&
      cx <= (laneEl.x || 0) + (laneEl.width || 0) &&
      cy >= (laneEl.y || 0) &&
      cy <= (laneEl.y || 0) + (laneEl.height || 0)
    );
  };

  const resolveProcessContext = () => {
    const rootEl = typeof canvas?.getRootElement === "function" ? canvas.getRootElement() : null;
    const rootType = getBoType(rootEl);
    let participantEl = null;
    let processBo = null;

    if (rootType.includes("Collaboration")) {
      participantEl =
        elementRegistry
          .getAll()
          .find((el) => getBoType(el).includes("Participant")) || null;
      processBo = participantEl?.businessObject?.processRef || null;
    } else if (rootType.includes("Process")) {
      processBo = rootEl?.businessObject || null;
    } else {
      participantEl =
        elementRegistry
          .getAll()
          .find((el) => getBoType(el).includes("Participant")) || null;
      processBo = participantEl?.businessObject?.processRef || null;
    }

    if (!processBo && participantEl) {
      try {
        const moddle = modeler.get("moddle");
        const definitions = participantEl?.businessObject?.$parent || rootEl?.businessObject?.$parent || null;
        if (moddle?.create && definitions) {
          const processId = `Process_${Date.now()}`;
          const createdProcess = moddle.create("bpmn:Process", { id: processId });
          if (Array.isArray(definitions.rootElements)) {
            definitions.rootElements.push(createdProcess);
          } else {
            definitions.rootElements = [createdProcess];
          }
          participantEl.businessObject.processRef = createdProcess;
          processBo = createdProcess;
        }
      } catch {
        // fallback to failure payload below
      }
    }

    if (!processBo) {
      return fail("missing_process_parent", {
        rootType,
        hasRootEl: Boolean(rootEl),
        participantFound: Boolean(participantEl),
        processRefFound: Boolean(participantEl?.businessObject?.processRef),
      });
    }

    if (!Array.isArray(processBo.flowElements)) {
      processBo.flowElements = [];
    }

    return {
      ok: true,
      rootEl,
      rootType,
      participantEl,
      processBo,
    };
  };

  const processContext = resolveProcessContext();
  if (!processContext?.ok) {
    return processContext;
  }
  const { rootEl, participantEl } = processContext;

  const getLaneFlowShapes = (laneEl) => {
    if (!laneEl) return [];
    return elementRegistry
      .getAll()
      .filter((el) => el && el.type !== "label" && isFlowNode(el) && isInLane(el, laneEl));
  };

  const findLastFlowShapeInLane = (laneEl) => {
    const nodes = getLaneFlowShapes(laneEl);
    if (!nodes.length) return null;
    return nodes.reduce((last, el) => {
      const right = Number(el.x || 0) + Number(el.width || 0);
      const lastRight = Number(last?.x || 0) + Number(last?.width || 0);
      return right > lastRight ? el : last;
    }, nodes[0]);
  };

  const computeLaneRightmost = (laneEl) => {
    const last = findLastFlowShapeInLane(laneEl);
    if (!last) return laneEl.x + 80;
    return Number(last.x || 0) + Number(last.width || 0);
  };

  const findLastFlowShapeInMap = () => {
    const nodes = elementRegistry
      .getAll()
      .filter((el) => el && el.type !== "label" && isFlowNode(el));
    if (!nodes.length) return null;
    return nodes.reduce((last, el) => {
      const right = Number(el.x || 0) + Number(el.width || 0);
      const lastRight = Number(last?.x || 0) + Number(last?.width || 0);
      return right > lastRight ? el : last;
    }, nodes[0]);
  };

  const toBpmnType = (node) => {
    const raw = String(node?.type || "").toLowerCase();
    if (raw.includes("start")) return "bpmn:StartEvent";
    if (raw.includes("end")) return "bpmn:EndEvent";
    if (raw.includes("exclusive")) return "bpmn:ExclusiveGateway";
    if (raw.includes("parallel")) return "bpmn:ParallelGateway";
    if (raw.includes("inclusive")) return "bpmn:InclusiveGateway";
    if (raw.includes("eventbased") || raw.includes("event_based")) return "bpmn:EventBasedGateway";
    if (raw.includes("gateway")) return "bpmn:ExclusiveGateway";
    return "bpmn:Task";
  };

  const ensureAttrs = (bo) => {
    if (!bo) return null;
    if (!bo.$attrs || typeof bo.$attrs !== "object") bo.$attrs = {};
    return bo.$attrs;
  };

  const positionEventLabel = (el) => {
    if (!el || !el.businessObject?.name) return;
    if (typeof modeling.updateLabel !== "function") return;
    const elType = String(el?.businessObject?.$type || el?.type || "");
    const labelEl = el?.label || (Array.isArray(el?.labels) ? el.labels[0] : null);
    const currentW = Number(labelEl?.width || 0);
    const currentH = Number(labelEl?.height || 0);
    const computedW = Math.max(80, Math.round((el.businessObject.name || "").length * 6));
    const w = elType.includes("StartEvent") && currentW > 0 ? Math.max(computedW, currentW) : computedW;
    const h = currentH > 0 ? currentH : 28;
    const bounds = {
      x: (el.x || 0) - w / 2 + (el.width || 0) / 2,
      y: (el.y || 0) + (el.height || 0) + 6,
      width: w,
      height: h,
    };
    try {
      modeling.updateLabel(el, el.businessObject.name, bounds);
    } catch {
      // ignore label placement errors
    }
  };
  const positionGatewayLabel = (el) => {
    if (!el || !el.businessObject?.name) return;
    if (typeof modeling.updateLabel !== "function") return;
    const labelEl = getExternalLabel(el);
    const currentW = Number(labelEl?.width || 0);
    const currentH = Number(labelEl?.height || 0);
    const w = Math.max(80, currentW || Math.round((el.businessObject.name || "").length * 6));
    const h = Math.max(28, currentH || 28);
    const GATEWAY_LABEL_GAP_Y = 10;
    const centerX = Number(el.x || 0) + Number(el.width || 0) / 2;
    const bounds = {
      x: Math.round(centerX - w / 2),
      y: Math.round((el.y || 0) - h - GATEWAY_LABEL_GAP_Y),
      width: Math.round(w),
      height: Math.round(h),
    };
    try {
      modeling.updateLabel(el, el.businessObject.name, bounds);
    } catch {
      // ignore label placement errors
    }
  };
  const getExternalLabel = (el) => {
    if (!el) return null;
    if (el.label) return el.label;
    if (Array.isArray(el.labels) && el.labels.length) return el.labels[0];
    return null;
  };

  const createdByEngineId = new Map();
  const createdConnections = [];
  let nodeFailure = null;
  let flowFailure = null;
  let missingLaneWarned = false;
  const touchedLaneIds = new Set(newNodes.map((n) => String(n?.laneId || "")).filter(Boolean));
  const frozenStartLabelBounds = new Map();
  touchedLaneIds.forEach((laneId) => {
    const laneEl = laneById.get(laneId);
    if (!laneEl) return;
    const startsInLane = elementRegistry
      .getAll()
      .filter((el) => {
        const type = String(el?.businessObject?.$type || el?.type || "");
        return type.includes("StartEvent") && isInLane(el, laneEl);
      });
    startsInLane.forEach((startEl) => {
      const labelEl = getExternalLabel(startEl);
      if (!labelEl) return;
      frozenStartLabelBounds.set(String(startEl.id || ""), {
        x: Number(labelEl.x || 0),
        y: Number(labelEl.y || 0),
        width: Number(labelEl.width || 0),
        height: Number(labelEl.height || 0),
      });
    });
  });
  const nodeOrder = new Map(
    nextNodes
      .map((n, idx) => [String(n?.id || ""), idx])
      .filter(([id]) => Boolean(id)),
  );
  // Deterministic horizontal spacing per diagram (derived once from the configured task width).
  const TASK_BOX_WIDTH = Math.max(80, Number(standardTaskSize?.width || 100));
  const FLOW_GAP = Math.round(TASK_BOX_WIDTH * 0.8);
  const H_SPACING = FLOW_GAP;
  const H_GAP = H_SPACING;
  const PARALLEL_BRANCH_GAP = 95;
  const XOR_BRANCH_GAP = 120;
  const PAD_Y = 40;
  const TASK_TO_TASK_GAP = FLOW_GAP;
  const GATEWAY_TO_TASK_GAP = FLOW_GAP;
  const BRANCH_OFFSET = 120;
  const LANE_BOTTOM_PADDING_DEFAULT = 50;
  const BOTTOM_MARGIN_XOR = 40;
  const BOTTOM_MARGIN_AND = 70;
  const LANE_EXTRA_MARGIN = 10;
  const MIN_LANE_HEIGHT = 220;
  const laneCursorById = new Map();
  const getBaselineMidY = (laneEl) => {
    if (!laneEl) return 0;
    const y = Number(laneEl.y || 0);
    const h = Number(laneEl.height || 0);
    return Math.round(y + h * BASELINE_RATIO_IN_LANE);
  };
  const getBranchMidY = (laneEl, nodeHeight) => {
    const baselineMidY = getBaselineMidY(laneEl);
    const maxOffset = laneEl.y + laneEl.height - baselineMidY - nodeHeight / 2;
    const effectiveBranchOffset = Math.max(0, Math.min(PARALLEL_BRANCH_GAP, maxOffset));
    return Math.round(baselineMidY + effectiveBranchOffset);
  };
  const getElementLane = (el) => {
    if (!el) return null;
    let cur = el;
    while (cur) {
      const type = String(cur?.businessObject?.$type || cur?.type || "");
      if (type.includes("Lane")) return cur;
      cur = cur.parent;
    }
    return laneElements.find((laneEl) => isInLane(el, laneEl)) || null;
  };

  const getElementRight = (el) => Number(el?.x || 0) + Number(el?.width || 0);
  const getNextXAfterElement = (el, gap = FLOW_GAP) => getElementRight(el) + gap;

  const computeWaypointsForConnection = (connection) => {
    const source = connection?.source;
    const target = connection?.target;
    if (!source || !target) return null;
    const sx = source.x || 0;
    const sy = source.y || 0;
    const sw = source.width || 0;
    const sh = source.height || 0;
    const tx = target.x || 0;
    const ty = target.y || 0;
    const tw = target.width || 0;
    const th = target.height || 0;
    if (!(sw && sh && tw && th)) return null;

    const srcMidY = sy + sh / 2;
    const tgtMidY = ty + th / 2;
    const srcRight = sx + sw;
    const tgtLeft = tx;
    const srcType = String(source?.businessObject?.$type || source?.type || "");
    const connName = normalizeBranchLabel(connection?.businessObject?.name || "");
    const tgtAttrs = target?.businessObject?.$attrs || {};
    const srcAttrs = source?.businessObject?.$attrs || {};
    const srcLane = getElementLane(source);
    const tgtLane = getElementLane(target);
    const sameLane = srcLane && tgtLane ? srcLane.id === tgtLane.id : false;
    const srcBaseline = srcAttrs["data-branch"] !== "alt";
    const tgtBaseline = tgtAttrs["data-branch"] !== "alt";

    if (sameLane && srcBaseline && tgtBaseline && Math.abs(srcMidY - tgtMidY) < 2) {
      return [{ x: srcRight, y: srcMidY }, { x: tgtLeft, y: srcMidY }];
    }

    const isExclusiveGateway = srcType.includes("ExclusiveGateway");
    const isParallelGateway = srcType.includes("ParallelGateway");
    if (isParallelGateway) {
      const srcAttrs = source?.businessObject?.$attrs || {};
      const tgtAttrs = target?.businessObject?.$attrs || {};
      const parallelSplitId = String(srcAttrs["data-parallel-split-id"] || source?.id || "");
      const targetSplitId = String(tgtAttrs["data-parallel-split-id"] || "");
      const targetJoinSplitId = String(tgtAttrs["data-parallel-join-id"] || "");
      const isSplitToBranch = Boolean(targetSplitId && parallelSplitId && targetSplitId === parallelSplitId);
      const isBranchToJoin = Boolean(targetJoinSplitId && parallelSplitId && targetJoinSplitId === parallelSplitId);
      const splitExitX = srcRight + 30;
      if (isSplitToBranch) {
        return [
          { x: srcRight, y: srcMidY },
          { x: splitExitX, y: srcMidY },
          { x: splitExitX, y: tgtMidY },
          { x: tgtLeft, y: tgtMidY },
        ];
      }
      if (isBranchToJoin) {
        const joinBusX = tgtLeft - 30;
        return [
          { x: srcRight, y: srcMidY },
          { x: joinBusX, y: srcMidY },
          { x: joinBusX, y: tgtMidY },
          { x: tgtLeft, y: tgtMidY },
        ];
      }
    }

    if (isExclusiveGateway) {
      const srcXorSplitId = String(srcAttrs["data-xor-split-id"] || source?.id || "");
      const tgtXorSplitId = String(tgtAttrs["data-xor-split-id"] || "");
      const tgtXorJoinId = String(tgtAttrs["data-xor-join-id"] || "");
      const isXorSplitToBranch = Boolean(tgtXorSplitId && srcXorSplitId && tgtXorSplitId === srcXorSplitId);
      const isXorBranchToJoin = Boolean(tgtXorJoinId && srcXorSplitId && tgtXorJoinId === srcXorSplitId);
      if (isXorSplitToBranch) {
        const branchIndex = Number(tgtAttrs["data-xor-branch-index"]);
        const isNoBranch = Number.isFinite(branchIndex) ? branchIndex > 0 : false;
        if (!isNoBranch) {
          return [
            { x: srcRight, y: srcMidY },
            { x: tgtLeft, y: srcMidY },
          ];
        }
        const srcBottomX = sx + sw / 2;
        const srcBottomY = sy + sh;
        return [
          { x: srcBottomX, y: srcBottomY },
          { x: srcBottomX, y: tgtMidY },
          { x: tgtLeft, y: tgtMidY },
        ];
      }
      if (isXorBranchToJoin) {
        const joinBusX = tgtLeft - 30;
        return [
          { x: srcRight, y: srcMidY },
          { x: joinBusX, y: srcMidY },
          { x: joinBusX, y: tgtMidY },
          { x: tgtLeft, y: tgtMidY },
        ];
      }
      const laneForRoute = srcLane || tgtLane;
      const baselineY = laneForRoute ? getBaselineMidY(laneForRoute) : srcMidY;
      const isAlt = tgtAttrs["data-branch"] === "alt" || connName === "nie" || connName === "no" || connName === "false";

      if (isAlt) {
        const xorBranchIndex = Number(tgtAttrs["data-xor-branch-index"]);
        const branchY = laneForRoute
          ? Number.isFinite(xorBranchIndex)
            ? computeXorBranchMidY(laneForRoute, xorBranchIndex)
            : computeXorBranchMidY(laneForRoute, 1)
          : tgtMidY;
        const srcBottomX = sx + sw / 2;
        const srcBottomY = sy + sh;
        const waypoints = [
          { x: srcBottomX, y: srcBottomY },
          { x: srcBottomX, y: branchY },
          { x: tgtLeft, y: branchY },
        ];
        if (Math.abs(branchY - tgtMidY) >= 1) {
          waypoints.push({ x: tgtLeft, y: tgtMidY });
        }
        return waypoints;
      }

      const yesWaypoints = [
        { x: srcRight, y: baselineY },
        { x: tgtLeft, y: baselineY },
      ];
      if (Math.abs(baselineY - tgtMidY) >= 1) {
        yesWaypoints.push({ x: tgtLeft, y: tgtMidY });
      }
      return yesWaypoints;
    }

    if (typeof routeFlow === "function") {
      return routeFlow(source, target);
    }
    return null;
  };

  const getLaneCursor = (laneKey, laneEl, shapeWidth = 100) => {
    if (laneCursorById.has(laneKey)) return laneCursorById.get(laneKey);
    const laneHasShapes = Boolean(laneEl && findLastFlowShapeInLane(laneEl));
    let start = 240;

    if (laneHasShapes && laneEl) {
      const laneRightmost = computeLaneRightmost(laneEl);
      start = typeof laneRightmost === "number" ? laneRightmost + H_GAP : start;
    } else {
      const mapLast = findLastFlowShapeInMap();
      if (mapLast) {
        // Preserve cross-lane visual alignment for the first shape in a newly-used lane.
        const mapLastX = Number(mapLast.x || 0);
        const mapLastW = Number(mapLast.width || 0);
        const targetW = Number(shapeWidth || 100);
        start = Math.round(mapLastX + mapLastW / 2 - targetW / 2);
      } else {
        const laneRightmost = laneEl ? computeLaneRightmost(laneEl) : null;
        start = typeof laneRightmost === "number" ? laneRightmost + H_GAP : start;
      }
    }

    laneCursorById.set(laneKey, start);
    return start;
  };

  const setLaneCursor = (laneKey, value) => {
    laneCursorById.set(laneKey, value);
  };

  const findFlowBySourceTarget = (sourceId, targetId) =>
    nextFlows.find(
      (f) => String(f?.source || "") === String(sourceId || "") && String(f?.target || "") === String(targetId || ""),
    ) || null;
  const isParallelGatewayType = (rawType) => String(rawType || "").toLowerCase().includes("parallelgateway");
  const isExclusiveGatewayType = (rawType) => String(rawType || "").toLowerCase().includes("exclusivegateway");
  const nextNodeById = new Map(
    nextNodes
      .map((n) => [String(n?.id || ""), n])
      .filter(([id]) => Boolean(id)),
  );
  const parallelSplitTargetsById = new Map();
  const xorSplitTargetsById = new Map();
  nextNodes.forEach((node) => {
    const nodeId = String(node?.id || "");
    if (!nodeId) return;
    if (!isParallelGatewayType(node?.type)) return;
    const outgoing = nextFlows.filter((f) => String(f?.source || "") === nodeId);
    if (outgoing.length < 2) return;
    const targets = outgoing
      .map((f) => String(f?.target || ""))
      .filter(Boolean)
      .sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
    if (targets.length >= 2) {
      parallelSplitTargetsById.set(nodeId, targets);
    }
  });
  nextNodes.forEach((node) => {
    const nodeId = String(node?.id || "");
    if (!nodeId) return;
    if (!isExclusiveGatewayType(node?.type)) return;
    const outgoing = nextFlows.filter((f) => String(f?.source || "") === nodeId);
    if (outgoing.length < 2) return;
    const targets = outgoing
      .map((f) => String(f?.target || ""))
      .filter(Boolean)
      .sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
    if (targets.length >= 2) {
      xorSplitTargetsById.set(nodeId, targets);
    }
  });
  const findParallelSplitForTarget = (targetNodeId) => {
    const targetId = String(targetNodeId || "");
    if (!targetId) return null;
    for (const [splitId, targets] of parallelSplitTargetsById.entries()) {
      const idx = targets.indexOf(targetId);
      if (idx >= 0) {
        return { splitId, branchIndex: idx, branchCount: targets.length };
      }
    }
    return null;
  };
  const findXorSplitForTarget = (targetNodeId) => {
    const targetId = String(targetNodeId || "");
    if (!targetId) return null;
    for (const [splitId, targets] of xorSplitTargetsById.entries()) {
      const idx = targets.indexOf(targetId);
      if (idx >= 0) {
        return { splitId, branchIndex: idx, branchCount: targets.length };
      }
    }
    return null;
  };
  const computeParallelBranchMidY = (laneEl, branchIndex) => {
    const baseY = getBaselineMidY(laneEl);
    const offset = branchIndex * PARALLEL_BRANCH_GAP;
    return Math.round(baseY + offset);
  };
  const computeXorBranchMidY = (laneEl, branchIndex) => {
    const baseY = getBaselineMidY(laneEl);
    const offset = branchIndex * XOR_BRANCH_GAP;
    return Math.round(baseY + offset);
  };

  const getConnectionLabel = (sourceEl, targetEl) => {
    if (!sourceEl || !targetEl) return "";
    const outgoing = Array.isArray(sourceEl.outgoing) ? sourceEl.outgoing : [];
    const match = outgoing.find((conn) => conn?.target?.id === targetEl.id);
    return String(match?.businessObject?.name || "");
  };

  const sortNewNodesTopologically = () => {
    const ids = new Set(newNodes.map((n) => String(n?.id || "")).filter(Boolean));
    const indegree = new Map();
    const outgoing = new Map();
    ids.forEach((id) => {
      indegree.set(id, 0);
      outgoing.set(id, []);
    });
    nextFlows.forEach((flow) => {
      const sourceId = String(flow?.source || "");
      const targetId = String(flow?.target || "");
      if (!ids.has(sourceId) || !ids.has(targetId)) return;
      outgoing.get(sourceId).push(targetId);
      indegree.set(targetId, (indegree.get(targetId) || 0) + 1);
    });
    const queue = [...ids]
      .filter((id) => (indegree.get(id) || 0) === 0)
      .sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
    const result = [];
    while (queue.length) {
      const id = queue.shift();
      result.push(id);
      const succ = outgoing.get(id) || [];
      succ.forEach((nextId) => {
        const nextIn = (indegree.get(nextId) || 0) - 1;
        indegree.set(nextId, nextIn);
        if (nextIn === 0) {
          queue.push(nextId);
          queue.sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
        }
      });
    }
    if (result.length !== ids.size) {
      return [...newNodes].sort((a, b) => {
        const av = nodeOrder.get(String(a?.id || "")) ?? 0;
        const bv = nodeOrder.get(String(b?.id || "")) ?? 0;
        return av - bv;
      });
    }
    return result
      .map((id) => nextNodeById.get(id))
      .filter(Boolean);
  };
  const sortedNewNodes = sortNewNodesTopologically();

  sortedNewNodes.forEach((node) => {
    const incomingFlowsForNode = nextFlows.filter((f) => String(f?.target) === String(node.id));
    const incomingFlow = incomingFlowsForNode[0] || null;
    const sourceEl = incomingFlow ? findElementByEngineId(incomingFlow.source) : null;
    const laneId = node?.laneId ? String(node.laneId) : null;
    const laneEl = laneId ? laneById.get(laneId) : null;
    const laneStillExists = laneEl?.id ? elementRegistry.get(laneEl.id) : null;
    const sourceLaneFallback = sourceEl ? getElementLane(sourceEl) : null;
    const laneForPlacement = laneStillExists || sourceLaneFallback || null;
    const laneMissing = Boolean(laneId) && !laneStillExists;

    const bpmnType = toBpmnType(node);
    const shapeProps = { type: bpmnType, id: node.id };
    if (bpmnType.includes("Task")) {
      shapeProps.width = standardTaskSize.width;
      shapeProps.height = standardTaskSize.height;
    }
    const shape = elementFactory.createShape(shapeProps);
    if (shape?.businessObject) {
      shape.businessObject.name = node?.name || shape.businessObject.name;
      const attrs = ensureAttrs(shape.businessObject);
      if (attrs) attrs["data-engine-id"] = String(node.id);
    }

    try {
      if (laneMissing && !missingLaneWarned) {
        console.warn("[incrementalAppend] lane not found -> skipping lane assignment, creating in process", {
          laneId,
        });
        missingLaneWarned = true;
      }
      const visualParent = laneForPlacement || participantEl || rootEl;
      if (!visualParent) {
        nodeFailure = {
          reason: "missing_process_parent",
          details: {
            nodeId: node?.id || null,
            laneId: laneId || null,
            rootType: processContext?.rootType || "",
            participantFound: Boolean(participantEl),
            processRefFound: Boolean(processContext?.processBo),
          },
        };
        return;
      }
      let x = null;
      let y = null;
      let isAltBranch = false;
      let forceBranchColumn = false;
      let parallelBranchInfo = null;
      let isParallelJoin = false;
      let parallelJoinSplitId = "";
      let xorBranchInfo = null;
      let isXorJoin = false;
      let xorJoinSplitId = "";

      const isNewLaneFirstNode = Boolean(laneForPlacement && !findLastFlowShapeInLane(laneForPlacement));
      const nodeTypeLower = String(node?.type || "").toLowerCase();
      const nodeIsGateway = nodeTypeLower.includes("gateway");
      const incomingFromGateway = Boolean(
        incomingFlowsForNode.some((f) => {
          const src = findElementByEngineId(f?.source);
          const srcType = String(src?.businessObject?.$type || src?.type || "");
          return srcType.includes("Gateway");
        }),
      );
      const allowBranchPlacement = !isNewLaneFirstNode && (nodeIsGateway || incomingFromGateway);

      if (sourceEl) {
        // Baseline deterministic spacing rule for append in lane.
        x = getNextXAfterElement(sourceEl, H_GAP);
        const srcType = String(sourceEl?.businessObject?.$type || sourceEl?.type || "");
        const isGateway = srcType.includes("Gateway");
        if (isGateway && incomingFlow?.source) {
          const flowToThisNode = findFlowBySourceTarget(incomingFlow.source, node.id);
          const engineLabel = String(flowToThisNode?.name || flowToThisNode?.label || "");
          const existingLabel = getConnectionLabel(sourceEl, findElementByEngineId(node.id));
          const branchLabel = engineLabel || existingLabel;
          isAltBranch = isNoBranchLabel(branchLabel);

        }
      }
      parallelBranchInfo = findParallelSplitForTarget(node.id);
      if (allowBranchPlacement && parallelBranchInfo?.splitId) {
        const splitEl = findElementByEngineId(parallelBranchInfo.splitId);
        if (splitEl) {
          x = getNextXAfterElement(splitEl, FLOW_GAP);
          forceBranchColumn = true;
        }
      }
      xorBranchInfo = findXorSplitForTarget(node.id);
      if (allowBranchPlacement && xorBranchInfo?.splitId) {
        const splitEl = findElementByEngineId(xorBranchInfo.splitId);
        if (splitEl) {
          x = getNextXAfterElement(splitEl, FLOW_GAP);
          forceBranchColumn = true;
        }
      }
      const incomingBranchMeta = incomingFlowsForNode
        .map((flow) => findElementByEngineId(flow?.source))
        .filter(Boolean)
        .map((srcEl) => {
          const attrs = srcEl?.businessObject?.$attrs || {};
          return {
            splitId: String(attrs["data-parallel-split-id"] || ""),
            branchIndex: String(attrs["data-parallel-branch-index"] || ""),
            source: srcEl,
          };
        })
        .filter((meta) => meta.splitId && meta.branchIndex !== "");
      const incomingXorMeta = incomingFlowsForNode
        .map((flow) => findElementByEngineId(flow?.source))
        .filter(Boolean)
        .map((srcEl) => {
          const attrs = srcEl?.businessObject?.$attrs || {};
          return {
            splitId: String(attrs["data-xor-split-id"] || ""),
            branchIndex: String(attrs["data-xor-branch-index"] || ""),
            source: srcEl,
          };
        })
        .filter((meta) => meta.splitId && meta.branchIndex !== "");
      if (incomingBranchMeta.length >= 2) {
        const bySplit = new Map();
        incomingBranchMeta.forEach((meta) => {
          if (!bySplit.has(meta.splitId)) bySplit.set(meta.splitId, new Set());
          bySplit.get(meta.splitId).add(meta.branchIndex);
        });
        const winning = [...bySplit.entries()].find(([, branchSet]) => branchSet.size >= 2);
        if (winning) {
          isParallelJoin = true;
          parallelJoinSplitId = winning[0];
        }
      }
      if (incomingXorMeta.length >= 2) {
        const bySplit = new Map();
        incomingXorMeta.forEach((meta) => {
          if (!bySplit.has(meta.splitId)) bySplit.set(meta.splitId, new Set());
          bySplit.get(meta.splitId).add(meta.branchIndex);
        });
        const winning = [...bySplit.entries()].find(([, branchSet]) => branchSet.size >= 2);
        if (winning) {
          isXorJoin = true;
          xorJoinSplitId = winning[0];
        }
      }

      if (laneForPlacement) {
        const laneKey = laneId || String(laneForPlacement.id);
        const cursorX = getLaneCursor(laneKey, laneForPlacement, shape.width || 100);
        if (!forceBranchColumn) {
          const desiredX = x ?? cursorX;
          x = desiredX < cursorX ? cursorX : desiredX;
        }
        const laneTop = laneForPlacement.y + PAD_Y;
        const laneBottom = laneForPlacement.y + laneForPlacement.height - (shape.height || 80) - PAD_Y;
        const baselineMidY = getBaselineMidY(laneForPlacement);
        const branchMidY = getBranchMidY(laneForPlacement, shape.height || 80);
        let targetMidY = isAltBranch ? branchMidY : baselineMidY;
        if (allowBranchPlacement && parallelBranchInfo) {
          targetMidY = computeParallelBranchMidY(
            laneForPlacement,
            parallelBranchInfo.branchIndex,
          );
        } else if (allowBranchPlacement && xorBranchInfo) {
          targetMidY = computeXorBranchMidY(
            laneForPlacement,
            xorBranchInfo.branchIndex,
          );
        } else if (allowBranchPlacement && incomingBranchMeta.length === 1 && !isParallelJoin) {
          // Keep branch chain aligned on the same branch Y until merge.
          const src = incomingBranchMeta[0].source;
          targetMidY = (src.y || 0) + (src.height || 0) / 2;
          if (sourceEl) {
            x = getNextXAfterElement(sourceEl, FLOW_GAP);
            forceBranchColumn = true;
          }
        } else if (allowBranchPlacement && isParallelJoin) {
          targetMidY = baselineMidY;
          const branchSources = incomingBranchMeta
            .filter((meta) => meta.splitId === parallelJoinSplitId)
            .map((meta) => meta.source);
          const maxSourceRight = branchSources.reduce(
            (maxX, src) => Math.max(maxX, getElementRight(src)),
            0,
          );
          if (maxSourceRight > 0) {
            x = maxSourceRight + FLOW_GAP;
            forceBranchColumn = true;
          }
        } else if (allowBranchPlacement && incomingXorMeta.length === 1 && !isXorJoin) {
          const src = incomingXorMeta[0].source;
          targetMidY = (src.y || 0) + (src.height || 0) / 2;
          if (sourceEl) {
            x = getNextXAfterElement(sourceEl, FLOW_GAP);
            forceBranchColumn = true;
          }
        } else if (allowBranchPlacement && isXorJoin) {
          targetMidY = baselineMidY;
          const branchSources = incomingXorMeta
            .filter((meta) => meta.splitId === xorJoinSplitId)
            .map((meta) => meta.source);
          const maxSourceRight = branchSources.reduce(
            (maxX, src) => Math.max(maxX, getElementRight(src)),
            0,
          );
          if (maxSourceRight > 0) {
            x = maxSourceRight + FLOW_GAP;
            forceBranchColumn = true;
          }
        }
        y = Math.min(laneBottom, Math.max(laneTop, targetMidY - (shape.height || 80) / 2));
        x = x ?? cursorX;
        const nextCursor = Math.max(cursorX, x + (shape.width || 100) + H_GAP);
        setLaneCursor(laneKey, nextCursor);
      } else if (x === null || y === null) {
        x = x ?? 240;
        y = y ?? 120;
      }

      x = Math.round(Number(x ?? 240));
      y = Math.round(Number(y ?? 120));
      const created = modeling.createShape(shape, { x, y }, visualParent);
      if (!created) {
        nodeFailure = {
          reason: "create_shape_failed",
          details: { nodeId: node?.id || null, laneId: laneId || null, type: bpmnType },
        };
        return;
      }
      if (created?.businessObject) {
        const attrs = ensureAttrs(created.businessObject);
        if (attrs) attrs["data-engine-id"] = String(node.id);
        if (isAltBranch && attrs) {
          attrs["data-branch"] = "alt";
        }
        if (attrs) {
          if (parallelBranchInfo?.splitId) {
            attrs["data-parallel-split-id"] = parallelBranchInfo.splitId;
            attrs["data-parallel-branch-index"] = String(parallelBranchInfo.branchIndex);
          } else if (incomingBranchMeta.length === 1 && !isParallelJoin) {
            attrs["data-parallel-split-id"] = incomingBranchMeta[0].splitId;
            attrs["data-parallel-branch-index"] = incomingBranchMeta[0].branchIndex;
          } else if (isParallelJoin && parallelJoinSplitId) {
            attrs["data-parallel-join-id"] = parallelJoinSplitId;
          }
          if (xorBranchInfo?.splitId) {
            attrs["data-xor-split-id"] = xorBranchInfo.splitId;
            attrs["data-xor-branch-index"] = String(xorBranchInfo.branchIndex);
          } else if (incomingXorMeta.length === 1 && !isXorJoin) {
            attrs["data-xor-split-id"] = incomingXorMeta[0].splitId;
            attrs["data-xor-branch-index"] = incomingXorMeta[0].branchIndex;
          } else if (isXorJoin && xorJoinSplitId) {
            attrs["data-xor-join-id"] = xorJoinSplitId;
          }
        }
      }
      if (created) {
        createdByEngineId.set(String(node.id), created);
        if (laneForPlacement) {
          try {
            attachNodeToLane(laneForPlacement, created, modeling);
          } catch (error) {
            console.warn("[incrementalAppend] attachNodeToLane failed", {
              laneId: laneForPlacement?.id || null,
              nodeId: node?.id || null,
              error,
            });
          }
        }
        const createdType = String(created.businessObject?.$type || created.type || "");
        if (createdType.includes("StartEvent") || createdType.includes("EndEvent")) {
          positionEventLabel(created);
        } else if (createdType.includes("Gateway")) {
          positionGatewayLabel(created);
        }
      }
    } catch (error) {
      nodeFailure = {
        reason: "create_shape_exception",
        details: { nodeId: node?.id || null, laneId: laneId || null, error: String(error?.message || error) },
      };
    }
  });

  if (nodeFailure) return fail(nodeFailure.reason, nodeFailure.details);

  for (const flow of newFlows) {
    const source = createdByEngineId.get(String(flow.source)) || findElementByEngineId(flow.source);
    const target = createdByEngineId.get(String(flow.target)) || findElementByEngineId(flow.target);
    if (!source || !target) {
      flowFailure = {
        reason: "missing_required_node",
        details: {
          flowId: flow?.id || null,
          sourceId: flow?.source || null,
          targetId: flow?.target || null,
          hasSource: Boolean(source),
          hasTarget: Boolean(target),
        },
      };
      break;
    }
    const already = Array.isArray(source.outgoing)
      ? source.outgoing.some((c) => c?.target?.id === target.id)
      : false;
    if (already) continue;
    try {
      const connection = modeling.connect(source, target, { type: "bpmn:SequenceFlow" });
      if (!connection) {
        flowFailure = {
          reason: "connect_failed",
          details: {
            flowId: flow?.id || null,
            sourceId: source?.id || null,
            targetId: target?.id || null,
          },
        };
        break;
      }
      if (connection?.businessObject) {
        const attrs = ensureAttrs(connection.businessObject);
        if (attrs) attrs["data-engine-id"] = String(flow.id);
        const flowLabel = flow?.name || flow?.label;
        if (flowLabel) {
          modeling.updateProperties(connection, { name: flowLabel });
        } else {
          const srcType = String(source?.businessObject?.$type || source?.type || "");
          if (srcType.includes("ExclusiveGateway")) {
            const outgoing = Array.isArray(source.outgoing) ? source.outgoing.filter((c) => c?.businessObject) : [];
            const hasYes = outgoing.some((c) => normalizeBranchLabel(c.businessObject?.name) === "ano");
            modeling.updateProperties(connection, { name: hasYes ? "Nie" : "Áno" });
          }
        }
        createdConnections.push(connection);
      }
    } catch (error) {
      flowFailure = {
        reason: "connect_exception",
        details: {
          flowId: flow?.id || null,
          sourceId: source?.id || null,
          targetId: target?.id || null,
          error: String(error?.message || error),
        },
      };
      break;
    }
  }

  if (flowFailure) return fail(flowFailure.reason, flowFailure.details);

  const newNodeIds = new Set(newNodes.map((n) => String(n?.id || "")).filter(Boolean));
  const newNodesByLane = new Map();
  newNodes.forEach((node) => {
    if (!node?.laneId) return;
    const laneKey = String(node.laneId);
    if (!newNodesByLane.has(laneKey)) newNodesByLane.set(laneKey, []);
    newNodesByLane.get(laneKey).push(node);
  });

  // Stamp stable branch marker based on gateway outgoing flow labels.
  newNodes.forEach((node) => {
    const el = findElementByEngineId(node?.id);
    if (!el?.businessObject) return;
    const attrs = ensureAttrs(el.businessObject);
    if (!attrs || attrs["data-branch"] === "alt") return;
    const incoming = Array.isArray(el.incoming) ? el.incoming : [];
    const hasNoBranchIncoming = incoming.some((conn) => {
      const srcType = String(conn?.source?.businessObject?.$type || conn?.source?.type || "");
      if (!srcType.includes("Gateway")) return false;
      return isNoBranchLabel(conn?.businessObject?.name);
    });
    if (hasNoBranchIncoming) {
      attrs["data-branch"] = "alt";
    }
  });

  // Keep EndEvent hook-up behavior.
  const hasBranchContextNearNode = (el) => {
    if (!el) return false;
    const attrs = el?.businessObject?.$attrs || {};
    if (
      attrs["data-parallel-split-id"] ||
      attrs["data-parallel-join-id"] ||
      attrs["data-xor-split-id"] ||
      attrs["data-xor-join-id"]
    ) {
      return true;
    }
    const incoming = Array.isArray(el.incoming) ? el.incoming : [];
    const outgoing = Array.isArray(el.outgoing) ? el.outgoing : [];
    const allConns = [...incoming, ...outgoing];
    return allConns.some((conn) => {
      const src = conn?.source;
      const tgt = conn?.target;
      const srcType = String(src?.businessObject?.$type || src?.type || "");
      const tgtType = String(tgt?.businessObject?.$type || tgt?.type || "");
      const srcIsGateway = srcType.includes("Gateway");
      const tgtIsGateway = tgtType.includes("Gateway");
      if (!srcIsGateway && !tgtIsGateway) return false;
      const srcDeg =
        (Array.isArray(src?.incoming) ? src.incoming.length : 0) +
        (Array.isArray(src?.outgoing) ? src.outgoing.length : 0);
      const tgtDeg =
        (Array.isArray(tgt?.incoming) ? tgt.incoming.length : 0) +
        (Array.isArray(tgt?.outgoing) ? tgt.outgoing.length : 0);
      return srcDeg > 2 || tgtDeg > 2;
    });
  };
  newNodesByLane.forEach((laneNodes, laneId) => {
    const endNode = nextNodes.find(
      (n) => String(n?.laneId || "") === laneId && String(n?.type || "").toLowerCase().includes("end"),
    );
    if (!endNode) return;
    const endEl = findElementByEngineId(endNode.id);
    if (!endEl) return;
    const lastNew = laneNodes[laneNodes.length - 1];
    const lastNewEl = lastNew ? findElementByEngineId(lastNew.id) : null;
    if (!lastNewEl) return;

    const incomingToEnd = Array.isArray(endEl.incoming) ? [...endEl.incoming] : [];
    const existingEndIncoming = incomingToEnd[0] || null;
    const existingSource = existingEndIncoming?.source || null;
    const complexBranchEndHookup =
      hasBranchContextNearNode(lastNewEl) || hasBranchContextNearNode(existingSource);
    if (complexBranchEndHookup) {
      return;
    }
    if (existingEndIncoming && existingEndIncoming.source?.id !== lastNewEl.id) {
      try {
        modeling.removeConnection(existingEndIncoming);
      } catch {
        // ignore remove errors
      }
      const src = existingEndIncoming.source;
      if (src) {
        const hasIncoming = Array.isArray(lastNewEl.incoming) ? lastNewEl.incoming.length > 0 : false;
        if (!hasIncoming && src.id !== lastNewEl.id) {
          try {
            modeling.connect(src, lastNewEl, { type: "bpmn:SequenceFlow" });
          } catch {
            // ignore connect errors
          }
        }
      }
    }

    const hasEndLink = Array.isArray(lastNewEl.outgoing)
      ? lastNewEl.outgoing.some((c) => c?.target?.id === endEl.id)
      : false;
    if (!hasEndLink) {
      try {
        modeling.connect(lastNewEl, endEl, { type: "bpmn:SequenceFlow" });
      } catch {
        // ignore connect errors
      }
    }
  });

  // Safety snap only for newly created nodes.
  const extraRerouteNodeIds = new Set();
  const createdElementIds = new Set(
    [...createdByEngineId.values()].map((el) => String(el?.id || "")).filter(Boolean),
  );
  newNodesByLane.forEach((laneNodes, laneId) => {
    const laneEl = laneById.get(laneId);
    if (!laneEl) return;
    laneNodes.forEach((node) => {
      const el = createdByEngineId.get(String(node?.id || ""));
      if (!el) return;
      const attrs = el?.businessObject?.$attrs || {};
      const h = el.height || 0;
      if (!h) return;
      const elType = String(el.businessObject?.$type || el.type || "");
      const baselineMidY = getBaselineMidY(laneEl);
      const branchMidY = getBranchMidY(laneEl, h);
      let targetMidY = attrs["data-branch"] === "alt" ? branchMidY : baselineMidY;
      // Prefer staying on the exact source row for simple append-to-existing chains.
      // This avoids small lane-baseline mismatches that create a visible elbow on the new connection.
      const incomingConns = Array.isArray(el.incoming) ? el.incoming : [];
      if (
        !elType.includes("Gateway") &&
        !elType.includes("StartEvent") &&
        !elType.includes("EndEvent") &&
        attrs["data-branch"] !== "alt" &&
        !attrs["data-parallel-split-id"] &&
        !attrs["data-parallel-join-id"] &&
        !attrs["data-xor-split-id"] &&
        !attrs["data-xor-join-id"] &&
        incomingConns.length === 1
      ) {
        const src = incomingConns[0]?.source || null;
        const srcType = String(src?.businessObject?.$type || src?.type || "");
        if (
          src &&
          !srcType.includes("Gateway") &&
          !srcType.includes("StartEvent") &&
          !srcType.includes("EndEvent")
        ) {
          targetMidY = Number(src.y || 0) + Number(src.height || 0) / 2;
        }
      }
      const parallelSplitId = String(attrs["data-parallel-split-id"] || "");
      const parallelBranchIndexRaw = attrs["data-parallel-branch-index"];
      if (parallelSplitId && parallelBranchIndexRaw !== undefined && parallelBranchIndexRaw !== null) {
        const branchIndex = Number(parallelBranchIndexRaw);
        const branchCount = (parallelSplitTargetsById.get(parallelSplitId) || []).length;
        if (Number.isFinite(branchIndex) && branchCount > 1) {
          targetMidY = computeParallelBranchMidY(laneEl, branchIndex);
        }
      }
      const xorSplitId = String(attrs["data-xor-split-id"] || "");
      const xorBranchIndexRaw = attrs["data-xor-branch-index"];
      if (xorSplitId && xorBranchIndexRaw !== undefined && xorBranchIndexRaw !== null) {
        const branchIndex = Number(xorBranchIndexRaw);
        const branchCount = (xorSplitTargetsById.get(xorSplitId) || []).length;
        if (Number.isFinite(branchIndex) && branchCount > 1) {
          targetMidY = computeXorBranchMidY(laneEl, branchIndex);
        }
      }
      const desiredY = targetMidY - h / 2;
      const dy = Math.round(desiredY - (el.y || 0));
      if (Math.abs(dy) < 0.5) return;
      try {
        modeling.moveShape(el, { x: 0, y: dy }, el.parent || laneEl.parent);
      } catch {
        // ignore move errors
      }
      if (elType.includes("StartEvent") || elType.includes("EndEvent")) {
        positionEventLabel(el);
      } else if (elType.includes("Gateway")) {
        positionGatewayLabel(el);
      }
    });

    // Low-risk guard for undo/redo UX:
    // only realign StartEvent when it was created in this append, not on normal append-to-existing chain.
    const nodesInLane = elementRegistry
      .getAll()
      .filter((el) => isFlowNode(el) && isInLane(el, laneEl));
    nodesInLane.forEach((el) => {
      const elType = String(el?.businessObject?.$type || el?.type || "");
      if (!elType.includes("StartEvent")) return;
      const engineId = String(el?.businessObject?.$attrs?.["data-engine-id"] || "");
      const isNewStart = Boolean(engineId && newNodeIds.has(engineId));
      let shouldAlignExistingStart = false;
      if (!isNewStart) {
        const outgoing = Array.isArray(el.outgoing) ? el.outgoing : [];
        if (outgoing.length === 1) {
          const onlyConn = outgoing[0];
          const target = onlyConn?.target || null;
          const targetId = String(target?.id || "");
          const targetAttrs = target?.businessObject?.$attrs || {};
          const targetHasBranchContext = Boolean(
            targetAttrs["data-parallel-split-id"] ||
              targetAttrs["data-parallel-join-id"] ||
              targetAttrs["data-xor-split-id"] ||
              targetAttrs["data-xor-join-id"] ||
              targetAttrs["data-branch"] === "alt",
          );
          shouldAlignExistingStart = Boolean(targetId && createdElementIds.has(targetId) && !targetHasBranchContext);
        }
      }
      if (!isNewStart && !shouldAlignExistingStart) return;
      const h = Number(el.height || 0);
      if (!h) return;
      const baselineMidY = getBaselineMidY(laneEl);
      const desiredY = baselineMidY - h / 2;
      const dy = Math.round(desiredY - (el.y || 0));
      if (Math.abs(dy) < 0.5) return;
      try {
        modeling.moveShape(el, { x: 0, y: dy }, el.parent || laneEl.parent);
        extraRerouteNodeIds.add(String(el.id || ""));
      } catch {
        // ignore move errors
      }
      positionEventLabel(el);
    });
  });
  const laneBottomMarginById = new Map();
  const registerLaneMargin = (laneId, margin) => {
    if (!laneId) return;
    const key = String(laneId);
    const prev = laneBottomMarginById.get(key) || 0;
    laneBottomMarginById.set(key, Math.max(prev, margin));
  };
  newNodes.forEach((node) => {
    const laneKey = String(node?.laneId || "");
    const nodeId = String(node?.id || "");
    const nodeType = String(node?.type || "").toLowerCase();
    if (!laneKey || !nodeId || !nodeType.includes("gateway")) return;
    const outCount = nextFlows.filter((f) => String(f?.source || "") === nodeId).length;
    const inCount = nextFlows.filter((f) => String(f?.target || "") === nodeId).length;
    if (outCount < 2 && inCount < 2) return;
    if (nodeType.includes("parallel")) {
      registerLaneMargin(laneKey, BOTTOM_MARGIN_AND);
      return;
    }
    if (nodeType.includes("exclusive")) {
      registerLaneMargin(laneKey, BOTTOM_MARGIN_XOR);
      return;
    }
    registerLaneMargin(laneKey, LANE_BOTTOM_PADDING_DEFAULT);
  });

  const fitLaneHeight = (laneEl, bottomMargin) => {
    const currentLane = laneEl?.id ? elementRegistry.get(laneEl.id) : null;
    if (!currentLane) return;
    const oldTop = Number(currentLane.y || 0);
    const oldHeight = Number(currentLane.height || 0);
    const oldBottom = oldTop + oldHeight;
    const laneLeft = Number(currentLane.x || 0);
    const laneRight = laneLeft + Number(currentLane.width || 0);
    const laneBottom = oldBottom;
    const laneBo = currentLane.businessObject;
    const laneNodeIds = new Set(
      (Array.isArray(laneBo?.flowNodeRef) ? laneBo.flowNodeRef : [])
        .map((ref) => String(ref?.id || ref))
        .filter(Boolean),
    );
    const nodesInLane = elementRegistry
      .getAll()
      .filter((el) => {
        if (!isFlowNode(el) || el.type === "label") return false;
        if (el.parent?.id === currentLane.id) return true;
        const boId = String(el?.businessObject?.id || el?.id || "");
        if (laneNodeIds.has(boId)) return true;
        const cx = Number(el.x || 0) + Number(el.width || 0) / 2;
        const cy = Number(el.y || 0) + Number(el.height || 0) / 2;
        return cx >= laneLeft && cx <= laneRight && cy >= oldTop && cy <= laneBottom + 500;
      });
    if (!nodesInLane.length) return;
    const maxBottomRaw = nodesInLane.reduce(
      (maxY, el) => Math.max(maxY, Number(el.y || 0) + Number(el.height || 0)),
      oldBottom,
    );
    const maxBottom = maxBottomRaw + LANE_EXTRA_MARGIN;
    const free = oldBottom - maxBottom;
    if (free >= bottomMargin) return;
    const delta = Math.ceil(bottomMargin - free);
    const neededHeight = Math.max(MIN_LANE_HEIGHT, oldHeight + delta);
    if (neededHeight <= oldHeight + 1) return;
    const deltaY = neededHeight - oldHeight;
    try {
      if (typeof modeling.resizeShape === "function") {
        modeling.resizeShape(currentLane, {
          x: Number(currentLane.x || 0),
          y: oldTop,
          width: Number(currentLane.width || 0),
          height: neededHeight,
        });
      } else {
        modeling.updateProperties(currentLane, { height: neededHeight });
      }
    } catch {
      return;
    }
    const refreshedLane = elementRegistry.get(currentLane.id) || currentLane;
    const lanesBelow = laneElements
      .map((ln) => (ln?.id ? elementRegistry.get(ln.id) || ln : ln))
      .filter((other) => other && other.id !== refreshedLane.id && Number(other.y || 0) >= oldBottom - 1)
      .sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
    lanesBelow.forEach((ln) => {
      try {
        if (typeof modeling.moveShape === "function") {
          modeling.moveShape(ln, { x: 0, y: deltaY }, ln.parent || refreshedLane.parent);
        }
      } catch {
        // ignore lane shift errors
      }
    });
    const container = refreshedLane.parent || null;
    if (!container) return;
    const cX = Number(container.x || 0);
    const cY = Number(container.y || 0);
    const cW = Number(container.width || 0);
    const cH = Number(container.height || 0);
    if (!(cW > 0 && cH > 0)) return;
    try {
      if (typeof modeling.resizeShape === "function") {
        modeling.resizeShape(container, { x: cX, y: cY, width: cW, height: cH + deltaY });
      } else {
        modeling.updateProperties(container, { height: cH + deltaY });
      }
    } catch {
      // ignore container resize errors
    }
  };

  // Grow touched lanes downward when branch layout needs extra vertical space.
  const touchedLanes = [...laneBottomMarginById.keys()]
    .map((laneId) => laneById.get(laneId))
    .filter(Boolean)
    .sort((a, b) => Number(a?.y || 0) - Number(b?.y || 0));
  touchedLanes.forEach((laneEl) => {
    const laneKey = String(laneEl?.businessObject?.$attrs?.["data-engine-id"] || laneEl?.id || "");
    const margin = laneBottomMarginById.get(laneKey) || LANE_BOTTOM_PADDING_DEFAULT;
    fitLaneHeight(laneEl, margin);
  });

  if (typeof modeling.updateWaypoints === "function" && typeof routeFlow === "function") {
    const newElementIds = createdElementIds;
    const movedNodeIds = new Set([...extraRerouteNodeIds]);
    const rerouted = new Set();
    createdConnections.forEach((conn) => {
      if (!conn || rerouted.has(conn.id)) return;
      const source = conn?.source;
      const target = conn?.target;
      if (!source || !target) return;
      const sourceId = String(source.id || "");
      const targetId = String(target.id || "");
      const sourceWasMoved = movedNodeIds.has(sourceId);
      const targetWasMoved = movedNodeIds.has(targetId);
      const shouldReroute = sourceWasMoved || targetWasMoved;
      if (!shouldReroute) return;
      const waypoints = computeWaypointsForConnection(conn);
      if (!waypoints) return;
      try {
        modeling.updateWaypoints(conn, waypoints);
        rerouted.add(conn.id);
      } catch {
        // ignore
      }
    });
  }

  // Freeze existing StartEvent external label positions in touched lanes.
  frozenStartLabelBounds.forEach((savedBounds, startId) => {
    const startEl = elementRegistry.get(startId);
    if (!startEl || !startEl.businessObject?.name) return;
    const labelEl = getExternalLabel(startEl);
    if (!labelEl) return;
    const preferredY = Number(startEl.y || 0) + Number(startEl.height || 0) + 2;
    const restoreBounds = {
      ...savedBounds,
      y: preferredY,
    };
    const currentBounds = {
      x: Number(labelEl.x || 0),
      y: Number(labelEl.y || 0),
      width: Number(labelEl.width || 0),
      height: Number(labelEl.height || 0),
    };
    const changed =
      Math.abs(currentBounds.x - restoreBounds.x) > 0.5 ||
      Math.abs(currentBounds.y - restoreBounds.y) > 0.5 ||
      Math.abs(currentBounds.width - restoreBounds.width) > 0.5 ||
      Math.abs(currentBounds.height - restoreBounds.height) > 0.5;
    if (!changed) return;
    try {
      modeling.updateLabel(startEl, startEl.businessObject.name, restoreBounds);
    } catch {
      // ignore label restore errors
    }
  });

  return ok({
    createdNodes: createdByEngineId.size,
    createdConnections: createdConnections.length,
  });
}
