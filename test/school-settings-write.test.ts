import assert from "node:assert/strict";
import test from "node:test";
import { mergeGeneralSchoolSettings, schoolSettingsRevision, writeSchoolSettings } from "../src/lib/school-settings-write";
import { mergeSchoolCycleProvisioning, readSchoolCycleProvisioning } from "../src/lib/school-cycle-provisioning";
import { parseSchoolCyclesSettings, SCHOOL_CYCLES_SETTINGS_KEY as key } from "../src/lib/school-cycles";
import { readFrancoArabicReportsForEditing, parseFrancoArabicReportsSettings } from "../src/lib/franco-arabic-reporting";
import type { SupabaseClient } from "@supabase/supabase-js";

const subject = "11111111-1111-4111-8111-111111111111";
const stored = { legacy: { csca: true }, [key]: {
  version: 1, enabled: true, enabledCycles: ["primary", "secondary"],
  teachingTracksByCycle: { primary: ["french", "arabic"], secondary: ["french"] },
  subjectTracksByCycle: { primary: { [subject]: ["french", "arabic"] } },
  classCycleById: {}, defaultView: "all", preferredLanguage: "fr",
} };

test("cycle suspension and program removal retain pedagogy and unrelated CSCA keys", () => {
  const incoming = parseSchoolCyclesSettings(stored);
  incoming.teachingTracksByCycle.primary = ["french"];
  incoming.subjectTracksByCycle = {}; // the platform cannot overwrite pedagogy
  const narrowed = mergeSchoolCycleProvisioning(stored, incoming);
  assert.deepEqual(parseSchoolCyclesSettings(narrowed).subjectTracksByCycle.primary?.[subject], ["french"]);
  const suspended = mergeSchoolCycleProvisioning(narrowed, { ...incoming, enabled: false });
  assert.equal(parseSchoolCyclesSettings(suspended).enabled, false);
  assert.deepEqual(parseSchoolCyclesSettings(suspended).enabledCycles, ["secondary"]);
  assert.deepEqual(readSchoolCycleProvisioning(suspended).enabledCycles, ["primary", "secondary"]);
  const restored = mergeSchoolCycleProvisioning(suspended, parseSchoolCyclesSettings(stored));
  assert.deepEqual(parseSchoolCyclesSettings(restored).subjectTracksByCycle.primary?.[subject], ["french", "arabic"]);
  assert.deepEqual(restored.legacy, stored.legacy);
  assert.deepEqual(stored[key].subjectTracksByCycle.primary[subject], ["french", "arabic"]);
});

test("generic settings cannot activate, erase or change reserved settings", () => {
  assert.equal(mergeGeneralSchoolSettings({}, { [key]: stored[key] }), null);
  assert.equal(mergeGeneralSchoolSettings(stored, { [key]: null }), null);
  assert.equal(mergeGeneralSchoolSettings(stored, { school_directors_v1: {} }), null);
  assert.equal(mergeGeneralSchoolSettings(stored, { school_student_programs_v1: { version: 1, years: {} } }), null);
  assert.equal(mergeGeneralSchoolSettings(stored, { school_class_subjects_v1: { version: 1, years: {} } }), null);
  assert.equal(mergeGeneralSchoolSettings(stored, { franco_arabic_reports_v1: {} }), null);
  assert.deepEqual(mergeGeneralSchoolSettings(stored, { theme: "light" }), { ...stored, theme: "light" });
  assert.deepEqual(mergeGeneralSchoolSettings(stored, stored), stored);
  assert.equal(mergeGeneralSchoolSettings(stored, []), null);
});

test("removing and restoring a cycle retains its earlier class mappings and teaching choices", () => {
  const classId = "22222222-2222-4222-8222-222222222222";
  const root = structuredClone(stored);
  root[key].classCycleById = { [classId]: "primary" };
  const active = parseSchoolCyclesSettings(root);
  const removed = mergeSchoolCycleProvisioning(root, { ...active, enabledCycles: ["secondary"],
    teachingTracksByCycle: { secondary: ["french"] }, classCycleById: {} });
  assert.deepEqual(readSchoolCycleProvisioning(removed).teachingTracksByCycle.primary, ["french", "arabic"]);
  const restored = mergeSchoolCycleProvisioning(removed, { ...active, classCycleById: {} });
  assert.equal(parseSchoolCyclesSettings(restored).classCycleById[classId], "primary");
});

test("a revision is stable across object key ordering and changes with contents", () => {
  assert.equal(schoolSettingsRevision({ a: 1, b: { c: 2 } }), schoolSettingsRevision({ b: { c: 2 }, a: 1 }));
  assert.notEqual(schoolSettingsRevision(stored), schoolSettingsRevision({ ...stored, theme: "dark" }));
});

test("settings writes compare previous JSON and institution; conflicts cannot overwrite", async () => {
  const calls: unknown[] = [];
  const query = { update(value: unknown) { calls.push(["update", value]); return this; },
    eq(...args: unknown[]) { calls.push(["eq", ...args]); return this; },
    is(...args: unknown[]) { calls.push(["is", ...args]); return this; },
    select() { return this; }, async maybeSingle() { return { data: null, error: null }; } };
  const service = { from(table: string) { assert.equal(table, "institutions"); return query; } } as unknown as SupabaseClient;
  assert.deepEqual(await writeSchoolSettings(service, "school-a", stored, stored), { error: "settings_changed_reload_required", status: 409 });
  assert.ok(calls.some(item => JSON.stringify(item) === JSON.stringify(["eq", "id", "school-a"])));
  assert.ok(calls.some(item => JSON.stringify(item) === JSON.stringify(["eq", "settings_json", JSON.stringify(stored)])));
  await writeSchoolSettings(service, "school-a", null, {});
  assert.ok(calls.some(item => JSON.stringify(item) === JSON.stringify(["is", "settings_json", null])));
});

test("a suspended bulletin policy remains editable without enabling any calculation", () => {
  const root = { franco_arabic_reports_v1: { version: 1, enabled: false, format: "both",
    scales: [{ cycle: "primary", level: "CP1", track: "french", maxScore: 10 }], coefficients: [] } };
  assert.equal(parseFrancoArabicReportsSettings(root).enabled, false);
  assert.equal(parseFrancoArabicReportsSettings(root).scales.length, 0);
  assert.equal(readFrancoArabicReportsForEditing(root).scales.length, 1);
  assert.equal(readFrancoArabicReportsForEditing(root).enabled, false);
});
