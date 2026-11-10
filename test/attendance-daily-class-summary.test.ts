import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDailyAttendance, dailyAttendanceStatus, type DailyAttendanceRow } from "../src/lib/attendance-daily-class-summary";

const base = { date: "2026-11-10", class_id: "6e1", planned_start: "08:00:00", planned_end: "09:00:00" };
const row = (id: string, extra: Partial<DailyAttendanceRow> = {}): DailyAttendanceRow =>
  ({ ...base, id, teacher_name: "Professeur", subject_name: "Maths", ...extra });

test("bilan journalier : appel enregistré, en cours, non reçu et en attente distincts", () => {
  const entries = [
    row("done", { actual_call_at: "2026-11-10T08:05:00.000Z" }),
    row("future", { planned_start: "10:00:00", planned_end: "11:00:00" }),
    row("missing", { planned_start: "07:00:00", planned_end: "08:00:00" }),
    row("started", { session_id: "s1" }),
  ];
  const summary = summarizeDailyAttendance(entries, "2026-11-10", new Date("2026-11-10T09:30:00Z"));
  assert.deepEqual({ planned: summary.planned, done: summary.done, unreceived: summary.unreceived, pending: summary.pending },
    { planned: 4, done: 1, unreceived: 1, pending: 2 });
  assert.deepEqual(Object.fromEntries(summary.entries.map((r) => [r.id, r.daily_status])), {
    missing: "unreceived", done: "done", started: "unconfirmed", future: "ongoing",
  });
});

test("un cours non terminé ne devient jamais automatiquement un appel non reçu", () => {
  assert.equal(dailyAttendanceStatus(row("x"), "2026-11-10", new Date("2026-11-10T08:59:00Z")), "ongoing");
  assert.equal(dailyAttendanceStatus(row("x"), "2026-11-10", new Date("2026-11-10T09:00:00Z")), "unreceived");
});

test("historique, synchronisation incertaine et horaire incomplet", () => {
  assert.equal(dailyAttendanceStatus(row("x"), "2026-11-09", new Date("2026-11-10T12:00:00Z")), "unreceived");
  assert.equal(dailyAttendanceStatus(row("x", { session_id: "pending" }), "2026-11-09", new Date("2026-11-10T12:00:00Z")), "unconfirmed");
  assert.equal(dailyAttendanceStatus(row("x", { planned_end: null }), "2026-11-10", new Date("2026-11-10T12:00:00Z")), "unconfirmed");
  assert.equal(dailyAttendanceStatus(row("x", { actual_call_at: "2026-11-09T08:00:00Z" }), "2026-11-09", new Date("2026-11-10T12:00:00Z")), "done");
});
