import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type QueryResult<T> = { data: T | null; error: { message?: string } | null };

type WeekdayMode = "iso" | "js" | "mon0";

export type PeriodRow = {
  id: string;
  institution_id: string;
  weekday: number | null;
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  startMin: number;
  endMin: number;
};

export type SchoolSummary = {
  school: any;
  period: PeriodRow | null;
  periodState: "current" | "upcoming" | "closed" | "none";
  expected: number;
  present: number;
  permissionnaire: number;
  absent: number;
  nextPeriod: PeriodRow | null;
  lastPeriod: PeriodRow | null;
};

const CIV_TIME_ZONE = "Africa/Abidjan";
const MAX_CARRY_AFTER_END_MIN = 120;

function toYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CIV_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getCivNow() {
  const now = new Date();
  const today = todayYmd();
  return {
    today,
    jsWeekday: new Date(`${today}T00:00:00.000Z`).getUTCDay(),
    nowMinutes: now.getUTCHours() * 60 + now.getUTCMinutes(),
    nowLabel: `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`,
  };
}

function dayBoundsIso(ymd: string) {
  const start = new Date(`${ymd}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function hmsToMin(hms: string | null | undefined): number {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function isoToYMD(iso: string): string {
  return toYMD(new Date(iso));
}

function isoToHM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function normalizeTimeFromDb(raw: string | null | undefined): string | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function parseWeekday(raw: any): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

function detectWeekdayMode(periods: any[]): WeekdayMode {
  const vals = Array.from(
    new Set(
      (periods || [])
        .map((p) => parseWeekday(p?.weekday))
        .filter((v): v is number => v !== null && v !== undefined),
    ),
  );

  // Convention utilisée par l'app : 0 = dimanche, 1 = lundi, ..., 6 = samedi.
  // Avant, une semaine scolaire lundi-vendredi (1..5) était prise pour du "mon0"
  // et le mardi était lu comme lundi dans les vues temps réel.
  if (vals.includes(7)) return "iso";
  if (vals.includes(6)) return "js";
  if (vals.includes(0) && !vals.includes(5)) return "mon0";

  return "js";
}

function jsDayToDbWeekday(jsDay0to6: number, mode: WeekdayMode): number {
  if (mode === "js") return jsDay0to6;
  if (mode === "iso") return jsDay0to6 === 0 ? 7 : jsDay0to6;
  return (jsDay0to6 + 6) % 7;
}

function formatPeriod(row: PeriodRow | null) {
  if (!row) return "Aucun créneau";
  const start = normalizeTimeFromDb(row.start_time) || "--:--";
  const end = normalizeTimeFromDb(row.end_time) || "--:--";
  return `${start} - ${end}`;
}

function periodTitle(row: PeriodRow | null) {
  if (!row) return "Aucun créneau";
  const label = String(row.label || "").trim();
  const hours = formatPeriod(row);
  return label ? `${label} • ${hours}` : hours;
}

async function safeData<T>(label: string, query: PromiseLike<QueryResult<T>>, fallback: T): Promise<T> {
  try {
    const res = await query;
    if (res?.error) {
      console.warn(`[founder/attendance-slots] ${label}:`, res.error.message || res.error);
      return fallback;
    }
    return (res?.data ?? fallback) as T;
  } catch (e: any) {
    console.warn(`[founder/attendance-slots] ${label}:`, e?.message || e);
    return fallback;
  }
}

function buildPeriods(rawPeriods: any[]) {
  const periods: PeriodRow[] = (rawPeriods || []).map((p: any) => ({
    id: String(p.id),
    institution_id: String(p.institution_id),
    weekday: parseWeekday(p.weekday),
    label: (p.label as string | null) ?? null,
    start_time: normalizeTimeFromDb(p.start_time),
    end_time: normalizeTimeFromDb(p.end_time),
    startMin: hmsToMin(p.start_time),
    endMin: hmsToMin(p.end_time),
  }));

  return periods.sort((a, b) => {
    if (a.institution_id !== b.institution_id) return a.institution_id.localeCompare(b.institution_id);
    if ((a.weekday ?? 0) !== (b.weekday ?? 0)) return (a.weekday ?? 0) - (b.weekday ?? 0);
    return a.startMin - b.startMin;
  });
}

function getSchoolPeriodState(params: {
  periods: PeriodRow[];
  institutionId: string;
  todayDbWeekday: number;
  nowMinutes: number;
}) {
  const schoolPeriodsToday = params.periods
    .filter((period) => period.institution_id === params.institutionId)
    .filter((period) => period.weekday === params.todayDbWeekday)
    .sort((a, b) => a.startMin - b.startMin);

  const current =
    schoolPeriodsToday.find(
      (period) => params.nowMinutes >= period.startMin && params.nowMinutes < period.endMin,
    ) || null;

  const nextPeriod = schoolPeriodsToday.find((period) => period.startMin > params.nowMinutes) || null;
  const lastPeriod =
    [...schoolPeriodsToday].reverse().find((period) => period.endMin <= params.nowMinutes) || null;

  if (current) {
    return { period: current, periodState: "current" as const, nextPeriod, lastPeriod };
  }

  if (nextPeriod) {
    return { period: null, periodState: "upcoming" as const, nextPeriod, lastPeriod };
  }

  if (lastPeriod) {
    return { period: null, periodState: "closed" as const, nextPeriod, lastPeriod };
  }

  return { period: null, periodState: "none" as const, nextPeriod: null, lastPeriod: null };
}

function sessionCallMinutes(session: any) {
  const callIso = (session.actual_call_at as string | null) || (session.started_at as string | null);
  if (!callIso) return null;
  return {
    ymd: isoToYMD(callIso),
    callMin: hmToMin(isoToHM(callIso)),
  };
}

function buildSessionsIndex(sessions: any[], today: string) {
  const index = new Map<string, number[]>();

  (sessions || []).forEach((session: any) => {
    const call = sessionCallMinutes(session);
    if (!call || call.ymd !== today) return;

    const key = [
      today,
      String(session.institution_id || ""),
      String(session.class_id || ""),
      String(session.subject_id || ""),
      String(session.teacher_id || ""),
    ].join("|");

    const arr = index.get(key) || [];
    arr.push(call.callMin);
    index.set(key, arr);
  });

  return index;
}

function buildApprovedAbsenceIndex(absenceRequests: any[], today: string) {
  const index = new Set<string>();

  (absenceRequests || []).forEach((request: any) => {
    const institutionId = String(request.institution_id || "");
    const teacherId = String(request.teacher_profile_id || "");
    const start = String(request.start_date || "");
    const end = String(request.end_date || "");
    const status = String(request.status || "");

    if (!institutionId || !teacherId || status !== "approved") return;
    if (start && start > today) return;
    if (end && end < today) return;

    index.add(`${institutionId}|${teacherId}`);
  });

  return index;
}

function buildNextStartIndex(timetables: any[], periodsById: Map<string, PeriodRow>) {
  type SlotLite = { period_id: string; startMin: number };

  const slotsByGroup = new Map<string, Map<string, SlotLite>>();
  const nextStartMinBySlot = new Map<string, number | null>();

  (timetables || []).forEach((tt: any) => {
    const period = periodsById.get(String(tt.period_id));
    if (!period) return;

    const weekday = period.weekday;
    const institutionId = String(tt.institution_id || "");
    const classId = String(tt.class_id || "");
    const subjectId = String(tt.subject_id || "");
    const teacherId = String(tt.teacher_id || "");
    const periodId = String(tt.period_id || "");

    if (!institutionId || !classId || !teacherId || weekday === null) return;

    const group = `${institutionId}|${weekday}|${classId}|${subjectId}|${teacherId}`;
    let groupSlots = slotsByGroup.get(group);

    if (!groupSlots) {
      groupSlots = new Map<string, SlotLite>();
      slotsByGroup.set(group, groupSlots);
    }

    if (!groupSlots.has(periodId)) {
      groupSlots.set(periodId, { period_id: periodId, startMin: period.startMin });
    }
  });

  for (const [group, groupSlots] of slotsByGroup.entries()) {
    const arr = Array.from(groupSlots.values()).sort((a, b) => a.startMin - b.startMin);

    for (let i = 0; i < arr.length; i++) {
      const current = arr[i];
      const next = arr[i + 1] || null;
      nextStartMinBySlot.set(`${group}|${current.period_id}`, next ? next.startMin : null);
    }
  }

  return nextStartMinBySlot;
}

function hasMatchingSession(params: {
  tt: any;
  period: PeriodRow;
  today: string;
  sessionsIndex: Map<string, number[]>;
  nextStartMinBySlot: Map<string, number | null>;
}) {
  const classId = String(params.tt.class_id || "");
  const subjectId = String(params.tt.subject_id || "");
  const teacherId = String(params.tt.teacher_id || "");
  const institutionId = String(params.tt.institution_id || "");

  const key = [params.today, institutionId, classId, subjectId, teacherId].join("|");
  const calls = params.sessionsIndex.get(key) || [];
  if (!calls.length) return false;

  const group = `${institutionId}|${params.period.weekday}|${classId}|${subjectId}|${teacherId}`;
  const nextStartMin = params.nextStartMinBySlot.get(`${group}|${String(params.tt.period_id || "")}`) ?? null;

  return calls.some((callMin) => {
    if (callMin < params.period.startMin) return false;
    if (callMin > params.period.endMin + MAX_CARRY_AFTER_END_MIN) return false;
    if (nextStartMin !== null && callMin >= nextStartMin) return false;
    return true;
  });
}

function computeSchoolSummary(params: {
  school: any;
  period: PeriodRow | null;
  periodState: SchoolSummary["periodState"];
  nextPeriod: PeriodRow | null;
  lastPeriod: PeriodRow | null;
  today: string;
  timetables: any[];
  sessionsIndex: Map<string, number[]>;
  approvedAbsenceIndex: Set<string>;
  nextStartMinBySlot: Map<string, number | null>;
}): SchoolSummary {
  if (!params.period) {
    return {
      school: params.school,
      period: null,
      periodState: params.periodState,
      expected: 0,
      present: 0,
      permissionnaire: 0,
      absent: 0,
      nextPeriod: params.nextPeriod,
      lastPeriod: params.lastPeriod,
    };
  }

  const schoolId = String(params.school.id || "");
  const periodId = String(params.period.id || "");

  const currentTimetables = (params.timetables || []).filter(
    (tt: any) => String(tt.institution_id || "") === schoolId && String(tt.period_id || "") === periodId,
  );

  const teacherState = new Map<string, "present" | "permissionnaire" | "absent">();

  currentTimetables.forEach((tt: any) => {
    const teacherId = String(tt.teacher_id || "");
    if (!teacherId) return;

    const currentState = teacherState.get(teacherId);
    if (currentState === "present") return;

    const isPresent = hasMatchingSession({
      tt,
      period: params.period!,
      today: params.today,
      sessionsIndex: params.sessionsIndex,
      nextStartMinBySlot: params.nextStartMinBySlot,
    });

    if (isPresent) {
      teacherState.set(teacherId, "present");
      return;
    }

    if (currentState === "permissionnaire") return;

    const hasApprovedAbsence = params.approvedAbsenceIndex.has(`${schoolId}|${teacherId}`);
    teacherState.set(teacherId, hasApprovedAbsence ? "permissionnaire" : "absent");
  });

  let present = 0;
  let permissionnaire = 0;
  let absent = 0;

  teacherState.forEach((state) => {
    if (state === "present") present += 1;
    else if (state === "permissionnaire") permissionnaire += 1;
    else absent += 1;
  });

  return {
    school: params.school,
    period: params.period,
    periodState: params.periodState,
    expected: teacherState.size,
    present,
    permissionnaire,
    absent,
    nextPeriod: params.nextPeriod,
    lastPeriod: params.lastPeriod,
  };
}

function statusText(row: SchoolSummary) {
  if (row.periodState === "current") return `Créneau actuel : ${formatPeriod(row.period)}`;
  if (row.periodState === "upcoming") return `Prochain créneau : ${formatPeriod(row.nextPeriod)}`;
  if (row.periodState === "closed") return `Dernier créneau : ${formatPeriod(row.lastPeriod)}`;
  return "Aucun créneau configuré aujourd’hui";
}

function statusBadgeClass(row: SchoolSummary) {
  if (row.periodState !== "current") return "border-slate-200 bg-slate-50 text-slate-600";
  if (row.absent > 0) return "border-rose-200 bg-rose-50 text-rose-700";
  if (row.permissionnaire > 0) return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}


export type FounderAttendancePayload = {
  source: "cloud" | "relay" | "cache";
  generated_at: string;
  today: string;
  nowLabel: string;
  rows: SchoolSummary[];
  totals: {
    schools: number;
    activeSchools: number;
    expected: number;
    present: number;
    permissionnaire: number;
    absent: number;
  };
};

export async function loadFounderAttendancePayload(userId: string): Promise<FounderAttendancePayload> {
  const service = getSupabaseServiceClient();

  const roles = await safeData<any[]>(
    "user_roles",
    service.from("user_roles").select("institution_id").eq("profile_id", userId).eq("role", "founder"),
    [],
  );

  const institutionIds: string[] = Array.from(
    new Set((roles ?? []).map((row: any) => String(row.institution_id || "")).filter(Boolean)),
  );
  if (!institutionIds.length) throw new Error("no_institution");

  const { today, jsWeekday, nowMinutes, nowLabel } = getCivNow();
  const { startIso, endIso } = dayBoundsIso(today);

  const [institutions, rawPeriods, timetables, sessions, absenceRequests] = await Promise.all([
    safeData<any[]>(
      "institutions",
      service.from("institutions").select("id,name").in("id", institutionIds).order("name"),
      [],
    ),
    safeData<any[]>(
      "institution_periods",
      service
        .from("institution_periods")
        .select("id,institution_id,label,start_time,end_time,weekday,is_active")
        .in("institution_id", institutionIds)
        .eq("is_active", true),
      [],
    ),
    safeData<any[]>(
      "teacher_timetables",
      service
        .from("teacher_timetables")
        .select("id,institution_id,class_id,subject_id,teacher_id,weekday,period_id")
        .in("institution_id", institutionIds),
      [],
    ),
    safeData<any[]>(
      "teacher_sessions",
      service
        .from("teacher_sessions")
        .select("id,institution_id,class_id,subject_id,teacher_id,started_at,actual_call_at,origin")
        .in("institution_id", institutionIds)
        .gte("started_at", startIso)
        .lt("started_at", endIso),
      [],
    ),
    safeData<any[]>(
      "teacher_absence_requests",
      service
        .from("teacher_absence_requests")
        .select("id,institution_id,teacher_profile_id,start_date,end_date,status")
        .in("institution_id", institutionIds)
        .eq("status", "approved")
        .lte("start_date", today)
        .gte("end_date", today),
      [],
    ),
  ]);

  const periods = buildPeriods(rawPeriods);
  const periodsById = new Map(periods.map((period) => [period.id, period]));
  const weekdayMode = detectWeekdayMode(rawPeriods || []);
  const todayDbWeekday = jsDayToDbWeekday(jsWeekday, weekdayMode);
  const sessionsIndex = buildSessionsIndex(sessions, today);
  const approvedAbsenceIndex = buildApprovedAbsenceIndex(absenceRequests, today);
  const nextStartMinBySlot = buildNextStartIndex(timetables, periodsById);

  const rows: SchoolSummary[] = (institutions ?? []).map((school: any) => {
    const periodState = getSchoolPeriodState({
      periods,
      institutionId: String(school.id),
      todayDbWeekday,
      nowMinutes,
    });

    return computeSchoolSummary({
      school,
      today,
      timetables,
      sessionsIndex,
      approvedAbsenceIndex,
      nextStartMinBySlot,
      ...periodState,
    });
  });

  const activeRows = rows.filter((row) => row.periodState === "current");
  return {
    source: "cloud",
    generated_at: new Date().toISOString(),
    today,
    nowLabel,
    rows,
    totals: {
      schools: rows.length,
      activeSchools: activeRows.length,
      expected: activeRows.reduce((sum, row) => sum + row.expected, 0),
      present: activeRows.reduce((sum, row) => sum + row.present, 0),
      permissionnaire: activeRows.reduce((sum, row) => sum + row.permissionnaire, 0),
      absent: activeRows.reduce((sum, row) => sum + row.absent, 0),
    },
  };
}
