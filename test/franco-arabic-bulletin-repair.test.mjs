import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server.js";
import { createPedagogicalFixture } from "./helpers/pedagogical-fixture.mjs";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import { setup, publish, report } from "./helpers/primary-event-fixture.mjs";
import { EDUCATION_QUOTES, educationQuoteOfDay } from "../src/lib/education-quote-of-day.ts";

const cls = "33333333-3333-4333-8333-333333333333";
const api = "src/app/api/admin/grades/bulletin/route.ts";
const request = () => new NextRequest(`https://fixture.invalid/api/admin/grades/bulletin?class_id=${cls}&academic_year=2026-2027&from=2026-09-01&to=2026-12-15`);

test("empty primary event retains subjects, teacher and selected title without inventing averages or QR", async () => {
  const db = setup();
  const body = await report(db, "DEC");
  const row = body.specialized.documents[0];
  assert.ok(row.document.french.subjects.length > 0);
  assert.ok(row.document.arabic.subjects.length > 0);
  assert.equal(row.document.french.generalAverage, null);
  assert.equal(row.document.french.rank, null);
  assert.equal(row.document.french.teacherName, "Instituteur titulaire");
  assert.ok(row.document.french.subjects.every(subject => subject.average === null));
  const Panel = db.admin("src/components/bulletins/SpecializedBulletinPanel.tsx").default;
  const html = renderToStaticMarkup(React.createElement(Panel, { data: body.specialized, onBack() {}, onPrint: async () => {} }));
  assert.match(html, /Mathématiques/);
  assert.match(html, /Instituteur titulaire/);
  assert.match(html, /Composition de décembre/);
  assert.doesNotMatch(html, /Bulletins en préparation|bg-amber-50|Vérifier les matières et les barèmes/);
  assert.match(html, /specialized-print-blocked/);
  assert.doesNotMatch(html, /qr[_-]|qrcode|verify\/bulletin/i);
  assert.equal(db.calls.some(call => call.op !== "read"), false);
});

test("bilingual class resolves each teacher from canonical or institution subject assignments, in school scope", async () => {
  const db = createPedagogicalFixture();
  const [fr, ar] = db.tables.subjects;
  db.tables.classes[0].head_teacher_id = "teacher-fr";
  db.tables.profiles.push(
    { id: "teacher-fr", institution_id: db.legacyId, display_name: "Mme Française" },
    { id: "teacher-ar", institution_id: db.legacyId, display_name: "M. Arabe" },
    { id: "teacher-ar", institution_id: "foreign-school", display_name: "Enseignant étranger" },
  );
  db.tables.class_teachers = [
    { id: "1", institution_id: db.legacyId, class_id: cls, subject_id: fr.id, teacher_id: "teacher-fr", end_date: null },
    { id: "2", institution_id: db.legacyId, class_id: cls, subject_id: db.tables.institution_subjects[1].id, teacher_id: "teacher-ar", end_date: null },
    { id: "3", institution_id: "foreign-school", class_id: cls, subject_id: ar.id, teacher_id: "foreign", end_date: null },
  ];
  const body = await (await createFixtureRouteLoader(db, db.legacyAdminId)(api).GET(request())).json();
  const document = body.specialized.documents[0].document;
  assert.equal(document.french.teacherName, "Mme Française");
  assert.equal(document.arabic.teacherName, "M. Arabe");
  assert.equal(document.arabic.subjects[0].teacherName, "M. Arabe");
  assert.equal(document.french.subjects[0].teacherName, "Mme Française");
  assert.equal(document.french.generalAverage, 8);
  assert.equal(document.arabic.generalAverage, 12);
});

test("missing primary Arabic scale remains visible with a precise teaching-specific explanation", async () => {
  const db = setup();
  const reports = db.tables.institutions[0].settings_json.franco_arabic_reports_v1;
  reports.scales = reports.scales.filter(scale => scale.track === "french");
  delete reports.primarySubjectScales;
  const data = (await report(db, "DEC")).specialized;
  assert.ok(data.documents[0].document.arabic.subjects.length);
  assert.equal(data.documents[0].document.arabic.generalAverage, null);
  assert.ok(data.documents[0].problemsByProgram.arabic.includes("level_scale_not_configured"));
  const messages = db.admin("src/lib/bulletin-preparation-messages.ts").bulletinPreparationMessages;
  assert.ok(messages(data.documents[0].problemsByProgram.arabic).some(message => message.includes("barème de moyenne")));
});

test("primary titles follow internal and passage events, current published corrections feed independent averages", async () => {
  const db = setup("CM1");
  for (const code of ["DEC", "FEV", "AVR", "PASS"]) for (const track of ["french", "arabic"]) {
    await publish(db, code, track, track === "french" ? 0.8 : 0.4);
  }
  await publish(db, "NIV1", "french", 0);
  const internal = (await report(db, "NIV1")).specialized.documents[0].document.french;
  assert.equal(internal.period, "Évaluation de niveau");
  assert.equal(internal.generalAverage, 0);
  const passage = (await report(db, "PASS")).specialized.documents[0];
  assert.equal(passage.document.french.period, "Composition de passage");
  assert.equal(passage.document.french.primaryAnnual.annualAverage, 8);
  assert.equal(passage.document.arabic.primaryAnnual.annualAverage, 4);
  assert.equal(passage.ready, true);
  assert.ok(passage.document.arabic.subjects.some(subject => subject.average === null), "ungraded curriculum stays visible without adding to the denominator");
});

