import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseSchoolCyclesSettings } from "../src/lib/school-cycles";
import { readSchoolTeachingSignatories } from "../src/lib/school-teaching-signatories";
import { resolveAttestationSignatory } from "../src/lib/franco-arabic-document-signatories";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const settings = {
  school_cycles_v1: {
    version: 1, enabled: true, enabledCycles: ["primary", "secondary"],
    teachingTracksByCycle: { primary: ["french", "arabic"], secondary: ["french", "arabic"] },
  },
  school_teaching_signatories_v1: {
    version: 1, french: { name: "Responsable de l'enseignement français" },
    arabic: { name: "Responsable de l'enseignement arabe" },
  },
};

test("attestation franco-arabe : un seul directeur général, intitulé Directeur, sans choix par enseignement", () => {
  const signer = resolveAttestationSignatory({
    settings_json: settings, institution_head_name: "Directeur général de l'école",
    institution_head_title: "Proviseur",
  });
  assert.deepEqual(signer, {
    name: "Directeur général de l'école", title: "Directeur", signatureTitle: "Le Directeur",
  });
  assert.notEqual(signer.name, readSchoolTeachingSignatories(settings).french?.name);
  assert.notEqual(signer.name, readSchoolTeachingSignatories(settings).arabic?.name);
  assert.equal(parseSchoolCyclesSettings(settings).enabled, true);
});

test("attestation classique : les noms et fonctions antérieurs demeurent inchangés", () => {
  assert.deepEqual(resolveAttestationSignatory({
    institution_head_name: "Responsable ordinaire", institution_head_title: "Proviseur",
    settings_json: {},
  }), { name: "Responsable ordinaire", title: "Proviseur", signatureTitle: "Proviseur" });
  assert.deepEqual(resolveAttestationSignatory({ settings_json: {} }),
    { name: "Le responsable", title: "Chef d'etablissement", signatureTitle: "Chef d'etablissement" });
});

test("une direction générale non renseignée n'est jamais remplacée par le directeur français ou arabe", () => {
  const signer = resolveAttestationSignatory({
    settings_json: settings,
    institution_head_name: "",
    institution_head_title: "Directeur des études",
  });
  assert.equal(signer.name, "Nom du directeur non renseigné");
  assert.equal(signer.signatureTitle, "Le Directeur");
});

function generateActualAttestationHtml(args) {
  // Exercise the ACTUAL certificate template without mounting a browser or
  // contacting Supabase: extract its pure template, compile it with TypeScript,
  // and supply only the existing display helpers that it calls.
  const source = readFileSync(new URL("../src/app/admin/parents/page.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function buildAttestationHtml(");
  const end = source.indexOf("\nfunction openPrintDocument(", start);
  assert.ok(start > 0 && end > start, "existing A4 certificate generator must remain in use");
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  assert.match(source, /settings_json: settingsJson\?\.settings_json \?\? \{\}/);
  assert.match(source, /resolveAttestationSignatory\(cfg\)/);
  const factory = new Function(
    "resolveAttestationSignatory", "formatDateLongFr", "institutionDisplayName",
    "escapeHtml", "formatDateShortFr", "safeSlug", "studentOfficialName",
    compiled + "\nreturn buildAttestationHtml;",
  );
  const escape = value => String(value ?? "").replace(/&/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const slug = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const html = factory(
    resolveAttestationSignatory,
    () => "18 octobre 2026",
    cfg => cfg.institution_name || "École",
    escape,
    () => "01/01/2015",
    slug,
    row => [row.last_name, row.first_name].filter(Boolean).join(" "),
  );
  return html(args);
}

const students = [
  { id: "double-track", last_name: "ÉLÈVE", first_name: "Bilingue", matricule: "MAT100",
    class_id: "classe1", class_label: "CM1", birth_place: "Dimbokro", birthdate: "2015-01-01" },
  { id: "french-track", last_name: "AUTRE", first_name: "Élève", matricule: "MAT101",
    class_id: "classe1", class_label: "CM1", birth_place: "Dimbokro", birthdate: "2015-01-01" },
];

test("A4 : exactement une attestation par élève bilingue, nom DG et Le Directeur, sans vérification des présences", () => {
  const html = generateActualAttestationHtml({
    cfg: { institution_name: "École franco-arabe", institution_head_name: "DG authentifié",
      institution_head_title: "Proviseur", settings_json: settings },
    academicYear: "2026-2027", rows: students, fallbackClassLabel: "CM1",
    classEducationTypes: new Map([["classe1", "general_secondary"]]),
    selectedEducationType: "general_secondary",
  });
  assert.equal((html.match(/<h1>ATTESTATION DE FREQUENTATION<\/h1>/g) || []).length, 2);
  assert.equal((html.match(/<div class="signature-name">DG authentifié<\/div>/g) || []).length, 2);
  assert.equal((html.match(/<div class="signature-title">Le Directeur<\/div>/g) || []).length, 2);
  assert.doesNotMatch(html, /Proviseur|Directeur des études|Responsable de l'enseignement/);
  assert.match(html, /<strong>Directeur<\/strong> du/);
});

test("bulletins franco-arabes : chaque enseignement garde SON directeur, simplement intitulé Le Directeur", () => {
  const load = createFixtureRouteLoader(createMulticycleFixture(), "actor-does-not-matter");
  const component = load("src/components/bulletins/FrancoArabicBulletin.tsx").default;
  const document = {
    school: { name: "École franco-arabe", isFrancoArabic: true },
    student: { id: "student-id", lastName: "NOM", firstName: "Prénom" },
    french: { track: "french", cycle: "Primaire", level: "CM1", className: "CM1 A",
      year: "2026-2027", period: "T1", denominator: 20,
      subjects: [{ id: "fr", name: "Français", coefficient: null, average: 14 }],
      generalAverage: 14, directorName: "Directeur français" },
    arabic: { track: "arabic", cycle: "Primaire", level: "CM1", className: "CM1 A",
      year: "2026-2027", period: "T1", denominator: 20,
      subjects: [{ id: "ar", name: "Arabe", coefficient: null, average: 16 }],
      generalAverage: 16, directorName: "Directeur arabe" },
  };
  const combined = renderToStaticMarkup(React.createElement(component, { model: document, variant: "combined" }));
  assert.equal((combined.match(/>Le Directeur<\/span>/g) || []).length, 2);
  assert.match(combined, /Directeur français/);
  assert.match(combined, /Directeur arabe/);
  assert.doesNotMatch(combined, /Directeur de l’enseignement français|Directeur de l’enseignement arabe|Direction de l’établissement/);
  const frenchOnly = renderToStaticMarkup(React.createElement(component, { model: document, variant: "ordinary" }));
  assert.match(frenchOnly, /Le Directeur/);
  assert.match(frenchOnly, /Directeur français/);
  assert.doesNotMatch(frenchOnly, /Directeur arabe/);
  const ordinary = renderToStaticMarkup(React.createElement(component, {
    model: { ...document, school: { name: "École ordinaire", isFrancoArabic: false } },
    variant: "ordinary",
  }));
  assert.match(ordinary, /Direction de l’établissement/);
  assert.doesNotMatch(ordinary, />Le Directeur<\\/span>/);
});
