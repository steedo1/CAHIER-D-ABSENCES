// src/app/drenaet/etablissements/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Loader2, Search } from "lucide-react";

type InstitutionRow = {
  id: string;
  name: string;
  code_unique: string;
  code: string;
  regional_direction: string;
  students: number;
  teachers: number;
  sessions_today: number;
  calls_today: number;
  teacher_coverage_rate: number;
  absences_today: number;
  retards_today: number;
  state: "normal" | "watch" | "alert" | "silent";
};

const STATE_LABELS: Record<InstitutionRow["state"], string> = {
  normal: "Normal",
  watch: "À surveiller",
  alert: "Alerte",
  silent: "Aucune donnée",
};

function nf(value: number | undefined | null) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

export default function DrenaetEtablissementsPage() {
  const [items, setItems] = useState<InstitutionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [state, setState] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (state) params.set("status", state);
        const res = await fetch(`/api/drenaet/institutions?${params.toString()}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || json?.error || "Erreur de chargement");
        if (alive) setItems(json.items || []);
      } catch (e: any) {
        if (alive) setError(e?.message || "Erreur inattendue");
      } finally {
        if (alive) setLoading(false);
      }
    }
    const timer = window.setTimeout(load, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q, state]);

  const totals = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.students += item.students;
        acc.teachers += item.teachers;
        acc.absences += item.absences_today;
        acc.retards += item.retards_today;
        return acc;
      },
      { students: 0, teachers: 0, absences: 0, retards: 0 }
    );
  }, [items]);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
              <Building2 className="h-4 w-4" />
              Périmètre régional
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Établissements</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Liste des établissements rattachés à la DRENAET avec les indicateurs du jour.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Élèves</p><p className="font-black">{nf(totals.students)}</p></div>
            <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Enseignants</p><p className="font-black">{nf(totals.teachers)}</p></div>
            <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Absences</p><p className="font-black">{nf(totals.absences)}</p></div>
            <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Retards</p><p className="font-black">{nf(totals.retards)}</p></div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label className="relative block flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un établissement, code ou DRENAET..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm outline-none focus:border-slate-400"
            />
          </label>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold outline-none focus:border-slate-400"
          >
            <option value="">Tous les états</option>
            <option value="normal">Normal</option>
            <option value="watch">À surveiller</option>
            <option value="alert">Alerte</option>
            <option value="silent">Aucune donnée</option>
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center gap-3 text-sm font-semibold text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement des établissements...
          </div>
        ) : error ? (
          <div className="p-5 text-sm font-semibold text-red-700">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Établissement</th>
                  <th className="px-4 py-3">DRENAET</th>
                  <th className="px-4 py-3 text-right">Élèves</th>
                  <th className="px-4 py-3 text-right">Enseignants</th>
                  <th className="px-4 py-3 text-right">Appels profs</th>
                  <th className="px-4 py-3 text-right">Absences</th>
                  <th className="px-4 py-3 text-right">Retards</th>
                  <th className="px-4 py-3">État</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-black text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.code_unique || item.code || "Code non renseigné"}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.regional_direction || "—"}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.students)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.teachers)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.calls_today)} / {nf(item.sessions_today)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.absences_today)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.retards_today)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                        {STATE_LABELS[item.state]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length ? <div className="p-6 text-center text-sm font-semibold text-slate-500">Aucun établissement trouvé.</div> : null}
          </div>
        )}
      </section>
    </div>
  );
}
