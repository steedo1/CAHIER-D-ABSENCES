// Run: node --test test/general-statistics-print.test.mjs
// Requires Playwright with Chromium (or STATISTICS_CHROMIUM_EXECUTABLE).
// Fixtures use synthetic records and never contact Supabase.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startStatisticsFixture } from "./general-statistics-print-server.mjs";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch (error) {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
  playwright = require(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright"));
}
const { PDFParse } = require("pdf-parse");
const allColumns = ["N°", "Matricule", "Nom et prénoms", "Classe", "Sexe", "Âge", "Régime", "Affectation", "Bourse", "LV2"];
const scenarios = [
  { name: "01-none", selections: {}, title: "LISTE GÉNÉRALE DES ÉLÈVES", criteria: "Tous les élèves", count: 24, columns: allColumns },
  { name: "02-girls", selections: { Sexe: "F" }, title: "LISTE DES FILLES", criteria: "Filles", count: 12, columns: allColumns.filter(x => x !== "Sexe") },
  { name: "03-boarders", selections: { Régime: "yes" }, title: "LISTE DES ÉLÈVES INTERNES", criteria: "Interne", count: 12, columns: allColumns.filter(x => x !== "Régime") },
  { name: "04-class", selections: { Classe: "c1" }, title: "LISTE DES ÉLÈVES — CLASSE 1A", criteria: "1A", count: 8, columns: allColumns.filter(x => x !== "Classe") },
  { name: "05-three", selections: { Sexe: "F", Régime: "yes", Affectation: "yes" }, title: "LISTE DES FILLES INTERNES AFFECTÉES", criteria: "Interne · Affecté · Filles", count: 3, columns: ["N°", "Matricule", "Nom et prénoms", "Classe", "Âge", "Bourse", "LV2"] },
  { name: "06-four", selections: { Classe: "c1", Régime: "yes", Affectation: "no", Sexe: "M" }, title: "STATISTIQUES GÉNÉRALES", criteria: "1A · Interne · Non affecté · Garçons", count: 1, columns: ["N°", "Matricule", "Nom et prénoms", "Âge", "Bourse", "LV2"] },
  { name: "07-all", selections: { Niveau: "1re A", Classe: "c1", Régime: "yes", Affectation: "no", Bourse: "yes", Sexe: "M", LV2: "espagnol" }, ages: ["12", "18"], title: "STATISTIQUES GÉNÉRALES", criteria: "Niveau : 1re A · 1A · Interne · Non affecté · Boursier · Garçons · Espagnol · 12–18 ans", count: 1, columns: ["N°", "Matricule", "Nom et prénoms", "Âge"] },
  { name: "08-long", query: "?long", selections: {}, title: "LISTE GÉNÉRALE DES ÉLÈVES", criteria: "Tous les élèves", count: 336, columns: allColumns, multipage: true },
  { name: "09-level-multiple", selections: { Niveau: "1re A" }, title: "LISTE DES ÉLÈVES — NIVEAU 1re A", criteria: "Niveau : 1re A", count: 16, columns: allColumns },
  { name: "10-level-single", selections: { Niveau: "3e" }, title: "LISTE DES ÉLÈVES — NIVEAU 3e", criteria: "Niveau : 3e", count: 8, columns: allColumns.filter(x => x !== "Classe") },
  { name: "11-exact-age", selections: {}, ages: ["15", "15"], title: "LISTE DES ÉLÈVES ÂGÉS DE 15 ANS", criteria: "15–15 ans", count: 24, columns: allColumns.filter(x => x !== "Âge") },
  { name: "12-general", query: "?general", selections: {}, title: "LISTE GÉNÉRALE DES ÉLÈVES", criteria: "Tous les élèves", count: 24, columns: allColumns, general: true },
  { name: "13-unknown-class", query: "?unknown", selections: {}, title: "LISTE GÉNÉRALE DES ÉLÈVES", criteria: "Tous les élèves", count: 24, columns: allColumns },
  { name: "14-single-class", query: "?single", selections: {}, title: "LISTE GÉNÉRALE DES ÉLÈVES", criteria: "Tous les élèves", count: 8, columns: allColumns.filter(x => x !== "Classe") },
];
test("Statistics: actual filtered UI, print layout and PDF", async (t) => {
  const { server, url } = await startStatisticsFixture();
  const browser = await playwright.chromium.launch({ headless: true,
    executablePath: process.env.STATISTICS_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--no-zygote", "--disable-gpu"] });
  const output = process.env.STATISTICS_PRINT_OUTPUT;
  if (output) await mkdir(output, { recursive: true });
  try {
    for (const scenario of scenarios) await t.test(scenario.name, async () => {
      const page = await browser.newPage({ viewport: { width: 1062, height: 730 } });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        await page.goto(url + (scenario.query || ""));
        await page.waitForSelector(".stats-print-sheet", { state: "attached" });
        for (const [label, value] of Object.entries(scenario.selections)) await page.getByLabel(label).selectOption(value);
        if (scenario.ages) {
          await page.getByText("Âge min", { exact: true }).locator("..").locator("input").fill(scenario.ages[0]);
          await page.getByText("Âge max", { exact: true }).locator("..").locator("input").fill(scenario.ages[1]);
        }
        assert.equal(await page.locator(".stats-list-title").textContent(), scenario.title);
        assert.equal(await page.locator(".stats-criteria-line").textContent(), `Critères : ${scenario.criteria}Effectif : ${scenario.count} élève${scenario.count > 1 ? "s" : ""}`);
        assert.equal(await page.locator(".stats-print-sheet tbody tr").count(), scenario.count);
        assert.deepEqual(await page.locator(".stats-print-sheet th").allTextContents(), scenario.columns);
        assert.equal(await page.locator("#root table th").count(), 10, "screen keeps the complete table");
        assert.equal(await page.locator("#root table tbody tr").count(), scenario.count);
        assert.equal(await page.locator(".stats-print-sheet").isVisible(), false, "print sheet hidden on screen");
        await page.emulateMedia({ media: "print" });
        assert.equal(await page.locator("#root").isVisible(), false, "admin layout does not occupy printed pages");
        const geometry = await page.evaluate(() => {
          const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
          return { sheet: box(".stats-print-sheet"), national: box(".stats-national-header"), header: box(".stats-official-header"), title: box(".stats-list-title"), criteria: box(".stats-criteria-line"), table: box(".stats-print-sheet table"), school: box(".stats-school-block"), right: box(".stats-right-meta"), width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth };
        });
        assert.ok(Math.abs(geometry.national.x + geometry.national.width / 2 - geometry.width / 2) < 1, "official header centered on the printable width");
        assert.ok(Math.abs(geometry.title.x + geometry.title.width / 2 - geometry.width / 2) < 1, "title centered");
        assert.ok(geometry.header.y >= geometry.national.bottom);
        assert.ok(geometry.criteria.y >= geometry.title.bottom);
        assert.ok(geometry.table.y >= geometry.header.bottom);
        assert.ok(geometry.school.right < geometry.title.x && geometry.criteria.right < geometry.right.x, "header blocks do not overlap");
        assert.ok(geometry.scroll <= geometry.width, "no horizontal overflow");
        const ministry = await page.locator(".stats-ministry").innerText();
        assert.ok(ministry.includes("ÉDUCATION NATIONALE ET DE L’ALPHABÉTISATION"));
        assert.equal(ministry.includes("ENSEIGNEMENT TECHNIQUE"), !scenario.general);
        assert.equal(await page.locator(".stats-ministry > div").count(), scenario.general ? 1 : 2);
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        if (output) await writeFile(join(output, `${scenario.name}.pdf`), pdf);
        const parser = new PDFParse({ data: pdf });
        const { pages } = await parser.getText();
        await parser.destroy();
        assert.ok(scenario.multipage ? pages.length > 1 : pages.length === 1, `clean pagination: ${pages.length} pages`);
        for (const pdfPage of pages) {
          assert.ok(pdfPage.text.includes("MATRICULE"), "table header repeats on every page");
          assert.ok(pdfPage.text.includes("ÉLÈVE"), "no blank or footer-only page");
          assert.ok(pdfPage.text.includes("Mon Cahier"), "brand footer on every page");
          assert.equal(pdfPage.text.includes("Navigation à masquer"), false);
        }
        const pdfText = pages.map(p => p.text).join("\n");
        const compact = value => value.replace(/\s+/g, " ").trim();
        assert.ok(compact(pdfText).includes(compact(scenario.title.toUpperCase())), "PDF contains the actual title");
        assert.ok(compact(pdfText).includes(`Critères : ${scenario.criteria}`), "PDF contains all criteria");
        assert.ok(compact(pdfText).includes(`Effectif : ${scenario.count}`), "PDF contains the filtered count");
        assert.ok(compact(pdfText).includes("ÉDUCATION NATIONALE ET DE L’ALPHABÉTISATION"), "PDF contains the corrected official header");
        assert.equal((pdfText.match(/ÉLÈVE \d{4}/g) || []).length, scenario.count, "all filtered rows printed exactly once");
        if (output) {
          await writeFile(join(output, `${scenario.name}.json`), JSON.stringify({ ...scenario, pages: pages.length, geometry }, null, 2));
        }
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test("changing level clears the stale class; reset restores all filters", async () => {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      try {
        await page.goto(url);
        await page.waitForSelector(".stats-print-sheet", { state: "attached" });
        await page.getByLabel("Classe").selectOption("c1");
        await page.getByLabel("Niveau").selectOption("3e");
        assert.equal(await page.getByLabel("Classe").inputValue(), "all");
        assert.deepEqual(await page.getByLabel("Classe").locator("option").allTextContents(), ["Toutes", "3e1"]);
        await page.getByLabel("Sexe").selectOption("F");
        await page.getByRole("button", { name: "Réinitialiser" }).click();
        assert.equal(await page.locator(".stats-list-title").textContent(), "LISTE GÉNÉRALE DES ÉLÈVES");
        assert.equal(await page.locator(".stats-print-sheet tbody tr").count(), 24);
        assert.deepEqual(await page.locator(".stats-print-sheet th").allTextContents(), allColumns);
      } finally { await page.close(); }
    });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
