// src/app/founder/finance/page.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  BarChart3,
  CalendarClock,
  CalendarDays,
  CreditCard,
  FileText,
  GraduationCap,
  Landmark,
  Layers3,
  Receipt,
  School2,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { fetchFinanceChargeBalancesByClasses } from "@/lib/finance/charge-balances";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type QueryResult<T> = { data: T | null; error: { message?: string } | null };
type SearchParams = Record<string, string | string[] | undefined>;
type PeriodKey = "today" | "week" | "month" | "custom";

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

type StudentStats = {
  total: number;
  assigned: number;
  notAssigned: number;
  assignmentUnknown: number;
  boarders: number;
  notBoarders: number;
  boardingUnknown: number;
  boys: number;
  girls: number;
  genderUnknown: number;
};

const CIV_TIME_ZONE = "Africa/Abidjan";
const PERIOD_OPTIONS: Array<{ key: Exclude<PeriodKey, "custom">; label: string }> = [
  { key: "today", label: "Aujourd’hui" },
  { key: "week", label: "Cette semaine" },
  { key: "month", label: "Ce mois" },
];

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CIV_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function computeAcademicYear(d = new Date()) {
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function dateFromYmd(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function ymdFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number) {
  const date = dateFromYmd(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return ymdFromDate(date);
}

function firstDayOfMonth(ymd: string) {
  const date = dateFromYmd(ymd);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function firstDayOfNextMonth(ymd: string) {
  const date = dateFromYmd(firstDayOfMonth(ymd));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return ymdFromDate(date);
}

function weekStartMonday(ymd: string) {
  const date = dateFromYmd(ymd);
  const jsDay = date.getUTCDay();
  const diff = jsDay === 0 ? -6 : 1 - jsDay;
  date.setUTCDate(date.getUTCDate() + diff);
  return ymdFromDate(date);
}

function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function one(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function dayBoundsIso(startYmd: string, endExclusiveYmd: string) {
  return {
    startIso: dateFromYmd(startYmd).toISOString(),
    endIso: dateFromYmd(endExclusiveYmd).toISOString(),
  };
}

function getPeriod(searchParams: SearchParams) {
  const today = todayYmd();
  const rawPeriod = one(searchParams, "period");
  const period: PeriodKey = rawPeriod === "week" || rawPeriod === "month" || rawPeriod === "custom" ? rawPeriod : "today";
  const rawFrom = one(searchParams, "from");
  const rawTo = one(searchParams, "to");

  if (period === "week") {
    const startYmd = weekStartMonday(today);
    const endExclusiveYmd = addDays(startYmd, 7);
    return {
      period,
      startYmd,
      endExclusiveYmd,
      fromInput: startYmd,
      toInput: addDays(endExclusiveYmd, -1),
      label: "Cette semaine",
      detail: `${startYmd} au ${addDays(endExclusiveYmd, -1)}`,
    };
  }

  if (period === "month") {
    const startYmd = firstDayOfMonth(today);
    const endExclusiveYmd = firstDayOfNextMonth(today);
    return {
      period,
      startYmd,
      endExclusiveYmd,
      fromInput: startYmd,
      toInput: addDays(endExclusiveYmd, -1),
      label: "Ce mois",
      detail: `${startYmd} au ${addDays(endExclusiveYmd, -1)}`,
    };
  }

  if (period === "custom") {
    const from = isYmd(rawFrom) ? rawFrom : today;
    const to = isYmd(rawTo) ? rawTo : from;
    const startYmd = from <= to ? from : to;
    const endInput = from <= to ? to : from;
    const endExclusiveYmd = addDays(endInput, 1);

    return {
      period,
      startYmd,
      endExclusiveYmd,
      fromInput: startYmd,
      toInput: endInput,
      label: "Période personnalisée",
      detail: `${startYmd} au ${endInput}`,
    };
  }

  const endExclusiveYmd = addDays(today, 1);
  return {
    period: "today" as const,
    startYmd: today,
    endExclusiveYmd,
    fromInput: today,
    toInput: today,
    label: "Aujourd’hui",
    detail: today,
  };
}

function money(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function chunks<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeGender(value: unknown): "boy" | "girl" | null {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!raw) return null;
  if (["m", "masculin", "male", "garcon", "garcons", "homme", "boy"].includes(raw)) return "boy";
  if (["f", "feminin", "female", "fille", "filles", "femme", "girl"].includes(raw)) return "girl";
  return null;
}

function emptyStudentStats(): StudentStats {
  return {
    total: 0,
    assigned: 0,
    notAssigned: 0,
    assignmentUnknown: 0,
    boarders: 0,
    notBoarders: 0,
    boardingUnknown: 0,
    boys: 0,
    girls: 0,
    genderUnknown: 0,
  };
}

function buildStudentStats(enrollments: any[]): StudentStats {
  const stats = emptyStudentStats();
  const seen = new Set<string>();

  for (const enrollment of enrollments) {
    const studentId = String(enrollment?.student_id || enrollment?.students?.id || "").trim();
    if (!studentId || seen.has(studentId)) continue;
    seen.add(studentId);

    const student = enrollment?.students ?? {};
    stats.total += 1;

    if (student.is_affecte === true) stats.assigned += 1;
    else if (student.is_affecte === false) stats.notAssigned += 1;
    else stats.assignmentUnknown += 1;

    if (student.is_boarder === true) stats.boarders += 1;
    else if (student.is_boarder === false) stats.notBoarders += 1;
    else stats.boardingUnknown += 1;

    const gender = normalizeGender(student.gender);
    if (gender === "boy") stats.boys += 1;
    else if (gender === "girl") stats.girls += 1;
    else stats.genderUnknown += 1;
  }

  return stats;
}

async function safeData<T>(label: string, query: PromiseLike<QueryResult<T>>, fallback: T): Promise<T> {
  try {
    const res = await query;
    if (res?.error) {
      console.warn(`[founder/finance] ${label}:`, res.error.message || res.error);
      return fallback;
    }
    return (res?.data ?? fallback) as T;
  } catch (e: any) {
    console.warn(`[founder/finance] ${label}:`, e?.message || e);
    return fallback;
  }
}

function periodHref(period: Exclude<PeriodKey, "custom">) {
  return `/founder/finance?period=${period}`;
}

function MiniStatCard({
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
  const tones: Record<NonNullable<typeof tone>, string> = {
    slate: "border-slate-200 bg-white text-slate-950",
    emerald: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
    amber: "border-amber-200 bg-amber-50/70 text-amber-900",
    violet: "border-violet-200 bg-violet-50/70 text-violet-900",
  };

  return (
    <div className={`rounded-[24px] border p-4 shadow-sm ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
          <div className="mt-2 truncate text-2xl font-black sm:text-3xl">{value}</div>
          <p className="mt-1 text-xs font-semibold text-slate-600">{hint}</p>
        </div>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/70 text-slate-700 ring-1 ring-slate-200">
          {icon}
        </div>
      </div>
    </div>
  );
}

function ModuleCard({ icon, title, description, badge }: { icon: ReactNode; title: string; description: string; badge?: string }) {
  return (
    <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
            {icon}
          </div>
          <h3 className="mt-3 text-base font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        {badge ? (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-700 ring-1 ring-slate-200">
            {badge}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default async function FounderFinancePage({ searchParams }: PageProps) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const selectedPeriod = getPeriod(resolvedSearchParams);
  const { startIso, endIso } = dayBoundsIso(selectedPeriod.startYmd, selectedPeriod.endExclusiveYmd);

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

  const fallbackAcademicYear = computeAcademicYear();

  const [institutions, academicYearRows] = await Promise.all([
    safeData<any[]>(
      "institutions",
      service.from("institutions").select("id,name").in("id", institutionIds).order("name"),
      [],
    ),
    safeData<any[]>(
      "academic_years",
      service
        .from("academic_years")
        .select("institution_id,code,label,start_date")
        .in("institution_id", institutionIds)
        .eq("is_current", true)
        .order("start_date", { ascending: false }),
      [],
    ),
  ]);

  const currentYearByInstitution = new Map<string, string>();
  for (const row of academicYearRows ?? []) {
    const institutionId = String(row.institution_id || "").trim();
    const code = String(row.code || "").trim();
    if (institutionId && code && !currentYearByInstitution.has(institutionId)) {
      currentYearByInstitution.set(institutionId, code);
    }
  }
  for (const institutionId of institutionIds) {
    if (!currentYearByInstitution.has(institutionId)) currentYearByInstitution.set(institutionId, fallbackAcademicYear);
  }

  const rawClasses = await safeData<any[]>(
    "classes",
    service
      .from("classes")
      .select("id,institution_id,academic_year,label,level")
      .in("institution_id", institutionIds)
      .limit(10000),
    [],
  );

  const classRows = (rawClasses ?? []).filter((row: any) => {
    const institutionId = String(row.institution_id || "");
    return String(row.academic_year || "") === currentYearByInstitution.get(institutionId);
  });
  const classIds = Array.from(new Set(classRows.map((row: any) => String(row.id || "")).filter(Boolean)));

  const enrollments: any[] = [];
  if (classIds.length > 0) {
    for (const part of chunks(classIds)) {
      const rows = await safeData<any[]>(
        "class_enrollments.current_year",
        service
          .from("class_enrollments")
          .select(
            "id,institution_id,class_id,student_id,students:student_id(id,gender,is_affecte,is_boarder)",
          )
          .in("institution_id", institutionIds)
          .in("class_id", part)
          .is("end_date", null)
          .limit(10000),
        [],
      );
      enrollments.push(...rows);
    }
  }

  const [feeCategories, feeSchedulesRaw, receipts, expenses, teacherPayProfiles, teacherPayrollRuns] = await Promise.all([
    safeData<any[]>(
      "finance.fee_categories",
      service
        .schema("finance")
        .from("fee_categories")
        .select("id,school_id,name,code,is_active")
        .in("school_id", institutionIds)
        .order("name", { ascending: true })
        .range(0, 9999),
      [],
    ),
    safeData<any[]>(
      "finance.fee_schedules",
      service
        .schema("finance")
        .from("fee_schedules")
        .select("id,school_id,class_id,label,amount,due_date,allow_partial,is_active,academic_year")
        .in("school_id", institutionIds)
        .order("created_at", { ascending: false })
        .range(0, 49999),
      [],
    ),
    safeData<any[]>(
      "finance.receipts",
      service
        .schema("finance")
        .from("receipts")
        .select("id,school_id,student_id,receipt_no,total_amount,receipt_status,payment_date,payer_name,academic_year")
        .in("school_id", institutionIds)
        .eq("receipt_status", "posted")
        .gte("payment_date", startIso)
        .lt("payment_date", endIso)
        .order("payment_date", { ascending: false })
        .range(0, 49999),
      [],
    ),
    safeData<any[]>(
      "finance.expenses",
      service
        .schema("finance")
        .from("expenses")
        .select("id,school_id,expense_status,expense_date,label,amount,beneficiary")
        .in("school_id", institutionIds)
        .eq("expense_status", "posted")
        .gte("expense_date", selectedPeriod.startYmd)
        .lt("expense_date", selectedPeriod.endExclusiveYmd)
        .order("expense_date", { ascending: false })
        .range(0, 49999),
      [],
    ),
    safeData<any[]>(
      "finance.teacher_pay_profiles",
      service
        .schema("finance")
        .from("teacher_pay_profiles")
        .select("id,institution_id,profile_id,employment_type,payroll_enabled")
        .in("institution_id", institutionIds)
        .range(0, 49999),
      [],
    ),
    safeData<any[]>(
      "finance.teacher_payroll_runs",
      service
        .schema("finance")
        .from("teacher_payroll_runs")
        .select("id,institution_id,status,period_month,academic_year")
        .in("institution_id", institutionIds)
        .order("generated_at", { ascending: false })
        .range(0, 49999),
      [],
    ),
  ]);

  const feeSchedules = (feeSchedulesRaw ?? []).filter((row: any) => {
    const schoolId = String(row.school_id || "");
    const expectedYear = currentYearByInstitution.get(schoolId);
    return !row.academic_year || !expectedYear || String(row.academic_year) === expectedYear;
  });

  let balanceRows: any[] = [];
  if (classIds.length > 0) {
    try {
      balanceRows = await fetchFinanceChargeBalancesByClasses({
        institutionIds,
        classIds,
        select: "id,school_id,student_id,class_id,label,net_amount,paid_amount,balance_due,due_date,computed_status",
      });
    } catch (e: any) {
      console.warn("[founder/finance] finance.v_charge_balances:", e?.message || e);
      balanceRows = [];
    }
  }

  const activeFeeCategories = (feeCategories ?? []).filter((r: any) => r.is_active).length;
  const activeSchedules = feeSchedules.filter((r: any) => r.is_active);
  const openBalances = balanceRows.filter((r: any) => Number(r.balance_due || 0) > 0);
  const overdueBalances = openBalances.filter((r: any) => {
    if (!r.due_date) return false;
    return new Date(`${r.due_date}T23:59:59`).getTime() < Date.now();
  });
  const postedExpenses = expenses.filter((r: any) => r.expense_status === "posted");
  const payrollEnabledTeachers = teacherPayProfiles.filter((r: any) => r.payroll_enabled);
  const payrollDraftRuns = teacherPayrollRuns.filter((r: any) => r.status === "draft");
  const payrollValidatedRuns = teacherPayrollRuns.filter((r: any) => r.status === "validated");

  const totalBilled = balanceRows.reduce((sum, row) => sum + Number(row.net_amount || 0), 0);
  const totalCollected = balanceRows.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
  const totalDue = openBalances.reduce((sum, row) => sum + Number(row.balance_due || 0), 0);
  const totalReceiptsPeriod = receipts.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const totalExpensesPeriod = postedExpenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const netPeriod = totalReceiptsPeriod - totalExpensesPeriod;
  const coverageRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;
  const totalStudentStats = buildStudentStats(enrollments);

  const rows = (institutions ?? []).map((school: any) => {
    const schoolId = school.id;
    const schoolReceipts = receipts.filter((r: any) => r.school_id === schoolId);
    const schoolExpenses = postedExpenses.filter((e: any) => e.school_id === schoolId);
    const schoolBalances = balanceRows.filter((b: any) => b.school_id === schoolId);
    const schoolOpenBalances = schoolBalances.filter((b: any) => Number(b.balance_due || 0) > 0);
    const schoolOverdue = schoolOpenBalances.filter((b: any) => {
      if (!b.due_date) return false;
      return new Date(`${b.due_date}T23:59:59`).getTime() < Date.now();
    });
    const schoolSchedules = activeSchedules.filter((s: any) => s.school_id === schoolId);
    const schoolCategories = (feeCategories ?? []).filter((c: any) => c.school_id === schoolId && c.is_active);
    const schoolEnrollments = enrollments.filter((e: any) => e.institution_id === schoolId);
    const studentStats = buildStudentStats(schoolEnrollments);

    const billed = schoolBalances.reduce((sum: number, row: any) => sum + Number(row.net_amount || 0), 0);
    const collected = schoolBalances.reduce((sum: number, row: any) => sum + Number(row.paid_amount || 0), 0);
    const due = schoolOpenBalances.reduce((sum: number, row: any) => sum + Number(row.balance_due || 0), 0);
    const receiptPeriod = schoolReceipts.reduce((sum: number, r: any) => sum + Number(r.total_amount || 0), 0);
    const expensePeriod = schoolExpenses.reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);

    return {
      school,
      billed,
      collected,
      due,
      receiptPeriod,
      expensePeriod,
      netPeriod: receiptPeriod - expensePeriod,
      receiptsCount: schoolReceipts.length,
      expensesCount: schoolExpenses.length,
      openBalancesCount: schoolOpenBalances.length,
      overdueCount: schoolOverdue.length,
      schedulesCount: schoolSchedules.length,
      categoriesCount: schoolCategories.length,
      studentStats,
    };
  });

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-5 py-6 text-white shadow-xl sm:px-6 sm:py-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <Wallet className="h-3.5 w-3.5" />
              Finance fondateur
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Tableau de bord financier multi-écoles
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Vue consolidée des frais, barèmes, dettes élèves, encaissements, dépenses, impayés et paie enseignants comme dans l’espace gestionnaire financier.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 ring-1 ring-emerald-400/25">
                Couverture : {coverageRate}%
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                {institutions.length} établissement(s)
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                {selectedPeriod.label} · {selectedPeriod.detail}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">Total facturé</div>
              <div className="mt-2 text-3xl font-black text-white">{money(totalBilled)}</div>
              <div className="mt-1 text-sm text-slate-200">Toutes dettes générées</div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">Total encaissé</div>
              <div className="mt-2 text-3xl font-black text-white">{money(totalCollected)}</div>
              <div className="mt-1 text-sm text-slate-200">Paiements comptabilisés</div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">
              Période d’analyse
            </p>
            <p className="mt-1 text-xs font-semibold text-slate-500 sm:text-sm">
              Les montants facturé/à recouvrer restent liés à l’année courante ; les encaissements et dépenses ci-dessous suivent la période choisie.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {PERIOD_OPTIONS.map((option) => {
              const active = selectedPeriod.period === option.key;
              return (
                <Link
                  key={option.key}
                  href={periodHref(option.key)}
                  className={[
                    "rounded-full border px-3 py-2 text-xs font-black transition",
                    active
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>
        </div>

        <form className="mt-4 grid gap-2 rounded-[22px] border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]" action="/founder/finance">
          <input type="hidden" name="period" value="custom" />
          <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
            Du
            <input
              type="date"
              name="from"
              defaultValue={selectedPeriod.fromInput}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none focus:border-slate-400"
            />
          </label>
          <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
            Au
            <input
              type="date"
              name="to"
              defaultValue={selectedPeriod.toInput}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none focus:border-slate-400"
            />
          </label>
          <button
            type="submit"
            className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 sm:self-end"
          >
            Appliquer
          </button>
        </form>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStatCard
          icon={<Users className="h-6 w-6" />}
          label="Élèves concernés"
          value={totalStudentStats.total}
          hint={`${classRows.length} classe(s) année courante`}
          tone="slate"
        />
        <MiniStatCard
          icon={<Layers3 className="h-6 w-6" />}
          label="Frais & barèmes"
          value={activeSchedules.length}
          hint={`${activeFeeCategories} catégorie(s) active(s)`}
          tone="emerald"
        />
        <MiniStatCard
          icon={<Receipt className="h-6 w-6" />}
          label="Reste à recouvrer"
          value={money(totalDue)}
          hint={`${openBalances.length} dette(s) ouverte(s)`}
          tone="amber"
        />
        <MiniStatCard
          icon={<BarChart3 className="h-6 w-6" />}
          label="Dépenses période"
          value={money(totalExpensesPeriod)}
          hint={`${postedExpenses.length} écriture(s) postée(s)`}
          tone="violet"
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MiniStatCard icon={<GraduationCap className="h-5 w-5" />} label="Affectés" value={totalStudentStats.assigned} hint="Scolarité affectée" />
        <MiniStatCard icon={<GraduationCap className="h-5 w-5" />} label="Non affectés" value={totalStudentStats.notAssigned} hint="Scolarité non affectée" tone="amber" />
        <MiniStatCard icon={<School2 className="h-5 w-5" />} label="Internes" value={totalStudentStats.boarders} hint="Internat oui" tone="emerald" />
        <MiniStatCard icon={<School2 className="h-5 w-5" />} label="Non internes" value={totalStudentStats.notBoarders} hint="Internat non" />
        <MiniStatCard icon={<Users className="h-5 w-5" />} label="Garçons" value={totalStudentStats.boys} hint="Sexe masculin" tone="violet" />
        <MiniStatCard icon={<Users className="h-5 w-5" />} label="Filles" value={totalStudentStats.girls} hint="Sexe féminin" tone="emerald" />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <ModuleCard icon={<Layers3 className="h-5 w-5" />} title="Catégories de frais" description="Lecture consolidée des types de frais actifs." badge={`${feeCategories.length}`} />
        <ModuleCard icon={<CalendarClock className="h-5 w-5" />} title="Barèmes & échéanciers" description="Montants définis par classe et année scolaire." badge={`${activeSchedules.length}`} />
        <ModuleCard icon={<FileText className="h-5 w-5" />} title="Dettes élèves" description="Charges générées et soldes ouverts." badge={`${balanceRows.length}`} />
        <ModuleCard icon={<CreditCard className="h-5 w-5" />} title="Encaissements" description="Paiements reçus sur la période sélectionnée." badge={`${receipts.length}`} />
        <ModuleCard icon={<AlertTriangle className="h-5 w-5" />} title="Impayés" description="Soldes dus et échéances dépassées." badge={`${overdueBalances.length}`} />
        <ModuleCard icon={<Wallet className="h-5 w-5" />} title="Dépenses" description="Dépenses postées sur la période." badge={`${postedExpenses.length}`} />
        <ModuleCard icon={<TrendingUp className="h-5 w-5" />} title="Rapports" description="Lecture des synthèses par établissement." />
        <ModuleCard icon={<BadgeDollarSign className="h-5 w-5" />} title="Paie enseignants" description="Profils et runs de paie suivis." badge={`${payrollEnabledTeachers.length}`} />
        <ModuleCard icon={<Receipt className="h-5 w-5" />} title="Reçus" description="Reçus postés consultés dans la synthèse." badge={`${receipts.length}`} />
        <ModuleCard icon={<Landmark className="h-5 w-5" />} title="Solde période" description="Encaissements moins dépenses période." badge={money(netPeriod)} />
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-black text-slate-950">
            <CalendarDays className="h-4 w-4 text-slate-500" /> Détail par établissement
          </div>
          <p className="text-xs font-semibold text-slate-500">{selectedPeriod.label}</p>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {rows.length === 0 ? (
          <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800">
            Aucune école rattachée trouvée pour ce compte fondateur.
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.school.id} className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate font-black text-slate-950">{row.school.name || "Établissement"}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{row.school.id}</div>
                </div>
                <div className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                  {selectedPeriod.label}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3 sm:gap-3">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 sm:p-4">
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-700">
                    <Receipt className="h-4 w-4" /> Facturé
                  </div>
                  <div className="mt-2 text-xl font-black text-emerald-800 sm:text-2xl">{money(row.billed)}</div>
                  <div className="mt-1 text-xs text-emerald-700">encaissé : {money(row.collected)}</div>
                </div>

                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 sm:p-4">
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-amber-700">
                    <Wallet className="h-4 w-4" /> À recouvrer
                  </div>
                  <div className="mt-2 text-xl font-black text-amber-800 sm:text-2xl">{money(row.due)}</div>
                  <div className="mt-1 text-xs text-amber-700">{row.openBalancesCount} dette(s) ouverte(s)</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Solde période</div>
                  <div className="mt-2 text-xl font-black text-slate-950 sm:text-2xl">{money(row.netPeriod)}</div>
                  <div className="mt-1 text-xs text-slate-500">{row.receiptsCount} reçu(s), {row.expensesCount} dépense(s)</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">Élèves : {row.studentStats.total}</span>
                <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">Affectés : {row.studentStats.assigned}</span>
                <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">Non affectés : {row.studentStats.notAssigned}</span>
                <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">Internes : {row.studentStats.boarders}</span>
                <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">Non internes : {row.studentStats.notBoarders}</span>
                <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">G : {row.studentStats.boys}</span>
                <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">F : {row.studentStats.girls}</span>
                <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">Barèmes : {row.schedulesCount}</span>
                <span className="rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">Catégories : {row.categoriesCount}</span>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800 ring-1 ring-amber-200">Échues : {row.overdueCount}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <MiniStatCard icon={<BadgeDollarSign className="h-6 w-6" />} label="Profils paie actifs" value={payrollEnabledTeachers.length} hint="Enseignants inclus dans la paie" tone="emerald" />
        <MiniStatCard icon={<CalendarClock className="h-6 w-6" />} label="Brouillons paie" value={payrollDraftRuns.length} hint="Runs non validés" tone="amber" />
        <MiniStatCard icon={<Receipt className="h-6 w-6" />} label="Paies validées" value={payrollValidatedRuns.length} hint="Historique disponible" tone="violet" />
      </section>
    </div>
  );
}
