import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { PDFParse } = require("pdf-parse");
const printCss = readFileSync(new URL("../src/components/admin/SpecializedCorrespondentReports.print.css", import.meta.url), "utf8");
const component = readFileSync(new URL("../src/components/admin/SpecializedCorrespondentReports.tsx", import.meta.url), "utf8");

function schoolMatrixFixture(track) {
  const first = ["Lecture", "Écriture / Copie", "Orthographe / Dictée", "Expression écrite", "Exploitation de texte", "Éveil au milieu"];
  const second = ["Mathématiques", "Chant / Poème", "Dessin", "EDHC", "EPS"];
  const all = [first, second];
  const students = Array.from({ length: 45 }, (_, i) => ({
    name: "ELEVE" + String(i + 1).padStart(3, "0") + (i % 9 === 0 ? " Long prénom" : ""),
    score: i % 8 === 0 ? "0,00 / 35" : "12,50 / 35",
  }));
  const papers = all.flatMap((subjects, group) =>
    [students.slice(0, 24), students.slice(24)].map((rows, slice) => {
      const last = group === 1;
      const columns = [
        '<col style="width:25%">',
        ...subjects.map(() => '<col style="width:' + (last ? 55 / subjects.length : 75 / subjects.length) + '%">'),
        ...(last ? ['<col style="width:8%">', '<col style="width:5%">', '<col style="width:7%">'] : []),
      ].join("");
      const heading = '<tr><th>Élève</th>' + subjects.map(v => '<th>' + v + '</th>').join("") +
        (last ? '<th>Moyenne</th><th>Rang</th><th>Statut</th>' : "") + '</tr>';
      const body = rows.map((row, k) => '<tr><td class="student-name">' + row.name + '</td>' +
        subjects.map((_, i) => '<td>' + (i === subjects.length - 1 ? row.score : '') + '</td>').join('') +
        (last ? '<td></td><td></td><td>En cours</td>' : '') + '</tr>').join('');
      return '<section class="specialized-term-sheet specialized-primary-sheet" ' +
        (track === "arabic" ? 'dir="rtl"' : '') + '>' +
        '<header class="specialized-primary-header"><p class="school-name">EPC Centre Etude Islamique de Dimbokro</p>' +
        '<h3>Matrice d’évaluation · Enseignement ' + track + '</h3><p>CE1 · 2026-2027</p>' +
        '<p>DOCUMENT DE TRAVAIL — NOTES PUBLIÉES — RÉSULTATS EN COURS</p>' +
        '<p>Matières ' + (group * 6 + 1) + ' à ' + (group * 6 + subjects.length) + ' sur 11</p></header>' +
        '<table class="specialized-term-table specialized-primary-table"><colgroup>' + columns +
        '</colgroup><thead>' + heading + '</thead><tbody>' + body + '</tbody></table></section>';
    }));
  return '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>*{box-sizing:border-box}h3,p{margin:0}body{margin:0}.mobile-outer{width:390px;max-width:390px;display:flex;padding:8px}' +
    '.mobile-inner{width:100%;max-width:390px}' + printCss + '</style><body><div class="mobile-outer"><div class="mobile-inner">' +
    '<div id="specialized-correspondent-report" class="specialized-term-report specialized-primary-matrix">' +
    '<div class="specialized-term-pages">' + papers.join('') + '</div></div></div></div></body></html>';
}

test("EPC matrice CE1: Android mobile printing fills actual A4 landscape with 24+21 pupils per group", async t => {
  assert.match(component, /const primaryPrintSheets = primaryPrintGroups\.flatMap/);
  assert.match(component, /display\.slice\(sheetIndex \* 24, sheetIndex \* 24 \+ 24\)/);
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
        }));
        assert.equal(properties.position, "static", "unlike old absolute/mobile-width print positioning");
        assert.equal(properties.paperCount, 4);
        assert.deepEqual(properties.pageRows, [24, 21, 24, 21]);

        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        const parser = new PDFParse({ data: pdf });
        const parsed = await parser.getText();
        await parser.destroy();
        const boxes = [...pdf.toString("latin1").matchAll(
          /\/MediaBox\s*\[\s*0(?:\.0+)?\s+0(?:\.0+)?\s+([\d.]+)\s+([\d.]+)\s*\]/g,
        )].map(([,w,h])=> ({ w:Number(w),h:Number(h) }));
        assert.equal(parsed.pages.length, 4, "45 élèves must yield two balanced pages per discipline group");
        assert.ok(boxes.slice(0,4).every(box => box.w > box.h &&
          Math.abs(box.w-842)<4 && Math.abs(box.h-595)<4),
          "all printed pages must remain true A4 landscape");
        for (let i=0;i<45;i++) {
          const student = "ELEVE" + String(i+1).padStart(3,"0");
          const occurrences = parsed.text.match(new RegExp(student,"g")) || [];
          assert.equal(occurrences.length, 2, student + " must appear once in each group, never lost");
        }
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser.close();
  }
});
