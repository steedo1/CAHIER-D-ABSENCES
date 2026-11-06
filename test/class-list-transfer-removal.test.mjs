import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";
import {
  safeEnrollmentEndDate,
  studentMatchesIdentity,
} from "../src/lib/student-class-membership.ts";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("la recherche d'identité exige le nom et au moins un prénom", () => {
  const student = {
    last_name: "N'GUESSAN",
    first_name: "Élodie Ange-Marie",
  };

  assert.equal(
    studentMatchesIdentity(student, {
      lastName: "n guessan",
      firstName: "Elodie",
    }),
    true,
  );
  assert.equal(
    studentMatchesIdentity(student, {
      lastName: "N'GUESSAN",
      firstName: "Ange Marie",
    }),
    true,
  );
  assert.equal(
    studentMatchesIdentity(student, {
      lastName: "GUESSAN",
      firstName: "Élodie",
    }),
    false,
  );
  assert.equal(
    studentMatchesIdentity(student, {
      lastName: "N'GUESSAN",
      firstName: "",
    }),
    false,
  );
});

test("le transfert par identité reste une sélection explicite par identifiant", async () => {
  const route = await source("src/app/api/admin/students/search/route.ts");
  const page = await source("src/app/admin/parents/page.tsx");

  assert.match(route, /searchParams\.get\("last_name"\)/);
  assert.match(route, /searchParams\.get\("first_name"\)/);
  assert.match(route, /studentMatchesIdentity/);
  assert.match(route, /ambiguous: identitySearch \? items\.length > 1/);
  assert.match(page, /Plusieurs résultats correspondent au nom et au prénom saisis/);
  assert.match(page, /if \(selectedStu\?\.id\) \{[\s\S]{0,180}?student_id: selectedStu\.id/);
});

test("la date de fin d'un transfert ne précède jamais le début de l'inscription", () => {
  assert.equal(safeEnrollmentEndDate("2026-09-09", "2026-08-31"), "2026-09-09");
  assert.equal(safeEnrollmentEndDate("2026-08-01", "2026-08-31"), "2026-08-31");
  assert.equal(safeEnrollmentEndDate(null, "2026-08-31"), "2026-08-31");
});

test("la liste arabe affiche les élèves dont le niveau français diffère et sépare les opérations", async () => {
  const output = await build({
    stdin: { contents: `
      import { createRoot } from "react-dom/client";
      import Page from "./src/app/admin/parents/page";
      createRoot(document.getElementById("root")).render(<Page />);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, jsx: "automatic", format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const window = new Window({ url: "https://example.invalid/admin/parents" });
  const year = "2026-2027";
  const classId = "11111111-1111-4111-8111-111111111111";
  const student = { id: "fixture", full_name: "TEST Prénom", matricule: "TEST01" };
  const operations = [];
  window.fetch = async (input, init) => {
    const url = new URL(input, window.location.href);
    const payload = {
      "/api/auth/role": { role: "admin" },
      "/api/admin/institution/education-organization": { ok: true },
      "/api/admin/institution/subject-coeffs": { ok: true },
      "/api/admin/classes": { items: [{ id: classId, name: "Classe de 5e", level: "5e", academic_year: year }] },
      "/api/admin/students": { items: [{ ...student, level: "CM1", class_id: "home" }] },
      "/api/admin/institution/academic-years": { ok: true, items: [{ code: year, is_current: true }] },
      "/api/admin/institution/settings": { settings_json: {
        school_student_programs_v1: { version: 1, years: { [year]: { classes: { [classId]: { tracks: ["arabic"] } } } } },
      } },
      [`/api/admin/classes/${classId}/roster`]: { class: { teaching_track: "arabic" }, students: [student] },
    }[url.pathname];
    if (url.pathname === "/api/admin/classes/arabic-link") {
      operations.push(JSON.parse(init.body));
      return Response.json({ ok: true, transferred: operations.at(-1).action === "transfer_teaching" });
    }
    assert.ok(payload, `Unexpected request: ${url.pathname}`);
    return Response.json(payload);
  };
  const button = (label) => [...window.document.querySelectorAll("button")]
    .find((item) => item.textContent.trim() === label);
  const select = (value) => [...window.document.querySelectorAll("select")]
    .find((item) => !item.disabled && [...item.options].some((option) => option.value === value));
  const wait = async (predicate) => {
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 15));
    assert.ok(predicate(), window.document.body.textContent.slice(-1200));
  };
  const selectValue = async (value) => {
    await wait(() => select(value));
    const input = select(value);
    input.value = value;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  try {
    window.document.body.innerHTML = '<div id="root"></div>';
    window.eval(output.outputFiles[0].text);
    await selectValue("5e");
    await selectValue(classId);
    await wait(() => window.document.querySelector("tbody")?.textContent.includes("TEST01"));
    button("Ajouter / Transférer").click();
    await wait(() => button("Nouvel élève"));
    button("Nouvel élève").click();
    await wait(() => window.document.body.textContent.includes("choisissez d’abord sa classe française"));
    assert.equal(button("Ajouter dans la classe"), undefined);
    for (const [mode, submit, action] of [
      ["Ajouter à un autre enseignement", "Ajouter à cette classe arabe", "add_teaching"],
      ["Transférer un élève", "Transférer vers la classe", "transfer_teaching"],
    ]) {
      await wait(() => button(mode));
      button(mode).click();
      await wait(() => button(mode)?.getAttribute("aria-pressed") === "true");
      const input = window.document.querySelector('input[placeholder="Ex : 20166309J"]');
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "TEST01");
      input.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
      await wait(() => button(submit) && !button(submit).disabled);
      button(submit).click();
      await wait(() => operations.at(-1)?.action === action && !button(submit));
      assert.deepEqual(operations.at(-1), { action, class_id: classId, matricule: "TEST01" });
      button("Ajouter / Transférer").click();
    }
  } finally {
    await window.happyDOM.close();
  }
});
