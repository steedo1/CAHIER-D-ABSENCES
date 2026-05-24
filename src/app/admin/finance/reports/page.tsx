// src/app/admin/finance/reports/page.tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  CircleDollarSign,
  Layers3,
  Percent,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";
import { getAdminStudentsServer } from "@/lib/admin-students-server";
import {
  AcademicYearSelector,
  getFinanceAcademicYearContext,
} from "../_shared/academic-year";
import FinanceReportsExports, {
  type FinanceReportExportPayload,
} from "./FinanceReportsExports";

export const dynamic = "force-dynamic";

type FeeCategoryRow = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
};

type FeeScheduleRow = {
  id: string;
  label: string;
  amount: number;
  academic_year: string | null;
  class_id: string | null;
  fee_category_id: string;
  due_date: string | null;
  allow_partial: boolean;
  is_active: boolean;
};

type ExpenseCategoryRow = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
};

type ExpenseRow = {
  id: string;
  category_id: string | null;
  expense_status: "posted" | "cancelled";
  expense_date: string;
  label: string;
  beneficiary: string | null;
  amount: number;
};

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

type ChargeBalanceRow = {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  academic_year?: string | null;
  student_id: string;
  class_id: string | null;
  fee_schedule_id: string | null;
  fee_category_id: string;
  label: string;
  base_amount: number | string;
  net_amount: number | string;
  paid_amount: number | string;
  balance_due: number | string;
  due_date: string | null;
  charge_date: string;
  computed_status: "pending" | "partial" | "paid" | "overdue" | "cancelled";
  created_at: string;
  updated_at: string;
};

type ReceiptRow = {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  academic_year: string | null;
  student_id: string;
  receipt_no: string;
  receipt_status: "posted" | "cancelled";
  payment_date: string;
  payer_name: string | null;
  reference_no: string | null;
  total_amount: number | string;
  notes: string | null;
  created_at: string;
};

type InstitutionRow = {
  id: string;
  name: string | null;
};

async function getCurrentInstitutionIdOrThrow() {
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

  return profile.institution_id as string;
}

function formatMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function formatFullMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F CFA`;
}

function formatPercent(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  })} %`;
}

function toNumber(value: number | string | null | undefined) {
  return Number(value || 0);
}

function ratioPercent(value: number, total: number) {
  if (!total || total <= 0) return 0;
  return (value / total) * 100;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function monthKey(dateValue: string) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "Sans date";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  if (key === "Sans date") return key;
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
  });
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return date.toLocaleDateString("fr-FR");
}

