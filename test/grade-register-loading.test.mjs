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
        offset: 0, pageSize: 1000,
        select() { return this; },
        eq(key, value) { filters.push((row) => row[key] === value); return this; },
        is(key, value) { return this.eq(key, value); },
        in(key, values) { filters.push((row) => values.includes(row[key])); return this; },
        or(expression) {
          const split = (value) => {
            let depth = 0, start = 0;
            const parts = [];
            for (let i = 0; i < value.length; i++) {
              if (value[i] === "(") depth++;
              if (value[i] === ")") depth--;
              if (value[i] === "," && !depth) { parts.push(value.slice(start, i)); start = i + 1; }
            }
            return [...parts, value.slice(start)];
          };
          const matches = (row, clause) => {
            if (clause.startsWith("and(")) return split(clause.slice(4, -1)).every((c) => matches(row, c));
            const [key, op, ...rest] = clause.split(".");
            const value = rest.join(".");
            if (op === "is") return row[key] == null;
            if (op === "eq") return row[key] === value;
            if (op === "gte") return row[key] >= value;
            if (op === "lte") return row[key] <= value;
            throw new Error(`Unexpected filter ${clause}`);
          };
          filters.push((row) => split(expression).some((clause) => matches(row, clause)));
          return this;
        },
        order() { return this; },
        limit(count) { this.pageSize = count; return this; },
        range(start, end) { this.offset = start; this.pageSize = end - start + 1; return this; },
        maybeSingle() { this.single = true; return this; },
        then(resolve, reject) {
          calls.push(table);
          const rows = (seed[table] || []).filter((row) => filters.every((matches) => matches(row)))
            .slice(this.offset, this.offset + this.pageSize);
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
    "@/lib/supabase-server": { getSupabaseServerClient: async () => db.srv, getVerifiedServerUser: (srv) => srv.auth.getUser() },
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

const overviewPeriod = { id: "T1", institution_id: "csca", academic_year: "2026-2027", start_date: "2026-08-31", end_date: "2026-12-04" };
const overviewEval = (id, extra = {}) => ({
  id, class_id: "6e1", teacher_id: "teacher", subject_id: subject.id, grading_period_id: "T1",
  eval_date: "2026-09-16", is_published: false, publication_status: "draft", scale: 20, coeff: 1,
  ...extra,
});
const overviewUrl = () => ({ nextUrl: new URL("https://test/api?view=overview&class_id=6e1&grading_period_id=T1") });
const overviewBase = {
  ...base,
  profiles: [...base.profiles, { id: "teacher", display_name: "Professeur test" }],
  grade_periods: [overviewPeriod],
};

test("toutes les disciplines ne liste que les enseignants avec des notes, publiées ou non, dans le contexte choisi", async () => {
  const { mocks } = handlers({
    ...overviewBase,
    grade_evaluations: [
      overviewEval("draft"), overviewEval("alias", { subject_id: instSubject.id }),
      overviewEval("published", { is_published: true, publication_status: "published", eval_date: "2026-09-21" }),
      overviewEval("empty", { teacher_id: "empty-teacher" }),
      overviewEval("null", { teacher_id: "null-teacher" }),
      overviewEval("other-class", { class_id: "5e1", teacher_id: "foreign-class" }),
      overviewEval("other-period", { grading_period_id: "T2", teacher_id: "foreign-period" }),
    ],
    student_grades: [
      { evaluation_id: "draft", student_id: "a", score: 0 },
      { evaluation_id: "alias", student_id: "b", score: 12 },
      { evaluation_id: "published", student_id: "c", score: 19 },
      { evaluation_id: "published", student_id: "d", score: 18 },
      { evaluation_id: "null", student_id: "e", score: null },
      { evaluation_id: "other-class", student_id: "f", score: 10 },
      { evaluation_id: "other-period", student_id: "g", score: 10 },
    ],
    v_grade_scores_official_for_reports: [{ evaluation_id: "published", student_id: "c", score: 15 }],
  });
  const route = load("src/app/api/admin/grades/register/route.ts", mocks);
  const response = await route.GET(overviewUrl());
  assert.equal(response.status, 200);
  const { items } = await response.json();
  assert.deepEqual(items, [{
    teacher_id: "teacher", teacher_name: "Professeur test", subject_id: "inst-subject", subject_label: "Anglais",
    notes_count: 3, published_notes_count: 1, unpublished_notes_count: 2,
    evaluations_count: 3, published_evaluations_count: 1, unpublished_evaluations_count: 2,
    last_eval_date: "2026-09-21",
  }]);
});

test("la synthèse compte plus de 1000 notes sans troncature", async () => {
  const { mocks, calls } = handlers({
    ...overviewBase, grade_evaluations: [overviewEval("draft")],
    student_grades: Array.from({ length: 1205 }, (_, index) => ({ evaluation_id: "draft", student_id: `student-${index}`, score: 0 })),
  });
  const route = load("src/app/api/admin/grades/register/route.ts", mocks);
  const response = await route.GET(overviewUrl());
  assert.equal((await response.json()).items[0].notes_count, 1205);
  assert.equal(calls.filter((table) => table === "student_grades").length, 2);
});

test("la synthèse refuse les accès hors établissement et hors rôle admin", async () => {
  for (const [seed, expectedStatus] of [
    [{ ...overviewBase, classes: [{ ...classRow, institution_id: "other" }] }, 404],
    [{ ...overviewBase, user_roles: [{ profile_id: "admin", role: "teacher", institution_id: "csca" }] }, 403],
    [{ ...overviewBase, grade_periods: [{ ...overviewPeriod, academic_year: "2025-2026" }] }, 400],
  ]) {
    const { mocks, calls } = handlers(seed);
    const route = load("src/app/api/admin/grades/register/route.ts", mocks);
    assert.equal((await route.GET(overviewUrl())).status, expectedStatus);
    assert.equal(calls.includes("student_grades"), false);
  }
});

test("les notes d'un ancien enseignant s'ouvrent mais la création exige toujours une affectation", async () => {
  const { mocks } = handlers({
    ...overviewBase, class_teachers: [], grade_evaluations: [overviewEval("draft")],
    students: [{ id: "student", full_name: "Élève test" }],
    student_grades: [{ evaluation_id: "draft", student_id: "student", score: 13 }],
  });
  const route = load("src/app/api/admin/grades/register/route.ts", mocks);
  const overview = await (await route.GET(overviewUrl())).json();
  const item = overview.items[0];
  const params = new URLSearchParams({ class_id: "6e1", grading_period_id: "T1", subject_id: item.subject_id, teacher_id: item.teacher_id });
  const detail = await route.GET({ nextUrl: new URL(`https://test/api?${params}`) });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).scores[0].score, 13);
  const create = await route.POST({ json: async () => ({
    action: "create_evaluation", class_id: "6e1", grading_period_id: "T1", subject_id: item.subject_id,
    teacher_id: item.teacher_id, eval_date: "2026-09-21", eval_kind: "devoir", scale: 20, coeff: 1,
  }) });
  assert.equal(create.status, 403);
});

