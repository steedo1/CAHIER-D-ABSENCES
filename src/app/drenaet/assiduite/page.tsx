// src/app/drenaet/assiduite/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, UsersRound } from "lucide-react";

type AttendanceRow = {
  institution_id: string;
  institution_name: string;
  regional_direction: string;
  marks: number;
  absences: number;
  retards: number;
  late_minutes: number;
  absence_rate: number;
  late_rate: number;
};

type AttendancePayload = {
  ok: boolean;
  range: { fromYmd: string; toYmd: string };
  totals: { marks: number; absences: number; retards: number; late_minutes: number; absence_rate: number; late_rate: number };
  items: AttendanceRow[];
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

export default function DrenaetAssiduitePage() {
  const [from, setFrom] = useState(minusDays(6));
  const [to, setTo] = useState(todayYmd());
  const [data, setData] = useState<AttendancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ from, to });
        const res = await fetch(`/api/drenaet/attendance?${params.toString()}`, { cache: "no-store" });
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
              <UsersRound className="h-4 w-4" />
              Assiduité régionale
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Assiduité élèves</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Absences et retards consolidés par établissement sur la période sélectionnée.
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
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Appels analysés</p><p className="mt-2 text-3xl font-black">{nf(data?.totals.marks)}</p></div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Absences</p><p className="mt-2 text-3xl font-black">{nf(data?.totals.absences)}</p></div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Retards</p><p className="mt-2 text-3xl font-black">{nf(data?.totals.retards)}</p></div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Taux absence</p><p className="mt-2 text-3xl font-black">{nf(data?.totals.absence_rate)}%</p></div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-black text-slate-950">Classement par établissement</h2>
            <p className="text-sm text-slate-500">Les établissements les plus touchés apparaissent en premier.</p>
          </div>
          <CalendarDays className="h-5 w-5 text-slate-400" />
        </div>

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
                  <th className="px-4 py-3 text-right">Appels</th>
                  <th className="px-4 py-3 text-right">Absences</th>
                  <th className="px-4 py-3 text-right">Taux abs.</th>
                  <th className="px-4 py-3 text-right">Retards</th>
                  <th className="px-4 py-3 text-right">Taux ret.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.institution_id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3"><p className="font-black text-slate-900">{item.institution_name}</p><p className="text-xs text-slate-500">{item.regional_direction || "—"}</p></td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.marks)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.absences)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.absence_rate)}%</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.retards)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.late_rate)}%</td>
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
