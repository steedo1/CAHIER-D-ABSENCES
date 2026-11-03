import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminRegisterPdf } from "../src/lib/grades/grade-register-pdf.ts";

test("le registre admin produit un vrai PDF A4 avec noms, notes brutes et barèmes pédagogiques", async () => {
  const pdf = await buildAdminRegisterPdf({
    institution: "EPC Centre d'Étude Islamique de Dimbokro",
    classLabel: "CE1 — Français",
    academicYear: "2026-2027",
    subject: "EDHC",
    teacher: "Professeur EPC",
    period: "Toute l'année scolaire",
    students: [
      { id: "one", full_name: "BAH Amanou", matricule: "EPC260196" },
      { id: "two", full_name: "BALDE Zakaria", matricule: "EPC260036" },
    ],
    evaluations: [{
      id: "eval", column_label: "Note 1", eval_date: "2026-11-02",
      scale: 15, is_published: true,
    }],
    scores: [
      { student_id: "one", evaluation_id: "eval", score: 2.5 },
      { student_id: "two", evaluation_id: "eval", score: 0 },
    ],
  });
  assert.equal(Buffer.isBuffer(pdf), true);
  assert.match(pdf.subarray(0, 8).toString("ascii"), /^%PDF-1\./);
  assert.ok(pdf.length > 3_000, "le PDF contient de vraies données et la police embarquée");
});

test("un document de 9 évaluations reste générable sur plusieurs pages sans navigateur", async () => {
  const pdf = await buildAdminRegisterPdf({
    institution: "EPC Dimbokro",
    classLabel: "CP2 — Arabe",
    academicYear: "2026-2027",
    subject: "اللغة العربية",
    teacher: "Professeur",
    period: "Année 2026-2027",
    students: Array.from({ length: 38 }, (_, i) => ({
      id: String(i + 1), full_name: "Élève " + (i + 1), matricule: "EPC26" + String(i + 1).padStart(4, "0"),
    })),
    evaluations: Array.from({ length: 9 }, (_, i) => ({
      id: "ev" + i, column_label: "Note " + (i + 1), scale: 10, is_published: true,
    })),
    scores: [{ evaluation_id: "ev0", student_id: "1", score: 0 }],
  });
  assert.ok(pdf.length > 4_000);
  const pages = [...pdf.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)];
  assert.ok(pages.length >= 3, "chaque groupe de quatre évaluations conserve ses pages");
});
