// src/app/drenaet/presence-enseignants/page.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Loader2,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  UserX,
} from "lucide-react";

type PresenceStatus = "stable" | "watch" | "critical" | "silent" | "no_schedule";

type PresenceRow = {
  institution_id: string;
  institution_name: string;
  regional_direction: string;
  scheduled: number;
  opened: number;
  ended: number;
  not_ended: number;
  not_opened: number;
  permission_approved: number;
  permission_pending: number;
  absent_unjustified: number;
  teachers_seen: number;
  presence_rate: number;
  closure_rate: number;
  completion_rate: number;
  status: PresenceStatus;
};

type DailyRow = {
  date: string;
  scheduled: number;
  opened: number;
  ended: number;
  not_ended: number;
  not_opened: number;
  permission_approved: number;
  permission_pending: number;
  absent_unjustified: number;
  presence_rate: number;
  closure_rate: number;
  completion_rate: number;
};

type AlertRow = {
  institution_id: string;
  institution_name: string;
  severity: "critical" | "warning" | string;
  type: string;
  message: string;
  scheduled: number;
  presence_rate: number;
  absent_unjustified: number;
};

type PresencePayload = {
  ok: boolean;
  range: { fromYmd: string; toYmd: string };
  definitions?: Record<string, string>;
  totals: {
    scheduled: number;
    opened: number;
    ended: number;
    not_ended: number;
    not_opened: number;
    permission_approved: number;
    permission_pending: number;
    absent_unjustified: number;
    teachers_seen: number;
    presence_rate: number;
    closure_rate: number;
    completion_rate: number;
  };
  daily: DailyRow[];
  alerts: AlertRow[];
  items: PresenceRow[];
};

type TrendPoint = {
  label: string;
  scheduled: number;
  opened: number;
  ended: number;
  not_ended: number;
  not_opened: number;
  absent_unjustified: number;
  permission_approved: number;
  presence_rate: number;
  closure_rate: number;
};

const STATUS_LABEL: Record<PresenceStatus, string> = {
  stable: "Stable",
  watch: "À surveiller",
  critical: "Critique",
  silent: "Silencieux",
  no_schedule: "Aucun EDT",
};

const STATUS_CLASS: Record<PresenceStatus, string> = {
  stable: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  watch: "bg-amber-50 text-amber-700 ring-amber-100",
  critical: "bg-red-50 text-red-700 ring-red-100",
  silent: "bg-slate-900 text-white ring-slate-900",
  no_schedule: "bg-slate-100 text-slate-600 ring-slate-200",
};

function nf(value: number | undefined | null) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function pf(value: number | undefined | null) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(Number(value || 0))}%`;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function minusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function parseYmd(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function diffDays(from: string, to: string) {
  const a = parseYmd(from).getTime();
  const b = parseYmd(to).getTime();
  return Math.max(1, Math.round(Math.abs(b - a) / 86400000) + 1);
}

function shortDate(ymd: string) {
  const [, month, day] = ymd.split("-");
  return `${day}/${month}`;
}

function monthLabel(ymd: string) {
  const [year, month] = ymd.split("-");
  return `${month}/${year.slice(2)}`;
}

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function weekKey(ymd: string) {
  const d = parseYmd(ymd);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-S${String(week).padStart(2, "0")}`;
}

function aggregateTrend(daily: DailyRow[], from: string, to: string) {
  const days = diffDays(from, to);
  const mode: "jour" | "semaine" | "mois" = days <= 18 ? "jour" : days <= 120 ? "semaine" : "mois";
  const map = new Map<string, TrendPoint>();

  for (const day of daily || []) {
    if (!day.scheduled) continue;
    const key = mode === "jour" ? day.date : mode === "semaine" ? weekKey(day.date) : day.date.slice(0, 7);
    const label = mode === "jour" ? shortDate(day.date) : mode === "semaine" ? key.replace("-", " ") : monthLabel(`${key}-01`);
    const current = map.get(key) || {
      label,
      scheduled: 0,
      opened: 0,
      ended: 0,
      not_ended: 0,
      not_opened: 0,
      absent_unjustified: 0,
      permission_approved: 0,
      presence_rate: 0,
      closure_rate: 0,
    };

    current.scheduled += day.scheduled;
    current.opened += day.opened;
    current.ended += day.ended;
    current.not_ended += day.not_ended;
    current.not_opened += day.not_opened;
    current.absent_unjustified += day.absent_unjustified;
    current.permission_approved += day.permission_approved;
    map.set(key, current);
  }

  const points = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => ({
      ...point,
      presence_rate: pct(point.opened, point.scheduled),
      closure_rate: pct(point.ended, point.opened),
    }));

  return { mode, points };
}

