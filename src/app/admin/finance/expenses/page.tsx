// src/app/admin/finance/expenses/page.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  CalendarClock,
  CircleOff,
  FolderPlus,
  Layers,
  Receipt,
  Search,
  Wallet,
  XCircle,
} from "lucide-react";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  getFinanceAccessForCurrentUser,
  getFinanceInstitutionIdForCurrentUser,
} from "@/lib/finance-access";
import { queueFounderFinanceExpenseNotification } from "@/lib/push/founder";
import {
  AcademicYearSelector,
  getFinanceAcademicYearContext,
} from "../_shared/academic-year";

export const dynamic = "force-dynamic";

type ExpenseCategoryRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type ExpenseBudgetRow = {
  id: string;
  academic_year_id: string | null;
  academic_year: string | null;
  code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string | null;
};

type ExpenseBudgetLineRow = {
  id: string;
  budget_id: string | null;
  category_id: string | null;
  academic_year_id: string | null;
  academic_year: string | null;
  account_no: string | null;
  label: string;
  planned_amount: number | string;
  is_active: boolean;
  notes: string | null;
  created_at: string | null;
};

type ExpenseRow = {
  id: string;
  category_id: string | null;
  budget_id: string | null;
  budget_line_id: string | null;
  expense_status: "posted" | "cancelled";
  expense_date: string;
  label: string;
  beneficiary: string | null;
  amount: number | string;
  payment_method: string | null;
  reference_no: string | null;
  notes: string | null;
  created_at: string | null;
};

