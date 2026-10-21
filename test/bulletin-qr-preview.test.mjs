import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import QRCode from "qrcode";

const require = createRequire(import.meta.url);
const secret = "preview-test-only-secret";
const previous = process.env.BULLETIN_QR_SECRET;
test.before(() => { process.env.BULLETIN_QR_SECRET = secret; });
test.after(() => {
  if (previous === undefined) delete process.env.BULLETIN_QR_SECRET;
  else process.env.BULLETIN_QR_SECRET = previous;
});
function load(name, dependencies = {}) {
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (key) => key in dependencies ? dependencies[key] : require(key), compiledModule, compiledModule.exports,
  );
  return compiledModule.exports;
}
const official = load("official-documents", { "@/lib/supabase-server": {} });
const { isTrustedAppOrigin } = load("request-origin");
const qr = load("bulletin-qr");
const store = load("bulletin-qr-store", { "@/lib/official-documents": official });
const { prepareBulletinPreviewShortCodes } = load("bulletin-qr-preview", {
  "@/lib/bulletin-qr": qr, "@/lib/bulletin-qr-store": store, "@/lib/official-documents": official,
});
const { prepareBulletinQrPreview } = load("bulletin-qr-preview-client");
const institutionId = "11111111-1111-4111-8111-111111111111";
const classId = "22222222-2222-4222-8222-222222222222";
const origin = "https://www.mon-cahier.com";
function payload(index = 1) {
  return { instId: institutionId, classId,
    studentId: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
    academicYear: "2025-2026", periodFrom: "2026-04-06", periodTo: "2026-08-31",
    periodLabel: "T3", periodShortLabel: "T3",
    s: { g: 17.5, r: 2, per_subject: [{ subject_id: "subject", avg20: 18.63, rank: 1 }],
      per_group: [{ group_id: "letters", avg20: 16.94 }], previous_period_avgs: [15.5, 16.5] },
  };
}
function db(rows = [], classes = [{ id: classId, institution_id: institutionId }]) {
  const counts = { reads: 0, inserts: 0, updates: 0 };
  return { rows, counts, from(table) {
    assert.ok(["classes", "bulletin_qr_codes"].includes(table));
    let selected = table === "classes" ? classes : rows;
    return {
      select() { counts.reads++; return this; },
      eq(key, value) { selected = selected.filter((row) => row[key] === value); return this; },
      in(key, values) { selected = selected.filter((row) => values.includes(row[key])); return this; },
      order() { return this; }, limit(size) { selected = selected.slice(0, size); return this; },
      maybeSingle() { return Promise.resolve({ data: selected[0] ?? null, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: selected, error: null }).then(resolve, reject); },
      async insert(item) {
        counts.inserts++;
        if (rows.some((row) => row.code === item.code)) return { error: { code: "23505" } };
        rows.push({ ...item, id: crypto.randomUUID() });
        return { error: null };
      },
      update(changes) { return { eq(key, value) {
        counts.updates++;
        for (const row of rows.filter((item) => item[key] === value)) Object.assign(row, changes);
        return Promise.resolve({ error: null });
      } }; },
    };
  } };
}

test("l'aperçu émet un lien court lisible et conserve exactement le snapshot signé", async () => {
  const database = db(), snapshot = payload();
  const [result] = await prepareBulletinPreviewShortCodes(database, [qr.signBulletinQR(snapshot)], institutionId, origin);
  assert.match(result.qr_url, /^https:\/\/www\.mon-cahier\.com\/v\/[A-Z2-9]{20}$/);
  assert.equal(result.qr_token, null);
  assert.deepEqual(database.rows[0].payload, snapshot);
  assert.ok(QRCode.create(result.qr_url, { errorCorrectionLevel: "Q" }).modules.size + 8 <= 52);
  assert.equal(database.counts.inserts, 1);
});

test("réouvrir cinquante aperçus inchangés fait deux lectures groupées et zéro écriture", async () => {
  const database = db(), tokens = Array.from({ length: 50 }, (_, i) => qr.signBulletinQR(payload(i + 1)));
  const first = await prepareBulletinPreviewShortCodes(database, tokens, institutionId, origin);
  database.counts.reads = database.counts.inserts = database.counts.updates = 0;
  const second = await prepareBulletinPreviewShortCodes(database,
    Array.from({ length: 50 }, (_, i) => qr.signBulletinQR({ ...payload(i + 1), iat: 1 })), institutionId, origin);
  assert.deepEqual(second, first);
  assert.deepEqual(database.counts, { reads: 2, inserts: 0, updates: 0 });
});

