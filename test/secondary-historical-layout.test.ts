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


test("historical metadata, administrative NC and group results reach the original card intact", () => {
  const data = fixture(), program = data.documents[0].document.french!;
  const source = { student_id: "stu1", general_avg: null, rank: null,
    admin_forced_nc: true, admin_nc_reason: "Décision validée", annual_avg: null,
    end_of_year_decision: { official_decision: "REDOUBLE", council_state: "validated" },
    per_subject: [{ subject_id: "fr-only", avg20: 15.25, teacher_signature_png: "signature" }],
    per_group: [{ group_id: "letters", group_avg: 15.25 }],
  };
  program.historicalSecondary!.sourceItem = source;
  program.historicalSecondary!.groups = [{ id: "letters", label: "BILAN LETTRES", coefficient: 2,
    average: 15.25, subjectIds: ["fr-only"] }];
  const view = historicalSecondaryViews(data, "french")[0];
  for (const [key, value] of Object.entries(source)) assert.deepEqual((view.item as Record<string, unknown>)[key], value);
  assert.equal(view.subjectGroups[0].annual_coeff, 2);
  assert.equal(view.subjectGroups[0].items[0].subject_id, "fr-only");
  assert.equal(view.item.general_avg, null, "never restore a computed mean over administrative NC");
});


test("le bulletin secondaire français restitue la conduite calculée par le moteur historique", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/app/admin/bulletins/page.tsx", "utf8");
  // Seul le bulletin spécialisé français reçoit la conduite historique.
  assert.match(source, /historicalConductAverage=\{selectedSecondaryTrack === "french"/);
  assert.match(source, /row\.program\.historicalSecondary\?\.conductAverage \?\? null/);
  // Ne jamais convertir une absence de résultat en zéro.
  assert.match(source, /Number\.isFinite\(historicalConductAverage\)/);
  assert.match(source, /historicalConductAverage !== undefined/);
  // Le parcours classique reste alimenté par son ancienne source.
  assert.match(source, /conduct && typeof conduct\.total === "number" \? conduct\.total : null/);
});

test("l'adaptateur historique conserve une vraie conduite zéro, ou son absence", () => {
  const original = fixture();
  original.documents[0].document.french!.historicalSecondary!.conductAverage = 0;
  assert.equal(historicalSecondaryViews(original, "french")[0].program.historicalSecondary?.conductAverage, 0);
  original.documents[0].document.french!.historicalSecondary!.conductAverage = null;
  assert.equal(historicalSecondaryViews(original, "french")[0].program.historicalSecondary?.conductAverage, null);
});
