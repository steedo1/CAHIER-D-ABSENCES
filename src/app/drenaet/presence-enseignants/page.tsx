// src/app/drenaet/presence-enseignants/page.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Loader2,
  TrendingUp,
  XCircle,
} from "lucide-react";

type PresenceStatus = "stable" | "watch" | "critical" | "silent" | "no_schedule";

type PresenceRow = {
  institution_id: string;
  institution_name: string;
  regional_direction: string;
  scheduled: number;
  opened: number;
  held: number;
  not_held: number;
  incomplete: number;
  teachers_seen: number;
  held_rate: number;
  opening_rate: number;
  status: PresenceStatus;
};

type DailyRow = {
  date: string;
  scheduled: number;
  opened: number;
  held: number;
  not_held: number;
  incomplete: number;
  held_rate: number;
  opening_rate: number;
};

type AlertRow = {
  institution_id: string;
  institution_name: string;
  severity: "critical" | "warning" | string;
  type: string;
  message: string;
  scheduled: number;
  held_rate: number;
  not_held: number;
};

type PresencePayload = {
  ok: boolean;
  range: { fromYmd: string; toYmd: string };
  definitions?: Record<string, string>;
  totals: {
    scheduled: number;
    opened: number;
    held: number;
    not_held: number;
    incomplete: number;
    teachers_seen: number;
    held_rate: number;
    opening_rate: number;
  };
  daily: DailyRow[];
  alerts: AlertRow[];
  items: PresenceRow[];
};

