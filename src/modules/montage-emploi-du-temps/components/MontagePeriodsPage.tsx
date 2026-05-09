"use client";

import Link from "next/link";
import React from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import MontageSectionShell from "./MontageSectionShell";

type PeriodRow = {
  id: string;
  weekday: number | null;
  period_no: number | null;
  label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  duration_min?: number | null;
};

type PeriodsResponse =
  | { periods: PeriodRow[] }
  | { error: string; message?: string };

type NormalizedPeriod = {
  id: string;
  weekday: number;
  period_no: number;
  label: string;
  start_time: string | null;
  end_time: string | null;
  duration_min: number | null;
  half_day: "Matin" | "Après-midi" | "À vérifier";
  status: "ok" | "warning";
  status_label: string;
};

const WEEKDAYS = [
  { id: 1, short: "Lun", label: "Lundi" },
  { id: 2, short: "Mar", label: "Mardi" },
  { id: 3, short: "Mer", label: "Mercredi" },
  { id: 4, short: "Jeu", label: "Jeudi" },
  { id: 5, short: "Ven", label: "Vendredi" },
  { id: 6, short: "Sam", label: "Samedi" },
];

function toMinutes(value?: string | null): number | null {
  if (!value) return null;
  const raw = String(value).slice(0, 5);
  const [h, m] = raw.split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function formatTime(value?: string | null): string {
  if (!value) return "—";
  return String(value).slice(0, 5);
}

function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h${String(m).padStart(2, "0")}`;
  if (h > 0) return `${h}h`;
  return `${m} min`;
}

function getHalfDay(startTime?: string | null): NormalizedPeriod["half_day"] {
  const start = toMinutes(startTime);
  if (start === null) return "À vérifier";
  return start < 12 * 60 ? "Matin" : "Après-midi";
}

function normalizePeriod(row: PeriodRow, index: number): NormalizedPeriod {
  const start = toMinutes(row.start_time);
  const end = toMinutes(row.end_time);
  const computedDuration = start !== null && end !== null ? end - start : null;
  const duration = Number(row.duration_min || 0) > 0 ? Number(row.duration_min) : computedDuration;
  const hasInvalidTime = start === null || end === null || duration === null || duration <= 0;

  return {
    id: String(row.id || `period_${index}`),
    weekday: Number(row.weekday || 0),
    period_no: Number(row.period_no || index + 1),
    label: String(row.label || "Séance").trim() || "Séance",
    start_time: row.start_time || null,
    end_time: row.end_time || null,
    duration_min: duration,
    half_day: getHalfDay(row.start_time),
    status: hasInvalidTime ? "warning" : "ok",
    status_label: hasInvalidTime ? "Horaire à vérifier" : "Officiel Mon Cahier",
  };
}

function buildGapLabel(current: NormalizedPeriod, next?: NormalizedPeriod): string {
  if (!next) return "Dernier créneau du jour";
  const currentEnd = toMinutes(current.end_time);
  const nextStart = toMinutes(next.start_time);
  if (currentEnd === null || nextStart === null) return "Transition à vérifier";
  const gap = nextStart - currentEnd;
  if (gap <= 0) return "Créneau suivant direct";
  return `Pause détectée : ${formatDuration(gap)}`;
}

function groupByDay(periods: NormalizedPeriod[]) {
  const grouped = new Map<number, NormalizedPeriod[]>();
  for (const day of WEEKDAYS) grouped.set(day.id, []);
  for (const period of periods) {
    const day = period.weekday;
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)?.push(period);
  }
  for (const items of grouped.values()) {
    items.sort((a, b) => a.period_no - b.period_no || formatTime(a.start_time).localeCompare(formatTime(b.start_time)));
  }
  return grouped;
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "sky" | "emerald" | "amber" | "slate";
}) {
  const classes = {
    sky: "border-sky-100 bg-sky-50 text-sky-950",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-950",
    amber: "border-amber-100 bg-amber-50 text-amber-950",
    slate: "border-slate-200 bg-white text-slate-950",
  }[tone];

  return (
    <div className={`rounded-[28px] border p-5 shadow-sm ${classes}`}>
      <p className="text-sm font-bold opacity-70">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight">{value}</p>
    </div>
  );
}

export default function MontagePeriodsPage() {
  const [periods, setPeriods] = React.useState<NormalizedPeriod[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/institution/periods", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as PeriodsResponse | null;
      if (!json) {
        setError("Réponse serveur invalide pendant le chargement des créneaux.");
        return;
      }
      if ("error" in json) {
        setError(json.message || json.error);
        return;
      }
      const rows = Array.isArray(json.periods) ? json.periods : [];
      setPeriods(rows.map(normalizePeriod));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les créneaux officiels.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const grouped = React.useMemo(() => groupByDay(periods), [periods]);
  const activeDays = WEEKDAYS.filter((day) => (grouped.get(day.id)?.length || 0) > 0);
  const invalidCount = periods.filter((period) => period.status === "warning").length;
  const breakCount = Array.from(grouped.values()).reduce((total, dayPeriods) => {
    return total + dayPeriods.filter((period, index) => {
      const next = dayPeriods[index + 1];
      if (!next) return false;
      const end = toMinutes(period.end_time);
      const start = toMinutes(next.start_time);
      return end !== null && start !== null && start - end > 0;
    }).length;
  }, 0);

  return (
    <MontageSectionShell
      badge="Créneaux officiels"
      title="Créneaux Mon Cahier"
      description="Cette page ne crée aucun créneau HoraClasse parallèle. Elle contrôle les créneaux officiels déjà configurés dans Mon Cahier et utilisés par le moteur de montage."
      status="Lecture depuis institution_periods"
      note="Les créneaux viennent uniquement des paramètres Mon Cahier. Le moteur HoraClasse les lit tels quels pour éviter toute différence entre l’emploi du temps généré, les appels et les séances officielles."
      cards={[
        {
          title: "Source unique",
          description: "Les créneaux sont lus depuis l’API officielle /api/admin/institution/periods.",
        },
        {
          title: "Aucune duplication",
          description: "Le module montage ne recrée pas de grille horaire séparée.",
        },
        {
          title: "Contrôle avant génération",
          description: "Si aucun créneau n’est configuré, la génération doit rester bloquée.",
        },
      ]}
    >
      <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100">
            <CalendarDays className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-black text-slate-950">Contrôle des créneaux</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Modification volontairement redirigée vers les paramètres officiels pour garder Mon Cahier comme source unique.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Recharger
          </button>
          <Link
            href="/admin/parametres"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
          >
            Ouvrir Paramètres
            <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-700 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin" />
          Chargement des créneaux officiels Mon Cahier...
        </div>
      )}

      {error && (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-black">Impossible de charger les créneaux.</p>
              <p className="mt-1 text-sm leading-6">{error}</p>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && periods.length === 0 && (
        <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 h-6 w-6 shrink-0" />
            <div>
              <h2 className="text-lg font-black">Aucun créneau officiel configuré.</h2>
              <p className="mt-2 text-sm leading-6">
                Avant de lancer HoraClasse, configure les créneaux dans les paramètres Mon Cahier. Le module montage ne doit pas inventer une grille horaire parallèle.
              </p>
              <Link
                href="/admin/parametres"
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-amber-700"
              >
                Aller aux paramètres
                <ExternalLink className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && periods.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Créneaux officiels" value={periods.length} tone="sky" />
            <StatCard label="Jours actifs" value={activeDays.length} tone="emerald" />
            <StatCard label="Pauses détectées" value={breakCount} tone="amber" />
            <StatCard label="À vérifier" value={invalidCount} tone="slate" />
          </div>

          {invalidCount > 0 && (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-black">Certains créneaux ont des horaires incomplets ou incohérents.</p>
                  <p className="mt-1 text-sm leading-6">
                    Corrige-les dans Paramètres avant la génération, sinon le moteur ne pourra pas placer correctement les blocs.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-5">
            {WEEKDAYS.map((day) => {
              const rows = grouped.get(day.id) || [];
              return (
                <section key={day.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-950">{day.label}</h2>
                      <p className="text-sm text-slate-500">
                        {rows.length > 0 ? `${rows.length} créneau${rows.length > 1 ? "x" : ""} officiel${rows.length > 1 ? "s" : ""}` : "Aucun créneau configuré"}
                      </p>
                    </div>
                    {rows.length > 0 ? (
                      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
                        <CheckCircle2 className="h-4 w-4" />
                        Utilisable par HoraClasse
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500 ring-1 ring-slate-200">
                        Jour vide
                      </span>
                    )}
                  </div>

                  {rows.length === 0 ? (
                    <div className="px-5 py-8 text-sm text-slate-500">
                      Ce jour restera non utilisé par le moteur de montage.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-white text-left text-xs font-black uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-5 py-3">#</th>
                            <th className="px-5 py-3">Libellé</th>
                            <th className="px-5 py-3">Début</th>
                            <th className="px-5 py-3">Fin</th>
                            <th className="px-5 py-3">Durée</th>
                            <th className="px-5 py-3">Demi-journée</th>
                            <th className="px-5 py-3">Contrôle HoraClasse</th>
                            <th className="px-5 py-3">Transition</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rows.map((period, index) => (
                            <tr key={period.id} className="align-top">
                              <td className="px-5 py-4 font-black text-slate-900">{period.period_no || index + 1}</td>
                              <td className="px-5 py-4 font-semibold text-slate-900">{period.label}</td>
                              <td className="px-5 py-4 text-slate-700">{formatTime(period.start_time)}</td>
                              <td className="px-5 py-4 text-slate-700">{formatTime(period.end_time)}</td>
                              <td className="px-5 py-4 text-slate-700">{formatDuration(period.duration_min)}</td>
                              <td className="px-5 py-4 text-slate-700">{period.half_day}</td>
                              <td className="px-5 py-4">
                                <span
                                  className={
                                    period.status === "ok"
                                      ? "inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100"
                                      : "inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-100"
                                  }
                                >
                                  {period.status_label}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-slate-600">{buildGapLabel(period, rows[index + 1])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <div className="rounded-[28px] border border-sky-200 bg-sky-50 p-6 text-sky-950 shadow-sm">
            <div className="flex items-start gap-3">
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h2 className="font-black">Règle pour les blocs de 2h</h2>
                <p className="mt-1 text-sm leading-6">
                  HoraClasse peut placer deux heures consécutives de la même matière. En revanche, il doit éviter de placer une heure, puis d’autres matières, puis de revenir à cette même matière plus tard dans la journée.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </MontageSectionShell>
  );
}
