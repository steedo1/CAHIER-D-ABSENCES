import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

function makeRoute({ user = { id: "epc-device", phone: "+22500000000" }, classIds = ["epc-cp1-fr"],
  classRow = { id: "epc-cp1-fr", institution_id: "epc" },
  school = { id: "epc", name: "EPC Dimbokro", tz: "Africa/Abidjan",
    default_session_minutes: 45, auto_lateness: true, settings_json: { academic_year_label: "2026-2027" } },
  periods = [{ id: "slot-1", weekday: 1, label: "Cours", start_time: "08:00", end_time: "09:00" }],
  schoolError = null, periodsError = null } = {}) {
  const queried = [];
  const service = {
    from(table) {
      queried.push(table);
      if (!["classes", "institutions", "institution_periods"].includes(table)) {
        throw new Error(`unexpected ${table}: relay metadata must not be read`);
      }
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        async maybeSingle() {
          if (table === "classes") return { data: classRow, error: null };
          return { data: school, error: schoolError };
        },
        then(resolve, reject) {
          return Promise.resolve({ data: periods, error: periodsError }).then(resolve, reject);
        },
      };
    },
  };
  const imports = {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/supabase-server": {
      getSupabaseServerClient: async () => ({ auth: { getUser: async () =>
        ({ data: { user }, error: null }) } }),
    },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
    "@/lib/class-device-identity": {
      resolveClassDeviceClassIds: async ({ userId, userPhone }) => {
        assert.equal(userId, user.id);
        assert.equal(userPhone, user.phone);
        return classIds;
      },
    },
  };
  const javascript = ts.transpileModule(read("src/app/api/class/institution/basics/route.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", javascript)(exports, (name) => {
    assert.ok(name in imports, `unexpected import: ${name}`);
    return imports[name];
  });
  return { GET: exports.GET, queried };
}

test("EPC sans Relais reçoit ses propres créneaux Cloud, sans politique LAN", async () => {
  const route = makeRoute();
  const response = await route.GET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.institution_id, "epc");
  assert.equal(payload.class_id, "epc-cp1-fr");
  assert.equal(payload.actor_profile_id, "epc-device");
  assert.equal(payload.institution_name, "EPC Dimbokro");
  assert.equal(payload.academic_year_label, "2026-2027");
  assert.equal(payload.periods.length, 1);
  assert.deepEqual(route.queried, ["classes", "institutions", "institution_periods"]);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("un appareil sans classe unique ne peut lire les horaires d'aucune école", async () => {
  for (const ids of [[], ["a", "b"]]) {
    const route = makeRoute({ classIds: ids });
    const response = await route.GET();
    assert.equal(response.status, 403);
    assert.deepEqual(route.queried, []);
  }
});

test("une classe renvoyée qui ne correspond pas au compte connecté est refusée", async () => {
  const route = makeRoute({ classRow: { id: "other-class", institution_id: "other-school" } });
  const response = await route.GET();
  assert.equal(response.status, 403);
  assert.deepEqual(route.queried, ["classes"]);
});

test("les problèmes Cloud ne sont jamais présentés comme un succès ou des données d'une autre école", async () => {
  for (const options of [
    { schoolError: { message: "failed" } },
    { periodsError: { message: "failed" } },
    { school: null },
  ]) {
    const route = makeRoute(options);
    const response = await route.GET();
    assert.ok([404, 503].includes(response.status));
  }
});

test("un utilisateur non authentifié est refusé avant toute lecture", async () => {
  const route = makeRoute({ user: null });
  const response = await route.GET();
  assert.equal(response.status, 401);
  assert.deepEqual(route.queried, []);
});

test("l'écran classe et sa préparation utilisent la route Cloud dédiée en priorité", () => {
  const readiness = read("src/lib/offline-readiness.ts");
  const page = read("src/app/class/page.tsx");
  const cloud = "/api/class/institution/basics";
  assert.ok(readiness.indexOf(cloud) > -1);
  assert.ok(readiness.indexOf(cloud) < readiness.indexOf("/api/teacher/institution/basics?offline_preparation=v1", readiness.indexOf("async function buildClassDeviceScheduleFromCloud")));
  assert.ok(page.indexOf(cloud) < page.indexOf("/api/teacher/institution/basics", page.indexOf("async function loadInstitutionBasics")));
});
