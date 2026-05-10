// src/app/drenaet/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, ClipboardCheck, GraduationCap, Loader2, UsersRound } from "lucide-react";

type DashboardData = {
  ok: boolean;
  scope: { role: string; regional_directions: string[]; institutions: number };
  counts: { institutions: number; students: number; teachers: number };
  today: {
    date: string;
    absences: number;
    retards: number;
    sessions: number;
    sessions_with_call: number;
    sessions_closed: number;
    teacher_coverage_rate: number;
  };
  alerts: { level: string; title: string; message: string; count: number }[];
  institutions: {
    id: string;
    name: string;
    code_unique?: string | null;
    regional_direction?: string | null;
    activity_score: number;
    sessions_today: number;
    marks_today: number;
  }[];
};

function nf(value: number | undefined | null) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function MetricCard({ title, value, subtitle, Icon }: { title: string; value: string; subtitle: string; Icon: any }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-xs font-medium text-slate-500">{subtitle}</p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function DrenaetDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/drenaet/dashboard", { cache: "no-store" });
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
  }, []);

  const directionLabel = useMemo(() => {
    if (!data?.scope?.regional_directions?.length) return "Toutes directions régionales";
    return data.scope.regional_directions.join(" · ");
  }, [data]);

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-[32px] border border-slate-200 bg-white">
        <div className="flex items-center gap-3 text-sm font-semibold text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          Chargement du tableau de bord régional...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[28px] border border-red-200 bg-red-50 p-5 text-red-800">
        <p className="font-bold">Impossible de charger l’espace DRENAET</p>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] bg-slate-950 text-white shadow-sm">
        <div className="relative p-6 md:p-8">
          <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-emerald-100 ring-1 ring-white/10">
                <CheckCircle2 className="h-4 w-4" />
                Interface régionale en lecture seule
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight md:text-4xl">Tableau de bord DRENAET</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Suivi consolidé des établissements, de l’assiduité des élèves et de la présence enseignants.
              </p>
            </div>
            <div className="rounded-3xl bg-white/10 p-4 ring-1 ring-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Périmètre</p>
              <p className="mt-1 text-sm font-black text-white">{directionLabel}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Établissements suivis" value={nf(data.counts.institutions)} subtitle="Dans le périmètre régional" Icon={Building2} />
        <MetricCard title="Élèves enregistrés" value={nf(data.counts.students)} subtitle="Toutes écoles rattachées" Icon={GraduationCap} />
        <MetricCard title="Enseignants suivis" value={nf(data.counts.teachers)} subtitle="Rôles enseignants actifs" Icon={UsersRound} />
        <MetricCard title="Séances confirmées" value={`${nf(data.today.teacher_coverage_rate)}%`} subtitle={`${nf(data.today.sessions_with_call)} / ${nf(data.today.sessions)} aujourd’hui`} Icon={ClipboardCheck} />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Absences du jour" value={nf(data.today.absences)} subtitle={`Données du ${data.today.date}`} Icon={AlertTriangle} />
        <MetricCard title="Retards du jour" value={nf(data.today.retards)} subtitle="Retards élèves enregistrés" Icon={AlertTriangle} />
        <MetricCard title="Séances clôturées" value={nf(data.today.sessions_closed)} subtitle="Séances terminées aujourd’hui" Icon={CheckCircle2} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-950">Alertes importantes</h2>
              <p className="text-sm text-slate-500">Les points à vérifier rapidement dans la région.</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          </div>

          <div className="mt-4 space-y-3">
            {data.alerts.length ? (
              data.alerts.map((alert, index) => (
                <div key={`${alert.title}-${index}`} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-slate-900">{alert.title}</p>
                      <p className="mt-1 text-sm text-slate-600">{alert.message}</p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">
                      {nf(alert.count)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                Aucune alerte majeure détectée pour aujourd’hui.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Établissements à surveiller</h2>
          <p className="text-sm text-slate-500">Triés par faible activité du jour.</p>
          <div className="mt-4 space-y-3">
            {data.institutions.map((inst) => (
              <div key={inst.id} className="rounded-3xl border border-slate-200 p-4">
                <p className="font-black text-slate-900">{inst.name}</p>
                <p className="mt-1 text-xs font-medium text-slate-500">{inst.regional_direction || "Direction non renseignée"}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <span className="rounded-2xl bg-slate-50 px-3 py-2 font-bold text-slate-700">Séances : {nf(inst.sessions_today)}</span>
                  <span className="rounded-2xl bg-slate-50 px-3 py-2 font-bold text-slate-700">Appels : {nf(inst.marks_today)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
