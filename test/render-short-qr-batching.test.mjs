import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/app/api/admin/grades/bulletin/route.ts", import.meta.url), "utf8",
);
const ast = ts.createSourceFile("bulletin.ts", source, ts.ScriptTarget.Latest, true);
const helper = ast.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "mapInBatches",
);
assert.ok(helper, "mapInBatches doit exister");
const functionJs = ts.transpileModule(helper.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mapInBatches = new Function(functionJs + "\nreturn mapInBatches;")();

test("les QR courts de 120 élèves restent ordonnés avec 4 requêtes simultanées au plus", async () => {
  const students = Array.from({ length: 120 }, (_, i) => ({
    studentId: `pupil-${i}`, snapshot: { average: i / 7 },
  }));
  let current = 0, peak = 0, attempts = 0;
  const result = await mapInBatches(students, 4, async (student) => {
    current++;
    attempts++;
    peak = Math.max(peak, current);
    try {
      await new Promise((done) => setTimeout(done, (Number(student.studentId.slice(6)) % 3) + 1));
      return { ...student, code: `SHORT-${student.studentId}` };
    } finally {
      current--;
    }
  });
  assert.equal(peak, 4);
  assert.equal(attempts, 120);
  assert.equal(current, 0);
  assert.equal(result.length, students.length);
  result.forEach((row, i) => {
    assert.deepEqual(row.snapshot, students[i].snapshot);
    assert.equal(row.studentId, students[i].studentId);
    assert.equal(row.code, `SHORT-${students[i].studentId}`);
  });
});

test("petits lots et liste vide ne font aucun travail inutile", async () => {
  const calls = [];
  assert.deepEqual(await mapInBatches([], 4, async () => { throw new Error("unexpected"); }), []);
  const result = await mapInBatches(["A", "B", "C"], 4, async (item) => {
    calls.push(item);
    return `/v/${item}`;
  });
  assert.deepEqual(result, ["/v/A", "/v/B", "/v/C"]);
  assert.deepEqual(calls, ["A", "B", "C"]);
});

test("les erreurs de création QR ne sont ni effacées ni transformées", async () => {
  await assert.rejects(mapInBatches(["A"], 4, async () => {
    throw new Error("supabase_disabled");
  }), /supabase_disabled/);
});

test("la route d'émission utilise les lots bornés, conserve les fallbacks historiques", () => {
  const start = source.indexOf("// 2) Mode short si supporté");
  const end = source.indexOf("// 3) Fallback token pour tous", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /mapInBatches\(items, 4, async \(it\) =>/);
  assert.match(block, /getOrCreateBulletinShortCode/);
  assert.match(block, /firstShort\.code/);
  assert.match(block, /fallback token/);
  assert.doesNotMatch(block, /Promise\.all\(\s*items\.map/);
});
