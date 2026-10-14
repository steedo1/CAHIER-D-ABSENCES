import assert from "node:assert/strict";
import { test } from "node:test";
import { educatorAssignmentCoversClass, educatorNeedsAssignedClasses } from "../src/lib/auth/educator-class-scope";

test("un éducateur sans autre rôle de gestion est limité aux classes confiées", () => {
  assert.equal(educatorNeedsAssignedClasses(new Set(["educator"])), true);
  assert.equal(educatorNeedsAssignedClasses(new Set(["educator", "admin"])), false);
  assert.equal(educatorNeedsAssignedClasses(new Set(["admin"])), false);
  const assigned = [
    { class_id: "six-a", level: "6e" },
    { class_id: "six-b", level: "6e" },
    { class_id: null, level: "5eme" },
  ];
  assert.equal(educatorAssignmentCoversClass({ id: "six-a", level: "6e" }, assigned), true);
  assert.equal(educatorAssignmentCoversClass({ id: "six-c", level: "6e" }, assigned), false);
  assert.equal(educatorAssignmentCoversClass({ id: "five-a", level: "5e" }, assigned), true);
  assert.equal(educatorAssignmentCoversClass({ id: "four-a", level: "4e" }, assigned), false);
  assert.equal(educatorAssignmentCoversClass({ id: "five-a", level: "5e", education_type: "technical_secondary" }, assigned), false);
});

test("l'absence d'affectation ferme l'accès", () => {
  assert.equal(educatorAssignmentCoversClass({ id: "some-class", level: "6e" }, []), false);
});
