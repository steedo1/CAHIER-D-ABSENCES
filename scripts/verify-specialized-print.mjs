import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server.js";
import { createFixtureRouteLoader } from "../test/helpers/multicycle-fixture.mjs";
import { createPedagogicalFixture } from "../test/helpers/pedagogical-fixture.mjs";

const output = path.resolve("../verification/specialized-print-20261017");
mkdirSync(output, { recursive: true });
const browser = "C:/Program Files/Google/Chrome/Application/chrome.exe";
assert.ok(existsSync(browser));
const runtimeRequire = createRequire(process.env.MULTICYCLE_PLAYWRIGHT_PACKAGE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json"));
const { chromium } = runtimeRequire("playwright");
const css = readFileSync("src/components/bulletins/FrancoArabicBulletin.module.css", "utf8") + readFileSync("src/app/admin/bulletins/modeles/print.css", "utf8");
for (const scenario of [{ name: "primary-french", bilingual: false, long: false, variant: "ordinary" },
  { name: "bilingual-combined", bilingual: true, long: false, variant: "combined" },
  { name: "bilingual-long", bilingual: true, long: true, variant: "combined" }]) {
  const db = createPedagogicalFixture({ bilingual: scenario.bilingual });
  if (scenario.bilingual) db.tables.institution_subjects[1].custom_name = "اللغة العربية";
  if (scenario.long) for (let index = 0; index < 28; index++) {
    for (let sourceIndex = 0; sourceIndex < 2; sourceIndex++) {
      const source = db.tables.institution_subjects[sourceIndex], id = randomUUID(), evaluation = db.tables.grade_evaluations[sourceIndex];
      const evaluationId = randomUUID();
      db.tables.institution_subjects.push({ ...source, id: randomUUID(), subject_id: id, custom_name: sourceIndex ? `اللغة العربية ${index + 1}` : `Lecture et expression ${index + 1}` });
      db.tables.institution_subject_coeffs.push({ ...db.tables.institution_subject_coeffs[sourceIndex], subject_id: id });
      db.tables.institution_level_subjects.push({ ...db.tables.institution_level_subjects[sourceIndex], id: randomUUID(), subject_id: id });
      db.tables.grade_evaluations.push({ ...evaluation, id: evaluationId, subject_id: id });
      db.tables.institutions[0].settings_json.school_cycles_v1.subjectTracksByCycle.primary[id] = [sourceIndex ? "arabic" : "french"];
      for (let student = 0; student < 2; student++) {
        const score = db.tables.grade_published_scores.find(row => row.student_id === `student-${student}` && row.evaluation_id === evaluation.id);
        db.tables.grade_published_scores.push({ ...score, id: randomUUID(), evaluation_id: evaluationId, subject_id: id });
      }
    }
  }
  const load = createFixtureRouteLoader(db, db.legacyAdminId);
  const response = await load("src/app/api/admin/grades/bulletin/route.ts").GET(new NextRequest("https://example.invalid/api/admin/grades/bulletin?class_id=33333333-3333-4333-8333-333333333333&from=2026-09-01&to=2026-12-15&academic_year=2026-2027"));
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
  assert.ok(data.specialized.documents.every(row => row.ready));
  const Component = load("src/components/bulletins/FrancoArabicBulletin.tsx").default;
  const pages = data.specialized.documents.map(row => renderToStaticMarkup(React.createElement(Component, {
    model: { ...row.document, sample: true }, variant: scenario.variant, printRoot: false,
  }))).join("\n");
  const html = path.join(output, `${scenario.name}.html`), pdf = path.join(output, `${scenario.name}.pdf`);
  writeFileSync(html, `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Contrôle d’impression — données synthétiques</title><style>${css}</style><body><main class="fa-report-print-root specialized-print-root">${pages}</main></body></html>`);
  const printBrowser = await chromium.launch({ executablePath: browser, headless: true, args: ["--disable-sync"] });
  try {
    const page = await printBrowser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true });
    await page.emulateMedia({ media: "screen" });
    await page.screenshot({ path: path.join(output, `${scenario.name}.png`), fullPage: true });
  } finally { await printBrowser.close(); }
  assert.ok(existsSync(pdf));
  writeFileSync(path.join(output, `${scenario.name}-data.json`), JSON.stringify(data.specialized, null, 2));
  process.stdout.write(`${scenario.name}: ${pdf}\n`);
}
