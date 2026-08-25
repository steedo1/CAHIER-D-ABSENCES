// src/app/admin/finance/payroll/page.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import {
  BadgeCheck,
  CalendarClock,
  Printer,
  RefreshCcw,
  Users,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";
import {
  AcademicYearSelector,
  getFinanceAcademicYearContext,
} from "../_shared/academic-year";

export const dynamic = "force-dynamic";

type EmploymentType = "vacataire" | "permanent";
type PayrollStatus = "draft" | "validated" | "cancelled";
type SchoolCycle = "first_cycle" | "second_cycle";

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

type PayrollTeacherRow = {
  profile_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  employment_type: EmploymentType;
  payroll_enabled: boolean;
  notes: string | null;
};

type TeacherPayrollRunRow = {
  id: string;
  institution_id: string;
  period_month: string;
  period_start: string;
  period_end: string;
  scope: "vacataires_only" | "all_teachers";
  default_rate_first_cycle: number | string;
  default_rate_second_cycle: number | string;
  status: PayrollStatus;
  generated_at: string;
  validated_at: string | null;
  notes: string | null;
  academic_year_id?: string | null;
  academic_year?: string | null;
  late_tolerance_min?: number | string | null;
  early_departure_tolerance_min?: number | string | null;
  session_reference_minutes?: number | string | null;
};

type TeacherPayrollLineRow = {
  id: string;
  run_id: string;
  teacher_id: string;
  teacher_name_snapshot: string | null;
  employment_type: EmploymentType;
  expected_sessions: number;
  actual_sessions: number;
  expected_minutes: number;
  actual_minutes: number;
  sessions_first_cycle: number;
  sessions_second_cycle: number;
  rate_first_cycle: number | string;
  rate_second_cycle: number | string;
  gross_amount: number | string;
  lost_minutes_after_tolerance?: number | string | null;
  lost_amount?: number | string | null;
  adjusted_amount?: number | string | null;
};

type StatisticsDetailRow = {
  id: string;
  dateISO: string;
  expected_minutes: number;
  real_minutes: number;
  observed_minutes?: number | null;
  actual_call_iso?: string | null;
  ended_at?: string | null;
  late_minutes?: number | null;
  class_id?: string | null;
  subject_id?: string | null;
  period_id?: string | null;
};

type StatisticsDetailPayload = {
  rows: StatisticsDetailRow[];
};

type PeriodScheduleRow = {
  id: string;
  weekday: number;
  start_time?: string | null;
  end_time?: string | null;
  duration_min?: number | null;
};

type TeacherTimetableRow = {
  class_id: string;
  subject_id: string;
  period_id: string;
  weekday: number;
};

type ClassTeacherAssignmentRow = {
  class_id: string;
  subject_id: string;
  teacher_id: string;
  start_date?: string | null;
  end_date?: string | null;
};

type ExpectedSlot = {
  class_id: string;
  subject_id: string;
  period_id: string;
  session_date: string;
  weekday: number;
  cycle: SchoolCycle;
  expected_minutes: number;
};

type InstitutionSettings = {
  institution_name?: string | null;
  institution_label?: string | null;
  name?: string | null;
  institution_logo_url?: string | null;
  institution_head_name?: string | null;
  institution_head_title?: string | null;
};

function numberValue(value: number | string | null | undefined) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number) {
  return Math.round(Number(value || 0));
}

function formatMoney(value: number | string | null | undefined) {
  return `${numberValue(value).toLocaleString("fr-FR")} F`;
}

function formatMinutes(value: number | string | null | undefined) {
  return `${Math.max(0, Math.round(numberValue(value))).toLocaleString("fr-FR")} min`;
}

function formatMonthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

