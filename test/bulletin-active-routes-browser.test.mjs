import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { PDFParse } from "pdf-parse";
import { bulletinRoutes, bulletinProps, renderBulletin } from "./helpers/bulletin-page-fixture.mjs";

test("both actual bulletin cards keep appreciations and effective totals visible on desktop, mobile and PDF", async () => {
  const utilities = await postcss([tailwind()]).process('@import "tailwindcss";', { from: path.resolve("src/app/bulletin-test.css") });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CLASS_LIST_CHROMIUM_EXECUTABLE || undefined, args: ["--no-sandbox", "--disable-gpu"] });
  const output = process.env.BULLETIN_PRINT_OUTPUT;
  if (output) mkdirSync(output, { recursive: true });
  try {
    for (const [index, route] of bulletinRoutes.entries()) {
      const source = readFileSync(route, "utf8");
      const css = source.match(/<style jsx global>\{`([\s\S]*?)`\}<\/style>/)?.[1];
      assert.ok(css, "use the page's own print and preview styles");
      const markup = renderBulletin(route, bulletinProps());
      const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${utilities.css}\n${css}</style></head><body><div class="bulletin-print-portal preview-overlay">${markup}</div></body></html>`;
      if (output) writeFileSync(`${output}/route-${index}.html`, html);
      for (const mobile of [false, true]) {
        const context = await browser.newContext({ viewport: mobile ? { width: 393, height: 851 } : { width: 1100, height: 1200 }, isMobile: mobile, hasTouch: mobile });
        // This is an isolated rendering test. No API, QR generation or production requests.
        await context.route("**/*", route => route.abort());
        const page = await context.newPage();
        await page.setContent(html);
        const appreciations = page.locator(".discipline-table .submatter-appreciation");
        assert.deepEqual((await appreciations.allTextContents()).map(s => s.trim()), ["Bien", "Faible", "Faible"]);
        for (const cell of await appreciations.all()) {
          assert.equal(await cell.isVisible(), true);
          assert.equal(await cell.evaluate(el => {
            const style = getComputedStyle(el), box = el.getBoundingClientRect();
            return style.visibility !== "hidden" && Number(style.opacity) > 0 && box.width > 10 && box.height > 0;
          }), true);
        }
        const values = (await page.locator(".totals-row td").allTextContents()).map(s => s.trim());
        assert.deepEqual(values.slice(2, 4), ["16", "193.00"]);
        assert.match(await page.locator("body").innerText(), /12[.,]06/);
        if (output) await page.screenshot({ path: `${output}/route-${index}-${mobile ? "mobile" : "desktop"}.png`, fullPage: true });
        if (!mobile) {
          await page.emulateMedia({ media: "print" });
          for (const cell of await appreciations.all()) assert.equal(await cell.isVisible(), true);
          const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
          if (output) writeFileSync(`${output}/route-${index}.pdf`, pdf);
          const parser = new PDFParse({ data: pdf });
          const result = await parser.getText(); await parser.destroy();
          assert.equal(result.pages.length, 1, "one complete A4 bulletin");
          assert.match(result.text, /Composition française[\s\S]*?Bien/);
          assert.match(result.text, /Expression orale[\s\S]*?Faible/);
          assert.match(result.text, /Orthographe-Grammaire[\s\S]*?Faible/);
          assert.match(result.text, /TOTAUX\s*:\s*16\s*193[.,]00/);
          assert.match(result.text, /12[.,]06/);
        }
        await context.close();
      }
    }
  } finally { await browser.close(); }
});