test("un QR officiel correspondant est réutilisé sans modifier son payload", async () => {
  const database = db(), snapshot = payload(), token = qr.signBulletinQR(snapshot);
  const [first] = await prepareBulletinPreviewShortCodes(database, [token], institutionId, origin);
  database.rows[0].official_issue_id = "official-issue";
  const before = structuredClone(database.rows[0]);
  database.counts.reads = database.counts.inserts = database.counts.updates = 0;
  const [second] = await prepareBulletinPreviewShortCodes(database, [token], institutionId, origin);
  assert.deepEqual(second, first);
  assert.deepEqual(database.rows[0], before);
  assert.deepEqual(database.counts, { reads: 2, inserts: 0, updates: 0 });
});

test("une note modifiée obtient un autre code sans altérer le bulletin déjà scannable", async () => {
  const database = db(), original = payload();
  const [first] = await prepareBulletinPreviewShortCodes(database, [qr.signBulletinQR(original)], institutionId, origin);
  const changed = { ...original, s: { ...original.s, g: 19 } };
  const [second] = await prepareBulletinPreviewShortCodes(database, [qr.signBulletinQR(changed)], institutionId, origin);
  assert.notEqual(second.qr_code, first.qr_code);
  assert.deepEqual(database.rows.find((row) => row.code === first.qr_code).payload, original);
  assert.deepEqual(database.rows.find((row) => row.code === second.qr_code).payload, changed);
  assert.equal(database.counts.updates, 0);
  const [again] = await prepareBulletinPreviewShortCodes(database, [qr.signBulletinQR(original)], institutionId, origin);
  assert.equal(again.qr_code, first.qr_code);
  assert.equal(database.rows.length, 2);
});

test("un token altéré ou d'un autre établissement est rejeté avant toute requête", async () => {
  for (const token of [qr.signBulletinQR(payload()) + "x",
    qr.signBulletinQR({ ...payload(), instId: crypto.randomUUID() })]) {
    const database = db();
    await assert.rejects(prepareBulletinPreviewShortCodes(database, [token], institutionId, origin), /INVALID_PREVIEW_QR_TOKEN/);
    assert.deepEqual(database.counts, { reads: 0, inserts: 0, updates: 0 });
  }
});

test("une classe étrangère et un lot invalide ne peuvent pas émettre de code", async () => {
  const foreign = db([], []);
  await assert.rejects(prepareBulletinPreviewShortCodes(foreign, [qr.signBulletinQR(payload())], institutionId, origin), /FORBIDDEN_PREVIEW_QR_CLASS/);
  assert.equal(foreign.counts.inserts, 0);
  for (const tokens of [[], Array(51).fill(qr.signBulletinQR(payload())), [qr.signBulletinQR(payload()), qr.signBulletinQR(payload())]]) {
    const database = db();
    await assert.rejects(prepareBulletinPreviewShortCodes(database, tokens, institutionId, origin), /INVALID_PREVIEW_QR_REQUEST/);
    assert.equal(database.counts.reads, 0);
  }
});

test("les aperçus hors ligne et les QR existants ne lancent aucun POST", async () => {
  const request = async () => { throw new Error("unexpected request"); };
  for (const [bulletin, online] of [[{ items: [{ qr_token: "signed" }] }, false],
    [{ items: [{ qr_code: "EXISTING", qr_token: null }] }, true]]) {
    assert.equal(await prepareBulletinQrPreview(bulletin, online, request), bulletin);
  }
});

