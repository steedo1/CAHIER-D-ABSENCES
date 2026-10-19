import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "../..");
const copy = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.sort = []; this.op = "read"; }
  select(_columns, options = {}) { this.head = options.head; return this; }
  eq(key, value) {
    this.filters.push(row => {
      const actual = key.includes("->")
        ? key.split(/->>?/).reduce((part, segment) => part?.[segment], row)
        : row[key];
      if (key.startsWith("settings_json") && typeof value === "string" &&
          (value.startsWith("{") || value.startsWith("["))) {
        try { return same(actual, JSON.parse(value)); }
        catch { return false; }
      }
      return actual === value;
    });
    return this;
  }
  like(key, pattern) { const prefix = pattern.replace(/%$/, ""); this.filters.push(row => String(row[key] || "").startsWith(prefix)); return this; }
  neq(key, value) { this.filters.push(row => row[key] !== value); return this; }
  gte(key, value) { this.filters.push(row => row[key] >= value); return this; }
  lte(key, value) { this.filters.push(row => row[key] <= value); return this; }
  is(key, value) { this.filters.push(row => value === null ? row[key] == null : row[key] === value); return this; }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
  order(key, options = {}) { this.sort.push([key, options.ascending !== false]); return this; }
  range(from, to) { const q = Object.assign(new Query(this.db, this.table), this); q.from = from; q.to = to; return q; }
  limit(count) { return this.range(0, count - 1); }
  insert(value) { this.op = "insert"; this.value = value; return this; }
  upsert(value, options = {}) { this.op = "upsert"; this.value = value; this.conflict = options.onConflict || "id"; return this; }
  update(value) { this.op = "update"; this.value = value; return this; }
  or(expression) {
    const clauses = expression.split(",").map(term => term.split("."));
    this.filters.push(row => clauses.some(([key, op, ...value]) => op === "ilike"
      ? String(row[key] || "").toLocaleLowerCase("fr").includes(value.join(".").replaceAll("%", "").toLocaleLowerCase("fr"))
      : op === "is" ? value.join(".") === "null" && row[key] == null
      : op === "eq" ? String(row[key]) === value.join(".")
      : op === "gte" ? row[key] >= value.join(".")
      : op === "lte" && row[key] <= value.join(".")));
    return this;
  }
  async execute() {
    const table = this.db.tables[this.table] ||= [];
    this.db.calls.push({ table: this.table, op: this.op });
    let rows = table.filter(row => this.filters.every(check => check(row)));
    if (this.table === "grade_evaluations" && this.op === "insert" &&
      (Array.isArray(this.value) ? this.value : [this.value]).some(row => ![5,10,20,40,60].includes(row.scale)))
      return { data: null, error: { code: "23514", message: "grade_evaluations_scale_check" } };
    if (this.op === "insert" && (Array.isArray(this.value) ? this.value : [this.value]).some(row =>
      row.id && table.some(existing => existing.id === row.id))) return { data: null, error: { code: "23505", message: "Duplicate fixture primary key" } };
    if (this.op === "insert" || this.op === "upsert") {
      rows = (Array.isArray(this.value) ? this.value : [this.value]).map(value => {
        const keys = this.conflict?.split(",") || [];
        const found = this.op === "upsert" && table.find(row => keys.every(key => row[key] === value[key]));
        if (found) { Object.assign(found, copy(value)); return found; }
        const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...copy(value) };
        table.push(row); return row;
      });
    } else if (this.op === "update") for (const row of rows) {
      if (this.db.simulatePrimaryLegacyNotificationTrigger && this.table === "grade_evaluations" &&
          this.value.is_published === true && row.is_published !== true) {
        const queue = this.db.tables.notifications_queue ||= [];
        for (const enrollment of this.db.tables.class_enrollments.filter(e => e.class_id === row.class_id)) {
          const grade = (this.db.tables.student_grades || []).find(g => g.evaluation_id === row.id && g.student_id === enrollment.student_id);
          queue.push({ id: crypto.randomUUID(), institution_id: this.db.legacyId, student_id: enrollment.student_id,
            profile_id: null, parent_id: null, status: "pending", payload: { kind: grade?.score == null ? "grade_missing" : "grade",
              score: grade?.score ?? null, scale: row.scale, evaluation: { id: row.id } } });
        }
      }
      Object.assign(row, copy(this.value));
    }
    const count = rows.length;
    rows = rows.slice().sort((a, b) => {
      for (const [key, ascending] of this.sort) {
        const compare = String(a[key] ?? "").localeCompare(String(b[key] ?? ""));
        if (compare) return ascending ? compare : -compare;
      }
      return 0;
    });
    if (this.from !== undefined) rows = rows.slice(this.from, this.to + 1);
    return { data: this.head ? null : copy(rows), error: null, count };
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  async maybeSingle() { const result = await this.execute(); return { ...result, data: result.data?.[0] ?? null }; }
  async single() { const result = await this.execute(); if (result.error) return result; return result.data?.length === 1
    ? { ...result, data: result.data[0] } : { data: null, error: { message: "Expected one row" } }; }
}

