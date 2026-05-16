// src/app/founder/finance/page.tsx
import { redirect } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Landmark, Receipt, Wallet } from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type QueryResult<T> = { data: T | null; error: { message?: string } | null };

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
      console.warn(`[founder/finance] ${label}:`, res.error.message || res.error);
      return fallback;
    }
    return (res?.data ?? fallback) as T;
  } catch (e: any) {
    console.warn(`[founder/finance] ${label}:`, e?.message || e);
    return fallback;
  }
}

export default async function FounderFinancePage() {
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

  const today = todayYmd();

  const [institutions, receipts, expenses] = await Promise.all([
    safeData<any[]>(
      "institutions",
      service.from("institutions").select("id,name").in("id", institutionIds).order("name"),
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

  const rows = (institutions ?? []).map((school: any) => {
    const schoolReceipts = (receipts ?? []).filter((r: any) => r.school_id === school.id);
    const schoolExpenses = (expenses ?? []).filter((e: any) => e.school_id === school.id);
    const totalReceipts = schoolReceipts.reduce((sum: number, r: any) => sum + Number(r.total_amount || 0), 0);
    const totalExpenses = schoolExpenses.reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);
    return {
      school,
      totalReceipts,
      totalExpenses,
      net: totalReceipts - totalExpenses,
      receiptsCount: schoolReceipts.length,
      expensesCount: schoolExpenses.length,
    };
  });

  const totalReceipts = rows.reduce((sum, row) => sum + row.totalReceipts, 0);
  const totalExpenses = rows.reduce((sum, row) => sum + row.totalExpenses, 0);
  const net = totalReceipts - totalExpenses;

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">Finance fondateur</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
          Synthèse financière multi-écoles
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">
          Vue stratégique des encaissements, dépenses et soldes journaliers des écoles rattachées.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-[28px] border border-emerald-100 bg-emerald-50 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
            <ArrowUpRight className="h-4 w-4" /> Total encaissé
          </div>
          <div className="mt-3 text-3xl font-black text-emerald-900">{money(totalReceipts)}</div>
          <p className="mt-1 text-xs font-semibold text-emerald-800">{receipts.length} reçu(s) posté(s) aujourd’hui</p>
        </div>

        <div className="rounded-[28px] border border-amber-100 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            <ArrowDownRight className="h-4 w-4" /> Total dépensé
          </div>
          <div className="mt-3 text-3xl font-black text-amber-900">{money(totalExpenses)}</div>
          <p className="mt-1 text-xs font-semibold text-amber-800">{expenses.length} dépense(s) postée(s) aujourd’hui</p>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
            <Landmark className="h-4 w-4" /> Solde net
          </div>
          <div className="mt-3 text-3xl font-black text-slate-950">{money(net)}</div>
          <p className="mt-1 text-xs font-semibold text-slate-500">Encaissements moins dépenses</p>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {rows.length === 0 ? (
          <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800">
            Aucune école rattachée trouvée pour ce compte fondateur.
          </div>
        ) : (
          rows.map(({ school, totalReceipts, totalExpenses, net, receiptsCount, expensesCount }) => (
            <div key={school.id} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="font-black text-slate-950">{school.name || "Établissement"}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{school.id}</div>
                </div>
                <div className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                  {today}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                    <Receipt className="h-4 w-4" /> Encaissements
                  </div>
                  <div className="mt-2 text-2xl font-black text-emerald-800">{money(totalReceipts)}</div>
                  <div className="mt-1 text-xs text-emerald-700">{receiptsCount} reçu(s)</div>
                </div>

                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-amber-700">
                    <Wallet className="h-4 w-4" /> Dépenses
                  </div>
                  <div className="mt-2 text-2xl font-black text-amber-800">{money(totalExpenses)}</div>
                  <div className="mt-1 text-xs text-amber-700">{expensesCount} dépense(s)</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Solde</div>
                  <div className="mt-2 text-2xl font-black text-slate-950">{money(net)}</div>
                  <div className="mt-1 text-xs text-slate-500">Lecture journalière</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
