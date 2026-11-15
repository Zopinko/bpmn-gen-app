import { test } from "node:test";
import assert from "node:assert/strict";
import { spreadToFreeSides } from "./arrowSides.js";

const box = (id, x, y, width = 100, height = 80) => ({ id, x, y, width, height });

test("a merging branch enters from the free bottom side", () => {
  const a = box("a", 100, 60);
  const b = box("b", 100, 180);
  const c = box("c", 280, 60);
  const connections = [
    { id: "ac", source: a, target: c, waypoints: [{ x: 200, y: 100 }, { x: 280, y: 100 }] },
    {
      id: "bc",
      source: b,
      target: c,
      waypoints: [{ x: 200, y: 220 }, { x: 240, y: 220 }, { x: 240, y: 100 }, { x: 280, y: 100 }],
    },
  ];
  const moved = spreadToFreeSides(connections, [a, b, c]);
  assert.deepEqual(moved.get("bc"), [{ x: 200, y: 220 }, { x: 330, y: 220 }, { x: 330, y: 140 }]);
  assert.equal(moved.has("ac"), false);
});

test("a second arrow down leaves through the free right side", () => {
  const a = box("a", 100, 60);
  const b = box("b", 100, 260);
  const c = box("c", 280, 260);
  const connections = [
    { id: "ab", source: a, target: b, waypoints: [{ x: 150, y: 140 }, { x: 150, y: 260 }] },
    {
      id: "ac",
      source: a,
      target: c,
      waypoints: [{ x: 150, y: 140 }, { x: 150, y: 200 }, { x: 330, y: 200 }, { x: 330, y: 260 }],
    },
  ];
  const moved = spreadToFreeSides(connections, [a, b, c]);
  assert.deepEqual(moved.get("ac"), [{ x: 200, y: 100 }, { x: 330, y: 100 }, { x: 330, y: 260 }]);
});

test("nothing moves when the free side would cross another step", () => {
  const a = box("a", 100, 60);
  const b = box("b", 100, 180);
  const blocker = box("x", 290, 160, 80, 40);
  const c = box("c", 280, 60);
  const connections = [
    { id: "ac", source: a, target: c, waypoints: [{ x: 200, y: 100 }, { x: 280, y: 100 }] },
    {
      id: "bc",
      source: b,
      target: c,
      waypoints: [{ x: 200, y: 220 }, { x: 240, y: 220 }, { x: 240, y: 100 }, { x: 280, y: 100 }],
    },
  ];
  assert.equal(spreadToFreeSides(connections, [a, b, c, blocker]).size, 0);
});
