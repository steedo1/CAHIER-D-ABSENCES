import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(
  new URL("../src/lib/voice-grades.ts", import.meta.url),
  "utf8",
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const moduleLike = { exports: {} };
const sandbox = {
  module: moduleLike,
  exports: moduleLike.exports,
};
vm.runInNewContext(compiled, sandbox, { filename: "voice-grades.js" });

const { parseSpokenGrade } = moduleLike.exports;

test("la saisie vocale accepte la ponctuation automatique de Chrome/Edge", () => {
  const cases = [
    ["15.", 15],
    ["15,", 15],
    ["quinze.", 15],
    ["0.", 0],
    ["20.", 20],
    ["20 sur 20.", 20],
    ["vingt sur vingt.", 20],
    ["20 points.", 20],
  ];

  for (const [spoken, expected] of cases) {
    assert.equal(parseSpokenGrade(spoken), expected, spoken);
  }
});

test("la ponctuation finale ne casse pas les notes décimales", () => {
  const cases = [
    ["14,5.", 14.5],
    ["14.5.", 14.5],
    ["quatorze virgule cinq.", 14.5],
    ["15 et demi.", 15.5],
  ];

  for (const [spoken, expected] of cases) {
    assert.equal(parseSpokenGrade(spoken), expected, spoken);
  }
});
