import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const syncPath = path.join(root, "src/lib/finance/student-finance-sync.ts");
const rulesPath = path.join(root, "src/lib/finance/charge-rules.ts");
const syncSource = fs.readFileSync(syncPath, "utf8");
const rulesSource = fs.readFileSync(rulesPath, "utf8");

test("le moteur recharge les anciennes dettes au lieu de regarder seulement les barèmes courants", () => {
  assert.match(
    syncSource,
    /\.from\("student_charges"\)[\s\S]*?\.eq\("class_id", classId\)[\s\S]*?\.order\("updated_at"/,
  );
  assert.doesNotMatch(
    syncSource,
    /\.from\("student_charges"\)[\s\S]{0,800}?\.eq\("class_id", classId\)[\s\S]{0,300}?\.in\("fee_schedule_id", scheduleIds\)/,
  );
  assert.match(syncSource, /historicalScheduleIds/);
  assert.match(syncSource, /schedulesByIdForExistingCharges/);
});

test("une rubrique identique est rapprochée par identité métier même si les UUID ont changé", () => {
  assert.match(rulesSource, /export function financeScheduleSemanticKey/);
  assert.match(rulesSource, /financeScheduleCategorySemanticKey/);
  assert.match(rulesSource, /if \(scheduleKind !== "custom"\) return `kind:\$\{scheduleKind\}`/);
  assert.match(syncSource, /selectedBySemanticKey/);
  assert.match(syncSource, /financeScheduleSemanticKey\(/);
  assert.match(syncSource, /resolvedScheduleId !== sourceScheduleId/);
  assert.match(syncSource, /retargetedChargeIds\.add\(charge\.id\)/);
});

test("Externe -> Interne reste idempotent et les doublons non payés sont neutralisés", () => {
  assert.match(
    syncSource,
    /Externe -> Interne -> Externe -> Interne réellement idempotents/,
  );
  assert.match(syncSource, /const paidActive = active\.filter\(\(row\) => row\.paid_amount > 0\.01\)/);
  assert.match(syncSource, /if \(paidActive\.length > 1\)/);
  assert.match(syncSource, /duplicateIds\.add\(row\.id\)/);
  assert.match(syncSource, /status: "cancelled"/);
  assert.match(syncSource, /Doublon automatique sans encaissement annulé/);
});

test("les barèmes variables à composants ne sont pas retargetés silencieusement", () => {
  assert.match(
    syncSource,
    /sourceSchedule\.amount_mode !== "components"[\s\S]*canonicalSchedule\.amount_mode !== "components"/,
  );
});
