import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CreditCard,
  FileText,
  Receipt,
  Users,
  Wallet,
  Layers3,
  AlertTriangle,
  School2,
  TrendingUp,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

type StudentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  matricule: string | null;
  class_id: string | null;
};

type FeeCategoryRow = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
};

type FeeScheduleRow = {
  id: string;
  class_id: string | null;
  label: string;
  amount: number | string;
  due_date: string | null;
  allow_partial: boolean;
  is_active: boolean;
};

type ChargeBalanceRow = {
  id: string;
  student_id: string;
  class_id: string | null;
  label: string;
  net_amount: number | string;
  paid_amount: number | string;
  balance_due: number | string;
  due_date: string | null;
  computed_status: "pending" | "partial" | "paid" | "overdue" | "cancelled";
};

type ReceiptRow = {
  id: string;
  student_id: string;
  receipt_no: string;
  receipt_status: "posted" | "cancelled";
  payment_date: string;
  total_amount: number | string;
  payer_name: string | null;
};

type ExpenseRow = {
  id: string;
  expense_status: "posted" | "cancelled";
  expense_date: string;
  label: string;
  amount: number | string;
  beneficiary: string | null;
};

function formatMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function fullName(student: StudentRow | undefined | null) {
  if (!student) return "Élève inconnu";
  const parts = [student.first_name || "", student.last_name || ""]
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.join(" ") || student.matricule || "Élève sans nom";
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

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "slate",
}: {
  icon: React.ReactNode;
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

function QuickLinkCard({
  href,
  icon,
  title,
  description,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
            {icon}
          </div>
          <h3 className="mt-4 text-lg font-black text-slate-900">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {badge ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200">
              {badge}
            </span>
          ) : null}
          <ArrowRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

export default async function AdminFinancePage() {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const supabase = await getSupabaseServerClient();

  const { data: classes, error: clsErr } = await supabase
    .from("classes")
    .select("id,label,level,academic_year")
    .eq("institution_id", institutionId)
    .order("label", { ascending: true });

  if (clsErr) throw new Error(clsErr.message);

  const classRows = (classes ?? []) as ClassRow[];
  const classMap = new Map(classRows.map((c) => [c.id, c]));
  const classIds = classRows.map((c) => c.id);

  const [
    { data: students, error: stuErr },
    { data: feeCategories, error: feeCatErr },
    { data: feeSchedules, error: feeSchErr },
    { data: balances, error: balErr },
    { data: receipts, error: recErr },
    { data: expenses, error: expErr },
  ] = await Promise.all([
    classIds.length
      ? supabase
          .from("students")
          .select("id,first_name,last_name,matricule,class_id")
          .in("class_id", classIds)
      : Promise.resolve({ data: [], error: null as any }),

    supabase
      .schema("finance")
      .from("fee_categories")
      .select("id,name,code,is_active")
      .eq("school_id", institutionId)
      .order("name", { ascending: true }),

    supabase
      .schema("finance")
      .from("fee_schedules")
      .select("id,class_id,label,amount,due_date,allow_partial,is_active")
      .eq("school_id", institutionId)
      .order("created_at", { ascending: false }),

    supabase
      .schema("finance")
      .from("v_charge_balances")
      .select(
        "id,student_id,class_id,label,net_amount,paid_amount,balance_due,due_date,computed_status"
      )
      .eq("school_id", institutionId)
      .neq("computed_status", "cancelled"),

    supabase
      .schema("finance")
      .from("receipts")
      .select(
        "id,student_id,receipt_no,receipt_status,payment_date,total_amount,payer_name"
      )
      .eq("school_id", institutionId)
      .order("payment_date", { ascending: false })
      .limit(8),

    supabase
      .schema("finance")
      .from("expenses")
      .select("id,expense_status,expense_date,label,amount,beneficiary")
      .eq("school_id", institutionId)
      .order("expense_date", { ascending: false })
      .limit(8),
  ]);

  if (stuErr) throw new Error(stuErr.message);
  if (feeCatErr) throw new Error(feeCatErr.message);
  if (feeSchErr) throw new Error(feeSchErr.message);
  if (balErr) throw new Error(balErr.message);
  if (recErr) throw new Error(recErr.message);
  if (expErr) throw new Error(expErr.message);

  const studentRows = (students ?? []) as StudentRow[];
  const feeCategoryRows = (feeCategories ?? []) as FeeCategoryRow[];
  const feeScheduleRows = (feeSchedules ?? []) as FeeScheduleRow[];
  const balanceRows = (balances ?? []) as ChargeBalanceRow[];
  const receiptRows = (receipts ?? []) as ReceiptRow[];
  const expenseRows = (expenses ?? []) as ExpenseRow[];

  const studentMap = new Map(studentRows.map((s) => [s.id, s]));

  const activeFeeCategories = feeCategoryRows.filter((r) => r.is_active).length;
  const activeSchedules = feeScheduleRows.filter((r) => r.is_active);
  const postedReceipts = receiptRows.filter((r) => r.receipt_status === "posted");
  const postedExpenses = expenseRows.filter((r) => r.expense_status === "posted");
  const openBalances = balanceRows.filter((r) => Number(r.balance_due || 0) > 0);
  const overdueBalances = openBalances.filter((r) => {
    if (!r.due_date) return false;
    return new Date(`${r.due_date}T23:59:59`).getTime() < Date.now();
  });

  const totalBilled = balanceRows.reduce(
    (sum, row) => sum + Number(row.net_amount || 0),
    0
  );
  const totalCollected = balanceRows.reduce(
    (sum, row) => sum + Number(row.paid_amount || 0),
    0
  );
  const totalDue = openBalances.reduce(
    (sum, row) => sum + Number(row.balance_due || 0),
    0
  );
  const overdueAmount = overdueBalances.reduce(
    (sum, row) => sum + Number(row.balance_due || 0),
    0
  );
  const expensesAmount = postedExpenses.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );

  const coverageRate =
    totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;

  const chargesByClass = classRows
    .map((cls) => {
      const rows = openBalances.filter((b) => b.class_id === cls.id);
      const due = rows.reduce((sum, row) => sum + Number(row.balance_due || 0), 0);
      const overdue = rows.filter((row) => {
        if (!row.due_date) return false;
        return new Date(`${row.due_date}T23:59:59`).getTime() < Date.now();
      }).length;

      return {
        id: cls.id,
        label: cls.label,
        level: cls.level,
        academicYear: cls.academic_year,
        due,
        overdue,
        count: rows.length,
      };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.due - a.due)
    .slice(0, 6);

  const recentArrears = openBalances
    .slice()
    .sort((a, b) => {
      const ad = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      return ad - bd;
    })
    .slice(0, 6);

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
              Tableau de bord financier
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Vue centrale des frais, dettes élèves, encaissements manuels,
              reçus, impayés, dépenses et rapports de l’établissement.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 ring-1 ring-emerald-400/25">
                Finance Premium actif
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                Expiration : {access.expiresAt || "—"}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                Couverture : {coverageRate}%
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                Total facturé
              </div>
              <div className="mt-2 text-3xl font-black text-white">
                {formatMoney(totalBilled)}
              </div>
              <div className="mt-1 text-sm text-slate-200">
                Toutes dettes générées
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                Total encaissé
              </div>
              <div className="mt-2 text-3xl font-black text-white">
                {formatMoney(totalCollected)}
              </div>
              <div className="mt-1 text-sm text-slate-200">
                Paiements comptabilisés
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Users className="h-6 w-6" />}
          label="Élèves"
          value={studentRows.length}
          hint={`${classRows.length} classes`}
          tone="slate"
        />
        <StatCard
          icon={<Layers3 className="h-6 w-6" />}
          label="Frais & barèmes"
          value={activeSchedules.length}
          hint={`${activeFeeCategories} catégories actives`}
          tone="emerald"
        />
        <StatCard
          icon={<Receipt className="h-6 w-6" />}
          label="Reste à recouvrer"
          value={formatMoney(totalDue)}
          hint={`${openBalances.length} dette(s) ouverte(s)`}
          tone="amber"
        />
        <StatCard
          icon={<BarChart3 className="h-6 w-6" />}
          label="Dépenses récentes"
          value={formatMoney(expensesAmount)}
          hint={`${postedExpenses.length} écriture(s) affichée(s)`}
          tone="violet"
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <QuickLinkCard
          href="/admin/finance/fees"
          icon={<Layers3 className="h-5 w-5" />}
          title="Catégories de frais"
          description="Créer les types de frais comme scolarité, inscription, transport ou cantine."
          badge={`${feeCategoryRows.length}`}
        />
        <QuickLinkCard
          href="/admin/finance/fees/schedules"
          icon={<CalendarClock className="h-5 w-5" />}
          title="Barèmes & échéanciers"
          description="Définir les montants réels par classe et année scolaire."
          badge={`${activeSchedules.length}`}
        />
        <QuickLinkCard
          href="/admin/finance/charges"
          icon={<FileText className="h-5 w-5" />}
          title="Dettes élèves"
          description="Générer les dettes manquantes à partir des barèmes de chaque classe."
          badge={`${balanceRows.length}`}
        />
        <QuickLinkCard
          href="/admin/finance/payments"
          icon={<CreditCard className="h-5 w-5" />}
          title="Encaissements"
          description="Enregistrer manuellement les règlements reçus par l’établissement."
          badge={`${postedReceipts.length}`}
        />
        <QuickLinkCard
          href="/admin/finance/receipts"
          icon={<Receipt className="h-5 w-5" />}
          title="Reçus"
          description="Consulter l’historique des reçus et la ventilation des paiements."
          badge={`${receiptRows.length}`}
        />
        <QuickLinkCard
          href="/admin/finance/arrears"
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Impayés"
          description="Suivre les soldes dus, les retards et les échéances dépassées."
          badge={`${overdueBalances.length}`}
        />
        <QuickLinkCard
          href="/admin/finance/expenses"
          icon={<Wallet className="h-5 w-5" />}
          title="Dépenses"
          description="Saisir et suivre les dépenses internes de l’établissement."
          badge={`${expenseRows.length}`}
        />
        <QuickLinkCard
          href="/admin/finance/reports"
          icon={<TrendingUp className="h-5 w-5" />}
          title="Rapports"
          description="Voir les synthèses financières et répartitions par classe ou catégorie."
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <School2 className="h-4 w-4 text-emerald-600" />
            Classes avec le plus d’impayés
          </div>

          {chargesByClass.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucune dette ouverte pour le moment.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {chargesByClass.map((row) => (
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
                        {row.level ? `${row.level} • ` : ""}
                        {row.academicYear || "—"} • {row.count} dette(s)
                        {row.overdue > 0 ? ` • ${row.overdue} échue(s)` : ""}
                      </div>
                    </div>

                    <div className="rounded-full bg-rose-50 px-3 py-1.5 text-sm font-bold text-rose-700 ring-1 ring-rose-200">
                      {formatMoney(row.due)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Dettes prioritaires
          </div>

          {recentArrears.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucune priorité à signaler.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {recentArrears.map((row) => {
                const student = studentMap.get(row.student_id);
                const cls = row.class_id ? classMap.get(row.class_id) : null;
                const overdue =
                  !!row.due_date &&
                  new Date(`${row.due_date}T23:59:59`).getTime() < Date.now();

                return (
                  <article
                    key={row.id}
                    className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h2 className="text-lg font-black text-slate-900">
                          {fullName(student)}
                        </h2>
                        <div className="mt-1 text-sm text-slate-600">
                          {cls?.label || "—"} • {row.label}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span
                            className={[
                              "rounded-full px-2.5 py-1 text-xs font-bold ring-1",
                              overdue
                                ? "bg-amber-50 text-amber-700 ring-amber-200"
                                : "bg-slate-100 text-slate-700 ring-slate-200",
                            ].join(" ")}
                          >
                            {overdue ? "Échu" : "Ouvert"}
                          </span>
                          {row.due_date ? (
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                              Échéance : {row.due_date}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-full bg-rose-50 px-3 py-1.5 text-sm font-bold text-rose-700 ring-1 ring-rose-200">
                        {formatMoney(row.balance_due)}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            Derniers reçus
          </div>

          {receiptRows.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucun reçu récent.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {receiptRows.map((row) => {
                const student = studentMap.get(row.student_id);
                return (
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
                          {fullName(student)} •{" "}
                          {new Date(row.payment_date).toLocaleString("fr-FR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                          {row.payer_name ? ` • ${row.payer_name}` : ""}
                        </div>
                      </div>
                      <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">
                        {formatMoney(row.total_amount)}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            Dernières dépenses
          </div>

          {expenseRows.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucune dépense récente.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {expenseRows.map((row) => (
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
                        {row.expense_date}
                        {row.beneficiary ? ` • ${row.beneficiary}` : ""}
                      </div>
                    </div>
                    <div className="rounded-full bg-rose-50 px-3 py-1.5 text-sm font-bold text-rose-700 ring-1 ring-rose-200">
                      {formatMoney(row.amount)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}