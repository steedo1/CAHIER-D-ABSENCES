// Empty fields must use the configured defaults, not Number("") === 0.
export function parsePayrollAmount(value: unknown, fallback: number) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const number = Number(raw.replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function parsePayrollMinutes(value: unknown, fallback: number) {
  return Math.round(parsePayrollAmount(value, fallback));
}

export function payrollPayable(row: {
  adjusted_amount?: number | string | null;
  gross_amount: number | string;
  lost_amount?: number | string | null;
}) {
  return row.adjusted_amount != null
    ? Number(row.adjusted_amount)
    : Math.max(0, Number(row.gross_amount) - Number(row.lost_amount ?? 0));
}

export type PayrollObservedSession = {
  dateISO: string;
  class_id?: string | null;
  class_ids?: string[];
  subject_id?: string | null;
  subject_ids?: string[];
  period_id?: string | null;
  actual_call_iso?: string | null;
  ended_at?: string | null;
  late_minutes?: number | null;
  observed_minutes?: number | null;
  real_minutes: number;
};

export function assignmentCoversDay(
  assignment: { start_date?: string | null; end_date?: string | null },
  day: string,
) {
  return (!assignment.start_date || assignment.start_date.slice(0, 10) <= day) &&
    (!assignment.end_date || assignment.end_date.slice(0, 10) >= day);
}

export function findPayrollSession<T extends PayrollObservedSession>(
  rows: T[], used: Set<number>,
  slot: {
    session_date: string;
    class_id: string;
    class_ids?: string[];
    subject_id: string;
    subject_ids?: string[];
    period_id: string;
    start_time?: string | null;
  },
) {
  const slotClasses = slot.class_ids?.length ? slot.class_ids : [slot.class_id];
  const slotSubjects = slot.subject_ids?.length ? slot.subject_ids : [slot.subject_id];

  const candidates = rows.flatMap((row, index) => {
    if (used.has(index)) return [];
    const started = new Date(row.dateISO);
    if (!Number.isFinite(started.getTime())) return [];
    // The statistics endpoint groups planned starts in Africa/Abidjan too.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Abidjan", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(started);
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    if (`${part("year")}-${part("month")}-${part("day")}` !== slot.session_date) return [];
    const classes = (row.class_ids?.length ? row.class_ids : [row.class_id])
      .filter((value): value is string => Boolean(value));
    const subjects = (row.subject_ids?.length
      ? row.subject_ids
      : row.subject_id
        ? [row.subject_id]
        : [])
      .filter((value): value is string => Boolean(value));
    if (!classes.some((classId) => slotClasses.includes(classId))) return [];
    if (
      subjects.length &&
      slotSubjects.length &&
      !subjects.some((subjectId) => slotSubjects.includes(subjectId))
    ) return [];
    if (row.period_id) {
      if (row.period_id !== slot.period_id) return [];
    } else {
      const time = slot.start_time?.match(/^(\d{1,2}):(\d{2})/);
      if (!time || `${time[1].padStart(2, "0")}:${time[2]}` !== `${part("hour")}:${part("minute")}`) return [];
    }
    return [index];
  });
  if (candidates.length > 1) {
    throw new Error(`Plusieurs appels correspondent au créneau du ${slot.session_date} à ${slot.start_time || "horaire inconnu"}. Vérifiez ces appels avant de recalculer la paie.`);
  }
  if (!candidates.length) return null;
  used.add(candidates[0]);
  return rows[candidates[0]];
}

export function calculatePayrollSession(
  matched: PayrollObservedSession | null,
  expectedMinutes: number,
  referenceMinutes: number,
  rate: number,
  lateTolerance: number,
  earlyTolerance: number,
) {
  const late = matched ? Math.min(expectedMinutes, Math.max(0,
    matched.late_minutes ?? (expectedMinutes - matched.real_minutes))) : expectedMinutes;
  const closed = Boolean(matched?.ended_at);
  const observed = closed ? Math.max(0, matched?.observed_minutes ?? 0) : 0;
  const credited = closed ? Math.min(Math.max(0, expectedMinutes - late), observed) : 0;
  const held = Boolean(matched?.actual_call_iso) && closed && credited > 0;
  const early = Math.max(0, expectedMinutes - late - credited);
  const lost = held ? Math.min(referenceMinutes,
    Math.max(0, late - lateTolerance) + Math.max(0, early - earlyTolerance)) : expectedMinutes;
  const equivalent = held ? Math.min(1, lost / referenceMinutes) : 0;
  const gross = held ? rate : 0;
  const retained = held ? Math.round(rate * equivalent) : 0;
  return {
    actual_minutes: credited,
    tolerance_minutes: held ? lateTolerance + earlyTolerance : 0,
    lost_minutes_after_tolerance: lost,
    lost_sessions_equivalent: equivalent,
    theoretical_amount: gross,
    lost_amount: retained,
    adjusted_amount: held ? Math.max(0, Math.round(gross - retained)) : 0,
    source_origin: held ? "class_device" : "timetable_expected",
    counted_for_pay: held,
  };
}