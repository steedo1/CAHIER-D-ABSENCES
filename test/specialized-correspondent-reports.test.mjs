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
  new Function("require", "module", "exports", code)((id) => id.endsWith(".css") ? {} : require(id), m, m.exports);
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

test("annual matrix preserves students introduced in later periods and refuses missing period results", () => {
  const src = read("src/components/admin/SpecializedCorrespondentReports.tsx");
  assert.match(src, /!previous\.document\[selectedTrack\] && entry\.document\[selectedTrack\]/);
  assert.match(src, /mode === "annual" \? unique/);
  assert.match(src, /const annualFullyCovered = unique\.every/);
  assert.match(src, /return !!programFor\(row, selectedTrack\)/);
  assert.match(src, /mode !== "annual" \|\| annualFullyCovered/);
});

test("printing a specialized report hides other dashboard content and repeats matrix headers", () => {
  const src = read("src/components/admin/SpecializedCorrespondentReports.tsx");
  const css = read("src/components/admin/SpecializedCorrespondentReports.print.css");
  assert.match(src, /import "\.\/SpecializedCorrespondentReports\.print\.css"/);
  assert.match(css, /body:has\(#specialized-correspondent-report\) \*/);
  assert.match(css, /visibility: hidden !important/);
  assert.match(css, /#specialized-correspondent-report/);
  assert.match(css, /display: table-header-group/);
});


test("matrice primaire EPC : les compositions utilisent le calendrier officiel, jamais les trimestres secondaires", () => {
  const source = read("src/components/admin/SpecializedCorrespondentReports.tsx");
  const primitive = read("src/lib/server/specialized-bulletin.ts");
  assert.match(source, /mode === "term" && isPrimaryMatrixClass\(selectedClass\)/);
  assert.match(source, /\/api\/admin\/institution\/primary-evaluation-events\?/);
  assert.match(source, /event\.printBulletin && event\.levels\.includes/);
  assert.match(source, /primaryEvents\.map\(event => <option/);
  assert.match(source, /params\.set\("primary_event_code", primaryEventCode\)/);
  assert.match(source, /params\.set\("period_id", period\.id\)/);
  assert.match(source, /Matrice de composition/);
  assert.match(source, /Matrice d’examen blanc/);
  assert.match(source, /Matrice d’évaluation/);
  assert.match(primitive, /const eventsMode = cycle === "primary" && searchParams\.has\("primary_event_code"\)/);
  assert.match(primitive, /marker\?\.code !== primaryEvent\.code \|\| marker\.kind !== primaryEvent\.kind/);
  assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});

test("matrices primaires : barèmes par matière sans toucher aux calculs du secondaire", () => {
  const source = read("src/components/admin/SpecializedCorrespondentReports.tsx");
  const expected = "isPrimaryTermMatrix ? item.denominator ?? subjectProgram!.denominator : subjectProgram!.denominator";
  assert.equal(source.split(expected).length - 1, 2, "aperçu et impression utilisent le bon barème");
  assert.match(source, /mode === "annual" \? periods\.slice\(0, 12\) : periods\.filter/);
  assert.match(source, /const subjectProgram = isPrimaryTermMatrix \? entry\.document\[selectedTrack\] : program;/);
  assert.match(source, /const item = subjectProgram\?\.subjects\.find/, "matières publiées visibles même si le reste est incomplet");
  assert.match(source, /const program = programFor\(entry, selectedTrack\)/, "rang et moyenne générale exigent des notes complètes");
  assert.match(source, /PRESCHOOL_QUALITATIVE_STORAGE_REQUIRED/);
  assert.match(source, /DOCUMENT DE TRAVAIL/);
});


test("EPC primaire : les notes publiées, y compris zéro, sont imprimables sans exiger 11 matières", () => {
  const source = read("src/components/admin/SpecializedCorrespondentReports.tsx");
  assert.match(source, /const primaryPrintHasMarks = isPrimaryTermMatrix && current\.some/);
  assert.match(source, /typeof subject\.average === "number" && Number\.isFinite\(subject\.average\)/);
  assert.match(source, /const printable = isPrimaryTermMatrix \? primaryPrintHasMarks/);
  assert.match(source, /isAllComplete\(reports, selectedTrack\) && unique\.length > 0/, "les autres documents gardent leurs règles");
  assert.match(source, /item\?\.average == null \? ""/, "une absence n'est pas une note zéro");
  assert.match(source, /formatScore\(item\.average, item\.denominator \?\? subjectProgram!\.denominator\)/,
    "ne jamais changer le barème réel de la matière");
  assert.match(source, /program \? formatScore\(program\.generalAverage, program\.denominator\) : ""/,
    "aucune moyenne non validée n'est ajoutée");
  assert.match(source, /program\?\.rank \?\? ""/, "aucun rang non validé n'est inventé");
  assert.match(source, /DOCUMENT DE TRAVAIL — NOTES PUBLIÉES/);
  assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});

test("EPC primaire : l'impression passe en A4 paysage lisible et conserve les enseignements séparés", () => {
  const source = read("src/components/admin/SpecializedCorrespondentReports.tsx");
  const css = read("src/components/admin/SpecializedCorrespondentReports.print.css");
  assert.match(source, /const primaryPrintSubjects = isPrimaryTermMatrix \? subjects\.map/,
    "toutes les matières dans une seule grille");
  assert.doesNotMatch(source, /subjects\.slice\(index \* 6/,
    "aucun découpage horizontal des matières");
  assert.match(source, /primaryPrintSheets\.map\(\(\{ rows \}, index\)/);
  assert.match(source, /primaryPrintSubjects\.map\(subject => <th/,
    "chaque matière a sa colonne, avec un intitulé abrégé");
  assert.match(source, /primaryMatrixShortName\(subject\.name\)/);
  assert.match(source, /primaryMatrixPrintScore\(item\?\.average/,
    "les notes restent réelles, le barème est préservé");
  assert.match(source, /selectedTrack === "arabic" \? "rtl" : undefined/,
    "la matrice arabe garde son sens de lecture");
  assert.match(source, /isPrimaryTermMatrix \? "specialized-term-report specialized-primary-matrix"/);
  assert.match(css, /#specialized-correspondent-report\.specialized-primary-matrix \{\s*page: specializedMatrixLandscape;/);
  assert.match(css, /@page specializedMatrixLandscape \{\s*size: A4 landscape;/);
  assert.match(css, /specialized-primary-table \{[\s\S]*?font-size: 10\.5pt !important;/);
  assert.match(css, /specialized-primary-sheet:last-child \{\s*break-after: auto;/);
  assert.match(css, /display: table-header-group;/, "les en-têtes sont répétés sur les pages suivantes");
  assert.match(source, /const institutionName = first\?\.documents\[0\]\?\.document\.school\?\.name/);
  assert.match(source, /<DocumentDirectionSignatures/, "les signatures existantes sont conservées");
  assert.match(source, /mode === "term" \? \(/, "le rendu antérieur ne change pas pour les autres modes");
});

test("matrice A4 depuis téléphone : colonnes non contraintes par la largeur de la PWA", () => {
  const source = read("src/components/admin/SpecializedCorrespondentReports.tsx");
  const css = read("src/components/admin/SpecializedCorrespondentReports.print.css");
  assert.match(source, /const primaryPrintSheets = isPrimaryTermMatrix/);
  assert.doesNotMatch(source, /primaryPrintGroups/,
    "ne jamais reconstituer des groupes de matières");
  assert.match(source, /display\.slice\(sheetIndex \* 24, sheetIndex \* 24 \+ 24\)/);
  assert.match(css, /position: static !important;/);
  assert.match(css, /display: contents !important;/);
  assert.match(css, /width: 100% !important;/);
  assert.match(css, /padding: 2px 4px !important;/);
});
