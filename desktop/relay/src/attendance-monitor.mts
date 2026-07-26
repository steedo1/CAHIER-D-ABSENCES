import type { RelayDatabase } from "./db.mjs";
import type { AttendanceMonitorRow } from "./types.mjs";

type WeekdayMode = "iso" | "js" | "mon0";

type MonitorOptions = {
  institutionId: string;
  from: string;
  to: string;
  now?: Date;
  lateThresholdMinutes?: number;
  missingWindowMinutes?: number;
};

type PeriodRow = {
  id: string;
  weekday: number;
  label: string | null;
  start_time: string;
  end_time: string;
};

type TimetableRow = {
  period_id: string;
  weekday: number | null;
  class_id: string;
  subject_id: string;
  teacher_id: string;
  class_label: string;
  subject_name: string;
  teacher_name: string;
  teacher_phone: string | null;
};

type SessionRow = {
  class_id: string;
  subject_id: string;
  teacher_id: string;
  started_at: string;
  actual_call_at: string | null;
  origin: "teacher" | "class_device" | "admin";
};

type AbsenceRow = {
  teacher_id: string;
  start_date: string;
  end_date: string;
  reason_label: string | null;
  status: "pending" | "approved";
  admin_comment: string | null;
};

const MAX_CARRY_AFTER_END_MINUTES = 120;

export function attendanceMonitor(
  db: RelayDatabase,
  options: MonitorOptions,
): AttendanceMonitorRow[] {
  const fromDate = parseYmd(options.from, "from");
  const toDate = parseYmd(options.to, "to");
  if (fromDate.getTime() > toDate.getTime()) throw new Error("invalid_date_range");
  const now = options.now ?? new Date();
  const today = toYmd(now);
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const lateThreshold = positiveMinutes(options.lateThresholdMinutes, 15);
  const missingWindow = positiveMinutes(options.missingWindowMinutes, lateThreshold);

  const periods = db.prepare(`
    SELECT id, weekday, label, start_time, end_time
    FROM institution_periods
    WHERE institution_id = ? AND deleted_at IS NULL
  `).all(options.institutionId) as PeriodRow[];
  const timetables = db.prepare(`
    SELECT tt.period_id, tt.weekday, tt.class_id, tt.subject_id, tt.teacher_id,
           c.label AS class_label, s.name AS subject_name,
           COALESCE(NULLIF(TRIM(p.display_name), ''), NULLIF(TRIM(p.email), ''),
                    NULLIF(TRIM(p.phone), ''), 'Enseignant') AS teacher_name,
           p.phone AS teacher_phone
    FROM teacher_timetables tt
    JOIN classes c
      ON c.institution_id = tt.institution_id
     AND c.id = tt.class_id
     AND c.deleted_at IS NULL
    JOIN subjects s
      ON s.institution_id = tt.institution_id
     AND s.id = tt.subject_id
     AND s.deleted_at IS NULL
    JOIN profiles p
      ON p.institution_id = tt.institution_id
     AND p.id = tt.teacher_id
     AND p.deleted_at IS NULL
    WHERE tt.institution_id = ? AND tt.deleted_at IS NULL
  `).all(options.institutionId) as TimetableRow[];

  const dateAfterTo = new Date(toDate);
  dateAfterTo.setUTCDate(dateAfterTo.getUTCDate() + 1);
  const sessions = db.prepare(`
    SELECT class_id, subject_id, teacher_id, started_at, actual_call_at, origin
    FROM teacher_sessions
    WHERE institution_id = ? AND deleted_at IS NULL
      AND started_at >= ? AND started_at < ?
  `).all(
    options.institutionId,
    `${options.from}T00:00:00.000Z`,
    `${toYmd(dateAfterTo)}T00:00:00.000Z`,
  ) as SessionRow[];
  const absences = db.prepare(`
    SELECT teacher_id, start_date, end_date, reason_label, status, admin_comment
    FROM teacher_absence_requests
    WHERE institution_id = ? AND deleted_at IS NULL
      AND status IN ('pending', 'approved')
      AND start_date <= ? AND end_date >= ?
  `).all(options.institutionId, options.to, options.from) as AbsenceRow[];

  const mode = detectWeekdayMode(periods.map((period) => period.weekday));
  const datesByWeekday = new Map<number, string[]>();
  for (const date of enumerateDates(fromDate, toDate)) {
    const weekday = jsDayToDbWeekday(date.getUTCDay(), mode);
    datesByWeekday.set(weekday, [...(datesByWeekday.get(weekday) ?? []), toYmd(date)]);
  }
  const periodById = new Map(periods.map((period) => [period.id, period]));
  const sessionsIndex = indexSessions(sessions);
  const absenceIndex = indexAbsences(absences);
  const nextStart = nextStartBySlot(timetables, periodById);
  const rows: AttendanceMonitorRow[] = [];

  for (const timetable of timetables) {
    const period = periodById.get(timetable.period_id);
    if (!period || !sameWeekday(period.weekday, timetable.weekday)) continue;
    const dates = datesByWeekday.get(period.weekday) ?? [];
    const startMinutes = timeToMinutes(period.start_time);
    const endMinutes = timeToMinutes(period.end_time);
    const group = [
      period.weekday,
      timetable.class_id,
      timetable.subject_id,
      timetable.teacher_id,
    ].join("|");
    const followingStart = nextStart.get(`${group}|${period.id}`) ?? null;

    for (const date of dates) {
      const sessionKey = [
        date,
        timetable.class_id,
        timetable.subject_id,
        timetable.teacher_id,
      ].join("|");
      const best = (sessionsIndex.get(sessionKey) ?? [])
        .filter(
          (session) =>
            session.callMinutes >= startMinutes &&
            session.callMinutes <= endMinutes + MAX_CARRY_AFTER_END_MINUTES &&
            (followingStart === null || session.callMinutes < followingStart),
        )
        .sort((a, b) => a.callMinutes - b.callMinutes)[0];

      let status: AttendanceMonitorRow["status"];
      let lateMinutes: number | null = null;
      let openedFrom: AttendanceMonitorRow["opened_from"] = null;
      let absenceStatus: AttendanceMonitorRow["absence_request_status"] = null;
      let absenceReason: string | null = null;
      let absenceComment: string | null = null;

      if (best) {
        const delta = best.callMinutes - startMinutes;
        status = delta <= lateThreshold ? "ok" : "late";
        lateMinutes = status === "late" ? delta : null;
        openedFrom = best.origin === "admin" ? null : best.origin;
      } else {
        const isPast = date < today;
        const isDueToday = date === today && nowMinutes >= startMinutes + missingWindow;
        if (!isPast && !isDueToday) continue;
        status = "missing";
        const absence = absenceIndex.get(`${date}|${timetable.teacher_id}`);
        if (absence) {
          absenceStatus = absence.status;
          absenceReason = absence.reason_label;
          absenceComment = absence.admin_comment;
          status = absence.status === "approved" ? "justified_absence" : "pending_absence";
        }
      }

      rows.push({
        id: [date, period.id, timetable.class_id, timetable.subject_id, timetable.teacher_id].join("|"),
        date,
        period_label: period.label || `${hm(period.start_time)} – ${hm(period.end_time)}`,
        planned_start: hm(period.start_time),
        planned_end: hm(period.end_time),
        class_label: timetable.class_label || null,
        subject_name: timetable.subject_name || null,
        teacher_name: timetable.teacher_name,
        teacher_phone: timetable.teacher_phone,
        status,
        late_minutes: lateMinutes,
        opened_from: openedFrom,
        absence_request_status: absenceStatus,
        absence_reason_label: absenceReason,
        absence_admin_comment: absenceComment,
      });
    }
  }

  return rows.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    String(a.planned_start).localeCompare(String(b.planned_start)) ||
    String(a.class_label).localeCompare(String(b.class_label), "fr"),
  );
}

