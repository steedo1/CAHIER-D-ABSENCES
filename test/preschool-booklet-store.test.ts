import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyPreschoolStore, parsePreschoolStore, preschoolRecordReady,
  setPreschoolCatalog, validPreschoolCatalog, validPreschoolRecord,
  PRESCHOOL_BOOKLETS_KEY, type PreschoolRecord,
} from "../src/lib/preschool-booklet-store";
import {
  readPrivatePreschoolRecord, writePrivatePreschoolRecord,
} from "../src/lib/preschool-private-records";
import { mergeGeneralSchoolSettings } from "../src/lib/school-settings-write";

const year = "2026-2027";
const inst = "00000000-0000-4000-8000-000000000000";
const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const id3 = "33333333-3333-4333-8333-333333333333";
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
const location = { institutionId: inst, year, classId: id1, periodId: id2,
  track: "french" as const, studentId: id3 };
function privateStorage() {
  const objects = new Map<string, Buffer>();
  const buckets: string[] = [];
  const service: any = { storage: { from(bucket: string) {
    buckets.push(bucket);
    return {
      download: async (path: string) => {
        const data = objects.get(path);
        return data
          ? { data: new Blob([new Uint8Array(data)]), error: null }
          : { data: null, error: { status: 404, message: "Object not found" } };
      },
      upload: async (path: string, data: Buffer, options: any) => {
        if (!options?.upsert || options.contentType !== "application/json")
          return { error: { message: "forbidden" } };
        objects.set(path, data);
        return { error: null };
      },
    };
  } } };
  return { service, objects, buckets };
}

test("separate private French and Arabic preschool booklets without numeric averages or ranks", async () => {
  const { service, objects, buckets } = privateStorage();
  const saved = await writePrivatePreschoolRecord(service, location, good, id1, null);
  assert.equal(saved.observations.lang_1.attainment, "acquired");
  const read = await readPrivatePreschoolRecord(service, location);
  assert.deepEqual(read, saved);
  assert.equal(await readPrivatePreschoolRecord(service, { ...location, track: "arabic" }), null);
  assert.equal(preschoolRecordReady(catalog, read), true);
  assert.equal(preschoolRecordReady(catalog, null), false);
  assert.equal((read as any).generalAverage, undefined);
  assert.equal((read as any).rank, undefined);
  assert.equal(objects.size, 1);
  assert.ok([...objects.keys()][0].includes(inst + "/" + year + "/" + id1 + "/" + id2 + "/french/" + id3 + ".json"));
  assert.ok(buckets.every(bucket => bucket === "signatures"));
});
test("private storage refuses stale writes to protect other teachers' observations", async () => {
  const { service } = privateStorage();
  const original = await writePrivatePreschoolRecord(service, location, good, id1, null);
  await assert.rejects(writePrivatePreschoolRecord(service, location, good, id1, null),
    /record_changed_reload_required/);
  const later = await writePrivatePreschoolRecord(service, location,
    { ...good, teacherComment: "Nouvelle observation" }, id1, original.editedAt);
  assert.equal((await readPrivatePreschoolRecord(service, location))?.teacherComment,
    "Nouvelle observation");
  assert.ok(later.editedAt);
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
test("settings retain only PUBLIC catalogs; private observations do not enter general school settings", () => {
  const original = {
    school_cycles_v1: { enabled: true }, franco_arabic_reports_v1: { format: "combined" },
    school_teaching_signatories_v1: { french: { name: "Directeur" } },
  };
  const saved = setPreschoolCatalog(original, "french", catalog);
  const result = parsePreschoolStore(saved);
  assert.deepEqual(result.catalogs.french, catalog);
  assert.deepEqual(saved.school_cycles_v1, original.school_cycles_v1);
  assert.equal(JSON.stringify(saved).includes("Répond sans aide."), false);
  assert.equal("entries" in result, false);
  assert.equal(mergeGeneralSchoolSettings(saved, { [PRESCHOOL_BOOKLETS_KEY]: emptyPreschoolStore() }), null);
});
test("school and student identifiers must be valid before accessing the PRIVATE bucket", async () => {
  const { service, objects } = privateStorage();
  await assert.rejects(readPrivatePreschoolRecord(service, { ...location, institutionId: "../other" }),
    /invalid_preschool_record_path/);
  assert.equal(objects.size, 0);
});
