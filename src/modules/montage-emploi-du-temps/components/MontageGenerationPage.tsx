"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  Edit3,
  Eye,
  FileSpreadsheet,
  Gauge,
  GraduationCap,
  Loader2,
  PlayCircle,
  RefreshCw,
  School,
  ShieldCheck,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";

type ServiceAssignment = {
  class_id?: string;
  class_label?: string;
  subject_id?: string;
  subject_label?: string;
  teacher_id?: string;
  teacher_name?: string;
  weekly_units?: number | null;
  split_pattern?: string | null;
  is_ready?: boolean;
  missing_reason?: string | null;
};

type BootstrapOk = {
  ok: true;
  institution: Record<string, unknown>;
  classes: unknown[];
  subjects: unknown[];
  teachers: unknown[];
  periods: unknown[];
  affectations: unknown[];
  service_assignments: ServiceAssignment[];
  terrain_rules: Record<string, unknown> | null;
  rooms: unknown[];
  room_preferences?: unknown[];
  teacher_unavailability: unknown[];
  warnings?: string[];
};

type BootstrapResponse =
  | BootstrapOk
  | {
      ok: false;
      error: string;
      message?: string;
    };

type EngineSummary = {
  assignments_count?: number;
  placements_count?: number;
  unplaced_count?: number;
  blocking_diagnostics_count?: number;
  score?: number;
};

type EngineResult = {
  status?: string;
  generated_at?: string;
  summary?: EngineSummary;
  assignments?: unknown[];
  unplaced?: unknown[];
  diagnostics?: Array<{ level?: string; message?: string }>;
};

type Project = {
  id: string;
  name: string;
  status: "draft" | "ready" | "published" | "archived";
  created_at: string;
  updated_at: string;
  engine_result?: EngineResult | null;
  diagnostics?: Array<{ level?: string; message?: string }>;
};

type ProjectsResponse =
  | { ok: true; items: Project[] }
  | { ok: false; error: string; message?: string };

type ProjectCreateResponse =
  | { ok: true; item: Project; message?: string }
  | { ok: false; error: string; message?: string };

type GenerateResponse =
  | { ok: true; item: Project; result: EngineResult; message?: string }
  | { ok: false; error: string; message?: string };

type DeleteResponse =
  | { ok: true; deleted_id?: string; deleted_count?: number; message?: string }
  | { ok: false; error: string; message?: string };

type CheckStatus = "ready" | "warning" | "blocked";

type ReadinessCheck = {
  label: string;
  value: string;
  status: CheckStatus;
  message: string;
  href?: string;
};

type GenerationPhase = "creating" | "generating" | "regenerating";

type GenerationUiState = {
  active: boolean;
  startedAt: number;
  attempt: number;
  stageIndex: number;
  label: string;
  phase: GenerationPhase;
};

type GenerationStage = {
  title: string;
  description: string;
};

const GENERATION_STAGES: GenerationStage[] = [
  {
    title: "Lecture des données officielles",
    description: "Classes, matières, enseignants, affectations, créneaux, salles et indisponibilités sont préparés.",
  },
  {
    title: "Analyse des contraintes ACE",
    description: "HoraClasse contrôle les blocs de 2h, les récréations, les demi-journées et les règles terrain.",
  },
  {
    title: "Essais de placement",
    description: "Le moteur teste plusieurs stratégies et garde progressivement le meilleur montage.",
  },
  {
    title: "Réduction des trous élèves",
    description: "Les heures creuses, retours isolés et reprises séparées de matière sont pénalisés ou bloqués.",
  },
  {
    title: "Contrôle professeurs et ressources",
    description: "Les conflits professeurs, salles, laboratoires et terrains EPS sont vérifiés.",
  },
  {
    title: "Diagnostic final",
    description: "Le brouillon est classé prêt ou maintenu en brouillon si des règles bloquantes restent présentes.",
  },
];

