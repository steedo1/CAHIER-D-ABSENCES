import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(path, imports = {}) {
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", compiled)(exports, (name) => {
    assert.ok(name in imports, `${path}: unexpected import ${name}`);
    return imports[name];
  });
  return exports;
}
const phones = load("src/lib/phone-login.ts", { "@/lib/phone": load("src/lib/phone.ts") });
// Anonymized reproduction of the reported account: two Auth identities for a
// zero-preserved / zero-stripped number, five Tuesday courses on only one.
const canonical = "+2250701020304", legacy = "+225701020304";
const classes = ["TD1", "TA", "1A", "TD2", "1D1"];
function fixture({ duplicate = true, canonicalPassword = "correct", profileError = false,
  peerInstitution = "school", peerTeacher = true, peerAssigned = true, legacyAssigned = false, classIdentity = false } = {}) {
  const attempts = [], cookies = [];
  const users = [{ id: "legacy", phone: legacy.slice(1), password: "correct" }];
  if (duplicate) users.push({ id: "planned", phone: canonical.slice(1), password: canonicalPassword });
  if (classIdentity) users.push({ id: "class-device", phone: "2250202020200", password: "correct" });
  const tables = {
    profiles: [{ id: "legacy", institution_id: "school", phone: legacy },
      ...(duplicate ? [{ id: "planned", institution_id: peerInstitution, phone: canonical }] : [])],
    user_roles: peerTeacher ? [{ profile_id: "planned", institution_id: peerInstitution, role: "teacher" }] : [],
    academic_years: [{ institution_id: "school", code: "2026-2027", is_current: true }],
    classes: classes.map((id) => ({ id, institution_id: "school", academic_year: "2026-2027", label: id, level: id })),
    institution_periods: classes.map((_, i) => ({ id: `period-${i}`, institution_id: "school", weekday: 2,
      start_time: ["08:10:00", "09:05:00", "11:10:00", "14:30:00", "15:25:00"][i],
      end_time: ["09:05:00", "10:00:00", "12:05:00", "15:25:00", "16:20:00"][i], period_no: i + 1 })),
    class_teachers: [], teacher_timetables: [], institution_subjects: [],
    attendance_schedule_revisions: [{ institution_id: "school", revision: 100, preparation_revision: 90 }],
  };
  for (const [id, enabled] of [["planned", peerAssigned], ["legacy", legacyAssigned]]) {
    if (!enabled || (id === "planned" && !duplicate)) continue;
    classes.forEach((classId, i) => {
      tables.class_teachers.push({ institution_id: "school", class_id: classId, teacher_id: id, subject_id: null, end_date: null });
      tables.teacher_timetables.push({ institution_id: "school", class_id: classId, teacher_id: id, period_id: `period-${i}`, subject_id: null });
    });
  }
  function query(table) {
    assert.ok(table in tables, table);
    let rows = [...tables[table]], limit = Infinity;
    const result = () => ({ data: rows.slice(0, limit), error: table === "profiles" && profileError ? { message: "unavailable" } : null });
    return {
      select() { return this; },
      eq(key, value) { rows = rows.filter((row) => row[key] === value); return this; },
      in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return this; },
      is(key, value) { return this.eq(key, value); },
      limit(value) { limit = value; return this; },
      order() { return this; },
      async maybeSingle() { const r = result(); return { ...r, data: r.data[0] || null }; },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
  }
  const service = { from: query, auth: { admin: { async getUserById(id) {
    return { data: { user: users.find((user) => user.id === id) || null }, error: null };
  } } } };
  const server = { NextResponse: { json(body, options) {
    const response = Response.json(body, options);
    response.cookies = { set: (value) => cookies.push(value) };
    return response;
  } } };
  const login = load("src/app/api/auth/login/route.ts", {
    "next/server": server,
    "@/lib/phone-login": phones,
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
    "@/lib/class-device-identity": { resolveClassDeviceLogin: async () => classIdentity
      ? { status: "resolved", auth_user_id: "class-device", phone: "+2250202020200", email: null }
      : { status: "not_found" } },
    "@supabase/supabase-js": { createClient: () => ({ auth: { async signInWithPassword(credentials) {
      attempts.push(credentials.phone || credentials.email);
      const user = users.find((row) => `+${row.phone}` === credentials.phone && row.password === credentials.password);
      return user
        ? { data: { user, session: { access_token: "fixture-access", refresh_token: "fixture-refresh" } }, error: null }
        : { data: null, error: { message: "Invalid login credentials" } };
    } } }) },
  });
  return { attempts, cookies, tables, service,
    async signIn(phone = "0701020304", password = "correct") {
      const request = new Request("https://fixture.invalid/api/auth/login", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, password }) });
      request.nextUrl = new URL(request.url);
      return login.POST(request);
    },
    async bootstrap(actor) {
      const route = load("src/app/api/teacher/offline/bootstrap/route.ts", {
        "next/server": server, "@/lib/phone-login": phones,
        "@/lib/supabase-server": { getSupabaseServerClient: async () => ({ auth: {
          getUser: async () => ({ data: { user: users.find((user) => user.id === actor) || null } }),
        } }) },
        "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
        "@/lib/offline-release": { MON_CAHIER_WEB_RELEASE: "test" },
        "@/lib/attendance-schedule-revision-server": load("src/lib/attendance-schedule-revision-server.ts"),
      });
      return route.GET(new Request("https://fixture.invalid/api/teacher/offline/bootstrap?offline_preparation=v1"));
    },
  };
}

