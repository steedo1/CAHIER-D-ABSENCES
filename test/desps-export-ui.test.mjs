import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { Window } from "happy-dom";

const require = createRequire(import.meta.url);
test("a rejected export shows the scoped registry diagnostic while other card filters stay independent", async () => {
  const window = new Window({ url: "https://fixture.invalid" });
  const keys = ["window", "document", "navigator", "HTMLElement", "FormData", "IS_REACT_ACT_ENVIRONMENT", "fetch"];
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys.slice(0, 5)) Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"), { createRoot } = require("react-dom/client");
  const built = await require("esbuild").build({ entryPoints: ["src/app/admin/export-moyennes/OfficialExportForm.tsx"],
    bundle: true, platform: "node", format: "cjs", write: false, jsx: "automatic",
    external: ["react", "react/jsx-runtime", "lucide-react"] });
  const module = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(module, module.exports, require);
  const Form = module.exports.default, calls = [], host = window.document.createElement("div");
  window.document.body.append(host); const root = createRoot(host);
  globalThis.fetch = async input => {
    const url = new URL(String(input), window.location.href); calls.push(url);
    if (url.pathname.endsWith("/diagnostic")) return Response.json({ ok: true, academicYear: "2026-2027",
      scope: "6e1", classes: 1, enrollments: 1, girls: 1, boys: 0, unknown: 0, blockingCount: 1,
      byCode: { MATRICULE_ABSENT: 1 }, alerts: [], generatedAt: "2026-10-29",
      issues: [{ className: "6e1", studentName: "Élève concerné", matricule: "", code: "MATRICULE_ABSENT", detail: "Matricule national non renseigné", severity: "blocking" }] });
    return Response.json({ error: "MISSING_MATRICULE", message: "Matricule national manquant" }, { status: 422 });
  };
  const props = { academicYears: ["2026-2027"], defaultAcademicYear: "2026-2027", hasAcademicYears: true,
    classes: [{ value: "class-a", label: "6e1", academicYear: "2026-2027" }, { value: "class-b", label: "6e2", academicYear: "2026-2027" }] };
  try {
    await React.act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement(Form, { ...props, fields: { export_kind: "desps_official_term", period_ref: "period:t1", term: "1" } }),
      React.createElement(Form, { ...props, fields: { export_kind: "desps_official_annual" } }))));
    const forms = host.querySelectorAll("form"), first = forms[0].querySelector('[name="class_id"]');
    await React.act(async () => { first.value = "class-a"; first.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.equal(forms[1].querySelector('[name="class_id"]').value, "");
    await React.act(async () => { forms[0].dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(calls.length, 2); assert.equal(calls[0].searchParams.get("class_id"), "class-a");
    assert.equal(calls[1].searchParams.get("class_id"), "class-a");
    assert.match(forms[0].textContent, /Élève concerné/);
    assert.match(forms[0].textContent, /Télécharger toutes les anomalies/);
    assert.equal(forms[0].querySelector('button[type="submit"]').disabled, true);
    assert.equal(forms[1].querySelector('button[type="submit"]').disabled, false);
    assert.doesNotMatch(forms[1].textContent, /Élève concerné/);
  } finally {
    await React.act(async () => root.unmount()); await window.happyDOM.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