function StatCard({ title, value, subtitle, icon }: { title: string; value: string; subtitle?: string; icon: ReactNode }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
          {subtitle ? <p className="mt-1 text-xs font-medium text-slate-400">{subtitle}</p> : null}
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

function RateBar({ value }: { value: number }) {
  const width = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-slate-900" style={{ width: `${width}%` }} />
    </div>
  );
}

function DistributionBar({ totals }: { totals: PresencePayload["totals"] }) {
  const total = Math.max(1, totals.scheduled || 0);
  const opened = Math.max(0, Math.min(100, (totals.opened / total) * 100));
  const permission = Math.max(0, Math.min(100, (totals.permission_approved / total) * 100));
  const absent = Math.max(0, 100 - opened - permission);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">Répartition administrative des cours</h2>
          <p className="mt-1 text-sm text-slate-500">Présences déclarées, permissionnaires et absences à vérifier.</p>
        </div>
        <BarChart3 className="h-5 w-5 text-slate-400" />
      </div>

      <div className="mt-5 flex h-4 overflow-hidden rounded-full bg-slate-100">
        <div className="bg-emerald-500" style={{ width: `${opened}%` }} />
        <div className="bg-sky-500" style={{ width: `${permission}%` }} />
        <div className="bg-red-500" style={{ width: `${absent}%` }} />
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
          <p className="font-black">{nf(totals.opened)}</p>
          <p className="text-xs font-semibold">Présences déclarées</p>
        </div>
        <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
          <p className="font-black">{nf(totals.permission_approved)}</p>
          <p className="text-xs font-semibold">Abs. autorisées</p>
        </div>
        <div className="rounded-2xl bg-red-50 p-3 text-red-700">
          <p className="font-black">{nf(totals.absent_unjustified)}</p>
          <p className="text-xs font-semibold">Abs. à justifier</p>
        </div>
      </div>
    </div>
  );
}

function CompletionBar({ totals }: { totals: PresencePayload["totals"] }) {
  const opened = Math.max(1, totals.opened || 0);
  const ended = Math.max(0, Math.min(100, (totals.ended / opened) * 100));
  const notEnded = Math.max(0, 100 - ended);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">Suivi de clôture</h2>
          <p className="mt-1 text-sm text-slate-500">Parmi les cours ouverts : clôturés ou non clôturés.</p>
        </div>
        <CheckCircle2 className="h-5 w-5 text-slate-400" />
      </div>

      <div className="mt-5 flex h-4 overflow-hidden rounded-full bg-slate-100">
        <div className="bg-indigo-500" style={{ width: `${ended}%` }} />
        <div className="bg-amber-400" style={{ width: `${notEnded}%` }} />
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-700">
          <p className="font-black">{nf(totals.ended)}</p>
          <p className="text-xs font-semibold">Cours clôturés</p>
        </div>
        <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
          <p className="font-black">{nf(totals.not_ended)}</p>
          <p className="text-xs font-semibold">Cours non clôturés</p>
        </div>
      </div>
    </div>
  );
}

