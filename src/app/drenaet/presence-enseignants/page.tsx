// src/app/drenaet/presence-enseignants/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";

type PresenceRow = {
  institution_id: string;
  institution_name: string;
  regional_direction: string;
  sessions: number;
  confirmed: number;
  closed: number;
  missing: number;
  teachers_seen: number;
  coverage_rate: number;
  close_rate: number;
};

type PresencePayload = {
  ok: boolean;
  range: { fromYmd: string; toYmd: string };
  totals: { sessions: number; confirmed: number; closed: number; missing: number; coverage_rate: number; close_rate: number };
  items: PresenceRow[];
};

function nf(value: number | undefined | null) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function minusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
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

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
              <ClipboardList className="h-4 w-4" />
              Contrôle pédagogique régional
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Présence enseignants</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Suivi des séances enregistrées et confirmées dans les établissements de la DRENAET.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-slate-600">Du<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none" /></label>
            <label className="text-xs font-bold text-slate-600">Au<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none" /></label>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Séances</p><p className="mt-2 text-3xl font-black">{nf(data?.totals.sessions)}</p></div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Confirmées</p><p className="mt-2 text-3xl font-black">{nf(data?.totals.confirmed)}</p></div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Non confirmées</p><p className="mt-2 text-3xl font-black">{nf(data?.totals.missing)}</p></div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Taux couverture</p><p className="mt-2 text-3xl font-black">{nf(data?.totals.coverage_rate)}%</p></div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center gap-3 text-sm font-semibold text-slate-600"><Loader2 className="h-5 w-5 animate-spin" />Chargement...</div>
        ) : error ? (
          <div className="p-5 text-sm font-semibold text-red-700">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Établissement</th>
                  <th className="px-4 py-3 text-right">Séances</th>
                  <th className="px-4 py-3 text-right">Confirmées</th>
                  <th className="px-4 py-3 text-right">Non confirmées</th>
                  <th className="px-4 py-3 text-right">Enseignants vus</th>
                  <th className="px-4 py-3 text-right">Taux</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.institution_id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3"><p className="font-black text-slate-900">{item.institution_name}</p><p className="text-xs text-slate-500">{item.regional_direction || "—"}</p></td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.sessions)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.confirmed)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.missing)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.teachers_seen)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.coverage_rate)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
