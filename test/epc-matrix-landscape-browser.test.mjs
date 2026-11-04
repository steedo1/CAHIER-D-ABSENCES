import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { PDFParse } = require("pdf-parse");
const printCss = readFileSync(new URL("../src/components/admin/SpecializedCorrespondentReports.print.css", import.meta.url), "utf8");
const component = readFileSync(new URL("../src/components/admin/SpecializedCorrespondentReports.tsx", import.meta.url), "utf8");

const subjects = [
  "LECT", "ÉCR", "ORTH/DICT", "EX.ÉCR", "EXPL.TXT", "ÉVEIL",
  "MATH", "CH/PO", "DESS", "EDHC", "EPS",
];

function schoolMatrixFixture(track) {
  const students = Array.from({ length: 45 }, (_, i) => ({
    name: "ELEVE" + String(i + 1).padStart(3, "0") + (i % 9 === 0 ? " Long prénom" : ""),
    score: i % 8 === 0 ? "0" : "12,5",
  }));
  // Exactement les mêmes matières sur chaque feuille ; seules les lignes changent.
  const papers = [students.slice(0, 24), students.slice(24)].map(rows => {
    const columns = [
      '<col style="width:28%">',
      ...subjects.map(() => '<col style="width:' + (57 / subjects.length) + '%">'),
      '<col style="width:7%"><col style="width:3%"><col style="width:5%">',
    ].join("");
    const heading = '<tr><th>Élève</th>' + subjects.map(label =>
      '<th class="subject-heading"><span class="subject-label">' + label +
      '</span><span class="subject-denominator">/35</span></th>').join("") +
      '<th>Moy.</th><th>Rg</th><th>État</th></tr>';
    const body = rows.map(row => '<tr><td class="student-name">' + row.name + '</td>' +
      subjects.map((_, i) => '<td>' + (i === 0 || i === subjects.length - 1 ? row.score : '') + '</td>').join('') +
      '<td></td><td></td><td>—</td></tr>').join("");
    return '<section class="specialized-term-sheet specialized-primary-sheet" ' +
      (track === "arabic" ? 'dir="rtl"' : '') + '>' +
      '<header class="specialized-primary-header"><p class="school-name">EPC Centre Etude Islamique de Dimbokro</p>' +
      '<h3>Matrice d’évaluation · Enseignement ' + track + '</h3><p>CE1 · 2026-2027</p>' +
      '<p>DOCUMENT DE TRAVAIL — NOTES PUBLIÉES — RÉSULTATS EN COURS</p></header>' +
      '<table class="specialized-term-table specialized-primary-table"><colgroup>' + columns +
      '</colgroup><thead>' + heading + '</thead><tbody>' + body + '</tbody></table></section>';
  });
  return '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>*{box-sizing:border-box}h3,p{margin:0}body{margin:0}.mobile-outer{width:390px;max-width:390px;display:flex;padding:8px}' +
    '.mobile-inner{width:100%;max-width:390px}' + printCss + '</style><body><div class="mobile-outer"><div class="mobile-inner">' +
    '<div id="specialized-correspondent-report" class="specialized-term-report specialized-primary-matrix">' +
    '<div class="specialized-term-pages">' + papers.join('') + '</div></div></div></div></body></html>';
}

test("EPC matrice CE1 : toutes les matières sur une seule grille A4 paysage, y compris depuis mobile", async t => {
  assert.match(component, /const primaryPrintSubjects = isPrimaryTermMatrix \? subjects\.map/);
  assert.doesNotMatch(component, /primaryPrintGroups|subjects\.slice\(index \* 6/);
  assert.match(component, /const primaryPrintSheets = isPrimaryTermMatrix/);
  assert.match(component, /display\.slice\(sheetIndex \* 24, sheetIndex \* 24 \+ 24\)/);
  assert.match(component, /primaryMatrixPrintScore/);
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CLASS_LIST_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--no-zygote", "--disable-gpu"],
  });
  try {
    for (const track of ["french", "arabic"]) await t.test(track, async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      try {
        await page.setContent(schoolMatrixFixture(track));
        await page.emulateMedia({ media: "print" });
        const properties = await page.locator("#specialized-correspondent-report").evaluate(el => ({
          position: getComputedStyle(el).position,
          width: getComputedStyle(el).width,
          paperCount: el.querySelectorAll(".specialized-primary-sheet").length,
          pageRows: [...el.querySelectorAll(".specialized-primary-sheet")].map(
            sheet => sheet.querySelectorAll("tbody tr").length),
          headerColumns: [...el.querySelectorAll(".specialized-primary-sheet")].map(
            sheet => sheet.querySelectorAll("thead th").length),
          headerLabels: [...el.querySelectorAll(".specialized-primary-sheet")].map(
            sheet => [...sheet.querySelectorAll("th.subject-heading .subject-label")].map(
              label => label.textContent)),
        }));
        assert.equal(properties.position, "static");
        assert.equal(properties.paperCount, 2, "45 élèves : deux feuilles seulement");
        assert.deepEqual(properties.pageRows, [24, 21]);
        assert.deepEqual(properties.headerColumns, [subjects.length + 4, subjects.length + 4]);
        assert.deepEqual(properties.headerLabels, [subjects, subjects],
          "aucune matière ne doit être renvoyée vers un tableau séparé");

        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const parser = new PDFParse({ data: pdf });
        const parsed = await parser.getText();
        await parser.destroy();
        const boxes = [...pdf.toString("latin1").matchAll(
          /\/MediaBox\s*\[\s*0(?:\.0+)?\s+0(?:\.0+)?\s+([\d.]+)\s+([\d.]+)\s*\]/g,
        )].map(([,w,h])=> ({ w:Number(w),h:Number(h) }));
        assert.equal(parsed.pages.length, 2, "deux pages élèves, aucune page matières");
        assert.ok(boxes.slice(0,2).every(box => box.w > box.h &&
          Math.abs(box.w-842)<4 && Math.abs(box.h-595)<4),
          "A4 paysage réel, pas de format A3/A2");
        for (let i=0;i<45;i++) {
          const student = "ELEVE" + String(i+1).padStart(3,"0");
          const occurrences = parsed.text.match(new RegExp(student,"g")) || [];
          assert.equal(occurrences.length, 1, student + " must appear exactly once");
        }
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser.close();
  }
});
