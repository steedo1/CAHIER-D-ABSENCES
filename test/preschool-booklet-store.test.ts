import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  emptyPreschoolStore, parsePreschoolStore, preschoolRecordReady,
  setPreschoolCatalog, validPreschoolCatalog, validPreschoolRecord,
  PRESCHOOL_BOOKLETS_KEY, type PreschoolRecord,
} from "../src/lib/preschool-booklet-store";
import { mergeGeneralSchoolSettings } from "../src/lib/school-settings-write";

const catalog = [
  { id: "lang_1", domain: "Langage", label: "Comprendre une consigne simple" },
  { id: "oral_1", domain: "Communication", label: "Participer aux échanges" },
];
const good: Pick<PreschoolRecord, "observations" | "teacherComment"> = {
  teacherComment: "Progrès encourageants.",
  observations: {
    lang_1: { attainment: "acquired", observation: "Répond sans aide." },
    oral_1: { attainment: "developing", observation: "S'exprime de mieux en mieux." },
  },
};

test("preschool records express separate qualitative progress, never averages or ranks", () => {
  const result: PreschoolRecord = { ...good, editedBy: "teacher", editedAt: "2026-10-18T07:00:00Z" };
  assert.equal(result.observations.lang_1.attainment, "acquired");
  assert.equal(preschoolRecordReady(catalog, result), true);
  assert.equal(preschoolRecordReady(catalog, null), false);
  assert.equal("generalAverage" in result, false);
  assert.equal("rank" in result, false);
  assert.equal("coefficient" in result, false);
});

test("invalid, duplicate or oversized catalog entries and observations are rejected", () => {
  assert.equal(validPreschoolCatalog(catalog), true);
  assert.equal(validPreschoolCatalog([]), false);
  assert.equal(validPreschoolCatalog([...catalog, catalog[0]]), false);
  assert.equal(validPreschoolCatalog([{ id: "A B", label: "OK", domain: "Langage" }]), false);
  assert.equal(validPreschoolRecord(good, catalog), true);
  assert.equal(validPreschoolRecord({ ...good, observations: {
    unexpected: good.observations.lang_1 } }, catalog), false);
  assert.equal(validPreschoolRecord({ ...good, teacherComment: "x".repeat(1001) }, catalog), false);
  assert.equal(validPreschoolRecord({ ...good, observations: {
    lang_1: { attainment: "19", observation: "x" } } }, catalog), false);
});

test("legacy settings store never holds any individual preschool observation", () => {
  const original = {
    school_cycles_v1: { enabled: true }, franco_arabic_reports_v1: { format: "combined" },
    school_teaching_signatories_v1: { french: { name: "Directeur" } },
  };
  const saved = setPreschoolCatalog(original, "french", catalog);
  const result = parsePreschoolStore(saved);
  assert.deepEqual(result.catalogs.french, catalog);
  assert.deepEqual((saved as Record<string, unknown>).school_cycles_v1, original.school_cycles_v1);
  assert.equal(JSON.stringify(saved).includes("Répond sans aide."), false);
  assert.equal("entries" in result, false);
  assert.equal(mergeGeneralSchoolSettings(saved, { [PRESCHOOL_BOOKLETS_KEY]: emptyPreschoolStore() }), null);
});

test("private preschool storage uses SQL with explicit institution scope, never shared storage buckets", () => {
  const source = readFileSync(new URL("../src/lib/preschool-private-records.ts", import.meta.url), "utf8");
  assert.match(source, /from\("preschool_booklet_records"\)/);
  assert.match(source, /from\("preschool_competency_catalogs"\)/);
  assert.match(source, /eq\("institution_id", input\.institutionId\)/);
  assert.doesNotMatch(source, /storage\.from\(/);
});
