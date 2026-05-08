"use client";

import Link from "next/link";
import React from "react";
import { AlertTriangle, ArrowLeft, CalendarDays, Clock3, Loader2, RefreshCw, School, UserRound } from "lucide-react";

type Assignment = {
  id?: string;
  class_label?: string;
  teacher_name?: string;
  subject_label?: string;
  scheduler_subject_id?: string;
  weekday?: number;
  period_no?: number;
  period_label?: string;
  start_time?: string | null;
  end_time?: string | null;
  room_id?: string | null;
  source?: string;
};

type EngineResult = {
  status?: string;
  generated_at?: string;
  summary?: { assignments_count?: number; placements_count?: number; unplaced_count?: number; score?: number };
  assignments?: Assignment[];
  unplaced?: Assignment[];
  diagnostics?: Array<{ level?: string; message?: string }>;
};

type Project = {
  id: string;
  name: string;
  status: "draft" | "ready" | "published" | "archived";
  engine_result?: EngineResult | null;
  diagnostics?: Array<{ level?: string; message?: string }>;
  created_at: string;
  updated_at: string;
};

type ProjectResponse = { ok: true; item: Project } | { ok: false; error: string; message?: string };

const WEEKDAYS: Record<number, string> = { 1: "Lundi", 2: "Mardi", 3: "Mercredi", 4: "Jeudi", 5: "Vendredi", 6: "Samedi", 7: "Dimanche" };

function formatDate(value?: string) {
  if (!value) return "—";
  try { return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); } catch { return value; }
}

function dayLabel(value?: number) {
  const day = Number(value || 0);
  return WEEKDAYS[day] || `Jour ${day || "?"}`;
}

function timeLabel(item: Assignment) {
  if (item.start_time && item.end_time) return `${item.start_time} - ${item.end_time}`;
  return item.period_label || `Créneau ${item.period_no || "?"}`;
}

function sortAssignments(items: Assignment[]) {
  return [...items].sort((a, b) => {
    const aw = Number(a.weekday || 0);
    const bw = Number(b.weekday || 0);
    if (aw !== bw) return aw - bw;
    const ap = Number(a.period_no || 0);
    const bp = Number(b.period_no || 0);
    if (ap !== bp) return ap - bp;
    return String(a.class_label || "").localeCompare(String(b.class_label || ""));
  });
}

function groupBy(items: Assignment[], key: "class_label" | "teacher_name") {
  const map = new Map<string, Assignment[]>();
  for (const item of items) {
    const label = String(item[key] || "Non renseigné").trim() || "Non renseigné";
    const current = map.get(label) || [];
    current.push(item);
    map.set(label, current);
  }
  return Array.from(map.entries()).map(([label, values]) => ({ label, items: sortAssignments(values) })).sort((a, b) => a.label.localeCompare(b.label));
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p></div>;
}