function normalizeMonth(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function parsePositiveInt(
  value: FormDataEntryValue | string | number | null | undefined,
  fallback: number,
) {
  const n = Math.round(Number(String(value ?? "").replace(",", ".")));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseAmount(
  value: FormDataEntryValue | string | number | null | undefined,
  fallback: number,
) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(year, monthNumber || 1, 0);
  const mm = String(monthNumber).padStart(2, "0");
  return {
    periodMonth: `${year}-${mm}-01`,
    periodStart: `${year}-${mm}-01`,
    periodEnd: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`,
  };
}

function periodIsInsideAcademicYear(
  periodStart: string,
  periodEnd: string,
  academicYearStart?: string | null,
  academicYearEnd?: string | null,
) {
  if (academicYearStart && periodEnd < academicYearStart) return false;
  if (academicYearEnd && periodStart > academicYearEnd) return false;
  return true;
}

function clampPeriodToAcademicYear(
  periodStart: string,
  periodEnd: string,
  academicYearStart?: string | null,
  academicYearEnd?: string | null,
) {
  return {
    periodStart: academicYearStart && academicYearStart > periodStart ? academicYearStart : periodStart,
    periodEnd: academicYearEnd && academicYearEnd < periodEnd ? academicYearEnd : periodEnd,
  };
}

function cycleFromLevel(level: string | null | undefined): SchoolCycle {
  const s = String(level || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    s.includes("6e") ||
    s.includes("5e") ||
    s.includes("4e") ||
    s.includes("3e") ||
    s.includes("sixieme") ||
    s.includes("cinquieme") ||
    s.includes("quatrieme") ||
    s.includes("troisieme") ||
    s.includes("1er cycle") ||
    s.includes("premier cycle")
  ) {
    return "first_cycle";
  }

  return "second_cycle";
}

function overlapDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  from: string,
  to: string,
) {
  const start = (startDate || "0001-01-01").slice(0, 10);
  const end = (endDate || "9999-12-31").slice(0, 10);
  return start <= to && end >= from;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dbWeekdayToJs(dbWeekday: number) {
  return dbWeekday === 7 ? 0 : dbWeekday;
}

function clockDurationMinutes(start: string | null | undefined, end: string | null | undefined) {
  const parse = (value: string | null | undefined) => {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const a = parse(start);
  const b = parse(end);
  if (a === null || b === null || b <= a) return 0;
  return b - a;
}

function teacherLabel(t: {
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  return t.display_name?.trim() || t.email?.trim() || t.phone?.trim() || "Enseignant";
}

function buildOriginFromHeaders(h: Headers) {
  const proto = h.get("x-forwarded-proto") || (process.env.NODE_ENV === "development" ? "http" : "https");
  const host = h.get("x-forwarded-host") || h.get("host");
  if (!host) throw new Error("Impossible de déterminer l’hôte courant.");
  return `${proto}://${host}`;
}

async function getCurrentContextOrThrow() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Utilisateur non authentifié.");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!profile?.institution_id) throw new Error("Aucun établissement associé à cet utilisateur.");

  return { userId: user.id, institutionId: String(profile.institution_id) };
}

async function fetchStatisticsDetailServer(
  teacherId: string,
  from: string,
  to: string,
): Promise<StatisticsDetailPayload> {
  const h = await headers();
  const c = await cookies();
  const origin = buildOriginFromHeaders(h);
  const qs = new URLSearchParams({ mode: "detail", teacher_id: teacherId, from, to });

  const res = await fetch(`${origin}/api/admin/statistics?${qs.toString()}`, {
    method: "GET",
    headers: { cookie: c.toString(), accept: "application/json" },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return { rows: Array.isArray(json?.rows) ? json.rows : [] };
}

async function fetchInstitutionSettingsServer(): Promise<InstitutionSettings> {
  const h = await headers();
  const c = await cookies();
  const origin = buildOriginFromHeaders(h);
  const res = await fetch(`${origin}/api/admin/institution/settings`, {
    method: "GET",
    headers: { cookie: c.toString(), accept: "application/json" },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return {};
  return {
    institution_name: json?.institution_name ?? "",
    institution_label: json?.institution_label ?? "",
    name: json?.name ?? "",
    institution_logo_url: json?.institution_logo_url ?? "",
    institution_head_name: json?.institution_head_name ?? "",
    institution_head_title: json?.institution_head_title ?? "",
  };
}

async function getPayrollTeachers(institutionId: string): Promise<PayrollTeacherRow[]> {
  const admin = getSupabaseServiceClient();
  const { data: roles, error: roleErr } = await admin
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", institutionId)
    .eq("role", "teacher");
  if (roleErr) throw new Error(roleErr.message);

  const teacherIds = Array.from(new Set((roles ?? []).map((r: any) => String(r.profile_id))));
  if (!teacherIds.length) return [];

  const [{ data: profiles, error: profErr }, { data: payProfiles, error: payErr }] = await Promise.all([
    admin.from("profiles").select("id,display_name,email,phone").in("id", teacherIds),
    admin
      .schema("finance")
      .from("teacher_pay_profiles")
      .select("profile_id,employment_type,payroll_enabled,notes")
      .eq("institution_id", institutionId)
      .in("profile_id", teacherIds),
  ]);
  if (profErr) throw new Error(profErr.message);
  if (payErr) throw new Error(payErr.message);

  const payMap = new Map((payProfiles ?? []).map((r: any) => [String(r.profile_id), r]));
  return (profiles ?? [])
    .map((p: any) => {
      const pay = payMap.get(String(p.id));
      return {
        profile_id: String(p.id),
        display_name: p.display_name ?? null,
        email: p.email ?? null,
        phone: p.phone ?? null,
        employment_type: ((pay?.employment_type as EmploymentType | undefined) ?? "permanent") as EmploymentType,
        payroll_enabled: typeof pay?.payroll_enabled === "boolean" ? pay.payroll_enabled : true,
        notes: pay?.notes ?? null,
      };
    })
    .sort((a, b) => teacherLabel(a).localeCompare(teacherLabel(b), "fr"));
}

async function buildExpectedSlotsForTeacher(params: {
  admin: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  teacherId: string;
  periodStart: string;
  periodEnd: string;
  classMap: Map<string, ClassRow>;
  referenceMinutes: number;
}) {
  const { admin, institutionId, teacherId, periodStart, periodEnd, classMap, referenceMinutes } = params;
  const [{ data: ttRows, error: ttErr }, { data: periodRows, error: pErr }, { data: ctRows, error: ctErr }] = await Promise.all([
    admin
      .from("teacher_timetables")
      .select("class_id,subject_id,period_id,weekday")
      .eq("institution_id", institutionId)
      .eq("teacher_id", teacherId),
    admin
      .from("institution_periods")
      .select("id,weekday,start_time,end_time,duration_min")
      .eq("institution_id", institutionId),
    admin
      .from("class_teachers")
      .select("class_id,subject_id,teacher_id,start_date,end_date")
      .eq("institution_id", institutionId)
      .eq("teacher_id", teacherId),
  ]);
  if (ttErr) throw new Error(ttErr.message);
  if (pErr) throw new Error(pErr.message);
  if (ctErr) throw new Error(ctErr.message);

  const activeAssignments = new Set(
    ((ctRows ?? []) as ClassTeacherAssignmentRow[])
      .filter((r) => overlapDateRange(r.start_date, r.end_date, periodStart, periodEnd))
      .map((r) => `${r.class_id}::${r.subject_id}`),
  );
  const periodById = new Map<string, PeriodScheduleRow>(
    ((periodRows ?? []) as PeriodScheduleRow[]).map((p) => [String(p.id), p]),
  );
  const from = new Date(`${periodStart}T00:00:00`);
  const to = new Date(`${periodEnd}T00:00:00`);
  const out: ExpectedSlot[] = [];

  for (const row of (ttRows ?? []) as TeacherTimetableRow[]) {
    const classId = String(row.class_id || "");
    const subjectId = String(row.subject_id || "");
    const periodId = String(row.period_id || "");
    const weekday = Number(row.weekday ?? -1);
    if (!classId || !subjectId || !periodId || weekday < 0) continue;
    if (!classMap.has(classId)) continue;
    if (!activeAssignments.has(`${classId}::${subjectId}`)) continue;

    const period = periodById.get(periodId);
    if (!period) continue;
    const configuredDuration = numberValue(period.duration_min);
    const clockDuration = clockDurationMinutes(period.start_time, period.end_time);
    const expectedMinutes = configuredDuration || clockDuration || referenceMinutes;
    const cycle = cycleFromLevel(classMap.get(classId)?.level);

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== dbWeekdayToJs(weekday)) continue;
      out.push({
        class_id: classId,
        subject_id: subjectId,
        period_id: periodId,
        session_date: ymd(d),
        weekday,
        cycle,
        expected_minutes: expectedMinutes,
      });
    }
  }

  return out.sort((a, b) =>
    `${a.session_date}|${a.class_id}|${a.period_id}`.localeCompare(`${b.session_date}|${b.class_id}|${b.period_id}`),
  );
}

function findMatchingSession(
  rows: StatisticsDetailRow[],
  used: Set<number>,
  slot: ExpectedSlot,
) {
  const date = slot.session_date;
  const exact = rows.findIndex((r, index) =>
    !used.has(index) &&
    String(r.dateISO || "").slice(0, 10) === date &&
    String(r.class_id || "") === slot.class_id &&
    String(r.period_id || "") === slot.period_id &&
    (!r.subject_id || String(r.subject_id) === slot.subject_id),
  );
  if (exact >= 0) {
    used.add(exact);
    return rows[exact];
  }

  const fallback = rows.findIndex((r, index) =>
    !used.has(index) &&
    String(r.dateISO || "").slice(0, 10) === date &&
    String(r.class_id || "") === slot.class_id &&
    (!r.subject_id || String(r.subject_id) === slot.subject_id),
  );
  if (fallback >= 0) {
    used.add(fallback);
    return rows[fallback];
  }
  return null;
}

function payrollMessage(code: string | null | undefined) {
  switch (String(code || "")) {
    case "payroll_calculated":
      return { tone: "emerald", title: "Paie calculée", body: "Les séances clôturées ont été recalculées avec les tolérances de retard et de sortie anticipée séparées." };
    case "payroll_validated":
      return { tone: "emerald", title: "Paie validée", body: "Cet état de paie est maintenant validé et conservé dans l’historique." };
    case "month_outside_academic_year":
      return { tone: "amber", title: "Mois hors année scolaire", body: "Choisis un mois compris dans l’année scolaire sélectionnée." };
    default:
      return null;
  }
}

async function calculatePayrollAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser("payroll");
  if (!access.ok) redirect("/admin/finance/locked");

  const { institutionId, userId } = await getCurrentContextOrThrow();
  const admin = getSupabaseServiceClient();
  const month = normalizeMonth(String(formData.get("month") || ""));
  const rateFirst = parseAmount(formData.get("rate_first"), 1500);
  const rateSecond = parseAmount(formData.get("rate_second"), 2000);
  const lateToleranceMin = parsePositiveInt(formData.get("late_tolerance_min"), 15);
  const earlyDepartureToleranceMin = parsePositiveInt(formData.get("early_departure_tolerance_min"), 5);
  const sessionReferenceMinutes = Math.max(1, parsePositiveInt(formData.get("session_reference_minutes"), 55));
  const requestedAcademicYear = String(formData.get("academic_year") || "").trim();
  const { periodMonth, periodStart, periodEnd } = monthRange(month);

  const academicYearCtx = await getFinanceAcademicYearContext(institutionId, requestedAcademicYear);
  const {
    selectedAcademicYearId,
    selectedAcademicYearCode,
    selectedAcademicYearStart,
    selectedAcademicYearEnd,
  } = academicYearCtx;

  const returnParams = `month=${encodeURIComponent(month)}&academic_year=${encodeURIComponent(selectedAcademicYearCode)}&late_tolerance_min=${lateToleranceMin}&early_departure_tolerance_min=${earlyDepartureToleranceMin}&session_reference_minutes=${sessionReferenceMinutes}&rate_first=${rateFirst}&rate_second=${rateSecond}`;

  if (!periodIsInsideAcademicYear(periodStart, periodEnd, selectedAcademicYearStart, selectedAcademicYearEnd)) {
    redirect(`/admin/finance/payroll?${returnParams}&message=month_outside_academic_year`);
  }

  const effectiveRange = clampPeriodToAcademicYear(
    periodStart,
    periodEnd,
    selectedAcademicYearStart,
    selectedAcademicYearEnd,
  );

  const [{ data: classRows, error: clsErr }, teachers] = await Promise.all([
    (() => {
      let query = admin
        .from("classes")
        .select("id,label,level,academic_year")
        .eq("institution_id", institutionId);
      if (selectedAcademicYearCode) query = query.eq("academic_year", selectedAcademicYearCode);
      return query;
    })(),
    getPayrollTeachers(institutionId),
  ]);
  if (clsErr) throw new Error(clsErr.message);

  const classes = (classRows ?? []) as ClassRow[];
  const classMap = new Map(classes.map((c) => [String(c.id), c]));
  const vacataires = teachers.filter((t) => t.payroll_enabled && t.employment_type === "vacataire");

  const { data: existingDraft, error: draftErr } = await admin
    .schema("finance")
    .from("teacher_payroll_runs")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("academic_year", selectedAcademicYearCode || null)
    .eq("period_month", periodMonth)
    .eq("scope", "vacataires_only")
    .eq("status", "draft")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (draftErr) throw new Error(draftErr.message);

  let runId = existingDraft?.id ? String(existingDraft.id) : "";
  const runPayload = {
    scope: "vacataires_only",
    period_start: effectiveRange.periodStart,
    period_end: effectiveRange.periodEnd,
    default_rate_first_cycle: rateFirst,
    default_rate_second_cycle: rateSecond,
    notes: null,
    academic_year_id: selectedAcademicYearId,
    academic_year: selectedAcademicYearCode || null,
    late_tolerance_min: lateToleranceMin,
    early_departure_tolerance_min: earlyDepartureToleranceMin,
    session_reference_minutes: sessionReferenceMinutes,
    generated_by: userId,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as any;

  if (runId) {
    const { error } = await admin.schema("finance").from("teacher_payroll_runs").update(runPayload).eq("id", runId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await admin
      .schema("finance")
      .from("teacher_payroll_runs")
      .insert({
        ...runPayload,
        institution_id: institutionId,
        period_month: periodMonth,
        status: "draft",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    runId = String(data.id);
  }

  const { data: oldLines, error: oldLinesErr } = await admin
    .schema("finance")
    .from("teacher_payroll_lines")
    .select("id")
    .eq("run_id", runId);
  if (oldLinesErr) throw new Error(oldLinesErr.message);

  const oldLineIds = (oldLines ?? []).map((r: any) => String(r.id));
  if (oldLineIds.length) {
    const { error } = await admin
      .schema("finance")
      .from("teacher_payroll_line_sessions")
      .delete()
      .in("line_id", oldLineIds);
    if (error) throw new Error(error.message);
  }
  const { error: delLinesErr } = await admin.schema("finance").from("teacher_payroll_lines").delete().eq("run_id", runId);
  if (delLinesErr) throw new Error(delLinesErr.message);

  for (const teacher of vacataires) {
    const [stats, expectedSlots] = await Promise.all([
      fetchStatisticsDetailServer(teacher.profile_id, effectiveRange.periodStart, effectiveRange.periodEnd),
      buildExpectedSlotsForTeacher({
        admin,
        institutionId,
        teacherId: teacher.profile_id,
        periodStart: effectiveRange.periodStart,
        periodEnd: effectiveRange.periodEnd,
        classMap,
        referenceMinutes: sessionReferenceMinutes,
      }),
    ]);

    const actualRows = (stats.rows || []).filter((r) => !!r.actual_call_iso || numberValue(r.real_minutes) > 0);
    const usedRows = new Set<number>();

    const sessionItems = expectedSlots.map((slot) => {
      const matched = findMatchingSession(actualRows, usedRows, slot);
      const expectedMinutes = Math.max(1, numberValue(slot.expected_minutes) || sessionReferenceMinutes);
      const started = Boolean(matched?.actual_call_iso);
      const closed = Boolean(matched?.ended_at);
      const rawLate = matched
        ? Math.max(0, numberValue(matched.late_minutes) || (expectedMinutes - numberValue(matched.real_minutes)))
        : expectedMinutes;
      const lateMinutes = Math.min(expectedMinutes, rawLate);
      const observedMinutes = matched && closed ? Math.max(0, numberValue(matched.observed_minutes)) : 0;
      const creditedMinutes = closed
        ? Math.min(Math.max(0, expectedMinutes - lateMinutes), observedMinutes)
        : 0;
      const earlyDepartureMinutes = closed
        ? Math.max(0, expectedMinutes - lateMinutes - creditedMinutes)
        : expectedMinutes;
      const isActuallyHeld = started && closed && creditedMinutes > 0;

      const sanctionableLate = isActuallyHeld ? Math.max(0, lateMinutes - lateToleranceMin) : 0;
      const sanctionableEarly = isActuallyHeld ? Math.max(0, earlyDepartureMinutes - earlyDepartureToleranceMin) : 0;
      const lostMinutes = isActuallyHeld
        ? Math.min(sessionReferenceMinutes, sanctionableLate + sanctionableEarly)
        : expectedMinutes;
      const lostEquivalent = isActuallyHeld ? Math.min(1, lostMinutes / sessionReferenceMinutes) : 0;
      const rate = slot.cycle === "first_cycle" ? rateFirst : rateSecond;
      const gross = isActuallyHeld ? rate : 0;
      const retained = isActuallyHeld ? roundMoney(rate * lostEquivalent) : 0;
      const payable = isActuallyHeld ? Math.max(0, roundMoney(gross - retained)) : 0;

      return {
        ...slot,
        actual_minutes: creditedMinutes,
        tolerance_minutes: isActuallyHeld ? lateToleranceMin + earlyDepartureToleranceMin : 0,
        lost_minutes_after_tolerance: lostMinutes,
        lost_sessions_equivalent: lostEquivalent,
        theoretical_amount: gross,
        lost_amount: retained,
        adjusted_amount: payable,
        source_origin: isActuallyHeld ? "class_device" : "timetable_expected",
        counted_for_pay: isActuallyHeld,
      };
    });

    const expectedSessions = sessionItems.length;
    const actualSessions = sessionItems.filter((item) => item.counted_for_pay).length;
    const expectedMinutes = sessionItems.reduce((acc, item) => acc + item.expected_minutes, 0);
    const actualMinutes = sessionItems.reduce((acc, item) => acc + item.actual_minutes, 0);
    const sessionsFirstCycle = sessionItems.filter((item) => item.counted_for_pay && item.cycle === "first_cycle").length;
    const sessionsSecondCycle = sessionItems.filter((item) => item.counted_for_pay && item.cycle === "second_cycle").length;
    const grossAmount = sessionItems.reduce((acc, item) => acc + item.theoretical_amount, 0);
    const lostMinutesAfterTolerance = sessionItems.reduce((acc, item) => acc + item.lost_minutes_after_tolerance, 0);
    const lostAmount = sessionItems.reduce((acc, item) => acc + item.lost_amount, 0);
    const adjustedAmount = sessionItems.reduce((acc, item) => acc + item.adjusted_amount, 0);
    const expectedAmount = expectedSlots.reduce(
      (acc, slot) => acc + (slot.cycle === "first_cycle" ? rateFirst : rateSecond),
      0,
    );

    const { data: line, error: lineErr } = await admin
      .schema("finance")
      .from("teacher_payroll_lines")
      .insert({
        run_id: runId,
        institution_id: institutionId,
        teacher_id: teacher.profile_id,
        teacher_name_snapshot: teacherLabel(teacher),
        employment_type: "vacataire",
        payroll_enabled: true,
        expected_sessions: expectedSessions,
        actual_sessions: actualSessions,
        expected_minutes: expectedMinutes,
        actual_minutes: actualMinutes,
        sessions_first_cycle: sessionsFirstCycle,
        sessions_second_cycle: sessionsSecondCycle,
        rate_first_cycle: rateFirst,
        rate_second_cycle: rateSecond,
        gross_amount: grossAmount,
        expected_amount: expectedAmount,
        lost_minutes_after_tolerance: lostMinutesAfterTolerance,
        lost_sessions_equivalent: lostMinutesAfterTolerance / sessionReferenceMinutes,
        lost_amount: lostAmount,
        adjusted_amount: adjustedAmount,
        notes: teacher.notes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .select("id")
      .single();
    if (lineErr) throw new Error(lineErr.message);

    if (sessionItems.length) {
      const payload = sessionItems.map((item) => ({
        line_id: line.id,
        run_id: runId,
        institution_id: institutionId,
        teacher_id: teacher.profile_id,
        class_id: item.class_id,
        subject_id: item.subject_id,
        period_id: item.period_id,
        session_date: item.session_date,
        weekday: item.weekday,
        cycle: item.cycle,
        expected_minutes: item.expected_minutes,
        actual_minutes: item.actual_minutes,
        tolerance_minutes: item.tolerance_minutes,
        lost_minutes_after_tolerance: item.lost_minutes_after_tolerance,
        lost_sessions_equivalent: item.lost_sessions_equivalent,
        theoretical_amount: item.theoretical_amount,
        lost_amount: item.lost_amount,
        adjusted_amount: item.adjusted_amount,
        source_origin: item.source_origin,
        counted_for_pay: item.counted_for_pay,
        created_at: new Date().toISOString(),
      }));
      const { error } = await admin.schema("finance").from("teacher_payroll_line_sessions").insert(payload as any);
      if (error) throw new Error(error.message);
    }
  }

  revalidatePath("/admin/finance/payroll");
  redirect(`/admin/finance/payroll?${returnParams}&run_id=${encodeURIComponent(runId)}&message=payroll_calculated`);
}

async function validatePayrollAction(formData: FormData) {
  "use server";
  const access = await getFinanceAccessForCurrentUser("payroll");
  if (!access.ok) redirect("/admin/finance/locked");

  const { institutionId, userId } = await getCurrentContextOrThrow();
  const admin = getSupabaseServiceClient();
  const runId = String(formData.get("run_id") || "").trim();
  const academicYear = String(formData.get("academic_year") || "").trim();
  if (!runId) throw new Error("Paie introuvable.");

  const { error } = await admin
    .schema("finance")
    .from("teacher_payroll_runs")
    .update({
      status: "validated",
      validated_by: userId,
      validated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", runId)
    .eq("institution_id", institutionId)
    .eq("status", "draft");
  if (error) throw new Error(error.message);

  revalidatePath("/admin/finance/payroll");
  redirect(`/admin/finance/payroll?academic_year=${encodeURIComponent(academicYear)}&run_id=${encodeURIComponent(runId)}&message=payroll_validated`);
}

function StatusPill({ status }: { status: PayrollStatus }) {
  const label = status === "validated" ? "Validée" : status === "cancelled" ? "Annulée" : "En préparation";
  const style = status === "validated"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "cancelled"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-amber-200 bg-amber-50 text-amber-700";
  return <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${style}`}>{label}</span>;
}

function StatCard({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</div>
          <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

export default async function FinancePayrollPage({
  searchParams,
}: {
  searchParams?: Promise<{
    month?: string;
    rate_first?: string;
    rate_second?: string;
    run_id?: string;
    print?: string;
    autoprint?: string;
    academic_year?: string;
    late_tolerance_min?: string;
    early_departure_tolerance_min?: string;
    session_reference_minutes?: string;
    message?: string;
  }>;
}) {
  const access = await getFinanceAccessForCurrentUser("payroll");
  if (!access.ok) redirect("/admin/finance/locked");

  const params = searchParams ? await searchParams : undefined;
  const month = normalizeMonth(params?.month);
  const requestedAcademicYear = String(params?.academic_year || "").trim();
  const baseLateTolerance = parsePositiveInt(params?.late_tolerance_min, 15);
  const baseEarlyTolerance = parsePositiveInt(params?.early_departure_tolerance_min, 5);
  const baseReferenceMinutes = Math.max(1, parsePositiveInt(params?.session_reference_minutes, 55));
  const baseRateFirst = parseAmount(params?.rate_first, 1500);
  const baseRateSecond = parseAmount(params?.rate_second, 2000);
  const requestedRunId = String(params?.run_id || "").trim();
  const printMode = String(params?.print || "") === "1";
  const autoPrint = printMode && String(params?.autoprint || "") === "1";

  const { institutionId } = await getCurrentContextOrThrow();
  const supabase = await getSupabaseServerClient();
  const academicYearCtx = await getFinanceAcademicYearContext(institutionId, requestedAcademicYear);
  const {
    academicYears,
    selectedAcademicYearCode,
    selectedAcademicYearStart,
    selectedAcademicYearEnd,
  } = academicYearCtx;
  const [runsResult, teachers, institutionCfg] = await Promise.all([
    (() => {
      let query = supabase
        .schema("finance")
        .from("teacher_payroll_runs")
        .select("id,institution_id,period_month,period_start,period_end,scope,default_rate_first_cycle,default_rate_second_cycle,status,generated_at,validated_at,notes,academic_year_id,academic_year,late_tolerance_min,early_departure_tolerance_min,session_reference_minutes")
        .eq("institution_id", institutionId)
        .eq("scope", "vacataires_only");
      if (selectedAcademicYearCode) query = query.eq("academic_year", selectedAcademicYearCode);
      return query.order("generated_at", { ascending: false }).limit(24);
    })(),
    getPayrollTeachers(institutionId),
    printMode ? fetchInstitutionSettingsServer() : Promise.resolve({} as InstitutionSettings),
  ]);
  if (runsResult.error) throw new Error(runsResult.error.message);

  const runRows = (runsResult.data ?? []) as TeacherPayrollRunRow[];
  const selectedRun =
    (requestedRunId ? runRows.find((r) => r.id === requestedRunId) : null) ||
    runRows.find((r) => r.period_month === `${month}-01` && r.status === "draft") ||
    runRows.find((r) => r.period_month === `${month}-01`) ||
    null;

  const effectiveLateTolerance = selectedRun ? parsePositiveInt(selectedRun.late_tolerance_min, baseLateTolerance) : baseLateTolerance;
  const effectiveEarlyTolerance = selectedRun ? parsePositiveInt(selectedRun.early_departure_tolerance_min, baseEarlyTolerance) : baseEarlyTolerance;
  const effectiveReferenceMinutes = selectedRun ? Math.max(1, parsePositiveInt(selectedRun.session_reference_minutes, baseReferenceMinutes)) : baseReferenceMinutes;
  const effectiveRateFirst = selectedRun ? parseAmount(selectedRun.default_rate_first_cycle, baseRateFirst) : baseRateFirst;
  const effectiveRateSecond = selectedRun ? parseAmount(selectedRun.default_rate_second_cycle, baseRateSecond) : baseRateSecond;

  const linesResult = selectedRun
    ? await supabase
        .schema("finance")
        .from("teacher_payroll_lines")
        .select("id,run_id,teacher_id,teacher_name_snapshot,employment_type,expected_sessions,actual_sessions,expected_minutes,actual_minutes,sessions_first_cycle,sessions_second_cycle,rate_first_cycle,rate_second_cycle,gross_amount,lost_minutes_after_tolerance,lost_amount,adjusted_amount")
        .eq("run_id", selectedRun.id)
        .order("teacher_name_snapshot", { ascending: true })
    : { data: [], error: null as any };
  if (linesResult.error) throw new Error(linesResult.error.message);

  const lines = (linesResult.data ?? []) as TeacherPayrollLineRow[];
  const vacataires = teachers.filter((t) => t.payroll_enabled && t.employment_type === "vacataire");
  const totals = lines.reduce(
    (acc, row) => {
      acc.expectedSessions += numberValue(row.expected_sessions);
      acc.actualSessions += numberValue(row.actual_sessions);
      acc.actualMinutes += numberValue(row.actual_minutes);
      acc.lostMinutes += numberValue(row.lost_minutes_after_tolerance);
      acc.gross += numberValue(row.gross_amount);
      acc.retained += numberValue(row.lost_amount);
      acc.payable += numberValue(row.adjusted_amount ?? row.gross_amount);
      return acc;
    },
    { expectedSessions: 0, actualSessions: 0, actualMinutes: 0, lostMinutes: 0, gross: 0, retained: 0, payable: 0 },
  );

  if (printMode && selectedRun) {
    const institutionName = (institutionCfg.institution_name || institutionCfg.institution_label || institutionCfg.name || "Etablissement scolaire").trim();
    const headName = String(institutionCfg.institution_head_name || "").trim() || "Le responsable";
    const headTitle = String(institutionCfg.institution_head_title || "").trim() || "Chef d’établissement";
    return (
      <div className="payroll-print-root bg-white p-6 text-slate-900">
        <style dangerouslySetInnerHTML={{ __html: `@page{size:A4 portrait;margin:10mm}@media print{body *{visibility:hidden}.payroll-print-root,.payroll-print-root *{visibility:visible!important}.payroll-print-root{position:absolute;inset:0;width:100%;padding:0!important}.no-print{display:none!important}}` }} />
        {autoPrint ? <script dangerouslySetInnerHTML={{ __html: "setTimeout(function(){window.print()},250);" }} /> : null}
        <div className="mx-auto max-w-5xl">
          <div className="border-b-2 border-slate-900 pb-4 text-center">
            <div className="text-xl font-black uppercase">{institutionName}</div>
            <div className="mt-2 text-2xl font-black">État de paie des vacataires — {formatMonthLabel(selectedRun.period_month.slice(0, 7))}</div>
            <div className="mt-2 text-sm">Séance de référence : {effectiveReferenceMinutes} min · Retard toléré : {effectiveLateTolerance} min · Sortie anticipée tolérée : {effectiveEarlyTolerance} min</div>
          </div>
          <table className="mt-6 w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 p-2 text-left">Enseignant</th>
                <th className="border border-slate-300 p-2 text-right">Séances</th>
                <th className="border border-slate-300 p-2 text-right">Brut</th>
                <th className="border border-slate-300 p-2 text-right">Retenue</th>
                <th className="border border-slate-300 p-2 text-right">À payer</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((row) => (
                <tr key={row.id}>
                  <td className="border border-slate-300 p-2 font-semibold">{row.teacher_name_snapshot || "Enseignant"}</td>
                  <td className="border border-slate-300 p-2 text-right">{row.actual_sessions} / {row.expected_sessions}</td>
                  <td className="border border-slate-300 p-2 text-right">{formatMoney(row.gross_amount)}</td>
                  <td className="border border-slate-300 p-2 text-right">{formatMoney(row.lost_amount)}</td>
                  <td className="border border-slate-300 p-2 text-right font-black">{formatMoney(row.adjusted_amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-black">
                <td className="border border-slate-300 p-2">TOTAL</td>
                <td className="border border-slate-300 p-2 text-right">{totals.actualSessions}</td>
                <td className="border border-slate-300 p-2 text-right">{formatMoney(totals.gross)}</td>
                <td className="border border-slate-300 p-2 text-right">{formatMoney(totals.retained)}</td>
                <td className="border border-slate-300 p-2 text-right">{formatMoney(totals.payable)}</td>
              </tr>
            </tfoot>
          </table>
          <div className="mt-12 flex justify-end">
            <div className="min-w-64 text-center">
              <div className="font-bold">{headTitle}</div>
              <div className="mt-16 font-semibold">{headName}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const message = payrollMessage(params?.message);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Paie des enseignants</h1>
          <p className="mt-1 text-sm text-slate-600">Calcul simple des vacataires à partir des séances réellement démarrées et clôturées.</p>
        </div>
        {access.scope !== "payroll" ? (
          <Link href={`/admin/finance?academic_year=${encodeURIComponent(selectedAcademicYearCode)}`} className="text-sm font-bold text-slate-600 hover:text-slate-900">Retour Finance</Link>
        ) : null}
      </div>

      <AcademicYearSelector
        academicYears={academicYears}
        selectedAcademicYearCode={selectedAcademicYearCode}
        currentPath="/admin/finance/payroll"
        hiddenParams={{
          month,
          rate_first: effectiveRateFirst,
          rate_second: effectiveRateSecond,
          late_tolerance_min: effectiveLateTolerance,
          early_departure_tolerance_min: effectiveEarlyTolerance,
          session_reference_minutes: effectiveReferenceMinutes,
        }}
      />

      {message ? (
        <div className={`rounded-2xl border p-4 ${message.tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          <div className="font-black">{message.title}</div>
          <div className="mt-1 text-sm">{message.body}</div>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Users className="h-6 w-6" />} label="Vacataires à payer" value={vacataires.length} hint="Profils paie actifs" />
        <StatCard icon={<CalendarClock className="h-6 w-6" />} label="Séances payées" value={totals.actualSessions} hint={`${formatMinutes(totals.actualMinutes)} observées`} />
        <StatCard icon={<Wallet className="h-6 w-6" />} label="Retenues" value={formatMoney(totals.retained)} hint={`${formatMinutes(totals.lostMinutes)} non rémunérées`} />
        <StatCard icon={<Wallet className="h-6 w-6" />} label="Montant à payer" value={formatMoney(totals.payable)} hint={`Brut : ${formatMoney(totals.gross)}`} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">Calculer la paie</h2>
          <p className="mt-1 text-sm text-slate-600">Les 15 min de retard et les 5 min de sortie anticipée sont traitées séparément. Seul le dépassement est retenu.</p>

          <form action={calculatePayrollAction} className="mt-5 grid gap-4 md:grid-cols-2">
            <input type="hidden" name="academic_year" value={selectedAcademicYearCode} />
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Mois</label>
              <input type="month" name="month" defaultValue={month} className="w-full rounded-2xl border border-slate-200 px-3 py-3 font-semibold text-slate-900" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Durée normale d’une séance</label>
              <div className="relative">
                <input type="number" min="1" name="session_reference_minutes" defaultValue={effectiveReferenceMinutes} className="w-full rounded-2xl border border-slate-200 px-3 py-3 pr-14 font-semibold text-slate-900" />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">min</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Retard toléré</label>
              <input type="number" min="0" name="late_tolerance_min" defaultValue={effectiveLateTolerance} className="w-full rounded-2xl border border-slate-200 px-3 py-3 font-semibold text-slate-900" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Sortie anticipée tolérée</label>
              <input type="number" min="0" name="early_departure_tolerance_min" defaultValue={effectiveEarlyTolerance} className="w-full rounded-2xl border border-slate-200 px-3 py-3 font-semibold text-slate-900" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Tarif par séance — 1er cycle</label>
              <input type="number" min="0" name="rate_first" defaultValue={effectiveRateFirst} className="w-full rounded-2xl border border-slate-200 px-3 py-3 font-semibold text-slate-900" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Tarif par séance — 2nd cycle</label>
              <input type="number" min="0" name="rate_second" defaultValue={effectiveRateSecond} className="w-full rounded-2xl border border-slate-200 px-3 py-3 font-semibold text-slate-900" />
            </div>

            <div className="md:col-span-2 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              <strong className="text-slate-900">Règle appliquée :</strong> une séance doit être démarrée et clôturée. Les minutes dépassant la tolérance de retard et celles dépassant la tolérance de sortie anticipée sont additionnées, puis déduites proportionnellement au tarif d’une séance de {effectiveReferenceMinutes} minutes.
            </div>

            <div className="md:col-span-2">
              <button type="submit" className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-700">
                <RefreshCcw className="h-4 w-4" />
                Calculer / actualiser la paie
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">Historique</h2>
          <p className="mt-1 text-sm text-slate-600">Les calculs précédents restent conservés automatiquement.</p>
          <div className="mt-4 space-y-3">
            {runRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">Aucune paie calculée pour le moment.</div>
            ) : runRows.map((run) => {
              const href = `/admin/finance/payroll?academic_year=${encodeURIComponent(run.academic_year || selectedAcademicYearCode)}&month=${encodeURIComponent(run.period_month.slice(0, 7))}&run_id=${encodeURIComponent(run.id)}&rate_first=${encodeURIComponent(String(run.default_rate_first_cycle))}&rate_second=${encodeURIComponent(String(run.default_rate_second_cycle))}&late_tolerance_min=${encodeURIComponent(String(run.late_tolerance_min ?? 15))}&early_departure_tolerance_min=${encodeURIComponent(String(run.early_departure_tolerance_min ?? 5))}&session_reference_minutes=${encodeURIComponent(String(run.session_reference_minutes ?? 55))}`;
              return (
                <Link key={run.id} href={href} className={`block rounded-2xl border p-4 ${selectedRun?.id === run.id ? "border-emerald-300 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-900">{formatMonthLabel(run.period_month.slice(0, 7))}</div>
                      <div className="mt-1 text-xs text-slate-500">Calculée le {formatDate(run.generated_at)}</div>
                    </div>
                    <StatusPill status={run.status} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {selectedRun ? (
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-black text-slate-900">{formatMonthLabel(selectedRun.period_month.slice(0, 7))}</h2>
                <StatusPill status={selectedRun.status} />
              </div>
              <p className="mt-2 text-sm text-slate-600">{lines.length} vacataire(s) · {totals.actualSessions} séance(s) payée(s) · Total {formatMoney(totals.payable)}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {selectedRun.status === "draft" ? (
                <form action={validatePayrollAction}>
                  <input type="hidden" name="run_id" value={selectedRun.id} />
                  <input type="hidden" name="academic_year" value={selectedAcademicYearCode} />
                  <button className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700">
                    <BadgeCheck className="h-4 w-4" />
                    Valider la paie
                  </button>
                </form>
              ) : null}
              <Link href={`/admin/finance/payroll?academic_year=${encodeURIComponent(selectedAcademicYearCode)}&month=${encodeURIComponent(selectedRun.period_month.slice(0, 7))}&run_id=${encodeURIComponent(selectedRun.id)}&print=1&autoprint=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50">
                <Printer className="h-4 w-4" />
                Imprimer l’état de paie
              </Link>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            {lines.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-600">Aucun vacataire calculé pour ce mois.</div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-3 text-left font-bold text-slate-600">Enseignant</th>
                    <th className="px-3 py-3 text-right font-bold text-slate-600">Séances payées</th>
                    <th className="px-3 py-3 text-right font-bold text-slate-600">Temps observé</th>
                    <th className="px-3 py-3 text-right font-bold text-slate-600">Brut</th>
                    <th className="px-3 py-3 text-right font-bold text-slate-600">Retenue</th>
                    <th className="px-3 py-3 text-right font-bold text-slate-600">Montant à payer</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-3 py-3">
                        <div className="font-black text-slate-900">{row.teacher_name_snapshot || "Enseignant"}</div>
                        <div className="mt-1 text-xs text-slate-500">1er cycle : {row.sessions_first_cycle} · 2nd cycle : {row.sessions_second_cycle}</div>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-800">{row.actual_sessions} <span className="font-normal text-slate-400">/ {row.expected_sessions}</span></td>
                      <td className="px-3 py-3 text-right text-slate-700">{formatMinutes(row.actual_minutes)}</td>
                      <td className="px-3 py-3 text-right text-slate-700">{formatMoney(row.gross_amount)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-amber-700">{formatMoney(row.lost_amount)}</td>
                      <td className="px-3 py-3 text-right text-base font-black text-emerald-700">{formatMoney(row.adjusted_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-black">
                    <td className="px-3 py-3">Total</td>
                    <td className="px-3 py-3 text-right">{totals.actualSessions}</td>
                    <td className="px-3 py-3 text-right">{formatMinutes(totals.actualMinutes)}</td>
                    <td className="px-3 py-3 text-right">{formatMoney(totals.gross)}</td>
                    <td className="px-3 py-3 text-right text-amber-700">{formatMoney(totals.retained)}</td>
                    <td className="px-3 py-3 text-right text-emerald-700">{formatMoney(totals.payable)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-600">Choisis le mois et clique sur <strong>Calculer la paie</strong>. Mon Cahier fera le reste.</section>
      )}
    </div>
  );
}
