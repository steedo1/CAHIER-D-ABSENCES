// Check the actual class-list page and its browser PDF output, never real pupils.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { startClassListFixture } from "./class-list-print-server.mjs";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright")); }
const { PDFParse } = require("pdf-parse");
const browserOptions = {
  headless: true, executablePath: process.env.CLASS_LIST_CHROMIUM_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--no-zygote", "--disable-gpu"],
};

async function pdfDetails(pdf) {
  const parser = new PDFParse({ data: pdf });
  const { pages, text } = await parser.getText();
  await parser.destroy();
  const boxes = [...pdf.toString("latin1").matchAll(
    /\/MediaBox\s*\[\s*0(?:\.0+)?\s+0(?:\.0+)?\s+([\d.]+)\s+([\d.]+)\s*\]/g,
  )].map(([, w, h]) => ({ width: Number(w), height: Number(h) }));
  assert.ok(boxes.length >= pages.length, "Chromium must declare PDF page dimensions");
  return { pages, text, boxes };
}

test("48 primary students: French and EPC Arabic use two spacious A4 landscape sheets", async t => {
  const { server, url } = await startClassListFixture();
  const browser = await playwright.chromium.launch(browserOptions).catch(async err => {
    await new Promise(resolve => server.close(resolve)); throw err;
  });
  try {
    for (const teaching of ["french", "arabic"]) await t.test(teaching, async () => {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${url}?primary=1&level=CP1&count=48&long=1${teaching === "arabic" ? "&arabic=1&epcSubjects=1" : ""}`);
      await page.getByRole("button", { name: "Liste de classe", exact: true }).waitFor();
      for (const mode of ["Liste provisoire", "Liste de classe"]) {
        await page.emulateMedia({ media: "screen" });
        const before = await page.evaluate(() => window.__printCalls);
        await page.getByRole("button", { name: mode, exact: true }).click();
        await page.waitForFunction(prev => window.__printCalls > prev, before);
        await page.emulateMedia({ media: "print" });

        const sizes = await page.locator(".class-list-sheet").evaluateAll(sheets => sheets.map(sheet => ({
          rowCount: sheet.querySelectorAll("tbody tr").length,
          rowHeight: sheet.querySelector("tbody tr")?.getBoundingClientRect().height,
          subjects: sheet.querySelectorAll("thead th.col-note").length,
          rowsOverflow: [...sheet.querySelectorAll("tbody tr")].some(row =>
            row.querySelectorAll(".col-note").length === 0),
        })));
        assert.equal(sizes.length, 2, "exactly two print sheets");
        assert.deepEqual(sizes.map(s => s.rowCount), [24, 24]);
        assert.deepEqual(sizes.map(s => s.subjects),
          teaching === "arabic" ? [6,6] : [11,11]);
        assert.ok(sizes[0].rowHeight >= 22, "first sheet must allow handwriting");
        assert.ok(sizes[1].rowHeight >= 25, "second sheet uses available A4 height");
        assert.ok(sizes.every(s => !s.rowsOverflow));

        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const { pages, text, boxes } = await pdfDetails(pdf);
        assert.equal(pages.length, 2, "48 students must not split into three or blank pages");
        assert.ok(boxes.slice(0, 2).every(p => p.width > p.height &&
          Math.abs(p.width - 842) < 4 && Math.abs(p.height - 595) < 4),
          "printed paper must be A4 landscape, not Android's A4 portrait default");
        const names = text.match(/ÉLÈVE\d{3}/g) || [];
        assert.equal(names.length, teaching === "arabic" ? 46 : 48,
          "every printed pupil is present exactly once");
        if (teaching === "arabic") assert.ok(text.includes("تراوري"), "Arabic names remain visible");
        await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      }
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("secondary class list remains A4 portrait with four generic note columns", async () => {
  const { server, url } = await startClassListFixture();
  const browser = await playwright.chromium.launch(browserOptions).catch(async err => {
    await new Promise(resolve => server.close(resolve)); throw err;
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${url}?count=25`);
    await page.getByRole("button", { name: "Liste de classe", exact: true }).waitFor();
    await page.emulateMedia({ media: "print" });
    assert.deepEqual(await page.locator(".roster-table th.col-note").allTextContents(),
      ["Note 1", "Note 2", "Note 3", "Note 4"]);
    const { boxes, pages } = await pdfDetails(await page.pdf({ preferCSSPageSize: true }));
    assert.equal(pages.length, 1);
    assert.ok(boxes[0].height > boxes[0].width, "secondary must remain portrait");
    await page.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
