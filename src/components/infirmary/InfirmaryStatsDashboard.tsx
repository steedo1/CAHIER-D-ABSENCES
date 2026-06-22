// src/components/infirmary/InfirmaryStatsDashboard.tsx
"use client";

import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import {
  Activity,
  Bell,
  CalendarDays,
  Clock3,
  HeartPulse,
  Loader2,
  RefreshCw,
  Stethoscope,
  UserRoundCheck,
} from "lucide-react";

type RecentVisit = {
  id: string;
  receipt_code: string;
  visit_date: string;
  entry_time: string | null;
  exit_time: string | null;
  duration_minutes: number | null;
  reason_category: string | null;
  condition_description: string | null;
  rest_start_date: string | null;
  rest_end_date: string | null;
  rest_days: number | null;
  status: string | null;
  parent_notified: boolean | null;
  student_name: string;
  class_label: string | null;
};

type StatsResponse = {
  ok?: boolean;
  error?: string;
  period?: { start: string; end: string; today: string };
  totals?: {
    visits: number;
    today: number;
    open: number;
    active_rest: number;
    notified: number;
    evacuated: number;
    average_duration_minutes: number;
  };
  by_reason?: Array<{ key: string; label: string; count: number }>;
  recent?: RecentVisit[];
};

type Props = {
  audience?: "admin" | "founder";
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartYmd(ymd: string) {
  return `${ymd.slice(0, 8)}01`;
}

function formatDateFr(ymd?: string | null) {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function timeLabel(entry?: string | null, exit?: string | null) {
  const e = entry ? String(entry).slice(0, 5) : "—";
  const x = exit ? String(exit).slice(0, 5) : "en cours";
  return `${e} → ${x}`;
}

function durationLabel(minutes?: number | null) {
  const n = Number(minutes || 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return `${h} h ${m} min`;
}

function restLabel(row: RecentVisit) {
  if (!row?.rest_start_date || !row?.rest_end_date) return "Aucun repos";
  const days = Number(row.rest_days || 0);
  return `Repos du ${formatDateFr(row.rest_start_date)} au ${formatDateFr(row.rest_end_date)}${days > 0 ? ` (${days} j)` : ""}`;
}

function StatCard({
  label,
  value,
  hint,
  Icon,
}: {
  label: string;
  value: string | number;
  hint: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{label}</div>
          <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
          <div className="mt-1 text-sm text-slate-500">{hint}</div>
        </div>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

export default function InfirmaryStatsDashboard({ audience = "admin" }: Props) {
  const today = todayYmd();
  const [start, setStart] = useState(monthStartYmd(today));
  const [end, setEnd] = useState(today);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    return params.toString();
  }, [start, end]);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/admin/infirmary/stats?${query}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as StatsResponse;
      if (!res.ok || !json.ok) throw new Error(json.error || "Impossible de charger les statistiques.");
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Erreur de chargement.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const totals = data?.totals || {
    visits: 0,
    today: 0,
    open: 0,
    active_rest: 0,
    notified: 0,
    evacuated: 0,
    average_duration_minutes: 0,
  };

  const title = audience === "founder" ? "Dashboard Infirmerie" : "Tableau de bord Infirmerie";
  const subtitle =
    audience === "founder"
      ? "Vue synthétique des passages à l’infirmerie, repos accordés et alertes parents."
      : "Suivi des passages, billets émis, repos accordés et notifications parents.";
  const ticketsHref = audience === "founder" ? "/founder/infirmerie" : "/admin/infirmerie";

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-emerald-100 bg-gradient-to-br from-emerald-700 via-emerald-600 to-slate-900 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ring-1 ring-white/15">
              <HeartPulse className="h-4 w-4" /> Module Infirmerie
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50/90">{subtitle}</p>
          </div>

          <div className="flex flex-col gap-2 rounded-3xl bg-white/10 p-3 ring-1 ring-white/15 sm:flex-row sm:items-end">
            <label className="text-xs font-bold text-emerald-50">
              Du
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1 block rounded-2xl border border-white/20 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none"
              />
            </label>
            <label className="text-xs font-bold text-emerald-50">
              Au
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-1 block rounded-2xl border border-white/20 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none"
              />
            </label>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-black text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Actualiser
            </button>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Passages" value={totals.visits} hint="Sur la période choisie" Icon={Stethoscope} />
        <StatCard label="Aujourd’hui" value={totals.today} hint="Passages du jour" Icon={CalendarDays} />
        <StatCard label="En observation" value={totals.open} hint="Sortie non clôturée" Icon={Activity} />
        <StatCard label="Repos actifs" value={totals.active_rest} hint="Élèves en repos aujourd’hui" Icon={UserRoundCheck} />
        <StatCard label="Parents alertés" value={totals.notified} hint="Billets avec notification créée" Icon={Bell} />
        <StatCard label="Évacuations" value={totals.evacuated} hint="Cas marqués évacués" Icon={HeartPulse} />
        <StatCard label="Durée moyenne" value={durationLabel(totals.average_duration_minutes)} hint="Temps moyen de passage" Icon={Clock3} />
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Action rapide</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">Créer un billet d’infirmerie ou consulter l’historique des passages.</p>
          <Link
            href={ticketsHref}
            className="mt-4 inline-flex rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700"
          >
            Ouvrir les billets
          </Link>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Motifs fréquents</h2>
          <div className="mt-4 space-y-3">
            {(data?.by_reason || []).length ? (
              (data?.by_reason || []).map((item) => {
                const max = Math.max(...(data?.by_reason || []).map((r) => r.count), 1);
                const width = Math.max(8, Math.round((item.count / max) * 100));
                return (
                  <div key={item.key}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="font-bold text-slate-700">{item.label}</span>
                      <span className="font-black text-slate-950">{item.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Aucun passage sur la période.</div>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-black text-slate-950">Derniers billets</h2>
            <Link href={ticketsHref} className="text-sm font-black text-emerald-700 hover:text-emerald-800">
              Voir tout
            </Link>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
            {(data?.recent || []).length ? (
              <div className="divide-y divide-slate-100">
                {(data?.recent || []).map((row) => (
                  <div key={row.id} className="grid gap-2 p-4 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-slate-950">{row.student_name}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{row.class_label || "Classe non définie"}</span>
                        {row.parent_notified ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">Parent alerté</span> : null}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {formatDateFr(row.visit_date)} • {timeLabel(row.entry_time, row.exit_time)} • {row.condition_description || "Constat non renseigné"}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-amber-700">{restLabel(row as any)}</div>
                    </div>
                    <div className="text-left md:text-right">
                      <div className="text-sm font-black text-emerald-700">{row.receipt_code}</div>
                      <div className="text-xs text-slate-500">{durationLabel(row.duration_minutes)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-slate-500">Aucun billet récent.</div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
