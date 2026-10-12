import assert from "node:assert/strict";
import crypto from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import QRCode from "qrcode";

const require = createRequire(import.meta.url);
const secret = "test-only-bulletin-signing-secret";
const previousSecret = process.env.BULLETIN_QR_SECRET;
const previousMode = process.env.BULLETIN_QR_MODE;
test.before(() => {
  process.env.BULLETIN_QR_SECRET = secret;
  process.env.BULLETIN_QR_MODE = "short";
});
test.after(() => {
  if (previousSecret === undefined) delete process.env.BULLETIN_QR_SECRET;
  else process.env.BULLETIN_QR_SECRET = previousSecret;
  if (previousMode === undefined) delete process.env.BULLETIN_QR_MODE;
  else process.env.BULLETIN_QR_MODE = previousMode;
});

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
}
const module = { exports: {} };
new Function("require", "module", "exports", compile(readFileSync(
  new URL("../src/lib/bulletin-qr.ts", import.meta.url), "utf8",
)))(require, module, module.exports);
const { signBulletinQR, verifyBulletinQR } = module.exports;

function loadQrRoute(existing = new Map()) {
  const source = readFileSync(new URL("../src/app/api/admin/grades/bulletin/route.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const functions = new Set(["b64urlEncode", "signBulletinQRToken", "computeBulletinKey", "addQrToItems", "attachQrPng"]);
  const snippet = ast.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && functions.has(statement.name?.text),
  ).map((statement) => statement.getText(ast)).join("\n");
  const calls = { reads: 0, writes: 0 };
  const route = new Function("crypto", "QRCode", "signBulletinQR", "findExistingBulletinShortCodes",
    "getOrCreateBulletinShortCode", "bulletinOfficialNumber", "cleanNumber", compile(`
      const BULLETIN_VERIFY_SHORT_PREFIX = "/v";
      const BULLETIN_VERIFY_LEGACY_PATH = "/verify/bulletin";
      ${snippet}
    `) + "\nreturn {addQrToItems, attachQrPng};")(
    crypto, QRCode, signBulletinQR,
    async (_srv, candidates) => {
      calls.reads++;
      assert.equal(candidates.length, 1);
      return new Map(candidates.filter((candidate) => existing.has("code"))
        .map((candidate) => [candidate.bulletinKey, existing.get("code")]));
    },
    async () => { calls.writes++; throw new Error("GET must not create a QR"); },
    (code, key) => `BUL-${code || key.slice(0, 12).toUpperCase()}`,
    (n) => n == null ? null : Number(n),
  );
  return { ...route, calls };
}

function fixture() {
  const subjects = Array.from({ length: 12 }, (_, i) => ({
    subject_id: crypto.randomUUID(), subject_name: `Matière ${i + 1}`,
    coeff_bulletin: 1, include_in_average: true, teacher_name: `Professeur de recette ${i + 1}`,
  }));
  const snapshot = {
    g: 16.25, a: 15.75, c: 19, r: 1, ar: 2, decision: "Admis",
    subjects, subject_groups: [], subject_components: [],
    per_subject: subjects.map((subject) => ({
      subject_id: subject.subject_id, avg20: 16.25, rank: 1,
      teacher_name: subject.teacher_name, total: 16.25, coeff: 1,
    })),
    per_group: [], per_subject_components: [], previous_period_avgs: [15.5, 15.75],
  };
  const opts = {
    origin: "https://www.mon-cahier.com", institutionId: crypto.randomUUID(),
    classId: crypto.randomUUID(), classAcademicYear: "2026-2027", createQr: false,
    periodMeta: { from: "2026-04-06", to: "2026-08-31", academic_year: "2025-2026",
      label: "3e trimestre", short_label: "T3" },
  };
  return { snapshot, opts, item: { student_id: crypto.randomUUID(), __qr_snapshot: snapshot } };
}

function signedPart(part) {
  return `${part}.${crypto.createHmac("sha256", secret).update(part).digest("base64url")}`;
}

test("un bulletin ancien sans code court conserve tout son contenu et reçoit un PNG sans écriture", async () => {
  const { item, opts, snapshot } = fixture();
  const route = loadQrRoute();
  const items = await route.addQrToItems({}, [item], opts);
  const output = await route.attachQrPng(items);
  assert.equal(output[0].qr_mode, "token");
  assert.ok(output[0].qr_png?.startsWith("data:image/png;base64,"));
  const token = new URL(output[0].qr_url).searchParams.get("t");
  const decoded = verifyBulletinQR(token);
  assert.equal(decoded.academicYear, "2025-2026");
  assert.equal(decoded.periodFrom, "2026-04-06");
  assert.equal(decoded.periodTo, "2026-08-31");
  assert.equal(decoded.studentId, item.student_id);
  assert.deepEqual(decoded.s, snapshot);
  assert.deepEqual(route.calls, { reads: 1, writes: 0 });
  const oldToken = signedPart(Buffer.from(JSON.stringify(decoded)).toString("base64url"));
  assert.throws(() => QRCode.create(`${opts.origin}/verify/bulletin?t=${oldToken}`), /too big/i);
});

test("un code court existant garde son URL et son PNG sans émission supplémentaire", async () => {
  const { item, opts } = fixture();
  const route = loadQrRoute(new Map([["code", "EXISTING-QR"]]));
  const output = await route.attachQrPng(await route.addQrToItems({}, [item], opts));
  assert.equal(output[0].qr_url, `${opts.origin}/v/EXISTING-QR`);
  assert.equal(output[0].qr_token, null);
  assert.ok(output[0].qr_png?.startsWith("data:image/png;base64,"));
  assert.deepEqual(route.calls, { reads: 1, writes: 0 });
});

test("les anciens tokens JSON signés restent vérifiables et les petits tokens gardent leur format", () => {
  const payload = { v: 1, iat: 1710000000000, instId: "inst", classId: "class", studentId: "student",
    academicYear: "2025-2026", s: { g: 16.25, a: 15.75 } };
  const legacy = signedPart(Buffer.from(JSON.stringify(payload)).toString("base64url"));
  assert.deepEqual(verifyBulletinQR(legacy), payload);
  const current = signBulletinQR({ instId: "inst", classId: "class", studentId: "student" });
  assert.doesNotMatch(current, /^z:/);
  assert.equal(verifyBulletinQR(current).studentId, "student");
});

test("le contenu compressé est authentifié avant décodage et sa décompression est bornée", () => {
  const payload = { v: 1, instId: "inst", classId: "class", studentId: "student", iat: 1, text: "x".repeat(2000) };
  const part = `z:${deflateRawSync(Buffer.from(JSON.stringify(payload))).toString("base64url")}`;
  const token = signedPart(part);
  assert.deepEqual(verifyBulletinQR(token), payload);
  assert.equal(verifyBulletinQR(token.replace("z:", "z:AA")), null);
  assert.equal(verifyBulletinQR(`${part}.invalid`), null);
  assert.equal(verifyBulletinQR(signedPart("z:AAAA")), null);
  const bomb = `z:${deflateRawSync(Buffer.from(JSON.stringify({ v: 1, text: "x".repeat(256 * 1024) }))).toString("base64url")}`;
  assert.equal(verifyBulletinQR(signedPart(bomb)), null);
});