function slugifyCode(input: string) {
  return String(input || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function toNumber(value: number | string | null | undefined) {
  const raw = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/,/g, ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number | string | null | undefined) {
  return `${toNumber(value).toLocaleString("fr-FR")} F`;
}

function formatPercent(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  })} %`;
}

function normalize(input: string) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatExpenseDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

async function getCurrentInstitutionIdOrThrow() {
  return getFinanceInstitutionIdForCurrentUser();
}

function cleanText(value: FormDataEntryValue | null) {
  return String(value || "").trim();
}

function cleanNullableText(value: FormDataEntryValue | null) {
  const text = cleanText(value);
  return text || null;
}

async function createExpenseCategoryAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();

  const name = cleanText(formData.get("name"));
  const codeInput = cleanText(formData.get("code"));

  if (!name) {
    throw new Error("Le nom de la catégorie est obligatoire.");
  }

  const code = slugifyCode(codeInput || name);
  if (!code) {
    throw new Error("Le code de la catégorie est invalide.");
  }

  const nowIso = new Date().toISOString();
  const admin = getSupabaseServiceClient();

  const { error } = await admin
    .schema("finance")
    .from("expense_categories")
    .insert({
      school_id: institutionId,
      code,
      name,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    } as any);

  if (error) {
    if (error.message?.toLowerCase().includes("duplicate")) {
      throw new Error(
        "Une catégorie portant ce code existe déjà pour cet établissement.",
      );
    }
    throw new Error(error.message);
  }

  revalidatePath("/admin/finance/expenses");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance");
}

async function toggleExpenseCategoryAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();

  const id = cleanText(formData.get("id"));
  const nextActive = formData.get("next_active") === "true";

  if (!id) {
    throw new Error("Catégorie introuvable.");
  }

  const admin = getSupabaseServiceClient();

  const { error } = await admin
    .schema("finance")
    .from("expense_categories")
    .update({
      is_active: nextActive,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", id)
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/finance/expenses");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance");
}

async function ensureExpenseBudget({
  admin,
  institutionId,
  academicYearId,
  academicYear,
}: {
  admin: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  academicYearId: string | null;
  academicYear: string | null;
}) {
  const code = slugifyCode(`budget_general_${academicYear || "global"}`) || "budget_general";

  let query = admin
    .schema("finance")
    .from("expense_budgets")
    .select("id")
    .eq("school_id", institutionId)
    .eq("code", code)
    .limit(1);

  if (academicYear) {
    query = query.eq("academic_year", academicYear);
  } else {
    query = query.is("academic_year", null);
  }

  const { data: existing, error: existingErr } = await query.maybeSingle();
  if (existingErr) throw new Error(existingErr.message);
  if (existing?.id) return existing.id as string;

  const nowIso = new Date().toISOString();
  const { data: created, error: createErr } = await admin
    .schema("finance")
    .from("expense_budgets")
    .insert({
      school_id: institutionId,
      academic_year_id: academicYearId,
      academic_year: academicYear,
      code,
      name: "Budget général",
      description: "Budget créé automatiquement pour rattacher les postes budgétaires.",
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    } as any)
    .select("id")
    .single();

  if (createErr) {
    const { data: fallback, error: fallbackErr } = await admin
      .schema("finance")
      .from("expense_budgets")
      .select("id")
      .eq("school_id", institutionId)
      .eq("code", code)
      .maybeSingle();

    if (fallbackErr) throw new Error(fallbackErr.message);
    if (fallback?.id) return fallback.id as string;
    throw new Error(createErr.message);
  }

  return created.id as string;
}

async function createExpenseBudgetAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const admin = getSupabaseServiceClient();

  const academicYearId = cleanNullableText(formData.get("academic_year_id"));
  const academicYear = cleanNullableText(formData.get("academic_year"));
  const name = cleanText(formData.get("name"));
  const codeInput = cleanText(formData.get("code"));
  const description = cleanNullableText(formData.get("description"));

  if (!academicYear) {
    throw new Error("L’année scolaire est obligatoire pour créer un budget.");
  }

  if (!name) {
    throw new Error("Le nom du budget est obligatoire.");
  }

  const code = slugifyCode(codeInput || name);
  if (!code) {
    throw new Error("Le code du budget est invalide.");
  }

  const nowIso = new Date().toISOString();

  const { error } = await admin
    .schema("finance")
    .from("expense_budgets")
    .insert({
      school_id: institutionId,
      academic_year_id: academicYearId,
      academic_year: academicYear,
      code,
      name,
      description,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    } as any);

  if (error) {
    if (error.message?.toLowerCase().includes("duplicate")) {
      throw new Error("Un budget portant ce code existe déjà pour cette année.");
    }
    throw new Error(error.message);
  }

  revalidatePath("/admin/finance/expenses");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance");
}

async function toggleExpenseBudgetAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();

  const id = cleanText(formData.get("id"));
  const nextActive = formData.get("next_active") === "true";

  if (!id) {
    throw new Error("Budget introuvable.");
  }

  const admin = getSupabaseServiceClient();

  const { error } = await admin
    .schema("finance")
    .from("expense_budgets")
    .update({
      is_active: nextActive,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", id)
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/finance/expenses");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance");
}

async function createExpenseBudgetLineAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const admin = getSupabaseServiceClient();

  let budgetId = cleanNullableText(formData.get("budget_id"));
  const categoryId = cleanNullableText(formData.get("category_id"));
  const academicYearId = cleanNullableText(formData.get("academic_year_id"));
  const academicYear = cleanNullableText(formData.get("academic_year"));
  const accountNo = cleanNullableText(formData.get("account_no"));
  const label = cleanText(formData.get("label"));
  const plannedAmount = toNumber(cleanText(formData.get("planned_amount")));
  const notes = cleanNullableText(formData.get("notes"));

  if (!academicYear) {
    throw new Error("L’année scolaire est obligatoire pour créer un budget.");
  }
  if (!label) {
    throw new Error("Le libellé du poste budgétaire est obligatoire.");
  }
  if (!Number.isFinite(plannedAmount) || plannedAmount <= 0) {
    throw new Error("Le montant budgété doit être supérieur à 0.");
  }

  if (budgetId) {
    const { data: budget, error: budgetErr } = await admin
      .schema("finance")
      .from("expense_budgets")
      .select("id,is_active")
      .eq("id", budgetId)
      .eq("school_id", institutionId)
      .maybeSingle();

    if (budgetErr) throw new Error(budgetErr.message);
    if (!budget) throw new Error("Budget introuvable.");
    if (!budget.is_active) throw new Error("Le budget choisi est inactif.");
  } else {
    budgetId = await ensureExpenseBudget({
      admin,
      institutionId,
      academicYearId,
      academicYear,
    });
  }

  if (categoryId) {
    const { data: category, error: catErr } = await admin
      .schema("finance")
      .from("expense_categories")
      .select("id,is_active")
      .eq("id", categoryId)
      .eq("school_id", institutionId)
      .maybeSingle();

    if (catErr) throw new Error(catErr.message);
    if (!category) throw new Error("Catégorie introuvable.");
    if (!category.is_active) throw new Error("La catégorie choisie est inactive.");
  }

  const nowIso = new Date().toISOString();

  const { error } = await admin
    .schema("finance")
    .from("expense_budget_lines")
    .insert({
      school_id: institutionId,
      academic_year_id: academicYearId,
      academic_year: academicYear,
      budget_id: budgetId,
      category_id: categoryId,
      account_no: accountNo,
      label,
      planned_amount: plannedAmount,
      notes,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    } as any);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/finance/expenses");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance");
}

async function toggleExpenseBudgetLineAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const id = cleanText(formData.get("id"));
  const nextActive = formData.get("next_active") === "true";

  if (!id) {
    throw new Error("Poste budgétaire introuvable.");
  }

  const admin = getSupabaseServiceClient();

  const { error } = await admin
    .schema("finance")
    .from("expense_budget_lines")
    .update({
      is_active: nextActive,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", id)
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/finance/expenses");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance");
}

async function updateExpenseBudgetLineAmountAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const id = cleanText(formData.get("id"));
  const plannedAmount = toNumber(cleanText(formData.get("planned_amount")));

  if (!id) {
    throw new Error("Poste budgétaire introuvable.");
  }

  if (!Number.isFinite(plannedAmount) || plannedAmount < 0) {
    throw new Error("Le montant prévu doit être positif ou égal à 0.");
  }

  const admin = getSupabaseServiceClient();

  const { error } = await admin
    .schema("finance")
    .from("expense_budget_lines")
    .update({
      planned_amount: plannedAmount,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", id)
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/finance/expenses");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance");
}

async function createExpenseAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const admin = getSupabaseServiceClient();

  let categoryId = cleanNullableText(formData.get("category_id"));
  let budgetId = cleanNullableText(formData.get("budget_id"));
  const budgetLineId = cleanNullableText(formData.get("budget_line_id"));
  const academicYearId = cleanNullableText(formData.get("academic_year_id"));
  const academicYear = cleanNullableText(formData.get("academic_year"));
  const label = cleanText(formData.get("label"));
  const amount = toNumber(cleanText(formData.get("amount")));
  const expenseDate = cleanText(formData.get("expense_date"));
  const beneficiary = cleanNullableText(formData.get("beneficiary"));
  const paymentMethod = cleanNullableText(formData.get("payment_method"));
  const referenceNo = cleanNullableText(formData.get("reference_no"));
  const notes = cleanNullableText(formData.get("notes"));

  if (!label) {
    throw new Error("Le libellé de la dépense est obligatoire.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Le montant doit être supérieur à 0.");
  }

  if (budgetLineId) {
    const { data: budgetLine, error: budgetErr } = await admin
      .schema("finance")
      .from("expense_budget_lines")
      .select("id,budget_id,category_id,is_active")
      .eq("id", budgetLineId)
      .eq("school_id", institutionId)
      .maybeSingle();

    if (budgetErr) throw new Error(budgetErr.message);
    if (!budgetLine) throw new Error("Poste budgétaire introuvable.");
    if (!budgetLine.is_active) {
      throw new Error("Le poste budgétaire choisi est inactif.");
    }

    if (!categoryId && budgetLine.category_id) {
      categoryId = budgetLine.category_id;
    }

    if (budgetLine.budget_id) {
      budgetId = budgetLine.budget_id;
    }
  }

  if (budgetId) {
    const { data: budget, error: budgetErr } = await admin
      .schema("finance")
      .from("expense_budgets")
      .select("id,is_active")
      .eq("id", budgetId)
      .eq("school_id", institutionId)
      .maybeSingle();

    if (budgetErr) throw new Error(budgetErr.message);
    if (!budget) throw new Error("Budget introuvable.");
    if (!budget.is_active) {
      throw new Error("Le budget choisi est inactif.");
    }
  }

  if (categoryId) {
    const { data: category, error: catErr } = await admin
      .schema("finance")
      .from("expense_categories")
      .select("id,is_active")
      .eq("id", categoryId)
      .eq("school_id", institutionId)
      .maybeSingle();

    if (catErr) throw new Error(catErr.message);
    if (!category) throw new Error("Catégorie introuvable.");
    if (!category.is_active) {
      throw new Error("La catégorie choisie est inactive.");
    }
  }

  const nowIso = new Date().toISOString();

  const { error } = await admin
    .schema("finance")
    .from("expenses")
    .insert({
      school_id: institutionId,
      category_id: categoryId,
      budget_id: budgetId,
      budget_line_id: budgetLineId,
      academic_year_id: academicYearId,
      academic_year: academicYear,
      expense_status: "posted",
      expense_date: expenseDate || new Date().toISOString().slice(0, 10),
      label,
      beneficiary,
      payment_method: paymentMethod,
      reference_no: referenceNo,
      notes,
      amount,
      created_at: nowIso,
      updated_at: nowIso,
    } as any);

  if (error) throw new Error(error.message);

  try {
    await queueFounderFinanceExpenseNotification({
      institutionId,
      amount,
      label,
      beneficiary,
    });
  } catch (e: any) {
    console.warn(
      "[finance/expenses] founder finance notification skipped",
      e?.message || e,
    );
  }

  revalidatePath("/admin/finance/expenses");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance");
}

async function updateExpenseAmountAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const id = cleanText(formData.get("id"));
  const amount = toNumber(cleanText(formData.get("amount")));

  if (!id) {
    throw new Error("Dépense introuvable.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Le montant de la dépense doit être supérieur à 0.");
  }

  const admin = getSupabaseServiceClient();

  const { error } = await admin
    .schema("finance")
    .from("expenses")
    .update({
      amount,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", id)
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/finance/expenses");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance");
}

async function cancelExpenseAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();

  const id = cleanText(formData.get("id"));
  if (!id) {
    throw new Error("Dépense introuvable.");
  }

  const admin = getSupabaseServiceClient();

  const { error } = await admin
    .schema("finance")
    .from("expenses")
    .update({
      expense_status: "cancelled",
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", id)
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/finance/expenses");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance");
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
  tone?: "emerald" | "slate" | "amber" | "rose";
}) {
  const tones: Record<
    NonNullable<typeof tone>,
    { wrap: string; iconWrap: string; value: string }
  > = {
    emerald: {
      wrap: "border-emerald-200 bg-emerald-50/60",
      iconWrap: "bg-emerald-100 text-emerald-700",
      value: "text-emerald-800",
    },
    slate: {
      wrap: "border-slate-200 bg-white",
      iconWrap: "bg-slate-100 text-slate-700",
      value: "text-slate-900",
    },
    amber: {
      wrap: "border-amber-200 bg-amber-50/70",
      iconWrap: "bg-amber-100 text-amber-700",
      value: "text-amber-800",
    },
    rose: {
      wrap: "border-rose-200 bg-rose-50/70",
      iconWrap: "bg-rose-100 text-rose-700",
      value: "text-rose-800",
    },
  };
  const t = tones[tone];

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${t.wrap}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
            {label}
          </div>
          <div className={`mt-2 text-3xl font-black ${t.value}`}>{value}</div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>
        <div className={`grid h-11 w-11 place-items-center rounded-2xl ${t.iconWrap}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function CategoryStatusPill({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
      <BadgeCheck className="h-3.5 w-3.5" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
      <CircleOff className="h-3.5 w-3.5" />
      Inactive
    </span>
  );
}

