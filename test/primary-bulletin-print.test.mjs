import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import { CI_PRIMARY_FRENCH_REFERENCE, ciPrimaryFrenchDenominator } from "../src/lib/primary-french-reference-ci.ts";
const require = createRequire(import.meta.url), { chromium } = require("playwright"), { PDFParse } = require("pdf-parse");
const logo = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#06564c"/><text x="50" y="58" text-anchor="middle" fill="white" font-size="28">EPC</text></svg>');
const names = ["Coran (récitation et mémorisation)","Langue arabe","Écriture et dictée","Expression orale","Expression écrite","Mathématiques","Lecture","Histoire","Géographie","Éducation islamique","Sciences","Poème"];
const css = readFileSync("src/components/bulletins/FrancoArabicBulletin.module.css", "utf8") + readFileSync("src/app/admin/bulletins/modeles/print.css", "utf8");
function model(index, annual = false) {
  const common = { cycle: "Primaire", level: "CM1", className: "CM1", year: "2026-2027", period: "Évaluation de novembre",
    denominator: 10, primarySubjectScores: true, generalAverage: 8, rank: index+1, classSize: 48,
    ...(annual ? { primaryAnnual: { ordinary: ["Composition de décembre", "Composition de février", "Composition d’avril"].map(label => ({ label, average: 7 })),
      ordinaryAverage: 7, passageAverage: 8, annualAverage: 7.67, decision: "ADMIS" } } : {}),
    teacherName: "INSTITUTEUR DE DÉMONSTRATION", directorName: "DIRECTEUR DE DÉMONSTRATION" };
  return { school: { name: "EPC CENTRE D’ÉTUDE ISLAMIQUE DE DIMBOKRO", code: "E020684", logoUrl: logo, isFrancoArabic: true,
    phone: "07 00 00 00 00", email: "ecole@example.invalid", address: "Quartier de démonstration, Dimbokro",
    countryName: "République de Côte d’Ivoire", countryMotto: "Union – Discipline – Travail",
    ministryName: "MINISTÈRE DE L’ÉDUCATION NATIONALE ET DE L’ALPHABÉTISATION", regionalDirection: "DRENA DE DIMBOKRO",
    generalDirectorName: "ADMINISTRATEUR GÉNÉRAL DE DÉMONSTRATION", generalDirectorTitle: "Directeur général" },
    student: { id: `pupil-${index}`, lastName: "ÉLÈVE" + index, firstName: "Prénoms de démonstration", matricule: `TEST-${index}`,
      birthDate: "2015-10-08", birthPlace: "Dimbokro", photoUrl: logo },
    french: { ...common, track: "french", ciPrimaryFrench: true, subjects: CI_PRIMARY_FRENCH_REFERENCE.map(row => {
      const denominator = ciPrimaryFrenchDenominator("CM1", row.code);
      return { id: row.code, name: row.label, denominator, average: denominator*0.8, coefficient: null };
    }) },
    arabic: { ...common, track: "arabic", subjects: names.map((name,i) => ({ id: `arabic-${i}`, name, denominator: i%2?20:50,
      average: (i%2?20:50)*0.8, coefficient: null })) },
  };
}
test("primary bulletins print the school logo and real metadata on one A4 per pupil, including combined teachings", async t => {
  const load = createFixtureRouteLoader(createMulticycleFixture(), null);
  const Component = load("src/components/bulletins/FrancoArabicBulletin.tsx").default;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CLASS_LIST_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--disable-gpu", "--no-zygote"] });
  try {
    for (const annual of [false, true]) for (const variant of ["french","arabic","combined"]) await t.test(`${variant}${annual ? "-passage" : ""}`, async () => {
      const html = [0,1].map(index => renderToStaticMarkup(React.createElement(Component, { model: model(index, annual), variant }))).join("");
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><meta charset="utf-8"><style>${css}</style><body><div class="fa-report-print-root specialized-print-root">${html}</div></body></html>`);
      await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth>0));
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const parser = new PDFParse({ data: pdf }); const result = await parser.getText(); await parser.destroy();
      assert.equal(result.pages.length, 2, `${variant}: exactly one A4 per pupil`);
      assert.match(result.text.replace(/\s/g, ""), /DRENADEDIMBOKRO/); assert.match(result.text, /ecole@example.invalid/);
      assert.match(result.text, /Instituteur/); assert.match(result.text, /8,00/);
      assert.equal((result.text.match(/ÉLÈVE\d/g)||[]).length, 2);
      assert.doesNotMatch(result.text, /Coef\./);
      if (annual) {
        assert.match(result.text, /Moyenne générale annuelle/);
        assert.match(result.text, /7,67/);
        assert.match(result.text, /Composition de février/);
        assert.match(result.text, /ADMIS/);
      }
      const overflow = await page.evaluate(() => { const pages = [...document.querySelectorAll('article.page')]; return pages.length !== 2 || pages.some(node => node.getBoundingClientRect().height > 1124); });
      assert.equal(overflow, false, "content stays inside the A4 page");
      assert.equal(result.text.includes("Directeur général"), variant === "combined");
      if (process.env.PRIMARY_PRINT_OUTPUT) {
        mkdirSync(process.env.PRIMARY_PRINT_OUTPUT, { recursive: true });
        writeFileSync(`${process.env.PRIMARY_PRINT_OUTPUT}/bulletin-${variant}${annual ? "-passage" : ""}.pdf`, pdf);
      }
      await page.close();
    });
  } finally { await browser.close(); }
});
