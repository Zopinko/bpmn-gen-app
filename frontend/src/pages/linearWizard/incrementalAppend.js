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

  const computeLaneRightmost = (laneEl) => {
    const nodes = allElements.filter((el) => isFlowNode(el) && isInLane(el, laneEl));
    if (!nodes.length) return laneEl.x + 80;
    return nodes.reduce((max, el) => Math.max(max, (el.x || 0) + (el.width || 0)), laneEl.x + 80);
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
    const w = Math.max(80, Math.round((el.businessObject.name || "").length * 6));
    const h = 28;
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
  const H_GAP = 90;
  const TASK_TO_TASK_GAP = 90;
  const GATEWAY_TO_TASK_GAP = 110;
  const GATEWAY_BRANCH_GAP_X = 120;
  const GATEWAY_MERGE_MIN_GAP = 75;
  const GATEWAY_MERGE_RUNWAY = 120;
  const BRANCH_OFFSET = 120;
  const laneCursorById = new Map();
  const getBaselineMidY = (laneEl) => {
    if (!laneEl) return 0;
    const y = Number(laneEl.y || 0);
    const h = Number(laneEl.height || 0);
    return y + h * BASELINE_RATIO_IN_LANE;
  };
  const getBranchMidY = (laneEl, nodeHeight) => {
    const baselineMidY = getBaselineMidY(laneEl);
    const maxOffset = laneEl.y + laneEl.height - baselineMidY - nodeHeight / 2;
    const effectiveBranchOffset = Math.max(0, Math.min(BRANCH_OFFSET, maxOffset));
    return baselineMidY + effectiveBranchOffset;
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
    if (isExclusiveGateway) {
      const laneForRoute = srcLane || tgtLane;
      const baselineY = laneForRoute ? getBaselineMidY(laneForRoute) : srcMidY;
      const isAlt = tgtAttrs["data-branch"] === "alt" || connName === "nie" || connName === "no" || connName === "false";

      if (isAlt) {
        const branchY = laneForRoute ? getBranchMidY(laneForRoute, th) : tgtMidY;
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

  const getLaneCursor = (laneKey, laneEl) => {
    if (laneCursorById.has(laneKey)) return laneCursorById.get(laneKey);
    const rightmost = laneEl ? computeLaneRightmost(laneEl) : null;
    const start = typeof rightmost === "number" ? rightmost + H_GAP : 240;
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

  const getConnectionLabel = (sourceEl, targetEl) => {
    if (!sourceEl || !targetEl) return "";
    const outgoing = Array.isArray(sourceEl.outgoing) ? sourceEl.outgoing : [];
    const match = outgoing.find((conn) => conn?.target?.id === targetEl.id);
    return String(match?.businessObject?.name || "");
  };

  const sortedNewNodes = [...newNodes].sort((a, b) => {
    const av = nodeOrder.get(String(a?.id || "")) ?? 0;
    const bv = nodeOrder.get(String(b?.id || "")) ?? 0;
    return av - bv;
  });

  sortedNewNodes.forEach((node) => {
    const incomingFlow = nextFlows.find((f) => String(f?.target) === String(node.id));
    const sourceEl = incomingFlow ? findElementByEngineId(incomingFlow.source) : null;
    const laneId = node?.laneId ? String(node.laneId) : null;
    const laneEl = laneId ? laneById.get(laneId) : null;
    const laneStillExists = laneEl?.id ? elementRegistry.get(laneEl.id) : null;
    const laneForPlacement = laneStillExists || null;
    const laneMissing = Boolean(laneId) && !laneForPlacement;

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

      if (sourceEl) {
        const srcType = String(sourceEl?.businessObject?.$type || sourceEl?.type || "");
        const isSourceGateway = srcType.includes("Gateway");
        const spacingX =
          isSourceGateway && bpmnType.includes("Task") ? GATEWAY_TO_TASK_GAP : TASK_TO_TASK_GAP;
        x = (sourceEl.x || 0) + (sourceEl.width || 0) + spacingX;
        const isGateway = srcType.includes("Gateway");
        if (isGateway && incomingFlow?.source) {
          const flowToThisNode = findFlowBySourceTarget(incomingFlow.source, node.id);
          const engineLabel = String(flowToThisNode?.name || flowToThisNode?.label || "");
          const existingLabel = getConnectionLabel(sourceEl, findElementByEngineId(node.id));
          const branchLabel = engineLabel || existingLabel;
          isAltBranch = isNoBranchLabel(branchLabel);

          const isExclusiveGateway = srcType.includes("ExclusiveGateway");
          if (isExclusiveGateway) {
            const outgoingFromGateway = nextFlows.filter(
              (f) => String(f?.source || "") === String(incomingFlow.source || ""),
            );
            const isImmediateBranchTarget = outgoingFromGateway.some(
              (f) => String(f?.target || "") === String(node.id || ""),
            );
            if (outgoingFromGateway.length === 2 && isImmediateBranchTarget) {
              forceBranchColumn = true;
              x = (sourceEl.x || 0) + (sourceEl.width || 0) + GATEWAY_BRANCH_GAP_X;
            }
          }
        }
      }

      if (laneForPlacement) {
        const laneKey = laneId || String(laneForPlacement.id);
        const cursorX = getLaneCursor(laneKey, laneForPlacement);
        if (!forceBranchColumn) {
          const desiredX = x ?? cursorX;
          x = desiredX < cursorX ? cursorX : desiredX;
        }
        const laneTop = laneForPlacement.y;
        const laneBottom = laneForPlacement.y + laneForPlacement.height - (shape.height || 80);
        const baselineMidY = getBaselineMidY(laneForPlacement);
        const branchMidY = getBranchMidY(laneForPlacement, shape.height || 80);
        const targetMidY = isAltBranch ? branchMidY : baselineMidY;
        y = Math.min(laneBottom, Math.max(laneTop, targetMidY - (shape.height || 80) / 2));
        const nextCursor = Math.max(cursorX, x + (shape.width || 100) + H_GAP);
        setLaneCursor(laneKey, nextCursor);
      } else if (x === null || y === null) {
        x = x ?? 240;
        y = y ?? 120;
      }

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

  // Add a visual merge gateway for XOR splits to avoid long branch bridge lines.
  const createConnection = (source, target) => {
    if (!source || !target) return null;
    const already = Array.isArray(source.outgoing)
      ? source.outgoing.some((c) => c?.target?.id === target.id)
      : false;
    if (already) return null;
    const conn = modeling.connect(source, target, { type: "bpmn:SequenceFlow" });
    if (conn) {
      createdConnections.push(conn);
    }
    return conn;
  };
  const removeConnection = (conn) => {
    if (!conn) return;
    try {
      modeling.removeConnection(conn);
    } catch {
      // ignore remove errors
    }
  };
  const exclusiveGateways = elementRegistry
    .getAll()
    .filter((el) => String(el?.businessObject?.$type || el?.type || "").includes("ExclusiveGateway"));
  exclusiveGateways.forEach((gatewayEl) => {
    const outgoing = Array.isArray(gatewayEl.outgoing) ? gatewayEl.outgoing : [];
    if (outgoing.length < 2) return;
    const branchTargets = outgoing.map((c) => c?.target).filter(Boolean);
    if (branchTargets.length < 2) return;

    const successorCounts = new Map();
    branchTargets.forEach((branchEl) => {
      const branchOutgoing = Array.isArray(branchEl?.outgoing) ? branchEl.outgoing : [];
      branchOutgoing.forEach((conn) => {
        const succ = conn?.target;
        if (!succ?.id) return;
        const key = String(succ.id);
        successorCounts.set(key, (successorCounts.get(key) || 0) + 1);
      });
    });
    const commonSuccessorId = [...successorCounts.entries()].find(
      ([, count]) => count >= branchTargets.length,
    )?.[0];
    if (!commonSuccessorId) return;
    const commonSuccessor = elementRegistry.get(commonSuccessorId);
    if (!commonSuccessor) return;
    const alreadyMerged = Array.isArray(commonSuccessor.incoming)
      ? commonSuccessor.incoming.some((conn) => {
          const srcType = String(conn?.source?.businessObject?.$type || conn?.source?.type || "");
          const srcIncoming = Array.isArray(conn?.source?.incoming) ? conn.source.incoming.length : 0;
          return srcType.includes("ExclusiveGateway") && srcIncoming >= 2;
        })
      : false;
    if (alreadyMerged) return;

    const laneEl = laneElements.find((ln) => isInLane(gatewayEl, ln)) || null;
    const baselineMidY = laneEl
      ? getBaselineMidY(laneEl)
      : (gatewayEl.y || 0) + (gatewayEl.height || 0) / 2;
    const mergeSize = 50;
    const mergeX = Math.max(
      (gatewayEl.x || 0) + (gatewayEl.width || 0) + GATEWAY_MERGE_MIN_GAP,
      (commonSuccessor.x || 0) - GATEWAY_MERGE_RUNWAY,
    );
    const mergeY = baselineMidY - mergeSize / 2;
    const visualParent = laneEl || participantEl || rootEl;
    if (!visualParent) return;

    let mergeGateway = null;
    try {
      const mergeShape = elementFactory.createShape({
        type: "bpmn:ExclusiveGateway",
        width: mergeSize,
        height: mergeSize,
      });
      mergeGateway = modeling.createShape(mergeShape, { x: mergeX, y: mergeY }, visualParent);
      if (laneEl && mergeGateway) {
        attachNodeToLane(laneEl, mergeGateway, modeling);
      }
    } catch {
      mergeGateway = null;
    }
    if (!mergeGateway) return;

    branchTargets.forEach((branchEl) => {
      const directToCommon = (Array.isArray(branchEl?.outgoing) ? branchEl.outgoing : []).find(
        (conn) => conn?.target?.id === commonSuccessor.id,
      );
      if (directToCommon) {
        removeConnection(directToCommon);
      }
      createConnection(branchEl, mergeGateway);
    });
    createConnection(mergeGateway, commonSuccessor);
  });

  // Safety snap only for newly created nodes.
  const extraRerouteNodeIds = new Set();
  newNodesByLane.forEach((laneNodes, laneId) => {
    const laneEl = laneById.get(laneId);
    if (!laneEl) return;
    laneNodes.forEach((node) => {
      const el = createdByEngineId.get(String(node?.id || ""));
      if (!el) return;
      const attrs = el?.businessObject?.$attrs || {};
      const h = el.height || 0;
      if (!h) return;
      const baselineMidY = getBaselineMidY(laneEl);
      const branchMidY = getBranchMidY(laneEl, h);
      const targetMidY = attrs["data-branch"] === "alt" ? branchMidY : baselineMidY;
      const desiredY = targetMidY - h / 2;
      const dy = desiredY - (el.y || 0);
      if (Math.abs(dy) < 0.5) return;
      try {
        modeling.moveShape(el, { x: 0, y: dy }, el.parent || laneEl.parent);
      } catch {
        // ignore move errors
      }
      const elType = String(el.businessObject?.$type || el.type || "");
      if (elType.includes("StartEvent") || elType.includes("EndEvent")) {
        positionEventLabel(el);
      } else if (elType.includes("Gateway")) {
        positionGatewayLabel(el);
      }
    });

    // Keep StartEvent aligned with the same baseline as first task to avoid snake-like first connection.
    const nodesInLane = elementRegistry
      .getAll()
      .filter((el) => isFlowNode(el) && isInLane(el, laneEl));
    nodesInLane.forEach((el) => {
      const elType = String(el?.businessObject?.$type || el?.type || "");
      if (!elType.includes("StartEvent")) return;
      const h = Number(el.height || 0);
      if (!h) return;
      const baselineMidY = getBaselineMidY(laneEl);
      const desiredY = baselineMidY - h / 2;
      const dy = desiredY - (el.y || 0);
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

  if (typeof modeling.updateWaypoints === "function" && typeof routeFlow === "function") {
    const newElementIds = new Set(
      [...createdByEngineId.values()].map((el) => String(el?.id || "")).filter(Boolean),
    );
    const rerouteNodeIds = new Set([...newElementIds, ...extraRerouteNodeIds]);
    const rerouted = new Set();
    createdConnections.forEach((conn) => {
      if (!conn || rerouted.has(conn.id)) return;
      const source = conn?.source;
      const target = conn?.target;
      if (!source || !target) return;
      const touchesNewNode =
        rerouteNodeIds.has(String(source.id || "")) || rerouteNodeIds.has(String(target.id || ""));
      if (!touchesNewNode) return;
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
