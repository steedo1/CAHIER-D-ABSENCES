import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";

// Mount both components: the global capture listener must coexist with the
// page's React handler, just as it does in the application layout.
const output = await build({
  stdin: { contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import Page from "./src/app/admin/classes/liste/[id]/page";
    import Corrections from "./src/components/ClassListCorrectionsPanel";
    createRoot(document.getElementById("root")).render(<><Page /><Corrections /></>);
  `, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, jsx: "automatic", format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "fixture-navigation", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents:
      'export const useParams=()=>({id:"fixture"});export const usePathname=()=>"/admin/classes/liste/fixture";' }));
  } }],
});

for (const mode of ["mixed-arabic", "direct-arabic", "french"]) {
  test(`Corriger les champs opens and saves through the appropriate editor: ${mode}`, async () => {
    const arabic = mode !== "french";
    const mixed = mode === "mixed-arabic";
    const window = new Window({ url: "https://fixture.invalid/admin/classes/liste/fixture" });
    const errors = [], requests = [];
    window.addEventListener("error", event => errors.push(event.message));
    window.console.error = (...args) => errors.push(args.join(" "));
    window.HTMLElement.prototype.scrollIntoView = function () {};
    const student = {
      id: "direct", full_name: "DEMO Mariam", first_name: "Mariam", last_name: "DEMO",
      full_name_ar: "مريم", matricule: "EPC-TEST", gender: "F", birthdate: null,
      birth_place: null, nationality: null, parent_names: null, parent_contact: null,
      is_repeater: false, lv2: null, enrollment_start_date: null, pedagogical_link: false,
    };
    const linked = { ...student, id: "linked", full_name: "AUTRE Élève", full_name_ar: "آدم",
      matricule: "EPC-LINKED", pedagogical_link: true };
    window.fetch = async (input, options) => {
      const url = new URL(String(input), window.location.href);
      requests.push({ path: url.pathname, method: options?.method || "GET" });
      if (options?.method === "PATCH") {
        assert.equal(url.pathname, "/api/admin/students/direct");
        const patch = JSON.parse(options.body);
        assert.deepEqual(patch, { birth_place: "Dimbokro" });
        Object.assign(student, patch);
        return Response.json({ item: student });
      }
      if (url.pathname.endsWith("/roster")) return Response.json({
        class: { id: "fixture", label: "CM1", level: "CM1", academic_year: "2026-2027",
          teaching_track: arabic ? "arabic" : "french", education_type: "general_secondary" },
        academic_year: { label: "2026-2027" }, can_edit: !mixed,
        can_edit_direct_student_identity: arabic,
        institution: { name: "École de démonstration", code: "E020684" },
        staff: { educators: [] }, students: mixed ? [student, linked] : [student],
        totals: { students: mixed ? 2 : 1, girls: mixed ? 2 : 1, boys: 0 },
      });
      if (url.pathname.endsWith("/scholarships")) return Response.json({ scholarships: {}, academic_year: "2026-2027" });
      if (url.pathname.endsWith("/school-report-fields")) return Response.json({ ok: true, decision_numbers: {} });
      throw new Error(`Unexpected request: ${url.pathname}`);
    };
    const button = label => [...window.document.querySelectorAll("button")]
      .find(node => node.textContent.trim() === label);
    const wait = async predicate => {
      const deadline = Date.now() + 3000;
      while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(predicate(), `Missing expected UI; errors=${errors}; text=${window.document.body.textContent.slice(-900)}`);
    };
    try {
      window.document.body.innerHTML = '<div id="root"></div>';
      window.eval(output.outputFiles[0].text);
      await wait(() => button("Corriger les champs") && !button("Corriger les champs").disabled);
      button("Corriger les champs").click();
      if (!arabic) {
        await wait(() => button("Enregistrer") && !button("Enregistrer").disabled);
        assert.ok(requests.some(request => request.path.endsWith("/scholarships")), "French corrections still use the general panel");
        assert.equal(window.document.querySelector("#arabic-direct-student-identities"), null);
        return;
      }
      await wait(() => window.document.querySelector("#arabic-direct-student-identities"));
      const panel = window.document.querySelector("#arabic-direct-student-identities");
      assert.equal(panel.querySelectorAll("button").length, 1, "Only the directly enrolled pupil can be edited");
      assert.ok(!window.document.body.textContent.includes("Corriger les champs élèves"), "General modal must not intercept the click");
      assert.ok(!requests.some(request => request.path.endsWith("/scholarships")), "Arabic identity corrections need no scholarship request");
      const input = [...panel.querySelectorAll("label")]
        .find(label => label.textContent.trim() === "Lieu de naissance").querySelector("input");
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "Dimbokro");
      input.dispatchEvent(new window.InputEvent("input", { bubbles: true, data: "Dimbokro", inputType: "insertText" }));
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 20));
      button("Enregistrer cette fiche").click();
      await wait(() => panel.querySelector('[role="status"]')?.textContent.includes("enregistrée et vérifiée"));
      assert.deepEqual(requests.filter(request => request.method === "PATCH"), [
        { path: "/api/admin/students/direct", method: "PATCH" },
      ]);
      assert.equal(input.value, "Dimbokro");
      assert.equal(linked.birth_place, null, "Linked pupil stays unchanged");
      assert.deepEqual(errors, []);
    } finally {
      await window.happyDOM.close();
    }
  });
}
