// Real page + real buttons; synthetic records, no API/database access.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startClassListFixture } from "./class-list-print-server.mjs";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright")); }
const { PDFParse } = require("pdf-parse");
const output = process.env.CLASS_LIST_PRINT_OUTPUT;
test("listes provisoires et définitives : nom et titre de chaque enseignement visibles sur chaque page PDF", async () => {
  const { server, url } = await startClassListFixture();
  const browser = await playwright.chromium.launch({ headless: true,
    executablePath: process.env.CLASS_LIST_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--no-zygote", "--disable-gpu"] }).catch(async error => {
    await new Promise(resolve => server.close(resolve)); throw error;
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    for (const track of ["french", "arabic", "mixed"]) {
      const name = track === "french" ? "Responsable Français Démonstration"
        : track === "arabic" ? "Responsable Arabe Démonstration" : "Administration Générale Démonstration";
      const title = track === "mixed" ? "Titre général configuré" : "Directeur des études";
      await page.emulateMedia({ media: "screen" });
      await page.goto(`${url}?teaching=${track}&count=31${track === "arabic" ? "" : "&primary=1&level=CM1"}`);
      await page.getByRole("button", { name: "Liste de classe", exact: true }).waitFor();
      for (const mode of ["Liste provisoire", "Liste de classe"]) {
        await page.emulateMedia({ media: "screen" });
        const calls = await page.evaluate(() => window.__printCalls);
        await page.getByRole("button", { name: mode, exact: true }).click();
        await page.waitForFunction(expected => window.__printCalls === expected, calls + 1);
        await page.emulateMedia({ media: "print" });
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const parser = new PDFParse({ data: pdf });
        const { pages } = await parser.getText(); await parser.destroy();
        assert.equal(pages.length, 2, "31 élèves sans page supplémentaire");
        for (const sheet of pages) {
          const text = sheet.text.replace(/\s+/g, " ");
          assert.ok(text.includes(title), text);
          assert.ok(text.includes(name), text);
          assert.doesNotMatch(text, /Nom du directeur non renseigné|KESSIE DÉSIRÉ OLIVIER/);
          if (track !== "mixed") assert.doesNotMatch(text, /Administration Générale Démonstration/);
          if (track !== "french") assert.doesNotMatch(text, /Responsable Français Démonstration/);
          if (track !== "arabic") assert.doesNotMatch(text, /Responsable Arabe Démonstration/);
        }
        if (output) {
          await mkdir(output, { recursive: true });
          await writeFile(join(output, `direction-${track}-${mode === "Liste provisoire" ? "provisional" : "class"}.pdf`), pdf);
        }
        await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
test("Class list: four notes, readable cells, watermark and no blank pages", async (t) => {
  const { server, url } = await startClassListFixture();
  const browser = await playwright.chromium.launch({ headless: true,
    executablePath: process.env.CLASS_LIST_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--no-zygote", "--disable-gpu"] }).catch(async error => {
    await new Promise(resolve => server.close(resolve)); throw error;
  });
  if (output) await mkdir(output, { recursive: true });
  try {
    for (const scenario of [
      { count: 0, pages: 1 }, { count: 6, pages: 1 }, { count: 25, pages: 1 },
      { count: 30, pages: 1 }, { count: 31, pages: 2 }, { count: 50, pages: 2 }, { count: 60, pages: 2 }, { count: 90, pages: 3 },
      { count: 25, pages: 1, long: true }, { count: 6, pages: 1, noLogo: true },
    ]) await t.test(JSON.stringify(scenario), async () => {
      const page = await browser.newPage({ viewport: { width: 1050, height: 800 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const query = new URLSearchParams(Object.entries(scenario).map(([k,v]) => [k,String(v)]));
      await page.goto(`${url}?${query}`);
      await page.getByRole("button", { name: "Liste provisoire", exact: true }).waitFor();
      for (const mode of ["Liste provisoire", "Liste de classe"]) {
        await page.emulateMedia({ media: "screen" });
        const calls = await page.evaluate(() => window.__printCalls);
        await page.getByRole("button", { name: mode, exact: true }).click();
        await page.waitForFunction(expected => window.__printCalls === expected, calls + 1);
        await page.emulateMedia({ media: "print" });
        const sheets = await page.locator(".class-list-sheet").count();
        assert.equal(sheets, scenario.pages);
        const geometry = await page.evaluate(() => {
          const overflow = [...document.querySelectorAll(".roster-table th, .roster-table td")]
            .filter(cell => cell.scrollWidth > cell.clientWidth + 1).map(cell => cell.textContent);
          const watermarks = [...document.querySelectorAll(".class-list-roster-region")].map(region => {
            const logo = region.querySelector(".class-list-watermark");
            if (!logo) return true;
            const r = region.getBoundingClientRect(), l = logo.getBoundingClientRect();
            return l.top >= r.top - 1 && l.bottom <= r.bottom + 1;
          });
          const nameLines = [...document.querySelectorAll("tbody .col-name")].map(cell => {
            const range = document.createRange(); range.selectNodeContents(cell);
            return range.getClientRects().length;
          });
          const horizontalOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
          return { overflow, watermarks, nameLines, horizontalOverflow };
        });
        assert.ok(geometry.nameLines.every(lines => lines === 1), "names always occupy exactly one line");
        assert.equal(geometry.horizontalOverflow, false, "table remains inside the page");
        assert.deepEqual(geometry.overflow, [], "headers, dates and complete names fit their cells");
        assert.ok(geometry.watermarks.every(Boolean), "logo stays inside each names table");
        for (const headers of await page.locator(".roster-table").evaluateAll(tables => tables.map(table => [...table.querySelectorAll("th")].map(th => th.textContent)))) {
          assert.equal(headers.length, 11);
          assert.deepEqual(headers.slice(-4), ["Note 1", "Note 2", "Note 3", "Note 4"]);
        }
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const parser = new PDFParse({ data: pdf });
        const { pages } = await parser.getText(); await parser.destroy();
        assert.equal(pages.length, scenario.pages, "no extra blank or footer-only page");
        for (const [index, pdfPage] of pages.entries()) {
          assert.ok(pdfPage.text.includes(mode.toUpperCase()), "title repeated on every page");
          assert.ok(pdfPage.text.includes(`Page ${index + 1} / ${pages.length}`));
          assert.equal(pdfPage.text.includes("Navigation à masquer"), false);
          assert.ok(scenario.count === 0 ? pdfPage.text.includes("Aucun élève") : /ÉLÈVE\d{3}/.test(pdfPage.text));
        }
        const text = pages.map(p => p.text).join("\n");
        assert.equal((text.match(/ÉLÈVE\d{3}/g) || []).length, scenario.count, "all names printed exactly once");
        assert.equal((text.match(/06\/12\/2011/g) || []).length, scenario.count, "dates stay intact");
        assert.equal(text.includes("Note 5"), false);
        assert.equal(text.includes("Note 6"), false);
        if (output) await writeFile(join(output, `${scenario.count}${scenario.long ? '-long' : ''}${scenario.noLogo ? '-no-logo' : ''}-${mode === "Liste provisoire" ? 'provisional' : 'class'}.pdf`), pdf);
        await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
        assert.ok((await page.locator(".list-title").allTextContents()).every(title => title.startsWith("LISTE DE CLASSE")));
      }
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
