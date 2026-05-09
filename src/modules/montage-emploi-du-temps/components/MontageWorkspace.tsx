"use client";

import Link from "next/link";
import React from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  FileSpreadsheet,
  GraduationCap,
  Loader2,
  PlayCircle,
  PlusCircle,
  RefreshCw,
  School,
  Users,
} from "lucide-react";
import type { MontageBootstrapResponse } from "../types";

type EngineSummary = {
  placements_count?: number;
  assignments_count?: number;
  unplaced_count?: number;
  score?: number;
};

type EngineResult = {
  status?: string;
  generated_at?: string;
  summary?: EngineSummary;
  assignments?: unknown[];
  unplaced?: unknown[];
  diagnostics?: unknown[];
};

type MontageProject = {
  id: string;
  name: string;
  status: "draft" | "ready" | "published" | "archived";
  created_at: string;
  updated_at: string;
  engine_result?: EngineResult | null;
};

type ProjectsResponse =
  | { ok: true; items: MontageProject[] }
  | { ok: false; error: string; message?: string };

type GenerateResponse =
  | { ok: true; item: MontageProject; result: EngineResult; message?: string }
  | { ok: false; error: string; message?: string };

function StatCard({
  label,
  value,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  tone?: "slate" | "sky" | "emerald" | "amber" | "violet";
}) {
  const toneClasses: Record<typeof tone, string> = {
    slate: "border-slate-200 bg-white text-slate-900",
    sky: "border-sky-100 bg-sky-50 text-sky-950",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-950",
    amber: "border-amber-100 bg-amber-50 text-amber-950",
    violet: "border-violet-100 bg-violet-50 text-violet-950",
  };

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium opacity-70">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight">{value}</p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/70 shadow-sm ring-1 ring-black/5">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function getStatusLabel(status: MontageProject["status"]) {
  if (status === "draft") return "DRAFT";
  if (status === "ready") return "READY";
  if (status === "published") return "PUBLIÉ";
  if (status === "archived") return "ARCHIVÉ";
  return status;
}

