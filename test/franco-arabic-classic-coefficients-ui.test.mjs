import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

const idFrench = "aaaa1111-1111-4111-8111-111111111111";
const idArabic = "bbbb2222-2222-4222-8222-222222222222";
const subjectFrench = "11111111-1111-4111-8111-111111111111";
const subjectArabic = "22222222-2222-4222-8222-222222222222";
const names = [
  { id: subjectFrench, name: "Français" },
  { id: subjectArabic, name: "Arabe" },
];
const configuration = {
  enabledCycles: ["secondary"], teachingTracksByCycle: { secondary: ["french", "arabic"] },
  subjectTracksByCycle: {
    secondary: { [subjectFrench]: ["french"], [subjectArabic]: ["arabic"] },
  },
};
const classes = [
  { id: idFrench, label: "6ème français", level: "6e", cycle: "secondary", track: "french" },
  { id: idArabic, label: "6ème arabe", level: "6e", cycle: "secondary", track: "arabic" },
];
const reporting = { version: 1, enabled: false, format: "separate",
  scales: [], coefficients: [] };
const payload = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
const changeValue = async (window, input, value) => {
  await act(async () => {
    // React 19 tracks the input's own value setter. Use the native prototype
    // setter so the controlled onChange handler receives a genuine new value.
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
};
const flush = async () => {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};

test("un clic d'enregistrement arabe ne touche JAMAIS aux coefficients historiques français", async () => {
  const win = new Window({ url: "https://fixture.invalid" });
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT", "fetch"];
  const descriptors = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, v] of Object.entries({
    window: win, document: win.document, navigator: win.navigator, IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  const requests = [];
  const revisions = { current: "rev1" };
  let savedSettings = { ...reporting };
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true,
    value: async (uri, args = {}) => {
      const url = String(uri), method = args.method || "GET";
      requests.push({ url, method, body: args.body ? JSON.parse(args.body) : null });
      if (method === "PUT" && url === "/api/admin/bulletin-templates") {
        savedSettings = args.body ? JSON.parse(args.body) : savedSettings;
        const { revision: _revision, ...saved } = savedSettings;
        savedSettings = saved; revisions.current = "rev2";
        return payload({ ok: true, reporting: saved, revision: revisions.current });
      }
      if (method === "PUT" && url === "/api/admin/institution/subject-coeffs") {
        return payload({ ok: true, items: [] });
      }
      if (url === "/api/admin/bulletin-templates") {
        return payload({ ok: true, configuration, reporting: savedSettings,
          subjects: names, revision: revisions.current });
      }
      if (url.startsWith("/api/admin/school-class-subjects?")) {
        const classId = new URL(url, "https://fixture.invalid").searchParams.get("class_id");
        return payload({ ok: true, classes, selectedClassId: classId,
          selectedSubjectIds: classId === idFrench ? [subjectFrench] : [subjectArabic] });
      }
      if (url === "/api/admin/school-class-subjects") return payload({ ok: true, classes });
      if (url === "/api/admin/institution/subject-coeffs") {
        return payload({ ok: true, items: [
          { level: "6e", subject_id: subjectFrench, subject_name: "Français", coeff: 3 },
        ] });
      }
      throw Error("unexpected endpoint " + url);
    },
  });

  const container = win.document.createElement("div");
  win.document.body.append(container);
  const root = createRoot(container);
  try {
    const load = createFixtureRouteLoader(createMulticycleFixture(), "unused-user");
    const Component = load("src/components/admin/SchoolCoefficientsClassicWorkflow.tsx").default;
    await act(async () => { root.render(React.createElement(Component)); });
    await flush(); await flush();
    const teaching = container.querySelector('select[aria-label="Enseignement"]');
    assert.ok(teaching);
    await changeValue(win, teaching, "arabic");
    await flush(); await flush();
    assert.match(container.textContent, /Arabe/);
    assert.ok(container.querySelector('input[aria-label="Coefficient Arabe"]'));
    assert.equal(container.querySelector('input[aria-label="Coefficient Français"]'), null);
    const max = container.querySelector('input[aria-label="Barème des notes"]');
    assert.ok(max);
    await changeValue(win, max, "20");
    await changeValue(win, container.querySelector('input[aria-label="Coefficient Arabe"]'), "5");
    const save = [...container.querySelectorAll("button")].find(b => /Enregistrer les coefficients/.test(b.textContent));
    assert.ok(save);
    await act(async () => { save.click(); });
    await flush(); await flush();
    const historicalWrites = requests.filter(req => req.url === "/api/admin/institution/subject-coeffs" && req.method === "PUT");
    assert.equal(historicalWrites.length, 0);
    const saves = requests.filter(req => req.url === "/api/admin/bulletin-templates" && req.method === "PUT");
    assert.equal(saves.length, 1);
    const data = saves[0].body;
    assert.equal(data.enabled, true);
    assert.equal(data.engine, "specialized");
    assert.equal(data.coefficientSource, "program");
    assert.deepEqual(data.coefficients, [{
      cycle: "secondary", track: "arabic", level: "6e", subjectId: subjectArabic,
      coefficient: 5, includeInAverage: true,
    }]);
    assert.equal(data.revision, "rev1");
    assert.deepEqual(data.scales, [{ cycle: "secondary", track: "arabic", level: "6e", maxScore: 20 }]);
  } finally {
    await act(async () => root.unmount());
    await win.happyDOM.close();
    for (const [key, desc] of descriptors) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  }
});
