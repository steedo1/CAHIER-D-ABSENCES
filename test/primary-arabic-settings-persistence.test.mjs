import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import {
  validateFrancoArabicReportsInput, readFrancoArabicReportsForEditing,
} from "../src/lib/franco-arabic-reporting";

const quran = "11111111-1111-4111-8111-111111111111";
const hadith = "22222222-2222-4222-8222-222222222222";
const lecture = "33333333-3333-4333-8333-333333333333";
const cp1Ar = "44444444-4444-4444-8444-444444444444";
const cp2Ar = "55555555-5555-4555-8555-555555555555";
const cp1Fr = "66666666-6666-4666-8666-666666666666";
const schoolClasses = [
  { id: cp1Fr, level: "CP1", label: "CP1 Français", cycle: "primary", track: "french" },
  { id: cp1Ar, level: "CP1", label: "CP1 Arabe", cycle: "primary", track: "arabic" },
  { id: cp2Ar, level: "CP2", label: "CP2 Arabe", cycle: "primary", track: "arabic" },
];
const subjects = [
  { id: quran, name: "Coran" }, { id: hadith, name: "Hadith" },
  { id: lecture, name: "Lecture" },
];
const configuration = {
  enabledCycles: ["primary"],
  teachingTracksByCycle: { primary: ["french", "arabic"] },
  subjectTracksByCycle: { primary: {
    [quran]: ["arabic"], [hadith]: ["arabic"], [lecture]: ["french"],
  } },
};
const original = {
  version: 1, enabled: true, format: "separate", engine: "specialized",
  scales: [
    { cycle: "primary", track: "french", level: "CP1", maxScore: 10 },
    { cycle: "primary", track: "arabic", level: "CP1", maxScore: 10 },
    { cycle: "primary", track: "arabic", level: "CP2", maxScore: 10 },
  ],
  coefficients: [], primarySubjectScales: [
    { cycle: "primary", track: "arabic", level: "CP2", subjectId: quran, maxScore: 30 },
  ],
};

test("Arabic per-subject scales survive stored JSON reload, without impacting French", () => {
  const saved = validateFrancoArabicReportsInput({
    ...original, primarySubjectScales: [...original.primarySubjectScales,
      { cycle: "primary", track: "arabic", level: "CP1", subjectId: quran, maxScore: 20 },
      { cycle: "primary", track: "arabic", level: "CP1", subjectId: hadith, maxScore: 10 },
    ],
  });
  assert.ok(saved);
  const reloaded = readFrancoArabicReportsForEditing({ franco_arabic_reports_v1: JSON.parse(JSON.stringify(saved)) });
  assert.deepEqual(reloaded.primarySubjectScales, saved.primarySubjectScales);
  assert.deepEqual(reloaded.scales, original.scales);
  assert.deepEqual(reloaded.coefficients, []);
  assert.equal(validateFrancoArabicReportsInput({ ...saved,
    primarySubjectScales: [...saved.primarySubjectScales, saved.primarySubjectScales[0]] }), null);
  assert.equal(validateFrancoArabicReportsInput({ ...saved,
    primarySubjectScales: [{ ...saved.primarySubjectScales[0], maxScore: 0 }] }), null);
  assert.equal(validateFrancoArabicReportsInput({ ...saved,
    primarySubjectScales: [{ ...saved.primarySubjectScales[0], track: "french" }] }), null);
});

const json = data => new Response(JSON.stringify(data), { status: 200 });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function change(node, value) {
  assert.ok(node);
  await act(async () => {
    const prop = Object.keys(node).find(key => key.startsWith("__reactProps$"));
    if (prop && typeof node[prop]?.onChange === "function")
      node[prop].onChange({ target: { value } });
    else {
      node.value = value;
      node.dispatchEvent(new window.Event("change", { bubbles: true }));
    }
  });
}

