import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { startClassListFixture } from "./class-list-print-server.mjs";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright")); }
const { PDFParse } = require("pdf-parse");

test("Arabic CP1 and secondary class lists print bilingual labels and retain Arabic spelling", async t => {
  const { server, url } = await startClassListFixture();
  const browser = await playwright.chromium.launch({
    headless: true, executablePath: process.env.CLASS_LIST_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--no-zygote", "--disable-gpu"],
  }).catch(async error => { await new Promise(resolve => server.close(resolve)); throw error; });
  try {
    for (const isPrimary of [true, false]) await t.test(isPrimary ? "CP1 Arabic" : "6e Arabic", async () => {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${url}?arabic=1&count=${isPrimary ? 8 : 6}${isPrimary ? "&primary=1&level=CP1" : ""}`);
      const portalButton = page.getByRole("button", { name: "Liste de classe", exact: true });
      await portalButton.waitFor();
      assert.match(await page.locator(".list-title").first().innerText(), /قائمة التلاميذ/);
      assert.match(await page.locator(".roster-table thead").first().innerText(), /الاسم واللقب/);
      assert.match(await page.locator(".roster-table tbody .col-name").first().innerText(), /محمد تراوري/);
      assert.match(await page.locator(".roster-table tbody .col-name").nth(2).innerText(), /ÉLÈVE002/);
      assert.equal(await page.locator(".roster-table tbody .col-name").count(), isPrimary ? 8 : 6);
      if (isPrimary) assert.match(await page.locator(".roster-table thead").first().innerText(), /القراءة/);
      assert.equal(await page.getByRole("button", { name: /Noms en arabe/ }).count(), 1);

      for (const [mode, heading] of [
        ["Liste provisoire", /القائمة الأولية للتلاميذ/],
        ["Liste de classe", /قائمة التلاميذ/],
      ]) {
        await page.emulateMedia({ media: "screen" });
        const initialCalls = await page.evaluate(() => window.__printCalls);
        await page.getByRole("button", { name: mode, exact: true }).click();
        await page.waitForFunction(expected => window.__printCalls > expected, initialCalls);
        await page.emulateMedia({ media: "print" });
        assert.match(await page.locator(".list-title").first().innerText(), heading,
          "Arabic print title survives the enhancer");
        assert.equal((await page.locator(".roster-table tbody .col-name").first().innerText()).trim(),
          "محمد تراوري", "print enhancer must not replace the Arabic spelling with the French name");
        assert.match(await page.locator(".roster-table tbody .col-name").nth(2).innerText(),
          /ÉLÈVE002/, "untranslated names must still show the French original");
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const parser = new PDFParse({ data: pdf });
        const { pages } = await parser.getText(); await parser.destroy();
        assert.ok(pages.length >= 1 && pages.length <= 2, "no extra blank PDF sheets");
        assert.ok(pdf.byteLength > 3000, "nonempty PDF generated");
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
