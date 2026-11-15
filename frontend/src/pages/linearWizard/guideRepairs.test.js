import assert from "node:assert/strict";
import { test } from "node:test";
import { findDanglingBranchTask, findIncompleteDecision, findRepairTargets } from "./guideRepairs.js";

const nodes = [
  { id: "check", type: "task" },
  { id: "decision", type: "bpmn:ExclusiveGateway" },
  { id: "approve", type: "task" },
  { id: "correct", type: "userTask" },
  { id: "end", type: "endEvent" },
];
const flows = [
  { source: "check", target: "decision" },
  { source: "decision", target: "approve", name: "Áno" },
  { source: "decision", target: "correct", name: "Nie" },
];

test("finds the other outcome of an incomplete decision with one incoming edge", () => {
  assert.equal(findIncompleteDecision({ nodes, flows: flows.slice(0, 2) }).opposite, "no");
  assert.equal(findIncompleteDecision({ nodes, flows: [{ ...flows[0] }, { ...flows[1], name: "No" }] }).opposite, "yes");
  assert.equal(findIncompleteDecision({ nodes, flows }), null);
  assert.equal(findIncompleteDecision({ nodes, flows: [flows[1]] }), null);
});

test("offers an upstream task first and excludes the source, gateways and end events", () => {
  const result = findRepairTargets({ nodes, flows }, "correct");
  assert.equal(result[0].id, "check");
  assert.deepEqual(result.map((node) => node.id), ["check", "approve"]);
});

test("follows later branch steps and stops offering a repair after connecting the branch", () => {
  const graph = {
    nodes: [...nodes, { id: "submit", type: "task" }],
    flows: [...flows, { source: "approve", target: "end" }, { source: "correct", target: "submit" }],
  };
  assert.equal(findDanglingBranchTask(graph).id, "submit");
  graph.flows.push({ source: "submit", target: "check" });
  assert.equal(findDanglingBranchTask(graph), undefined);
});
