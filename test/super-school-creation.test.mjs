import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const collectionPath = "src/app/api/super/institutions/route.ts";
const cyclePath = "src/app/api/super/institutions/[id]/school-cycles/route.ts";
const request = (path, method, body) => new NextRequest(`https://example.invalid${path}`, {
  method, headers: { "content-type": "application/json", origin: "https://example.invalid" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const schoolCycles = {
  enabled: true, enabledCycles: ["preschool", "primary", "secondary"],
  teachingTracksByCycle: { preschool: ["french", "arabic"], primary: ["french", "arabic"], secondary: ["french", "arabic"] },
};

test("actual creation/list/update handlers complete franco-Arabic onboarding and preserve existing schools", async () => {
  const db = createMulticycleFixture();
  const legacy = structuredClone(db.tables.institutions);
  const load = createFixtureRouteLoader(db, db.superId);
  const collection = load(collectionPath);
  const response = await collection.POST(request("/api/super/institutions", "POST", {
    name: "École franco-arabe fictive", code_unique: "FA-TEST", duration_months: 12,
    settings_json: { existing_preference: "preserved" }, school_cycles: schoolCycles,
  }));
  assert.equal(response.status, 200);
  const { item } = await response.json();
  const inserted = db.tables.institutions.find(row => row.id === item.id);
  assert.deepEqual(inserted.settings_json.school_cycles_v1.enabledCycles, schoolCycles.enabledCycles);
  assert.deepEqual(inserted.settings_json.school_cycles_v1.teachingTracksByCycle, schoolCycles.teachingTracksByCycle);
  assert.equal(inserted.settings_json.existing_preference, "preserved");
  const listing = await collection.GET(request("/api/super/institutions?limit=200", "GET"));
  assert.ok((await listing.json()).items.some(row => row.id === item.id));
  const cycles = load(cyclePath);
  const context = { params: Promise.resolve({ id: item.id }) };
  const read = await cycles.GET(request("/api/super/institutions/cycles", "GET"), context);
  const initial = await read.json();
  assert.equal(read.status, 200);
  const updated = await cycles.PUT(request("/api/super/institutions/cycles", "PUT", {
    ...initial.configuration, revision: initial.revision,
    teachingTracksByCycle: { ...schoolCycles.teachingTracksByCycle, primary: ["arabic"] },
  }), context);
  assert.equal(updated.status, 200);
  assert.deepEqual((await updated.json()).configuration.teachingTracksByCycle.primary, ["arabic"]);
  const stale = await cycles.PUT(request("/api/super/institutions/cycles", "PUT", {
    ...initial.configuration, revision: initial.revision,
  }), context);
  assert.equal(stale.status, 409);
  assert.deepEqual(db.tables.institutions.filter(row => row.id === db.legacyId), legacy);
  assert.equal(db.calls.some(call => ["students", "class_enrollments", "finance_payments"].includes(call.table) && call.op !== "read"), false);
});

test("ordinary legacy schools preserve historical behavior and ordinary schools can opt into multiple French cycles", async () => {
  const db = createMulticycleFixture();
  const collection = createFixtureRouteLoader(db, db.superId)(collectionPath);
  const legacy = await collection.POST(request("/api/super/institutions", "POST", {
    name: "École ordinaire fictive", code_unique: "ORD-TEST", duration_months: 6,
    settings_json: { theme: "existing" },
  }));
  assert.equal(legacy.status, 200);
  const first = await legacy.json();
  assert.deepEqual(db.tables.institutions.find(row => row.id === first.item.id).settings_json, { theme: "existing" });
  const modern = await collection.POST(request("/api/super/institutions", "POST", {
    name: "École ordinaire multicycle fictive", code_unique: "ORD-MULTI-TEST", school_cycles: {
      enabled: true, enabledCycles: ["preschool", "primary"], teachingTracksByCycle: { preschool: ["french"], primary: ["french"] },
    },
  }));
  assert.equal(modern.status, 200);
  const second = await modern.json();
  assert.deepEqual(db.tables.institutions.find(row => row.id === second.item.id).settings_json.school_cycles_v1.teachingTracksByCycle,
    { preschool: ["french"], primary: ["french"] });
});

test("creation rejects empty/disabled teachings, unknown cycles and pedagogical JSON injection before any write", async () => {
  const db = createMulticycleFixture();
  const collection = createFixtureRouteLoader(db, db.superId)(collectionPath);
  for (const invalid of [
    { ...schoolCycles, enabledCycles: [] },
    { ...schoolCycles, enabledCycles: ["unknown"] },
    { ...schoolCycles, teachingTracksByCycle: { ...schoolCycles.teachingTracksByCycle, primary: [] } },
    { ...schoolCycles, subjectTracksByCycle: {} },
  ]) {
    const result = await collection.POST(request("/api/super/institutions", "POST", { name: "Invalid", code_unique: "INVALID", school_cycles: invalid }));
    assert.equal(result.status, 400);
  }
  const result = await collection.POST(request("/api/super/institutions", "POST", {
    name: "Invalid", code_unique: "INVALID", settings_json: { franco_arabic_reports_v1: { enabled: true } },
  }));
  assert.equal(result.status, 400);
  assert.equal(db.tables.institutions.length, 1);
});

test("school administrators and unauthenticated users cannot provision cycles or create institutions", async () => {
  for (const actor of [null, "legacy_admin"]) {
    const db = createMulticycleFixture();
    const load = createFixtureRouteLoader(db, actor === "legacy_admin" ? db.legacyAdminId : null);
    const result = await load(collectionPath).POST(request("/api/super/institutions", "POST", { name: "Unauthorized", code_unique: "NO", school_cycles: schoolCycles }));
    assert.equal(result.status, actor ? 403 : 401);
    const update = await load(cyclePath).PUT(request("/api/super/institutions/cycles", "PUT", schoolCycles), { params: Promise.resolve({ id: db.legacyId }) });
    assert.equal(update.status, actor ? 403 : 401);
    assert.equal(db.calls.some(call => call.op !== "read"), false);
  }
});

test("generic school settings enforce the actual role and cannot bypass reserved cycle configuration", async () => {
  const db = createMulticycleFixture();
  const path = "src/app/api/admin/settings/route.ts";
  const admin = createFixtureRouteLoader(db, db.legacyAdminId)(path);
  const malicious = await admin.POST(request("/api/admin/settings", "POST", { settings_json: { school_cycles_v1: schoolCycles } }));
  assert.equal(malicious.status, 400);
  const safe = await admin.POST(request("/api/admin/settings", "POST", { settings_json: { theme: "safe" } }));
  assert.equal(safe.status, 200);
  assert.equal(db.tables.institutions[0].settings_json.legacy_csca_fixture, true);
  const superResponse = await createFixtureRouteLoader(db, db.superId)(path).POST(request("/api/admin/settings", "POST", { settings_json: {} }));
  assert.equal(superResponse.status, 403);
});

test("navigation metadata never queries student/teacher rosters and always derives the school from the session", async () => {
  const db = createMulticycleFixture();
  db.tables.institutions[0].settings_json.school_cycles_v1 = { version: 1, ...schoolCycles };
  db.tables.academic_years.push({ id: "year", institution_id: db.legacyId, code: "2026-2027", is_current: true, start_date: "2026-09-01" });
  db.tables.classes.push({ id: "class-one", institution_id: db.legacyId, academic_year: "2026-2027", label: "CP1", level: "CP1" },
    { id: "foreign-class", institution_id: "foreign-school", academic_year: "2026-2027", label: "Secret", level: "CP1" });
  const route = createFixtureRouteLoader(db, db.legacyAdminId)("src/app/api/admin/school-cycles/route.ts");
  const response = await route.GET(request("/api/admin/school-cycles?view=navigation&institution_id=foreign-school", "GET"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).classes.map(row => row.id), ["class-one"]);
  assert.equal(db.calls.some(call => ["class_enrollments", "class_teachers", "grade_scores"].includes(call.table)), false);
});
