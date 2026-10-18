import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { NextRequest } from "next/server.js";
import { createPedagogicalFixture } from "./helpers/pedagogical-fixture.mjs";
import { parseSchoolCyclesSettings } from "../src/lib/school-cycles";
import { readSchoolTeachingSignatories } from "../src/lib/school-teaching-signatories";
import { resolveAttestationSignatory, resolveTeachingDocumentSignatories, teachingDocumentSignaturesHtml } from "../src/lib/franco-arabic-document-signatories";
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

test("attestation franco-arabe : un seul administrateur général avec le titre configuré", () => {
  const signer = resolveAttestationSignatory({
    settings_json: settings, institution_head_name: "Directeur général de l'école",
    institution_head_title: "Proviseur",
  });
  assert.deepEqual(signer, {
    name: "Directeur général de l'école", title: "Proviseur", signatureTitle: "Proviseur",
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
  assert.equal(signer.signatureTitle, "Directeur des études");
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

test("A4 : exactement une attestation par élève bilingue, nom DG et titre paramétré, sans vérification des présences", () => {
  const html = generateActualAttestationHtml({
    cfg: { institution_name: "École franco-arabe", institution_head_name: "DG authentifié",
      institution_head_title: "Proviseur", settings_json: settings },
    academicYear: "2026-2027", rows: students, fallbackClassLabel: "CM1",
    classEducationTypes: new Map([["classe1", "general_secondary"]]),
    selectedEducationType: "general_secondary",
  });
  assert.equal((html.match(/<h1>ATTESTATION DE FREQUENTATION<\/h1>/g) || []).length, 2);
  assert.equal((html.match(/<div class="signature-name">DG authentifié<\/div>/g) || []).length, 2);
  assert.equal((html.match(/<div class="signature-title">Proviseur<\/div>/g) || []).length, 2);
  assert.doesNotMatch(html, /Directeur des études|Responsable de l'enseignement/);
  assert.match(html, /<strong>Proviseur<\/strong> du/);
});

test("bulletins : un directeur par enseignement séparé, un seul administrateur général pour le combiné", () => {
  const load = createFixtureRouteLoader(createMulticycleFixture(), "actor-does-not-matter");
  const component = load("src/components/bulletins/FrancoArabicBulletin.tsx").default;
  const document = {
    school: { name: "École franco-arabe", isFrancoArabic: true,
      generalDirectorName: "Administrateur authentique", generalDirectorTitle: "Titre général configuré" },
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
  assert.equal((combined.match(/>Titre général configuré<\/span>/g) || []).length, 1);
  assert.equal((combined.match(/Administrateur authentique/g) || []).length, 1);
  assert.doesNotMatch(combined, /Directeur français|Directeur arabe/);
  assert.doesNotMatch(combined, /Directeur de l’enseignement français|Directeur de l’enseignement arabe|Direction de l’établissement/);
  const frenchOnly = renderToStaticMarkup(React.createElement(component, { model: document, variant: "ordinary" }));
  assert.match(frenchOnly, />Directeur<\/span>/);
  assert.match(frenchOnly, /Directeur français/);
  assert.doesNotMatch(frenchOnly, /Directeur arabe|Administrateur authentique|Titre général configuré/);
  const arabicOnly = renderToStaticMarkup(React.createElement(component, { model: document, variant: "arabic" }));
  assert.match(arabicOnly, />Directeur<\/span>/);
  assert.match(arabicOnly, /Directeur arabe/);
  assert.doesNotMatch(arabicOnly, /Directeur français|Administrateur authentique|Titre général configuré/);
  const ordinary = renderToStaticMarkup(React.createElement(component, {
    model: { ...document, school: { name: "École ordinaire", isFrancoArabic: false } },
    variant: "ordinary",
  }));
  assert.match(ordinary, /Direction de l’établissement/);
  assert.doesNotMatch(ordinary, />Le Directeur<\/span>/);
});

const frClass = "33333333-3333-4333-8333-333333333333";
const arClass = "44444444-4444-4444-8444-444444444444";
const mixedClass = "55555555-5555-4555-8555-555555555555";
function documentSettings() {
  return { ...structuredClone(settings), school_student_programs_v1: { version: 1, years: {
    "2026-2027": { classes: {
      [frClass]: { tracks: ["french"], students: {} },
      [arClass]: { tracks: ["arabic"], students: {} },
      [mixedClass]: { tracks: ["french", "arabic"], students: {} },
    } },
    "2025-2026": { classes: { [frClass]: { tracks: ["arabic"], students: {} } } },
  } } };
}
const generalContext = { academicYear: "2026-2027", institutionHeadName: "Vrai responsable général",
  institutionHeadTitle: "Administrateur général" };
const generalDirection = { track: "general", name: "Vrai responsable général", title: "Administrateur général" };

test("listes : changer de classe/année/enseignement sélectionne le bon directeur, jamais le compte connecté", () => {
  const json = documentSettings();
  const resolve = context => resolveTeachingDocumentSignatories(json, { ...generalContext, ...context });
  assert.deepEqual(resolve({ classIds: [frClass] }), [{ track: "french",
    name: "Responsable de l'enseignement français", title: "Directeur" }]);
  assert.deepEqual(resolve({ classIds: [arClass] }), [{ track: "arabic",
    name: "Responsable de l'enseignement arabe", title: "Directeur" }]);
  assert.equal(resolve({ academicYear: "2025-2026", classIds: [frClass] })[0].track, "arabic");
  assert.deepEqual(resolve({ classIds: [mixedClass] }), [generalDirection]);
  assert.deepEqual(resolve({ classIds: [frClass, arClass] }), [generalDirection]);
  assert.deepEqual(resolve({}), [generalDirection]);
  assert.equal(resolve({ classIds: [mixedClass], tracks: ["french"] })[0].track, "french");
  assert.equal(resolve({ tracks: ["arabic"] })[0].track, "arabic");
  assert.deepEqual(resolve({ classIds: ["classe non configurée"] }), []);
  assert.deepEqual(resolve({ academicYear: "2024-2025", classIds: [frClass] }), []);
  assert.equal(resolveTeachingDocumentSignatories({}, generalContext), null);
});

test("classe mixte via exception élève : une seule signature générale ; absence de nom sans substitution", () => {
  const json = documentSettings();
  json.school_student_programs_v1.years["2026-2027"].classes[frClass].students[
    "66666666-6666-4666-8666-666666666666"] = ["arabic"];
  assert.deepEqual(resolveTeachingDocumentSignatories(json, { ...generalContext, classIds: [frClass] }), [generalDirection]);
  const missing = resolveTeachingDocumentSignatories(json, { academicYear: "2026-2027", classIds: [frClass] });
  assert.deepEqual(missing, [{ track: "general", title: "Directeur", name: "Nom du directeur non renseigné" }]);
  delete json.school_teaching_signatories_v1.arabic;
  const arabic = resolveTeachingDocumentSignatories(json, { ...generalContext, classIds: [arClass] });
  assert.equal(arabic[0].name, "Nom du directeur non renseigné");
});

test("impressions React et HTML : une seule signature, nom ET titre paramétrés échappés", () => {
  const load = createFixtureRouteLoader(createMulticycleFixture(), "irrelevant");
  const Component = load("src/components/DocumentDirectionSignatures.tsx").default;
  const signatories = resolveTeachingDocumentSignatories(documentSettings(), { ...generalContext,
    institutionHeadName: '<img src=x onerror="alert(1)">', institutionHeadTitle: "Direction <générale> & école" });
  for (const html of [teachingDocumentSignaturesHtml(signatories),
    renderToStaticMarkup(React.createElement(Component, { signatories }))]) {
    assert.equal((html.match(/data-document-directions/g) || []).length, 1);
    assert.equal((html.match(/&lt;img/g) || []).length, 1);
    assert.match(html, /Direction &lt;générale&gt; &amp; école/);
    assert.doesNotMatch(html, /<img|Responsable de l'enseignement/);
  }
  assert.equal(teachingDocumentSignaturesHtml(null), "");
  assert.equal(renderToStaticMarkup(React.createElement(Component, { signatories: null })), "");
});

test("API bulletin authentifiée → document rendu : le combiné prend uniquement les paramètres de SON établissement", async () => {
  const db = createPedagogicalFixture();
  Object.assign(db.tables.institutions[0], { head_name: generalContext.institutionHeadName,
    head_title: generalContext.institutionHeadTitle });
  db.tables.institutions[0].settings_json.school_teaching_signatories_v1 = settings.school_teaching_signatories_v1;
  const before = structuredClone(db.tables);
  const load = createFixtureRouteLoader(db, db.legacyAdminId);
  const response = await load("src/app/api/admin/grades/bulletin/route.ts").GET(new NextRequest(
    `https://example.invalid/api/admin/grades/bulletin?class_id=${frClass}&from=2026-09-01&to=2026-12-15&academic_year=2026-2027&head_name=FAUX&head_title=FAUX`));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const document = (await response.json()).specialized.documents[0].document;
  const Component = load("src/components/bulletins/FrancoArabicBulletin.tsx").default;
  const combined = renderToStaticMarkup(React.createElement(Component, { model: document, variant: "combined" }));
  assert.match(combined, /Administrateur général/);
  assert.equal((combined.match(/Vrai responsable général/g) || []).length, 1);
  assert.doesNotMatch(combined, /Responsable de l&#x27;enseignement|FAUX/);
  for (const track of ["french", "arabic"]) {
    const html = renderToStaticMarkup(React.createElement(Component, { model: document, variant: track }));
    assert.match(html, />Directeur<\/span>/);
    assert.ok(html.includes(track === "french" ? "Responsable de l&#x27;enseignement français" : "Responsable de l&#x27;enseignement arabe"));
    assert.doesNotMatch(html, /Vrai responsable général|Administrateur général/);
  }
  assert.deepEqual(db.tables, before, "printing does not write any school data");
});

test("API liste de classe : noms isolés par classe, titre DG paramétré sur la liste mixte", async () => {
  const db = createPedagogicalFixture();
  Object.assign(db.tables.institutions[0], { settings_json: documentSettings(),
    head_name: generalContext.institutionHeadName, head_title: generalContext.institutionHeadTitle });
  const original = db.tables.classes[0];
  db.tables.classes.push({ ...original, id: arClass }, { ...original, id: mixedClass });
  const load = createFixtureRouteLoader(db, db.legacyAdminId);
  const route = load("src/app/api/admin/classes/[id]/roster/route.ts");
  for (const [id, expected, year = "2026-2027"] of [[frClass, "french"], [arClass, "arabic"],
    [mixedClass, "general"], [frClass, "french"], [arClass, "arabic", "all"]]) {
    const response = await route.GET(new NextRequest(
      `https://example.invalid/api/admin/classes/${id}/roster?academic_year=${year}`), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const signatories = (await response.json()).institution.document_signatories;
    assert.equal(signatories.length, 1);
    assert.equal(signatories[0].track, expected);
    assert.equal(signatories[0].title, expected === "general" ? "Administrateur général" : "Directeur");
  }
});

test("API livrets préscolaires : les trois modèles appliquent la même règle sans toucher aux observations", async () => {
  const db = createPedagogicalFixture();
  const json = documentSettings();
  json.school_cycles_v1.enabledCycles = ["preschool"];
  json.school_cycles_v1.teachingTracksByCycle = { preschool: ["french", "arabic"] };
  json.school_cycles_v1.classCycleById = { [mixedClass]: "preschool" };
  Object.assign(db.tables.institutions[0], { settings_json: json,
    head_name: generalContext.institutionHeadName, head_title: generalContext.institutionHeadTitle });
  Object.assign(db.tables.classes[0], { id: mixedClass, level: "MS" });
  db.tables.class_enrollments.forEach(row => { row.class_id = mixedClass; });
  db.tables.students = db.tables.class_enrollments.map(row => row.students);
  db.tables.preschool_competency_catalogs = [];
  const load = createFixtureRouteLoader(db, db.legacyAdminId);
  const response = await load("src/app/api/preschool/booklets/route.ts").GET(new NextRequest(
    `https://example.invalid/api/preschool/booklets?year=2026-2027&class_id=${mixedClass}`));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const data = await response.json();
  assert.deepEqual(data.documentSignatories.combined, [generalDirection]);
  const Component = load("src/components/DocumentDirectionSignatures.tsx").default;
  for (const variant of ["french", "arabic", "combined"]) {
    const html = renderToStaticMarkup(React.createElement(Component, {
      signatories: data.documentSignatories[variant],
    }));
    if (variant === "combined") {
      assert.match(html, /Administrateur général/);
      assert.equal((html.match(/Vrai responsable général/g) || []).length, 1);
      assert.doesNotMatch(html, /Responsable de l&#x27;enseignement/);
    } else {
      assert.match(html, /<strong>Directeur<\/strong>/);
      assert.ok(html.includes(variant === "french" ? "Responsable de l&#x27;enseignement français" : "Responsable de l&#x27;enseignement arabe"));
      assert.doesNotMatch(html, /Vrai responsable général|Administrateur général/);
    }
  }
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});

test("emplois du temps : une fiche de professeur monolingue garde son directeur même dans une classe mixte", () => {
  const json = documentSettings();
  const frSubject = "77777777-7777-4777-8777-777777777777";
  const arSubject = "88888888-8888-4888-8888-888888888888";
  json.school_cycles_v1.subjectTracksByCycle = { primary: { [frSubject]: ["french"], [arSubject]: ["arabic"] } };
  const file = "src/modules/montage-emploi-du-temps/components/MontageProjectPreview.tsx";
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8") + "\nexport { OfficialClassSheet };";
  const load = createFixtureRouteLoader(createMulticycleFixture(), "irrelevant", new Map([[file, source]]));
  const Component = load(file).OfficialClassSheet;
  const items = [frSubject, arSubject].map((subject, index) => ({ id: `item-${index}`, class_id: mixedClass,
    subject_id: subject, subject_label: index ? "Arabe" : "Français", class_label: "CM1", weekday: 1,
    period_no: index + 1, start_time: index ? "09:00" : "08:00", end_time: index ? "10:00" : "09:00" }));
  for (const [selected, expected] of [[[items[0]], "français"], [[items[1]], "arabe"], [items, "general"]]) {
    const html = renderToStaticMarkup(React.createElement(Component, {
      label: "Professeur exemple", mode: "teacher", items: selected,
      snapshot: { classes: [{ id: mixedClass, level: "CM1", academic_year: "2026-2027" }] },
      institutionSettings: { settings_json: json, institution_head_name: generalContext.institutionHeadName,
        institution_head_title: generalContext.institutionHeadTitle },
    }));
    if (expected === "general") {
      assert.equal((html.match(/Vrai responsable général/g) || []).length, 1);
      assert.match(html, /Administrateur général/);
      assert.doesNotMatch(html, /Responsable de l&#x27;enseignement/);
    } else {
      assert.ok(html.includes("Responsable de l&#x27;enseignement " + expected));
      assert.doesNotMatch(html, /Vrai responsable général|Administrateur général/);
    }
  }
});
