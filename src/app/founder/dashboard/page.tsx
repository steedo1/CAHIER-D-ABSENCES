// src/app/founder/dashboard/page.tsx
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarCheck2,
  Receipt,
  School2,
  UsersRound,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type InstitutionRow = {
  id: string;
  name: string | null;
};

type QueryResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
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

export default async function FounderDashboardPage() {
  const { service, institutionIds, institutions } = await getFounderContext();
  const today = todayYmd();
  const startIso = `${today}T00:00:00.000Z`;
  const endIso = `${today}T23:59:59.999Z`;

  const [enrollments, sessions, periods, receipts, expenses] = await Promise.all([
    safeData<any[]>(
      "class_enrollments",
      service
        .from("class_enrollments")
        .select("id,institution_id", { count: "exact", head: false })
        .in("institution_id", institutionIds)
        .eq("start_date", today),
      [],
    ),
    safeData<any[]>(
      "teacher_sessions",
      service
        .from("teacher_sessions")
        .select("id,institution_id,started_at,ended_at", { count: "exact", head: false })
        .in("institution_id", institutionIds)
        .gte("started_at", startIso)
        .lte("started_at", endIso),
      [],
    ),
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
        .select("id,school_id,total_amount,receipt_status,payment_date")
        .in("school_id", institutionIds)
        .eq("receipt_status", "posted")
        .eq("payment_date", today),
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
        .eq("expense_date", today),
      [],
    ),
  ]);

  const totalReceipts = receipts.reduce((sum: number, row: any) => sum + Number(row.total_amount || 0), 0);
  const totalExpenses = expenses.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  const net = totalReceipts - totalExpenses;

  const rows = institutions.map((school) => {
    const schoolId = school.id;
    const schoolReceipts = receipts.filter((row: any) => row.school_id === schoolId);
    const schoolExpenses = expenses.filter((row: any) => row.school_id === schoolId);
    const schoolSessions = sessions.filter((row: any) => row.institution_id === schoolId);
    const schoolEnrollments = enrollments.filter((row: any) => row.institution_id === schoolId);
    const schoolPeriods = periods.filter((row: any) => row.institution_id === schoolId);
    const receiptTotal = schoolReceipts.reduce((sum: number, row: any) => sum + Number(row.total_amount || 0), 0);
    const expenseTotal = schoolExpenses.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);

    return {
      school,
      receiptTotal,
      expenseTotal,
      net: receiptTotal - expenseTotal,
      receiptsCount: schoolReceipts.length,
      expensesCount: schoolExpenses.length,
      sessionsCount: schoolSessions.length,
      enrollmentsCount: schoolEnrollments.length,
      periodsCount: schoolPeriods.length,
    };
  });

  const statCards = [
    { label: "Écoles suivies", value: institutions.length, hint: "Établissements rattachés", Icon: School2 },
    { label: "Encaissements", value: money(totalReceipts), hint: `${receipts.length} reçu(s) aujourd’hui`, Icon: Receipt },
    { label: "Dépenses", value: money(totalExpenses), hint: `${expenses.length} dépense(s) aujourd’hui`, Icon: Wallet },
    { label: "Solde du jour", value: money(net), hint: "Encaissements moins dépenses", Icon: Activity },
    { label: "Appels détectés", value: sessions.length, hint: "Séances ouvertes aujourd’hui", Icon: CalendarCheck2 },
    { label: "Mouvements élèves", value: enrollments.length, hint: "Affectations du jour", Icon: UsersRound },
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
            Synthèse consolidée de la finance, des créneaux et de l’activité du jour pour les établissements rattachés.
          </p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {statCards.map(({ label, value, hint, Icon }) => (
          <div key={label} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
                <div className="mt-2 truncate text-2xl font-black text-slate-950">{value}</div>
                <div className="mt-1 text-xs font-medium leading-5 text-slate-500">{hint}</div>
              </div>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700">
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <Building2 className="h-4 w-4" />
                Écoles rattachées
              </div>
              <p className="mt-1 text-sm text-slate-500">Lecture consolidée par établissement pour aujourd’hui.</p>
            </div>
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">
              {today}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                Aucune école trouvée pour ce compte fondateur.
              </div>
            ) : (
              rows.map(({ school, receiptTotal, expenseTotal, net, sessionsCount, periodsCount }) => (
                <div key={school.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="font-black text-slate-950">{school.name || "Établissement"}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{school.id}</div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white p-3">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
                        <ArrowUpRight className="h-4 w-4" /> Encaissé
                      </div>
                      <div className="mt-1 text-lg font-black text-slate-950">{money(receiptTotal)}</div>
                    </div>
                    <div className="rounded-2xl bg-white p-3">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-amber-700">
                        <ArrowDownRight className="h-4 w-4" /> Dépensé
                      </div>
                      <div className="mt-1 text-lg font-black text-slate-950">{money(expenseTotal)}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                    <span className="rounded-full bg-white px-3 py-1">Solde : {money(net)}</span>
                    <span className="rounded-full bg-white px-3 py-1">Appels : {sessionsCount}</span>
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
              <p className="mt-1 text-xs leading-5 text-emerald-800">Solde journalier consolidé sur toutes les écoles.</p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.15em] text-sky-700">Créneaux</div>
              <div className="mt-2 text-2xl font-black text-sky-900">{periods.length}</div>
              <p className="mt-1 text-xs leading-5 text-sky-800">Créneaux actifs configurés dans les écoles suivies.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">Notifications</div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Les notifications du fondateur restent concentrées sur les événements financiers importants et les bilans.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
