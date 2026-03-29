// src/app/admin/finance/payroll/page.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import {
  BadgeCheck,
  BadgeDollarSign,
  CalendarClock,
  FileSpreadsheet,
  Printer,
  Receipt,
  RefreshCcw,
  Users,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

type EmploymentType = "vacataire" | "permanent";
type PayrollScope = "vacataires_only" | "all_teachers";
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
  scope: PayrollScope;
  default_rate_first_cycle: number | string;
  default_rate_second_cycle: number | string;
  status: PayrollStatus;
  generated_at: string;
  validated_at: string | null;
  notes: string | null;
};

type TeacherPayrollLineRow = {
  id: string;
  run_id: string;
  institution_id: string;
  teacher_id: string;
  teacher_name_snapshot: string | null;
  employment_type: EmploymentType;
  payroll_enabled: boolean;
  expected_sessions: number;
  actual_sessions: number;
  expected_minutes: number;
  actual_minutes: number;
  sessions_first_cycle: number;
  sessions_second_cycle: number;
  rate_first_cycle: number | string;
  rate_second_cycle: number | string;
  gross_amount: number | string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type StatisticsDetailRow = {
  id: string;
  dateISO: string;
  subject_name: string | null;
  expected_minutes: number;
  real_minutes: number;
  actual_call_iso?: string | null;
  class_id?: string | null;
  class_label?: string | null;
  subject_id?: string | null;
  period_id?: string | null;
};

type StatisticsDetailPayload = {
  rows: StatisticsDetailRow[];
  total_minutes: number;
  count: number;
};

type InstitutionSettings = {
  institution_name?: string | null;
  institution_label?: string | null;
  name?: string | null;
  institution_logo_url?: string | null;
  institution_phone?: string | null;
  institution_email?: string | null;
  institution_region?: string | null;
  institution_postal_address?: string | null;
  institution_status?: string | null;
  institution_head_name?: string | null;
  institution_head_title?: string | null;
  institution_code?: string | null;
};

type PeriodScheduleRow = {
  id: string;
  weekday: number;
  period_no: number | null;
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

function formatMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function formatMonthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

function formatLongDate(value: string | Date | null | undefined) {
  const d = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function minutesToHourLabel(min: number) {
  const m = Math.max(0, Math.round(Number(min || 0)));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}H${String(r).padStart(2, "0")}`;
}

function teacherLabel(t: {
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  return t.display_name?.trim() || t.email?.trim() || t.phone?.trim() || "(enseignant)";
}

function normalizeScope(value: string | null | undefined): PayrollScope {
  return value === "all_teachers" ? "all_teachers" : "vacataires_only";
}

function normalizeMonth(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function parseAmount(value: FormDataEntryValue | null, fallback = 0) {
  const n = Number(String(value || "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(year, (monthNumber || 1) - 1, 1);
  const end = new Date(year, monthNumber || 1, 0);
  const periodMonth = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const periodStart = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const periodEnd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
    end.getDate()
  ).padStart(2, "0")}`;

  return { start, end, periodMonth, periodStart, periodEnd };
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

function dayOfWeekFromIso(iso: string) {
  const d = new Date(iso);
  const wd = d.getDay();
  return wd === 0 ? 7 : wd;
}

function buildOriginFromHeaders(h: Headers) {
  const proto =
    h.get("x-forwarded-proto") ||
    (process.env.NODE_ENV === "development" ? "http" : "https");
  const host = h.get("x-forwarded-host") || h.get("host");

  if (!host) {
    throw new Error("Impossible de déterminer l’hôte courant.");
  }

  return `${proto}://${host}`;
}

function institutionDisplayName(cfg: InstitutionSettings) {
  return (
    (cfg.institution_name || "").trim() ||
    (cfg.institution_label || "").trim() ||
    (cfg.name || "").trim() ||
    "Etablissement scolaire"
  );
}

function overlapDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  from: string,
  to: string
) {
  const s = (startDate || "0001-01-01").slice(0, 10);
  const e = (endDate || "9999-12-31").slice(0, 10);
  return s <= to && e >= from;
}

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dbWeekdayToJs(dbWeekday: number) {
  if (dbWeekday === 7) return 0;
  return dbWeekday;
}

async function getCurrentContextOrThrow() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Utilisateur non authentifié.");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!profile?.institution_id) {
    throw new Error("Aucun établissement associé à cet utilisateur.");
  }

  return {
    userId: user.id as string,
    institutionId: profile.institution_id as string,
  };
}

async function fetchStatisticsDetailServer(
  teacherId: string,
  from: string,
  to: string
): Promise<StatisticsDetailPayload> {
  const h = await headers();
  const c = await cookies();
  const origin = buildOriginFromHeaders(h);

  const qs = new URLSearchParams({
    mode: "detail",
    teacher_id: teacherId,
    from,
    to,
  });

  const res = await fetch(`${origin}/api/admin/statistics?${qs.toString()}`, {
    method: "GET",
    headers: {
      cookie: c.toString(),
      accept: "application/json",
    },
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));

  if (res.status === 401) {
    throw new Error("unauthorized");
  }

  if (!res.ok) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }

  return {
    rows: Array.isArray(json?.rows) ? json.rows : [],
    total_minutes: Number(json?.total_minutes || 0),
    count: Number(json?.count || 0),
  };
}