export default function MontageProjectPreview({ projectId }: { projectId: string }) {
  const [project, setProject] = React.useState<Project | null>(null);
  const [mode, setMode] = React.useState<"class" | "teacher">("class");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/projects/${projectId}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ProjectResponse | null;
      if (!json) { setError("Réponse serveur invalide."); return; }
      if (!json.ok) { setError(json.message || json.error); return; }
      setProject(json.item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger l’aperçu.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => { void load(); }, [load]);

  const result = project?.engine_result || null;
  const assignments = Array.isArray(result?.assignments) ? result.assignments : [];
  const unplaced = Array.isArray(result?.unplaced) ? result.unplaced : [];
  const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : Array.isArray(project?.diagnostics) ? project?.diagnostics || [] : [];
  const groups = mode === "class" ? groupBy(assignments, "class_label") : groupBy(assignments, "teacher_name");

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/admin/montage-emploi-du-temps" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-slate-950"><ArrowLeft className="h-4 w-4" /> Retour au montage</Link>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Recharger</button>
        </div>

        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 shadow-xl"><div className="relative p-6 sm:p-8"><div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.20),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.17),transparent_32%)]" /><div className="relative"><div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-sky-100"><CalendarDays className="h-4 w-4" /> Résultat HoraClasse</div><h1 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">{project?.name || "Emploi du temps généré"}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">Consultation du résultat généré par le scheduler HoraClasse. La publication officielle reste contrôlée séparément.</p>{project && <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-white px-3 py-1 text-slate-950">Statut : {project.status}</span><span className="rounded-full bg-white/10 px-3 py-1 text-slate-200 ring-1 ring-white/10">Modifié le {formatDate(project.updated_at)}</span>{result?.generated_at && <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200 ring-1 ring-white/10">Généré le {formatDate(result.generated_at)}</span>}</div>}</div></div></div>

        {loading && <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700 shadow-sm"><Loader2 className="h-5 w-5 animate-spin" /> Chargement de l’aperçu...</div>}
        {!loading && error && <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-black">Impossible de charger l’aperçu</p><p className="mt-1 text-sm">{error}</p></div></div></div>}

        {!loading && project && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatBox label="Lignes publiables" value={result?.summary?.assignments_count ?? assignments.length} />
              <StatBox label="Blocs non placés" value={result?.summary?.unplaced_count ?? unplaced.length} />
              <StatBox label="Score" value={`${result?.summary?.score ?? 0}%`} />
              <StatBox label="Moteur" value={result?.status === "generated_real_scheduler" ? "HoraClasse" : "En attente"} />
            </div>

            {assignments.length === 0 ? (
              <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm"><div className="flex items-start gap-3"><Clock3 className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-black">Aucun emploi du temps généré</p><p className="mt-1 text-sm">Retourne sur la page Montage emploi du temps, puis clique sur “Générer avec HoraClasse”.</p></div></div></div>
            ) : (
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-black">Aperçu HoraClasse</h2><p className="mt-1 text-sm text-slate-500">Affichage en lignes publiables. La grille détaillée viendra ensuite.</p></div><div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1"><button type="button" onClick={() => setMode("class")} className={["inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition", mode === "class" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"].join(" ")}><School className="h-4 w-4" />Par classe</button><button type="button" onClick={() => setMode("teacher")} className={["inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition", mode === "teacher" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"].join(" ")}><UserRound className="h-4 w-4" />Par enseignant</button></div></div>
                <div className="mt-6 space-y-5">{groups.map((group) => <div key={group.label} className="overflow-hidden rounded-3xl border border-slate-200"><div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><p className="font-black text-slate-950">{group.label}</p><p className="text-xs font-semibold text-slate-500">{group.items.length} ligne{group.items.length > 1 ? "s" : ""}</p></div><div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-white"><tr className="text-left text-xs font-black uppercase tracking-wide text-slate-500"><th className="px-4 py-3">Jour</th><th className="px-4 py-3">Heure</th><th className="px-4 py-3">Classe</th><th className="px-4 py-3">Matière</th><th className="px-4 py-3">Enseignant</th></tr></thead><tbody className="divide-y divide-slate-100">{group.items.map((item, index) => <tr key={`${group.label}-${item.id || index}`} className="bg-white"><td className="px-4 py-3 font-bold">{dayLabel(item.weekday)}</td><td className="px-4 py-3 text-slate-600">{timeLabel(item)}</td><td className="px-4 py-3 text-slate-700">{item.class_label || "—"}</td><td className="px-4 py-3 font-semibold text-slate-950">{item.subject_label || "—"}</td><td className="px-4 py-3 text-slate-700">{item.teacher_name || "—"}</td></tr>)}</tbody></table></div></div>)}</div>
              </div>
            )}

            {(unplaced.length > 0 || diagnostics.length > 0) && <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><h2 className="font-black">Diagnostics HoraClasse</h2><div className="mt-3 space-y-2 text-sm">{diagnostics.map((item, index) => <p key={`diagnostic-${index}`}>• {item.message || "Alerte sans message"}</p>)}{unplaced.map((item, index) => <p key={`unplaced-${index}`}>• Non placé : {item.class_label || "Classe"} — {item.subject_label || "Matière"} — {item.teacher_name || "Enseignant"}</p>)}</div></div></div></div>}
          </>
        )}
      </section>
    </main>
  );
}
