// src/app/founder/attendance-slots/page.tsx
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  School2,
  ShieldCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type QueryResult<T> = { data: T | null; error: { message?: string } | null };

type WeekdayMode = "iso" | "js" | "mon0";

type PeriodRow = {
  id: string;
  institution_id: string;
  weekday: number | null;
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  startMin: number;
  endMin: number;
};

type SchoolSummary = {
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

  if (vals.includes(7)) return "iso";

  const max = vals.length ? Math.max(...vals) : 6;

  if (max === 5) return "mon0";
  if (vals.includes(0) && max === 6) return "js";

  return "iso";
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

export default async function FounderAttendanceSlotsPage() {
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const roles = await safeData<any[]>(
    "user_roles",
    service.from("user_roles").select("institution_id").eq("profile_id", user.id).eq("role", "founder"),
    [],
  );

  const institutionIds: string[] = Array.from(
    new Set((roles ?? []).map((row: any) => String(row.institution_id || "")).filter(Boolean)),
  );

  if (!institutionIds.length) redirect("/profile");

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
  const totalExpected = activeRows.reduce((sum, row) => sum + row.expected, 0);
  const totalPresent = activeRows.reduce((sum, row) => sum + row.present, 0);
  const totalPermissionnaire = activeRows.reduce((sum, row) => sum + row.permissionnaire, 0);
  const totalAbsent = activeRows.reduce((sum, row) => sum + row.absent, 0);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 p-5 text-white shadow-xl sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-200">
              Vue créneau fondateur
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">
              Résumé temps réel par établissement
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-200 sm:text-base">
              Lecture simplifiée : présents, permissionnaires et absents uniquement. Un appel fait compte comme présent.
            </p>
          </div>

          <div className="rounded-[26px] border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-sky-100">Aujourd’hui</div>
            <div className="mt-1 text-2xl font-black">{today}</div>
            <div className="mt-1 text-sm font-semibold text-slate-200">Actualisé à {nowLabel}</div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
            <School2 className="h-4 w-4" /> Écoles suivies
          </div>
          <div className="mt-3 text-3xl font-black text-slate-950">{rows.length}</div>
          <p className="mt-1 text-xs font-semibold text-slate-500">Établissements rattachés</p>
        </div>

        <div className="rounded-[28px] border border-sky-100 bg-sky-50 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-sky-700">
            <Clock3 className="h-4 w-4" /> Créneau en cours
          </div>
          <div className="mt-3 text-3xl font-black text-sky-900">{activeRows.length}</div>
          <p className="mt-1 text-xs font-semibold text-sky-800">École(s) actuellement dans un créneau</p>
        </div>

        <div className="rounded-[28px] border border-emerald-100 bg-emerald-50 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Présents
          </div>
          <div className="mt-3 text-3xl font-black text-emerald-900">{totalPresent}</div>
          <p className="mt-1 text-xs font-semibold text-emerald-800">Appels faits sur le créneau actuel</p>
        </div>

        <div className="rounded-[28px] border border-sky-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-sky-700">
            <ShieldCheck className="h-4 w-4" /> Permissionnaires
          </div>
          <div className="mt-3 text-3xl font-black text-sky-900">{totalPermissionnaire}</div>
          <p className="mt-1 text-xs font-semibold text-sky-800">Demandes autorisées</p>
        </div>

        <div className="rounded-[28px] border border-rose-100 bg-rose-50 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-rose-700">
            <XCircle className="h-4 w-4" /> Absents
          </div>
          <div className="mt-3 text-3xl font-black text-rose-900">{totalAbsent}</div>
          <p className="mt-1 text-xs font-semibold text-rose-800">Appels non faits sans autorisation</p>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-slate-950">
              <UsersRound className="h-4 w-4 text-slate-500" /> Supervision des établissements
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              Total attendu sur les créneaux en cours : {totalExpected} enseignant(s)
            </p>
          </div>

          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-600">
            Présent = appel fait
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {rows.length === 0 ? (
          <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800">
            Aucune école rattachée trouvée pour ce compte fondateur.
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.school.id} className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-black text-slate-950">
                    <School2 className="h-4 w-4 shrink-0 text-slate-500" />
                    <span className="truncate">{row.school.name || "Établissement"}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusBadgeClass(row)}`}>
                      {statusText(row)}
                    </span>
                    {row.periodState === "current" ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                        En cours
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="w-fit rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600">
                  {row.expected} prof(s) attendu(s)
                </div>
              </div>

              {row.periodState === "current" ? (
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-center">
                    <div className="mx-auto grid h-9 w-9 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div className="mt-2 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">
                      Présents
                    </div>
                    <div className="mt-1 text-3xl font-black text-emerald-900">{row.present}</div>
                  </div>

                  <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-center">
                    <div className="mx-auto grid h-9 w-9 place-items-center rounded-xl bg-white text-sky-700 shadow-sm">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div className="mt-2 text-[11px] font-black uppercase tracking-[0.14em] text-sky-700">
                      Permissionnaires
                    </div>
                    <div className="mt-1 text-3xl font-black text-sky-900">{row.permissionnaire}</div>
                  </div>

                  <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-center">
                    <div className="mx-auto grid h-9 w-9 place-items-center rounded-xl bg-white text-rose-700 shadow-sm">
                      <XCircle className="h-4 w-4" />
                    </div>
                    <div className="mt-2 text-[11px] font-black uppercase tracking-[0.14em] text-rose-700">
                      Absents
                    </div>
                    <div className="mt-1 text-3xl font-black text-rose-900">{row.absent}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-slate-500 shadow-sm">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-black text-slate-800">Aucun créneau en cours</div>
                      <p className="mt-1 text-sm font-medium leading-6 text-slate-500">
                        Les compteurs présents, permissionnaires et absents s’affichent dès qu’un créneau est actif dans cet établissement.
                      </p>
                      {row.nextPeriod ? (
                        <p className="mt-2 text-xs font-black text-sky-700">
                          Prochain : {periodTitle(row.nextPeriod)}
                        </p>
                      ) : row.lastPeriod ? (
                        <p className="mt-2 text-xs font-black text-slate-600">
                          Dernier : {periodTitle(row.lastPeriod)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
