import assert from "node:assert/strict";
import test from "node:test";
import { adaptHistoricalFrenchSecondaryBulletins } from "../src/lib/server/historical-french-secondary-adapter";
import type { HistoricalSecondaryFrenchResponse } from "../src/lib/server/historical-french-secondary-adapter";
import { isSpecializedBulletinPrintable } from "../src/lib/franco-arabic-print-layout";

function legacyResponse(conductAverage: number | null): HistoricalSecondaryFrenchResponse {
  return {
    ok: true,
    subjects: [
      { subject_id: "fr", subject_name: "Français", coeff_bulletin: 3, include_in_average: true },
      { subject_id: "math", subject_name: "Mathématiques", coeff_bulletin: 4, include_in_average: true },
      { subject_id: "conduite", subject_name: "Conduite", coeff_bulletin: 1, include_in_average: true },
    ],
    subject_components: [
      { id: "cf", subject_id: "fr", label: "Orthographe", order_index: 2, coeff_in_subject: 1 },
      { id: "ce", subject_id: "fr", label: "Expression écrite", order_index: 1, coeff_in_subject: 2 },
    ],
    subject_groups: [
      { id: "lettres", label: "BILAN LETTRES", annual_coeff: 3, order_index: 1, items: [{ subject_id: "fr" }] },
    ],
    items: [{
      student_id: "eleve-1",
      general_avg: 14.2375, rank: 2, annual_avg: 14.8935, annual_rank: 3,
      conduct_avg: conductAverage, general_bonus: 0.25,
      end_of_year_decision: { official_decision: "ADMIS", state: "validated", official_annual_average: 14.8935 },
      previous_period_avgs: [{ label: "T1", avg20: 12.4, rank: 5 }],
      per_subject: [
        { subject_id: "fr", avg20: 15.22, subject_rank: 1, teacher_name: "Professeur", bonus: 0.5 },
        { subject_id: "math", avg20: 13.95, subject_rank: 4 },
        { subject_id: "conduite", avg20: conductAverage },
      ],
      per_subject_components: [{ component_id: "ce", avg20: 16.25, component_rank: 3 },
        { component_id: "cf", avg20: 13.2, component_rank: 7 }],
      per_group: [{ group_id: "lettres", group_avg: 15.22 }],
    }],
  };
}
const context = { level: "6e", className: "6e A", year: "2026-2027", period: "T1", directorName: "Direction française" };

test("le secondaire français affiche directement toutes les valeurs historiques, sans recomputation", () => {
  const original = legacyResponse(18);
  const before = structuredClone(original);
  const result = adaptHistoricalFrenchSecondaryBulletins(original, context).get("eleve-1")!;
  assert.deepEqual(original, before, "read-only adapter");
  assert.equal(result.generalAverage, 14.2375);
  assert.equal(result.rank, 2);
  assert.equal(result.historicalSecondary?.conductAverage, 18);
  assert.equal(result.historicalSecondary?.annualAverage, 14.8935);
  assert.equal(result.historicalSecondary?.annualRank, 3);
  assert.equal(result.historicalSecondary?.decision?.official_decision, "ADMIS");
  assert.equal(result.historicalSecondary?.groups[0].average, 15.22);
  assert.equal(result.historicalSecondary?.previousPeriods[0].avg20, 12.4);
  assert.equal(result.subjects[0].coefficient, 3);
  assert.equal(result.subjects[0].average, 15.22);
  assert.equal(result.subjects[0].subjectRank, 1);
  assert.equal(result.subjects[0].teacherName, "Professeur");
  assert.deepEqual(result.subjects[0].components?.map(c => c.name), ["Expression écrite", "Orthographe"]);
  assert.equal(result.subjects[0].components?.[1].rank, 7);
  assert.equal(result.directorName, "Direction française");
  assert.equal(isSpecializedBulletinPrintable({ french: result }, { french: true }, "french"), true);
});

test("aucune règle CSCA n'est injectée : le moteur historique décide et l'adaptateur reproduit la conduite reçue", () => {
  const csca = adaptHistoricalFrenchSecondaryBulletins(legacyResponse(18), context).get("eleve-1")!;
  const epc = adaptHistoricalFrenchSecondaryBulletins(legacyResponse(14), context).get("eleve-1")!;
  assert.equal(csca.historicalSecondary?.conductAverage, 18);
  assert.equal(epc.historicalSecondary?.conductAverage, 14);
  assert.equal(epc.generalAverage, 14.2375, "l'adaptateur ne recalcule jamais la moyenne");
});

test("le bulletin historique NC garde NC et ses composantes, sans faux zéro ni perte d'impression", () => {
  const raw = legacyResponse(null);
  raw.items![0].general_avg = null;
  raw.items![0].rank = null;
  const result = adaptHistoricalFrenchSecondaryBulletins(raw, context).get("eleve-1")!;
  assert.equal(result.generalAverage, null);
  assert.equal(result.rank, null);
  assert.equal(result.historicalSecondary?.conductAverage, null);
  assert.equal(isSpecializedBulletinPrintable({ french: result }, { french: true }, "french"), true);
  assert.equal(isSpecializedBulletinPrintable({ french: { ...result, allowHistoricalNc: false } }, { french: true }, "french"), false);
});

test("absence de données historiques valides = refus ; ne pas inventer de résultats", () => {
  assert.throws(() => adaptHistoricalFrenchSecondaryBulletins({ ok: false, items: [], subjects: [] }, context), /UNAVAILABLE/);
  assert.throws(() => adaptHistoricalFrenchSecondaryBulletins({ ok: true, items: [], subjects: undefined }, context), /UNAVAILABLE/);
  const repeated = legacyResponse(10);
  repeated.items!.push({ ...repeated.items![0] });
  assert.throws(() => adaptHistoricalFrenchSecondaryBulletins(repeated, context), /SCOPE_INVALID/);
});

test("la conduite manquante et les moyennes NC restent null dans l'API historique et le QR", async () => {
  const { readFileSync } = await import("node:fs");
  const api = readFileSync(new URL("../src/app/api/admin/grades/bulletin/route.ts", import.meta.url), "utf8");
  assert.match(api, /if \(raw === null \|\| raw === undefined \|\| raw === ""\) continue/);
  assert.match(api, /value == null \? null : cleanNumber\(value, 4\)/);
  assert.match(api, /conductSource == null \? null : cleanNumber\(conductSource, 4\)/);
  assert.match(api, /conduct_avg == null \? null : cleanNumber/);
  assert.match(api, /general_avg == null \? null : cleanNumber/);
  assert.match(api, /annual_avg == null \? null : cleanNumber/);
  assert.match(api, /g: it\?\.general_avg == null \? null : cleanNumber/);
  assert.match(api, /a: it\?\.annual_avg == null \? null : cleanNumber/);
});
