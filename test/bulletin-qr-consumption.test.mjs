import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const path = new URL("../src/lib/bulletin-qr-store.ts", import.meta.url);
const source = readFileSync(path, "utf8");
const hashOfficialSnapshot = (value) => crypto.createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const store = { exports: {} };
const loadDependency = (name) => name === "@/lib/official-documents"
  ? { hashOfficialSnapshot }
  : require(name);
new Function("require", "module", "exports", compiled)(loadDependency, store, store.exports);
const { findExistingBulletinShortCodes, getOrCreateBulletinShortCode } = store.exports;

function fakeClient(rows = [], readError = null) {
  const calls = { reads: 0, inserts: 0 };
  const client = {
    from(name) {
      assert.equal(name, "bulletin_qr_codes");
      let selected = rows;
      const builder = {
        select() { calls.reads++; return this; },
        eq(key, value) { selected = selected.filter((row) => row[key] === value); return this; },
        in(key, values) { selected = selected.filter((row) => values.includes(row[key])); return this; },
        order() { return this; },
        limit(n) { selected = selected.slice(0, n); return this; },
        maybeSingle() { return Promise.resolve({ data: selected[0] || null, error: readError }); },
        then(resolve, reject) { return Promise.resolve({ data: selected, error: readError }).then(resolve, reject); },
        async insert(item) {
          calls.inserts++;
          await new Promise((resolve) => setTimeout(resolve, 1));
          if (rows.some((row) => row.code === item.code)) return { error: { code: "23505" } };
          rows.push({ ...item, id: crypto.randomUUID() });
          return { error: null };
        },
      };
      return builder;
    },
  };
  return { client, calls, rows };
}

test("la consultation de trente bulletins réutilise les QR en un GET et zéro INSERT", async () => {
  const payloads = Array.from({ length: 30 }, (_, i) => ({ studentId: String(i) }));
  const db = fakeClient(payloads.map((payload, i) => ({
    bulletin_key: String(i), code: `CODE${i}`, payload_hash: hashOfficialSnapshot(payload),
    revoked: false, expires_at: null, official_issue_id: null,
  })));
  const found = await findExistingBulletinShortCodes(db.client, payloads.map((payload, i) => ({
    bulletinKey: String(i), payload,
  })));
  assert.equal(found.size, 30);
  assert.equal(db.calls.reads, 1);
  assert.equal(db.calls.inserts, 0);
});

test("un QR officiel historique reste prioritaire sur un brouillon identique", async () => {
  const payload = { studentId: "1" };
  const db = fakeClient([
    { id: "draft", bulletin_key: "key", code: "DRAFT", payload_hash: hashOfficialSnapshot(payload), revoked: false, official_issue_id: null },
    { id: "official", bulletin_key: "key", code: "OFFICIAL", payload_hash: null, payload, revoked: false, official_issue_id: "issue" },
  ]);
  const found = await findExistingBulletinShortCodes(db.client, [{ bulletinKey: "key", payload }]);
  assert.equal(found.get("key"), "OFFICIAL");
  assert.equal(db.calls.inserts, 0);
});

test("deux créations simultanées du même bulletin convergent sur un seul code", async () => {
  const previous = process.env.BULLETIN_QR_SECRET;
  process.env.BULLETIN_QR_SECRET = "test-only-qr-secret";
  try {
    const db = fakeClient();
    const opts = { bulletinKey: "bulletin-1", payload: { studentId: "1" } };
    const [first, second] = await Promise.all([
      getOrCreateBulletinShortCode(db.client, opts),
      getOrCreateBulletinShortCode(db.client, opts),
    ]);
    assert.equal(first, second);
    assert.equal(db.rows.length, 1);
  } finally {
    if (previous === undefined) delete process.env.BULLETIN_QR_SECRET;
    else process.env.BULLETIN_QR_SECRET = previous;
  }
});

test("une lecture en erreur ne déclenche pas une insertion de remplacement", async () => {
  const db = fakeClient([], { code: "PGRST301", message: "read failed" });
  await assert.rejects(getOrCreateBulletinShortCode(db.client, {
    bulletinKey: "bulletin-2", payload: { studentId: "2" },
  }));
  assert.equal(db.calls.inserts, 0);
});

test("la route bulletin réserve les écritures à POST", () => {
  const route = readFileSync(new URL("../src/app/api/admin/grades/bulletin/route.ts", import.meta.url), "utf8");
  assert.match(route, /export async function GET\(req: NextRequest\) \{\s*return loadBulletin\(req, false\)/);
  assert.match(route, /export async function POST\(req: NextRequest\)/);
  assert.match(route, /return loadBulletin\(req, true\)/);
  assert.match(route, /if \(!opts\.createQr\) \{/);
});

test("les parcours des retards ne demandent plus id à la vue sans id", () => {
  for (const name of [
    "admin/absences/by-class", "parent/children/conduct", "public/bulletins/verify",
  ]) {
    const code = readFileSync(new URL(`../src/app/api/${name}/route.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(code, /\.from\("v_tardy_minutes"\)/);
    assert.match(code, /\.from\("v_mark_minutes"\)[\s\S]*?\.gt\("minutes_late", 0\)/);
  }
});
