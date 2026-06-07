"use client";

import Link from "next/link";
import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import MontageSectionShell from "./MontageSectionShell";

type EngineSummary = {
  assignments_count?: number;
  placements_count?: number;
  unplaced_count?: number;
  blocking_diagnostics_count?: number;
  publication_allowed?: boolean;
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

type Project = {
  id: string;
  name: string;
  status: "draft" | "ready" | "published" | "archived";
  created_at: string;
  updated_at: string;
  published_at?: string | null;
  engine_result?: EngineResult | null;
  diagnostics?: unknown[];
};

type ProjectsResponse =
  | { ok: true; items: Project[] }
  | { ok: false; error: string; message?: string };

type PublishResponse =
  | { ok: true; result?: unknown; message?: string }
  | { ok: false; error: string; message?: string };

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusLabel(status: Project["status"]) {
  if (status === "draft") return "Brouillon";
  if (status === "ready") return "Prêt";
  if (status === "published") return "Publié";
  if (status === "archived") return "Archivé";
  return status;
}

function statusClass(status: Project["status"]) {
  if (status === "ready") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (status === "published") return "bg-sky-50 text-sky-700 ring-sky-100";
  if (status === "archived") return "bg-slate-100 text-slate-500 ring-slate-200";
  return "bg-amber-50 text-amber-700 ring-amber-100";
}

function canPublish(project: Project) {
  const summary = project.engine_result?.summary || {};
  const unplaced = Number(summary.unplaced_count ?? project.engine_result?.unplaced?.length ?? 0);
  const blocking = Number(summary.blocking_diagnostics_count ?? 0);
  const publicationAllowed = summary.publication_allowed !== false;

  return project.status === "ready" && publicationAllowed && unplaced === 0 && blocking === 0;
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone: "slate" | "emerald" | "amber" | "sky" }) {
  const tones: Record<typeof tone, string> = {
    slate: "border-slate-200 bg-slate-50 text-slate-950",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-800",
    amber: "border-amber-100 bg-amber-50 text-amber-800",
    sky: "border-sky-100 bg-sky-50 text-sky-800",
  };

  return (
    <div className={`rounded-3xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-black uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

export default function MontagePublicationPage() {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [publishingId, setPublishingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/projects?limit=20", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ProjectsResponse | null;

      if (!json) {
        setError("Réponse serveur invalide pendant le chargement des brouillons.");
        return;
      }

      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }

      setProjects(Array.isArray(json.items) ? json.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les brouillons HoraClasse.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function publish(project: Project) {
    if (!canPublish(project)) {
      setError("Publication bloquée : le brouillon doit être prêt, sans bloc non placé et sans diagnostic bloquant.");
      return;
    }

    const ok = window.confirm(
      `Publier officiellement « ${project.name} » ? Cette action remplacera l’emploi du temps officiel après sauvegarde côté base de données.`,
    );
    if (!ok) return;

    setPublishingId(project.id);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: project.id }),
      });
      const json = (await res.json().catch(() => null)) as PublishResponse | null;

      if (!json) {
        setError("Réponse serveur invalide pendant la publication.");
        return;
      }

      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }

      setSuccess(json.message || "Emploi du temps publié officiellement.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de publier l’emploi du temps.");
    } finally {
      setPublishingId(null);
    }
  }

  const readyCount = projects.filter((project) => project.status === "ready").length;
  const publishedCount = projects.filter((project) => project.status === "published").length;
  const draftCount = projects.filter((project) => project.status === "draft").length;
  const publishableCount = projects.filter(canPublish).length;

  return (
    <MontageSectionShell
      title="Publication"
      description="Publier uniquement après validation du vrai résultat HoraClasse et sauvegarde de l’ancien emploi du temps officiel. La publication est manuelle et bloquée s’il reste une anomalie bloquante."
      status="Sécurité Mon Cahier"
      note="La publication ne crée pas de données parallèles : elle écrit dans teacher_timetables uniquement après un brouillon prêt, sans conflit classe/professeur/salle et sans bloc non placé."
      cards={[
        {
          title: "Validation obligatoire",
          description: "Aucun conflit classe/professeur/salle et aucun champ obligatoire manquant.",
        },
        {
          title: "Sauvegarde côté base",
          description: "La route appelle la RPC montage_publish_timetable prévue pour sauvegarder puis remplacer l’officiel.",
        },
        {
          title: "Écriture officielle",
          description: "Seule la publication écrit dans teacher_timetables et alimente les appels.",
        },
      ]}
    >
      <div className="space-y-5">
        <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Publication officielle</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Brouillons disponibles</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                Seuls les brouillons au statut prêt peuvent être publiés. Les autres restent consultables pour corriger les diagnostics.
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

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Publiables" value={publishableCount} tone="emerald" />
            <StatCard label="Prêts" value={readyCount} tone="sky" />
            <StatCard label="À revoir" value={draftCount} tone="amber" />
            <StatCard label="Déjà publiés" value={publishedCount} tone="slate" />
          </div>

          {success && (
            <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
              <div className="flex gap-3"><CheckCircle2 className="h-5 w-5 shrink-0" /><p>{success}</p></div>
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-3xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
              <div className="flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0" /><p>{error}</p></div>
            </div>
          )}

          {loading ? (
            <div className="mt-6 flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm font-bold text-slate-600"><Loader2 className="h-5 w-5 animate-spin" /> Chargement des brouillons...</div>
          ) : (
            <div className="mt-6 space-y-4">
              {projects.map((project) => {
                const summary = project.engine_result?.summary || {};
                const unplaced = Number(summary.unplaced_count ?? project.engine_result?.unplaced?.length ?? 0);
                const blocking = Number(summary.blocking_diagnostics_count ?? 0);
                const assignments = Number(summary.assignments_count ?? project.engine_result?.assignments?.length ?? 0);
                const publishable = canPublish(project);

                return (
                  <div key={project.id} className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <ShieldCheck className="h-5 w-5 text-slate-400" />
                          <h3 className="font-black text-slate-950">{project.name}</h3>
                          <span className={`rounded-full px-3 py-1 text-xs font-black ring-1 ${statusClass(project.status)}`}>{statusLabel(project.status)}</span>
                        </div>
                        <p className="mt-2 text-xs font-semibold text-slate-500">
                          Modifié le {formatDate(project.updated_at)} {project.published_at ? `• publié le ${formatDate(project.published_at)}` : ""}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Link href={`/admin/montage-emploi-du-temps/projets/${project.id}`} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-800 ring-1 ring-slate-200 transition hover:bg-slate-100">
                          <Eye className="h-4 w-4" />
                          Voir
                        </Link>
                        <button
                          type="button"
                          onClick={() => void publish(project)}
                          disabled={!publishable || publishingId === project.id}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {publishingId === project.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          Publier
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200"><p className="text-lg font-black text-slate-950">{assignments}</p><p className="text-xs font-bold text-slate-500">Lignes prêtes</p></div>
                      <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200"><p className="text-lg font-black text-slate-950">{unplaced}</p><p className="text-xs font-bold text-slate-500">Blocs non placés</p></div>
                      <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200"><p className="text-lg font-black text-slate-950">{blocking}</p><p className="text-xs font-bold text-slate-500">Diagnostics bloquants</p></div>
                    </div>

                    {!publishable && project.status !== "published" && (
                      <p className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
                        Publication désactivée : régénérer ou corriger le brouillon jusqu’au statut prêt, sans bloc non placé et sans diagnostic bloquant.
                      </p>
                    )}
                  </div>
                );
              })}

              {projects.length === 0 && (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                  <p className="font-black text-slate-800">Aucun brouillon disponible</p>
                  <p className="mt-1 text-sm text-slate-500">Génère d’abord un brouillon HoraClasse, puis reviens ici pour publier.</p>
                  <Link href="/admin/montage-emploi-du-temps/generation" className="mt-4 inline-flex rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white">Aller à la génération</Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </MontageSectionShell>
  );
}
