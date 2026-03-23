// src/app/admin/finance/reports/page.tsx
import { redirect } from "next/navigation";
import {
  BarChart3,
  CalendarClock,
  CircleDollarSign,
  Layers3,
  Receipt,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

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

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint: string;
}) {
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
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
          {icon}
        </div>
      </div>
    </div>
  );
}

export default async function FinanceReportsPage() {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const supabase = await getSupabaseServerClient();

  const [
    { data: feeCategories, error: feeCatErr },
    { data: feeSchedules, error: feeSchErr },
    { data: expenseCategories, error: expCatErr },
    { data: expenses, error: expErr },
    { data: classes, error: clsErr },
  ] = await Promise.all([
    supabase
      .schema("finance")
      .from("fee_categories")
      .select("id,name,code,is_active")
      .eq("school_id", institutionId)
      .order("name", { ascending: true }),

    supabase
      .schema("finance")
      .from("fee_schedules")
      .select(
        "id,label,amount,academic_year,class_id,fee_category_id,due_date,allow_partial,is_active"
      )
      .eq("school_id", institutionId)
      .order("created_at", { ascending: false }),

    supabase
      .schema("finance")
      .from("expense_categories")
      .select("id,name,code,is_active")
      .eq("school_id", institutionId)
      .order("name", { ascending: true }),

    supabase
      .schema("finance")
      .from("expenses")
      .select("id,category_id,expense_status,expense_date,label,beneficiary,amount")
      .eq("school_id", institutionId)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false }),

    supabase
      .from("classes")
      .select("id,label,level,academic_year")
      .eq("institution_id", institutionId)
      .order("label", { ascending: true }),
  ]);

  if (feeCatErr) throw new Error(feeCatErr.message);
  if (feeSchErr) throw new Error(feeSchErr.message);
  if (expCatErr) throw new Error(expCatErr.message);
  if (expErr) throw new Error(expErr.message);
  if (clsErr) throw new Error(clsErr.message);

  const feeCategoryRows = (feeCategories ?? []) as FeeCategoryRow[];
  const feeScheduleRows = (feeSchedules ?? []) as FeeScheduleRow[];
  const expenseCategoryRows = (expenseCategories ?? []) as ExpenseCategoryRow[];
  const expenseRows = (expenses ?? []) as ExpenseRow[];
  const classRows = (classes ?? []) as ClassRow[];

  const classMap = new Map(classRows.map((c) => [c.id, c]));
  const feeCategoryMap = new Map(feeCategoryRows.map((c) => [c.id, c]));
  const expenseCategoryMap = new Map(expenseCategoryRows.map((c) => [c.id, c]));

  const activeFeeCategories = feeCategoryRows.filter((r) => r.is_active).length;
  const activeSchedules = feeScheduleRows.filter((r) => r.is_active);
  const postedExpenses = expenseRows.filter((r) => r.expense_status === "posted");

  const totalScheduledAmount = activeSchedules.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );

  const totalExpensesAmount = postedExpenses.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );

  const schedulesByCategory = feeCategoryRows
    .map((cat) => {
      const items = activeSchedules.filter((s) => s.fee_category_id === cat.id);
      const total = items.reduce((sum, s) => sum + Number(s.amount || 0), 0);
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
      const total = items.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      return {
        id: cat.id,
        name: cat.name,
        count: items.length,
        total,
      };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.total - a.total);

  const schedulesByClass = activeSchedules
    .map((row) => {
      const cls = row.class_id ? classMap.get(row.class_id) : null;
      return {
        classId: row.class_id || "unknown",
        classLabel: cls?.label || "Classe inconnue",
        academicYear: row.academic_year || cls?.academic_year || "—",
        amount: Number(row.amount || 0),
      };
    })
    .reduce<Record<string, { classLabel: string; academicYear: string; total: number; count: number }>>(
      (acc, row) => {
        if (!acc[row.classId]) {
          acc[row.classId] = {
            classLabel: row.classLabel,
            academicYear: row.academicYear,
            total: 0,
            count: 0,
          };
        }
        acc[row.classId].total += row.amount;
        acc[row.classId].count += 1;
        return acc;
      },
      {}
    );

  const classSummary = Object.values(schedulesByClass).sort((a, b) => b.total - a.total);

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
              Vue synthétique des catégories de frais, des barèmes enregistrés et des
              dépenses déjà saisies dans l’établissement.
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Layers3 className="h-5 w-5" />}
          label="Catégories de frais"
          value={feeCategoryRows.length}
          hint={`${activeFeeCategories} actives`}
        />
        <StatCard
          icon={<CalendarClock className="h-5 w-5" />}
          label="Barèmes actifs"
          value={activeSchedules.length}
          hint="Montants planifiés"
        />
        <StatCard
          icon={<CircleDollarSign className="h-5 w-5" />}
          label="Montant barémé"
          value={formatMoney(totalScheduledAmount)}
          hint="Somme des barèmes actifs"
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          label="Dépenses"
          value={formatMoney(totalExpensesAmount)}
          hint={`${postedExpenses.length} dépenses enregistrées`}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Layers3 className="h-4 w-4 text-emerald-600" />
            Répartition des barèmes par catégorie
          </div>

          {schedulesByCategory.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucun barème actif pour le moment.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {schedulesByCategory.map((row) => (
                <article
                  key={row.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">{row.name}</h2>
                      <div className="mt-1 text-sm text-slate-600">
                        {row.count} barème{row.count > 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">
                      {formatMoney(row.total)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Receipt className="h-4 w-4 text-emerald-600" />
            Répartition des dépenses par catégorie
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
                      <h2 className="text-lg font-black text-slate-900">{row.name}</h2>
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
            Barèmes par classe
          </div>

          {classSummary.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucune synthèse disponible.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {classSummary.map((row, index) => (
                <article
                  key={`${row.classLabel}-${index}`}
                  className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">
                        {row.classLabel}
                      </h2>
                      <div className="mt-1 text-sm text-slate-600">
                        {row.academicYear} • {row.count} barème{row.count > 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-bold text-sky-700 ring-1 ring-sky-200">
                      {formatMoney(row.total)}
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
                const cat = row.category_id ? expenseCategoryMap.get(row.category_id) : null;
                return (
                  <article
                    key={row.id}
                    className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-lg font-black text-slate-900">{row.label}</h2>
                        <div className="mt-1 text-sm text-slate-600">
                          {row.expense_date} • {cat?.name || "Sans catégorie"}
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
    </div>
  );
}