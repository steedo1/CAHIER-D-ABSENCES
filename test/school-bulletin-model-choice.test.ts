import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  FRANCO_ARABIC_REPORTS_SETTINGS_KEY,
  readFrancoArabicReportsForEditing,
  selectedBulletinFormat,
  validateFrancoArabicReportsInput,
} from "../src/lib/franco-arabic-reporting";

const raw = {
  version: 1 as const, enabled: true,
  engine: "specialized" as const, coefficientSource: "program" as const,
  format: "separate" as const,
  scales: [
    { cycle: "primary" as const, level: "CP1", track: "arabic" as const, maxScore: 20 },
    { cycle: "secondary" as const, level: "6ème", track: "french" as const, maxScore: 20 },
  ],
  coefficients: [{
    cycle: "secondary" as const, level: "6ème",
    track: "french" as const, subjectId: "11111111-1111-4111-8111-111111111111",
    coefficient: 3, includeInAverage: true,
  }],
};

test("one school's chosen model is scoped by cycle with legacy fallback", () => {
  const result = validateFrancoArabicReportsInput({
    ...raw, formatsByCycle: { primary: "combined", secondary: "both" },
  });
  assert.ok(result);
  assert.equal(selectedBulletinFormat(result, "primary"), "combined");
  assert.equal(selectedBulletinFormat(result, "secondary"), "both");
  assert.equal(selectedBulletinFormat(result, "preschool"), "separate");
  assert.deepEqual(result.coefficients, raw.coefficients);
  assert.deepEqual(result.scales, raw.scales);
  assert.equal(result.engine, "specialized");
});

test("a model choice cannot smuggle invalid cycle names or formats into school settings", () => {
  assert.equal(validateFrancoArabicReportsInput({
    ...raw, formatsByCycle: { middle_school: "combined" },
  }), null);
  assert.equal(validateFrancoArabicReportsInput({
    ...raw, formatsByCycle: { primary: "single_global_average" },
  }), null);
});

test("model preference survives disabled bulletin mode without enabling engine", () => {
  const previous = {
    ...raw, enabled: false, engine: "legacy" as const,
    formatsByCycle: { primary: "combined" as const },
  };
  const result = readFrancoArabicReportsForEditing({
    [FRANCO_ARABIC_REPORTS_SETTINGS_KEY]: previous,
  });
  assert.equal(result.enabled, false);
  assert.equal(result.engine, "legacy");
  assert.equal(selectedBulletinFormat(result, "primary"), "combined");
});

test("model selection route saves only presentation and uses revision/role guards", () => {
  const read = (file: string) => readFileSync(file, "utf8");
  const route = read("src/app/api/admin/bulletin-model-selection/route.ts");
  const ui = read("src/components/admin/SchoolBulletinModelPicker.tsx");
  const real = read("src/lib/server/specialized-bulletin.ts");
  const params = read("src/app/admin/parametres/page.tsx");

  assert.match(route, /requireInstitutionRole\(browser, service, \["admin"\]\)/);
  assert.match(route, /settings_changed_reload_required/);
  assert.match(route, /formatsByCycle:.*old\.formatsByCycle/s);
  assert.match(route, /enabled: old\.enabled/);
  assert.match(route, /writeSchoolSettings/);
  assert.doesNotMatch(route, /from\("student_grades"\)|from\("grade_evaluations"\)|\.delete\(/);
  assert.match(real, /format: selectedBulletinFormat\(reports, cycle\)/);
  assert.match(ui, /DemoBulletinClient/);
  const tab = params.slice(params.lastIndexOf('activeTab === "bulletin-models"'));
  assert.match(tab, /<SchoolBulletinModelPicker/);
  assert.doesNotMatch(tab, /<SchoolBulletinSettings\s*\/>/);
});

test("the preview reuses exact printable components with synthetic grades", () => {
  const preview = readFileSync("src/app/admin/bulletins/modeles/DemoBulletinClient.tsx", "utf8");
  assert.match(preview, /FrancoArabicBulletin/);
  assert.match(preview, /PreschoolBookletDemo/);
  assert.match(preview, /sample: true/);
  assert.match(preview, /embedded && previewFormat === "combined"/);
});
