import test from "node:test";
import assert from "node:assert/strict";
import {
  directAverage, directComponentAverages, directComponentAverageMap, parseAverage20,
  setDirectAverage, setDirectComponentAverages, weightedDirectComponentAverage,
} from "../src/lib/grades/direct-subject-averages";

const P1 = "50000000-0000-0000-0000-000000000001";
const P2 = "50000000-0000-0000-0000-000000000002";
const FRENCH_3E = [
  { id: "composition", coeff: 2, average: 14.5 },
  { id: "oral", coeff: 1, average: 12 },
  { id: "orthographe", coeff: 1, average: 13 },
];

test("3e/4e: French component averages use the actual school coefficient 2:1:1", () => {
  assert.equal(weightedDirectComponentAverage(FRENCH_3E), 13.5);
  assert.equal(weightedDirectComponentAverage([
    { id: "a", coeff: 1, average: 15 },
    { id: "b", coeff: 1, average: 12 },
    { id: "c", coeff: 1, average: 9 },
  ]), 12);
});

test("zero is a real component average; empty is not automatically zero", () => {
  assert.equal(weightedDirectComponentAverage([
    { id: "composition", coeff: 2, average: 0 },
    { id: "oral", coeff: 1, average: null },
    { id: "orthographe", coeff: 1, average: null },
  ]), 0);
  assert.equal(weightedDirectComponentAverage([{ id: "composition", coeff: 2, average: null }]), null);
  assert.equal(parseAverage20("13,75"), 13.75);
  assert.throws(() => weightedDirectComponentAverage([{ id: "s", coeff: -1, average: 12 }]), /coefficient/);
});

test("one annual adjustment record stores independent component averages for each trimester", () => {
  const when = "2026-10-27T12:00:00Z";
  const initial = setDirectAverage("Motif pédagogique conservé", P2, 10, "teacher", when, true);
  const afterT1 = setDirectComponentAverages(initial, P1, FRENCH_3E, "correspondant", when);
  assert.equal(directAverage(afterT1, P1), 13.5);
  assert.deepEqual(directComponentAverages(afterT1, P1),
    { composition: 14.5, oral: 12, orthographe: 13 });
  assert.equal(directAverage(afterT1, P2), 10);
  assert.deepEqual(directComponentAverages(afterT1, P2), {});

  const afterT2 = setDirectComponentAverages(afterT1, P2,
    FRENCH_3E.map(x => ({ ...x, average: x.average - 1 })), "admin", when);
  assert.equal(directAverage(afterT2, P2), 12.5);
  assert.equal(directAverage(afterT2, P1), 13.5);
  assert.deepEqual(directComponentAverages(afterT2, P1), directComponentAverages(afterT1, P1));

  const clearedT1 = setDirectComponentAverages(afterT2, P1,
    FRENCH_3E.map(x => ({ ...x, average: null })), "admin", when);
  assert.equal(directAverage(clearedT1, P1), null);
  assert.equal(directAverage(clearedT1, P2), 12.5);
});

test("component entries are recoverable for official bulletins, with per-student isolation", () => {
  const reason = setDirectComponentAverages(null, P1, FRENCH_3E, "admin", "2026-10-27", true);
  const rows = [{ student_id: "eleve1", subject_id: "francais", reason },
    { student_id: "eleve2", subject_id: "francais", reason: null }];
  const map = directComponentAverageMap(rows, P1);
  assert.equal(map.get("eleve1")?.get("composition"), 14.5);
  assert.equal(map.get("eleve1")?.get("orthographe"), 13);
  assert.equal(map.has("eleve2"), false);
  assert.equal(directComponentAverageMap(rows, P2).size, 0);
});
