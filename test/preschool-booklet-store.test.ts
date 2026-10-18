import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyPreschoolStore, getPreschoolRecord, parsePreschoolStore,
  preschoolRecordReady, setPreschoolCatalog, setPreschoolRecord,
  validPreschoolCatalog, validPreschoolRecord, PRESCHOOL_BOOKLETS_KEY,
} from "../src/lib/preschool-booklet-store";
import { mergeGeneralSchoolSettings } from "../src/lib/school-settings-write";

const year = "2026-2027";
const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const id3 = "33333333-3333-4333-8333-333333333333";
const catalog = [
  { id: "lang_1", domain: "Langage", label: "Comprendre une consigne simple" },
  { id: "oral_1", domain: "Communication", label: "Participer aux échanges" },
];
const good = {
  teacherComment: "Progrès encourageants.",
  observations: {
    lang_1: { attainment: "acquired", observation: "Répond sans aide." },
    oral_1: { attainment: "developing", observation: "S'exprime de mieux en mieux." },
  },
};
test("preschool books are strictly qualitative, separate languages and no official averages", () => {
  const s1 = setPreschoolCatalog({}, "french", catalog);
  const s2 = setPreschoolCatalog(s1, "arabic", [
    { id: "arab_1", domain: "Arabe", label: "Identifier les lettres abordées" },
  ]);
  const s3 = setPreschoolRecord(s2, {
    year, classId: id1, periodId: id2, track: "french", studentId: id3,
    record: good, actor: "teacher",
  });
  const store = parsePreschoolStore(s3);
  assert.equal(store.catalogs.french?.length, 2);
  assert.equal(store.catalogs.arabic?.length, 1);
  const french = getPreschoolRecord(store, year, id1, id2, "french", id3);
  const arabic = getPreschoolRecord(store, year, id1, id2, "arabic", id3);
  assert.ok(french);
  assert.equal(arabic, null);
  assert.equal(preschoolRecordReady(catalog, french), true);
  assert.equal(preschoolRecordReady(store.catalogs.arabic!, arabic), false);
  assert.equal((french as any).generalAverage, undefined);
  assert.equal((french as any).rank, undefined);
});
test("incomplete observations block printing but do not destroy drafts", () => {
  const s = setPreschoolRecord(setPreschoolCatalog({}, "french", catalog), {
    year, classId: id1, periodId: id2, track: "french", studentId: id3,
    actor: "teacher", record: { teacherComment: "", observations: {
      lang_1: { attainment: "emerging", observation: "" },
      oral_1: { attainment: "not_observed", observation: "" },
    } },
  });
  const row = getPreschoolRecord(parsePreschoolStore(s), year, id1, id2, "french", id3);
  assert.equal(preschoolRecordReady(catalog, row), false);
  assert.equal(row?.observations.lang_1.attainment, "emerging");
});
test("invalid, duplicate or oversized catalog entries are rejected", () => {
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
test("catalog and existing school settings survive a new assessment entry", () => {
  const original = {
    school_cycles_v1: { enabled: true }, franco_arabic_reports_v1: { format: "combined" },
    school_teaching_signatories_v1: { french: { name: "Directeur" } },
  };
  const saved = setPreschoolCatalog(original, "french", catalog);
  const result = setPreschoolRecord(saved, {
    year, classId: id1, periodId: id2, track: "french", studentId: id3,
    record: good, actor: "teacher",
  });
  assert.deepEqual(result.school_cycles_v1, original.school_cycles_v1);
  assert.deepEqual(result.franco_arabic_reports_v1, original.franco_arabic_reports_v1);
  assert.deepEqual(result.school_teaching_signatories_v1, original.school_teaching_signatories_v1);
  assert.equal(mergeGeneralSchoolSettings(result, { [PRESCHOOL_BOOKLETS_KEY]: emptyPreschoolStore() }), null);
});