async function fetchAllChargeBalancesForReports({
  institutionId,
  classIds,
}: {
  institutionId: string;
  classIds: string[];
}): Promise<ChargeBalanceRow[]> {
  const uniqueClassIds = Array.from(new Set(classIds.filter(Boolean)));
  if (uniqueClassIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const pageSize = 1000;
  const rows: ChargeBalanceRow[] = [];

  for (const ids of chunkArray(uniqueClassIds, 50)) {
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data, error } = await admin
        .schema("finance")
        .from("v_charge_balances")
        .select(
          "id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at",
        )
        .eq("school_id", institutionId)
        .in("class_id", ids)
        .neq("computed_status", "cancelled")
        .order("due_date", { ascending: true, nullsFirst: false })
        .range(from, to);

      if (error) {
        throw new Error(`Lecture des balances financières impossible : ${error.message}`);
      }

      const pageRows = (data ?? []) as ChargeBalanceRow[];
      rows.push(...pageRows);

      if (pageRows.length < pageSize) break;
    }
  }

  return rows;
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "emerald",
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  hint: string;
  tone?: "emerald" | "sky" | "amber" | "rose" | "slate";
}) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-700",
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    slate: "bg-slate-100 text-slate-700",
  }[tone];

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
            {label}
          </div>
          <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>
        <div className={`grid h-11 w-11 place-items-center rounded-2xl ${toneClass}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "emerald" | "sky" | "amber" | "rose" | "slate";
}) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    sky: "bg-sky-50 text-sky-800 ring-sky-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    rose: "bg-rose-50 text-rose-800 ring-rose-200",
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
  }[tone];

  return (
    <div className={`rounded-2xl px-3 py-2 text-sm ring-1 ${toneClass}`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">
        {label}
      </div>
      <div className="mt-1 font-black">{value}</div>
    </div>
  );
}

function ProgressLine({ rate }: { rate: number }) {
  const safeRate = Math.max(0, Math.min(100, Number(rate || 0)));
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
      <div
        className="h-full rounded-full bg-emerald-600"
        style={{ width: `${safeRate}%` }}
      />
    </div>
  );
}

export default async function FinanceReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ academic_year?: string }>;
}) {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const params = searchParams ? await searchParams : undefined;
  const requestedAcademicYear = String(params?.academic_year || "").trim();

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const supabase = await getSupabaseServerClient();
  const academicYearCtx = await getFinanceAcademicYearContext(
    institutionId,
    requestedAcademicYear,
  );
  const {
    academicYears,
    selectedAcademicYearCode,
    selectedAcademicYearStart,
    selectedAcademicYearEnd,
  } = academicYearCtx;

  const [
    { data: institution, error: institutionErr },
    { data: feeCategories, error: feeCatErr },
    { data: feeSchedules, error: feeSchErr },
    { data: expenseCategories, error: expCatErr },
    { data: expenses, error: expErr },
    { data: classes, error: clsErr },
    { data: receipts, error: receiptErr },
    adminStudents,
  ] = await Promise.all([
    supabase
      .from("institutions")
      .select("id,name")
      .eq("id", institutionId)
      .maybeSingle(),

    supabase
      .schema("finance")
      .from("fee_categories")
      .select("id,name,code,is_active")
      .eq("school_id", institutionId)
      .order("name", { ascending: true }),

    (() => {
      let query = supabase
        .schema("finance")
        .from("fee_schedules")
        .select(
          "id,label,amount,academic_year,class_id,fee_category_id,due_date,allow_partial,is_active",
        )
        .eq("school_id", institutionId);

      if (selectedAcademicYearCode) {
        query = query.eq("academic_year", selectedAcademicYearCode);
      }

      return query.order("created_at", { ascending: false });
    })(),

    supabase
      .schema("finance")
      .from("expense_categories")
      .select("id,name,code,is_active")
      .eq("school_id", institutionId)
      .order("name", { ascending: true }),

    (() => {
      let query = supabase
        .schema("finance")
        .from("expenses")
        .select(
          "id,category_id,expense_status,expense_date,label,beneficiary,amount",
        )
        .eq("school_id", institutionId);

      if (selectedAcademicYearStart) {
        query = query.gte("expense_date", selectedAcademicYearStart);
      }
      if (selectedAcademicYearEnd) {
        query = query.lte("expense_date", selectedAcademicYearEnd);
      }

      return query
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });
    })(),

    (() => {
      let query = supabase
        .from("classes")
        .select("id,label,level,academic_year")
        .eq("institution_id", institutionId);

      if (selectedAcademicYearCode) {
        query = query.eq("academic_year", selectedAcademicYearCode);
      }

      return query.order("label", { ascending: true });
    })(),

    (() => {
      let query = supabase
        .schema("finance")
        .from("receipts")
        .select(
          "id,school_id,academic_year_id,academic_year,student_id,receipt_no,receipt_status,payment_date,payer_name,reference_no,total_amount,notes,created_at",
        )
        .eq("school_id", institutionId);

      if (selectedAcademicYearCode) {
        query = query.eq("academic_year", selectedAcademicYearCode);
      } else {
        if (selectedAcademicYearStart) {
          query = query.gte("payment_date", selectedAcademicYearStart);
        }
        if (selectedAcademicYearEnd) {
          query = query.lte("payment_date", selectedAcademicYearEnd);
        }
      }

      return query
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false });
    })(),

    getAdminStudentsServer(),
  ]);

  if (institutionErr) throw new Error(institutionErr.message);
  if (feeCatErr) throw new Error(feeCatErr.message);
  if (feeSchErr) throw new Error(feeSchErr.message);
  if (expCatErr) throw new Error(expCatErr.message);
  if (expErr) throw new Error(expErr.message);
  if (clsErr) throw new Error(clsErr.message);
  if (receiptErr) throw new Error(receiptErr.message);

  const institutionRow = (institution ?? null) as InstitutionRow | null;
  const feeCategoryRows = (feeCategories ?? []) as FeeCategoryRow[];
  const feeScheduleRows = (feeSchedules ?? []) as FeeScheduleRow[];
  const expenseCategoryRows = (expenseCategories ?? []) as ExpenseCategoryRow[];
  const expenseRows = (expenses ?? []) as ExpenseRow[];
  const classRows = (classes ?? []) as ClassRow[];
  const receiptRows = (receipts ?? []) as ReceiptRow[];

  const classIds = classRows.map((row) => row.id);
  const classIdSet = new Set(classIds);
  const studentRows = adminStudents.filter((student) =>
    student.class_id ? classIdSet.has(student.class_id) : false,
  );

  const balanceRows = await fetchAllChargeBalancesForReports({
    institutionId,
    classIds,
  });

  const classMap = new Map(classRows.map((c) => [c.id, c]));
  const expenseCategoryMap = new Map(expenseCategoryRows.map((c) => [c.id, c]));
  const studentsByClass = new Map<string, number>();

  for (const student of studentRows) {
    if (!student.class_id) continue;
    studentsByClass.set(
      student.class_id,
      (studentsByClass.get(student.class_id) ?? 0) + 1,
    );
  }

  const activeFeeCategories = feeCategoryRows.filter((r) => r.is_active).length;
  const activeSchedules = feeScheduleRows.filter((r) => r.is_active);
  const postedExpenses = expenseRows.filter(
    (r) => r.expense_status === "posted",
  );
  const postedReceipts = receiptRows.filter(
    (r) => r.receipt_status === "posted",
  );

  const totalScheduledAmount = activeSchedules.reduce(
    (sum, row) => sum + toNumber(row.amount),
    0,
  );

  const totalExpectedAmount = balanceRows.reduce(
    (sum, row) => sum + toNumber(row.net_amount),
    0,
  );
  const totalPaidFromBalances = balanceRows.reduce(
    (sum, row) => sum + toNumber(row.paid_amount),
    0,
  );
  const totalBalanceDue = balanceRows.reduce(
    (sum, row) => sum + Math.max(0, toNumber(row.balance_due)),
    0,
  );
  const totalReceiptsAmount = postedReceipts.reduce(
    (sum, row) => sum + toNumber(row.total_amount),
    0,
  );
  const totalExpensesAmount = postedExpenses.reduce(
    (sum, row) => sum + toNumber(row.amount),
    0,
  );
  const netBalance = totalReceiptsAmount - totalExpensesAmount;
  const recoveryRate = ratioPercent(totalPaidFromBalances, totalExpectedAmount);
  const expenseRatio = ratioPercent(totalExpensesAmount, totalReceiptsAmount);

  const balancesByStudent = new Map<string, ChargeBalanceRow[]>();
  for (const row of balanceRows) {
    if (!balancesByStudent.has(row.student_id)) {
      balancesByStudent.set(row.student_id, []);
    }
    balancesByStudent.get(row.student_id)!.push(row);
  }

  const studentsWithDebt = studentRows.filter((student) => {
    const items = balancesByStudent.get(student.id) ?? [];
    return items.some((item) => toNumber(item.balance_due) > 0);
  }).length;

  const studentsPaidUp = studentRows.filter((student) => {
    const items = balancesByStudent.get(student.id) ?? [];
    const expected = items.reduce((sum, row) => sum + toNumber(row.net_amount), 0);
    const due = items.reduce((sum, row) => sum + toNumber(row.balance_due), 0);
    return expected > 0 && due <= 0;
  }).length;

  const feePerformanceByCategory = feeCategoryRows
    .map((cat) => {
      const items = balanceRows.filter((row) => row.fee_category_id === cat.id);
      const expected = items.reduce((sum, row) => sum + toNumber(row.net_amount), 0);
      const paid = items.reduce((sum, row) => sum + toNumber(row.paid_amount), 0);
      const due = items.reduce(
        (sum, row) => sum + Math.max(0, toNumber(row.balance_due)),
        0,
      );
      return {
        id: cat.id,
        name: cat.name,
        count: items.length,
        expected,
        paid,
        due,
        rate: ratioPercent(paid, expected),
      };
    })
    .filter((x) => x.count > 0 || x.expected > 0)
    .sort((a, b) => b.due - a.due || b.expected - a.expected);

  const schedulesByCategory = feeCategoryRows
    .map((cat) => {
      const items = activeSchedules.filter((s) => s.fee_category_id === cat.id);
      const total = items.reduce((sum, s) => sum + toNumber(s.amount), 0);
      return {
        id: cat.id,
        name: cat.name,
        count: items.length,
        total,
      };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.total - a.total);

  const expensesByCategory = expenseCategoryRows
    .map((cat) => {
      const items = postedExpenses.filter((e) => e.category_id === cat.id);
      const total = items.reduce((sum, e) => sum + toNumber(e.amount), 0);
      return {
        id: cat.id,
        name: cat.name,
        count: items.length,
        total,
      };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.total - a.total);

  const classSummary = classRows
    .map((cls) => {
      const items = balanceRows.filter((row) => row.class_id === cls.id);
      const expected = items.reduce((sum, row) => sum + toNumber(row.net_amount), 0);
      const paid = items.reduce((sum, row) => sum + toNumber(row.paid_amount), 0);
      const due = items.reduce(
        (sum, row) => sum + Math.max(0, toNumber(row.balance_due)),
        0,
      );
      const students = studentsByClass.get(cls.id) ?? 0;
      return {
        classId: cls.id,
        classLabel: cls.label || "Classe sans nom",
        level: cls.level || "—",
        academicYear: cls.academic_year || selectedAcademicYearCode || "—",
        students,
        expected,
        paid,
        due,
        rate: ratioPercent(paid, expected),
      };
    })
    .filter((row) => row.students > 0 || row.expected > 0)
    .sort((a, b) => b.due - a.due || b.expected - a.expected);

  const monthlyMap = new Map<
    string,
    { month: string; receipts: number; expenses: number; balance: number }
  >();

  for (const receipt of postedReceipts) {
    const key = monthKey(receipt.payment_date);
    if (!monthlyMap.has(key)) {
      monthlyMap.set(key, { month: monthLabel(key), receipts: 0, expenses: 0, balance: 0 });
    }
    const row = monthlyMap.get(key)!;
    row.receipts += toNumber(receipt.total_amount);
    row.balance = row.receipts - row.expenses;
  }

  for (const expense of postedExpenses) {
    const key = monthKey(expense.expense_date);
    if (!monthlyMap.has(key)) {
      monthlyMap.set(key, { month: monthLabel(key), receipts: 0, expenses: 0, balance: 0 });
    }
    const row = monthlyMap.get(key)!;
    row.expenses += toNumber(expense.amount);
    row.balance = row.receipts - row.expenses;
  }

  const monthlySummary = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value);

  const largestCategoryDue = feePerformanceByCategory[0];
  const bestClassRecovery = [...classSummary]
    .filter((row) => row.expected > 0)
    .sort((a, b) => b.rate - a.rate)[0];
  const highestClassDebt = classSummary[0];

  const exportPayload: FinanceReportExportPayload = {
    title: "Rapport financier enrichi",
    institutionName: institutionRow?.name || "Établissement",
    academicYear: selectedAcademicYearCode || "Année courante",
    generatedAt: new Date().toISOString(),
    summary: [
      {
        label: "Élèves suivis",
        value: String(studentRows.length),
        hint: `${classRows.length} classe${classRows.length > 1 ? "s" : ""}`,
      },
      {
        label: "Montant attendu",
        value: formatFullMoney(totalExpectedAmount),
        hint: `${balanceRows.length} ligne${balanceRows.length > 1 ? "s" : ""} de frais`,
      },
      {
        label: "Total encaissé",
        value: formatFullMoney(totalReceiptsAmount),
        hint: `${postedReceipts.length} reçu${postedReceipts.length > 1 ? "s" : ""} validé${postedReceipts.length > 1 ? "s" : ""}`,
      },
      {
        label: "Reste à recouvrer",
        value: formatFullMoney(totalBalanceDue),
        hint: `${studentsWithDebt} élève${studentsWithDebt > 1 ? "s" : ""} avec solde`,
      },
      {
        label: "Taux de recouvrement",
        value: formatPercent(recoveryRate),
        hint: `${studentsPaidUp} élève${studentsPaidUp > 1 ? "s" : ""} soldé${studentsPaidUp > 1 ? "s" : ""}`,
      },
      {
        label: "Dépenses",
        value: formatFullMoney(totalExpensesAmount),
        hint: `${postedExpenses.length} dépense${postedExpenses.length > 1 ? "s" : ""} validée${postedExpenses.length > 1 ? "s" : ""}`,
      },
      {
        label: "Solde net",
        value: formatFullMoney(netBalance),
        hint: "Encaissements moins dépenses",
      },
      {
        label: "Ratio dépenses",
        value: formatPercent(expenseRatio),
        hint: "Dépenses / encaissements",
      },
    ],
    categories: feePerformanceByCategory.map((row) => ({
      name: row.name,
      count: row.count,
      expected: row.expected,
      paid: row.paid,
      due: row.due,
      rate: row.rate,
    })),
    expenseCategories: expensesByCategory.map((row) => ({
      name: row.name,
      count: row.count,
      total: row.total,
    })),
    classes: classSummary.map((row) => ({
      classLabel: row.classLabel,
      level: row.level,
      academicYear: row.academicYear,
      students: row.students,
      expected: row.expected,
      paid: row.paid,
      due: row.due,
      rate: row.rate,
    })),
    months: monthlySummary,
    receipts: postedReceipts.slice(0, 30).map((row) => ({
      date: formatDate(row.payment_date),
      label: `${row.receipt_no}${row.payer_name ? ` — ${row.payer_name}` : ""}`,
      category: row.reference_no || "Encaissement validé",
      amount: toNumber(row.total_amount),
    })),
    expenses: postedExpenses.slice(0, 30).map((row) => {
      const cat = row.category_id ? expenseCategoryMap.get(row.category_id) : null;
      return {
        date: formatDate(row.expense_date),
        label: row.label,
        category: `${cat?.name || "Sans catégorie"}${row.beneficiary ? ` — ${row.beneficiary}` : ""}`,
        amount: toNumber(row.amount),
      };
    }),
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <BarChart3 className="h-3.5 w-3.5" />
              Gestion financière premium
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Rapports financiers
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Analyse enrichie des frais attendus, des encaissements, des
              restes à recouvrer, des dépenses et du solde net de
              l’établissement.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
              Statut
            </div>
            <div className="mt-2 text-lg font-black text-white">
              Premium actif
            </div>
            <div className="mt-1 text-sm text-slate-200">
              Expiration : {access.expiresAt || "—"}
            </div>
          </div>
        </div>
      </section>

      <AcademicYearSelector
        academicYears={academicYears}
        selectedAcademicYearCode={selectedAcademicYearCode}
        currentPath="/admin/finance/reports"
      />

      <FinanceReportsExports payload={exportPayload} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Élèves suivis"
          value={studentRows.length}
          hint={`${classRows.length} classe${classRows.length > 1 ? "s" : ""} dans l’année`}
          tone="sky"
        />
        <StatCard
          icon={<CircleDollarSign className="h-5 w-5" />}
          label="Montant attendu"
          value={formatMoney(totalExpectedAmount)}
          hint={`${balanceRows.length} ligne${balanceRows.length > 1 ? "s" : ""} de frais`}
          tone="emerald"
        />
        <StatCard
          icon={<Receipt className="h-5 w-5" />}
          label="Total encaissé"
          value={formatMoney(totalReceiptsAmount)}
          hint={`${postedReceipts.length} reçu${postedReceipts.length > 1 ? "s" : ""} validé${postedReceipts.length > 1 ? "s" : ""}`}
          tone="emerald"
        />
        <StatCard
          icon={<ArrowDownRight className="h-5 w-5" />}
          label="Reste à recouvrer"
          value={formatMoney(totalBalanceDue)}
          hint={`${studentsWithDebt} élève${studentsWithDebt > 1 ? "s" : ""} avec solde`}
          tone="amber"
        />
        <StatCard
          icon={<Percent className="h-5 w-5" />}
          label="Taux recouvrement"
          value={formatPercent(recoveryRate)}
          hint={`${studentsPaidUp} élève${studentsPaidUp > 1 ? "s" : ""} soldé${studentsPaidUp > 1 ? "s" : ""}`}
          tone="sky"
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          label="Dépenses"
          value={formatMoney(totalExpensesAmount)}
          hint={`${postedExpenses.length} dépense${postedExpenses.length > 1 ? "s" : ""} validée${postedExpenses.length > 1 ? "s" : ""}`}
          tone="rose"
        />
        <StatCard
          icon={<ArrowUpRight className="h-5 w-5" />}
          label="Solde net"
          value={formatMoney(netBalance)}
          hint="Encaissements moins dépenses"
          tone={netBalance >= 0 ? "emerald" : "rose"}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Ratio dépenses"
          value={formatPercent(expenseRatio)}
          hint="Dépenses / encaissements"
          tone="slate"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
            Catégorie la plus sensible
          </div>
          <div className="mt-2 text-xl font-black text-slate-900">
            {largestCategoryDue?.name || "—"}
          </div>
          <div className="mt-2 text-sm text-slate-600">
            Reste à recouvrer : {formatMoney(largestCategoryDue?.due || 0)}
          </div>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
            Meilleur recouvrement
          </div>
          <div className="mt-2 text-xl font-black text-slate-900">
            {bestClassRecovery?.classLabel || "—"}
          </div>
          <div className="mt-2 text-sm text-slate-600">
            Taux : {formatPercent(bestClassRecovery?.rate || 0)}
          </div>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
            Classe à suivre
          </div>
          <div className="mt-2 text-xl font-black text-slate-900">
            {highestClassDebt?.classLabel || "—"}
          </div>
          <div className="mt-2 text-sm text-slate-600">
            Reste : {formatMoney(highestClassDebt?.due || 0)}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Layers3 className="h-4 w-4 text-emerald-600" />
            Recouvrement par catégorie de frais
          </div>

          {feePerformanceByCategory.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucune balance financière disponible pour le moment.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {feePerformanceByCategory.map((row) => (
                <article
                  key={row.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">
                        {row.name}
                      </h2>
                      <div className="mt-1 text-sm text-slate-600">
                        {row.count} écriture{row.count > 1 ? "s" : ""} • Taux {formatPercent(row.rate)}
                      </div>
                    </div>
                    <div className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-800 ring-1 ring-amber-200">
                      Reste {formatMoney(row.due)}
                    </div>
                  </div>
                  <ProgressLine rate={row.rate} />
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <MiniMetric label="Attendu" value={formatMoney(row.expected)} tone="slate" />
                    <MiniMetric label="Encaissé" value={formatMoney(row.paid)} tone="emerald" />
                    <MiniMetric label="Reste" value={formatMoney(row.due)} tone="amber" />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <CalendarClock className="h-4 w-4 text-emerald-600" />
            Flux mensuels
          </div>

          {monthlySummary.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucun flux financier enregistré sur la période.
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
              <div className="grid grid-cols-4 bg-slate-100 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
                <div>Mois</div>
                <div className="text-right">Encaissements</div>
                <div className="text-right">Dépenses</div>
                <div className="text-right">Solde</div>
              </div>
              <div className="divide-y divide-slate-200">
                {monthlySummary.map((row) => (
                  <div
                    key={row.month}
                    className="grid grid-cols-4 items-center px-4 py-3 text-sm"
                  >
                    <div className="font-bold text-slate-800">{row.month}</div>
                    <div className="text-right font-bold text-emerald-700">
                      {formatMoney(row.receipts)}
                    </div>
                    <div className="text-right font-bold text-rose-700">
                      {formatMoney(row.expenses)}
                    </div>
                    <div
                      className={`text-right font-black ${row.balance >= 0 ? "text-slate-900" : "text-rose-700"}`}
                    >
                      {formatMoney(row.balance)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            Recouvrement par classe
          </div>

          {classSummary.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucune synthèse disponible.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {classSummary.map((row) => (
                <article
                  key={row.classId}
                  className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">
                        {row.classLabel}
                      </h2>
                      <div className="mt-1 text-sm text-slate-600">
                        {row.level} • {row.academicYear} • {row.students} élève{row.students > 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-bold text-sky-700 ring-1 ring-sky-200">
                      Taux {formatPercent(row.rate)}
                    </div>
                  </div>
                  <ProgressLine rate={row.rate} />
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <MiniMetric label="Attendu" value={formatMoney(row.expected)} tone="slate" />
                    <MiniMetric label="Encaissé" value={formatMoney(row.paid)} tone="emerald" />
                    <MiniMetric label="Reste" value={formatMoney(row.due)} tone="amber" />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Wallet className="h-4 w-4 text-rose-600" />
            Dépenses par catégorie
          </div>

          {expensesByCategory.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucune dépense enregistrée pour le moment.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {expensesByCategory.map((row) => (
                <article
                  key={row.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">
                        {row.name}
                      </h2>
                      <div className="mt-1 text-sm text-slate-600">
                        {row.count} dépense{row.count > 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className="rounded-full bg-rose-50 px-3 py-1.5 text-sm font-bold text-rose-700 ring-1 ring-rose-200">
                      {formatMoney(row.total)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            Derniers encaissements validés
          </div>

          {postedReceipts.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucun encaissement récent.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {postedReceipts.slice(0, 8).map((row) => (
                <article
                  key={row.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">
                        {row.receipt_no}
                      </h2>
                      <div className="mt-1 text-sm text-slate-600">
                        {formatDate(row.payment_date)}
                        {row.payer_name ? ` • ${row.payer_name}` : ""}
                        {row.reference_no ? ` • Réf. ${row.reference_no}` : ""}
                      </div>
                    </div>
                    <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">
                      {formatMoney(row.total_amount)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            Dernières dépenses
          </div>

          {postedExpenses.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucune dépense récente.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {postedExpenses.slice(0, 8).map((row) => {
                const cat = row.category_id
                  ? expenseCategoryMap.get(row.category_id)
                  : null;
                return (
                  <article
                    key={row.id}
                    className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-lg font-black text-slate-900">
                          {row.label}
                        </h2>
                        <div className="mt-1 text-sm text-slate-600">
                          {formatDate(row.expense_date)} • {cat?.name || "Sans catégorie"}
                          {row.beneficiary ? ` • ${row.beneficiary}` : ""}
                        </div>
                      </div>
                      <div className="rounded-full bg-rose-50 px-3 py-1.5 text-sm font-bold text-rose-700 ring-1 ring-rose-200">
                        {formatMoney(row.amount)}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          <Layers3 className="h-4 w-4 text-emerald-600" />
          Barèmes configurés par catégorie
        </div>

        {schedulesByCategory.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
            Aucun barème actif pour le moment.
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {schedulesByCategory.map((row) => (
              <article
                key={row.id}
                className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
              >
                <h2 className="text-lg font-black text-slate-900">{row.name}</h2>
                <div className="mt-1 text-sm text-slate-600">
                  {row.count} barème{row.count > 1 ? "s" : ""}
                </div>
                <div className="mt-3 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">
                  {formatMoney(row.total)}
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Barèmes actifs : <strong>{activeSchedules.length}</strong> • Catégories de frais actives : <strong>{activeFeeCategories}</strong> • Montant barémé : <strong>{formatMoney(totalScheduledAmount)}</strong>
        </div>
      </section>
    </div>
  );
}