async function fetchInstitutionSettingsServer(): Promise<InstitutionSettings> {
  const h = await headers();
  const c = await cookies();
  const origin = buildOriginFromHeaders(h);

  const res = await fetch(`${origin}/api/admin/institution/settings`, {
    method: "GET",
    headers: {
      cookie: c.toString(),
      accept: "application/json",
    },
    cache: "no-store",
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) return {};

  return {
    institution_name: json?.institution_name ?? "",
    institution_label: json?.institution_label ?? "",
    name: json?.name ?? "",
    institution_logo_url: json?.institution_logo_url ?? "",
    institution_phone: json?.institution_phone ?? "",
    institution_email: json?.institution_email ?? "",
    institution_region: json?.institution_region ?? "",
    institution_postal_address: json?.institution_postal_address ?? "",
    institution_status: json?.institution_status ?? "",
    institution_head_name: json?.institution_head_name ?? "",
    institution_head_title: json?.institution_head_title ?? "",
    institution_code: json?.institution_code ?? "",
  };
}

async function getPayrollTeachers(
  institutionId: string
): Promise<PayrollTeacherRow[]> {
  const admin = getSupabaseServiceClient();

  const { data: roles, error: roleErr } = await admin
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", institutionId)
    .eq("role", "teacher");

  if (roleErr) throw new Error(roleErr.message);

  const teacherIds = Array.from(
    new Set((roles ?? []).map((r: any) => String(r.profile_id)))
  );

  if (teacherIds.length === 0) return [];

  const [{ data: profiles, error: profErr }, { data: payProfiles, error: payErr }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id,display_name,email,phone")
        .in("id", teacherIds),

      admin
        .schema("finance")
        .from("teacher_pay_profiles")
        .select("profile_id,employment_type,payroll_enabled,notes")
        .eq("institution_id", institutionId)
        .in("profile_id", teacherIds),
    ]);

  if (profErr) throw new Error(profErr.message);
  if (payErr) throw new Error(payErr.message);

  const payMap = new Map(
    (payProfiles ?? []).map((r: any) => [String(r.profile_id), r])
  );

  return (profiles ?? [])
    .map((p: any) => {
      const pay = payMap.get(String(p.id));
      return {
        profile_id: String(p.id),
        display_name: (p.display_name ?? null) as string | null,
        email: (p.email ?? null) as string | null,
        phone: (p.phone ?? null) as string | null,
        employment_type:
          ((pay?.employment_type as EmploymentType | undefined) ?? "permanent") as EmploymentType,
        payroll_enabled:
          typeof pay?.payroll_enabled === "boolean" ? pay.payroll_enabled : true,
        notes: (pay?.notes ?? null) as string | null,
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
}) {
  const { admin, institutionId, teacherId, periodStart, periodEnd, classMap } = params;

  const [
    { data: ttRows, error: ttErr },
    { data: periodRows, error: pErr },
    { data: ctRows, error: ctErr },
  ] = await Promise.all([
    admin
      .from("teacher_timetables")
      .select("class_id,subject_id,period_id,weekday")
      .eq("institution_id", institutionId)
      .eq("teacher_id", teacherId),

    admin
      .from("institution_periods")
      .select("id,weekday,period_no,start_time,end_time,duration_min")
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
      .map((r) => `${r.class_id}::${r.subject_id}`)
  );

  const periodById = new Map<string, PeriodScheduleRow>(
    ((periodRows ?? []) as PeriodScheduleRow[]).map((p) => [String(p.id), p])
  );

  const from = new Date(`${periodStart}T00:00:00`);
  const to = new Date(`${periodEnd}T00:00:00`);
  const out: ExpectedSlot[] = [];

  for (const row of (ttRows ?? []) as TeacherTimetableRow[]) {
    const class_id = String(row.class_id || "");
    const subject_id = String(row.subject_id || "");
    const period_id = String(row.period_id || "");
    const weekday = Number(row.weekday ?? -1);

    if (!class_id || !subject_id || !period_id || weekday < 0) continue;
    if (!activeAssignments.has(`${class_id}::${subject_id}`)) continue;

    const period = periodById.get(period_id);
    if (!period) continue;

    const expected_minutes = Number(period.duration_min || 0);
    if (expected_minutes <= 0) continue;

    const cls = classMap.get(class_id) || null;
    const cycle = cycleFromLevel(cls?.level);

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== dbWeekdayToJs(weekday)) continue;

      out.push({
        class_id,
        subject_id,
        period_id,
        session_date: ymd(d),
        weekday,
        cycle,
        expected_minutes,
      });
    }
  }

  out.sort((a, b) =>
    `${a.session_date}|${a.class_id}|${a.subject_id}|${a.period_id}`.localeCompare(
      `${b.session_date}|${b.class_id}|${b.subject_id}|${b.period_id}`
    )
  );

  return out;
}

async function generatePayrollDraftAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const { institutionId, userId } = await getCurrentContextOrThrow();
  const admin = getSupabaseServiceClient();

  const month = normalizeMonth(String(formData.get("month") || ""));
  const scope = normalizeScope(String(formData.get("scope") || ""));
  const rateFirst = parseAmount(formData.get("rate_first"), 0);
  const rateSecond = parseAmount(formData.get("rate_second"), 0);
  const notes = String(formData.get("notes") || "").trim() || null;

  const { periodMonth, periodStart, periodEnd } = monthRange(month);

  const [{ data: classRows, error: clsErr }, teachers] = await Promise.all([
    admin
      .from("classes")
      .select("id,label,level,academic_year")
      .eq("institution_id", institutionId),
    getPayrollTeachers(institutionId),
  ]);

  if (clsErr) throw new Error(clsErr.message);

  const classes = (classRows ?? []) as ClassRow[];
  const classMap = new Map(classes.map((c) => [c.id, c]));

  const eligibleTeachers = teachers.filter((t) => {
    if (!t.payroll_enabled) return false;
    if (scope === "vacataires_only") return t.employment_type === "vacataire";
    return true;
  });

  const { data: existingDraft, error: draftErr } = await admin
    .schema("finance")
    .from("teacher_payroll_runs")
    .select(
      "id,institution_id,period_month,period_start,period_end,scope,default_rate_first_cycle,default_rate_second_cycle,status,generated_at,validated_at,notes"
    )
    .eq("institution_id", institutionId)
    .eq("period_month", periodMonth)
    .eq("status", "draft")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (draftErr) throw new Error(draftErr.message);

  let runId = existingDraft?.id as string | undefined;

  if (runId) {
    const { error: runUpdErr } = await admin
      .schema("finance")
      .from("teacher_payroll_runs")
      .update({
        scope,
        period_start: periodStart,
        period_end: periodEnd,
        default_rate_first_cycle: rateFirst,
        default_rate_second_cycle: rateSecond,
        notes,
        generated_by: userId,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", runId);

    if (runUpdErr) throw new Error(runUpdErr.message);
  } else {
    const { data: newRun, error: runInsErr } = await admin
      .schema("finance")
      .from("teacher_payroll_runs")
      .insert({
        institution_id: institutionId,
        period_month: periodMonth,
        period_start: periodStart,
        period_end: periodEnd,
        scope,
        default_rate_first_cycle: rateFirst,
        default_rate_second_cycle: rateSecond,
        status: "draft",
        generated_by: userId,
        generated_at: new Date().toISOString(),
        notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .select(
        "id,institution_id,period_month,period_start,period_end,scope,default_rate_first_cycle,default_rate_second_cycle,status,generated_at,validated_at,notes"
      )
      .single();

    if (runInsErr) throw new Error(runInsErr.message);
    runId = String(newRun.id);
  }

  if (!runId) {
    throw new Error("Impossible de créer le brouillon de paie.");
  }

  const { data: oldLines, error: oldLinesErr } = await admin
    .schema("finance")
    .from("teacher_payroll_lines")
    .select("id")
    .eq("run_id", runId);

  if (oldLinesErr) throw new Error(oldLinesErr.message);

  const oldLineIds = (oldLines ?? []).map((x: any) => String(x.id));

  if (oldLineIds.length) {
    const { error: delSessErr } = await admin
      .schema("finance")
      .from("teacher_payroll_line_sessions")
      .delete()
      .in("line_id", oldLineIds);

    if (delSessErr) throw new Error(delSessErr.message);
  }

  const { error: delLinesErr } = await admin
    .schema("finance")
    .from("teacher_payroll_lines")
    .delete()
    .eq("run_id", runId);

  if (delLinesErr) throw new Error(delLinesErr.message);

  for (const teacher of eligibleTeachers) {
    const [stats, expectedSlots] = await Promise.all([
      fetchStatisticsDetailServer(teacher.profile_id, periodStart, periodEnd),
      buildExpectedSlotsForTeacher({
        admin,
        institutionId,
        teacherId: teacher.profile_id,
        periodStart,
        periodEnd,
        classMap,
      }),
    ]);

    const expectedSessions = expectedSlots.length;
    const expectedMinutes = expectedSlots.reduce(
      (acc, slot) => acc + Number(slot.expected_minutes || 0),
      0
    );

    const actualRows = (stats.rows || []).filter(
      (r) => !!r.actual_call_iso || Number(r.real_minutes || 0) > 0
    );

    let actualSessions = 0;
    let actualMinutes = 0;
    let sessionsFirstCycle = 0;
    let sessionsSecondCycle = 0;

    for (const row of actualRows) {
      const cls = row.class_id ? classMap.get(row.class_id) : null;
      const cycle = cycleFromLevel(cls?.level);
      const effActual = Number(row.real_minutes || row.expected_minutes || 0);

      actualSessions += 1;
      actualMinutes += effActual;

      if (cycle === "first_cycle") sessionsFirstCycle += 1;
      else sessionsSecondCycle += 1;
    }

    const actualBuckets = new Map<string, StatisticsDetailRow[]>();

    for (const row of actualRows) {
      const sessionDate = String(row.dateISO || "").slice(0, 10);
      const classId = String(row.class_id || "");
      const weekday = dayOfWeekFromIso(row.dateISO);

      if (!sessionDate || !classId) continue;

      const key = `${sessionDate}::${weekday}::${classId}`;
      const arr = actualBuckets.get(key) || [];
      arr.push(row);
      actualBuckets.set(key, arr);
    }

    const sessionItems = expectedSlots.map((slot) => {
      const key = `${slot.session_date}::${slot.weekday}::${slot.class_id}`;
      const bucket = actualBuckets.get(key) || [];
      const matched = bucket.length ? bucket.shift()! : null;

      const effActual =
        matched && (!!matched.actual_call_iso || Number(matched.real_minutes || 0) > 0)
          ? Number(
              matched.real_minutes ||
                matched.expected_minutes ||
                slot.expected_minutes ||
                0
            )
          : 0;

      return {
        class_id: slot.class_id,
        subject_id: slot.subject_id,
        period_id: slot.period_id,
        session_date: slot.session_date,
        weekday: slot.weekday,
        cycle: slot.cycle,
        expected_minutes: Number(slot.expected_minutes || 0),
        actual_minutes: effActual,
        source_origin: effActual > 0 ? "class_device" : "timetable_expected",
        counted_for_pay: effActual > 0,
      };
    });

    const grossAmount =
      sessionsFirstCycle * rateFirst + sessionsSecondCycle * rateSecond;

    const { data: insertedLine, error: insLineErr } = await admin
      .schema("finance")
      .from("teacher_payroll_lines")
      .insert({
        run_id: runId,
        institution_id: institutionId,
        teacher_id: teacher.profile_id,
        teacher_name_snapshot: teacherLabel(teacher),
        employment_type: teacher.employment_type,
        payroll_enabled: teacher.payroll_enabled,
        expected_sessions: expectedSessions,
        actual_sessions: actualSessions,
        expected_minutes: expectedMinutes,
        actual_minutes: actualMinutes,
        sessions_first_cycle: sessionsFirstCycle,
        sessions_second_cycle: sessionsSecondCycle,
        rate_first_cycle: rateFirst,
        rate_second_cycle: rateSecond,
        gross_amount: grossAmount,
        notes: teacher.notes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .select(
        "id,run_id,institution_id,teacher_id,teacher_name_snapshot,employment_type,payroll_enabled,expected_sessions,actual_sessions,expected_minutes,actual_minutes,sessions_first_cycle,sessions_second_cycle,rate_first_cycle,rate_second_cycle,gross_amount,notes,created_at,updated_at"
      )
      .single();

    if (insLineErr) throw new Error(insLineErr.message);

    if (sessionItems.length > 0) {
      const payload = sessionItems.map((item) => ({
        line_id: insertedLine.id,
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
        source_origin: item.source_origin,
        counted_for_pay: item.counted_for_pay,
        created_at: new Date().toISOString(),
      }));

      const { error: insSessErr } = await admin
        .schema("finance")
        .from("teacher_payroll_line_sessions")
        .insert(payload as any);

      if (insSessErr) throw new Error(insSessErr.message);
    }
  }

  revalidatePath("/admin/finance/payroll");
  redirect(
    `/admin/finance/payroll?month=${encodeURIComponent(month)}&scope=${encodeURIComponent(
      scope
    )}&rate_first=${encodeURIComponent(String(rateFirst))}&rate_second=${encodeURIComponent(
      String(rateSecond)
    )}&run_id=${encodeURIComponent(runId)}`
  );
}

async function validatePayrollRunAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const { institutionId, userId } = await getCurrentContextOrThrow();
  const admin = getSupabaseServiceClient();

  const runId = String(formData.get("run_id") || "").trim();
  if (!runId) throw new Error("run_id manquant.");

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
  redirect(`/admin/finance/payroll?run_id=${encodeURIComponent(runId)}`);
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "slate",
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  hint: string;
  tone?: "slate" | "emerald" | "amber" | "violet";
}) {
  const tones: Record<
    NonNullable<typeof tone>,
    {
      wrap: string;
      iconWrap: string;
      value: string;
    }
  > = {
    slate: {
      wrap: "border-slate-200 bg-white",
      iconWrap: "bg-slate-100 text-slate-700",
      value: "text-slate-900",
    },
    emerald: {
      wrap: "border-emerald-200 bg-emerald-50/60",
      iconWrap: "bg-emerald-100 text-emerald-700",
      value: "text-emerald-800",
    },
    amber: {
      wrap: "border-amber-200 bg-amber-50/70",
      iconWrap: "bg-amber-100 text-amber-700",
      value: "text-amber-800",
    },
    violet: {
      wrap: "border-violet-200 bg-violet-50/70",
      iconWrap: "bg-violet-100 text-violet-700",
      value: "text-violet-800",
    },
  };

  const t = tones[tone];

  return (
    <div className={`rounded-3xl border p-4 shadow-sm ${t.wrap}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            {label}
          </div>
          <div className={`mt-2 text-3xl font-black ${t.value}`}>{value}</div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>
        <div
          className={`grid h-12 w-12 place-items-center rounded-2xl ${t.iconWrap}`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: PayrollStatus }) {
  const tone =
    status === "validated"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : status === "draft"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-slate-100 text-slate-700 ring-slate-200";

  const label =
    status === "validated"
      ? "Validé"
      : status === "draft"
      ? "Brouillon"
      : "Annulé";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${tone}`}
    >
      <BadgeCheck className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export default async function FinancePayrollPage({
  searchParams,
}: {
  searchParams?: Promise<{
    month?: string;
    scope?: string;
    rate_first?: string;
    rate_second?: string;
    run_id?: string;
    print?: string;
  }>;
}) {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const params = searchParams ? await searchParams : undefined;

  const month = normalizeMonth(params?.month);
  const scope = normalizeScope(params?.scope);
  const rateFirst = Number(params?.rate_first || 1500) || 1500;
  const rateSecond = Number(params?.rate_second || 2000) || 2000;
  const printMode = String(params?.print || "") === "1";
  const requestedRunId = String(params?.run_id || "").trim();

  const { institutionId } = await getCurrentContextOrThrow();
  const supabase = await getSupabaseServerClient();

  const [
    { data: runs, error: runsErr },
    { data: teachersPay, error: teachersErr },
    institutionCfg,
  ] = await Promise.all([
    supabase
      .schema("finance")
      .from("teacher_payroll_runs")
      .select(
        "id,institution_id,period_month,period_start,period_end,scope,default_rate_first_cycle,default_rate_second_cycle,status,generated_at,validated_at,notes"
      )
      .eq("institution_id", institutionId)
      .order("generated_at", { ascending: false })
      .limit(24),

    supabase
      .schema("finance")
      .from("teacher_pay_profiles")
      .select("id,profile_id,employment_type,payroll_enabled")
      .eq("institution_id", institutionId),

    fetchInstitutionSettingsServer(),
  ]);

  if (runsErr) throw new Error(runsErr.message);
  if (teachersErr) throw new Error(teachersErr.message);

  const runRows = (runs ?? []) as TeacherPayrollRunRow[];
  const teacherPayRows = (teachersPay ?? []) as {
    id: string;
    profile_id: string;
    employment_type: EmploymentType;
    payroll_enabled: boolean;
  }[];

  const selectedRun =
    (requestedRunId
      ? runRows.find((r) => r.id === requestedRunId)
      : null) ||
    runRows.find((r) => r.period_month === `${month}-01` && r.status === "draft") ||
    runRows.find((r) => r.period_month === `${month}-01`) ||
    runRows[0] ||
    null;

  const selectedRunId = selectedRun?.id || null;

  const { data: lineRows, error: lineErr } = selectedRunId
    ? await supabase
        .schema("finance")
        .from("teacher_payroll_lines")
        .select(
          "id,run_id,institution_id,teacher_id,teacher_name_snapshot,employment_type,payroll_enabled,expected_sessions,actual_sessions,expected_minutes,actual_minutes,sessions_first_cycle,sessions_second_cycle,rate_first_cycle,rate_second_cycle,gross_amount,notes,created_at,updated_at"
        )
        .eq("run_id", selectedRunId)
        .order("teacher_name_snapshot", { ascending: true })
    : { data: [], error: null as any };

  if (lineErr) throw new Error(lineErr.message);

  const selectedRunLines = (lineRows ?? []) as TeacherPayrollLineRow[];

  const totals = selectedRunLines.reduce(
    (acc, row) => {
      acc.expectedSessions += Number(row.expected_sessions || 0);
      acc.actualSessions += Number(row.actual_sessions || 0);
      acc.expectedMinutes += Number(row.expected_minutes || 0);
      acc.actualMinutes += Number(row.actual_minutes || 0);
      acc.firstCycle += Number(row.sessions_first_cycle || 0);
      acc.secondCycle += Number(row.sessions_second_cycle || 0);
      acc.gross += Number(row.gross_amount || 0);
      return acc;
    },
    {
      expectedSessions: 0,
      actualSessions: 0,
      expectedMinutes: 0,
      actualMinutes: 0,
      firstCycle: 0,
      secondCycle: 0,
      gross: 0,
    }
  );

  const activePayrollTeachers = teacherPayRows.filter((r) => r.payroll_enabled);
  const vacataires = teacherPayRows.filter(
    (r) => r.payroll_enabled && r.employment_type === "vacataire"
  );

  const institutionName = institutionDisplayName(institutionCfg);
  const headName =
    (institutionCfg.institution_head_name || "").trim() || "Le premier responsable";
  const headTitle =
    (institutionCfg.institution_head_title || "").trim() || "Chef d’établissement";
  const place =
    (institutionCfg.institution_region || "").trim() ||
    (institutionCfg.institution_postal_address || "").trim() ||
    "................";
  const logoUrl = (institutionCfg.institution_logo_url || "").trim();
  const printDateLabel = formatLongDate(new Date());

  return (
    <div className="space-y-6">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              .no-print {
                display: none !important;
              }
              body {
                background: white !important;
              }
              .print-sheet {
                box-shadow: none !important;
                border-color: transparent !important;
                border-radius: 0 !important;
                padding: 0 !important;
              }
              .print-table-wrap {
                overflow: visible !important;
              }
            }
          `,
        }}
      />

      {!printMode ? (
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
                <BadgeDollarSign className="h-3.5 w-3.5" />
                Paie enseignants
              </div>

              <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
                Fiche globale de paie
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
                Calcule la paie du mois à partir des séances attendues de l’emploi du temps,
                tout en conservant les heures accomplies issues des statistiques réelles.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 ring-1 ring-emerald-400/25">
                  Finance Premium actif
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                  Expiration : {access.expiresAt || "—"}
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                  Mois : {formatMonthLabel(month)}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                  Profils paie actifs
                </div>
                <div className="mt-2 text-3xl font-black text-white">
                  {activePayrollTeachers.length}
                </div>
                <div className="mt-1 text-sm text-slate-200">
                  {vacataires.length} vacataire(s)
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                  Runs enregistrés
                </div>
                <div className="mt-2 text-3xl font-black text-white">
                  {runRows.length}
                </div>
                <div className="mt-1 text-sm text-slate-200">
                  Brouillons et états validés
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : selectedRun ? (
        <section className="print-sheet rounded-[28px] border border-slate-200 bg-white px-8 py-8 shadow-sm">
          <div className="mx-auto max-w-[1200px]">
            <div className="mb-6 flex items-start justify-between gap-6 border-b border-slate-200 pb-5">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt="Logo établissement"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <div className="text-xs font-bold text-slate-400">LOGO</div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="text-xl font-black uppercase text-slate-900">
                    {institutionName}
                  </div>

                  {institutionCfg.institution_status ? (
                    <div className="mt-1 text-sm font-semibold text-slate-700">
                      {institutionCfg.institution_status}
                    </div>
                  ) : null}

                  <div className="mt-1 space-y-1 text-sm text-slate-600">
                    {institutionCfg.institution_region ? (
                      <div>{institutionCfg.institution_region}</div>
                    ) : null}
                    {institutionCfg.institution_postal_address ? (
                      <div>{institutionCfg.institution_postal_address}</div>
                    ) : null}
                    {institutionCfg.institution_phone || institutionCfg.institution_email ? (
                      <div>
                        {[institutionCfg.institution_phone, institutionCfg.institution_email]
                          .filter(Boolean)
                          .join(" - ")}
                      </div>
                    ) : null}
                    {institutionCfg.institution_code ? (
                      <div>Code établissement : {institutionCfg.institution_code}</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-2xl font-black text-slate-900">FICHE DE PAIE</div>
                <div className="mt-2 text-sm text-slate-600">
                  {formatMonthLabel(selectedRun.period_month.slice(0, 7))}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Période du {formatDate(selectedRun.period_start)} au{" "}
                  {formatDate(selectedRun.period_end)}
                </div>
                <div className="mt-3 text-xs font-semibold text-slate-500">
                  Pour imprimer en PDF : Ctrl+P puis “Enregistrer au format PDF”
                </div>
              </div>
            </div>

            <div className="mb-5 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Périmètre
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {selectedRun.scope === "vacataires_only"
                    ? "Vacataires seulement"
                    : "Tous les enseignants"}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Tarif 1er cycle
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {formatMoney(selectedRun.default_rate_first_cycle)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Tarif 2nd cycle
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {formatMoney(selectedRun.default_rate_second_cycle)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Montant brut total
                </div>
                <div className="mt-1 text-sm font-black text-emerald-700">
                  {formatMoney(totals.gross)}
                </div>
              </div>
            </div>

            {selectedRun.notes ? (
              <div className="mb-5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                <span className="font-bold text-slate-900">Note :</span> {selectedRun.notes}
              </div>
            ) : null}

            {selectedRunLines.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
                Ce run ne contient encore aucune ligne.
              </div>
            ) : (
              <div className="print-table-wrap overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-300 px-3 py-3 text-left font-black text-slate-700">
                        Enseignant
                      </th>
                      <th className="border border-slate-300 px-3 py-3 text-left font-black text-slate-700">
                        Statut
                      </th>
                      <th className="border border-slate-300 px-3 py-3 text-right font-black text-slate-700">
                        Séances attendues
                      </th>
                      <th className="border border-slate-300 px-3 py-3 text-right font-black text-slate-700">
                        Séances accomplies
                      </th>
                      <th className="border border-slate-300 px-3 py-3 text-right font-black text-slate-700">
                        Heures prévues
                      </th>
                      <th className="border border-slate-300 px-3 py-3 text-right font-black text-slate-700">
                        Heures accomplies
                      </th>
                      <th className="border border-slate-300 px-3 py-3 text-right font-black text-slate-700">
                        1er cycle
                      </th>
                      <th className="border border-slate-300 px-3 py-3 text-right font-black text-slate-700">
                        2nd cycle
                      </th>
                      <th className="border border-slate-300 px-3 py-3 text-right font-black text-slate-700">
                        Montant
                      </th>
                      <th className="border border-slate-300 px-3 py-3 text-center font-black text-slate-700">
                        Emargement
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRunLines.map((row) => (
                      <tr key={row.id}>
                        <td className="border border-slate-300 px-3 py-4 align-top">
                          <div className="font-bold text-slate-900">
                            {row.teacher_name_snapshot || "Enseignant"}
                          </div>
                          {row.notes ? (
                            <div className="mt-1 text-xs text-slate-500">{row.notes}</div>
                          ) : null}
                        </td>
                        <td className="border border-slate-300 px-3 py-4 text-slate-700">
                          {row.employment_type === "vacataire" ? "Vacataire" : "Permanent"}
                        </td>
                        <td className="border border-slate-300 px-3 py-4 text-right text-slate-700">
                          {row.expected_sessions}
                        </td>
                        <td className="border border-slate-300 px-3 py-4 text-right font-semibold text-slate-900">
                          {row.actual_sessions}
                        </td>
                        <td className="border border-slate-300 px-3 py-4 text-right text-slate-700">
                          {minutesToHourLabel(row.expected_minutes)}
                        </td>
                        <td className="border border-slate-300 px-3 py-4 text-right font-semibold text-slate-900">
                          {minutesToHourLabel(row.actual_minutes)}
                        </td>
                        <td className="border border-slate-300 px-3 py-4 text-right text-slate-700">
                          {row.sessions_first_cycle}
                        </td>
                        <td className="border border-slate-300 px-3 py-4 text-right text-slate-700">
                          {row.sessions_second_cycle}
                        </td>
                        <td className="border border-slate-300 px-3 py-4 text-right font-black text-emerald-700">
                          {formatMoney(row.gross_amount)}
                        </td>
                        <td className="border border-slate-300 px-3 py-4">
                          <div className="h-10 w-full rounded-md border border-dashed border-slate-300" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50">
                      <td
                        className="border border-slate-300 px-3 py-3 font-black text-slate-900"
                        colSpan={2}
                      >
                        Total
                      </td>
                      <td className="border border-slate-300 px-3 py-3 text-right font-bold text-slate-900">
                        {totals.expectedSessions}
                      </td>
                      <td className="border border-slate-300 px-3 py-3 text-right font-bold text-slate-900">
                        {totals.actualSessions}
                      </td>
                      <td className="border border-slate-300 px-3 py-3 text-right font-bold text-slate-900">
                        {minutesToHourLabel(totals.expectedMinutes)}
                      </td>
                      <td className="border border-slate-300 px-3 py-3 text-right font-bold text-slate-900">
                        {minutesToHourLabel(totals.actualMinutes)}
                      </td>
                      <td className="border border-slate-300 px-3 py-3 text-right font-bold text-slate-900">
                        {totals.firstCycle}
                      </td>
                      <td className="border border-slate-300 px-3 py-3 text-right font-bold text-slate-900">
                        {totals.secondCycle}
                      </td>
                      <td className="border border-slate-300 px-3 py-3 text-right font-black text-emerald-700">
                        {formatMoney(totals.gross)}
                      </td>
                      <td className="border border-slate-300 px-3 py-3" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="mt-12 flex justify-end">
              <div className="w-[360px] text-center text-sm text-slate-800">
                <div>
                  Fait à {place}, le {printDateLabel}
                </div>
                <div className="mt-3 font-bold">{headTitle}</div>
                <div className="h-24" />
                <div className="font-bold underline underline-offset-2">{headName}</div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center text-sm text-slate-600 shadow-sm">
          Aucun run de paie chargé pour le moment. Génère un brouillon pour ce mois.
        </section>
      )}

      {!printMode ? (
        <>
          <section className="no-print grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<Users className="h-6 w-6" />}
              label="Profils paie"
              value={activePayrollTeachers.length}
              hint={`${vacataires.length} vacataire(s)`}
              tone="slate"
            />
            <StatCard
              icon={<Receipt className="h-6 w-6" />}
              label="Lignes calculées"
              value={selectedRunLines.length}
              hint={selectedRun ? "Run chargé" : "Aucun run chargé"}
              tone="emerald"
            />
            <StatCard
              icon={<CalendarClock className="h-6 w-6" />}
              label="Séances"
              value={totals.actualSessions}
              hint={`${minutesToHourLabel(totals.actualMinutes)} réalisées`}
              tone="amber"
            />
            <StatCard
              icon={<Wallet className="h-6 w-6" />}
              label="Montant brut"
              value={formatMoney(totals.gross)}
              hint={
                selectedRun
                  ? selectedRun.status === "validated"
                    ? "Run validé"
                    : "Run brouillon"
                  : "Aucun brouillon"
              }
              tone="violet"
            />
          </section>

          <section className="no-print grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                Générer ou actualiser le brouillon
              </div>

              <form action={generatePayrollDraftAction} className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Mois
                  </div>
                  <input
                    type="month"
                    name="month"
                    defaultValue={month}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Périmètre
                  </div>
                  <select
                    name="scope"
                    defaultValue={scope}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
                  >
                    <option value="vacataires_only">Vacataires seulement</option>
                    <option value="all_teachers">Tous les enseignants</option>
                  </select>
                </div>

                <div>
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Tarif 1er cycle
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="rate_first"
                    defaultValue={rateFirst}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Tarif 2nd cycle
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="rate_second"
                    defaultValue={rateSecond}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
                  />
                </div>

                <div className="md:col-span-2">
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Notes
                  </div>
                  <textarea
                    name="notes"
                    rows={3}
                    placeholder="Ex. Paie mars 2026 calculée sur les séances attendues de l’emploi du temps"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-800 outline-none"
                  />
                </div>

                <div className="md:col-span-2 flex flex-wrap gap-3">
                  <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">
                    <RefreshCcw className="h-4 w-4" />
                    Générer / actualiser le brouillon
                  </button>

                  <Link
                    href="/admin/finance"
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Retour Finance
                  </Link>
                </div>
              </form>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                Runs enregistrés
              </div>

              {runRows.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
                  Aucun brouillon de paie enregistré.
                </div>
              ) : (
                <div className="space-y-3">
                  {runRows.map((run) => {
                    const href = `/admin/finance/payroll?month=${encodeURIComponent(
                      run.period_month.slice(0, 7)
                    )}&scope=${encodeURIComponent(run.scope)}&rate_first=${encodeURIComponent(
                      String(run.default_rate_first_cycle)
                    )}&rate_second=${encodeURIComponent(
                      String(run.default_rate_second_cycle)
                    )}&run_id=${encodeURIComponent(run.id)}`;

                    return (
                      <Link
                        key={run.id}
                        href={href}
                        className={`block rounded-2xl border p-4 transition hover:bg-slate-50 ${
                          selectedRun?.id === run.id
                            ? "border-emerald-300 bg-emerald-50/40"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-black text-slate-900">
                              {formatMonthLabel(run.period_month.slice(0, 7))}
                            </div>
                            <div className="mt-1 text-sm text-slate-600">
                              {run.scope === "vacataires_only"
                                ? "Vacataires seulement"
                                : "Tous les enseignants"}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              Généré le {formatDate(run.generated_at)}
                            </div>
                          </div>

                          <StatusPill status={run.status} />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {selectedRun ? (
            <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-black text-slate-900">
                      {formatMonthLabel(selectedRun.period_month.slice(0, 7))}
                    </h2>
                    <StatusPill status={selectedRun.status} />
                  </div>

                  <div className="mt-2 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <span className="font-semibold text-slate-800">Période :</span>{" "}
                      {formatDate(selectedRun.period_start)} → {formatDate(selectedRun.period_end)}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-800">Périmètre :</span>{" "}
                      {selectedRun.scope === "vacataires_only"
                        ? "Vacataires seulement"
                        : "Tous les enseignants"}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-800">Tarif 1er cycle :</span>{" "}
                      {formatMoney(selectedRun.default_rate_first_cycle)}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-800">Tarif 2nd cycle :</span>{" "}
                      {formatMoney(selectedRun.default_rate_second_cycle)}
                    </div>
                  </div>

                  {selectedRun.notes ? (
                    <p className="mt-3 text-sm leading-6 text-slate-600">{selectedRun.notes}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-3">
                  {selectedRun.status === "draft" ? (
                    <form action={validatePayrollRunAction}>
                      <input type="hidden" name="run_id" value={selectedRun.id} />
                      <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">
                        <BadgeCheck className="h-4 w-4" />
                        Valider ce brouillon
                      </button>
                    </form>
                  ) : null}

                  <Link
                    href={`/admin/finance/payroll?month=${encodeURIComponent(
                      selectedRun.period_month.slice(0, 7)
                    )}&scope=${encodeURIComponent(selectedRun.scope)}&rate_first=${encodeURIComponent(
                      String(selectedRun.default_rate_first_cycle)
                    )}&rate_second=${encodeURIComponent(
                      String(selectedRun.default_rate_second_cycle)
                    )}&run_id=${encodeURIComponent(selectedRun.id)}&print=1`}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <Printer className="h-4 w-4" />
                    Vue impression / PDF
                  </Link>
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center text-sm text-slate-600 shadow-sm">
              Aucun run de paie chargé pour le moment. Génère un brouillon pour ce mois.
            </section>
          )}

          {selectedRun ? (
            <>
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  icon={<FileSpreadsheet className="h-6 w-6" />}
                  label="Lignes"
                  value={selectedRunLines.length}
                  hint="Enseignants dans la fiche"
                  tone="slate"
                />
                <StatCard
                  icon={<CalendarClock className="h-6 w-6" />}
                  label="Séances attendues"
                  value={totals.expectedSessions}
                  hint={minutesToHourLabel(totals.expectedMinutes)}
                  tone="emerald"
                />
                <StatCard
                  icon={<CalendarClock className="h-6 w-6" />}
                  label="Séances accomplies"
                  value={totals.actualSessions}
                  hint={minutesToHourLabel(totals.actualMinutes)}
                  tone="amber"
                />
                <StatCard
                  icon={<Wallet className="h-6 w-6" />}
                  label="Montant brut"
                  value={formatMoney(totals.gross)}
                  hint={`${totals.firstCycle} séances 1er cycle • ${totals.secondCycle} séances 2nd cycle`}
                  tone="violet"
                />
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                  <BadgeDollarSign className="h-4 w-4 text-emerald-600" />
                  Fiche globale de paie
                </div>

                {selectedRunLines.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
                    Ce run ne contient encore aucune ligne.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-3 text-left font-bold text-slate-600">Enseignant</th>
                          <th className="px-3 py-3 text-left font-bold text-slate-600">Statut</th>
                          <th className="px-3 py-3 text-right font-bold text-slate-600">Séances prévues</th>
                          <th className="px-3 py-3 text-right font-bold text-slate-600">Séances accomplies</th>
                          <th className="px-3 py-3 text-right font-bold text-slate-600">Heures prévues</th>
                          <th className="px-3 py-3 text-right font-bold text-slate-600">Heures accomplies</th>
                          <th className="px-3 py-3 text-right font-bold text-slate-600">1er cycle</th>
                          <th className="px-3 py-3 text-right font-bold text-slate-600">2nd cycle</th>
                          <th className="px-3 py-3 text-right font-bold text-slate-600">Tarif 1er cycle</th>
                          <th className="px-3 py-3 text-right font-bold text-slate-600">Tarif 2nd cycle</th>
                          <th className="px-3 py-3 text-right font-bold text-slate-600">Montant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRunLines.map((row) => (
                          <tr key={row.id} className="border-t border-slate-100">
                            <td className="px-3 py-3">
                              <div className="font-bold text-slate-900">
                                {row.teacher_name_snapshot || "Enseignant"}
                              </div>
                              {row.notes ? (
                                <div className="mt-1 text-xs text-slate-500">{row.notes}</div>
                              ) : null}
                            </td>
                            <td className="px-3 py-3 text-slate-700">
                              {row.employment_type === "vacataire" ? "Vacataire" : "Permanent"}
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {row.expected_sessions}
                            </td>
                            <td className="px-3 py-3 text-right font-semibold text-slate-900">
                              {row.actual_sessions}
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {minutesToHourLabel(row.expected_minutes)}
                            </td>
                            <td className="px-3 py-3 text-right font-semibold text-slate-900">
                              {minutesToHourLabel(row.actual_minutes)}
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {row.sessions_first_cycle}
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {row.sessions_second_cycle}
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {formatMoney(row.rate_first_cycle)}
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {formatMoney(row.rate_second_cycle)}
                            </td>
                            <td className="px-3 py-3 text-right font-black text-emerald-700">
                              {formatMoney(row.gross_amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-50">
                          <td className="px-3 py-3 font-black text-slate-900" colSpan={2}>
                            Total
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-slate-900">
                            {totals.expectedSessions}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-slate-900">
                            {totals.actualSessions}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-slate-900">
                            {minutesToHourLabel(totals.expectedMinutes)}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-slate-900">
                            {minutesToHourLabel(totals.actualMinutes)}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-slate-900">
                            {totals.firstCycle}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-slate-900">
                            {totals.secondCycle}
                          </td>
                          <td className="px-3 py-3"></td>
                          <td className="px-3 py-3"></td>
                          <td className="px-3 py-3 text-right font-black text-emerald-700">
                            {formatMoney(totals.gross)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}