export function createMulticycleFixture() {
  const superId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const legacyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const legacyAdminId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const fixture = {
    superId, legacyId, legacyAdminId, calls: [], users: new Map(), tokens: new Map(),
    tables: {
      institutions: [{ id: legacyId, name: "École historique fictive", code_unique: "OLD-TEST", created_at: "2020-01-01", settings_json: { legacy_csca_fixture: true, finance: { preserved: true } } }],
      profiles: [{ id: superId, institution_id: null }, { id: legacyAdminId, institution_id: legacyId }],
      user_roles: [{ id: crypto.randomUUID(), profile_id: superId, institution_id: null, role: "super_admin" },
        { id: crypto.randomUUID(), profile_id: legacyAdminId, institution_id: legacyId, role: "admin" }],
      grade_subject_components: [], classes: [], academic_years: [], institution_subjects: [], subjects: [], class_enrollments: [], class_teachers: [],
    },
  };
  fixture.user = (id, email) => ({ id, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {},
    email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", identities: [] });
  fixture.users.set(superId, { user: fixture.user(superId, "super@example.invalid"), password: "FixtureOnly2026!" });
  fixture.users.set(legacyAdminId, { user: fixture.user(legacyAdminId, "legacy@example.invalid"), password: "FixtureOnly2026!" });
  fixture.service = { from: table => new Query(fixture, table) };
  fixture.client = actorId => ({ ...fixture.service, auth: { getUser: async () => ({
    data: { user: fixture.users.get(actorId)?.user ?? null }, error: null,
  }) } });
  fixture.session = actorId => {
    const user = fixture.users.get(actorId)?.user;
    assert.ok(user, "Synthetic actor must exist");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const unsigned = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp })).toString("base64url")].join(".");
    const access_token = `${unsigned}.${crypto.createHmac("sha256", "isolated-test-fixture-only").update(unsigned).digest("base64url")}`;
    fixture.tokens.set(access_token, actorId);
    return { access_token, refresh_token: `fixture-refresh-${actorId}`, expires_at: exp, expires_in: 3600, token_type: "bearer", user };
  };
  return fixture;
}