test("local, spaced, international and 00-prefix Ivorian logins all preserve the zero", () => {
  for (const input of ["0701020304", "07 01 02 03 04", canonical, canonical.slice(1), `00${canonical.slice(1)}`]) {
    assert.deepEqual(phones.phoneLoginCandidates(input, "CI"), [canonical, legacy]);
  }
  assert.deepEqual(phones.phoneLoginCandidates("0701020304"), [canonical, legacy]);
  assert.deepEqual(phones.phoneLoginCandidates("0612345678", "FR"), ["+33612345678"]);
  assert.deepEqual(phones.phoneLoginCandidates("+33612345678", "CI"), ["+33612345678"]);
  assert.deepEqual(phones.phoneLoginCandidates(""), []);
  assert.deepEqual(phones.phoneLoginCandidates(legacy), [legacy], "an explicit legacy identity is not silently reassigned");
});

test("the real login route selects the account with its five weekly courses", async () => {
  const f = fixture();
  const response = await f.signIn();
  assert.equal(response.status, 200);
  const login = await response.json();
  assert.equal(login.user.id, "planned");
  assert.deepEqual(f.attempts, [canonical]);
  const scheduleResponse = await f.bootstrap(login.user.id);
  assert.equal(scheduleResponse.status, 200);
  const schedule = await scheduleResponse.json();
  assert.equal(schedule.actor_profile_id, "planned");
  assert.equal(schedule.class_count, 5);
  assert.equal(schedule.slot_count, 5);
  assert.equal(schedule.assignments.length, 5);
  assert.ok(schedule.slots.every((slot) => slot.weekday === 2));
  assert.deepEqual(schedule.slots.flatMap((slot) => slot.items.map((item) => item.class_id)), classes);
});

test("a wrong canonical password cannot fall through to the duplicate's accepted password", async () => {
  const f = fixture({ canonicalPassword: "different" });
  const response = await f.signIn();
  assert.equal(response.status, 401);
  assert.deepEqual(f.attempts, [canonical]);
  assert.equal(f.cookies.length, 0);
  assert.equal((await response.json()).error, "Invalid login credentials");
});

test("teachers whose only account uses the old number retain password login and their schedule", async () => {
  const f = fixture({ duplicate: false, legacyAssigned: true });
  const response = await f.signIn();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, "legacy");
  assert.deepEqual(f.attempts, [canonical, legacy]);
  const schedule = await f.bootstrap("legacy");
  assert.equal(schedule.status, 200);
  assert.equal((await schedule.json()).slot_count, 5);
});

test("an opaque classroom identifier still resolves its dedicated Auth identity before phone login", async () => {
  const f = fixture({ classIdentity: true });
  const response = await f.signIn("TA1");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, "class-device");
  assert.deepEqual(f.attempts, ["+2250202020200"]);
});

test("a directory failure cannot select the old duplicate or issue a session", async () => {
  const f = fixture({ profileError: true });
  assert.equal((await f.signIn()).status, 500);
  assert.deepEqual(f.attempts, []);
  assert.equal(f.cookies.length, 0);
});

test("an already connected duplicate receives a private reconnect error, without the other account's data", async () => {
  const f = fixture();
  const response = await f.bootstrap("legacy");
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "teacher_phone_account_conflict" });
  assert.match(response.headers.get("Cache-Control"), /no-store/);
});

for (const [description, options] of [
  ["another institution", { peerInstitution: "other-school" }],
  ["a non-teacher contact", { peerTeacher: false }],
  ["another empty account", { peerAssigned: false }],
]) test(`an empty schedule is not classified as an account conflict with ${description}`, async () => {
  const response = await fixture(options).bootstrap("legacy");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).slot_count, 0);
});

test("a canonical contact number cannot select a different Auth phone", async () => {
  const f = fixture();
  f.service.auth.admin.getUserById = async () => ({ data: { user: { id: "planned", phone: "2250500000000" } }, error: null });
  assert.equal(await phones.findCanonicalPhoneAccount(f.service, canonical), null);
  assert.equal((await f.bootstrap("legacy")).status, 200);
});

test("the conflict message asks for reconnection, without automatic retries or data removal", () => {
  const errors = load("src/lib/offline-preparation-failure.ts");
  const failure = new Error("teacher_phone_account_conflict");
  assert.equal(errors.retryableOfflinePreparationFailure(failure), false);
  assert.match(errors.offlinePreparationFailureMessage(failure), /ancien compte sans cours.*10 chiffres.*zéro initial.*conservées/);
});
