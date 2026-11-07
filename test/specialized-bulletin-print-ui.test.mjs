import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { NextRequest } from "next/server.js";
import { createPedagogicalFixture } from "./helpers/pedagogical-fixture.mjs";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

test("print button and Ctrl+P refresh through the existing action only for complete selected programs", async () => {
  const window = new Window({ url: "https://fixture.invalid" });
  const descriptors = new Map(["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container = window.document.createElement("div"); window.document.body.append(container);
  const root = createRoot(container);
  try {
    const db = createPedagogicalFixture(); db.tables.grade_evaluations[1].is_published = false;
    const load = createFixtureRouteLoader(db, db.legacyAdminId);
    const response = await load("src/app/api/admin/grades/bulletin/route.ts").GET(new NextRequest("https://fixture.invalid/api/admin/grades/bulletin?class_id=33333333-3333-4333-8333-333333333333&from=2026-09-01&to=2026-12-15&academic_year=2026-2027"));
    const { specialized: data } = await response.json();
    const Panel = load("src/components/bulletins/SpecializedBulletinPanel.tsx").default;
    let refreshes = 0, nativePrints = 0;
    window.print = () => { nativePrints++; };
    await act(async () => root.render(React.createElement(Panel, { data, onBack() {}, onPrint: async () => { refreshes++; } })));
    const printButton = () => [...container.querySelectorAll("button")].find(button => button.textContent.includes("Imprimer"));
    const shortcut = async () => {
      const event = new window.KeyboardEvent("keydown", { key: "p", ctrlKey: true, cancelable: true });
      await act(async () => window.dispatchEvent(event));
      assert.equal(event.defaultPrevented, true);
    };
    assert.equal(printButton().disabled, true);
    assert.ok(container.querySelector(".specialized-print-blocked"));
    assert.match(container.textContent, /BROUILLON · NON VALIDÉ/);
    await shortcut(); assert.equal(refreshes, 0);
    const select = container.querySelector("select");
    await act(async () => { select.value = "french"; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.equal(printButton().disabled, false);
    assert.equal(container.querySelector(".specialized-print-blocked"), null);
    assert.doesNotMatch(container.textContent, /BROUILLON · NON VALIDÉ/);
    await shortcut(); assert.equal(refreshes, 1); assert.equal(nativePrints, 0);
    await act(async () => printButton().click()); assert.equal(refreshes, 2);
    await act(async () => { select.value = "arabic"; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.equal(printButton().disabled, true);
    await shortcut(); assert.equal(refreshes, 2);
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test("existing Correspondant bulletin screen routes specialized data to its real A4 panel", () => {
  const page = readFileSync(new URL("../src/app/admin/bulletins/page.tsx", import.meta.url), "utf8");
  assert.match(page, /bulletinRaw\?\.specialized\?\.engine === "specialized"/);
  assert.match(page, /previewOpen &&\s*specializedBulletins &&\s*typeof document !== "undefined"/);
  assert.match(page, /<SpecializedBulletinPanel[\s\S]*?data=\{specializedBulletins\}/);
  assert.match(page, /onPrint=\{async \(\) => \{ window\.print\(\); \}\}/);
  assert.match(page, /disabled=\{\(!items\.length && !specializedBulletins\) \|\| bulletinLoading\}/);
  assert.match(page, /!items\.length && !specializedBulletins && !bulletinLoading/);
  assert.match(page, /canConfigureBulletins && <div className="flex items-center justify-end gap-2">/);
});


test("a ready primary bulletin remains printable when another pupil is incomplete", async () => {
  const win = new Window({ url: "https://fixture.invalid" });
  const descriptors = new Map(["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"]
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window: win, document: win.document, navigator: win.navigator, IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const container = win.document.createElement("div"); win.document.body.append(container);
  const root = createRoot(container);
  try {
    const db = createPedagogicalFixture();
    const load = createFixtureRouteLoader(db, db.legacyAdminId);
    const response = await load("src/app/api/admin/grades/bulletin/route.ts").GET(
      new NextRequest("https://fixture.invalid/api/admin/grades/bulletin?class_id=33333333-3333-4333-8333-333333333333&from=2026-09-01&to=2026-12-15&academic_year=2026-2027"));
    const { specialized: data } = await response.json();
    const source = data.documents.find(row => row.programReadiness?.french === true);
    assert.ok(source, "fixture has a ready French pupil");
    const incomplete = {
      ...source, studentId: "another-incomplete-student", ready: false,
      document: { ...source.document, student: { ...source.document.student,
        id: "another-incomplete-student", lastName: "INCOMPLET" },
        french: { ...source.document.french, generalAverage: null } },
      programReadiness: { ...source.programReadiness, french: false },
      problemsByProgram: { french: ["included_subject_without_score"] },
    };
    let prints = 0;
    const Panel = load("src/components/bulletins/SpecializedBulletinPanel.tsx").default;
    await act(async () => root.render(React.createElement(Panel, {
      data: { ...data, programs: ["french"], documents: [source, incomplete] },
      onBack() {}, onPrint: async () => { prints++; },
    })));
    const btn = [...container.querySelectorAll("button")].find(b => b.textContent.includes("Imprimer"));
    assert.ok(btn); assert.equal(btn.disabled, false);
    assert.match(btn.textContent, /Imprimer 1 bulletin prêt/);
    assert.match(container.textContent, /1 en attente/);
    assert.equal(container.querySelectorAll(".specialized-document").length, 2);
    assert.equal(container.querySelectorAll(".specialized-print-excluded").length, 1);
    assert.equal(container.querySelectorAll(".specialized-last-printable").length, 1);
    assert.match(container.textContent, /BROUILLON · NON VALIDÉ/);
    const summary = container.querySelector("summary");
    assert.match(summary?.textContent || "", /non imprimables/);
    assert.match(container.textContent, /Notes publiées manquantes/);
    await act(async () => btn.click());
    assert.equal(prints, 1, "print action remains available for the ready pupil");
  } finally {
    await act(async () => root.unmount());
    await win.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
