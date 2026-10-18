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
    // happy-dom does not implement browser input events accurately for React 19
    // number inputs. Trigger the actual controlled handler through the React
    // props attached to this rendered element instead of faking DOM input.
    const propsKey = Object.keys(input).find(key => key.startsWith("__reactProps$"));
    const onChange = propsKey && input[propsKey]?.onChange;
    if (typeof onChange === "function") onChange({ target: { value } });
    else {
      input.value = value;
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    }
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
    assert.equal(saves.length, 1, JSON.stringify({
      error: container.querySelector('[role="alert"]')?.textContent,
      message: container.querySelector('[role="status"]')?.textContent,
      inputs: [...container.querySelectorAll("input")].map(input => ({ label: input.getAttribute("aria-label"), value: input.value })),
      writes: requests.filter(request => request.method === "PUT"),
      loading: [...container.querySelectorAll("button")].filter(button => button.textContent.includes("Enregistrer")).map(button => ({ text: button.textContent, disabled: button.disabled })),
    }));
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


test("primaire : disciplines françaises/arabe de CP1 à CM2, changements de classe et absence de sous-matières", async () => {
  const win = new Window({ url: "https://fixture.invalid" });
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT", "fetch"];
  const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const primaryClasses = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"].flatMap((level, index) =>
    ["french", "arabic"].map((track, n) => ({
      id: `cccc3333-3333-4333-8333-${String(index * 2 + n + 1).padStart(12, "0")}`,
      level, label: `${level} ${track}`, cycle: "primary", track,
    })));
  const allClasses = [...classes, ...primaryClasses];
  const shared = "99999999-9999-4999-8999-999999999999";
  const subjects = [...names, { id: shared, name: "Mathématiques communes" }];
  const configurationWithPrimary = { ...configuration, enabledCycles: ["secondary", "primary"],
    teachingTracksByCycle: { secondary: ["french", "arabic"], primary: ["french", "arabic"] },
    subjectTracksByCycle: { ...configuration.subjectTracksByCycle,
      primary: { [subjectFrench]: ["french"], [subjectArabic]: ["arabic"], [shared]: ["french", "arabic"] } } };
  const requests = [];
  let emptyClass = "";
  for (const [key, value] of Object.entries({ window: win, document: win.document,
    navigator: win.navigator, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (uri, init = {}) => {
      const url = String(uri);
      requests.push({ url, method: init.method || "GET" });
      if (url === "/api/admin/bulletin-templates") return payload({ ok: true,
        configuration: configurationWithPrimary, reporting, subjects, revision: "read-only-test" });
      if (url === "/api/admin/institution/subject-coeffs") return payload({ ok: true, items: [] });
      if (url === "/api/admin/school-class-subjects") return payload({ ok: true, classes: allClasses });
      if (url.startsWith("/api/admin/school-class-subjects?")) {
        const classId = new URL(url, "https://fixture.invalid").searchParams.get("class_id");
        const selected = allClasses.find(row => row.id === classId);
        return payload({ ok: true, selectedClassId: classId, classes: allClasses,
          selectedSubjectIds: classId === emptyClass ? []
            : [selected?.track === "arabic" ? subjectArabic : subjectFrench,
              ...(selected?.cycle === "primary" ? [shared] : [])] });
      }
      throw Error("unexpected primary endpoint " + url);
    },
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const container = win.document.createElement("div");
  win.document.body.append(container);
  const root = createRoot(container);
  try {
    const load = createFixtureRouteLoader(createMulticycleFixture(), "unused-user");
    const Component = load("src/components/admin/SchoolCoefficientsClassicWorkflow.tsx").default;
    await act(async () => root.render(React.createElement(Component)));
    await flush(); await flush();
    await changeValue(win, container.querySelector('select[aria-label="Cycle"]'), "primary");
    await flush(); await flush();
    for (const track of ["french", "arabic"]) {
      await changeValue(win, container.querySelector('select[aria-label="Enseignement"]'), track);
      await flush(); await flush();
      for (const schoolClass of primaryClasses.filter(row => row.track === track)) {
        await changeValue(win, container.querySelector('select[aria-label="Niveau et classe"]'), schoolClass.id);
        await flush(); await flush();
        const rows = [...container.querySelectorAll("tbody tr")].map(row => row.textContent);
        assert.equal(rows.length, 2, schoolClass.label);
        assert.ok(rows.some(row => row.includes(track === "french" ? "Français" : "Arabe")), schoolClass.label);
        assert.ok(rows.some(row => row.includes("Mathématiques communes")), schoolClass.label);
        assert.ok(rows.every(row => !row.includes(track === "french" ? "Arabe" : "Français")), schoolClass.label);
        assert.equal(container.querySelector('input[aria-label^="Coefficient "]'), null);
        assert.equal([...container.querySelectorAll("button")].some(button => /Ajouter.*sous-matières/.test(button.textContent)), false);
      }
    }
    // The real school's French primary has no selected curriculum yet:
    // do not pretend that catalog subjects have already been assigned to it.
    emptyClass = primaryClasses.find(row => row.track === "french").id;
    await changeValue(win, container.querySelector('select[aria-label="Enseignement"]'), "french");
    await flush(); await flush();
    assert.match(container.querySelector('[role="alert"]')?.textContent || "", /Aucune matière affectée/);
    assert.equal(container.querySelectorAll("tbody tr").length, 0);
    assert.equal(requests.some(request => request.method !== "GET"), false);
    assert.equal(requests.some(request => request.url.includes("subject-components")), false);
    assert.equal(container.querySelectorAll("select").length, 3);
  } finally {
    await act(async () => root.unmount());
    await win.happyDOM.close();
    for (const [key, desc] of descriptors) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  }
});
