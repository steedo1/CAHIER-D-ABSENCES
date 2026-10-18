import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { startClassListFixture } from "./class-list-print-server.mjs";
import { startStatisticsFixture } from "./general-statistics-print-server.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { PDFParse } = require("pdf-parse");
const browserOptions = { headless: true, executablePath: process.env.CLASS_LIST_CHROMIUM_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--no-zygote", "--disable-gpu"] };

test("primary paper roster prints actual subjects and CM barèmes, all names, landscape A4 and no empty sheets", async t => {
  const { server, url } = await startClassListFixture();
  const browser = await chromium.launch(browserOptions).catch(async error => { await new Promise(resolve => server.close(resolve)); throw error; });
  try {
    for (const level of ["CP1", "CM1"]) await t.test(level, async () => {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${url}?primary=1&level=${level}&count=48&long=1`);
      await page.getByRole("button", { name: "Liste de classe", exact: true }).waitFor();
      await page.getByRole("button", { name: "Liste de classe", exact: true }).click();
      await page.waitForFunction(() => window.__printCalls === 1);
      await page.emulateMedia({ media: "print" });
      const headers = await page.locator(".roster-table").first().locator("th").allTextContents();
      assert.equal(headers.length, 18);
      assert.equal(headers.some(header => /^Note \d/.test(header)), false);
      assert.deepEqual(headers.slice(7).map(header => header.split("/")[0]), ["Lect.","Écr.","Dict.","Expr.","Expl.","Éveil","Maths","Chant","Dess.","EDHC","EPS"]);
      assert.match(headers[9], level === "CM1" ? /\/20/ : /\/10/);
      assert.match(headers[13], level === "CM1" ? /\/50/ : /\/10/);
      const overflow = await page.locator(".roster-table th, .roster-table td").evaluateAll(cells => cells
        .filter(cell => cell.scrollWidth > cell.clientWidth + 1).map(cell => cell.textContent));
      assert.deepEqual(overflow, [], "names and subject labels remain in their cells");
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      const parser = new PDFParse({ data: pdf }); const result = await parser.getText(); await parser.destroy();
      assert.equal(result.pages.length, 3, "48 pupils, 16 per landscape sheet, no extra page");
      assert.equal((result.text.match(/ÉLÈVE\d{3}/g) || []).length, 48);
      assert.ok(result.pages.every(p => /Page \d \/ 3/.test(p.text)));
      assert.deepEqual(errors, []);
      if (process.env.PRIMARY_PRINT_OUTPUT) {
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(process.env.PRIMARY_PRINT_OUTPUT, { recursive: true });
        await writeFile(`${process.env.PRIMARY_PRINT_OUTPUT}/${level}-list.pdf`, pdf);
        await page.screenshot({ path: `${process.env.PRIMARY_PRINT_OUTPUT}/${level}-list.png`, fullPage: true });
      }
      await page.close();
    });
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

test("statistics teaching filter shows the Arabic class and counts each pupil once", async () => {
  const { server, url } = await startStatisticsFixture();
  const browser = await chromium.launch(browserOptions).catch(async error => { await new Promise(resolve => server.close(resolve)); throw error; });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${url}?bilingual=1`);
    const track = page.getByLabel("Enseignement", { exact: true }); await track.waitFor();
    await track.selectOption("arabic");
    const classroom = page.getByLabel("Classe", { exact: true });
    await page.waitForFunction(() => [...document.querySelectorAll("select option")].some(option => option.value === "ar-c1"));
    assert.match((await classroom.locator("option").allTextContents()).join(" "), /1A — Arabe/);
    await classroom.selectOption("ar-c1");
    const rows = page.locator(".stats-print-sheet tbody tr");
    // The visible screen and the print portal share the same filtered records.
    const text = await page.locator("body").innerText();
    assert.match(text, /Enseignement arabe/);
    assert.equal(await rows.count(), 8, "the selected Arabic class prints 8 unique pupils");
    assert.equal(new Set(await rows.locator("td:nth-child(2)").allTextContents()).size, 8);
    assert.doesNotMatch((await classroom.locator("option").allTextContents()).join(" "), /Français/);
    await track.selectOption("french");
    await page.waitForFunction(() => [...document.querySelectorAll("select option")].some(option => option.textContent === "1A — Français"));
    assert.equal(await classroom.inputValue(), "all", "changing teaching resets the old class");
    assert.equal(await rows.count(), 24, "whole French teaching restores 24 unique pupils");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
