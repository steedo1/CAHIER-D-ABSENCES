import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function("exports", "require", code)(exports, (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`, mocks);
    return require(name);
  });
  return exports;
}

function database(seed) {
  const calls = [];
  const srv = {
    auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) },
    from(table) {
      const filters = [];
      const q = {
        select() { return this; },
        eq(key, value) { filters.push((row) => row[key] === value); return this; },
        is(key, value) { return this.eq(key, value); },
        in(key, values) { filters.push((row) => values.includes(row[key])); return this; },
        or() { return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle() { this.single = true; return this; },
        then(resolve, reject) {
          calls.push(table);
          const rows = (seed[table] || []).filter((row) => filters.every((matches) => matches(row)));
          return Promise.resolve({ data: this.single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { srv, calls };
}

const classRow = {
  id: "6e1", institution_id: "csca", label: "6e1", academic_year: "2026-2027",
  education_type: "general_secondary", level: "6e", formation_level_code: "6eme",
};
const subject = { id: "global-subject", name: "Anglais" };
const instSubject = { id: "inst-subject", institution_id: "csca", subject_id: subject.id, subj: subject };
const assignment = {
  id: "assignment", institution_id: "csca", class_id: classRow.id, teacher_id: "teacher",
  subject_id: instSubject.id, end_date: null, class: classRow, instsub: instSubject,
  teacher: { id: "teacher", display_name: "Professeur test" },
};
const base = {
  profiles: [{ id: "admin", institution_id: "csca" }],
  user_roles: [{ profile_id: "admin", role: "admin", institution_id: "csca" }],
  classes: [classRow], class_teachers: [assignment], subjects: [subject], institution_subjects: [instSubject],
};
function handlers(seed) {
  const db = database(seed);
  const mocks = {
    "@/lib/supabase-server": { getSupabaseServerClient: async () => db.srv },
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => db.srv },
  };
  return { ...db, mocks };
}

test("le registre retrouve le professeur de 6e même quand le code de formation est 6eme", async () => {
  const { mocks } = handlers(base);
  const route = load("src/app/api/admin/affectations/current/route.ts", mocks);
  const response = await route.GET({ url: "https://test/api?academic_year=2026-2027&education_type=general_secondary&formation_level_code=6e&class_id=6e1" });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].teacher.id, "teacher");
  assert.equal(data.items[0].subject.id, "inst-subject");
  const excluded = await route.GET({ url: "https://test/api?academic_year=2026-2027&education_type=general_secondary&formation_level_code=5e&class_id=6e1" });
  assert.deepEqual((await excluded.json()).items, []);
});

test("le filtre conserve le code de niveau des formations techniques", async () => {
  const technical = { ...classRow, education_type: "technical_secondary", level: "Seconde", formation_level_code: "2ndeT" };
  const { mocks } = handlers({ ...base, class_teachers: [{ ...assignment, class: technical }] });
  const route = load("src/app/api/admin/affectations/current/route.ts", mocks);
  const response = await route.GET({ url: "https://test/api?academic_year=2026-2027&education_type=technical_secondary&formation_level_code=2ndeT&class_id=6e1" });
  assert.equal((await response.json()).items.length, 1);
});

test("le registre retourne les notes de travail et les notes officielles avec leur publication", async () => {
  const evaluation = { class_id: classRow.id, subject_id: subject.id, teacher_id: "teacher", grading_period_id: "T1", scale: 20, coeff: 1, eval_date: "2026-09-16" };
  const { mocks, calls } = handlers({
    ...base,
    grade_periods: [{ id: "T1", institution_id: "csca", academic_year: "2026-2027", start_date: "2026-08-31", end_date: "2026-12-04" }],
    class_enrollments: [{ class_id: classRow.id, student_id: "student", students: { id: "student", last_name: "Élève", first_name: "Test" } }],
    grade_evaluations: [
      { ...evaluation, id: "draft", is_published: false, publication_status: "draft" },
      { ...evaluation, id: "submitted", is_published: false, publication_status: "submitted" },
      { ...evaluation, id: "published", is_published: true, publication_status: "published" },
    ],
    student_grades: [
      { evaluation_id: "draft", student_id: "student", score: 0 },
      { evaluation_id: "submitted", student_id: "student", score: 12 },
      { evaluation_id: "published", student_id: "student", score: 19 },
    ],
    v_grade_scores_official_for_reports: [{ evaluation_id: "published", student_id: "student", score: 15 }],
    grade_evaluation_locks: [{ evaluation_id: "published", is_locked: true }],
  });
  const route = load("src/app/api/admin/grades/register/route.ts", mocks);
  const response = await route.GET({ nextUrl: new URL("https://test/api?class_id=6e1&subject_id=inst-subject&teacher_id=teacher&grading_period_id=T1") });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.scores.map((row) => row.score), [0, 12, 15]);
  assert.deepEqual(data.evaluations.map((row) => row.editable), [true, false, false]);
  assert.deepEqual(data.evaluations.map((row) => row.is_published), [false, false, true]);
  assert.equal(data.meta.published_evaluations_count, 1);
  assert.equal(data.meta.working_evaluations_count, 2);
  assert.equal(calls.filter((table) => table === "student_grades").length, 1);
});

test("le registre refuse une classe d'un autre établissement", async () => {
  const { mocks } = handlers({ ...base, classes: [{ ...classRow, institution_id: "other" }] });
  const route = load("src/app/api/admin/grades/register/route.ts", mocks);
  const response = await route.GET({ nextUrl: new URL("https://test/api?class_id=6e1&subject_id=inst-subject&teacher_id=teacher&grading_period_id=T1") });
  assert.equal(response.status, 404);
});

test("le registre affiche et filtre les deux publications sans masquer le statut des notes verrouillées", () => {
  const period = { id: "T1", label: "Trimestre 1" };
  const evaluations = [
    { id: "draft", column_label: "Note 1", eval_date: "2026-09-16", scale: 20, coeff: 1, is_published: false, publication_status: "draft", editable: true },
    { id: "official", column_label: "Note 2", eval_date: "2026-09-17", scale: 20, coeff: 1, is_published: true, publication_status: "published", is_locked: true, editable: false },
  ];
  const register = { ok: true, evaluations, roster: [{ id: "student", full_name: "Élève test" }], scores: [
    { evaluation_id: "draft", student_id: "student", score: 0 },
    { evaluation_id: "official", student_id: "student", score: 15 },
  ] };
  const render = (filter) => {
    const states = [
      [classRow], false, "2026-2027", { educationType: "general_secondary", formationCode: "", levelCode: "6e", classId: "6e1" },
      [period], false, "T1", [{ teacher: assignment.teacher, subject: { id: "inst-subject", label: "Anglais" } }], false,
      "inst-subject", "teacher", register, false, null, null, "", filter, {}, false, false, false,
    ];
    let index = 0;
    const hooks = { ...React, useState: (initial) => [index < states.length ? states[index++] : initial, () => {}], useEffect: () => {}, useMemo: (fn) => fn(), useRef: (current) => ({ current }) };
    const Page = load("src/app/admin/notes/statistiques/page.tsx", {
      react: { __esModule: true, ...hooks, default: hooks },
      "@/components/admin/EducationScopeFilter": { __esModule: true, default: () => null },
    }).default;
    return renderToStaticMarkup(React.createElement(Page));
  };
  const all = render("all");
  assert.match(all, /Non publiée · Brouillon/);
  assert.match(all, />Publiée</);
  assert.match(all, /Verrouillée/);
  assert.match(all, /value="0"/);
  assert.match(all, /1 publiée · 1 non publiée/);
  const published = render("published");
  assert.match(published, />Note 2</);
  assert.doesNotMatch(published, />Note 1</);
  const unpublished = render("unpublished");
  assert.match(unpublished, />Note 1</);
  assert.doesNotMatch(unpublished, />Note 2</);
  // Le filtre est visuel : la moyenne reste celle de toutes les notes saisies.
  assert.match(published, /7,50/);
  assert.match(unpublished, /7,50/);
});
