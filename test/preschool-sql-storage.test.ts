import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readPreschoolCatalogs, writePreschoolCatalog,
  readPrivatePreschoolRecord, readPrivatePreschoolRecords, writePrivatePreschoolRecord,
} from "../src/lib/preschool-private-records";
import { validPreschoolRecord, preschoolRecordReady } from "../src/lib/preschool-booklet-store";

const INST = "11111111-1111-4111-8111-111111111111";
const CLASS = "22222222-2222-4222-8222-222222222222";
const PERIOD = "33333333-3333-4333-8333-333333333333";
const STUDENT = "44444444-4444-4444-8444-444444444444";
const ACTOR = "55555555-5555-4555-8555-555555555555";
const catalog = [{ id: "oral", domain: "Communication", label: "S'exprimer oralement" }];
type Row = Record<string, any>;
function fakeDB() {
  const tables: Record<string, Row[]> = {
    preschool_competency_catalogs: [], preschool_booklet_records: [],
  };
  const from = (name: string) => {
    if (!tables[name]) throw Error("Unexpected table: " + name);
    const filters: Array<(row: Row) => boolean> = [];
    let update: Row | null = null;
    const matched = () => tables[name].filter(row => filters.every(f => f(row)));
    const query = {
      select: (_columns: string) => query,
      eq: (column: string, expected: unknown) => {
        filters.push(row => row[column] === expected); return query;
      },
      in: (column: string, expected: unknown[]) => {
        filters.push(row => expected.includes(row[column])); return query;
      },
      insert: async (row: Row) => {
        const primary = name === "preschool_competency_catalogs"
          ? ["institution_id", "teaching_track"]
          : ["institution_id", "academic_year", "class_id", "period_id", "teaching_track", "student_id"];
        if (tables[name].some(existing => primary.every(key => existing[key] === row[key]))) {
          return { error: { code: "23505", message: "Unique constraint" } };
        }
        tables[name].push({ ...row });
        return { error: null };
      },
      update: (data: Row) => { update = data; return query; },
      maybeSingle: async () => {
        const rows = matched();
        if (!rows.length) return { data: null, error: null };
        if (update) Object.assign(rows[0], update);
        return { data: { ...rows[0] }, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: matched().map(row => ({ ...row })), error: null }).then(resolve, reject),
    };
    return query;
  };
  return { tables, service: { from } as any };
}

test("catalogue is stored in a dedicated table and revision-locked", async () => {
  const { service, tables } = fakeDB();
  assert.deepEqual(await readPreschoolCatalogs(service, INST), { catalogs: {}, revisions: {} });
  assert.equal(await writePreschoolCatalog(service, INST, "french", catalog, ACTOR, 0), 1);
  assert.equal(tables.preschool_competency_catalogs.length, 1);
  assert.equal((await readPreschoolCatalogs(service, INST)).catalogs.french?.[0].id, "oral");
  await assert.rejects(() => writePreschoolCatalog(service, INST, "french", catalog, ACTOR, 0),
    /catalog_changed_reload_required/);
  assert.equal(await writePreschoolCatalog(service, INST, "french", catalog, ACTOR, 1), 2);
  await assert.rejects(() => writePreschoolCatalog(service, INST, "french", catalog, ACTOR, 1),
    /catalog_changed_reload_required/);
});

test("pupil observations are school/period/class/teaching scoped, with no numeric averages", async () => {
  const { service, tables } = fakeDB();
  const locator = {
    institutionId: INST, year: "2026-2027", classId: CLASS, periodId: PERIOD,
    track: "arabic" as const, studentId: STUDENT,
  };
  assert.equal(await readPrivatePreschoolRecord(service, locator), null);
  const record = { observations: { oral: {
    attainment: "acquired" as const, observation: "Répond aux questions.",
  } }, teacherComment: "Bonne participation." };
  assert.equal(validPreschoolRecord(record, catalog), true);
  const saved = await writePrivatePreschoolRecord(service, locator, record, ACTOR, null);
  assert.equal(saved.observations.oral.attainment, "acquired");
  assert.equal(tables.preschool_booklet_records.length, 1);
  assert.equal((await readPrivatePreschoolRecord(service, locator))?.teacherComment, record.teacherComment);
  const all = await readPrivatePreschoolRecords(service, {
    institutionId: INST, year: "2026-2027", classId: CLASS, periodId: PERIOD,
  }, [STUDENT]);
  assert.equal(all.get(STUDENT + "|arabic")?.observations.oral.attainment, "acquired");
  assert.equal(preschoolRecordReady(catalog, saved), true);
  await assert.rejects(() => writePrivatePreschoolRecord(service, locator, record, ACTOR, null),
    /record_changed_reload_required/);
  await assert.rejects(() => writePrivatePreschoolRecord(service, locator, record, ACTOR, "stale"),
    /record_changed_reload_required/);
  const french = await readPrivatePreschoolRecord(service, { ...locator, track: "french" });
  assert.equal(french, null);
  assert.equal("score" in saved, false);
  assert.equal("rank" in saved, false);
});

test("migration creates only new RLS-isolated catalog and records tables", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261018073000_preschool_booklet_storage.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.preschool_competency_catalogs/);
  assert.match(sql, /create table if not exists public\.preschool_booklet_records/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.preschool_booklet_records from public, anon, authenticated/);
  assert.doesNotMatch(sql, /drop table|truncate|delete from/i);
});
