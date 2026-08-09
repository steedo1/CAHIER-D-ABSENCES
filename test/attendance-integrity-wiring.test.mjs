import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("tous les chemins UI transmettent captured_at_device au clic de validation", async () => {
  const [classPage, teacher, delivery] = await Promise.all([
    read("src/app/class/page.tsx"),
    read("src/components/teacher/TeacherDashboard.tsx"),
    read("src/lib/teacher-attendance-delivery.ts"),
  ]);
  assert.match(classPage, /const attendanceCapturedAt = actualEndAt/);
  assert.ok((classPage.match(/captured_at_device: attendanceCapturedAt/g) || []).length >= 2);
  assert.match(classPage, /capturedAtDevice: attendanceCapturedAt/);
  assert.match(teacher, /const attendanceCapturedAt = observedNowIso\(\)/);
  assert.ok((teacher.match(/capturedAtDevice: attendanceCapturedAt/g) || []).length >= 2);
  assert.match(delivery, /captured_at_device: capturedAtDevice/);
  assert.match(delivery, /capturedAtDevice: current\.captured_at_device/);
});

test("l'API Cloud utilise la même mutation atomique que le relais", async () => {
  const route = await read("src/app/api/teacher/attendance/bulk/route.ts");
  assert.match(route, /body\?\.captured_at_device/);
  assert.match(route, /apply_relay_attendance_call_v2/);
  assert.match(route, /attendance_integrity_migration_required/);
  assert.doesNotMatch(route, /\.from\("attendance_marks"\)\s*\.upsert/);
  assert.doesNotMatch(route, /\.from\("attendance_marks"\)\s*\.delete/);
});

test("la migration protège les corrections, les retries exacts et les payloads altérés", async () => {
  const sql = await read("migrations/20260809_relay_attendance_integrity_v2.sql");
  assert.match(sql, /^--[\s\S]*\nBEGIN;[\s\S]*COMMIT;\s*$/);
  assert.match(sql, /last_payload_fingerprint/);
  assert.match(sql, /attendance_operation_payload_conflict/);
  assert.match(sql, /attendance_operation_stale/);
  assert.match(sql, /attendance_operation_ambiguous/);
  assert.match(sql, /already_applied/);
  assert.match(sql, /p_captured_at_device IS NULL/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS last_payload_fingerprint/);
  assert.match(sql, /session\.actual_call_at IS NOT NULL/);
  assert.match(sql, /GET DIAGNOSTICS call_updated_count = ROW_COUNT/);
  assert.match(sql, /deleted_count \+ upserted_count \+ call_updated_count/);
  assert.match(sql, /\^\[0-9a-f\]\{8\}.*\[0-9a-f\]\{12\}\$/);
});

test("le synchroniseur relais accepte un rejeu exact et refuse un payload conflictuel", async () => {
  const source = await read("src/lib/relay-cloud-sync.ts");
  assert.match(source, /status !== "applied" && status !== "already_applied"/);
  assert.match(source, /attendance_operation_payload_conflict/);
});


test("l'ancien endpoint de marques ne contourne plus l'authentification ni la mutation atomique", async () => {
  const source = await read("src/app/api/sessions/[id]/marks/route.ts");
  assert.match(source, /postTeacherAttendanceBulk/);
  assert.match(source, /X-Mon-Cahier-Operation-Id/);
  assert.doesNotMatch(source, /getSupabaseServiceClient/);
  assert.doesNotMatch(source, /\.from\("attendance_marks"\)/);
});
