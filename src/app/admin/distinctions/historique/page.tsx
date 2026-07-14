"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Award,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock3,
  Loader2,
  RefreshCw,
  School,
  Trophy,
  Users,
} from "lucide-react";

type HistoryItem = {
  id: string;
  category: string;
  title: string;
  academic_year?: string | null;
  period_code?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  class_ids?: string[] | null;
  recipient_count?: number | null;
  snapshot?: any;
  created_at: string;
  created_by_name?: string | null;
};

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}

function categoryLabel(category: string) {
  if (category === "teachers") return "Enseignants";
  if (category === "students_individual") return "Tableaux individuels";
  if (category === "students_general") return "Top 3 général";
  if (category === "students_science") return "Excellence scientifique";
  if (category === "students_literature") return "Excellence littéraire";
  return category;
}

export default function DistinctionHistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    setMigrationRequired(false);
    try {
      const response = await fetch("/api/admin/distinctions/history?limit=100", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (json?.migration_required) setMigrationRequired(true);
        throw new Error(String(json?.message || json?.error || "Historique indisponible"));
      }
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Historique indisponible");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-[32px] bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 px-6 py-7 text-white shadow-xl lg:px-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="inline-flex items-center gap-2 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-amber-300 ring-1 ring-amber-300/20"><Clock3 className="h-4 w-4" /> Traçabilité</div><h1 className="mt-4 text-3xl font-black tracking-tight">Historique des distinctions</h1><p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">Retrouve les palmarès validés, les bénéficiaires, la période et l’administrateur ayant enregistré chaque publication.</p></div>
            <button type="button" onClick={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 font-bold text-white ring-1 ring-white/15 hover:bg-white/15"><RefreshCw className="h-4 w-4" /> Actualiser</button>
          </div>
        </section>

        {loading ? <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-10 w-10 animate-spin text-amber-600" /></div> : null}

        {!loading && error ? (
          <div className={`mt-6 rounded-[24px] border p-5 ${migrationRequired ? "border-amber-200 bg-amber-50 text-amber-950" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
            <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" /><div><h2 className="font-black">{migrationRequired ? "Activation de l’historique requise" : "Historique indisponible"}</h2><p className="mt-1 text-sm leading-relaxed">{error}</p>{migrationRequired ? <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 font-mono text-xs">src/db/distinctions_module_v1.sql</p> : null}</div></div>
          </div>
        ) : null}

        {!loading && !error && items.length === 0 ? <div className="mt-6 rounded-[28px] border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><Trophy className="mx-auto h-12 w-12 text-slate-300" /><h2 className="mt-4 text-xl font-black text-slate-900">Aucun palmarès enregistré</h2><p className="mt-2 text-sm text-slate-500">Les prochains tableaux d’honneur et prix enseignants apparaîtront ici après validation.</p></div> : null}

        <div className="mt-6 space-y-4">
          {items.map((item) => {
            const open = openId === item.id;
            const recipients = Array.isArray(item.snapshot?.recipients)
              ? item.snapshot.recipients
              : Array.isArray(item.snapshot?.awards)
                ? item.snapshot.awards
                : [];
            const teachers = item.category === "teachers";
            return (
              <article key={item.id} className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
                <button type="button" onClick={() => setOpenId(open ? null : item.id)} className="flex w-full items-start gap-4 p-5 text-left hover:bg-slate-50">
                  <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${teachers ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}>{teachers ? <Award className="h-6 w-6" /> : <Trophy className="h-6 w-6" />}</span>
                  <span className="min-w-0 flex-1"><span className="block text-xs font-black uppercase tracking-[0.16em] text-slate-500">{categoryLabel(item.category)}</span><span className="mt-1 block text-lg font-black text-slate-950">{item.title}</span><span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-500"><span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {item.academic_year || "Année non précisée"}</span><span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {item.recipient_count || 0} bénéficiaire(s)</span><span className="inline-flex items-center gap-1"><School className="h-3.5 w-3.5" /> {item.class_ids?.length || 0} classe(s)</span></span></span>
                  <span className="shrink-0 text-slate-400">{open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</span>
                </button>
                {open ? (
                  <div className="border-t border-slate-100 bg-slate-50/70 p-5">
                    <div className="grid gap-3 text-sm md:grid-cols-3"><div className="rounded-2xl bg-white p-4"><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Période</div><div className="mt-1 font-bold text-slate-950">{formatDate(item.date_from)} → {formatDate(item.date_to)}</div></div><div className="rounded-2xl bg-white p-4"><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Enregistré par</div><div className="mt-1 font-bold text-slate-950">{item.created_by_name || "Administrateur"}</div></div><div className="rounded-2xl bg-white p-4"><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Date d’enregistrement</div><div className="mt-1 font-bold text-slate-950">{formatDateTime(item.created_at)}</div></div></div>
                    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-left text-xs font-black uppercase tracking-wide text-slate-600"><tr><th className="px-4 py-3">Bénéficiaire</th><th className="px-4 py-3">Distinction</th><th className="px-4 py-3">Détail</th></tr></thead><tbody className="divide-y divide-slate-100">{recipients.length ? recipients.map((recipient: any, index: number) => <tr key={`${item.id}-${index}`}><td className="px-4 py-3 font-bold text-slate-950">{recipient.full_name || recipient.teacher_name || "Bénéficiaire"}<div className="text-xs font-normal text-slate-500">{recipient.class_label || ""}</div></td><td className="px-4 py-3 font-semibold text-amber-800">{recipient.award_title || recipient.title || recipient.tier || categoryLabel(item.category)}</td><td className="px-4 py-3 text-slate-600">{recipient.metric_value || (recipient.general_avg !== undefined && recipient.general_avg !== null ? `Moyenne ${Number(recipient.general_avg).toFixed(2)} · Conduite ${recipient.conduct_avg !== null && recipient.conduct_avg !== undefined ? Number(recipient.conduct_avg).toFixed(2) : "—"}` : recipient.score !== undefined && recipient.score !== null ? `Score ${Number(recipient.score).toFixed(1)}/100` : "—")}</td></tr>) : <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">Le résumé détaillé n’est pas disponible pour cet enregistrement.</td></tr>}</tbody></table></div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