function nf(value: number | undefined | null) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function pf(value: number | undefined | null) {
  return `${nf(Number(value || 0))}%`;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function minusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function shortDate(ymd: string) {
  const [, month, day] = ymd.split("-");
  return `${day}/${month}`;
}

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

function StatCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: ReactNode;
}) {
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
  const held = Math.max(0, Math.min(100, (totals.held / total) * 100));
  const incomplete = Math.max(0, Math.min(100, (totals.incomplete / total) * 100));
  const notHeld = Math.max(0, 100 - held - incomplete);

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">Répartition des séances</h2>
          <p className="mt-1 text-sm text-slate-500">Tenues, incomplètes et non tenues sur la période.</p>
        </div>
        <BarChart3 className="h-5 w-5 text-slate-400" />
      </div>

      <div className="mt-5 flex h-4 overflow-hidden rounded-full bg-slate-100">
        <div className="bg-emerald-500" style={{ width: `${held}%` }} />
        <div className="bg-amber-400" style={{ width: `${incomplete}%` }} />
        <div className="bg-red-500" style={{ width: `${notHeld}%` }} />
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
          <p className="font-black">{nf(totals.held)}</p>
          <p className="text-xs font-semibold">Séances tenues</p>
        </div>
        <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
          <p className="font-black">{nf(totals.incomplete)}</p>
          <p className="text-xs font-semibold">Incomplètes</p>
        </div>
        <div className="rounded-2xl bg-red-50 p-3 text-red-700">
          <p className="font-black">{nf(totals.not_held)}</p>
          <p className="text-xs font-semibold">Non tenues</p>
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
          <h2 className="text-lg font-black text-slate-950">Taux de tenue par établissement</h2>
          <p className="mt-1 text-sm text-slate-500">Les établissements les plus faibles sont affichés en premier.</p>
        </div>
        <TrendingUp className="h-5 w-5 text-slate-400" />
      </div>

      <div className="mt-5 space-y-4">
        {rows.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">
            Aucune séance prévue trouvée sur cette période.
          </p>
        ) : (
          rows.map((item) => (
            <div key={item.institution_id}>
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-bold text-slate-800">{item.institution_name}</span>
                <span className="font-black text-slate-950">{pf(item.held_rate)}</span>
              </div>
              <RateBar value={item.held_rate} />
              <div className="mt-1 text-xs text-slate-400">
                {nf(item.held)} tenue(s) / {nf(item.scheduled)} prévue(s)
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TrendChart({ daily }: { daily: DailyRow[] }) {
  const points = daily.filter((day) => day.scheduled > 0);
  const width = 520;
  const height = 180;
  const padX = 26;
  const padY = 20;

  const coords = points.map((point, index) => {
    const x =
      points.length <= 1
        ? width / 2
        : padX + (index * (width - padX * 2)) / Math.max(1, points.length - 1);
    const y = height - padY - (Math.max(0, Math.min(100, point.held_rate)) * (height - padY * 2)) / 100;
    return { x, y, point };
  });

  const path = coords
    .map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`)
    .join(" ");

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">Évolution du taux de tenue</h2>
          <p className="mt-1 text-sm text-slate-500">Lecture journalière sur la période sélectionnée.</p>
        </div>
        <Clock3 className="h-5 w-5 text-slate-400" />
      </div>

      {points.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">
          Aucune donnée exploitable pour afficher l’évolution.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="min-w-[520px]">
            <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#e2e8f0" />
            <line x1={padX} y1={padY} x2={padX} y2={height - padY} stroke="#e2e8f0" />
            <path d={path} fill="none" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {coords.map((coord) => (
              <g key={coord.point.date}>
                <circle cx={coord.x} cy={coord.y} r="4" fill="#0f172a" />
                <text x={coord.x} y={height - 4} textAnchor="middle" fontSize="11" fill="#64748b">
                  {shortDate(coord.point.date)}
                </text>
                <text x={coord.x} y={Math.max(12, coord.y - 10)} textAnchor="middle" fontSize="11" fill="#0f172a" fontWeight="700">
                  {pf(coord.point.held_rate)}
                </text>
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
        const res = await fetch(`/api/drenaet/teacher-presence?${params.toString()}`, {
          cache: "no-store",
        });
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
              Pilotage pédagogique régional
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Présence enseignants</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Suivi des séances prévues dans les emplois du temps officiels et comparaison avec les séances réellement
              tenues dans Mon Cahier.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-slate-600">
              Du
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Au
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none"
              />
            </label>
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          <span className="font-black text-slate-900">Définition métier : </span>
          une séance est considérée comme <span className="font-bold text-slate-900">tenue</span> lorsqu’elle a été
          démarrée puis terminée dans Mon Cahier. Une séance <span className="font-bold text-slate-900">non tenue</span>
          correspond à un cours prévu dans l’emploi du temps mais jamais ouvert par l’enseignant.
        </div>
      </section>

      {loading ? (
        <div className="flex min-h-[360px] items-center justify-center gap-3 rounded-[28px] border border-slate-200 bg-white text-sm font-semibold text-slate-600 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin" />
          Chargement de la présence enseignants...
        </div>
      ) : error ? (
        <div className="rounded-[28px] border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : !data || !totals ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">
          Aucune donnée disponible.
        </div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-5">
            <StatCard
              title="Séances prévues"
              value={nf(totals.scheduled)}
              subtitle="Selon les emplois du temps"
              icon={<ClipboardList className="h-5 w-5" />}
            />
            <StatCard
              title="Séances tenues"
              value={nf(totals.held)}
              subtitle="Démarrées puis terminées"
              icon={<CheckCircle2 className="h-5 w-5" />}
            />
            <StatCard
              title="Non tenues"
              value={nf(totals.not_held)}
              subtitle="Prévues mais non ouvertes"
              icon={<XCircle className="h-5 w-5" />}
            />
            <StatCard
              title="Incomplètes"
              value={nf(totals.incomplete)}
              subtitle="Ouvertes mais non terminées"
              icon={<AlertTriangle className="h-5 w-5" />}
            />
            <StatCard
              title="Taux de tenue"
              value={pf(totals.held_rate)}
              subtitle="Tenues / prévues"
              icon={<TrendingUp className="h-5 w-5" />}
            />
          </section>

          {data.alerts.length > 0 ? (
            <section className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-5 w-5" />
                <h2 className="text-lg font-black">Alertes à suivre</h2>
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
            <TrendChart daily={data.daily} />
          </section>

          <InstitutionBars items={items} />

          <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-lg font-black text-slate-950">Détail par établissement</h2>
              <p className="mt-1 text-sm text-slate-500">
                Classement orienté contrôle : les établissements les plus préoccupants apparaissent en premier.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Établissement</th>
                    <th className="px-4 py-3 text-right">Prévues</th>
                    <th className="px-4 py-3 text-right">Tenues</th>
                    <th className="px-4 py-3 text-right">Non tenues</th>
                    <th className="px-4 py-3 text-right">Incomplètes</th>
                    <th className="px-4 py-3 text-right">Enseignants vus</th>
                    <th className="px-4 py-3 text-right">Taux</th>
                    <th className="px-4 py-3 text-right">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-slate-500" colSpan={8}>
                        Aucun établissement rattaché au périmètre DRENAET.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.institution_id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <p className="font-black text-slate-900">{item.institution_name}</p>
                          <p className="text-xs text-slate-500">{item.regional_direction || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-bold">{nf(item.scheduled)}</td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-700">{nf(item.held)}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-700">{nf(item.not_held)}</td>
                        <td className="px-4 py-3 text-right font-bold text-amber-700">{nf(item.incomplete)}</td>
                        <td className="px-4 py-3 text-right font-bold">{nf(item.teachers_seen)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="ml-auto w-28">
                            <div className="mb-1 text-right font-black">{pf(item.held_rate)}</div>
                            <RateBar value={item.held_rate} />
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
