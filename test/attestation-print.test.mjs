import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { generateActualAttestationHtml } from "./helpers/attestation-fixture.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright"), { PDFParse } = require("pdf-parse");
const logo = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#06564c"/><text x="50" y="58" text-anchor="middle" fill="white" font-size="24">ÉCOLE</text></svg>');
const students = ["Primaire", "Secondaire"].map((label, index) => ({
  id: `pupil-${index}`, last_name: `ÉLÈVE${index}`, first_name: "Prénoms de démonstration",
  matricule: `TEST-${index}`, class_id: `class-${index}`, class_label: index ? "6e" : "CM1",
  birthdate: "2015-01-01", birth_place: "Dimbokro", photo_url: logo, parent_names: "Parent de démonstration",
}));

test("attestations A4 : deux directions franco-arabes, une direction classique ou CSCA, une page par élève", async t => {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CLASS_LIST_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--no-zygote", "--disable-gpu"] });
  try {
    for (const scenario of [
      { id: "franco-arabe", dual: true },
      { id: "noms-longs", dual: true, long: true },
      { id: "classique", dual: false },
      { id: "CSCA", dual: false },
    ]) await t.test(scenario.id, async () => {
      const frenchName = "RESPONSABLE FRANÇAIS" + (scenario.long ? " Noms de démonstration particulièrement longs Marie Angélique Désirée Christelle" : "");
      const arabicName = "RESPONSABLE ARABE" + (scenario.long ? " Noms de démonstration particulièrement longs Jean Claude Emmanuel Christophe" : "");
      const html = generateActualAttestationHtml({
        cfg: { institution_name: scenario.id === "CSCA" ? "COURS SECONDAIRE CATHOLIQUE ABOISSO"
          : "ÉCOLE FRANCO-ARABE DE DÉMONSTRATION DE DIMBOKRO", institution_head_name: "RESPONSABLE GÉNÉRAL",
          institution_head_title: "Proviseur", institution_logo_url: logo,
          institution_phone: "07 00 00 00 00", institution_email: "ecole@example.invalid",
          institution_postal_address: "Quartier de démonstration", institution_region: "DRENA DE DIMBOKRO",
          country_name: "République de Côte d’Ivoire", country_motto: "Union – Discipline – Travail",
          ministry_name: "MINISTÈRE DE L’ÉDUCATION NATIONALE ET DE L’ALPHABÉTISATION",
          settings_json: scenario.dual ? {
            school_cycles_v1: { version: 1, enabled: true, enabledCycles: ["primary", "secondary"],
              teachingTracksByCycle: { primary: ["french", "arabic"], secondary: ["french", "arabic"] } },
            school_teaching_signatories_v1: { version: 1, french: { name: frenchName }, arabic: { name: arabicName } },
          } : {} },
        academicYear: "2026-2027", rows: students, classEducationTypes: new Map(), selectedEducationType: "general_secondary",
      });
      const page = await browser.newPage();
      const networkRequests=[];page.on("request",request=>{if(/^https?:/.test(request.url()))networkRequests.push(request.url())});
      await page.evaluate(() => { window.print = () => {}; });
      await page.setContent(html);
      await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
      assert.equal(await page.locator(".national-emblem").count(),2);
      assert.deepEqual(networkRequests,[],"the national emblem requires no Render, Supabase or external image request");
      await page.emulateMedia({ media: "print" });
      assert.equal(await page.locator(".signature-box").count(), scenario.dual ? 4 : 2);
      const clipped = await page.locator(".page").evaluateAll(pages => pages.flatMap(sheet => {
        const bounds = sheet.getBoundingClientRect();
        return [...sheet.querySelectorAll(".signature-name,.signature-title,.signature-teaching")]
          .filter(node => { const box = node.getBoundingClientRect(); return box.bottom > bounds.bottom - 20 || box.right > bounds.right || box.left < bounds.left; })
          .map(node => node.textContent);
      }));
      assert.deepEqual(clipped, [], "les noms et titres restent entièrement dans la feuille");
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      assert.equal((pdf.toString("latin1").match(/\/Width 280\b/g)||[]).length,1,"one national emblem image object shared across the two pages");
      const parser = new PDFParse({ data: pdf }); const result = await parser.getText(); await parser.destroy();
      assert.equal(result.pages.length, 2, "une attestation complète par élève, sans page supplémentaire");
      for (const sheet of result.pages) {
        const text = sheet.text.replace(/\s+/g, " ");
        if (scenario.dual) {
          assert.ok(text.includes(frenchName), text); assert.ok(text.includes(arabicName), text);
          assert.match(text, /Nous soussignés/); assert.match(text, /attestons que l'élève/);
          assert.match(text, /Enseignement français/); assert.match(text, /Enseignement arabe/);
          assert.equal((text.match(/Directeur des études/g) || []).length, 2);
          assert.doesNotMatch(text, /RESPONSABLE GÉNÉRAL|Proviseur|Je soussigné/);
        } else {
          assert.match(text, /Je soussigné/); assert.match(text, /RESPONSABLE GÉNÉRAL/); assert.match(text, /Proviseur/);
          assert.doesNotMatch(text, /RESPONSABLE FRANÇAIS|RESPONSABLE ARABE|Nous soussignés/);
        }
      }
      if (process.env.ATTESTATION_PRINT_OUTPUT) {
        await mkdir(process.env.ATTESTATION_PRINT_OUTPUT, { recursive: true });
        await writeFile(`${process.env.ATTESTATION_PRINT_OUTPUT}/attestation-${scenario.id}.pdf`, pdf);
      }
      await page.close();
    });
  } finally { await browser.close(); }
});