export default function MontageWorkspace() {
  const [data, setData] = React.useState<MontageBootstrapResponse | null>(null);
  const [projects, setProjects] = React.useState<MontageProject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [projectsLoading, setProjectsLoading] = React.useState(false);
  const [creatingDraft, setCreatingDraft] = React.useState(false);
  const [generatingId, setGeneratingId] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [projectError, setProjectError] = React.useState<string | null>(null);

  const loadProjects = React.useCallback(async () => {
    setProjectsLoading(true);
    setProjectError(null);
    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/projects", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ProjectsResponse | null;
      if (!json) {
        setProjectError("Réponse serveur invalide pendant le chargement des brouillons.");
        return;
      }
      if (!json.ok) {
        setProjectError(json.message || json.error);
        return;
      }
      setProjects(Array.isArray(json.items) ? json.items : []);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Impossible de charger les brouillons.");
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setSuccessMessage(null);
    setProjectError(null);
    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/bootstrap", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as MontageBootstrapResponse | null;
      if (!json) {
        setData({ ok: false, error: "invalid_response", message: "Réponse serveur invalide." });
        return;
      }
      setData(json);
      if (json.ok) await loadProjects();
    } catch (error) {
      setData({ ok: false, error: "network_error", message: error instanceof Error ? error.message : "Impossible de charger les données." });
    } finally {
      setLoading(false);
    }
  }, [loadProjects]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const createDraft = React.useCallback(async () => {
    if (!data?.ok) return;
    setCreatingDraft(true);
    setSuccessMessage(null);
    setProjectError(null);

    try {
      const now = new Date();
      const sourceSnapshot = {
        institution: data.institution,
        classes: data.classes,
        subjects: data.subjects,
        teachers: data.teachers,
        periods: data.periods,
        affectations: data.affectations,
        service_assignments: data.service_assignments,
        terrain_rules: data.terrain_rules,
        rooms: data.rooms,
        room_preferences: data.room_preferences || [],
        teacher_unavailability: data.teacher_unavailability,
        saved_at: now.toISOString(),
      };

      const res = await fetch("/api/admin/montage-emploi-du-temps/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Brouillon HoraClasse - ${now.toLocaleDateString("fr-FR")}`,
          status: "draft",
          source_snapshot: sourceSnapshot,
          engine_input: {
            source: "horaclasse_model_bootstrap",
            services_count: data.service_assignments.length,
            ready_services_count: data.service_assignments.filter((item) => item.is_ready).length,
          },
          engine_result: { status: "not_generated_yet", assignments: [] },
          diagnostics: data.warnings.map((message) => ({ level: "warning", message })),
        }),
      });

      const json = (await res.json().catch(() => null)) as
        | { ok: true; item: MontageProject; message?: string }
        | { ok: false; error: string; message?: string }
        | null;

      if (!json) {
        setProjectError("Réponse serveur invalide pendant la création du brouillon.");
        return;
      }
      if (!json.ok) {
        setProjectError(json.message || json.error);
        return;
      }

      setSuccessMessage(json.message || "Brouillon créé avec succès.");
      await loadProjects();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Impossible de créer le brouillon.");
    } finally {
      setCreatingDraft(false);
    }
  }, [data, loadProjects]);

  const generateProject = React.useCallback(async (project: MontageProject) => {
    setGeneratingId(project.id);
    setSuccessMessage(null);
    setProjectError(null);
    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/projects/${project.id}/generate`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as GenerateResponse | null;
      if (!json) {
        setProjectError("Réponse serveur invalide pendant la génération.");
        return;
      }
      if (!json.ok) {
        setProjectError(json.message || json.error);
        return;
      }
      const score = json.result?.summary?.score;
      const placed = json.result?.summary?.assignments_count;
      const unplaced = json.result?.summary?.unplaced_count;
      setSuccessMessage(`Génération HoraClasse terminée : ${placed ?? 0} ligne(s) placée(s), ${unplaced ?? 0} bloc(s) non placé(s), score ${score ?? 0}%.`);
      await loadProjects();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Impossible de générer l’emploi du temps.");
    } finally {
      setGeneratingId(null);
    }
  }, [loadProjects]);

  const isReady = data?.ok === true;
  const serviceCount = data?.ok ? data.service_assignments.length : 0;
  const readyServiceCount = data?.ok ? data.service_assignments.filter((item) => item.is_ready).length : 0;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl space-y-6">
        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 shadow-xl">
          <div className="relative p-6 sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.22),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.18),transparent_32%)]" />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-sky-100">
                  <CalendarDays className="h-4 w-4" />
                  Modèle HoraClasse
                </div>
                <h1 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">Montage emploi du temps</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  HoraClasse intégré à Mon Cahier sans recréer les données : matières et heures, services enseignants, règles terrain, génération et diagnostics.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
                <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 shadow-lg transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Recharger
                </button>
                <button type="button" onClick={() => void createDraft()} disabled={!isReady || creatingDraft || readyServiceCount === 0} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60">
                  {creatingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                  Créer un brouillon
                </button>
              </div>
            </div>
          </div>
        </div>

        {loading && <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700 shadow-sm"><Loader2 className="h-5 w-5 animate-spin" /> Chargement des données HoraClasse...</div>}

        {successMessage && <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-black">Action réussie</p><p className="mt-1 text-sm">{successMessage}</p></div></div></div>}
        {projectError && <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-black">Erreur</p><p className="mt-1 text-sm">{projectError}</p></div></div></div>}

        {!loading && data && !data.ok && <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-black">Impossible de charger le module.</p><p className="mt-1 text-sm">{data.message || data.error}</p></div></div></div>}

        {isReady && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard label="Classes" value={data.classes.length} icon={School} tone="sky" />
              <StatCard label="Matières" value={data.subjects.length} icon={GraduationCap} tone="violet" />
              <StatCard label="Enseignants" value={data.teachers.length} icon={Users} tone="emerald" />
              <StatCard label="Créneaux" value={data.periods.length} icon={CalendarDays} tone="amber" />
              <StatCard label="Services prêts" value={`${readyServiceCount}/${serviceCount}`} icon={Database} tone="slate" />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><CheckCircle2 className="h-6 w-6" /></div><div><h2 className="text-lg font-black">Services HoraClasse détectés</h2><p className="text-sm text-slate-500">Les services viennent uniquement des affectations déjà créées dans Mon Cahier.</p></div></div>
                <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
                  <div className="grid grid-cols-4 bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500"><div>Classe</div><div>Matière</div><div>Enseignant</div><div>Volume</div></div>
                  <div className="max-h-[420px] divide-y divide-slate-100 overflow-auto">
                    {data.service_assignments.slice(0, 120).map((item, index) => (
                      <div key={`${item.class_id}-${item.subject_id}-${item.teacher_id}-${index}`} className="grid grid-cols-4 gap-3 px-4 py-3 text-sm">
                        <div className="truncate font-semibold text-slate-900">{item.class_label}</div>
                        <div className="truncate text-slate-600">{item.subject_label}</div>
                        <div className="truncate text-slate-700">{item.teacher_name}</div>
                        <div className={item.is_ready ? "font-black text-emerald-700" : "font-black text-red-700"}>{item.weekly_units ? `${item.weekly_units}h / ${item.split_pattern}` : "À vérifier"}</div>
                      </div>
                    ))}
                    {data.service_assignments.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-500">Aucun service HoraClasse détecté.</div>}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100"><FileSpreadsheet className="h-6 w-6" /></div><div><h2 className="text-lg font-black">Flux HoraClasse</h2><p className="text-sm text-slate-500">Référentiel → services → règles terrain → génération → diagnostics.</p></div></div>
                  <div className="mt-6 space-y-3 text-sm">
                    <Link href="/admin/montage-emploi-du-temps/volumes" className="block rounded-2xl bg-slate-50 p-4 font-bold text-slate-900 hover:bg-slate-100">Matières et heures</Link>
                    <Link href="/admin/montage-emploi-du-temps/services" className="block rounded-2xl bg-slate-50 p-4 font-bold text-slate-900 hover:bg-slate-100">Services enseignants</Link>
                    <Link href="/admin/montage-emploi-du-temps/creneaux" className="block rounded-2xl bg-slate-50 p-4 font-bold text-slate-900 hover:bg-slate-100">Créneaux officiels</Link>
                    <Link href="/admin/montage-emploi-du-temps/ressources" className="block rounded-2xl bg-slate-50 p-4 font-bold text-slate-900 hover:bg-slate-100">Salles & ressources</Link>
                    <Link href="/admin/montage-emploi-du-temps/regles-terrain" className="block rounded-2xl bg-slate-50 p-4 font-bold text-slate-900 hover:bg-slate-100">Règles terrain HoraClasse</Link>
                    <Link href="/admin/montage-emploi-du-temps/indisponibilites" className="block rounded-2xl bg-slate-50 p-4 font-bold text-slate-900 hover:bg-slate-100">Indisponibilités enseignants</Link>
                    <Link href="/admin/montage-emploi-du-temps/generation" className="block rounded-2xl bg-slate-50 p-4 font-bold text-slate-900 hover:bg-slate-100">Services & génération</Link>
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100"><Clock3 className="h-6 w-6" /></div><div><h2 className="text-lg font-black">Brouillons récents</h2><p className="text-sm text-slate-500">{projects.length} brouillon{projects.length > 1 ? "s" : ""} enregistré{projects.length > 1 ? "s" : ""}</p></div></div>{projectsLoading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}</div>
                  <div className="mt-5 space-y-3">
                    {projects.slice(0, 6).map((project) => {
                      const summary = project.engine_result?.summary;
                      const canGenerate = project.status !== "published";
                      return (
                        <div key={project.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-bold text-slate-950">{project.name}</p><p className="mt-1 text-xs text-slate-500">Modifié le {formatDate(project.updated_at)}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">{getStatusLabel(project.status)}</span></div>
                          {summary && <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-white px-2 py-2 ring-1 ring-slate-200"><p className="font-black text-slate-950">{summary.assignments_count ?? 0}</p><p className="text-slate-500">Lignes</p></div><div className="rounded-xl bg-white px-2 py-2 ring-1 ring-slate-200"><p className="font-black text-slate-950">{summary.unplaced_count ?? 0}</p><p className="text-slate-500">Non placés</p></div><div className="rounded-xl bg-white px-2 py-2 ring-1 ring-slate-200"><p className="font-black text-slate-950">{summary.score ?? 0}%</p><p className="text-slate-500">Score</p></div></div>}
                          <button type="button" onClick={() => void generateProject(project)} disabled={!canGenerate || generatingId === project.id} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">{generatingId === project.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}{project.status === "ready" ? "Regénérer avec HoraClasse" : "Générer avec HoraClasse"}</button>
                          <Link href={`/admin/montage-emploi-du-temps/projets/${project.id}`} className="mt-3 inline-flex w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700">Voir l’emploi du temps</Link>
                        </div>
                      );
                    })}
                    {projects.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">Aucun brouillon. Crée un brouillon quand les services HoraClasse sont prêts.</div>}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