function InstitutionBars({ items }: { items: PresenceRow[] }) {
  const rows = items.filter((item) => item.scheduled > 0).slice(0, 8);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">Taux de présence déclarée par établissement</h2>
          <p className="mt-1 text-sm text-slate-500">Classement des établissements selon les cours ouverts et les absences à justifier.</p>
        </div>
        <TrendingUp className="h-5 w-5 text-slate-400" />
      </div>

      <div className="mt-5 space-y-4">
        {rows.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">
            Aucun cours prévu trouvé sur cette période.
          </p>
        ) : (
          rows.map((item) => (
            <div key={item.institution_id}>
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-bold text-slate-800">{item.institution_name}</span>
                <span className="font-black text-slate-950">{pf(item.presence_rate)}</span>
              </div>
              <RateBar value={item.presence_rate} />
              <div className="mt-1 text-xs text-slate-400">
                {nf(item.opened)} cours ouvert(s) / {nf(item.scheduled)} cours prévu(s)
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TrendChart({ daily, from, to }: { daily: DailyRow[]; from: string; to: string }) {
  const { mode, points } = aggregateTrend(daily, from, to);
  const width = 620;
  const height = 220;
  const padX = 42;
  const padY = 28;
  const avg = points.length ? pct(points.reduce((sum, p) => sum + p.opened, 0), points.reduce((sum, p) => sum + p.scheduled, 0)) : 0;
  const best = points.length ? Math.max(...points.map((p) => p.presence_rate)) : 0;
  const worst = points.length ? Math.min(...points.map((p) => p.presence_rate)) : 0;

  const coords = points.map((point, index) => {
    const x = points.length <= 1 ? width / 2 : padX + (index * (width - padX * 2)) / Math.max(1, points.length - 1);
    const y = height - padY - (Math.max(0, Math.min(100, point.presence_rate)) * (height - padY * 2)) / 100;
    return { x, y, point };
  });

  const path = coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`).join(" ");
  const labelStep = points.length <= 8 ? 1 : Math.ceil(points.length / 8);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-950">Évolution du taux de présence déclarée</h2>
          <p className="mt-1 text-sm text-slate-500">
            Lecture {mode === "jour" ? "journalière" : mode === "semaine" ? "hebdomadaire" : "mensuelle"} adaptée à la période sélectionnée.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-2xl bg-slate-50 px-3 py-2"><p className="font-black text-slate-950">{pf(avg)}</p><p className="text-slate-500">Moyenne</p></div>
          <div className="rounded-2xl bg-emerald-50 px-3 py-2"><p className="font-black text-emerald-700">{pf(best)}</p><p className="text-emerald-700/70">Meilleur</p></div>
          <div className="rounded-2xl bg-red-50 px-3 py-2"><p className="font-black text-red-700">{pf(worst)}</p><p className="text-red-700/70">Plus faible</p></div>
        </div>
      </div>

      {points.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">
          Aucune donnée exploitable pour afficher l’évolution.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="min-w-[620px]">
            {[0, 25, 50, 75, 100].map((tick) => {
              const y = height - padY - (tick * (height - padY * 2)) / 100;
              return (
                <g key={tick}>
                  <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="#e2e8f0" />
                  <text x={8} y={y + 4} fontSize="11" fill="#64748b">{tick}%</text>
                </g>
              );
            })}
            <path d={path} fill="none" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {coords.map((coord, index) => (
              <g key={`${coord.point.label}-${index}`}>
                <circle cx={coord.x} cy={coord.y} r="4" fill="#0f172a" />
                <title>{`${coord.point.label} : ${pf(coord.point.presence_rate)} • ${nf(coord.point.opened)} cours ouvert(s) / ${nf(coord.point.scheduled)} cours`}</title>
                {index % labelStep === 0 || index === coords.length - 1 ? (
                  <text x={coord.x} y={height - 5} textAnchor="middle" fontSize="11" fill="#64748b">
                    {coord.point.label}
                  </text>
                ) : null}
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

export default function DrenaetPresenceEnseignantsPage() {
  const [from, setFrom] = useState(minusDays(6));
  const [to, setTo] = useState(todayYmd());
  const [data, setData] = useState<PresencePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ from, to });
        const res = await fetch(`/api/drenaet/teacher-presence?${params.toString()}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || json?.error || "Erreur de chargement");
        if (alive) setData(json);
      } catch (e: any) {
        if (alive) setError(e?.message || "Erreur inattendue");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [from, to]);

  const items = useMemo(() => data?.items || [], [data]);
  const totals = data?.totals;

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
              <ClipboardList className="h-4 w-4" />
              Contrôle régional des enseignants
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Présence enseignants</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Lecture DRENAET des cours attendus : cours ouverts par les enseignants, absences autorisées, absences à justifier,
              demandes à valider et cours ouverts non clôturés.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-slate-600">
              Du
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none" />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Au
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none" />
            </label>
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          <span className="font-black text-slate-900">Définition DRENAET : </span>
          les compteurs portent sur les <span className="font-bold text-slate-900">cours prévus</span>, pas sur le nombre
          de personnes. Un même enseignant autorisé peut donc couvrir plusieurs cours. Une <span className="font-bold text-slate-900">présence déclarée</span>{" "}
          correspond à un cours ouvert dans Mon Cahier. Une <span className="font-bold text-slate-900">absence autorisée</span>{" "}
          correspond à un cours couvert par une autorisation approuvée. Une <span className="font-bold text-slate-900">absence à justifier</span>{" "}
          correspond à un cours prévu non ouvert et non couvert par une autorisation approuvée ou en attente.
        </div>
      </section>

      {loading ? (
        <div className="flex min-h-[360px] items-center justify-center gap-3 rounded-[28px] border border-slate-200 bg-white text-sm font-semibold text-slate-600 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin" />
          Chargement de la présence enseignants...
        </div>
      ) : error ? (
        <div className="rounded-[28px] border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>
      ) : !data || !totals ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">Aucune donnée disponible.</div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Cours prévus" value={nf(totals.scheduled)} subtitle="Selon les emplois du temps" icon={<ClipboardList className="h-5 w-5" />} />
            <StatCard title="Présences déclarées" value={nf(totals.opened)} subtitle="Cours ouverts par enseignants" icon={<UserCheck className="h-5 w-5" />} />
            <StatCard title="Abs. autorisées" value={nf(totals.permission_approved)} subtitle="Cours couverts par autorisation" icon={<ShieldCheck className="h-5 w-5" />} />
            <StatCard title="Abs. à justifier" value={nf(totals.absent_unjustified)} subtitle="Cours prévus non ouverts" icon={<UserX className="h-5 w-5" />} />
            <StatCard title="Clôturés" value={nf(totals.ended)} subtitle="Cours ouverts par enseignants puis clôturées" icon={<CheckCircle2 className="h-5 w-5" />} />
            <StatCard title="Non clôturés" value={nf(totals.not_ended)} subtitle="Cours ouverts non clôturés" icon={<AlertTriangle className="h-5 w-5" />} />
            <StatCard title="Demandes à valider" value={nf(totals.permission_pending)} subtitle="Cours couverts par demande en attente" icon={<Clock3 className="h-5 w-5" />} />
            <StatCard title="Taux de présence déclarée" value={pf(totals.presence_rate)} subtitle="Cours ouverts / cours prévus" icon={<TrendingUp className="h-5 w-5" />} />
          </section>

          {data.alerts.length > 0 ? (
            <section className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-5 w-5" />
                <h2 className="text-lg font-black">Alertes administratives DRENAET</h2>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {data.alerts.map((alert) => (
                  <div key={`${alert.institution_id}-${alert.type}`} className="rounded-2xl bg-white p-4 text-sm shadow-sm">
                    <p className="font-black text-slate-900">{alert.institution_name}</p>
                    <p className="mt-1 leading-6 text-slate-600">{alert.message}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-5 xl:grid-cols-2">
            <DistributionBar totals={totals} />
            <CompletionBar totals={totals} />
          </section>

          <TrendChart daily={data.daily} from={from} to={to} />
          <InstitutionBars items={items} />

          <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-lg font-black text-slate-950">Détail par établissement</h2>
              <p className="mt-1 text-sm text-slate-500">
                Classement orienté contrôle : cours ouverts, absences autorisées, absences à justifier et clôture des séances.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Établissement</th>
                    <th className="px-4 py-3 text-right">Cours prévus</th>
                    <th className="px-4 py-3 text-right">Cours ouverts</th>
                    <th className="px-4 py-3 text-right">Clôturés</th>
                    <th className="px-4 py-3 text-right">Non clôturés</th>
                    <th className="px-4 py-3 text-right">Abs. autorisées</th>
                    <th className="px-4 py-3 text-right">Abs. à justifier</th>
                    <th className="px-4 py-3 text-right">Taux</th>
                    <th className="px-4 py-3 text-right">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-slate-500" colSpan={9}>Aucun établissement rattaché au périmètre DRENAET.</td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.institution_id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <p className="font-black text-slate-900">{item.institution_name}</p>
                          <p className="text-xs text-slate-500">{item.regional_direction || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-bold">{nf(item.scheduled)}</td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-700">{nf(item.opened)}</td>
                        <td className="px-4 py-3 text-right font-bold text-indigo-700">{nf(item.ended)}</td>
                        <td className="px-4 py-3 text-right font-bold text-amber-700">{nf(item.not_ended)}</td>
                        <td className="px-4 py-3 text-right font-bold text-sky-700">{nf(item.permission_approved)}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-700">{nf(item.absent_unjustified)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="ml-auto w-28">
                            <div className="mb-1 text-right font-black">{pf(item.presence_rate)}</div>
                            <RateBar value={item.presence_rate} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ring-1 ${STATUS_CLASS[item.status]}`}>
                            {STATUS_LABEL[item.status]}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
