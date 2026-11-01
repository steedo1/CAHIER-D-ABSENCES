import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const secret = "isolated-cron-fixture";
const source = readFileSync(new URL("../src/app/api/sms/dispatch/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

const message = {
  id: "queue-a", institution_id: "school-a", profile_id: "profile-a",
  parent_id: null, student_id: null, channels: ["sms"],
  payload: { kind: "attendance", event: "absent" }, title: "Fixture", body: "Fixture",
  status: "pending", attempts: 0, created_at: "2026-10-21T10:00:00Z", meta: {},
};
function fixture({ rows = [], premium = true, parentAllowed = true } = {}) {
  const calls = [], sends = [];
  const service = createClient("https://isolated.invalid", "isolated-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method || "GET";
      calls.push({ table: url.pathname.split("/").at(-1), method, params: url.searchParams,
        body: init.body ? JSON.parse(init.body) : null });
      const table = url.pathname.split("/").at(-1);
      let result = [];
      if (table === "claim_notification_dispatch_batch" && method === "POST") {
        assert.equal(JSON.parse(init.body).p_channel, "sms");
        result = rows;
      } else if (table === "parent_notification_contacts" && method === "GET") {
        result = [{ id: "contact-a", profile_id: "profile-a", institution_id: "school-a",
          phone_e164: "+2250700000000", sms_enabled: true, is_primary: true,
          verified_at: null, created_at: "2026-01-01" }];
      } else if (table === "institutions" && method === "GET") {
        result = { id: "school-a", name: "École synthétique" };
      } else if (!["PATCH", "POST"].includes(method)) {
        throw new Error("Unexpected fixture query: " + table);
      }
      return Response.json(result);
    } },
  });
  const dependencies = {
    "next/server": require("next/server"),
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => service },
    "@/lib/parent-connect/server": { filterParentConnectQueue: async (_db, selected) => parentAllowed ? selected : [] },
    "@/lib/parent-connect/sms": { parentConnectSmsContacts: async () => new Map() },
    "@/lib/sms/messages": { buildSmsMessageFromQueue: () => "Message synthétique sans envoi réel" },
    "@/lib/phone": { normalizePhone: (phone) => phone },
    "@/lib/sms/policy": {
      getInstitutionSmsPolicy: async () => ({ smsPremiumEnabled: premium }),
      resolveSmsProvider: () => "orange_ci", resolveSmsSenderName: () => "MONCAHIER",
      shouldSendSmsForEvent: () => true,
    },
    "@/lib/sms/orange": { sendOrangeSms: async (input) => {
      sends.push(input);
      return { provider: "orange_ci", to: input.to, senderAddress: "fixture",
        senderName: input.senderName, resourceId: "orange-fixture",
        resourceURL: "https://isolated.invalid/requests/orange-fixture",
        httpStatus: 201, response: {} };
    } },
  };
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", "process", "console", compiled)(
    (name) => { assert.ok(name in dependencies, "Unexpected import: " + name); return dependencies[name]; },
    loadedModule, loadedModule.exports, { env: { CRON_SECRET: secret } },
    { info() {}, warn() {}, error() {}, debug() {} },
  );
  const request = (authenticated = true) => new Request("https://www.mon-cahier.com/api/sms/dispatch", {
    method: "POST", headers: authenticated ? { "x-cron-secret": secret } : {},
  });
  return { route: loadedModule.exports, request, calls, sends };
}

test("SMS: le traitement atomique respecte la file vide sans envoi", async () => {
  const s = fixture();
  const response = await s.route.POST(s.request());
  const result = await response.json();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.attempted, 0);
  assert.equal(s.calls[0].table, "claim_notification_dispatch_batch");
  assert.equal(s.calls[0].body.p_channel, "sms");
  assert.equal(s.calls[0].body.p_limit, 25);
  assert.equal(s.sends.length, 0);
});

test("JSONB SMS: aucun accès à la file ni au fournisseur sans authentification", async () => {
  const s = fixture({ rows: [message] });
  const response = await s.route.POST(s.request(false));
  assert.equal(response.status, 403);
  assert.equal(s.calls.length, 0);
  assert.equal(s.sends.length, 0);
});

test("JSONB SMS: Parent Connect continue de bloquer un destinataire non autorisé", async () => {
  const s = fixture({ rows: [message], parentAllowed: false });
  const result = await (await s.route.POST(s.request())).json();
  assert.equal(result.ok, true, result.error);
  assert.equal(s.sends.length, 0);
  assert.ok(s.calls.some(c => c.method === "PATCH" && c.body.last_error === "PARENT_CONNECT_REQUIRED"));
});

test("JSONB SMS: un établissement sans option SMS ne déclenche aucun envoi", async () => {
  const s = fixture({ rows: [message], premium: false });
  const result = await (await s.route.POST(s.request())).json();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.accepted_sms_sends, 0);
  assert.equal(s.sends.length, 0);
  assert.ok(s.calls.some(c => c.method === "PATCH" && c.body.last_error === "sms_premium_disabled"));
});

test("JSONB SMS: une notification admissible atteint le fournisseur simulé une seule fois", async () => {
  const s = fixture({ rows: [message] });
  const result = await (await s.route.POST(s.request())).json();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.attempted, 1);
  assert.equal(result.accepted_sms_sends, 1);
  assert.equal(s.sends.length, 1);
  assert.ok(s.calls.some(c => c.table === "orange_sms_outbox" && c.method === "POST"));
  assert.ok(s.calls.some(c => c.table === "notifications_queue" && c.method === "PATCH" && c.body.status === "sent"));
});
