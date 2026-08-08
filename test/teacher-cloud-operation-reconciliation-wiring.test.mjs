import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const attendance = await readFile(new URL("../src/lib/teacher-attendance-delivery.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/components/teacher/TeacherDashboard.tsx", import.meta.url), "utf8");
const bulk = await readFile(new URL("../src/app/api/teacher/attendance/bulk/route.ts", import.meta.url), "utf8");
const lookup = await readFile(new URL("../src/app/api/teacher/operations/[operationId]/route.ts", import.meta.url), "utf8");
const receipt = await readFile(new URL("../src/lib/teacher-cloud-operation-receipts.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/20260808_teacher_cloud_operation_receipts_v1.sql", import.meta.url), "utf8");

test("le Cloud réserve et accuse réception avec le même operation_id", () => {
  assert.match(bulk, /X-Mon-Cahier-Operation-Id/);
  assert.match(bulk, /reserveTeacherCloudOperationReceipt/);
  assert.match(bulk, /state:\s*"acknowledged"/);
  assert.match(bulk, /operation_id:\s*operationId/);
});

test("la route de vérification distingue reçu, absent et traitement en cours", () => {
  assert.match(lookup, /state:\s*"not_received"/);
  assert.match(lookup, /teacherCloudReceiptIsStale/);
  assert.match(lookup, /actor_user_id !== user\.id/);
});

test("le téléphone vérifie avant de renvoyer et garde le même identifiant", () => {
  assert.match(attendance, /reconcileTeacherAttendanceUnknownOperations/);
  assert.match(attendance, /state === "not_received"/);
  assert.match(attendance, /deliverToCloud\(retryable, deps\)/);
  assert.match(attendance, /operationId: current\.operation_id/);
});

test("le bouton Sync lance la réconciliation uniquement lorsque le Cloud répond", () => {
  assert.match(dashboard, /if \(cloudAvailable\)[\s\S]*reconcileTeacherAttendanceUnknownOperations/);
  assert.match(dashboard, /Aucun renvoi aveugle/);
});

test("la table de reçus est additive, idempotente et protégée par RLS", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.teacher_cloud_operation_receipts/);
  assert.match(migration, /operation_id text PRIMARY KEY/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(receipt, /payload_fingerprint/);
  assert.match(receipt, /teacherCloudReceiptIsStale/);
});
