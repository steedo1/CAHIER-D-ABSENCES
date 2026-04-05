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
  Receipt,
  Search,
  Wallet,
  XCircle,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

type ExpenseCategoryRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type ExpenseRow = {
  id: string;
  category_id: string | null;
  expense_status: "posted" | "cancelled";
  expense_date: string;
  label: string;
  beneficiary: string | null;
  amount: number | string;
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

function formatMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
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

async function createExpenseCategoryAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();

  const name = String(formData.get("name") || "").trim();
  const codeInput = String(formData.get("code") || "").trim();

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
        "Une catégorie portant ce code existe déjà pour cet établissement."
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

  const id = String(formData.get("id") || "").trim();
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

async function createExpenseAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();

  const categoryId = String(formData.get("category_id") || "").trim();
  const label = String(formData.get("label") || "").trim();
  const amountRaw = String(formData.get("amount") || "").trim();
  const expenseDate = String(formData.get("expense_date") || "").trim();
  const beneficiary = String(formData.get("beneficiary") || "").trim();

  if (!categoryId) {
    throw new Error("La catégorie de dépense est obligatoire.");
  }

  if (!label) {
    throw new Error("Le libellé de la dépense est obligatoire.");
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Le montant doit être supérieur à 0.");
  }

  const admin = getSupabaseServiceClient();

  const { data: category, error: catErr } = await admin
    .schema("finance")
    .from("expense_categories")
    .select("id,name,is_active")
    .eq("id", categoryId)
    .eq("school_id", institutionId)
    .maybeSingle();

  if (catErr) throw new Error(catErr.message);
  if (!category) throw new Error("Catégorie introuvable.");
  if (!category.is_active) {
    throw new Error("La catégorie choisie est inactive.");
  }

  const { error } = await admin
    .schema("finance")
    .from("expenses")
    .insert({
      school_id: institutionId,
      category_id: categoryId,
      expense_status: "posted",
      expense_date: expenseDate || new Date().toISOString().slice(0, 10),
      label,
      beneficiary: beneficiary || null,
      amount,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

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

  const id = String(formData.get("id") || "").trim();
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
}: {
  icon: ReactNode;
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

function ExpenseStatusPill({
  status,
}: {
  status: "posted" | "cancelled";
}) {
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

export default async function FinanceExpensesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string; category_id?: string }>;
}) {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const params = searchParams ? await searchParams : undefined;
  const q = String(params?.q || "").trim();
  const statusFilter = String(params?.status || "").trim();
  const categoryIdFilter = String(params?.category_id || "").trim();

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const supabase = await getSupabaseServerClient();

  const [{ data: categories, error: catErr }, { data: expenses, error: expErr }] =
    await Promise.all([
      supabase
        .schema("finance")
        .from("expense_categories")
        .select("id,code,name,is_active")
        .eq("school_id", institutionId)
        .order("name", { ascending: true }),

      (() => {
        let query = supabase
          .schema("finance")
          .from("expenses")
          .select(
            "id,category_id,expense_status,expense_date,label,beneficiary,amount,created_at"
          )
          .eq("school_id", institutionId)
          .order("expense_date", { ascending: false })
          .order("created_at", { ascending: false });

        if (categoryIdFilter) {
          query = query.eq("category_id", categoryIdFilter);
        }

        if (statusFilter === "posted" || statusFilter === "cancelled") {
          query = query.eq("expense_status", statusFilter);
        }

        return query;
      })(),
    ]);

  if (catErr) throw new Error(catErr.message);
  if (expErr) throw new Error(expErr.message);

  const categoryRows = (categories ?? []) as ExpenseCategoryRow[];
  const expenseRows = (expenses ?? []) as ExpenseRow[];

  const categoryMap = new Map(categoryRows.map((c) => [c.id, c]));
  const activeCategories = categoryRows.filter((c) => c.is_active);

  const qn = normalize(q);

  const filteredRows = expenseRows.filter((row) => {
    if (!qn) return true;

    const cat = row.category_id ? categoryMap.get(row.category_id) : null;
    const haystack = normalize(
      [
        row.label || "",
        row.beneficiary || "",
        cat?.name || "",
        cat?.code || "",
        row.expense_date || "",
      ].join(" ")
    );

    return haystack.includes(qn);
  });

  const postedRows = filteredRows.filter((r) => r.expense_status === "posted");
  const cancelledRows = filteredRows.filter((r) => r.expense_status === "cancelled");

  const totalPosted = postedRows.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );

  const totalAll = filteredRows.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
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
              Dépenses internes
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Cette page permet de créer les catégories de dépenses, saisir les
              écritures validées et suivre les montants déjà engagés par
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<FolderPlus className="h-6 w-6" />}
          label="Catégories"
          value={categoryRows.length}
          hint={`${activeCategories.length} active(s)`}
        />
        <StatCard
          icon={<Receipt className="h-6 w-6" />}
          label="Dépenses validées"
          value={postedRows.length}
          hint="Écritures en cours de suivi"
        />
        <StatCard
          icon={<Wallet className="h-6 w-6" />}
          label="Montant validé"
          value={formatMoney(totalPosted)}
          hint="Somme des dépenses validées"
        />
        <StatCard
          icon={<XCircle className="h-6 w-6" />}
          label="Annulations"
          value={cancelledRows.length}
          hint={`Total filtré : ${formatMoney(totalAll)}`}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <FolderPlus className="h-4 w-4 text-emerald-600" />
            Nouvelle catégorie de dépense
          </div>

          <form action={createExpenseCategoryAction} className="mt-5 grid gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Nom de la catégorie
              </label>
              <input
                name="name"
                type="text"
                placeholder="Ex. Fournitures, carburant, maintenance"
                required
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Code
              </label>
              <input
                name="code"
                type="text"
                placeholder="Ex. fournitures"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">
                <FolderPlus className="h-4 w-4" />
                Créer la catégorie
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
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Wallet className="h-4 w-4 text-emerald-600" />
            Saisir une dépense
          </div>

          {activeCategories.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Crée d’abord au moins une catégorie active avant d’enregistrer une
              dépense.
            </div>
          ) : (
            <form action={createExpenseAction} className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Catégorie
                </label>
                <select
                  name="category_id"
                  required
                  defaultValue=""
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
                >
                  <option value="" disabled>
                    Choisir une catégorie
                  </option>
                  {activeCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
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
                  step="0.01"
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

              <div className="md:col-span-2">
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

              <div className="md:col-span-2 flex flex-wrap gap-3">
                <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">
                  <Wallet className="h-4 w-4" />
                  Enregistrer la dépense
                </button>

                <Link
                  href="/admin/finance/reports"
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Voir les rapports
                </Link>
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
              Catégories existantes
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Active ou désactive les catégories selon l’organisation de ton établissement.
            </p>
          </div>
        </div>

        {categoryRows.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
            Aucune catégorie de dépense enregistrée pour le moment.
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {categoryRows.map((row) => (
              <article
                key={row.id}
                className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-black text-slate-900">{row.name}</div>
                    <div className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {row.code}
                    </div>
                  </div>
                  <CategoryStatusPill active={row.is_active} />
                </div>

                <div className="mt-4">
                  <form action={toggleExpenseCategoryAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <input
                      type="hidden"
                      name="next_active"
                      value={row.is_active ? "false" : "true"}
                    />
                    <button
                      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold ${
                        row.is_active
                          ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          : "bg-emerald-600 text-white hover:bg-emerald-700"
                      }`}
                    >
                      {row.is_active ? (
                        <>
                          <CircleOff className="h-4 w-4" />
                          Désactiver
                        </>
                      ) : (
                        <>
                          <BadgeCheck className="h-4 w-4" />
                          Réactiver
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          <Search className="h-4 w-4 text-emerald-600" />
          Filtrer les dépenses
        </div>

        <form className="mt-5 grid gap-4 md:grid-cols-[1.3fr_0.8fr_0.8fr_auto]">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Recherche
            </label>
            <input
              name="q"
              defaultValue={q}
              placeholder="Libellé, bénéficiaire, catégorie..."
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500"
            />
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

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Catégorie
            </label>
            <select
              name="category_id"
              defaultValue={categoryIdFilter}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
            >
              <option value="">Toutes</option>
              {categoryRows.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-3">
            <button className="inline-flex h-[50px] items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700">
              <Search className="h-4 w-4" />
              Filtrer
            </button>

            <Link
              href="/admin/finance/expenses"
              className="inline-flex h-[50px] items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Réinitialiser
            </Link>
          </div>
        </form>

        <div className="mt-6 space-y-4">
          {filteredRows.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucune dépense ne correspond aux filtres actuels.
            </div>
          ) : (
            filteredRows.map((row) => {
              const category = row.category_id ? categoryMap.get(row.category_id) : null;

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
                        <span className="rounded-full bg-slate-100 px-3 py-1 ring-1 ring-slate-200">
                          {category?.name || "Catégorie inconnue"}
                        </span>
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
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="grid gap-2 text-sm text-slate-700">
                      <div>
                        <span className="font-semibold text-slate-800">Date :</span>{" "}
                        {formatExpenseDate(row.expense_date)}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-800">Code catégorie :</span>{" "}
                        {category?.code || "—"}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-800">Créée le :</span>{" "}
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