/** Loads actual handlers with only the Supabase transport replaced. */
export function createFixtureRouteLoader(fixture, actorId, sourceOverrides = new Map()) {
  const cache = new Map();
  const server = { getSupabaseServerClient: async () => fixture.client(actorId),
    getSupabaseActionClient: async () => fixture.client(actorId), getVerifiedServerUser: client => client.auth.getUser() };
  function load(relative) {
    const file = path.resolve(root, relative);
    if (file.endsWith(".css")) return Object.fromEntries([...readFileSync(file, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match => [match[1], match[1]]));
    if (file === path.join(root, "src/lib/supabase-server.ts")) return server;
    if (file === path.join(root, "src/lib/supabaseAdmin.ts")) return { getSupabaseServiceClient: () => fixture.service };
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} }; cache.set(file, loadedModule);
    const code = ts.transpileModule(sourceOverrides.get(path.relative(root, file).replaceAll("\\", "/")) || readFileSync(file, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    new Function("require", "module", "exports", code)(name => {
      if (name.startsWith("@/") || name.startsWith(".")) {
        const target = name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : path.resolve(path.dirname(file), name);
        for (const suffix of [".ts", ".tsx", ".mjs", ""]) if (existsSync(target + suffix)) return load(path.relative(root, target + suffix));
      }
      return require(name);
    }, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load;
}

/** Loopback HTTP stand-in for Supabase for a real Next/browser test. No SQL,
 * real keys, external network or persistent database is involved. */
export async function startFixtureSupabase(fixture, port = 0) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS,HEAD");
    res.setHeader("Access-Control-Expose-Headers", "content-range");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    const url = new URL(req.url, "http://127.0.0.1");
    const json = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    try {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === "/auth/v1/token") {
        const found = [...fixture.users.entries()].find(([id, entry]) =>
          url.searchParams.get("grant_type") === "refresh_token" ? body.refresh_token === `fixture-refresh-${id}`
            : entry.user.email === body.email && entry.password === body.password);
        if (!found) return json({ message: "Invalid synthetic credentials" }, 401);
        return json(fixture.session(found[0]));
      }
      if (url.pathname === "/auth/v1/user") {
        const id = fixture.tokens.get(String(req.headers.authorization || "").replace(/^Bearer /, ""));
        return id ? json(fixture.users.get(id).user) : json({ message: "Unknown synthetic session" }, 401);
      }
      if (url.pathname === "/auth/v1/admin/users" && req.method === "POST") {
        if ([...fixture.users.values()].some(entry => entry.user.email === body.email)) return json({ message: "User exists" }, 422);
        const user = fixture.user(crypto.randomUUID(), body.email);
        fixture.users.set(user.id, { user, password: body.password });
        return json(user);
      }
      if (url.pathname === "/auth/v1/logout") return json({});
      if (url.pathname.startsWith("/rest/v1/rpc/")) return json({ code: "PGRST202", message: "RPC absent from isolated fixture" }, 404);
      if (!url.pathname.startsWith("/rest/v1/")) return json({ error: "fixture_route_not_found" }, 404);
      const table = url.pathname.slice("/rest/v1/".length);
      let query = fixture.service.from(table);
      for (const [key, expression] of url.searchParams) {
        if (["select", "order", "offset", "limit", "on_conflict"].includes(key)) continue;
        if (key === "or") { query.or(expression.replace(/^\(|\)$/g, "")); continue; }
        const dot = expression.indexOf("."); const op = expression.slice(0, dot), value = expression.slice(dot + 1);
        if (op === "eq") query.eq(key, value === "true" ? true : value === "false" ? false : value);
        else if (op === "is") query.is(key, value === "null" ? null : value);
        else if (op === "in") query.in(key, value.slice(1, -1).split(",").map(item => item.replace(/^"|"$/g, "")));
        else throw new Error(`Unsupported fixture filter ${op}`);
      }
      const prefer = String(req.headers.prefer || "");
      if (req.method === "POST") {
        query = prefer.includes("resolution=merge-duplicates") ? query.upsert(body, { onConflict: url.searchParams.get("on_conflict") || "id" }) : query.insert(body);
      } else if (req.method === "PATCH") query.update(body);
      else if (!["GET", "HEAD"].includes(req.method)) throw new Error("Destructive method prohibited in test fixture");
      for (const term of (url.searchParams.get("order") || "").split(",").filter(Boolean)) {
        const [field, direction] = term.split("."); query.order(field, { ascending: direction !== "desc" });
      }
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Number(url.searchParams.get("limit") || 1000);
      const result = await query.range(offset, offset + limit - 1).execute();
      res.setHeader("Content-Range", result.count ? `0-${Math.max(0, result.data.length - 1)}/${result.count}` : "*/0");
      if (req.method === "HEAD") { res.writeHead(200).end(); return; }
      if (String(req.headers.accept).includes("vnd.pgrst.object")) {
        return result.data.length === 1 ? json(result.data[0]) : json({ code: "PGRST116", message: "Expected one fixture row", details: `The result contains ${result.data.length} rows` }, 406);
      }
      return json(result.data, req.method === "POST" ? 201 : 200);
    } catch (error) { return json({ message: error.message, fixture: true }, 500); }
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
