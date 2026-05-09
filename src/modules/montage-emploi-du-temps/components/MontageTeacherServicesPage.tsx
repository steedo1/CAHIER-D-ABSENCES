"use client";

import Link from "next/link";
import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserCheck,
} from "lucide-react";
import MontageSectionShell from "./MontageSectionShell";

type ServiceAssignment = {
  class_id: string;
  class_label: string;
  level_code: string;
  series_code: string | null;
  teacher_id: string;
  teacher_name: string;
  subject_id: string;
  subject_label: string;
  subject_code: string | null;
  catalog_subject_id: string;
  catalog_subject_label: string;
  weekly_units: number | null;
  split_pattern: string | null;
  room_type_required: string | null;
  source: "default_catalog" | "override" | "manual_missing_catalog";
  is_ready: boolean;
  missing_reason: string | null;
};

type VolumesResponse =
  | {
      ok: true;
      service_assignments: ServiceAssignment[];
      warnings: string[];
      totals: { services: number; ready: number; missing: number; customized: number };
    }
  | { ok: false; error: string; message?: string };

function formatHours(value: number | null) {
  if (value === null || value === undefined) return "À compléter";

  const hours = Math.floor(value);
  const minutes = Math.round((value - hours) * 60);

  if (minutes === 0) return `${hours}h`;
  if (hours === 0) return `${minutes} min`;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function formatSplitPattern(pattern: string | null) {
  if (!pattern) return "—";

  return pattern
    .split("+")
    .map((part) => {
      const value = Number(part.trim().replace(",", "."));
      if (!Number.isFinite(value)) return part.trim();
      return formatHours(value);
    })
    .join(" + ");
}

function statusLabel(row: ServiceAssignment) {
  if (!row.is_ready) return "À compléter";
  if (row.source === "override") return "Personnalisé";
  return "Prêt";
}

function statusClass(row: ServiceAssignment) {
  if (!row.is_ready) return "bg-amber-50 text-amber-700 ring-amber-100";
  if (row.source === "override") return "bg-indigo-50 text-indigo-700 ring-indigo-100";
  return "bg-emerald-50 text-emerald-700 ring-emerald-100";
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone: "slate" | "emerald" | "amber" | "indigo" }) {
  const tones: Record<typeof tone, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-950",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-800",
    amber: "border-amber-100 bg-amber-50 text-amber-800",
    indigo: "border-indigo-100 bg-indigo-50 text-indigo-800",
  };

  return (
    <div className={`rounded-3xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-black uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

export default function MontageTeacherServicesPage() {
  const [data, setData] = React.useState<Extract<VolumesResponse, { ok: true }> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [levelFilter, setLevelFilter] = React.useState("all");
  const [subjectFilter, setSubjectFilter] = React.useState("all");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "ready" | "missing" | "override">("all");
  const [query, setQuery] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/volumes", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as VolumesResponse | null;
      if (!json) return setError("Réponse serveur invalide.");
      if (!json.ok) return setError(json.message || json.error);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les services enseignants.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const levels = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.service_assignments || []) map.set(row.level_code, row.level_code);
    return Array.from(map.keys()).sort((a, b) => a.localeCompare(b, "fr"));
  }, [data?.service_assignments]);

  const subjects = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.service_assignments || []) map.set(row.subject_id, row.subject_label);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }, [data?.service_assignments]);

  const rows = React.useMemo(() => {
    let next = [...(data?.service_assignments || [])];
    const q = query.trim().toLowerCase();

    if (levelFilter !== "all") next = next.filter((row) => row.level_code === levelFilter);
    if (subjectFilter !== "all") next = next.filter((row) => row.subject_id === subjectFilter);
    if (statusFilter === "ready") next = next.filter((row) => row.is_ready);
    if (statusFilter === "missing") next = next.filter((row) => !row.is_ready);
    if (statusFilter === "override") next = next.filter((row) => row.source === "override");
    if (q) {
      next = next.filter((row) => {
        return [row.class_label, row.subject_label, row.teacher_name, row.level_code]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
    }

    return next.sort((a, b) => {
      const classDelta = a.class_label.localeCompare(b.class_label, "fr");
      if (classDelta !== 0) return classDelta;
      const subjectDelta = a.subject_label.localeCompare(b.subject_label, "fr");
      if (subjectDelta !== 0) return subjectDelta;
      return a.teacher_name.localeCompare(b.teacher_name, "fr");
    });
  }, [data?.service_assignments, levelFilter, query, statusFilter, subjectFilter]);

  const totals = data?.totals;

  return (
    <MontageSectionShell
      title="Services enseignants"
      description="Lecture des affectations déjà créées dans Mon Cahier : classe, matière, professeur, volume, découpage et statut."
      badge="Affectations Mon Cahier"
      status="Lecture seule"
      note="Cette page ne crée pas d’enseignants et ne recrée pas les matières. Elle vérifie seulement si les affectations existantes sont exploitables par HoraClasse."
      cards={[
        { title: "Données existantes", description: "Les enseignants, matières et classes viennent de Mon Cahier." },
        { title: "Contrôle métier", description: "Le volume et le découpage viennent de Matières et heures." },
        { title: "Aucune duplication", description: "Pas de saisie Nom;Matières comme dans HoraClasse autonome." },
      ]}
    >
      <div className="space-y-5">
        <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Services réels Mon Cahier</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Affectations prêtes pour le moteur</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                Ici seulement on affiche les enseignants : classe, matière, professeur, volume, découpage et statut.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Recharger
            </button>
          </div>

          {totals ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Services" value={totals.services} tone="slate" />
              <StatCard label="Prêts" value={totals.ready} tone="emerald" />
              <StatCard label="À compléter" value={totals.missing} tone="amber" />
              <StatCard label="Personnalisés" value={totals.customized} tone="indigo" />
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 rounded-3xl border border-slate-200 bg-slate-50/70 p-4 lg:grid-cols-4">
            <label className="text-sm font-black text-slate-700">
              <span className="mb-2 flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> Niveau</span>
              <select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                <option value="all">Tous les niveaux</option>
                {levels.map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </label>

            <label className="text-sm font-black text-slate-700">
              <span className="mb-2 block">Matière</span>
              <select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                <option value="all">Toutes les matières</option>
                {subjects.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>

            <label className="text-sm font-black text-slate-700">
              <span className="mb-2 block">Statut</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                <option value="all">Tous les statuts</option>
                <option value="ready">Prêts</option>
                <option value="missing">À compléter</option>
                <option value="override">Personnalisés</option>
              </select>
            </label>

            <label className="text-sm font-black text-slate-700">
              <span className="mb-2 flex items-center gap-2"><Search className="h-4 w-4" /> Recherche</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Classe, prof, matière..." className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
            </label>
          </div>

          {error && (
            <div className="mt-5 rounded-3xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
              <div className="flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0" /><p>{error}</p></div>
            </div>
          )}

          {loading ? (
            <div className="mt-6 flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm font-bold text-slate-600"><Loader2 className="h-5 w-5 animate-spin" /> Chargement des services enseignants...</div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white">
              <div className="grid grid-cols-[1fr_1.2fr_1.3fr_1fr_1.1fr_1fr] gap-3 bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-wide text-white">
                <div>Classe</div>
                <div>Matière</div>
                <div>Professeur</div>
                <div>Volume</div>
                <div>Découpage</div>
                <div>Statut</div>
              </div>

              <div className="divide-y divide-slate-100">
                {rows.map((row, index) => (
                  <div key={`${row.class_id}-${row.subject_id}-${row.teacher_id}-${index}`} className="grid grid-cols-[1fr_1.2fr_1.3fr_1fr_1.1fr_1fr] items-center gap-3 px-4 py-4 text-sm hover:bg-slate-50/70">
                    <div className="font-black text-slate-950">{row.class_label}</div>
                    <div className="font-bold text-slate-700">{row.subject_label}</div>
                    <div className="flex min-w-0 items-center gap-2 font-bold text-slate-800"><UserCheck className="h-4 w-4 shrink-0 text-slate-400" /><span className="truncate">{row.teacher_name}</span></div>
                    <div className="font-black text-slate-950">{formatHours(row.weekly_units)}</div>
                    <div className="font-bold text-slate-600">{formatSplitPattern(row.split_pattern)}</div>
                    <div>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ring-1 ${statusClass(row)}`}>{statusLabel(row)}</span>
                      {!row.is_ready && <p className="mt-1 text-xs font-bold text-amber-700">Corriger dans Matières et heures</p>}
                    </div>
                    {row.missing_reason && <div className="col-span-6 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">{row.missing_reason}</div>}
                  </div>
                ))}

                {rows.length === 0 && <div className="px-4 py-12 text-center text-sm font-bold text-slate-500">Aucun service enseignant à afficher pour ces filtres.</div>}
              </div>
            </div>
          )}

          <div className="mt-5 rounded-3xl border border-sky-200 bg-sky-50 p-5 text-sm font-bold text-sky-950">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-black">Rappel important</p>
                <p className="mt-1 leading-6">Pour changer un volume ou un découpage, aller dans <Link href="/admin/montage-emploi-du-temps/volumes" className="underline decoration-2 underline-offset-4">Matières et heures</Link>. Cette page vérifie seulement les affectations existantes.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MontageSectionShell>
  );
}
