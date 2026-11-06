import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { Window } from "happy-dom";
import { createFixtureRouteLoader, createMulticycleFixture } from "./helpers/multicycle-fixture.mjs";

const require = createRequire(import.meta.url);
const home = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const pupil = "33333333-3333-4333-8333-333333333333";

test("the Arabic roster uses its own level and its three operations use the intended routes", async () => {
  const window = new Window({ url: "https://fixture.invalid/admin/parents" });
  const keys = ["window", "document", "navigator", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT", "fetch"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys.slice(0, 4)) Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"), { createRoot } = require("react-dom/client");
  const built = await require("esbuild").build({ entryPoints: ["src/app/admin/parents/page.tsx"],
    bundle: true, platform: "node", format: "cjs", write: false, jsx: "automatic",
    external: ["react", "react/jsx-runtime"] });
  const module = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(module, module.exports, require);
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  const classes = [
    { id: home, name: "CM1 — Français", level: "CM1" },
    { id: target, name: "5ème — Arabe", level: "5ème" },
  ];
  const student = { id: pupil, last_name: "DEMO", first_name: "Mariam", full_name: "DEMO Mariam",
    matricule: "EPC-TEST", class_id: home, class_label: classes[0].name, level: "CM1" };
  const db = createMulticycleFixture();
  const settings = {
    school_cycles_v1: { version: 1, enabled: true, enabledCycles: ["primary", "secondary"],
      teachingTracksByCycle: { primary: ["french"], secondary: ["arabic"] } },
    school_student_programs_v1: { version: 1, years: { "2026-2027": { classes: {
      [home]: { tracks: ["french"], students: {} },
      [target]: { tracks: ["arabic"], students: {} },
    } } } },
  };
  Object.assign(db.tables.institutions[0], { code_unique: "E020684", settings_json: settings });
  db.tables.classes.push(...classes.map(row => ({ ...row, label: row.name,
    institution_id: db.legacyId, academic_year: "2026-2027" })));
  db.tables.academic_years.push({ id: "year", code: "2026-2027",
    institution_id: db.legacyId, is_current: true, start_date: "2026-09-14" });
  const load = createFixtureRouteLoader(db, db.legacyAdminId, new Map([
    ["src/lib/finance/student-finance-sync.ts",
      'export async function synchronizeStudentFinance() { throw new Error("Unexpected Finance call"); }'],
  ]));
  const assignRoute = load("src/app/api/admin/enrollments/assign/route.ts");
  const posts = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), window.location.href);
    if (options?.method === "POST") {
      const payload = JSON.parse(options.body);
      posts.push([url.pathname, payload]);
      if (payload.action === "create_arabic") {
        return assignRoute.POST(new Request(url, { method: "POST", body: options.body }));
      }
      return Response.json({ ok: true, student, transferred: posts.at(-1)[1].operation === "transfer" });
    }
    if (url.pathname === "/api/auth/role") return Response.json({ role: "admin" });
    if (url.pathname === "/api/admin/classes") return Response.json({ items: classes });
    if (url.pathname === "/api/admin/students") return Response.json({ items: [student] });
    if (url.pathname === "/api/admin/students/search") {
      assert.equal(url.searchParams.get("full_name"), "DÉMO MARIAM");
      return Response.json({ items: [student], spelling_suggestions: true });
    }
    if (url.pathname.endsWith("/roster")) return Response.json({
      class: { label: classes[1].name, teaching_track: "arabic" },
      students: [{ id: pupil, full_name: student.full_name, matricule: student.matricule },
        ...db.tables.class_enrollments.filter(row => row.class_id === target).map(row => {
          const record = db.tables.students.find(entry => entry.id === row.student_id);
          return { id: record.id, full_name: [record.last_name, record.first_name].join(" "), matricule: record.matricule };
        })],
    });
    if (url.pathname.endsWith("/settings")) return Response.json({ settings_json: settings, arabic_direct_enrollment: true });
    if (url.pathname.endsWith("/academic-years")) return Response.json({ ok: true,
      items: [{ code: "2026-2027", is_current: true }] });
    return Response.json({ ok: true, items: [] });
  };

  const button = label => [...host.querySelectorAll("button")].find(node => node.textContent.trim() === label);
  const click = label => React.act(async () => {
    assert.ok(button(label), `Missing button: ${label}`);
    button(label).click();
  });
  const select = value => React.act(async () => {
    const field = [...host.querySelectorAll("select")].find(node => [...node.options].some(option => option.value === value));
    assert.ok(field && !field.disabled, `Unavailable option: ${value}`);
    field.value = value;
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  const input = (query, value) => React.act(async () => {
    const field = host.querySelector(query);
    assert.ok(field, `Missing input: ${query}`);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, value);
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  });

  try {
    await React.act(async () => root.render(React.createElement(module.exports.default)));
    await select("5ème");
    await select(target);
    assert.match(host.querySelector("tbody").textContent, /DEMO Mariam/);

    await click("Ajouter / Transférer");
    assert.ok(button("Nouvel élève"));
    assert.ok(button("Transférer un élève"));
    assert.ok(button("Ajouter à un autre enseignement"));
    await input('input[placeholder="Nom et prénom(s)"]', "Démo Mariam");
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    assert.match(host.textContent, /Orthographe proche/);
    await click("Choisir");
    await click("Ajouter à la classe arabe");
    assert.deepEqual(posts[0], ["/api/admin/classes/arabic-link",
      { class_id: target, student_id: pupil, operation: "add" }]);

    await click("Ajouter / Transférer");
    await click("Transférer un élève");
    await input('input[placeholder="Ex : 20166309J"]', "EPC-TEST");
    await click("Transférer vers la classe");
    assert.deepEqual(posts[1], ["/api/admin/classes/arabic-link",
      { class_id: target, matricule: "EPC-TEST", operation: "transfer" }]);

    await click("Ajouter / Transférer");
    await click("Nouvel élève");
    assert.ok(button("Inscrire en arabe"), "Arabic-only enrollment is available without a French class");
    await input('input[placeholder="Ex : AMON"]', "Exclusif");
    await input('input[placeholder="Ex : ANGE ARISTIDE"]', "Élève");
    await click("Inscrire en arabe");
    assert.equal(posts.length, 3);
    assert.equal(posts[2][0], "/api/admin/enrollments/assign");
    assert.equal(posts[2][1].class_id, target);
    assert.equal(posts[2][1].action, "create_arabic");
    assert.match(host.textContent, /Élève inscrit dans la classe arabe/);
    assert.match(host.querySelector("tbody").textContent, /EXCLUSIF Élève/);
    assert.equal(db.tables.students.length, 1);
    assert.deepEqual(db.tables.class_enrollments.map(row => row.class_id), [target]);

    await click("Ajouter / Transférer");
    await click("Nouvel élève");
    await select(home);
    await input('input[placeholder="Ex : AMON"]', "Autre");
    await input('input[placeholder="Ex : ANGE ARISTIDE"]', "Élève");
    await click("Inscrire en français");
    assert.equal(posts.length, 4);
    assert.equal(posts[3][0], "/api/admin/enrollments/assign");
    assert.equal(posts[3][1].class_id, home);
    assert.equal(posts[3][1].create_only, true);
    assert.ok(button("Ajouter à la classe arabe"));
  } finally {
    await React.act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