function ExpenseStatusPill({ status }: { status: "posted" | "cancelled" }) {
  return status === "posted" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
      <BadgeCheck className="h-3.5 w-3.5" />
      Validée
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
      <XCircle className="h-3.5 w-3.5" />
      Annulée
    </span>
  );
}

function BudgetStatusPill({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
      <BadgeCheck className="h-3.5 w-3.5" />
      Suivi actif
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
      <CircleOff className="h-3.5 w-3.5" />
      Désactivé
    </span>
  );
}

export default async function FinanceExpensesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    category_id?: string;
    budget_id?: string;
    academic_year?: string;
  }>;
}) {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const params = searchParams ? await searchParams : undefined;
  const q = String(params?.q || "").trim();
  const statusFilter = String(params?.status || "").trim();
  const selectedBudgetFilter = String(params?.budget_id || "").trim();
  const requestedAcademicYear = String(params?.academic_year || "").trim();

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const supabase = getSupabaseServiceClient();
  const academicYearCtx = await getFinanceAcademicYearContext(
    institutionId,
    requestedAcademicYear,
  );
  const {
    academicYears,
    selectedAcademicYearId,
    selectedAcademicYearCode,
    selectedAcademicYearStart,
    selectedAcademicYearEnd,
  } = academicYearCtx;

  const [
    { data: categories, error: catErr },
    { data: budgets, error: budgetsErr },
    { data: budgetLines, error: budgetErr },
    { data: expenses, error: expErr },
  ] = await Promise.all([
    supabase
      .schema("finance")
      .from("expense_categories")
      .select("id,code,name,is_active")
      .eq("school_id", institutionId)
      .order("name", { ascending: true }),

    (() => {
      let query = supabase
        .schema("finance")
        .from("expense_budgets")
        .select("id,academic_year_id,academic_year,code,name,description,is_active,created_at")
        .eq("school_id", institutionId);

      if (selectedAcademicYearCode) {
        query = query.eq("academic_year", selectedAcademicYearCode);
      }

      return query
        .order("is_active", { ascending: false })
        .order("name", { ascending: true });
    })(),

    (() => {
      let query = supabase
        .schema("finance")
        .from("expense_budget_lines")
        .select(
          "id,budget_id,category_id,academic_year_id,academic_year,account_no,label,planned_amount,is_active,notes,created_at",
        )
        .eq("school_id", institutionId);

      if (selectedAcademicYearCode) {
        query = query.eq("academic_year", selectedAcademicYearCode);
      }

      return query
        .order("is_active", { ascending: false })
        .order("account_no", { ascending: true })
        .order("label", { ascending: true });
    })(),

    (() => {
      let query = supabase
        .schema("finance")
        .from("expenses")
        .select(
          "id,category_id,budget_id,budget_line_id,expense_status,expense_date,label,beneficiary,amount,payment_method,reference_no,notes,created_at",
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
  ]);

  if (catErr) throw new Error(catErr.message);
  if (budgetsErr) throw new Error(budgetsErr.message);
  if (budgetErr) throw new Error(budgetErr.message);
  if (expErr) throw new Error(expErr.message);

  const categoryRows = (categories ?? []) as ExpenseCategoryRow[];
  const budgetEnvelopeRows = (budgets ?? []) as ExpenseBudgetRow[];
  const budgetRows = (budgetLines ?? []) as ExpenseBudgetLineRow[];
  const expenseRows = (expenses ?? []) as ExpenseRow[];

  const categoryMap = new Map(categoryRows.map((c) => [c.id, c]));
  const budgetEnvelopeMap = new Map(budgetEnvelopeRows.map((b) => [b.id, b]));
  const budgetMap = new Map(budgetRows.map((b) => [b.id, b]));
  const activeBudgetEnvelopeRows = budgetEnvelopeRows.filter((b) => b.is_active);
  const activeBudgetRows = budgetRows.filter((b) => b.is_active);

  const getExpenseBudgetId = (row: ExpenseRow) => {
    if (row.budget_id) return row.budget_id;
    if (row.budget_line_id) return budgetMap.get(row.budget_line_id)?.budget_id || null;
    return null;
  };

  const postedAllRows = expenseRows.filter((r) => r.expense_status === "posted");
  const budgetSpentMap = new Map<string, number>();
  const budgetEnvelopeSpentMap = new Map<string, number>();

  for (const row of postedAllRows) {
    if (row.budget_line_id) {
      budgetSpentMap.set(
        row.budget_line_id,
        (budgetSpentMap.get(row.budget_line_id) || 0) + toNumber(row.amount),
      );
    }

    const envelopeId = getExpenseBudgetId(row);
    if (envelopeId) {
      budgetEnvelopeSpentMap.set(
        envelopeId,
        (budgetEnvelopeSpentMap.get(envelopeId) || 0) + toNumber(row.amount),
      );
    }
  }

  const budgetRowsWithStats = budgetRows.map((row) => {
    const planned = toNumber(row.planned_amount);
    const spent = budgetSpentMap.get(row.id) || 0;
    const remaining = planned - spent;
    const executionPercent = planned > 0 ? Math.min(999, (spent / planned) * 100) : 0;
    return {
      ...row,
      planned,
      spent,
      remaining,
      executionPercent,
      budgetName: row.budget_id
        ? budgetEnvelopeMap.get(row.budget_id)?.name || "Budget non nommé"
        : "Sans budget",
    };
  });

  const budgetSummaries = budgetEnvelopeRows.map((budget) => {
    const lines = budgetRowsWithStats.filter((row) => row.budget_id === budget.id);
    const activeLines = lines.filter((row) => row.is_active);
    const planned = activeLines.reduce((sum, row) => sum + row.planned, 0);
    const spent = budgetEnvelopeSpentMap.get(budget.id) || 0;
    const remaining = planned - spent;
    const executionPercent = planned > 0 ? Math.min(999, (spent / planned) * 100) : 0;

    return {
      ...budget,
      lines,
      activeLines,
      planned,
      spent,
      remaining,
      executionPercent,
    };
  });

  const activeBudgetSummaries = budgetSummaries.filter((b) => b.is_active);
  const selectedBudgetSummary = selectedBudgetFilter
    ? budgetSummaries.find((budget) => budget.id === selectedBudgetFilter) || null
    : null;

  const totalBudgetPlanned = activeBudgetSummaries.reduce(
    (sum, row) => sum + row.planned,
    0,
  );
  const totalBudgetSpent = activeBudgetSummaries.reduce(
    (sum, row) => sum + row.spent,
    0,
  );
  const totalBudgetRemaining = totalBudgetPlanned - totalBudgetSpent;
  const budgetExecutionRate =
    totalBudgetPlanned > 0 ? (totalBudgetSpent / totalBudgetPlanned) * 100 : 0;
  const unbudgetedPostedTotal = postedAllRows
    .filter((row) => !getExpenseBudgetId(row))
    .reduce((sum, row) => sum + toNumber(row.amount), 0);

  const budgetRowsForView = selectedBudgetFilter === "__unbudgeted"
    ? []
    : selectedBudgetFilter
      ? budgetRowsWithStats.filter((row) => row.budget_id === selectedBudgetFilter)
      : budgetRowsWithStats;

  const qn = normalize(q);

  const filteredRows = expenseRows.filter((row) => {
    const cat = row.category_id ? categoryMap.get(row.category_id) : null;
    const budget = row.budget_line_id ? budgetMap.get(row.budget_line_id) : null;
    const envelopeId = getExpenseBudgetId(row);
    const envelope = envelopeId ? budgetEnvelopeMap.get(envelopeId) : null;

    if (selectedBudgetFilter === "__unbudgeted") {
      if (envelopeId) return false;
    } else if (selectedBudgetFilter) {
      if (envelopeId !== selectedBudgetFilter) return false;
    }

    if (statusFilter === "posted" || statusFilter === "cancelled") {
      if (row.expense_status !== statusFilter) return false;
    }

    if (!qn) return true;

    const haystack = normalize(
      [
        row.label || "",
        row.beneficiary || "",
        row.payment_method || "",
        row.reference_no || "",
        row.notes || "",
        cat?.name || "",
        cat?.code || "",
        envelope?.name || "",
        envelope?.code || "",
        budget?.account_no || "",
        budget?.label || "",
        row.expense_date || "",
      ].join(" "),
    );

    return haystack.includes(qn);
  });

  const postedRows = filteredRows.filter((r) => r.expense_status === "posted");
  const cancelledRows = filteredRows.filter(
    (r) => r.expense_status === "cancelled",
  );

  const totalPosted = postedRows.reduce(
    (sum, row) => sum + toNumber(row.amount),
    0,
  );

  const totalAll = filteredRows.reduce(
    (sum, row) => sum + toNumber(row.amount),
    0,
  );

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <Wallet className="h-3.5 w-3.5" />
              Gestion financière premium
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Dépenses & budget
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Chaque établissement peut définir un ou plusieurs budgets, rattacher
              les postes budgétaires à chaque enveloppe, suivre une vue globale
              consolidée et enregistrer aussi des dépenses libres lorsqu’aucun
              budget n’a encore été formalisé.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
              Année suivie
            </div>
            <div className="mt-2 text-lg font-black text-white">
              {selectedAcademicYearCode || "Toutes"}
            </div>
            <div className="mt-1 text-sm text-slate-200">
              Premium actif · expiration : {access.expiresAt || "—"}
            </div>
          </div>
        </div>
      </section>

      <AcademicYearSelector
        academicYears={academicYears}
        selectedAcademicYearCode={selectedAcademicYearCode}
        currentPath="/admin/finance/expenses"
        hiddenParams={{
          q,
          status: statusFilter,
          budget_id: selectedBudgetFilter,
        }}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<FolderPlus className="h-6 w-6" />}
          label="Budget global"
          value={formatMoney(totalBudgetPlanned)}
          hint={`${activeBudgetSummaries.length} budget${activeBudgetSummaries.length > 1 ? "s" : ""} actif${activeBudgetSummaries.length > 1 ? "s" : ""} · ${activeBudgetRows.length} poste${activeBudgetRows.length > 1 ? "s" : ""}`}
          tone="slate"
        />
        <StatCard
          icon={<Receipt className="h-6 w-6" />}
          label="Dépensé sur budget"
          value={formatMoney(totalBudgetSpent)}
          hint={`Exécution : ${formatPercent(budgetExecutionRate)}`}
          tone="emerald"
        />
        <StatCard
          icon={<Wallet className="h-6 w-6" />}
          label={totalBudgetRemaining < 0 ? "Dépassement" : "Disponible"}
          value={formatMoney(Math.abs(totalBudgetRemaining))}
          hint="Budgets prévus - dépenses rattachées"
          tone={totalBudgetRemaining < 0 ? "rose" : "amber"}
        />
        <StatCard
          icon={<CircleOff className="h-6 w-6" />}
          label="Dépenses libres"
          value={formatMoney(unbudgetedPostedTotal)}
          hint="Dépenses non rattachées à un budget"
          tone={unbudgetedPostedTotal > 0 ? "rose" : "slate"}
        />
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
              <Layers className="h-4 w-4 text-emerald-600" />
              Budgets de dépenses
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Crée une enveloppe par activité si nécessaire : Budget École,
              Budget Internat, Cantine, Travaux, Projet. La vue globale additionne
              automatiquement tous les budgets actifs de l’année.
            </p>
          </div>

          <details className="w-full rounded-3xl border border-slate-200 bg-slate-50 p-4 lg:max-w-xl">
            <summary className="cursor-pointer list-none text-sm font-black text-slate-800">
              + Créer un budget / une enveloppe
            </summary>

            <form action={createExpenseBudgetAction} className="mt-4 grid gap-3 md:grid-cols-2">
              <input type="hidden" name="academic_year_id" value={selectedAcademicYearId || ""} />
              <input type="hidden" name="academic_year" value={selectedAcademicYearCode || ""} />

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Nom du budget
                </label>
                <input
                  name="name"
                  type="text"
                  required
                  placeholder="Ex. Budget École, Budget Internat..."
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Code court
                </label>
                <input
                  name="code"
                  type="text"
                  placeholder="Optionnel : internat, ecole..."
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Description
                </label>
                <input
                  name="description"
                  type="text"
                  placeholder="Optionnel"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
                />
              </div>

              <div className="md:col-span-2">
                <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800">
                  <Layers className="h-4 w-4" />
                  Créer le budget
                </button>
              </div>
            </form>
          </details>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href={`/admin/finance/expenses?academic_year=${encodeURIComponent(selectedAcademicYearCode)}`}
            className={`rounded-full px-4 py-2 text-sm font-bold ring-1 ${
              !selectedBudgetFilter
                ? "bg-emerald-600 text-white ring-emerald-600"
                : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            Tous les budgets
          </Link>

          {budgetSummaries.map((budget) => (
            <Link
              key={budget.id}
              href={`/admin/finance/expenses?academic_year=${encodeURIComponent(selectedAcademicYearCode)}&budget_id=${encodeURIComponent(budget.id)}`}
              className={`rounded-full px-4 py-2 text-sm font-bold ring-1 ${
                selectedBudgetFilter === budget.id
                  ? "bg-emerald-600 text-white ring-emerald-600"
                  : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {budget.name}
            </Link>
          ))}

          <Link
            href={`/admin/finance/expenses?academic_year=${encodeURIComponent(selectedAcademicYearCode)}&budget_id=__unbudgeted`}
            className={`rounded-full px-4 py-2 text-sm font-bold ring-1 ${
              selectedBudgetFilter === "__unbudgeted"
                ? "bg-amber-500 text-white ring-amber-500"
                : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            Hors budget
          </Link>
        </div>

        {budgetSummaries.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-sm text-slate-600">
            Aucun budget n’est encore défini pour cette année. Tu peux créer un
            budget général, ou saisir des dépenses libres sans budget.
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {budgetSummaries.map((budget) => {
              const exceeded = budget.remaining < 0;

              return (
                <article
                  key={budget.id}
                  className={`rounded-3xl border p-4 ${
                    budget.is_active
                      ? "border-slate-200 bg-white"
                      : "border-slate-200 bg-slate-50 opacity-70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-black text-slate-900">{budget.name}</div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                        {budget.code || "budget"} · {budget.activeLines.length} poste{budget.activeLines.length > 1 ? "s" : ""}
                      </div>
                    </div>
                    <BudgetStatusPill active={budget.is_active} />
                  </div>

                  {budget.description ? (
                    <p className="mt-3 text-sm leading-6 text-slate-600">{budget.description}</p>
                  ) : null}

                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="font-bold text-slate-500">Prévu</div>
                      <div className="mt-1 font-black text-slate-900">{formatMoney(budget.planned)}</div>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 p-3">
                      <div className="font-bold text-emerald-700">Dépensé</div>
                      <div className="mt-1 font-black text-emerald-800">{formatMoney(budget.spent)}</div>
                    </div>
                    <div className="rounded-2xl bg-amber-50 p-3">
                      <div className={`font-bold ${exceeded ? "text-rose-700" : "text-amber-700"}`}>
                        {exceeded ? "Dépassement" : "Reste"}
                      </div>
                      <div className={`mt-1 font-black ${exceeded ? "text-rose-800" : "text-amber-800"}`}>
                        {formatMoney(Math.abs(budget.remaining))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-slate-500">
                      Exécution : {formatPercent(budget.executionPercent)}
                    </div>
                    <form action={toggleExpenseBudgetAction}>
                      <input type="hidden" name="id" value={budget.id} />
                      <input type="hidden" name="next_active" value={budget.is_active ? "false" : "true"} />
                      <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        {budget.is_active ? "Désactiver" : "Réactiver"}
                      </button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

<section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
  <div className="rounded-[28px] border border-emerald-200 bg-white p-5 shadow-sm">
    <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
      <Wallet className="h-4 w-4 text-emerald-600" />
      Saisir une dépense
    </div>
    <p className="mt-2 text-sm leading-6 text-slate-600">
      Choisis le budget concerné, puis un poste si la dépense correspond à
      une ligne précise. Sinon, laisse hors budget ou hors poste selon le cas.
      Les catégories restent retirées de l’écran principal pour garder la saisie rapide.
    </p>

    <form
      action={createExpenseAction}
      className="mt-5 grid gap-4 md:grid-cols-2"
    >
      <input
        type="hidden"
        name="academic_year_id"
        value={selectedAcademicYearId || ""}
      />
      <input
        type="hidden"
        name="academic_year"
        value={selectedAcademicYearCode || ""}
      />
      <input type="hidden" name="category_id" value="" />

      <div className="md:col-span-2">
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Budget concerné
        </label>
        <select
          name="budget_id"
          defaultValue={selectedBudgetSummary?.id || ""}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
        >
          <option value="">Dépense libre / hors budget</option>
          {activeBudgetEnvelopeRows.map((budget) => (
            <option key={budget.id} value={budget.id}>
              {budget.name}
            </option>
          ))}
        </select>
      </div>

      <div className="md:col-span-2">
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Poste budgétaire
        </label>
        <select
          name="budget_line_id"
          defaultValue=""
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
        >
          <option value="">Aucun poste précis</option>
          {budgetRowsWithStats
            .filter((row) => row.is_active)
            .filter((row) => !selectedBudgetSummary || row.budget_id === selectedBudgetSummary.id)
            .map((row) => (
              <option key={row.id} value={row.id}>
                [{row.budgetName}] {row.account_no ? `${row.account_no} — ` : ""}
                {row.label} · disponible {formatMoney(row.remaining)}
              </option>
            ))}
        </select>
        <p className="mt-2 text-xs text-slate-500">
          Si un poste est choisi, le budget est repris automatiquement depuis ce poste.
        </p>
      </div>

      <div className="md:col-span-2">
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Libellé
        </label>
        <input
          name="label"
          type="text"
          placeholder="Ex. Achat de craies, réparation imprimante..."
          required
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Montant
        </label>
        <input
          name="amount"
          type="number"
          min="0"
          step="1"
          required
          placeholder="0"
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Date
        </label>
        <input
          name="expense_date"
          type="date"
          defaultValue={new Date().toISOString().slice(0, 10)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Bénéficiaire / fournisseur
        </label>
        <input
          name="beneficiary"
          type="text"
          placeholder="Ex. Papeterie, technicien, station-service..."
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Mode de paiement
        </label>
        <input
          name="payment_method"
          type="text"
          placeholder="Ex. Caisse, mobile money, banque..."
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
        />
      </div>

      <div className="md:col-span-2">
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Référence / note
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            name="reference_no"
            type="text"
            placeholder="N° pièce, facture, reçu..."
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
          />
          <input
            name="notes"
            type="text"
            placeholder="Note interne, facultatif"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
          />
        </div>
      </div>

      <div className="md:col-span-2 flex flex-wrap gap-3">
        <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">
          <Wallet className="h-4 w-4" />
          Enregistrer la dépense
        </button>

        <Link
          href={`/admin/finance/reports?academic_year=${encodeURIComponent(selectedAcademicYearCode)}&view=depenses`}
          className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          Voir les rapports
        </Link>
      </div>
    </form>
  </div>

  <details
    className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
    open={budgetRowsWithStats.length === 0}
  >
    <summary className="cursor-pointer list-none">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <FolderPlus className="h-4 w-4 text-emerald-600" />
            Ajouter un poste budgétaire
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            À ouvrir seulement pour créer une nouvelle ligne de budget.
          </p>
        </div>
        <span className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
          Ouvrir / fermer
        </span>
      </div>
    </summary>

    <form
      action={createExpenseBudgetLineAction}
      className="mt-5 grid gap-4 md:grid-cols-2"
    >
      <input
        type="hidden"
        name="academic_year_id"
        value={selectedAcademicYearId || ""}
      />
      <input
        type="hidden"
        name="academic_year"
        value={selectedAcademicYearCode || ""}
      />
      <input type="hidden" name="category_id" value="" />
      <input type="hidden" name="notes" value="" />

      <div className="md:col-span-2">
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Budget à rattacher
        </label>
        <select
          name="budget_id"
          defaultValue={selectedBudgetSummary?.id || activeBudgetEnvelopeRows[0]?.id || ""}
          required={activeBudgetEnvelopeRows.length > 0}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
        >
          <option value="">Choisir un budget</option>
          {activeBudgetEnvelopeRows.map((budget) => (
            <option key={budget.id} value={budget.id}>
              {budget.name}
            </option>
          ))}
        </select>
        {activeBudgetEnvelopeRows.length === 0 ? (
          <p className="mt-2 text-xs text-amber-700">
            Crée d’abord un budget général ou spécifique avant d’ajouter des postes.
          </p>
        ) : null}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          N° de compte
        </label>
        <input
          name="account_no"
          type="text"
          placeholder="Ex. 604150"
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Montant prévu
        </label>
        <input
          name="planned_amount"
          type="number"
          min="0"
          step="1"
          required
          placeholder="0"
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
        />
      </div>

      <div className="md:col-span-2">
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Libellé du poste
        </label>
        <input
          name="label"
          type="text"
          placeholder="Ex. Fourniture de bureau, frais de mission, salaires..."
          required
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
        />
      </div>

      <div className="md:col-span-2 flex flex-wrap gap-3">
        <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800">
          <FolderPlus className="h-4 w-4" />
          Créer le poste
        </button>

        <Link
          href={`/admin/finance?academic_year=${encodeURIComponent(selectedAcademicYearCode)}`}
          className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          Retour Finance
        </Link>
      </div>
    </form>
  </details>
</section>

<section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div>
      <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
Postes budgétaires
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {selectedBudgetSummary
          ? `Budget affiché : ${selectedBudgetSummary.name}`
          : selectedBudgetFilter === "__unbudgeted"
            ? "Aucun poste pour les dépenses hors budget."
            : "Liste consolidée : prévu, consommé, disponible."}
      </p>
    </div>
    <div className="rounded-2xl bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200">
      {budgetRowsForView.length} poste{budgetRowsForView.length > 1 ? "s" : ""}
    </div>
  </div>

  {budgetRowsForView.length === 0 ? (
    <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
      Aucun poste budgétaire n’est enregistré pour cette année. Tu peux
      quand même saisir des dépenses libres, puis créer le budget plus tard.
    </div>
  ) : (
    <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
      <div className="max-h-[520px] overflow-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="text-left text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              <th className="px-4 py-3">Budget</th>
              <th className="px-4 py-3">Poste</th>
              <th className="px-4 py-3 text-right">Prévu</th>
              <th className="px-4 py-3 text-right">Consommé</th>
              <th className="px-4 py-3 text-right">Disponible</th>
              <th className="px-4 py-3">Modifier le prévu</th>
              <th className="px-4 py-3 text-right">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {budgetRowsForView.map((row) => {
              const exceeded = row.remaining < 0;

              return (
                <tr
                  key={row.id}
                  className={row.is_active ? "hover:bg-slate-50" : "bg-slate-50/60 opacity-70"}
                >
                  <td className="whitespace-nowrap px-4 py-3 align-top text-sm font-bold text-slate-700">
                    {row.budgetName}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-black text-slate-900">
                      {row.account_no ? `${row.account_no} — ` : ""}
                      {row.label}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Exécution : {formatPercent(row.executionPercent)}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right align-top font-black text-slate-900">
                    {formatMoney(row.planned)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right align-top font-bold text-emerald-800">
                    {formatMoney(row.spent)}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right align-top font-bold ${exceeded ? "text-rose-700" : "text-amber-800"}`}>
                    {exceeded ? "+ " : ""}{formatMoney(Math.abs(row.remaining))}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <form
                      action={updateExpenseBudgetLineAmountAction}
                      className="flex min-w-[220px] gap-2"
                    >
                      <input type="hidden" name="id" value={row.id} />
                      <input
                        name="planned_amount"
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={row.planned}
                        className="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-500"
                      />
                      <button className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800">
                        OK
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <form action={toggleExpenseBudgetLineAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <input
                        type="hidden"
                        name="next_active"
                        value={row.is_active ? "false" : "true"}
                      />
                      <button
                        className={`inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-bold ${
                          row.is_active
                            ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            : "bg-emerald-600 text-white hover:bg-emerald-700"
                        }`}
                      >
                        {row.is_active ? "Désactiver" : "Réactiver"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  )}
</section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          <Search className="h-4 w-4 text-emerald-600" />
          Filtrer les dépenses
        </div>

        <form
          method="GET"
          className="mt-5 grid gap-4 md:grid-cols-[1.2fr_0.8fr_0.8fr_auto]"
        >
          <input
            type="hidden"
            name="academic_year"
            value={selectedAcademicYearCode}
          />
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Recherche
            </label>
            <input
              name="q"
              defaultValue={q}
              placeholder="Libellé, bénéficiaire, budget, référence..."
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Budget
            </label>
            <select
              name="budget_id"
              defaultValue={selectedBudgetFilter}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
            >
              <option value="">Tous les budgets</option>
              {budgetSummaries.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name}
                </option>
              ))}
              <option value="__unbudgeted">Hors budget</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Statut
            </label>
            <select
              name="status"
              defaultValue={statusFilter}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
            >
              <option value="">Tous</option>
              <option value="posted">Validées</option>
              <option value="cancelled">Annulées</option>
            </select>
          </div>

          <div className="flex items-end gap-3">
            <button className="inline-flex h-[50px] items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700">
              <Search className="h-4 w-4" />
              Filtrer
            </button>

            <Link
              href={`/admin/finance/expenses?academic_year=${encodeURIComponent(selectedAcademicYearCode)}`}
              className="inline-flex h-[50px] items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Réinitialiser
            </Link>
          </div>
        </form>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<Receipt className="h-5 w-5" />}
            label="Dépenses validées"
            value={postedRows.length}
            hint="Après filtres"
            tone="emerald"
          />
          <StatCard
            icon={<Wallet className="h-5 w-5" />}
            label="Montant validé"
            value={formatMoney(totalPosted)}
            hint="Somme des écritures validées"
            tone="slate"
          />
          <StatCard
            icon={<XCircle className="h-5 w-5" />}
            label="Annulations"
            value={cancelledRows.length}
            hint={`Total filtré : ${formatMoney(totalAll)}`}
            tone="rose"
          />
          <StatCard
            icon={<CalendarClock className="h-5 w-5" />}
            label="Période"
            value={selectedAcademicYearCode || "Toutes"}
            hint="Filtre année scolaire"
            tone="amber"
          />
        </div>

        <div className="mt-6 space-y-4">
          {filteredRows.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucune dépense ne correspond aux filtres actuels.
            </div>
          ) : (
            filteredRows.map((row) => {
              const budget = row.budget_line_id
                ? budgetMap.get(row.budget_line_id)
                : null;
              const envelopeId = getExpenseBudgetId(row);
              const envelope = envelopeId ? budgetEnvelopeMap.get(envelopeId) : null;

              return (
                <article
                  key={row.id}
                  className="overflow-hidden rounded-[24px] border border-slate-200 bg-white"
                >
                  <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-black text-slate-900">
                          {row.label}
                        </div>
                        <ExpenseStatusPill status={row.expense_status} />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        {envelope ? (
                          <span className="rounded-full bg-slate-100 px-3 py-1 font-bold text-slate-700 ring-1 ring-slate-200">
                            {envelope.name}
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700 ring-1 ring-amber-200">
                            Hors budget
                          </span>
                        )}
                        {budget ? (
                          <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 ring-1 ring-emerald-200">
                            {budget.account_no ? `${budget.account_no} — ` : ""}
                            {budget.label}
                          </span>
                        ) : envelope ? (
                          <span className="rounded-full bg-slate-50 px-3 py-1 text-slate-600 ring-1 ring-slate-200">
                            Sans poste précis
                          </span>
                        ) : null}
                        {row.beneficiary ? (
                          <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700 ring-1 ring-sky-200">
                            {row.beneficiary}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-col items-start gap-2 lg:items-end">
                      <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">
                        {formatMoney(row.amount)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatExpenseDate(row.expense_date)}
                      </div>
                      <form
                        action={updateExpenseAmountAction}
                        className="mt-1 flex w-full max-w-[280px] flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 sm:flex-row lg:w-[280px]"
                      >
                        <input type="hidden" name="id" value={row.id} />
                        <label className="sr-only">Modifier le montant de la dépense</label>
                        <input
                          name="amount"
                          type="number"
                          min="1"
                          step="1"
                          defaultValue={toNumber(row.amount)}
                          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-500"
                        />
                        <button className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800">
                          Modifier
                        </button>
                      </form>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="grid gap-2 text-sm text-slate-700">
                      <div>
                        <span className="font-semibold text-slate-800">
                          Date :
                        </span>{" "}
                        {formatExpenseDate(row.expense_date)}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-800">
                          Budget :
                        </span>{" "}
                        {envelope ? envelope.name : "Hors budget"}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-800">
                          Poste budgétaire :
                        </span>{" "}
                        {budget
                          ? `${budget.account_no ? `${budget.account_no} — ` : ""}${budget.label}`
                          : envelope ? "Sans poste précis" : "Dépense libre"}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-800">
                          Mode / référence :
                        </span>{" "}
                        {[row.payment_method, row.reference_no]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                      {row.notes ? (
                        <div>
                          <span className="font-semibold text-slate-800">
                            Note :
                          </span>{" "}
                          {row.notes}
                        </div>
                      ) : null}
                      <div>
                        <span className="font-semibold text-slate-800">
                          Créée le :
                        </span>{" "}
                        {row.created_at
                          ? new Date(row.created_at).toLocaleString("fr-FR", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "—"}
                      </div>
                    </div>

                    {row.expense_status === "posted" ? (
                      <form action={cancelExpenseAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <button className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
                          <XCircle className="h-4 w-4" />
                          Annuler cette dépense
                        </button>
                      </form>
                    ) : (
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Dépense annulée
                      </div>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
