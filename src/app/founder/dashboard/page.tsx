// src/app/founder/dashboard/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarCheck2,
  GraduationCap,
  Receipt,
  School2,
  UsersRound,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { fetchFinanceChargeBalancesByClasses } from "@/lib/finance/charge-balances";

export const dynamic = "force-dynamic";

type InstitutionRow = {
  id: string;
  name: string | null;
};

type QueryResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

type FounderDashboardSearchParams = {
  date?: string | string[];
  start?: string | string[];
  end?: string | string[];
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

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CIV_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatYmdFr(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function addDaysYmd(ymd: string, days: number) {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStartYmd(ymd: string) {
  return `${ymd.slice(0, 8)}01`;
}

function getFirstParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function periodLabel(start: string, end: string, today: string) {
  if (start === end) return start === today ? "aujourd’hui" : `le ${formatYmdFr(start)}`;
  return `du ${formatYmdFr(start)} au ${formatYmdFr(end)}`;
}

function computeAcademicYear(d = new Date()) {
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function dayBoundsIso(ymd: string) {
  // La Côte d’Ivoire est en UTC toute l’année. On garde donc des bornes ISO strictes
  // pour les colonnes timestamp comme finance.receipts.payment_date.
  const start = new Date(`${ymd}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function money(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}


type DashboardTone = "emerald" | "amber" | "sky" | "violet" | "rose" | "teal" | "slate";

const TONE_CLASSES: Record<DashboardTone, { card: string; icon: string; value: string }> = {
  emerald: {
    card: "border-emerald-200 bg-emerald-50/50",
    icon: "bg-emerald-100 text-emerald-700",
    value: "text-emerald-800",
  },
  amber: {
    card: "border-amber-200 bg-amber-50/60",
    icon: "bg-amber-100 text-amber-700",
    value: "text-amber-800",
  },
  sky: {
    card: "border-sky-200 bg-sky-50/60",
    icon: "bg-sky-100 text-sky-700",
    value: "text-sky-800",
  },
  violet: {
    card: "border-violet-200 bg-violet-50/60",
    icon: "bg-violet-100 text-violet-700",
    value: "text-violet-800",
  },
  rose: {
    card: "border-rose-200 bg-rose-50/60",
    icon: "bg-rose-100 text-rose-700",
    value: "text-rose-800",
  },
  teal: {
    card: "border-teal-200 bg-teal-50/60",
    icon: "bg-teal-100 text-teal-700",
    value: "text-teal-800",
  },
  slate: {
    card: "border-slate-200 bg-white",
    icon: "bg-slate-100 text-slate-700",
    value: "text-slate-950",
  },
};

const CATEGORY_TONES: DashboardTone[] = ["emerald", "sky", "amber", "violet", "teal", "rose", "slate"];

function normalizeCategoryKey(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
      console.warn(`[founder/dashboard] ${label}:`, res.error.message || res.error);
      return fallback;
    }
    return (res?.data ?? fallback) as T;
  } catch (e: any) {
    console.warn(`[founder/dashboard] ${label}:`, e?.message || e);
    return fallback;
  }
}

async function getFounderContext() {
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const roles = await safeData<any[]>(
    "user_roles",
    service
      .from("user_roles")
      .select("institution_id,role")
      .eq("profile_id", user.id)
      .eq("role", "founder"),
    [],
  );

  const institutionIds: string[] = Array.from(
    new Set((roles ?? []).map((row: any) => String(row.institution_id || "")).filter(Boolean)),
  );

  if (!institutionIds.length) redirect("/profile");

  const institutions = await safeData<InstitutionRow[]>(
    "institutions",
    service
      .from("institutions")
      .select("id,name")
      .in("id", institutionIds)
      .order("name", { ascending: true }),
    [],
  );

  return { service, institutionIds, institutions };
}

export default async function FounderDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<FounderDashboardSearchParams>;
}) {
  const { service, institutionIds, institutions } = await getFounderContext();
  const resolvedSearchParams: FounderDashboardSearchParams = searchParams
    ? await searchParams
    : {};
  const rawStartParam = getFirstParamValue(resolvedSearchParams.start);
  const rawEndParam = getFirstParamValue(resolvedSearchParams.end);
  const rawDateParam = getFirstParamValue(resolvedSearchParams.date);

  const today = todayYmd();
  const fallbackSingleDate = isYmd(rawDateParam) ? rawDateParam : today;
  const requestedStart = isYmd(rawStartParam) ? rawStartParam : fallbackSingleDate;
  const requestedEnd = isYmd(rawEndParam) ? rawEndParam : fallbackSingleDate;
  const periodStart = requestedStart <= requestedEnd ? requestedStart : requestedEnd;
  const periodEnd = requestedStart <= requestedEnd ? requestedEnd : requestedStart;
  const selectedDateLabel = periodLabel(periodStart, periodEnd, today);
  const { startIso } = dayBoundsIso(periodStart);
  const { endIso } = dayBoundsIso(periodEnd);
  const todayHref = `/founder/dashboard?start=${today}&end=${today}`;
  const last7Start = addDaysYmd(today, -6);
  const last7Href = `/founder/dashboard?start=${last7Start}&end=${today}`;
  const monthHref = `/founder/dashboard?start=${monthStartYmd(today)}&end=${today}`;
  const fallbackAcademicYear = computeAcademicYear();

  const academicYearRows = await safeData<any[]>(
    "academic_years",
    service
      .from("academic_years")
      .select("institution_id,code,label,start_date")
      .in("institution_id", institutionIds)
      .eq("is_current", true)
      .order("start_date", { ascending: false }),
    [],
  );

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
      .select("id,institution_id,academic_year")
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

  let balanceRows: any[] = [];
  if (classIds.length > 0) {
    try {
      balanceRows = await fetchFinanceChargeBalancesByClasses({
        institutionIds,
        classIds,
        select: "id,school_id,student_id,class_id,net_amount,paid_amount,balance_due,due_date,computed_status",
      });
    } catch (e: any) {
      console.warn("[founder/dashboard] finance.v_charge_balances:", e?.message || e);
      balanceRows = [];
    }
  }

  const [periods, receipts, expenses, feeCategories, feeSchedules] = await Promise.all([
    safeData<any[]>(
      "institution_periods",
      service
        .from("institution_periods")
        .select("id,institution_id,is_active")
        .in("institution_id", institutionIds)
        .eq("is_active", true),
      [],
    ),
    safeData<any[]>(
      "finance.receipts",
      service
        .schema("finance")
        .from("receipts")
        .select("id,school_id,total_amount,receipt_status,payment_date,academic_year")
        .in("school_id", institutionIds)
        .eq("receipt_status", "posted")
        .gte("payment_date", startIso)
        .lt("payment_date", endIso),
      [],
    ),
    safeData<any[]>(
      "finance.expenses",
      service
        .schema("finance")
        .from("expenses")
        .select("id,school_id,amount,expense_status,expense_date")
        .in("school_id", institutionIds)
        .eq("expense_status", "posted")
        .gte("expense_date", periodStart)
        .lte("expense_date", periodEnd),
      [],
    ),
    safeData<any[]>(
      "finance.fee_categories",
      service
        .schema("finance")
        .from("fee_categories")
        .select("id,school_id,code,name,is_active")
        .in("school_id", institutionIds)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      [],
    ),
    safeData<any[]>(
      "finance.fee_schedules",
      service
        .schema("finance")
        .from("fee_schedules")
        .select("id,school_id,academic_year,is_active")
        .in("school_id", institutionIds)
        .eq("is_active", true),
      [],
    ),
  ]);

  const receiptIds = Array.from(
    new Set((receipts ?? []).map((row: any) => String(row.id || "")).filter(Boolean)),
  );

  const receiptAllocations = await safeData<any[]>(
    "finance.receipt_allocations",
    receiptIds.length
      ? service
          .schema("finance")
          .from("receipt_allocations")
          .select("id,receipt_id,student_charge_id,amount")
          .in("receipt_id", receiptIds)
      : Promise.resolve({ data: [], error: null }),
    [],
  );

  const allocatedChargeIds = Array.from(
    new Set(
      (receiptAllocations ?? [])
        .map((row: any) => String(row.student_charge_id || ""))
        .filter(Boolean),
    ),
  );

  const allocatedCharges = await safeData<any[]>(
    "finance.v_charge_balances.allocations",
    allocatedChargeIds.length
      ? service
          .schema("finance")
          .from("v_charge_balances")
          .select("id,fee_category_id,label")
          .in("id", allocatedChargeIds)
      : Promise.resolve({ data: [], error: null }),
    [],
  );

  const allocatedCategoryIds = Array.from(
    new Set(
      (allocatedCharges ?? [])
        .map((row: any) => String(row.fee_category_id || ""))
        .filter(Boolean),
    ),
  );

  const allocatedCategories = await safeData<any[]>(
    "finance.fee_categories.allocations",
    allocatedCategoryIds.length
      ? service
          .schema("finance")
          .from("fee_categories")
          .select("id,code,name")
          .in("id", allocatedCategoryIds)
      : Promise.resolve({ data: [], error: null }),
    [],
  );

  // Le fondateur encaisse par DATE : un paiement reçu à la date filtrée
  // peut concerner 2025-2026, 2026-2027 ou une année prochaine.
  // On ne filtre donc pas les encaissements de période par année scolaire.
  const totalReceiptsToday = receipts.reduce((sum: number, row: any) => sum + Number(row.total_amount || 0), 0);
  const totalCollectedCurrentYear = balanceRows.reduce((sum: number, row: any) => sum + Number(row.paid_amount || 0), 0);
  const totalBilledCurrentYear = balanceRows.reduce((sum: number, row: any) => sum + Number(row.net_amount || 0), 0);
  const totalBalanceDueCurrentYear = balanceRows.reduce((sum: number, row: any) => sum + Number(row.balance_due || 0), 0);
  const totalExpenses = expenses.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  const net = totalReceiptsToday - totalExpenses;
  const totalStudentStats = buildStudentStats(enrollments);
  const activeFeeSchedules = (feeSchedules ?? []).filter((row: any) => {
    const schoolId = String(row.school_id || "");
    return String(row.academic_year || "") === currentYearByInstitution.get(schoolId);
  }).length;

  const allocationChargeMap = new Map(
    (allocatedCharges ?? []).map((row: any) => [String(row.id), row]),
  );
  const allocationCategoryMap = new Map(
    (allocatedCategories ?? []).map((row: any) => [String(row.id), row]),
  );
  const categoryTotals = new Map<string, { label: string; total: number; count: number; order: number }>();
  let categoryOrder = 0;

  for (const category of feeCategories ?? []) {
    const label = String(category?.name || category?.code || "Catégorie sans nom").trim();
    const key = normalizeCategoryKey(category?.code || label) || String(category?.id || label);
    if (!categoryTotals.has(key)) {
      categoryTotals.set(key, { label, total: 0, count: 0, order: categoryOrder });
      categoryOrder += 1;
    }
  }

  for (const allocation of receiptAllocations ?? []) {
    const amount = Number(allocation.amount || 0);
    if (!amount) continue;
    const charge = allocationChargeMap.get(String(allocation.student_charge_id || ""));
    const category = charge?.fee_category_id
      ? allocationCategoryMap.get(String(charge.fee_category_id))
      : null;
    const label = String(category?.name || charge?.label || "Encaissements non ventilés").trim();
    const key = category
      ? normalizeCategoryKey(category.code || category.name || label)
      : normalizeCategoryKey(label) || "non-ventile";
    const current = categoryTotals.get(key) ?? {
      label,
      total: 0,
      count: 0,
      order: categoryOrder,
    };
    current.total += amount;
    current.count += 1;
    categoryTotals.set(key, current);
    if (current.order === categoryOrder) categoryOrder += 1;
  }

  if (categoryTotals.size === 0 && totalReceiptsToday > 0) {
    categoryTotals.set("non-ventile", {
      label: "Encaissements non ventilés",
      total: totalReceiptsToday,
      count: receipts.length,
      order: categoryOrder,
    });
  }

  const categoryGrandTotal = Array.from(categoryTotals.values()).reduce((sum, item) => sum + item.total, 0);
  const categorySummary = Array.from(categoryTotals.values())
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.order - b.order;
    })
    .map((item, index) => ({
      ...item,
      tone: CATEGORY_TONES[index % CATEGORY_TONES.length],
    }));
  const coverageRate = totalBilledCurrentYear > 0 ? Math.round((totalCollectedCurrentYear / totalBilledCurrentYear) * 100) : 0;

  const rows = institutions.map((school) => {
    const schoolId = school.id;
    const schoolReceipts = receipts.filter((row: any) => row.school_id === schoolId);
    const schoolExpenses = expenses.filter((row: any) => row.school_id === schoolId);
    const schoolEnrollments = enrollments.filter((row: any) => row.institution_id === schoolId);
    const schoolPeriods = periods.filter((row: any) => row.institution_id === schoolId);
    const schoolBalances = balanceRows.filter((row: any) => row.school_id === schoolId);
    const receiptTotalToday = schoolReceipts.reduce((sum: number, row: any) => sum + Number(row.total_amount || 0), 0);
    const collectedCurrentYear = schoolBalances.reduce((sum: number, row: any) => sum + Number(row.paid_amount || 0), 0);
    const billedCurrentYear = schoolBalances.reduce((sum: number, row: any) => sum + Number(row.net_amount || 0), 0);
    const balanceDueCurrentYear = schoolBalances.reduce((sum: number, row: any) => sum + Number(row.balance_due || 0), 0);
    const expenseTotal = schoolExpenses.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    const studentStats = buildStudentStats(schoolEnrollments);

    return {
      school,
      collectedCurrentYear,
      billedCurrentYear,
      balanceDueCurrentYear,
      receiptTotalToday,
      expenseTotal,
      net: receiptTotalToday - expenseTotal,
      periodsCount: schoolPeriods.length,
      studentStats,
    };
  });

  const statCards = [
    {
      label: "Encaissement",
      value: money(totalReceiptsToday),
      hint: `${receipts.length} paiement(s) sur la période`,
      Icon: ArrowUpRight,
      tone: "emerald" as DashboardTone,
    },
    {
      label: "Impayés",
      value: money(totalBalanceDueCurrentYear),
      hint: "Total à recouvrer",
      Icon: ArrowDownRight,
      tone: "amber" as DashboardTone,
    },
    {
      label: "Dépenses",
      value: money(totalExpenses),
      hint: `${expenses.length} dépense(s) validée(s)`,
      Icon: Wallet,
      tone: "sky" as DashboardTone,
    },
    {
      label: "Total exigible",
      value: money(totalBilledCurrentYear),
      hint: "Frais attendus année courante",
      Icon: Receipt,
      tone: "violet" as DashboardTone,
    },
    {
      label: "Écoles",
      value: institutions.length,
      hint: "Rattachées",
      Icon: School2,
      tone: "teal" as DashboardTone,
    },
    {
      label: "Élèves",
      value: totalStudentStats.total,
      hint: "Année courante",
      Icon: GraduationCap,
      tone: "slate" as DashboardTone,
    },
    {
      label: "Rapports",
      value: "Stats",
      hint: "Exports financiers",
      Icon: Activity,
      tone: "rose" as DashboardTone,
    },
  ];

  const profileCards = [
    { label: "Affectés", value: totalStudentStats.assigned, hint: "Scolarité", Icon: UsersRound },
    { label: "Non affectés", value: totalStudentStats.notAssigned, hint: "Scolarité", Icon: UsersRound },
    { label: "Internes", value: totalStudentStats.boarders, hint: "Internat", Icon: School2 },
    { label: "Non internes", value: totalStudentStats.notBoarders, hint: "Internat", Icon: School2 },
    { label: "Garçons", value: totalStudentStats.boys, hint: "Effectif", Icon: GraduationCap },
    { label: "Filles", value: totalStudentStats.girls, hint: "Effectif", Icon: GraduationCap },
  ];

  const financeIndicatorCards = [
    {
      href: "/admin/finance/payments",
      label: "Encaissement",
      value: money(totalReceiptsToday),
      hint: "Période filtrée",
      Icon: ArrowUpRight,
      tone: "emerald" as DashboardTone,
    },
    {
      href: "/admin/finance/arrears",
      label: "Impayés",
      value: money(totalBalanceDueCurrentYear),
      hint: "Restes à recouvrer",
      Icon: ArrowDownRight,
      tone: "amber" as DashboardTone,
    },
    {
      href: "/admin/finance/expenses",
      label: "Dépenses",
      value: money(totalExpenses),
      hint: "Sorties validées",
      Icon: Wallet,
      tone: "sky" as DashboardTone,
    },
    {
      href: "/admin/finance/charges",
      label: "Total exigible",
      value: money(totalBilledCurrentYear),
      hint: "Frais attendus",
      Icon: Receipt,
      tone: "violet" as DashboardTone,
    },
    {
      href: "/admin/finance/reports",
      label: "Rapports",
      value: `${coverageRate}%`,
      hint: "Taux de recouvrement",
      Icon: Activity,
      tone: "teal" as DashboardTone,
    },
    {
      href: "/admin/finance/fees/schedules",
      label: "Barèmes actifs",
      value: activeFeeSchedules,
      hint: "Échéanciers configurés",
      Icon: CalendarCheck2,
      tone: "slate" as DashboardTone,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-xl sm:p-7">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-200">
            Pilotage fondateur
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">
            Vue globale de vos écoles
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-200 sm:text-base">
            Finance, créneaux et élèves — en un coup d’œil.
          </p>

          <form method="get" className="mt-5 rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="start" className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">
                    Du
                  </label>
                  <input
                    id="start"
                    name="start"
                    type="date"
                    defaultValue={periodStart}
                    className="mt-2 w-full rounded-2xl border border-white/20 bg-white px-4 py-2 text-sm font-bold text-slate-950 outline-none ring-0"
                  />
                </div>
                <div>
                  <label htmlFor="end" className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">
                    Au
                  </label>
                  <input
                    id="end"
                    name="end"
                    type="date"
                    defaultValue={periodEnd}
                    className="mt-2 w-full rounded-2xl border border-white/20 bg-white px-4 py-2 text-sm font-bold text-slate-950 outline-none ring-0"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-black text-slate-950 shadow-sm transition hover:bg-emerald-300"
                >
                  Appliquer
                </button>
                <Link href={todayHref} className="rounded-2xl border border-white/20 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
                  Aujourd’hui
                </Link>
                <Link href={last7Href} className="rounded-2xl border border-white/20 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
                  7 jours
                </Link>
                <Link href={monthHref} className="rounded-2xl border border-white/20 px-4 py-2 text-sm font-black text-white transition hover:bg-white/10">
                  Ce mois
                </Link>
              </div>
            </div>
            <p className="mt-3 text-xs font-semibold text-emerald-100/90">
              Période : {selectedDateLabel}
            </p>
          </form>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {statCards.map(({ label, value, hint, Icon, tone }) => {
          const t = TONE_CLASSES[tone];
          return (
            <div key={label} className={`rounded-[28px] border p-5 shadow-sm ${t.card}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
                  <div className={`mt-2 truncate text-2xl font-black ${t.value}`}>{value}</div>
                  <div className="mt-1 text-xs font-medium leading-5 text-slate-500">{hint}</div>
                </div>
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${t.icon}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </section>


      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
              <GraduationCap className="h-4 w-4" />
              Profil des élèves
            </div>
          </div>
          <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">
            Année courante
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {profileCards.map(({ label, value, hint, Icon }) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
                  <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
                  <div className="mt-1 text-xs text-slate-500">{hint}</div>
                </div>
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-slate-700 ring-1 ring-slate-200">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {(totalStudentStats.assignmentUnknown > 0 || totalStudentStats.boardingUnknown > 0 || totalStudentStats.genderUnknown > 0) && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
            À compléter : {totalStudentStats.assignmentUnknown} affectation(s), {totalStudentStats.boardingUnknown} internat(s), {totalStudentStats.genderUnknown} sexe(s) non renseigné(s).
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <Receipt className="h-4 w-4" />
                Montants encaissés par catégorie
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                Toutes les catégories actives de l’établissement sont affichées, même à 0 F.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">
              {periodStart === periodEnd ? formatYmdFr(periodStart) : `${formatYmdFr(periodStart)} → ${formatYmdFr(periodEnd)}`}
            </div>
          </div>

          {categorySummary.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
              Aucune catégorie active trouvée pour les écoles rattachées.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {categorySummary.map(({ label, total, tone }) => {
                const t = TONE_CLASSES[tone];
                return (
                  <div key={label} className={`rounded-2xl border p-4 ${t.card}`}>
                    <div className="flex items-start gap-3">
                      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${t.icon}`}>
                        <Receipt className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-slate-800">{label}</div>
                        <div className={`mt-1 truncate text-2xl font-black ${t.value}`}>{money(total)}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          Montant encaissé
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 rounded-3xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-center">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Total encaissé catégorisé</div>
            <div className="mt-1 text-3xl font-black text-emerald-900">{money(categoryGrandTotal)}</div>
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
              <Wallet className="h-4 w-4" />
              Indicateurs finance
            </div>
            <Link
              href="/admin/finance"
              className="rounded-2xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800"
            >
              Ouvrir
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {financeIndicatorCards.map(({ href, label, value, hint, Icon, tone }) => {
              const t = TONE_CLASSES[tone];
              return (
                <Link
                  key={href}
                  href={href}
                  className={`group rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${t.card}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
                      <div className={`mt-1 truncate text-xl font-black ${t.value}`}>{value}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">{hint}</div>
                    </div>
                    <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${t.icon}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <Building2 className="h-4 w-4" />
                Écoles rattachées
              </div>
            </div>
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">
              {periodStart === periodEnd ? formatYmdFr(periodStart) : `${formatYmdFr(periodStart)} → ${formatYmdFr(periodEnd)}`}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                Aucune école trouvée pour ce compte fondateur.
              </div>
            ) : (
              rows.map(({ school, collectedCurrentYear, billedCurrentYear, balanceDueCurrentYear, expenseTotal, net, periodsCount, studentStats }) => (
                <div key={school.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="font-black text-slate-950">{school.name || "Établissement"}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{school.id}</div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-2xl bg-white p-3">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
                        <ArrowUpRight className="h-4 w-4" /> Encaissé
                      </div>
                      <div className="mt-1 text-lg font-black text-slate-950">{money(collectedCurrentYear)}</div>
                    </div>
                    <div className="rounded-2xl bg-white p-3">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-amber-700">
                        <ArrowDownRight className="h-4 w-4" /> Impayés
                      </div>
                      <div className="mt-1 text-lg font-black text-slate-950">{money(balanceDueCurrentYear)}</div>
                    </div>
                    <div className="rounded-2xl bg-white p-3">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-sky-700">
                        <Wallet className="h-4 w-4" /> Dépenses
                      </div>
                      <div className="mt-1 text-lg font-black text-slate-950">{money(expenseTotal)}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                    <span className="rounded-full bg-white px-3 py-1">Exigible : {money(billedCurrentYear)}</span>
                    <span className="rounded-full bg-white px-3 py-1">Solde : {money(net)}</span>
                    <span className="rounded-full bg-white px-3 py-1">Élèves : {studentStats.total}</span>
                    <span className="rounded-full bg-white px-3 py-1">Affectés : {studentStats.assigned}</span>
                    <span className="rounded-full bg-white px-3 py-1">Non affectés : {studentStats.notAssigned}</span>
                    <span className="rounded-full bg-white px-3 py-1">Internes : {studentStats.boarders}</span>
                    <span className="rounded-full bg-white px-3 py-1">Non internes : {studentStats.notBoarders}</span>
                    <span className="rounded-full bg-white px-3 py-1">G : {studentStats.boys}</span>
                    <span className="rounded-full bg-white px-3 py-1">F : {studentStats.girls}</span>
                    <span className="rounded-full bg-white px-3 py-1">Créneaux : {periodsCount}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">
            Lecture rapide
          </div>
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.15em] text-emerald-700">Finance nette</div>
              <div className="mt-2 text-2xl font-black text-emerald-900">{money(net)}</div>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.15em] text-sky-700">Élèves actifs</div>
              <div className="mt-2 text-2xl font-black text-sky-900">{totalStudentStats.total}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">Notifications</div>
              <div className="mt-2 text-xl font-black text-slate-900">Finance & bilans</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