function formatDate(value?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
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

function cleanText(value: unknown, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatElapsedTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function phaseLabel(phase: GenerationPhase) {
  if (phase === "creating") return "Création du brouillon";
  if (phase === "regenerating") return "Régénération HoraClasse";
  return "Génération HoraClasse";
}


function getQualityIndex(summary?: EngineSummary | null) {
  const score = Number(summary?.score ?? 0);
  const unplaced = Number(summary?.unplaced_count ?? 0);
  const blocking = Number(summary?.blocking_diagnostics_count ?? 0);

  if (unplaced > 0 || blocking > 0) return "À améliorer";
  if (!Number.isFinite(score) || score <= 3500) return "Bon";
  if (score <= 9000) return "Moyen";
  return "À améliorer";
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
      return;
    }

    setTimeout(resolve, 0);
  });
}

function buildInvalidServerResponseMessage(response: Response, bodyText: string, actionLabel: string) {
  const compactBody = bodyText.trim().replace(/\s+/g, " ").slice(0, 220);
  const statusPart = `HTTP ${response.status || "inconnu"}`;

  if (response.status === 504 || response.status === 502 || response.status === 500) {
    return `${actionLabel} : le serveur a renvoyé ${statusPart} au lieu d’un JSON. La génération a probablement dépassé le temps disponible côté serveur. Le moteur a été borné pour éviter ce cas ; relance après le dernier correctif puis consulte les logs Vercel si cela persiste.`;
  }

  return `${actionLabel} : réponse serveur non JSON (${statusPart}). ${compactBody ? `Début de réponse : ${compactBody}` : "Aucun détail reçu."}`;
}

async function readApiJson<T>(response: Response, actionLabel: string): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(`${actionLabel} : réponse serveur vide (HTTP ${response.status || "inconnu"}).`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(buildInvalidServerResponseMessage(response, text, actionLabel));
  }
}

