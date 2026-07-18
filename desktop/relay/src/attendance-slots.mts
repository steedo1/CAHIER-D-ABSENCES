import type { RelayDatabase } from "./db.mjs";

type WeekdayMode = "iso" | "js" | "mon0";

type PeriodRow = {
  id: string;
  institution_id: string;
  weekday: number;
  label: string | null;
  start_time: string;
  end_time: string;
  startMin: number;
  endMin: number;
};

const MAX_CARRY_AFTER_END_MIN = 120;

export function founderAttendanceSlots(
  db: RelayDatabase,
  options: { institutionId: string; now?: Date },
) {
  const now = options.now ?? new Date();
  const today = ymd(now);
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const institution = db.prepare(`
    SELECT id, name FROM institutions
    WHERE id = ? AND deleted_at IS NULL
  `).get(options.institutionId) as { id: string; name: string } | undefined;
  if (!institution) throw new Error("institution_not_initialized");

  const rawPeriods = db.prepare(`
    SELECT id, institution_id, weekday, label, start_time, end_time
    FROM institution_periods
    WHERE institution_id = ? AND deleted_at IS NULL
  `).all(options.institutionId) as Array<Omit<PeriodRow, "startMin" | "endMin">>;
  const periods: PeriodRow[] = rawPeriods.map((row) => ({
    ...row,
    startMin: timeToMinutes(row.start_time),
    endMin: timeToMinutes(row.end_time),
  }));
  const weekdayMode = detectWeekdayMode(periods.map((row) => row.weekday));
  const dbWeekday = jsDayToDbWeekday(now.getUTCDay(), weekdayMode);
  const todayPeriods = periods
    .filter((row) => row.weekday === dbWeekday)
    .sort((a, b) => a.startMin - b.startMin);
  const period = todayPeriods.find((row) => nowMinutes >= row.startMin && nowMinutes < row.endMin) ?? null;
  const nextPeriod = todayPeriods.find((row) => row.startMin > nowMinutes) ?? null;
  const lastPeriod = [...todayPeriods].reverse().find((row) => row.endMin <= nowMinutes) ?? null;
  const periodState = period ? "current" : nextPeriod ? "upcoming" : lastPeriod ? "closed" : "none";

  let present = 0;
  let permissionnaire = 0;
  let absent = 0;
  let expected = 0;

  if (period) {
    const timetables = db.prepare(`
      SELECT class_id, subject_id, teacher_id, period_id
      FROM teacher_timetables
      WHERE institution_id = ? AND period_id = ? AND deleted_at IS NULL
    `).all(options.institutionId, period.id) as Array<{
      class_id: string;
      subject_id: string;
      teacher_id: string;
      period_id: string;
    }>;
    const sessions = db.prepare(`
      SELECT class_id, subject_id, teacher_id, started_at, actual_call_at
      FROM teacher_sessions
      WHERE institution_id = ? AND deleted_at IS NULL
        AND started_at >= ? AND started_at < ?
    `).all(options.institutionId, `${today}T00:00:00.000Z`, `${nextYmd(today)}T00:00:00.000Z`) as Array<{
      class_id: string;
      subject_id: string;
      teacher_id: string;
      started_at: string;
      actual_call_at: string | null;
    }>;
    const absences = db.prepare(`
      SELECT teacher_id FROM teacher_absence_requests
      WHERE institution_id = ? AND status = 'approved' AND deleted_at IS NULL
        AND start_date <= ? AND end_date >= ?
    `).all(options.institutionId, today, today) as Array<{ teacher_id: string }>;
    const approved = new Set(absences.map((row) => row.teacher_id));
    const teacherStates = new Map<string, "present" | "permissionnaire" | "absent">();

    for (const timetable of timetables) {
      const teacherId = String(timetable.teacher_id || "");
      if (!teacherId || teacherStates.get(teacherId) === "present") continue;
      const matching = sessions.some((session) => {
        if (
          session.teacher_id !== timetable.teacher_id ||
          session.class_id !== timetable.class_id ||
          session.subject_id !== timetable.subject_id
        ) return false;
        const calledAt = new Date(session.actual_call_at || session.started_at);
        if (!Number.isFinite(calledAt.getTime())) return false;
        const callMinutes = calledAt.getUTCHours() * 60 + calledAt.getUTCMinutes();
        return callMinutes >= period.startMin && callMinutes <= period.endMin + MAX_CARRY_AFTER_END_MIN;
      });
      teacherStates.set(
        teacherId,
        matching ? "present" : approved.has(teacherId) ? "permissionnaire" : "absent",
      );
    }

    expected = teacherStates.size;
    for (const state of teacherStates.values()) {
      if (state === "present") present += 1;
      else if (state === "permissionnaire") permissionnaire += 1;
      else absent += 1;
    }
  }

  const row = {
    school: institution,
    period,
    periodState,
    expected,
    present,
    permissionnaire,
    absent,
    nextPeriod,
    lastPeriod,
  };

  return {
    source: "relay" as const,
    generated_at: new Date().toISOString(),
    today,
    nowLabel: `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`,
    rows: [row],
    totals: {
      schools: 1,
      activeSchools: period ? 1 : 0,
      expected,
      present,
      permissionnaire,
      absent,
    },
  };
}

function detectWeekdayMode(values: number[]): WeekdayMode {
  const unique = Array.from(new Set(values));
  if (unique.includes(7)) return "iso";
  if (unique.includes(6)) return "js";
  if (unique.includes(0) && !unique.includes(5)) return "mon0";
  return "js";
}

function jsDayToDbWeekday(day: number, mode: WeekdayMode) {
  if (mode === "js") return day;
  if (mode === "iso") return day === 0 ? 7 : day;
  return (day + 6) % 7;
}

function timeToMinutes(value: string) {
  const parts = String(value || "00:00").split(":").map(Number);
  const hour = parts[0] ?? 0;
  const minute = parts[1] ?? 0;
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

function ymd(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function nextYmd(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return ymd(date);
}
