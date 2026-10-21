import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ADMIN_ATTENDANCE_CLOUD_TIMEOUT_MS,
  ADMIN_ATTENDANCE_MATRIX_CLOUD_TIMEOUT_MS,
  ADMIN_ATTENDANCE_MATRIX_MIN_REFRESH_MS,
  ADMIN_ATTENDANCE_MATRIX_POLL_MS,
  ADMIN_ATTENDANCE_POLL_MS,
  adminAttendanceMatrixPollDelay,
  adminAttendancePollDelay,
  shouldStartAttendanceMatrixRefresh,
} from "../src/lib/admin-attendance-monitor";

test("matrix tolerates Render cold/slow response without changing other views' timeouts", () => {
  assert.equal(ADMIN_ATTENDANCE_CLOUD_TIMEOUT_MS, 4_000);
  assert.equal(ADMIN_ATTENDANCE_MATRIX_CLOUD_TIMEOUT_MS, 9_000);
  assert.ok(ADMIN_ATTENDANCE_MATRIX_CLOUD_TIMEOUT_MS > ADMIN_ATTENDANCE_CLOUD_TIMEOUT_MS);
  assert.ok(ADMIN_ATTENDANCE_MATRIX_CLOUD_TIMEOUT_MS <= 12_000);
});

test("only class-slot matrix polls less frequently and never more than former cloud cadence", () => {
  assert.equal(adminAttendanceMatrixPollDelay("cloud", false), ADMIN_ATTENDANCE_MATRIX_POLL_MS.cloud);
  assert.ok(ADMIN_ATTENDANCE_MATRIX_POLL_MS.cloud >= 30_000);
  assert.ok(ADMIN_ATTENDANCE_MATRIX_POLL_MS.cloud > ADMIN_ATTENDANCE_POLL_MS.cloud);
  assert.equal(adminAttendancePollDelay("cloud", false), 20_000);
  assert.equal(adminAttendanceMatrixPollDelay("cache", false), 60_000);
  assert.equal(adminAttendanceMatrixPollDelay(null, true), ADMIN_ATTENDANCE_MATRIX_POLL_MS.error);
});

test("focus, online and visibility refresh bursts are coalesced while the same call is pending", () => {
  const context = { key: "2026-10-21|general_secondary|||", lastKey: "2026-10-21|general_secondary|||", lastAt: 10_000, now: 12_000 };
  assert.equal(shouldStartAttendanceMatrixRefresh({ ...context, activeKey: context.key }), false);
  assert.equal(shouldStartAttendanceMatrixRefresh({ ...context, activeKey: context.key, force: true }), false);
  assert.equal(shouldStartAttendanceMatrixRefresh({ ...context, activeKey: null }), false);
  assert.equal(shouldStartAttendanceMatrixRefresh({ ...context, activeKey: null, now: 10_000 + ADMIN_ATTENDANCE_MATRIX_MIN_REFRESH_MS }), true);
});

test("a different scope is never blocked by cooldown; a user refresh remains immediate", () => {
  const recent = { key: "2026-10-21|general_secondary|||3e2", activeKey: "2026-10-21|general_secondary|||4e1", lastKey: "2026-10-21|general_secondary|||4e1", lastAt: 100, now: 101 };
  assert.equal(shouldStartAttendanceMatrixRefresh(recent), true);
  assert.equal(shouldStartAttendanceMatrixRefresh({ ...recent, key: recent.lastKey, activeKey: null, force: true }), true);
});

test("matrix keeps data-source warning and does not certify six zeros from empty cached response", () => {
  const matrix = readFileSync(new URL("../src/app/admin/absences/appels-matrice/page.tsx", import.meta.url), "utf8");
  const fetcher = readFileSync(new URL("../src/lib/local-relay.ts", import.meta.url), "utf8");
  assert.match(matrix, /cloudTimeoutMs: ADMIN_ATTENDANCE_MATRIX_CLOUD_TIMEOUT_MS/);
  assert.match(matrix, /shouldStartAttendanceMatrixRefresh\(/);
  assert.match(matrix, /onClick=\{\(\) => void loadRows\(new Date\(\), true\)\}/);
  assert.match(matrix, /activeRequestKeyRef\.current = null/);
  assert.match(matrix, /activeRequestKeyRef\.current = requestKey/);
  assert.match(matrix, /if \(controller\.signal\.aborted\) return/);
  assert.match(matrix, /adminAttendanceMatrixPollDelay\(/);
  assert.match(matrix, /Cloud indisponible : la dernière vue locale valide reste affichée/);
  assert.match(matrix, /emptyCacheIsUnverified/);
  assert.match(matrix, /displayCount\(totalMissing\)/);
  assert.match(fetcher, /options\.cloudTimeoutMs === undefined/);
  assert.match(fetcher, /Math\.min\(12_000, options\.cloudTimeoutMs\)/);
});