test("deux ouvertures simultanées mutualisent le POST et ne changent aucune note", async () => {
  const bulletin = { institution: { name: "Test" }, items: [{ qr_token: "signed", qr_code: null,
    official_document_source_id: "source", general_avg: 17.5, per_subject: payload().s.per_subject }] };
  const original = structuredClone(bulletin);
  let calls = 0;
  const request = async (url, options) => {
    calls++;
    assert.equal(url, "/api/admin/grades/bulletin");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { action: "prepare_preview_qr", tokens: ["signed"] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true, json: async () => ({ ok: true, items: [{ official_document_source_id: "source",
      qr_token: null, qr_code: "SHORT", qr_url: `${origin}/v/SHORT` }] }) };
  };
  const [first, second] = await Promise.all([prepareBulletinQrPreview(bulletin, true, request), prepareBulletinQrPreview(bulletin, true, request)]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(bulletin, original);
  assert.deepEqual(first.items[0].per_subject, original.items[0].per_subject);
  assert.equal(first.items[0].general_avg, 17.5);
  assert.equal(first.items[0].qr_code, "SHORT");
  assert.equal(await prepareBulletinQrPreview(first, true, request), first);
  assert.equal(calls, 1);
});

test("une réponse partielle ou refusée ne remplace pas le bulletin courant", async () => {
  const bulletin = { items: [{ qr_token: "signed", official_document_source_id: "source" }] };
  for (const response of [{ ok: false, json: async () => ({ ok: false }) },
    { ok: true, json: async () => ({ ok: true, items: [] }) }]) {
    await assert.rejects(prepareBulletinQrPreview(bulletin, true, async () => response), /QR|préparation/);
    assert.equal(bulletin.items[0].qr_token, "signed");
  }
});

test("l'aperçu d'un snapshot officiel garde sa référence historique", async () => {
  const bulletin = { official_snapshot_locked: true, items: [{ qr_token: "historic-signed",
    official_document_source_id: "source", official_document_number: "BUL-HISTORIC", rank: 2 }] };
  const result = await prepareBulletinQrPreview(bulletin, true, async () => ({
    ok: true, json: async () => ({ ok: true, items: [{ qr_token: null, qr_code: "SHORT",
      official_document_source_id: "source", official_document_number: "BUL-SHORT" }] }),
  }));
  assert.equal(result.items[0].official_document_number, "BUL-HISTORIC");
  assert.equal(result.items[0].rank, 2);
});

test("les lots de plus de cinquante élèves sont bornés et conservent tous les bulletins", async () => {
  const bulletin = { items: Array.from({ length: 101 }, (_, i) => ({
    qr_token: `token-${i}`, official_document_source_id: `source-${i}`, rank: i + 1,
  })) };
  const sizes = [];
  const result = await prepareBulletinQrPreview(bulletin, true, async (_url, options) => {
    const { tokens } = JSON.parse(options.body);
    sizes.push(tokens.length);
    return { ok: true, json: async () => ({ ok: true, items: tokens.map((token) => ({
      official_document_source_id: token.replace("token", "source"), qr_token: null, qr_code: "SHORT",
    })) }) };
  });
  assert.deepEqual(sizes, [50, 50, 1]);
  assert.equal(result.items.length, 101);
  assert.deepEqual(result.items.map((item) => item.rank), bulletin.items.map((item) => item.rank));
});

function postHandler(context) {
  const source = readFileSync(new URL("../src/app/api/admin/grades/bulletin/route.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const post = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "POST").getText(ast);
  const compiled = ts.transpileModule(post, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const counts = { auth: 0, prepare: 0, print: 0 };
  const invoke = new Function("exports", "NextResponse", "getAdminAndInstitution", "getSupabaseServerClient",
    "prepareBulletinPreviewShortCodes", "getSupabaseServiceClient", "pickPublicOrigin", "attachQrPng", "loadBulletin", "isTrustedAppOrigin",
    compiled + "\nreturn POST;")({}, { json: (body, options) => ({ body, status: options?.status ?? 200 }) },
    async () => { counts.auth++; return context; }, async () => ({}),
    async () => { counts.prepare++; return []; }, () => ({}), (value) => value, async (items) => items,
    async (_request, create) => { assert.equal(create, true); counts.print++; return "print"; }, isTrustedAppOrigin);
  return { invoke, counts };
}
function request(headers = {}, body = { action: "prepare_preview_qr", tokens: ["signed"] }) {
  return { headers: new Headers(headers), nextUrl: new URL(origin), json: async () => body };
}

test("le POST refuse une autre origine ou une session non autorisée avant émission", async () => {
  const foreign = postHandler({ institutionId });
  assert.equal((await foreign.invoke(request({ origin: "https://foreign.test", "content-type": "application/json" }))).status, 403);
  assert.deepEqual(foreign.counts, { auth: 0, prepare: 0, print: 0 });
  for (const [error, status] of [["UNAUTHENTICATED", 401], ["FORBIDDEN", 403], ["NO_INSTITUTION", 403]]) {
    const handler = postHandler({ error });
    assert.equal((await handler.invoke(request({ origin, "content-type": "application/json" }))).status, status);
    assert.equal(handler.counts.prepare, 0);
  }
});

test("le POST d'impression existant et le nouveau POST d'aperçu restent distincts", async () => {
  const handler = postHandler({ institutionId });
  assert.equal(await handler.invoke(request({ origin })), "print");
  assert.equal(handler.counts.print, 1);
  assert.equal((await handler.invoke(request({ origin, "content-type": "application/json" }))).status, 200);
  assert.equal(handler.counts.prepare, 1);
  assert.equal((await handler.invoke(request({ origin, "content-type": "application/json" }, { action: "other" }))).status, 400);
  assert.equal(handler.counts.prepare, 1);
});
