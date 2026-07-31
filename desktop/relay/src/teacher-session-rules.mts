import type { RelayDatabase } from "./db.mjs";
import { relayActorClassId, relayActorKind, type AuthenticatedRelayTeacher } from "./teacher-auth.mjs";

export const SESSION_FINALIZATION_GRACE_MINUTES = 10;

export type TeacherScheduledSlot = {
  institutionId: string;
  teacherId: string;
  timezone: string;
  sessionDate: string;
  weekday: number;
  period: {
    id: string;
    label: string | null;
    weekday: number;
    start_time: string;
    end_time: string;
  };
  timetable: { id: string; subject_id: string; teacher_id: string };
  scheduledStartAt: string;
  scheduledEndAt: string;
  graceExpiresAt: string;
};

export class TeacherSessionRuleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(code);
  }
}

export function localDateTime(value: Date | string, timezone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TeacherSessionRuleError(409, "session_time_invalid");
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    throw new TeacherSessionRuleError(409, "institution_timezone_invalid");
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  const weekday = new Map([
    ["Sun", 0], ["Mon", 1], ["Tue", 2], ["Wed", 3],
    ["Thu", 4], ["Fri", 5], ["Sat", 6],
  ]).get(part("weekday"));
  if (weekday === undefined) {
    throw new TeacherSessionRuleError(409, "institution_timezone_invalid");
  }
  return {
    ymd: `${part("year")}-${part("month")}-${part("day")}`,
    weekday,
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
    seconds: Number(part("second")),
  };
}

export function timeMinutes(value: string) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw new TeacherSessionRuleError(409, "period_time_invalid");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new TeacherSessionRuleError(409, "period_time_invalid");
  }
  return hour * 60 + minute;
}

export function weekdayMatches(periodWeekday: number, weekday: number) {
  return periodWeekday === weekday || (weekday === 0 && periodWeekday === 7);
}

export function zonedDateTimeIso(ymd: string, time: string, timezone: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) {
    throw new TeacherSessionRuleError(409, "period_time_invalid");
  }
  let guess = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, 0));
  for (let index = 0; index < 3; index += 1) {
    const local = localDateTime(guess, timezone);
    const [gotYear, gotMonth, gotDay] = local.ymd.split("-").map(Number);
    const gotUtc = Date.UTC(
      gotYear!, gotMonth! - 1, gotDay!,
      Math.floor(local.minutes / 60), local.minutes % 60, local.seconds,
    );
    const wantedUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!, 0);
    const difference = gotUtc - wantedUtc;
    if (difference === 0) break;
    guess = new Date(guess.getTime() - difference);
  }
  return guess.toISOString();
}

export function scheduledSlotTimes(
  sessionDate: string,
  startTime: string,
  endTime: string,
  timezone: string,
) {
  const startMinutes = timeMinutes(startTime);
  const endMinutes = timeMinutes(endTime);
  if (endMinutes <= startMinutes) {
    throw new TeacherSessionRuleError(409, "period_time_invalid");
  }
  const scheduledStartAt = zonedDateTimeIso(sessionDate, startTime, timezone);
  const scheduledEndAt = zonedDateTimeIso(sessionDate, endTime, timezone);
  return {
    scheduledStartAt,
    scheduledEndAt,
    graceExpiresAt: new Date(
      new Date(scheduledEndAt).getTime() + SESSION_FINALIZATION_GRACE_MINUTES * 60_000,
    ).toISOString(),
  };
}

export function resolveTeacherScheduledSlot(
  db: RelayDatabase,
  input: {
    teacher: AuthenticatedRelayTeacher;
    classId: string;
    periodId: string;
    now: Date;
  },
): TeacherScheduledSlot {
  const institution = db.prepare(`
    SELECT timezone FROM institutions
    WHERE id = ? AND deleted_at IS NULL
  `).get(input.teacher.institution_id) as { timezone: string } | undefined;
  if (!institution) throw new TeacherSessionRuleError(404, "institution_not_initialized");

  if (
    relayActorKind(input.teacher) === "class_device" &&
    relayActorClassId(input.teacher) !== input.classId
  ) {
    throw new TeacherSessionRuleError(403, "class_device_class_mismatch");
  }

  const classRow = db.prepare(`
    SELECT 1 FROM classes
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(input.teacher.institution_id, input.classId);
  if (!classRow) throw new TeacherSessionRuleError(404, "class_not_found");

  const period = db.prepare(`
    SELECT id, label, weekday, start_time, end_time
    FROM institution_periods
    WHERE institution_id = ? AND id = ? AND deleted_at IS NULL
  `).get(input.teacher.institution_id, input.periodId) as TeacherScheduledSlot["period"] | undefined;
  if (!period) throw new TeacherSessionRuleError(404, "period_not_found");

  const timezone = String(institution.timezone || "Africa/Abidjan");
  const localNow = localDateTime(input.now, timezone);
  if (localNow.weekday === 0) {
    throw new TeacherSessionRuleError(409, "attendance_sunday_not_allowed");
  }
  const periodStart = timeMinutes(period.start_time);
  const periodEnd = timeMinutes(period.end_time);
  if (periodEnd <= periodStart) {
    throw new TeacherSessionRuleError(409, "period_time_invalid");
  }
  if (
    !weekdayMatches(period.weekday, localNow.weekday) ||
    localNow.minutes < periodStart ||
    localNow.minutes >= periodEnd
  ) {
    throw new TeacherSessionRuleError(409, "attendance_outside_slot");
  }

  const actorKind = relayActorKind(input.teacher);
  const teacherFilter = actorKind === "teacher"
    ? "AND teacher_id = ?"
    : "";
  const params = actorKind === "teacher"
    ? [
        input.teacher.institution_id,
        input.teacher.actor_profile_id,
        input.classId,
        input.periodId,
        localNow.weekday,
        localNow.weekday,
      ]
    : [
        input.teacher.institution_id,
        input.classId,
        input.periodId,
        localNow.weekday,
        localNow.weekday,
      ];
  const timetables = db.prepare(`
    SELECT id, subject_id, teacher_id, server_version, updated_at
    FROM teacher_timetables
    WHERE institution_id = ? ${teacherFilter} AND class_id = ?
      AND period_id = ? AND deleted_at IS NULL
      AND (weekday = ? OR (? = 0 AND weekday = 7))
    ORDER BY server_version DESC, updated_at DESC, id DESC
  `).all(...params) as Array<{
    id: string;
    subject_id: string;
    teacher_id: string;
    server_version: number;
    updated_at: string;
  }>;
  if (timetables.length === 0) {
    throw new TeacherSessionRuleError(
      403,
      actorKind === "class_device"
        ? "class_not_scheduled_for_slot"
        : "teacher_not_scheduled_for_slot",
    );
  }
  if (actorKind === "teacher" && (timetables.length > 1 || !timetables[0])) {
    throw new TeacherSessionRuleError(
      409,
      "teacher_timetable_ambiguous",
    );
  }
  const selectedTimetable = timetables[0];
  if (!selectedTimetable) {
    throw new TeacherSessionRuleError(409, "class_timetable_ambiguous");
  }
  const schedule = scheduledSlotTimes(
    localNow.ymd,
    period.start_time,
    period.end_time,
    timezone,
  );
  return {
    institutionId: input.teacher.institution_id,
    teacherId: selectedTimetable.teacher_id,
    timezone,
    sessionDate: localNow.ymd,
    weekday: localNow.weekday,
    period,
    timetable: selectedTimetable,
    ...schedule,
  };
}
