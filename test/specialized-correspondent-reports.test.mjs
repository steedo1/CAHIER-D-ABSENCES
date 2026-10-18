import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const pageRoutes = [
  ["src/app/admin/notes/conseil-classe/page.tsx", "ConseilClassePage", "council"],
  ["src/app/admin/notes/bilan/page.tsx", "BilanTrimestrielAnnuelPage", "balance"],
  ["src/app/admin/notes/matrices/page.tsx", "MatricesTrimestriellesPage", "term"],
  ["src/app/admin/notes/matrice-annuelle/page.tsx", "AnnualMatrixPage", "annual"],
  ["src/app/admin/notes/non-classes/page.tsx", "NonClassesPage", "unclassified"],
];

test("the five Correspondant screens reuse specialized results only in opted-in Arabic schools", () => {
  for (const [path, component, mode] of pageRoutes) {
    const src = read(path);
    assert.match(src, /useBilingualCorrespondentMode/);
    assert.match(src, /if \(loading\)/);
    assert.match(src, /if \(error\)/);
    assert.match(src, /if \(isBilingual\)/);
    assert.ok(src.includes('mode="' + mode + '"'), path);
    assert.ok(src.includes("return <Legacy" + component + " />"), path);
    assert.ok(src.includes("function Legacy" + component + "()"), path);
    assert.equal((src.match(/export default function/g) || []).length, 1, path);
  }
});

test("specialized reports use the authenticated bulletin API and never invent an official annual result", () => {
  const src = read("src/components/admin/SpecializedCorrespondentReports.tsx");
  assert.ok(src.includes("/api/admin/grades/bulletin?"), "authorized official grade response");
  assert.ok(src.includes('data.specialized.engine !== "specialized"'), "no historical fallback");
  assert.ok(src.includes("entry.programReadiness?.[track] !== true"), "incomplete marks are not displayed");
  assert.ok(src.includes('mode === "annual"'), "annual summary uses periods");
  assert.ok(src.includes("Aucune moyenne ni aucun rang annuel officiel"), "annual grades are not invented");
  assert.ok(src.includes("aucune décision « non classé »"), "no automatic historical NC");
  assert.ok(src.includes("programFor(entry, selectedTrack)"), "two tracks never mixed");
  assert.ok(src.includes('DOCUMENT DE TRAVAIL'), "no misleading official document");
  assert.doesNotMatch(src, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});

test("unconfigured preschool cannot silently use numeric statistics or historical fallback", () => {
  const src = read("src/components/admin/SpecializedCorrespondentReports.tsx");
  assert.ok(src.includes("PRESCHOOL_QUALITATIVE_STORAGE_REQUIRED"));
  assert.ok(src.includes("livret qualitatif"));
});

test("specialized workspace displays all five educational report modes", () => {
  const code = ts.transpileModule(read("src/components/admin/SpecializedCorrespondentReports.tsx"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    },
  }).outputText;
  const m = { exports: {} };
  new Function("require", "module", "exports", code)((id) => require(id), m, m.exports);
  const Panel = m.exports.default;
  for (const [_, __, mode] of pageRoutes) {
    const html = renderToStaticMarkup(React.createElement(Panel, { mode }));
    assert.ok(html.includes("Correspondant Fichier"), mode);
    assert.ok(html.includes("Classe"), mode);
    assert.ok(html.includes("Période"), mode);
    assert.ok(html.includes("Afficher les résultats"), mode);
  }
});

test("official DESPS export fails closed for bilingual schools until authority validates the model", () => {
  for (const file of ["src/app/admin/export-moyennes/page.tsx",
    "src/app/api/admin/exports/averages/route.ts",
    "src/app/api/admin/exports/averages/diagnostic/route.ts"]) {
    const code = read(file);
    assert.match(code, /isBilingualSchool\(parseSchoolCyclesSettings\(/, file);
    assert.match(code, /DESPS|Export DESPS/, file);
  }
  assert.match(read("src/app/api/admin/exports/averages/route.ts"),
    /DESPS_FRANCO_ARABIC_MODEL_NOT_VALIDATED/);
});

test("file correspondent school detection uses the authenticated settings API, not admin-only navigation", () => {
  const hook = read("src/hooks/useBilingualCorrespondentMode.ts");
  assert.match(hook, /\/api\/admin\/institution\/settings/);
  assert.match(hook, /isBilingualSchool\(parseSchoolCyclesSettings\(data.settings_json\)\)/);
  assert.match(hook, /setResolved\(null\)/);
  assert.match(hook, /loading: !error && resolved === null/);
  assert.match(read("src/app/admin/layout.tsx"), /primaryRole === "file_correspondent"/);
});