function GenerationThinkingOverlay({
  state,
  classesCount,
  servicesCount,
  periodsCount,
}: {
  state: GenerationUiState;
  classesCount: number;
  servicesCount: number;
  periodsCount: number;
}) {
  if (!state.active) return null;

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
  const stage = GENERATION_STAGES[state.stageIndex] || GENERATION_STAGES[0];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-md" role="status" aria-live="polite">
      <div className="w-full max-w-2xl overflow-hidden rounded-[34px] border border-white/70 bg-white shadow-2xl shadow-slate-950/30">
        <div className="relative p-6 text-center sm:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.14),transparent_32%)]" />
          <div className="relative">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-100/70">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
            </div>

            <p className="mt-5 text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
              HoraClasse réfléchit
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              {phaseLabel(state.phase)} en cours…
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm font-semibold leading-6 text-slate-600">
              {state.label || "Le moteur cherche le meilleur montage possible sans publier automatiquement."}
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4">
                <p className="text-2xl font-black text-slate-950">{state.attempt}</p>
                <p className="mt-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Tentative</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4">
                <p className="text-2xl font-black text-slate-950">{formatElapsedTime(elapsedSeconds)}</p>
                <p className="mt-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Temps</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4">
                <p className="text-2xl font-black text-slate-950">{servicesCount}</p>
                <p className="mt-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Services</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-4">
                <p className="text-2xl font-black text-slate-950">{classesCount}</p>
                <p className="mt-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Classes</p>
              </div>
            </div>

            <div className="mt-5 rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-left">
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div>
                  <p className="font-black text-emerald-950">{stage.title}</p>
                  <p className="mt-1 text-sm leading-6 text-emerald-900/80">{stage.description}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs font-bold text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">{periodsCount} créneaux</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">Règles ACE</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">Aucune publication automatique</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const toneClasses = {
    slate: "border-slate-200 bg-white text-slate-950",
    sky: "border-sky-100 bg-sky-50 text-sky-950",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-950",
    amber: "border-amber-100 bg-amber-50 text-amber-950",
    violet: "border-violet-100 bg-violet-50 text-violet-950",
  }[tone];

  return (
    <div className={`rounded-[28px] border p-5 shadow-sm ${toneClasses}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold opacity-70">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight">{value}</p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/80 shadow-sm ring-1 ring-black/5">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

function CheckBadge({ status }: { status: CheckStatus }) {
  if (status === "ready") {
    return <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">OK</span>;
  }
  if (status === "warning") {
    return <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">À vérifier</span>;
  }
  return <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-800">Bloquant</span>;
}

function buildChecks(data: BootstrapOk | null): ReadinessCheck[] {
  if (!data) return [];

  const serviceCount = Array.isArray(data.service_assignments) ? data.service_assignments.length : 0;
  const readyServices = data.service_assignments.filter((item) => item.is_ready).length;
  const missingServices = Math.max(0, serviceCount - readyServices);
  const roomsCount = Array.isArray(data.rooms) ? data.rooms.length : 0;
  const warnings = Array.isArray(data.warnings) ? data.warnings.length : 0;

  return [
    {
      label: "Classes Mon Cahier",
      value: String(data.classes.length),
      status: data.classes.length > 0 ? "ready" : "blocked",
      message: data.classes.length > 0 ? "Classes détectées depuis Mon Cahier." : "Aucune classe détectée.",
      href: "/admin/classes",
    },
    {
      label: "Créneaux officiels",
      value: String(data.periods.length),
      status: data.periods.length > 0 ? "ready" : "blocked",
      message: data.periods.length > 0 ? "Les créneaux viennent de institution_periods." : "Configure d'abord les créneaux officiels Mon Cahier.",
      href: "/admin/montage-emploi-du-temps/creneaux",
    },
    {
      label: "Services enseignants",
      value: `${readyServices}/${serviceCount}`,
      status: serviceCount > 0 && missingServices === 0 ? "ready" : "blocked",
      message:
        serviceCount === 0
          ? "Aucun service détecté à partir des affectations existantes."
          : missingServices === 0
            ? "Tous les services ont un volume et un découpage exploitables."
            : `${missingServices} service(s) doivent être complétés avant génération.`,
      href: "/admin/montage-emploi-du-temps/services",
    },
    {
      label: "Salles et ressources",
      value: String(roomsCount),
      status: roomsCount > 0 ? "ready" : "warning",
      message: roomsCount > 0 ? "Ressources disponibles pour le moteur." : "Le moteur pourra générer, mais sans occupation de salles détaillée.",
      href: "/admin/montage-emploi-du-temps/ressources",
    },
    {
      label: "Alertes de préparation",
      value: String(warnings),
      status: warnings === 0 ? "ready" : "warning",
      message: warnings === 0 ? "Aucune alerte de préparation." : "Des points doivent être vérifiés avant validation finale.",
    },
  ];
}

function makeSourceSnapshot(data: BootstrapOk) {
  return {
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
    saved_at: new Date().toISOString(),
    source: "mon_cahier_official_data",
  };
}

export default function MontageGenerationPage() {
  const router = useRouter();
  const [bootstrap, setBootstrap] = React.useState<BootstrapResponse | null>(null);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [projectsLoading, setProjectsLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [generatingId, setGeneratingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [generationUi, setGenerationUi] = React.useState<GenerationUiState>({
    active: false,
    startedAt: 0,
    attempt: 1,
    stageIndex: 0,
    label: "",
    phase: "generating",
  });

  const startGenerationUi = React.useCallback((label: string, phase: GenerationPhase) => {
    setGenerationUi({
      active: true,
      startedAt: Date.now(),
      attempt: 1,
      stageIndex: 0,
      label,
      phase,
    });
  }, []);

  const updateGenerationUi = React.useCallback((patch: Partial<Omit<GenerationUiState, "active" | "startedAt" | "attempt" | "stageIndex">>) => {
    setGenerationUi((current) => (current.active ? { ...current, ...patch } : current));
  }, []);

  const stopGenerationUi = React.useCallback(() => {
    setGenerationUi((current) => ({ ...current, active: false }));
  }, []);

  React.useEffect(() => {
    if (!generationUi.active) return undefined;

    const timer = window.setInterval(() => {
      setGenerationUi((current) => {
        if (!current.active) return current;

        const elapsedMs = Math.max(0, Date.now() - current.startedAt);
        return {
          ...current,
          attempt: Math.max(1, Math.floor(elapsedMs / 1600) + 1),
          stageIndex: Math.floor(elapsedMs / 5200) % GENERATION_STAGES.length,
        };
      });
    }, 700);

    return () => window.clearInterval(timer);
  }, [generationUi.active]);

  const loadProjects = React.useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/projects", { cache: "no-store" });
      const json = await readApiJson<ProjectsResponse>(res, "Chargement des brouillons");
      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }
      setProjects(Array.isArray(json.items) ? json.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les brouillons.");
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/bootstrap", { cache: "no-store" });
      const json = await readApiJson<BootstrapResponse>(res, "Préparation de la génération");
      setBootstrap(json);
      await loadProjects();
    } catch (err) {
      setBootstrap({
        ok: false,
        error: "network_error",
        message: err instanceof Error ? err.message : "Impossible de charger les données de génération.",
      });
    } finally {
      setLoading(false);
    }
  }, [loadProjects]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const data = bootstrap?.ok ? bootstrap : null;
  const checks = React.useMemo(() => buildChecks(data), [data]);
  const blockingCount = checks.filter((item) => item.status === "blocked").length;
  const warningCount = checks.filter((item) => item.status === "warning").length;
  const canGenerate = Boolean(data && blockingCount === 0);
  const serviceCount = data?.service_assignments.length || 0;
  const readyServices = data?.service_assignments.filter((item) => item.is_ready).length || 0;
  const warnings = data?.warnings || [];

  const createAndGenerate = React.useCallback(async () => {
    if (!data || !canGenerate) return;

    setCreating(true);
    setError(null);
    setNotice(null);
    startGenerationUi("Création du brouillon puis lancement du moteur HoraClasse.", "creating");
    await waitForNextPaint();

    try {
      const now = new Date();
      const sourceSnapshot = makeSourceSnapshot(data);
      const createRes = await fetch("/api/admin/montage-emploi-du-temps/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Brouillon HoraClasse - ${now.toLocaleDateString("fr-FR")} ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`,
          status: "draft",
          source_snapshot: sourceSnapshot,
          engine_input: {
            source: "mon_cahier_bootstrap",
            classes_count: data.classes.length,
            teachers_count: data.teachers.length,
            periods_count: data.periods.length,
            services_count: data.service_assignments.length,
          },
          engine_result: { status: "not_generated_yet", assignments: [], unplaced: [] },
          diagnostics: warnings.map((message) => ({ level: "warning", message })),
        }),
      });

      const created = await readApiJson<ProjectCreateResponse>(createRes, "Création du brouillon");
      if (!created.ok) {
        setError(created.message || created.error);
        return;
      }

      setGeneratingId(created.item.id);
      updateGenerationUi({
        label: created.item.name || "Le moteur cherche le meilleur brouillon possible.",
        phase: "generating",
      });
      await waitForNextPaint();
      const generateRes = await fetch(`/api/admin/montage-emploi-du-temps/projects/${created.item.id}/generate`, {
        method: "POST",
      });
      const generated = await readApiJson<GenerateResponse>(generateRes, "Génération du brouillon");
      if (!generated.ok) {
        setError(generated.message || generated.error);
        await loadProjects();
        return;
      }

      const summary = generated.result?.summary || {};
      setNotice(
        `Génération terminée : ${summary.assignments_count ?? 0} ligne(s) placée(s), ${summary.unplaced_count ?? 0} bloc(s) à revoir, indice de qualité : ${getQualityIndex(summary)}.`,
      );
      await loadProjects();
      router.push(`/admin/montage-emploi-du-temps/projets/${generated.item.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer et générer le brouillon.");
    } finally {
      stopGenerationUi();
      setGeneratingId(null);
      setCreating(false);
    }
  }, [canGenerate, data, loadProjects, router, startGenerationUi, stopGenerationUi, updateGenerationUi, warnings]);

  const generateExistingProject = React.useCallback(async (project: Project) => {
    setGeneratingId(project.id);
    setError(null);
    setNotice(null);
    startGenerationUi(project.name || "Régénération du brouillon HoraClasse.", "regenerating");
    await waitForNextPaint();
    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/projects/${project.id}/generate`, { method: "POST" });
      const json = await readApiJson<GenerateResponse>(res, "Génération du brouillon");
      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }
      const summary = json.result?.summary || {};
      setNotice(
        `Génération terminée : ${summary.assignments_count ?? 0} ligne(s) placée(s), ${summary.unplaced_count ?? 0} bloc(s) à revoir, indice de qualité : ${getQualityIndex(summary)}.`,
      );
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de générer ce brouillon.");
    } finally {
      stopGenerationUi();
      setGeneratingId(null);
    }
  }, [loadProjects, startGenerationUi, stopGenerationUi]);

  const deleteProject = React.useCallback(async (project: Project) => {
    if (project.status === "published") {
      setError("Un emploi du temps publié ne peut pas être supprimé depuis les brouillons.");
      return;
    }

    const ok = window.confirm(`Supprimer définitivement le brouillon « ${project.name} » ?`);
    if (!ok) return;

    setDeletingId(project.id);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/projects/${project.id}`, {
        method: "DELETE",
      });
      const json = await readApiJson<DeleteResponse>(res, "Suppression du brouillon");

      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }

      setNotice(json.message || "Brouillon supprimé.");
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de supprimer le brouillon.");
    } finally {
      setDeletingId(null);
    }
  }, [loadProjects]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl space-y-6">
        <Link href="/admin/montage-emploi-du-temps" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          Retour à la vue d’ensemble
        </Link>

        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 shadow-xl">
          <div className="relative p-6 sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.22),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.18),transparent_32%)]" />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-sky-100">
                  <Wand2 className="h-4 w-4" />
                  Génération HoraClasse
                </div>
                <h1 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">
                  Générer un brouillon d’emploi du temps
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  Le moteur utilise uniquement les données officielles de Mon Cahier : classes, matières, enseignants, affectations, créneaux, salles, règles terrain et indisponibilités.
                </p>
                <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-black text-slate-950">
                  <ShieldCheck className="h-4 w-4" />
                  Aucun cours n’est publié automatiquement
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-lg transition hover:bg-slate-100 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Recharger
                </button>
                <button
                  type="button"
                  onClick={() => void createAndGenerate()}
                  disabled={!canGenerate || creating || Boolean(generatingId)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating || generatingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                  Créer et générer
                </button>
              </div>
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement des données officielles Mon Cahier...
          </div>
        )}

        {error && (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-black">Action impossible</p>
                <p className="mt-1 text-sm">{error}</p>
              </div>
            </div>
          </div>
        )}

        {notice && (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-black">Génération terminée</p>
                <p className="mt-1 text-sm">{notice}</p>
              </div>
            </div>
          </div>
        )}

        {!loading && bootstrap && !bootstrap.ok && (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-black">Impossible de préparer la génération</p>
                <p className="mt-1 text-sm">{bootstrap.message || bootstrap.error}</p>
              </div>
            </div>
          </div>
        )}

        {data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard label="Classes" value={data.classes.length} icon={School} tone="sky" />
              <StatCard label="Matières" value={data.subjects.length} icon={GraduationCap} tone="violet" />
              <StatCard label="Enseignants" value={data.teachers.length} icon={Users} tone="emerald" />
              <StatCard label="Créneaux" value={data.periods.length} icon={CalendarDays} tone="amber" />
              <StatCard label="Services prêts" value={`${readyServices}/${serviceCount}`} icon={Database} tone="slate" />
            </div>

            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-6">
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="flex items-center gap-2 text-xl font-black text-slate-950">
                        <Gauge className="h-5 w-5 text-slate-500" />
                        Contrôle avant génération
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        Les éléments bloquants doivent être corrigés avant de créer un brouillon.
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right ring-1 ring-slate-200">
                      <p className="text-xs font-black uppercase tracking-wide text-slate-500">État</p>
                      <p className={blockingCount === 0 ? "text-lg font-black text-emerald-700" : "text-lg font-black text-red-700"}>
                        {blockingCount === 0 ? "Prêt" : `${blockingCount} blocage(s)`}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    {checks.map((item) => (
                      <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-black text-slate-950">{item.label}</p>
                              <CheckBadge status={item.status} />
                            </div>
                            <p className="mt-1 text-sm leading-6 text-slate-600">{item.message}</p>
                          </div>
                          <p className="text-2xl font-black text-slate-950">{item.value}</p>
                        </div>
                        {item.href ? (
                          <Link href={item.href} className="mt-3 inline-flex rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:text-slate-950">
                            Corriger / vérifier
                          </Link>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                {warnings.length > 0 && (
                  <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <h2 className="font-black">Alertes de préparation</h2>
                        <div className="mt-3 space-y-2 text-sm leading-6">
                          {warnings.slice(0, 12).map((message, index) => (
                            <p key={`${message}-${index}`}>• {message}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="flex items-center gap-2 text-xl font-black text-slate-950">
                        <FileSpreadsheet className="h-5 w-5 text-slate-500" />
                        Brouillons générés
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        Un brouillon peut être généré, consulté, corrigé puis publié plus tard.
                      </p>
                    </div>
                    {projectsLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : null}
                  </div>

                  <div className="mt-5 space-y-3">
                    {projects.slice(0, 8).map((project) => {
                      const summary = project.engine_result?.summary || {};
                      const canRegenerate = project.status !== "published";
                      return (
                        <div key={project.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate font-black text-slate-950">{project.name}</p>
                              <p className="mt-1 text-xs font-semibold text-slate-500">Modifié le {formatDate(project.updated_at)}</p>
                            </div>
                            <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 ring-1 ring-slate-200">
                              {statusLabel(project.status)}
                            </span>
                          </div>

                          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                            <div className="rounded-xl bg-white px-2 py-2 ring-1 ring-slate-200">
                              <p className="font-black text-slate-950">{summary.assignments_count ?? 0}</p>
                              <p className="text-slate-500">Lignes</p>
                            </div>
                            <div className="rounded-xl bg-white px-2 py-2 ring-1 ring-slate-200">
                              <p className="font-black text-slate-950">{summary.unplaced_count ?? 0}</p>
                              <p className="text-slate-500">À revoir</p>
                            </div>
                            <div className="rounded-xl bg-white px-2 py-2 ring-1 ring-slate-200">
                              <p className="font-black text-slate-950">{getQualityIndex(summary)}</p>
                              <p className="text-slate-500">Indice qualité</p>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-2 sm:grid-cols-4">
                            <button
                              type="button"
                              onClick={() => void generateExistingProject(project)}
                              disabled={!canRegenerate || Boolean(generatingId) || Boolean(deletingId)}
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {generatingId === project.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                              {project.status === "ready" ? "Regénérer" : "Générer"}
                            </button>
                            <Link
                              href={`/admin/montage-emploi-du-temps/projets/${project.id}`}
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-900 ring-1 ring-slate-200 transition hover:bg-slate-100"
                            >
                              <Eye className="h-4 w-4" />
                              Voir
                            </Link>
                            <Link
                              href={`/admin/montage-emploi-du-temps/projets/${project.id}/editor`}
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700"
                            >
                              <Edit3 className="h-4 w-4" />
                              Modifier
                            </Link>
                            <button
                              type="button"
                              onClick={() => void deleteProject(project)}
                              disabled={project.status === "published" || deletingId === project.id || Boolean(generatingId)}
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-red-700 ring-1 ring-red-200 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {deletingId === project.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                              Supprimer
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {projects.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
                        Aucun brouillon. Quand les contrôles sont prêts, clique sur “Créer et générer”.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[28px] border border-sky-200 bg-sky-50 p-6 text-sky-950 shadow-sm">
                  <h2 className="font-black">Rappel important</h2>
                  <p className="mt-2 text-sm leading-6">
                    Cette étape produit seulement un brouillon. La publication dans les emplois du temps officiels Mon Cahier se fera dans l’étape suivante, après contrôle des diagnostics.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      <GenerationThinkingOverlay
        state={generationUi}
        classesCount={data?.classes.length || 0}
        servicesCount={serviceCount}
        periodsCount={data?.periods.length || 0}
      />
    </main>
  );
}
