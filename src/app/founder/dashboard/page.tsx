// src/app/founder/dashboard/page.tsx
import { redirect } from "next/navigation";
import { Building2, CalendarCheck2, Receipt, School2, UserPlus, Wallet } from "lucide-react";
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

  const [enrollments, sessions, receipts, expenses] = await Promise.all([
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
        .select("id,institution_id", { count: "exact", head: false })
        .in("institution_id", institutionIds)
        .gte("started_at", startIso)
        .lte("started_at", endIso),
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

  const statCards = [
    { label: "Écoles suivies", value: institutions.length, hint: "Établissements rattachés", Icon: School2 },
    { label: "Inscriptions du jour", value: enrollments.length, hint: today, Icon: UserPlus },
    { label: "Appels ouverts", value: sessions.length, hint: "Séances détectées aujourd’hui", Icon: CalendarCheck2 },
    { label: "Encaissements", value: money(totalReceipts), hint: "Paiements postés aujourd’hui", Icon: Receipt },
    { label: "Dépenses", value: money(totalExpenses), hint: "Dépenses postées aujourd’hui", Icon: Wallet },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-6 text-white shadow-xl">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-200">
            Pilotage fondateur
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Vue globale de vos écoles
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-200">
            Suivi consolidé des inscriptions, de l’activité par créneau et de la gestion financière.
          </p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {statCards.map(({ label, value, hint, Icon }) => (
          <div key={label} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
                <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
                <div className="mt-1 text-xs font-medium text-slate-500">{hint}</div>
              </div>
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-700">
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
          <Building2 className="h-4 w-4" />
          Écoles rattachées
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {institutions.length === 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
              Aucune école trouvée pour ce compte fondateur.
            </div>
          ) : (
            institutions.map((school) => (
              <div key={school.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="font-black text-slate-950">{school.name || "Établissement"}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {school.id}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
