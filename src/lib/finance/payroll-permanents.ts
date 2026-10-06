export type PermanentCycle = "college" | "lycee";

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function permanentCycle(value: unknown): PermanentCycle | null {
  return value === "college" || value === "lycee" ? value : null;
}

export function permanentWeeklyQuota(cycle: PermanentCycle) {
  return cycle === "college" ? 21 : 18;
}

export function payrollTeacherRate(
  employmentType: "permanent" | "vacataire",
  category: PermanentCycle | null,
  classCycle: "first_cycle" | "second_cycle",
  rateFirst: number,
  rateSecond: number,
) {
  if (employmentType === "permanent") {
    if (!category) throw new Error("Quota du permanent à renseigner.");
    // Permanent overtime has one rate based on the teacher's category,
    // even when that teacher serves classes in both school cycles.
    return category === "lycee" ? rateSecond : rateFirst;
  }
  return classCycle === "second_cycle" ? rateSecond : rateFirst;
}

export function permanentCyclesFromSettings(settings: unknown) {
  const payroll = objectValue(objectValue(settings).teacher_payroll);
  return objectValue(payroll.permanent_cycles);
}

export function settingsWithPermanentCycle(settings: unknown, teacherId: string, cycle: PermanentCycle | null) {
  const root = objectValue(settings);
  const payroll = objectValue(root.teacher_payroll);
  const cycles = { ...permanentCyclesFromSettings(settings) };
  if (cycle) cycles[teacherId] = cycle;
  else delete cycles[teacherId];
  return { ...root, teacher_payroll: { ...payroll, permanent_cycles: cycles } };
}

// School service is counted in pedagogical hours: one physical timetable
// period is one unit, just as in the existing vacation payroll calculation.
// A grouped class period remains one unit. Weeks run Monday to Sunday.
export function payrollWeekStart(day: string) {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error("Date de séance invalide.");
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function payrollFullWeeks(start: string, end: string) {
  const last = new Date(`${payrollWeekStart(end)}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 6);
  return { periodStart: payrollWeekStart(start), periodEnd: last.toISOString().slice(0, 10) };
}

type OvertimeSession = {
  session_date: string;
  start_time?: string | null;
  period_id?: string | null;
  counted_for_pay: boolean;
  actual_minutes: number;
  lost_minutes_after_tolerance: number;
  lost_sessions_equivalent: number;
  theoretical_amount: number;
  lost_amount: number;
  adjusted_amount: number;
  source_origin: string;
};

export type PermanentPayrollSnapshot = {
  kind: "permanent_overtime_v1";
  cycle: PermanentCycle;
  weekly_quota: number;
  service_sessions: number;
  overtime_sessions: number;
  expected_overtime_sessions: number;
  notes: string | null;
};

export function permanentPayrollSnapshot(notes: string | null | undefined): PermanentPayrollSnapshot | null {
  try {
    const value = JSON.parse(notes || "null");
    if (value?.kind !== "permanent_overtime_v1" || !permanentCycle(value.cycle)) return null;
    return value as PermanentPayrollSnapshot;
  } catch {
    return null;
  }
}

export function allocatePermanentOvertime<T extends OvertimeSession>(sessions: T[], cycle: PermanentCycle) {
  const quota = permanentWeeklyQuota(cycle);
  const usedByWeek = new Map<string, number>();
  // Sort on the planned start (also supplied for extra-timetable sessions),
  // so database result ordering cannot change which cycle's rate is applied.
  return [...sessions].sort((a, b) =>
    `${a.session_date}|${a.start_time || ""}|${a.period_id || ""}`.localeCompare(
      `${b.session_date}|${b.start_time || ""}|${b.period_id || ""}`,
    ),
  ).map((session) => {
    const week = payrollWeekStart(session.session_date);
    const used = usedByWeek.get(week) || 0;
    const held = session.counted_for_pay;
    if (held) usedByWeek.set(week, used + 1);
    const overtime = held && used >= quota;
    return {
      ...session,
      service_held: held,
      counted_for_pay: overtime,
      actual_minutes: overtime ? session.actual_minutes : 0,
      lost_minutes_after_tolerance: overtime ? session.lost_minutes_after_tolerance : 0,
      lost_sessions_equivalent: overtime ? session.lost_sessions_equivalent : 0,
      theoretical_amount: overtime ? session.theoretical_amount : 0,
      lost_amount: overtime ? session.lost_amount : 0,
      adjusted_amount: overtime ? session.adjusted_amount : 0,
      source_origin: held && !overtime ? `permanent_service:${session.source_origin}` : session.source_origin,
    };
  });
}

export function expectedPermanentOvertime<T extends { session_date: string }>(slots: T[], cycle: PermanentCycle) {
  const usedByWeek = new Map<string, number>();
  return slots.filter((slot) => {
    const week = payrollWeekStart(slot.session_date);
    const used = usedByWeek.get(week) || 0;
    usedByWeek.set(week, used + 1);
    return used >= permanentWeeklyQuota(cycle);
  });
}