test("CP1 arabe: saisir, enregistrer et retrouver Coran/Hadith après rafraîchissement", async () => {
  const win = new Window({ url: "https://fixture.invalid" });
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT", "fetch"];
  const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let stored = structuredClone(original), revision = "r1";
  const saves = [];
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, init = {}) => {
      const path = String(url);
      if (path === "/api/admin/bulletin-templates" && init.method === "PUT") {
        const incoming = JSON.parse(init.body);
        assert.equal(incoming.revision, revision);
        const validated = validateFrancoArabicReportsInput(incoming);
        assert.ok(validated, JSON.stringify(incoming));
        stored = JSON.parse(JSON.stringify(validated));
        saves.push(stored);
        revision = "r" + (saves.length + 1);
        return json({ ok: true, reporting: stored, revision });
      }
      if (path === "/api/admin/bulletin-templates")
        return json({ ok: true, configuration, reporting: stored, revision, subjects });
      if (path === "/api/admin/institution/subject-coeffs")
        return json({ ok: true, items: [] });
      if (path === "/api/admin/school-class-subjects")
        return json({ ok: true, classes: schoolClasses });
      if (path.startsWith("/api/admin/school-class-subjects?")) {
        const id = new URL(path, "https://fixture.invalid").searchParams.get("class_id");
        return json({ ok: true, selectedClassId: id, classes: schoolClasses,
          selectedSubjectIds: id === cp1Fr ? [lecture] : [quran, hadith] });
      }
      throw Error("Unexpected network request " + path);
    },
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const container = win.document.createElement("div");
  win.document.body.append(container);
  const root = createRoot(container);
  try {
    const loader = createFixtureRouteLoader(createMulticycleFixture(), "unused-user");
    const Editor = loader("src/components/admin/SchoolCoefficientsClassicWorkflow.tsx").default;
    await act(async () => { root.render(React.createElement(Editor)); });
    await flush(); await flush();
    await change(container.querySelector('select[aria-label="Enseignement"]'), "arabic");
    await flush(); await flush();
    assert.equal(container.querySelector('input[aria-label="Barème de composition Coran"]').value, "");
    await change(container.querySelector('input[aria-label="Barème de composition Coran"]'), "20");
    await change(container.querySelector('input[aria-label="Barème de composition Hadith"]'), "10");
    const save = [...container.querySelectorAll("button")].find(b => /Enregistrer les barèmes des matières/.test(b.textContent));
    assert.ok(save);
    await act(async () => { save.click(); });
    await flush(); await flush();
    assert.equal(saves.length, 1, container.querySelector('[role="alert"]')?.textContent);
    assert.deepEqual(saves[0].primarySubjectScales, [
      original.primarySubjectScales[0],
      { cycle: "primary", track: "arabic", level: "CP1", subjectId: quran, maxScore: 20 },
      { cycle: "primary", track: "arabic", level: "CP1", subjectId: hadith, maxScore: 10 },
    ]);
    assert.deepEqual(saves[0].scales, original.scales);
    await act(async () => { [...container.querySelectorAll("button")].find(b => b.textContent.includes("Rafraîchir")).click(); });
    await flush(); await flush();
    assert.equal(container.querySelector('input[aria-label="Barème de composition Coran"]').value, "20");
    assert.equal(container.querySelector('input[aria-label="Barème de composition Hadith"]').value, "10");
    await change(container.querySelector('select[aria-label="Niveau et classe"]'), cp2Ar);
    await flush(); await flush();
    assert.equal(container.querySelector('input[aria-label="Barème de composition Coran"]').value, "30");
    await change(container.querySelector('select[aria-label="Niveau et classe"]'), cp1Ar);
    await flush(); await flush();
    assert.equal(container.querySelector('input[aria-label="Barème de composition Coran"]').value, "20");
    assert.match(container.textContent, /Échelle de la moyenne du bulletin : \/10/);
    assert.equal(container.querySelector('input[aria-label="Barème de composition Lecture"]'), null);
  } finally {
    await act(async () => { root.unmount(); });
    await win.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