test("un clic sur la ligne de synthèse sélectionne la discipline et l'enseignant du registre", () => {
  const item = {
    teacher_id: "teacher", teacher_name: "Professeur test", subject_id: "inst-subject", subject_label: "Anglais",
    notes_count: 28, published_notes_count: 0, unpublished_notes_count: 28, evaluations_count: 1, last_eval_date: "2026-09-16",
  };
  const states = [
    [classRow], false, "2026-2027", { educationType: "general_secondary", formationCode: "", levelCode: "6e", classId: "6e1" },
    [overviewPeriod], false, "T1", [], false, "", "", null, false, null, null, "", "all", {}, false, false, false, {}, [item],
  ];
  let index = 0;
  const hooks = { ...React,
    useState(initial) {
      const current = index++;
      if (current >= states.length) states[current] = initial;
      return [states[current], (value) => { states[current] = typeof value === "function" ? value(states[current]) : value; }];
    },
    useEffect: () => {}, useMemo: (fn) => fn(), useRef: (current) => ({ current }),
  };
  const Page = load("src/app/admin/notes/statistiques/page.tsx", {
    react: { __esModule: true, ...hooks, default: hooks },
    "@/components/admin/EducationScopeFilter": { __esModule: true, default: () => null },
  }).default;
  const markup = () => { index = 0; return renderToStaticMarkup(React.createElement(Page)); };
  assert.match(markup(), /Toutes les disciplines/);
  assert.match(markup(), /Professeur test/);
  assert.match(markup(), /28/);
  states[16] = "published";
  assert.doesNotMatch(markup(), /Voir les notes de Professeur test/);
  states[16] = "all";
  index = 0;
  const tree = Page();
  const findRow = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "tr" && node.props.onClick) return node;
    return React.Children.toArray(node.props?.children).map(findRow).find(Boolean);
  };
  findRow(tree).props.onClick();
  assert.equal(states[9], "inst-subject");
  assert.equal(states[10], "teacher");
  states[11] = { ok: true, evaluations: [{ id: "draft", column_label: "Note 1", eval_date: "2026-09-16", is_published: false, scale: 20 }], roster: [{ id: "student", full_name: "Élève test" }], scores: [{ evaluation_id: "draft", student_id: "student", score: 13 }] };
  assert.match(markup(), /Élève test/);
  assert.match(markup(), />Note 1</);
  assert.match(markup(), />13</);
});