test("Arabic secondary preview keeps assigned subjects and teachers when coefficients are still missing", async () => {
  const db = createPedagogicalFixture();
  const settings = db.tables.institutions[0].settings_json;
  settings.school_cycles_v1.enabledCycles = ["secondary"];
  settings.school_cycles_v1.classCycleById = { [cls]: "secondary" };
  settings.school_cycles_v1.teachingTracksByCycle = { secondary: ["french", "arabic"] };
  settings.school_cycles_v1.subjectTracksByCycle = { secondary: { [db.tables.subjects[1].id]: ["arabic"] } };
  settings.school_student_programs_v1 = { version: 1, years: { "2026-2027": { classes: { [cls]: { tracks: ["arabic"], students: {} } } } } };
  settings.school_class_subjects_v1 = { version: 1, years: { "2026-2027": { classes: { [cls]: [db.tables.subjects[1].id] } } } };
  settings.franco_arabic_reports_v1.coefficientSource = "program";
  settings.franco_arabic_reports_v1.scales = [];
  settings.franco_arabic_reports_v1.coefficients = [];
  db.tables.classes[0].level = "6e";
  db.tables.grade_published_scores = [];
  db.tables.class_teachers = [{ id: "assignment", institution_id: db.legacyId, class_id: cls, subject_id: db.tables.institution_subjects[1].id, teacher_id: "teacher-ar", end_date: null }];
  db.tables.profiles.push({ id: "teacher-ar", institution_id: db.legacyId, display_name: "Professeur arabe" });
  const body = await (await createFixtureRouteLoader(db, db.legacyAdminId)(api).GET(request())).json();
  assert.equal(body.specialized.cycle, "secondary");
  const document = body.specialized.documents[0].document.arabic;
  assert.equal(document.subjects[0].name, "Lecture");
  assert.equal(document.subjects[0].teacherName, "Professeur arabe");
  assert.equal(document.subjects[0].coefficient, null);
  assert.equal(document.generalAverage, null);
  assert.equal(body.specialized.documents[0].ready, false);
});

test("one original quote per Abidjan day, stable across reloads, with 120 distinct daily choices", () => {
  assert.equal(EDUCATION_QUOTES.length, 120);
  assert.equal(new Set(EDUCATION_QUOTES).size, 120);
  assert.equal(educationQuoteOfDay(new Date("2026-10-20T00:00:00Z")), educationQuoteOfDay(new Date("2026-10-20T23:59:59Z")));
  assert.equal(educationQuoteOfDay(new Date("2026-10-20T23:00:00-03:00")), educationQuoteOfDay(new Date("2026-10-21T02:00:00Z")));
  const sequence = Array.from({ length: 120 }, (_, index) => educationQuoteOfDay(new Date(Date.UTC(2026, 9, 20 + index))));
  assert.equal(new Set(sequence).size, 120);
  assert.notEqual(sequence[0], sequence[1]);
});


test("CI primary observations follow the booklet, normalize scales and preserve blanks and teacher comments", async () => {
  const db = setup();
  const load = db.admin;
  const { ciPrimaryFrenchAppreciation: appreciation } = load("src/lib/primary-french-reference-ci.ts");
  for (const [score, expected] of [[10, "Très bien"], [9, "Bien"], [8, "Bien"], [7, "Assez bien"], [6, "Assez bien"], [5, "Passable"], [4, "Médiocre"], [3, "Médiocre"], [2, "Mal"], [1, "Mal"], [0, "Travail très mal"]]) {
    assert.equal(appreciation(score, 10), expected);
    assert.equal(appreciation(score * 5, 50), expected);
  }
  assert.equal(appreciation(9.99, 10), "Bien");
  assert.equal(appreciation(null, 10), null);
  assert.equal(appreciation(NaN, 10), null);
  assert.equal(appreciation(11, 10), null);
  assert.equal(appreciation(5, 0), null);
  await publish(db, "NIV1", "french", 0.8);
  const data = (await report(db, "NIV1")).specialized;
  const document = data.documents[0].document;
  document.arabic = undefined;
  document.french.subjects.push({ ...document.french.subjects[0], id: "ungraded", name: "Sans note", average: null, observation: null });
  const Bulletin = load("src/components/bulletins/FrancoArabicBulletin.tsx").default;
  let html = renderToStaticMarkup(React.createElement(Bulletin, { model: document, variant: "ordinary" }));
  assert.match(html, /class="observation">Bien<\/td>/);
  assert.match(html, /Appréciation générale<\/span><p>Bien<\/p>/);
  assert.match(html, /class="observation">—<\/td>/, "ungraded subjects stay without assessment");
  document.french.subjects.find(s => s.average !== null).observation = "Bonne progression";
  document.french.appreciation = "Avis de l’enseignant";
  html = renderToStaticMarkup(React.createElement(Bulletin, { model: document, variant: "ordinary" }));
  assert.match(html, /Bonne progression/);
  assert.match(html, /Avis de l’enseignant/);
});
