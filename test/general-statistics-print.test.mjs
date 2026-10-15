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
const allColumns = ["N°", "Matricule", "Nom et prénoms", "Classe", "Sexe", "Âge", "Nationalité", "Régime", "Affectation", "Bourse", "LV2"];
const averageColumns = [...allColumns.slice(0, 4), "Moyenne /20", ...allColumns.slice(4)];
const scenarios = [
  { name: "01-none", selections: {}, title: "LISTE GÉNÉRALE DES ÉLÈVES", criteria: "Tous les élèves", count: 24, columns: allColumns },
  { name: "02-girls", selections: { Sexe: "F" }, title: "LISTE DES FILLES", criteria: "Filles", count: 12, columns: allColumns.filter(x => x !== "Sexe") },
  { name: "03-boarders", selections: { Régime: "yes" }, title: "LISTE DES ÉLÈVES INTERNES", criteria: "Interne", count: 12, columns: allColumns.filter(x => x !== "Régime") },
  { name: "04-class", selections: { Classe: "c1" }, title: "LISTE DES ÉLÈVES — CLASSE 1A", criteria: "1A", count: 8, columns: allColumns.filter(x => x !== "Classe") },
  { name: "05-three", selections: { Sexe: "F", Régime: "yes", Affectation: "yes" }, title: "LISTE DES FILLES INTERNES AFFECTÉES", criteria: "Interne · Affecté · Filles", count: 3, columns: ["N°", "Matricule", "Nom et prénoms", "Classe", "Âge", "Nationalité", "Bourse", "LV2"] },
  { name: "06-four", selections: { Classe: "c1", Régime: "yes", Affectation: "no", Sexe: "M" }, title: "STATISTIQUES GÉNÉRALES", criteria: "1A · Interne · Non affecté · Garçons", count: 1, columns: ["N°", "Matricule", "Nom et prénoms", "Âge", "Nationalité", "Bourse", "LV2"] },
  { name: "07-all", selections: { Niveau: "1re A", Classe: "c1", Régime: "yes", Affectation: "no", Bourse: "yes", Sexe: "M", LV2: "espagnol" }, ages: ["12", "18"], title: "STATISTIQUES GÉNÉRALES", criteria: "Niveau : 1re A · 1A · Interne · Non affecté · Boursier · Garçons · Espagnol · 12–18 ans", count: 1, columns: ["N°", "Matricule", "Nom et prénoms", "Âge", "Nationalité"] },
  { name: "08-long", query: "?long", selections: {}, title: "LISTE GÉNÉRALE DES ÉLÈVES", criteria: "Tous les élèves", count: 336, columns: allColumns, multipage: true },
  { name: "09-level-multiple", selections: { Niveau: "1re A" }, title: "LISTE DES ÉLÈVES — NIVEAU 1re A", criteria: "Niveau : 1re A", count: 16, columns: allColumns },
  { name: "10-level-single", selections: { Niveau: "3e" }, title: "LISTE DES ÉLÈVES — NIVEAU 3e", criteria: "Niveau : 3e", count: 8, columns: allColumns.filter(x => x !== "Classe") },
  { name: "11-exact-age", selections: {}, ages: ["15", "15"], title: "LISTE DES ÉLÈVES ÂGÉS DE 15 ANS", criteria: "15–15 ans", count: 24, columns: allColumns.filter(x => x !== "Âge") },
  { name: "12-general", query: "?general", selections: {}, title: "LISTE GÉNÉRALE DES ÉLÈVES", criteria: "Tous les élèves", count: 24, columns: allColumns, general: true },
  { name: "13-unknown-class", query: "?unknown", selections: {}, title: "LISTE GÉNÉRALE DES ÉLÈVES", criteria: "Tous les élèves", count: 24, columns: allColumns },
  { name: "14-single-class", query: "?single", selections: {}, title: "LISTE GÉNÉRALE DES ÉLÈVES", criteria: "Tous les élèves", count: 8, columns: allColumns.filter(x => x !== "Classe") },
  { name: "15-nationality", selections: { Nationalité: "Malienne" }, title: "LISTE DES ÉLÈVES — NATIONALITÉ MALIENNE", criteria: "Nationalité : Malienne", count: 6, columns: allColumns.filter(x => x !== "Nationalité") },
  { name: "16-nationality-missing", selections: { Nationalité: "Non renseignée" }, title: "LISTE DES ÉLÈVES — NATIONALITÉ NON RENSEIGNÉE", criteria: "Nationalité : Non renseignée", count: 6, columns: allColumns.filter(x => x !== "Nationalité") },
  { name: "17-term-general", selections: { "Période des moyennes": "t1" }, title: "LISTE DES ÉLÈVES — TRIMESTRE 1", criteria: "Trimestre 1 · Moyenne générale", count: 24, columns: averageColumns },
  { name: "18-term-bounds", selections: { "Période des moyennes": "t1" }, averages: ["10", "15"], title: "LISTE DES ÉLÈVES — TRIMESTRE 1 — MOYENNE DE 10 À 15/20", criteria: "Trimestre 1 · Moyenne générale · Moyenne : 10–15/20", count: 12, columns: averageColumns },
  { name: "19-term-subject", selections: { "Période des moyennes": "t1", Discipline: "math" }, averages: ["10", "15"], title: "LISTE DES ÉLÈVES — TRIMESTRE 1 — MATHÉMATIQUES — MOYENNE DE 10 À 15/20", criteria: "Trimestre 1 · Mathématiques · Moyenne : 10–15/20", count: 8, columns: averageColumns },
  { name: "20-annual-general", selections: { "Période des moyennes": "annual" }, averages: ["10", "20"], title: "LISTE DES ÉLÈVES — ANNÉE SCOLAIRE ENTIÈRE — MOYENNE DE 10 À 20/20", criteria: "Année scolaire entière · Moyenne générale · Moyenne : 10–20/20", count: 20, columns: averageColumns },
  { name: "21-annual-subject", selections: { "Période des moyennes": "annual", Discipline: "math" }, averages: ["10", ""], title: "LISTE DES ÉLÈVES — ANNÉE SCOLAIRE ENTIÈRE — MATHÉMATIQUES — MOYENNE ≥ 10/20", criteria: "Année scolaire entière · Mathématiques · Moyenne ≥ 10/20", count: 12, columns: averageColumns },
  { name: "22-zero-average", selections: { "Période des moyennes": "t1" }, averages: ["0", "0"], title: "LISTE DES ÉLÈVES — TRIMESTRE 1 — MOYENNE DE 0 À 0/20", criteria: "Trimestre 1 · Moyenne générale · Moyenne : 0–0/20", count: 4, columns: averageColumns },
  { name: "23-decimal-average", selections: { "Période des moyennes": "t1" }, averages: ["12,5", "12,5"], title: "LISTE DES ÉLÈVES — TRIMESTRE 1 — MOYENNE DE 12,5 À 12,5/20", criteria: "Trimestre 1 · Moyenne générale · Moyenne : 12,5–12,5/20", count: 4, columns: averageColumns },
  { name: "24-class-subject", selections: { Classe: "c1", "Période des moyennes": "t1", Discipline: "math" }, averages: ["10", "15"], title: "STATISTIQUES GÉNÉRALES", criteria: "1A · Trimestre 1 · Mathématiques · Moyenne : 10–15/20", count: 2, columns: averageColumns.filter(x => x !== "Classe") },
];
test("Statistics: actual filtered UI, print layout and PDF", async (t) => {
  const { server, url } = await startStatisticsFixture();
  let browser;
  const output = process.env.STATISTICS_PRINT_OUTPUT;
  if (output) await mkdir(output, { recursive: true });
  try {
    browser = await playwright.chromium.launch({ headless: true,
      executablePath: process.env.STATISTICS_CHROMIUM_EXECUTABLE || undefined,
      args: ["--no-sandbox", "--no-zygote", "--disable-gpu"] });
    for (const scenario of scenarios) await t.test(scenario.name, async () => {
      const page = await browser.newPage({ viewport: { width: 1062, height: 730 } });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        await page.goto(url + (scenario.query || ""));
        await page.waitForSelector(".stats-print-sheet", { state: "attached" });
        for (const [label, value] of Object.entries(scenario.selections)) await page.getByLabel(label).selectOption(value);
        const academic = Boolean(scenario.selections["Période des moyennes"]);
        if (academic) await page.getByLabel("Discipline", { exact: true }).selectOption(scenario.selections.Discipline || "all");
        if (scenario.averages) {
          await page.getByLabel("Moyenne min", { exact: true }).fill(scenario.averages[0]);
          await page.getByLabel("Moyenne max", { exact: true }).fill(scenario.averages[1]);
        }
        if (scenario.ages) {
          await page.getByText("Âge min", { exact: true }).locator("..").locator("input").fill(scenario.ages[0]);
          await page.getByText("Âge max", { exact: true }).locator("..").locator("input").fill(scenario.ages[1]);
        }
        await page.waitForFunction(({ title, count }) => document.querySelector(".stats-list-title")?.textContent === title &&
          document.querySelectorAll(".stats-print-sheet tbody tr").length === count, scenario);
        assert.equal(await page.locator(".stats-list-title").textContent(), scenario.title);
        assert.equal(await page.locator(".stats-criteria-line").textContent(), `Critères : ${scenario.criteria}Effectif : ${scenario.count} élève${scenario.count > 1 ? "s" : ""}`);
        assert.equal(await page.locator(".stats-print-sheet tbody tr").count(), scenario.count);
        assert.deepEqual(await page.locator(".stats-print-sheet th").allTextContents(), scenario.columns);
        assert.equal(await page.locator("#root table th").count(), academic ? 12 : 11, "screen keeps the complete table");
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
        // PDF readers may interleave text from the separate right-hand header
        // between wrapped central lines. DOM order is checked above; every
        // complete criterion must also remain readable in the exported PDF.
        for (const criterion of scenario.criteria.split(" · ")) {
          assert.ok(compact(pdfText).includes(criterion), `PDF contains criterion: ${criterion}`);
        }
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
    await t.test("academic filters use cached bulletins and resetting restores the original table", async () => {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      try {
        await page.goto(url); await page.waitForSelector(".stats-print-sheet", { state: "attached" });
        assert.equal(await page.evaluate(() => window.__statisticsBulletinRequests.length), 0);
        await page.getByLabel("Période des moyennes").selectOption("t1");
        await page.getByLabel("Discipline", { exact: true }).selectOption("math");
        await page.getByLabel("Moyenne min", { exact: true }).fill("10");
        await page.getByLabel("Moyenne max", { exact: true }).fill("15");
        await page.waitForFunction(() => document.querySelectorAll(".stats-print-sheet tbody tr").length === 8);
        assert.equal(await page.evaluate(() => window.__statisticsBulletinRequests.length), 3);
        await page.getByText("Âge min", { exact: true }).locator("..").locator("input").fill("90");
        await page.waitForFunction(() => document.querySelectorAll(".stats-print-sheet tbody tr").length === 0);
        assert.equal(await page.getByLabel("Discipline", { exact: true }).inputValue(), "math", "an empty demographic scope must not silently select the general average");
        await page.getByText("Âge min", { exact: true }).locator("..").locator("input").fill("");
        await page.getByLabel("Discipline", { exact: true }).selectOption("math");
        await page.waitForFunction(() => document.querySelectorAll(".stats-print-sheet tbody tr").length === 8);
        await page.getByLabel("Discipline", { exact: true }).selectOption("all");
        await page.waitForFunction(() => document.querySelectorAll(".stats-print-sheet tbody tr").length === 12);
        assert.equal(await page.evaluate(() => window.__statisticsBulletinRequests.length), 3);
        await page.getByLabel("Période des moyennes").selectOption("annual");
        await page.getByLabel("Discipline", { exact: true }).selectOption("math");
        await page.waitForFunction(() => document.querySelectorAll(".stats-print-sheet tbody tr").length === 8);
        assert.equal(await page.evaluate(() => window.__statisticsBulletinRequests.length), 9);
        await page.getByRole("button", { name: "Réinitialiser" }).click();
        assert.equal(await page.getByLabel("Période des moyennes").inputValue(), "");
        assert.equal(await page.getByLabel("Moyenne min", { exact: true }).inputValue(), "");
        assert.equal(await page.locator("#root table th").count(), 11);
        assert.equal(await page.locator(".stats-print-sheet tbody tr").count(), 24);
      } finally { await page.close(); }
    });
    await t.test("invalid bounds prevent printing and a retry recovers from a grade service failure", async () => {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      try {
        await page.goto(url + "?academic-failure"); await page.waitForSelector(".stats-print-sheet", { state: "attached" });
        await page.getByLabel("Période des moyennes").selectOption("t1");
        await page.getByRole("button", { name: "Réessayer les moyennes" }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Imprimer", exact: true }).isDisabled(), true);
        await page.evaluate(() => { window.__statisticsAcademicState.fail = false; });
        await page.getByRole("button", { name: "Réessayer les moyennes" }).click();
        await page.getByLabel("Discipline", { exact: true }).selectOption("all");
        await page.getByLabel("Moyenne min", { exact: true }).fill("21");
        await page.getByRole("alert").filter({ hasText: "entre 0 et 20" }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Imprimer", exact: true }).isDisabled(), true);
        await page.getByLabel("Moyenne min", { exact: true }).fill("15");
        await page.getByLabel("Moyenne max", { exact: true }).fill("10");
        await page.getByRole("alert").filter({ hasText: "dépasser" }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Imprimer", exact: true }).isDisabled(), true);
        await page.getByRole("button", { name: "Réinitialiser" }).click();
        assert.equal(await page.locator(".stats-print-sheet tbody tr").count(), 24);
      } finally { await page.close(); }
    });
    await t.test("a late quarterly response cannot replace the newly selected period", async () => {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      try {
        await page.goto(url + "?slow"); await page.waitForSelector(".stats-print-sheet", { state: "attached" });
        await page.getByLabel("Période des moyennes").selectOption("t1");
        await page.getByLabel("Période des moyennes").selectOption("t2");
        await page.getByLabel("Discipline", { exact: true }).selectOption("all");
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.match(await page.locator(".stats-criteria-line").textContent(), /Trimestre 2/);
        assert.equal(await page.locator("#root table tbody tr").first().locator("td").nth(4).textContent(), "5,00");
      } finally { await page.close(); }
    });
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
