import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestHandoffLaneId } from "./guideHandoff.js";

const lanes = [
  { id: "handler", name: "Spracovateľ" },
  { id: "manager", name: "Vedúci oddelenia" },
  { id: "service", name: "Customer Service" },
];

test("suggests a role named in the step, including common Slovak dative forms", () => {
  assert.equal(suggestHandoffLaneId("Pošle žiadosť SPRACOVATEĽOVI.", lanes), "handler");
  assert.equal(suggestHandoffLaneId("Pošle ju vedúcemu oddelenia.", lanes), "manager");
  assert.equal(suggestHandoffLaneId("Send to customer service.", lanes), "service");
});

test("requires whole words and one unambiguous role", () => {
  assert.equal(suggestHandoffLaneId("Otvorí spracovateľský formulár.", lanes), "");
  assert.equal(suggestHandoffLaneId("Pošle dokument.", lanes), "");
  assert.equal(suggestHandoffLaneId("Notify Customer Service and Spracovateľ.", lanes), "");
  assert.equal(suggestHandoffLaneId("Notify Customer Service.", [...lanes, { id: "other", name: "Customer Service" }]), "");
});
