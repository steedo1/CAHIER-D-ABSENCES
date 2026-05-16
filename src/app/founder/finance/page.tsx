// src/app/founder/finance/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Landmark,
  Receipt,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type QueryResult<T> = { data: T | null; error: { message?: string } | null };
type SearchParams = Record<string, string | string[] | undefined>;
type PeriodKey = "today" | "week" | "month" | "custom";

type PageProps = {
  searchParams?: SearchParams | Promise<SearchParams>;
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
        .gte("expense_date", selectedPeriod.startYmd)
        .lt("expense_date", selectedPeriod.endExclusiveYmd),
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
    <div className="space-y-4 sm:space-y-5">
      <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">
              Finance fondateur
            </p>
            <h1 className="mt-1 text-xl font-black tracking-tight text-slate-950 sm:text-2xl">
              Synthèse financière multi-écoles
            </h1>
            <p className="mt-1 text-xs font-semibold text-slate-500 sm:text-sm">
              {selectedPeriod.label} · {selectedPeriod.detail}
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

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[24px] border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">
            <ArrowUpRight className="h-4 w-4" /> Encaissements
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-900 sm:text-3xl">{money(totalReceipts)}</div>
          <p className="mt-1 text-xs font-semibold text-emerald-800">{receipts.length} reçu(s) posté(s)</p>
        </div>

        <div className="rounded-[24px] border border-amber-100 bg-amber-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-amber-700">
            <ArrowDownRight className="h-4 w-4" /> Dépenses
          </div>
          <div className="mt-2 text-2xl font-black text-amber-900 sm:text-3xl">{money(totalExpenses)}</div>
          <p className="mt-1 text-xs font-semibold text-amber-800">{expenses.length} dépense(s) postée(s)</p>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
            <Landmark className="h-4 w-4" /> Solde net
          </div>
          <div className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">{money(net)}</div>
          <p className="mt-1 text-xs font-semibold text-slate-500">Encaissements moins dépenses</p>
        </div>
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
          rows.map(({ school, totalReceipts, totalExpenses, net, receiptsCount, expensesCount }) => (
            <div key={school.id} className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate font-black text-slate-950">{school.name || "Établissement"}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{school.id}</div>
                </div>
                <div className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                  {selectedPeriod.label}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3 sm:gap-3">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 sm:p-4">
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-700">
                    <Receipt className="h-4 w-4" /> Encaissements
                  </div>
                  <div className="mt-2 text-xl font-black text-emerald-800 sm:text-2xl">{money(totalReceipts)}</div>
                  <div className="mt-1 text-xs text-emerald-700">{receiptsCount} reçu(s)</div>
                </div>

                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 sm:p-4">
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-amber-700">
                    <Wallet className="h-4 w-4" /> Dépenses
                  </div>
                  <div className="mt-2 text-xl font-black text-amber-800 sm:text-2xl">{money(totalExpenses)}</div>
                  <div className="mt-1 text-xs text-amber-700">{expensesCount} dépense(s)</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Solde</div>
                  <div className="mt-2 text-xl font-black text-slate-950 sm:text-2xl">{money(net)}</div>
                  <div className="mt-1 text-xs text-slate-500">Période sélectionnée</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
