import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
test("the existing periods tab is the only editing entrypoint, never a second model editor", () => {
  const page = read("src/app/admin/parametres/page.tsx");
  assert.match(page, /activeTab === "grading-periods"/);
  assert.match(page, /\/api\/admin\/institution\/grading-periods/);
  assert.doesNotMatch(page, /SchoolProgramPeriodsEditor/);
  assert.equal(page.split('title="Périodes d\'évaluation"').length - 1, 1);
  const bulletinTab = page.slice(page.lastIndexOf('activeTab === "bulletin-models"'));
  assert.doesNotMatch(bulletinTab, /SchoolProgramPeriodsEditor|Périodes par cycle et enseignement/);
  assert.doesNotMatch(page, /3 compositions|trois périodes « 1er trimestre »/);
});

test("an unconnected parallel periods API cannot accept phantom settings", () => {
  assert.equal(existsSync("src/app/api/admin/school-program-periods/route.ts"), false);
  assert.equal(existsSync("src/components/admin/SchoolProgramPeriodsEditor.tsx"), false);
  assert.equal(existsSync("src/lib/school-program-periods.ts"), false);
  assert.match(read("src/app/api/admin/institution/grading-periods/route.ts"), /from\("grade_periods"\)/);
});