function indexSessions(rows: SessionRow[]) {
  const index = new Map<
    string,
    { callMinutes: number; origin: SessionRow["origin"] }[]
  >();
  for (const row of rows) {
    const callAt = row.actual_call_at || row.started_at;
    const callDate = new Date(callAt);
    if (!Number.isFinite(callDate.getTime())) continue;
    const key = [toYmd(callDate), row.class_id, row.subject_id, row.teacher_id].join("|");
    const value = {
      callMinutes: callDate.getUTCHours() * 60 + callDate.getUTCMinutes(),
      origin: row.origin,
    };
    index.set(key, [...(index.get(key) ?? []), value]);
  }
  return index;
}

function indexAbsences(rows: AbsenceRow[]) {
  const index = new Map<string, AbsenceRow>();
  for (const row of rows) {
    const start = parseYmd(row.start_date, "absence_start_date");
    const end = parseYmd(row.end_date, "absence_end_date");
    for (const day of enumerateDates(start, end)) {
      const key = `${toYmd(day)}|${row.teacher_id}`;
      const current = index.get(key);
      if (!current || (current.status === "pending" && row.status === "approved")) {
        index.set(key, row);
      }
    }
  }
  return index;
}

function nextStartBySlot(
  timetables: TimetableRow[],
  periodById: Map<string, PeriodRow>,
) {
  const groups = new Map<string, Map<string, number>>();
  for (const timetable of timetables) {
    const period = periodById.get(timetable.period_id);
    if (!period || !sameWeekday(period.weekday, timetable.weekday)) continue;
    const group = [
      period.weekday,
      timetable.class_id,
      timetable.subject_id,
      timetable.teacher_id,
    ].join("|");
    const slots = groups.get(group) ?? new Map<string, number>();
    slots.set(period.id, timeToMinutes(period.start_time));
    groups.set(group, slots);
  }
  const result = new Map<string, number | null>();
  for (const [group, slots] of groups) {
    const ordered = Array.from(slots, ([periodId, start]) => ({ periodId, start }))
      .sort((a, b) => a.start - b.start);
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      if (!current) continue;
      result.set(`${group}|${current.periodId}`, ordered[index + 1]?.start ?? null);
    }
  }
  return result;
}

function detectWeekdayMode(values: number[]): WeekdayMode {
  const unique = new Set(values);
  if (unique.has(7)) return "iso";
  if (unique.has(6)) return "js";
  if (unique.has(0) && !unique.has(5)) return "mon0";
  return "js";
}

function jsDayToDbWeekday(day: number, mode: WeekdayMode) {
  if (mode === "js") return day;
  if (mode === "iso") return day === 0 ? 7 : day;
  return (day + 6) % 7;
}

function sameWeekday(periodWeekday: number, timetableWeekday: number | null) {
  return timetableWeekday !== null && (
    periodWeekday === timetableWeekday ||
    (periodWeekday === 0 && timetableWeekday === 7) ||
    (periodWeekday === 7 && timetableWeekday === 0)
  );
}

function parseYmd(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}_invalid`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || toYmd(date) !== value) throw new Error(`${label}_invalid`);
  return date;
}

function enumerateDates(from: Date, to: Date) {
  const result: Date[] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    result.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function toYmd(value: Date) {
  return value.toISOString().slice(0, 10);
}

function timeToMinutes(value: string) {
  const normalized = hm(value);
  if (!normalized) return 0;
  const [hours = 0, minutes = 0] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function hm(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1]?.padStart(2, "0")}:${match[2]}` : null;
}

function positiveMinutes(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(Number(value))) : fallback;
}
