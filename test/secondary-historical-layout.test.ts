import assert from "node:assert/strict";
import test from "node:test";
import { historicalSecondaryViews } from "../src/lib/secondary-historical-layout";
import type { SpecializedBulletinPayload } from "../src/lib/server/specialized-bulletin";

const school = { name: "EPC", code: "E020684" };
const student = { id: "stu1", lastName: "NIMAGA", firstName: "A.", matricule: "M1" };
const period = { cycle: "Secondaire", level: "6e", className: "6e 1", year: "2026-2027", period: "T1" };
function fixture(): SpecializedBulletinPayload {
  return {
    engine: "specialized", cycle: "secondary", format: "combined",
    coefficientSource: "program", programs: ["french", "arabic"],
    documents: [{
      studentId: "stu1", ready: true, programReadiness: { french: true, arabic: true }, problems: [],
      document: { school, student,
        french: { ...period, track: "french", denominator: 20, generalAverage: 14.2375, rank: 2,
          directorName: "Directeur français",
          subjects: [{ id: "fr-only", name: "Français", coefficient: 3, average: 15.25, subjectRank: 1,
            components: [{ id: "orth", name: "Orthographe", coefficient: 1, average: 12, rank: 3 }] }],
          historicalSecondary: { conductAverage: 16, annualAverage: 13, annualRank: 4, generalBonus: 0,
            averageStatus: null, previousPeriods: [{ label: "T1", avg20: 14, rank: 2 }],
            decision: { official_decision: "ADMIS", state: "validated", official_annual_average: 13 },
            groups: [] },
        },
        arabic: { ...period, track: "arabic", denominator: 10, generalAverage: 8, rank: 1,
          directorName: "Directeur arabe",
          subjects: [{ id: "ar-only", name: "Coran", coefficient: 2, average: 0 },
            { id: "ar-reading", name: "Lecture arabe", coefficient: 1, average: 10 }] },
      } },
    ],
  };
}

test("le même vrai bulletin historique affiche deux enseignements sans mélanger les matières", () => {
  const source = fixture(); const before = structuredClone(source);
  const french = historicalSecondaryViews(source, "french");
  const arabic = historicalSecondaryViews(source, "arabic");
  assert.deepEqual(source, before, "adaptation 100 % lecture seule");
  assert.equal(french.length, 1); assert.equal(arabic.length, 1);
  assert.deepEqual(french[0].subjects.map(row => row.subject_id), ["fr-only"]);
  assert.deepEqual(arabic[0].subjects.map(row => row.subject_id), ["ar-only", "ar-reading"]);
  assert.equal(french[0].item.general_avg, 14.2375);
  assert.equal(arabic[0].item.general_avg, 16, "normalisation d'affichage /10 -> /20");
  assert.equal(arabic[0].item.per_subject[0].avg20, 0, "une vraie note zéro demeure 0");
  assert.equal(arabic[0].item.per_subject[1].avg20, 20);
  assert.equal(french[0].item.annual_avg, 13);
  assert.equal(arabic[0].item.annual_avg, null);
  assert.equal(french[0].item.per_subject_components[0].avg20, 12);
  assert.equal(french[0].program.directorName, "Directeur français");
  assert.equal(arabic[0].program.directorName, "Directeur arabe");
});
test("pas de bulletin secondaire imprimable si barème invalide ou données non validées", () => {
  const data = fixture(); data.documents[0].document.arabic!.denominator = 0;
  assert.equal(historicalSecondaryViews(data, "arabic")[0].ready, false);
  assert.equal(historicalSecondaryViews(data, "arabic")[0].item.general_avg, null);
  data.documents[0].document.arabic!.denominator = 10;
  data.documents[0].programReadiness.arabic = false;
  assert.equal(historicalSecondaryViews(data, "arabic")[0].ready, false);
  assert.deepEqual(historicalSecondaryViews(data, "french").length, 1);
  assert.deepEqual(historicalSecondaryViews({ ...data, cycle: "primary" }, "french"), []);
});
test("le vrai composant de bulletin historique prend le relais au secondaire", async () => {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync("src/app/admin/bulletins/page.tsx", "utf8");
  assert.match(text, /specializedBulletins\?\.cycle === "secondary"/);
  assert.match(text, /secondaryViews\.map/);
  assert.match(text, /<StudentBulletinCard key=\{selectedSecondaryTrack/);
  assert.match(text, /historicalSecondaryViews\(specializedBulletins, selectedSecondaryTrack\)/);
});
