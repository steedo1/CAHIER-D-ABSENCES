"use client";

import Link from "next/link";
import React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  GripVertical,
  Loader2,
  Megaphone,
  MousePointerClick,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";

type AnyRecord = Record<string, any>;

type Assignment = {
  id?: string;
  block_id?: string;
  lesson_block_id?: string;
  class_id?: string;
  class_label?: string;
  teacher_id?: string;
  teacher_name?: string;
  subject_id?: string;
  subject_label?: string;
  scheduler_subject_id?: string;
  catalog_subject_id?: string;
  weekday?: number;
  period_no?: number;
  period_label?: string;
  start_time?: string | null;
  end_time?: string | null;
  duration_units?: number;
  duration_slots?: number;
  duration_slot_index?: number;
  room_id?: string | null;
  room_label?: string | null;
  source?: string;
};

type EngineResult = {
  status?: string;
  generated_at?: string;
  manually_updated_at?: string;
  summary?: {
    assignments_count?: number;
    placements_count?: number;
    unplaced_count?: number;
    blocking_diagnostics_count?: number;
    score?: number;
    publication_allowed?: boolean;
    manual_edits?: boolean;
  };
  assignments?: Assignment[];
  unplaced?: Assignment[];
  diagnostics?: Array<{ level?: string; message?: string; warning_type?: string }>;
};

type SourceSnapshot = {
  periods?: AnyRecord[];
  rooms?: AnyRecord[];
  classes?: AnyRecord[];
  teachers?: AnyRecord[];
  subjects?: AnyRecord[];
  service_assignments?: AnyRecord[];
  institution?: AnyRecord | null;
  establishment?: AnyRecord | null;
};

type Project = {
  id: string;
  name: string;
  status: "draft" | "ready" | "published" | "archived";
  source_snapshot?: SourceSnapshot | null;
  engine_result?: EngineResult | null;
  diagnostics?: Array<{ level?: string; message?: string; warning_type?: string }>;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
};

type ProjectResponse =
  | { ok: true; item: Project }
  | { ok: false; error: string; message?: string };

type DraftActionResponse =
  | { ok: true; item: Project; message?: string }
  | { ok: false; error: string; message?: string };

type PeriodRow = {
  period_no: number;
  label: string;
  start_time: string;
  end_time: string;
};

type PlacedBlock = {
  key: string;
  first: Assignment;
  rows: Assignment[];
  start: number;
  end: number;
  duration: number;
};

type DragPayload =
  | { kind: "placed"; block_id: string }
  | { kind: "unplaced"; unplaced_id: string };

type AddModalState = {
  weekday: number;
  period_no: number;
  class_id: string;
  service_key: string;
  room_id: string;
  duration_units: number;
};

type EditModalState = {
  block_id: string;
  weekday: number;
  period_no: number;
  room_id: string;
};

const WEEKDAYS: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  7: "Dimanche",
};

function clean(value: unknown, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function blank(value: unknown) {
  return String(value ?? "").trim();
}

function num(value: unknown, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function timeToMinutes(value?: string | null) {
  const match = blank(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function shortTime(value?: string | null) {
  return blank(value).replace(":", "H");
}

function periodLabel(period: PeriodRow) {
  const start = shortTime(period.start_time);
  const end = shortTime(period.end_time);
  if (start && end) return `${start}-${end}`;
  return period.label || `Séance ${period.period_no}`;
}

function dayLabel(day: number) {
  return WEEKDAYS[day] || `Jour ${day}`;
}

function formatDate(value?: string | null) {
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

function getBlockKey(item: Assignment) {
  return blank(item.block_id || item.lesson_block_id || item.id);
}

function getSchedulerSubjectId(item: Assignment | AnyRecord) {
  return blank(item.catalog_subject_id || item.scheduler_subject_id || item.subject_id);
}

function serviceKey(item: AnyRecord) {
  return [
    blank(item.class_id),
    blank(item.teacher_id),
    blank(item.catalog_subject_id || item.scheduler_subject_id || item.subject_id),
  ].join("::");
}

function getClassLabel(item: AnyRecord) {
  return clean(item.label || item.name || item.class_label || item.shortName || item.short_name, "Classe");
}

function getClassId(item: AnyRecord) {
  return blank(item.id || item.class_id);
}

function getRoomId(item: AnyRecord) {
  return blank(item.id || item.room_id || item.resource_id);
}

function getRoomLabel(item: AnyRecord) {
  return clean(item.name || item.label || item.room_label, "Salle");
}

function getServiceLabel(item: AnyRecord) {
  return [
    clean(item.subject_label || item.catalog_subject_label || item.subject_name, "Matière"),
    clean(item.teacher_name || item.teacher_label || item.display_name, "Enseignant"),
    `${num(item.weekly_units, 0) || "?"}h`,
  ].join(" — ");
}

function getSnapshotClasses(snapshot?: SourceSnapshot | null) {
  return Array.isArray(snapshot?.classes) ? snapshot?.classes || [] : [];
}

function getSnapshotRooms(snapshot?: SourceSnapshot | null) {
  return Array.isArray(snapshot?.rooms) ? snapshot?.rooms || [] : [];
}

function getSnapshotServices(snapshot?: SourceSnapshot | null) {
  return Array.isArray(snapshot?.service_assignments)
    ? snapshot?.service_assignments || []
    : [];
}

function getDays(snapshot?: SourceSnapshot | null, assignments: Assignment[] = []) {
  const fromPeriods = Array.from(
    new Set(
      (Array.isArray(snapshot?.periods) ? snapshot?.periods || [] : [])
        .map((item) => num(item.weekday, 0))
        .filter((day) => day >= 1 && day <= 7),
    ),
  ).sort((a, b) => a - b);

  if (fromPeriods.length > 0) return fromPeriods;

  const fromAssignments = Array.from(
    new Set(assignments.map((item) => num(item.weekday, 0)).filter((day) => day >= 1 && day <= 7)),
  ).sort((a, b) => a - b);

  return fromAssignments.length > 0 ? fromAssignments : [1, 2, 3, 4, 5];
}

function getPeriods(snapshot?: SourceSnapshot | null, assignments: Assignment[] = []) {
  const byNo = new Map<number, PeriodRow>();

  for (const item of Array.isArray(snapshot?.periods) ? snapshot?.periods || [] : []) {
    const periodNo = num(item.period_no, 0);
    if (!periodNo || byNo.has(periodNo)) continue;
    byNo.set(periodNo, {
      period_no: periodNo,
      label: clean(item.label, `Séance ${periodNo}`),
      start_time: blank(item.start_time),
      end_time: blank(item.end_time),
    });
  }

  if (byNo.size === 0) {
    for (const item of assignments) {
      const periodNo = num(item.period_no, 0);
      if (!periodNo || byNo.has(periodNo)) continue;
      byNo.set(periodNo, {
        period_no: periodNo,
        label: clean(item.period_label, `Séance ${periodNo}`),
        start_time: blank(item.start_time),
        end_time: blank(item.end_time),
      });
    }
  }

  return Array.from(byNo.values()).sort((a, b) => {
    const at = timeToMinutes(a.start_time);
    const bt = timeToMinutes(b.start_time);
    if (at && bt && at !== bt) return at - bt;
    return a.period_no - b.period_no;
  });
}

function getPlacedBlocks(assignments: Assignment[]) {
  const grouped = new Map<string, Assignment[]>();

  for (const item of assignments) {
    const key = getBlockKey(item);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }

  return Array.from(grouped.entries()).map(([key, rows]) => {
    const sorted = [...rows].sort((a, b) => num(a.period_no, 0) - num(b.period_no, 0));
    const first = sorted[0] || {};
    const start = num(first.period_no, 0);
    const duration = Math.max(
      1,
      Math.ceil(num(first.duration_slots, 0) || num(first.duration_units, 0) || sorted.length || 1),
    );
    return { key, first, rows: sorted, start, end: start + duration, duration };
  });
}

function blockIsInCell(block: PlacedBlock, weekday: number, periodNo: number) {
  return num(block.first.weekday, 0) === weekday && periodNo >= block.start && periodNo < block.end;
}

function getUnplacedId(item: Assignment) {
  return blank(item.id || item.lesson_block_id || item.block_id);
}

function isBlockingDiagnostic(item: { level?: string; warning_type?: string }) {
  const level = String(item.level || "").toLowerCase();
  return level === "error" || level === "critical";
}

function isWarningDiagnostic(item: { level?: string; warning_type?: string }) {
  if (isBlockingDiagnostic(item)) return false;
  const level = String(item.level || "").toLowerCase();
  return level === "warning" || level === "warn" || Boolean(item.warning_type);
}

function diagnosticCardClass(item: { level?: string; warning_type?: string }) {
  if (isBlockingDiagnostic(item)) return "border-red-200 bg-red-50 text-red-950";
  if (isWarningDiagnostic(item)) return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function DragHint() {
  return (
    <div className="rounded-3xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <div className="flex gap-3">
        <MousePointerClick className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="font-semibold leading-6">
          Clique dans une case vide pour ajouter une séance. Glisse une séance déjà placée vers une autre case pour la déplacer. Les blocs non placés et les alertes s’ouvrent maintenant à la demande pour garder la grille en plein écran.
        </p>
      </div>
    </div>
  );
}

export default function MontageDraftEditor({ projectId }: { projectId: string }) {
  const [project, setProject] = React.useState<Project | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = React.useState("all");
  const [addModal, setAddModal] = React.useState<AddModalState | null>(null);
  const [editModal, setEditModal] = React.useState<EditModalState | null>(null);
  const [showUnplacedPanel, setShowUnplacedPanel] = React.useState(false);
  const [showDiagnosticsPanel, setShowDiagnosticsPanel] = React.useState(false);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/projects/${projectId}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as ProjectResponse;

      if (!data.ok) {
        const failure = data as Extract<ProjectResponse, { ok: false }>;
        throw new Error(failure.message || "Impossible de charger le brouillon.");
      }
      if (!res.ok) {
        throw new Error("Impossible de charger le brouillon.");
      }

      setProject(data.item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger le brouillon.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const result = project?.engine_result || null;
  const assignments = Array.isArray(result?.assignments) ? result.assignments : [];
  const unplaced = Array.isArray(result?.unplaced) ? result.unplaced : [];
  const diagnostics = Array.isArray(result?.diagnostics)
    ? result.diagnostics
    : Array.isArray(project?.diagnostics)
      ? project?.diagnostics || []
      : [];
  const snapshot = project?.source_snapshot || null;
  const classes = React.useMemo(() => getSnapshotClasses(snapshot), [snapshot]);
  const rooms = React.useMemo(() => getSnapshotRooms(snapshot), [snapshot]);
  const services = React.useMemo(() => getSnapshotServices(snapshot), [snapshot]);
  const days = React.useMemo(() => getDays(snapshot, assignments), [snapshot, assignments]);
  const periods = React.useMemo(() => getPeriods(snapshot, assignments), [snapshot, assignments]);
  const blocks = React.useMemo(() => getPlacedBlocks(assignments), [assignments]);

  const visibleBlocks = React.useMemo(() => {
    if (selectedClassId === "all") return blocks;
    return blocks.filter((block) => blank(block.first.class_id) === selectedClassId);
  }, [blocks, selectedClassId]);

  const classServices = React.useMemo(() => {
    if (!addModal?.class_id) return services;
    return services.filter((item) => blank(item.class_id) === addModal.class_id);
  }, [addModal?.class_id, services]);

  const blockingCount = diagnostics.filter(isBlockingDiagnostic).length;
  const warningCount = diagnostics.filter(isWarningDiagnostic).length;
  const firstDiagnostics = diagnostics.slice(0, 5);
  const publicationAllowed = Boolean(result?.summary?.publication_allowed) || project?.status === "ready";
  const canEdit = Boolean(project && project.status !== "published" && !project.published_at);

  async function applyAction(body: AnyRecord) {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/projects/${projectId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as DraftActionResponse | null;

      if (!res.ok || !data?.ok) {
        throw new Error(data && !data.ok ? data.message || "Modification refusée." : "Modification refusée.");
      }

      setProject(data.item);
      setMessage(data.message || "Brouillon enregistré.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d’enregistrer la modification.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!project || publishing) return;

    const confirmMessage = publicationAllowed
      ? "Publier cet emploi du temps ? Il deviendra visible officiellement."
      : "Le brouillon contient encore des conflits bloquants ou des blocs non placés. La publication sera probablement refusée. Voulez-vous tenter quand même ?";

    if (!window.confirm(confirmMessage)) return;

    setPublishing(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: project.id }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || "Publication refusée.");
      }

      setMessage(data.message || "Emploi du temps publié officiellement.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publication impossible.");
    } finally {
      setPublishing(false);
    }
  }

  function handleDragStart(event: React.DragEvent, payload: DragPayload) {
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(event: React.DragEvent, weekday: number, periodNo: number) {
    event.preventDefault();
    if (!canEdit) return;

    const raw = event.dataTransfer.getData("application/json");
    if (!raw) return;

    try {
      const payload = JSON.parse(raw) as DragPayload;
      if (payload.kind === "placed") {
        void applyAction({
          action: "move",
          block_id: payload.block_id,
          weekday,
          period_no: periodNo,
        });
      } else if (payload.kind === "unplaced") {
        void applyAction({
          action: "place_unplaced",
          unplaced_id: payload.unplaced_id,
          weekday,
          period_no: periodNo,
        });
      }
    } catch {
      setError("Déplacement illisible. Réessaie avec la souris.");
    }
  }

  function openAddModal(weekday: number, periodNo: number) {
    if (!canEdit) return;
    const classId = selectedClassId !== "all" ? selectedClassId : getClassId(classes[0] || {});
    const firstService = services.find((item) => blank(item.class_id) === classId) || services[0];

    setAddModal({
      weekday,
      period_no: periodNo,
      class_id: classId,
      service_key: firstService ? serviceKey(firstService) : "",
      room_id: "",
      duration_units: 1,
    });
  }

  function openEditModal(block: PlacedBlock) {
    if (!canEdit) return;
    setEditModal({
      block_id: block.key,
      weekday: num(block.first.weekday, 1),
      period_no: block.start,
      room_id: blank(block.first.room_id),
    });
  }

  function submitAddModal() {
    if (!addModal) return;
    const service = services.find((item) => serviceKey(item) === addModal.service_key);
    if (!service) {
      setError("Choisis d’abord une matière/enseignant valide.");
      return;
    }

    void applyAction({
      action: "add",
      class_id: addModal.class_id,
      teacher_id: blank(service.teacher_id),
      subject_id: blank(service.catalog_subject_id || service.scheduler_subject_id || service.subject_id),
      weekday: addModal.weekday,
      period_no: addModal.period_no,
      duration_units: addModal.duration_units,
      room_id: addModal.room_id || null,
    });
    setAddModal(null);
  }

  function submitEditModal() {
    if (!editModal) return;
    void applyAction({
      action: "move",
      block_id: editModal.block_id,
      weekday: editModal.weekday,
      period_no: editModal.period_no,
      room_id: editModal.room_id || null,
    });
    setEditModal(null);
  }

  return (
    <main className="min-h-screen bg-slate-100 px-3 py-5 text-slate-950">
      <section className="mx-auto max-w-[1760px] space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={`/admin/montage-emploi-du-temps/projets/${projectId}`}
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-slate-950"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour à l’aperçu officiel
          </Link>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || saving || publishing}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-800 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Recharger
            </button>
            <button
              type="button"
              onClick={() => void publish()}
              disabled={!project || publishing || project.status === "published"}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Publier
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-slate-950 shadow-xl">
          <div className="relative p-6 sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(56,189,248,0.18),transparent_32%)]" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-100">
                <Save className="h-4 w-4" />
                Brouillon modifiable HoraClasse
              </div>
              <h1 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">
                {project?.name || "Correction du brouillon"}
              </h1>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300 sm:text-base">
                L’admin corrige ici le brouillon avant publication : ajout dans une case vide, déplacement par glisser-déposer, retrait vers les non placés, puis publication volontaire quand le diagnostic est propre.
              </p>
              {project ? (
                <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
                  <span className="rounded-full bg-white px-3 py-1 text-slate-950">
                    Statut : {project.status === "ready" ? "Prêt à publier" : project.status === "published" ? "Publié" : "Brouillon"}
                  </span>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200 ring-1 ring-white/10">
                    Modifié le {formatDate(project.updated_at)}
                  </span>
                  {result?.manually_updated_at ? (
                    <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200 ring-1 ring-white/10">
                      Correction manuelle : {formatDate(result.manually_updated_at)}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement du brouillon modifiable...
          </div>
        ) : null}

        {error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-black">Action impossible</p>
                <p className="mt-1 text-sm">{error}</p>
              </div>
            </div>
          </div>
        ) : null}

        {message ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-black">Brouillon enregistré</p>
                <p className="mt-1 text-sm">{message}</p>
              </div>
            </div>
          </div>
        ) : null}

        {!loading && project ? (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">Cours placés</p>
                <p className="mt-2 text-3xl font-black">{result?.summary?.assignments_count ?? assignments.length}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">Blocs non placés</p>
                <p className="mt-2 text-3xl font-black">{result?.summary?.unplaced_count ?? unplaced.length}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">Conflits bloquants</p>
                <p className="mt-2 text-3xl font-black">{result?.summary?.blocking_diagnostics_count ?? blockingCount}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">Publication</p>
                <p className="mt-2 text-xl font-black text-emerald-700">
                  {publicationAllowed ? "Possible" : "À corriger"}
                </p>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-black">
                    <Megaphone className="h-5 w-5 text-amber-500" />
                    Alertes du brouillon
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Les alertes restent visibles au-dessus de la grille. La colonne latérale a été retirée pour libérer toute la largeur de l’écran.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDiagnosticsPanel(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-800 transition hover:bg-slate-100"
                  >
                    <Megaphone className="h-4 w-4" />
                    Voir toutes les alertes ({diagnostics.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUnplacedPanel(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-950 transition hover:bg-amber-100"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    Non placés ({unplaced.length})
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <div
                  className={[
                    "rounded-2xl border p-4",
                    unplaced.length > 0
                      ? "border-amber-200 bg-amber-50 text-amber-950"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900",
                  ].join(" ")}
                >
                  <p className="text-xs font-black uppercase tracking-wide">Séances non placées</p>
                  <p className="mt-1 text-2xl font-black">{unplaced.length}</p>
                </div>
                <div
                  className={[
                    "rounded-2xl border p-4",
                    blockingCount > 0
                      ? "border-red-200 bg-red-50 text-red-950"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900",
                  ].join(" ")}
                >
                  <p className="text-xs font-black uppercase tracking-wide">Conflits bloquants</p>
                  <p className="mt-1 text-2xl font-black">{blockingCount}</p>
                </div>
                <div
                  className={[
                    "rounded-2xl border p-4",
                    warningCount > 0
                      ? "border-amber-200 bg-amber-50 text-amber-950"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900",
                  ].join(" ")}
                >
                  <p className="text-xs font-black uppercase tracking-wide">Avertissements</p>
                  <p className="mt-1 text-2xl font-black">{warningCount}</p>
                </div>
              </div>

              {firstDiagnostics.length > 0 ? (
                <div className="mt-4 grid gap-2">
                  {firstDiagnostics.map((item, index) => (
                    <div
                      key={`${item.message}-${index}`}
                      className={[
                        "rounded-2xl border px-4 py-3 text-sm font-bold leading-5",
                        diagnosticCardClass(item),
                      ].join(" ")}
                    >
                      • {item.message || "Alerte sans message"}
                    </div>
                  ))}
                  {diagnostics.length > firstDiagnostics.length ? (
                    <button
                      type="button"
                      onClick={() => setShowDiagnosticsPanel(true)}
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-black text-slate-700 transition hover:bg-slate-100"
                    >
                      Voir les {diagnostics.length - firstDiagnostics.length} autres alertes…
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
                  Aucun diagnostic signalé pour le moment.
                </div>
              )}
            </div>

            <div className="space-y-4">
              <DragHint />

              <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-xl font-black">Grille du brouillon en plein écran</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Choisis une classe pour corriger plus facilement. La vue “Toutes” reste utile pour contrôler l’ensemble.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowUnplacedPanel(true)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-950 transition hover:bg-amber-100"
                    >
                      <AlertTriangle className="h-4 w-4" />
                      Non placés ({unplaced.length})
                    </button>
                    <select
                      value={selectedClassId}
                      onChange={(event) => setSelectedClassId(event.target.value)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    >
                      <option value="all">Toutes les classes</option>
                      {classes.map((item) => {
                        const id = getClassId(item);
                        return (
                          <option key={id} value={id}>
                            {getClassLabel(item)}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1180px] table-fixed border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="w-[120px] border border-slate-200 bg-slate-50 px-3 py-3 text-left text-xs font-black uppercase text-slate-500">
                          Horaires
                        </th>
                        {days.map((day) => (
                          <th key={day} className="border border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-black uppercase text-slate-500">
                            {dayLabel(day)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((period) => (
                        <tr key={period.period_no}>
                          <th className="border border-slate-200 bg-white px-3 py-3 text-left text-xs font-black text-slate-600">
                            {periodLabel(period)}
                          </th>
                          {days.map((day) => {
                            const cellBlocks = visibleBlocks.filter((block) => blockIsInCell(block, day, period.period_no));
                            return (
                              <td
                                key={`${day}-${period.period_no}`}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => handleDrop(event, day, period.period_no)}
                                onClick={() => {
                                  if (cellBlocks.length === 0) openAddModal(day, period.period_no);
                                }}
                                className="h-[112px] cursor-pointer border border-slate-200 bg-slate-50/60 p-2 align-top transition hover:bg-emerald-50"
                              >
                                {cellBlocks.length === 0 ? (
                                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-300 text-xs font-bold text-slate-400">
                                    <Plus className="mr-1 h-4 w-4" /> Ajouter
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {cellBlocks.map((block) => {
                                      const isContinuation = period.period_no !== block.start;
                                      return (
                                        <button
                                          key={`${block.key}-${period.period_no}`}
                                          type="button"
                                          draggable={canEdit}
                                          onDragStart={(event) => handleDragStart(event, { kind: "placed", block_id: block.key })}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            openEditModal(block);
                                          }}
                                          className={[
                                            "w-full rounded-2xl border px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                                            isContinuation
                                              ? "border-slate-200 bg-white/80 text-slate-500"
                                              : "border-emerald-200 bg-white text-slate-950",
                                          ].join(" ")}
                                        >
                                          <div className="flex items-start gap-2">
                                            <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                                            <div className="min-w-0">
                                              <p className="truncate text-xs font-black uppercase">
                                                {clean(block.first.subject_label, "Matière")}
                                                {block.duration > 1 ? ` · ${block.duration}h` : ""}
                                              </p>
                                              <p className="mt-1 truncate text-[11px] font-bold text-slate-600">
                                                {selectedClassId === "all" ? `${clean(block.first.class_label, "Classe")} · ` : ""}
                                                {clean(block.first.teacher_name, "Enseignant")}
                                              </p>
                                              {blank(block.first.room_label || block.first.room_id) ? (
                                                <p className="mt-1 truncate text-[10px] font-semibold text-slate-400">
                                                  {clean(block.first.room_label || block.first.room_id)}
                                                </p>
                                              ) : null}
                                              {isContinuation ? (
                                                <p className="mt-1 text-[10px] font-black uppercase text-slate-400">Suite du bloc</p>
                                              ) : null}
                                            </div>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </section>

      {saving ? (
        <div className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-xl">
          <Loader2 className="h-4 w-4 animate-spin" />
          Enregistrement du brouillon...
        </div>
      ) : null}

      {showUnplacedPanel ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 p-3 sm:p-5">
          <div className="flex h-full w-full max-w-xl flex-col rounded-[28px] bg-white shadow-2xl">
            <div className="border-b border-slate-200 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-black text-slate-950">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Séances non placées
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    Ce panneau s’ouvre seulement quand tu en as besoin. Glisse une séance dans la grille puis ferme le panneau pour retrouver le plein écran.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowUnplacedPanel(false)}
                  className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-200"
                >
                  Fermer
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-5">
              {unplaced.map((item, index) => {
                const id = getUnplacedId(item);
                return (
                  <div
                    key={id || index}
                    draggable={canEdit && Boolean(id)}
                    onDragStart={(event) => handleDragStart(event, { kind: "unplaced", unplaced_id: id })}
                    className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm shadow-sm"
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <div>
                        <p className="font-black text-slate-950">
                          {clean(item.class_label, "Classe")} — {clean(item.subject_label, "Matière")}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {clean(item.teacher_name, "Enseignant")} · {num(item.duration_units, 1)}h
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {unplaced.length === 0 ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
                  Aucun bloc non placé.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showDiagnosticsPanel ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 p-3 sm:p-5">
          <div className="flex h-full w-full max-w-2xl flex-col rounded-[28px] bg-white shadow-2xl">
            <div className="border-b border-slate-200 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-black text-slate-950">
                    <Megaphone className="h-5 w-5 text-amber-500" />
                    Toutes les alertes du brouillon
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    Rouge = à corriger avant publication. Orange = possible, mais à vérifier par l’admin.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDiagnosticsPanel(false)}
                  className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-200"
                >
                  Fermer
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-5 text-sm">
              {diagnostics.map((item, index) => (
                <div
                  key={`${item.message}-${index}`}
                  className={[
                    "rounded-2xl border px-4 py-3 font-bold leading-5",
                    diagnosticCardClass(item),
                  ].join(" ")}
                >
                  • {item.message || "Alerte sans message"}
                </div>
              ))}
              {diagnostics.length === 0 ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
                  Aucun diagnostic signalé.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {addModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-black">Ajouter une séance</h2>
            <p className="mt-1 text-sm text-slate-500">
              Case : {dayLabel(addModal.weekday)} — Séance {addModal.period_no}
            </p>

            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm font-black text-slate-700">
                Classe
                <select
                  value={addModal.class_id}
                  onChange={(event) => {
                    const classId = event.target.value;
                    const nextService = services.find((item) => blank(item.class_id) === classId);
                    setAddModal({
                      ...addModal,
                      class_id: classId,
                      service_key: nextService ? serviceKey(nextService) : "",
                    });
                  }}
                  className="rounded-2xl border border-slate-200 px-4 py-3 font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                >
                  {classes.map((item) => {
                    const id = getClassId(item);
                    return (
                      <option key={id} value={id}>
                        {getClassLabel(item)}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-black text-slate-700">
                Matière / Enseignant
                <select
                  value={addModal.service_key}
                  onChange={(event) => setAddModal({ ...addModal, service_key: event.target.value })}
                  className="rounded-2xl border border-slate-200 px-4 py-3 font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                >
                  {classServices.map((item) => (
                    <option key={serviceKey(item)} value={serviceKey(item)}>
                      {getServiceLabel(item)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-black text-slate-700">
                Durée
                <select
                  value={addModal.duration_units}
                  onChange={(event) => setAddModal({ ...addModal, duration_units: num(event.target.value, 1) })}
                  className="rounded-2xl border border-slate-200 px-4 py-3 font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value={1}>1h</option>
                  <option value={2}>2h</option>
                  <option value={3}>3h</option>
                </select>
              </label>

              <label className="grid gap-2 text-sm font-black text-slate-700">
                Salle / ressource
                <select
                  value={addModal.room_id}
                  onChange={(event) => setAddModal({ ...addModal, room_id: event.target.value })}
                  className="rounded-2xl border border-slate-200 px-4 py-3 font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">Automatique / non renseigné</option>
                  {rooms.map((item) => {
                    const id = getRoomId(item);
                    return (
                      <option key={id} value={id}>
                        {getRoomLabel(item)}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddModal(null)}
                className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-200"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submitAddModal}
                className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
              >
                Ajouter
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-black">Modifier la séance</h2>
            <p className="mt-1 text-sm text-slate-500">
              Déplace la séance, change la salle, ou retire-la vers les non placés.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-black text-slate-700">
                Jour
                <select
                  value={editModal.weekday}
                  onChange={(event) => setEditModal({ ...editModal, weekday: num(event.target.value, 1) })}
                  className="rounded-2xl border border-slate-200 px-4 py-3 font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                >
                  {days.map((day) => (
                    <option key={day} value={day}>
                      {dayLabel(day)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-black text-slate-700">
                Créneau
                <select
                  value={editModal.period_no}
                  onChange={(event) => setEditModal({ ...editModal, period_no: num(event.target.value, 1) })}
                  className="rounded-2xl border border-slate-200 px-4 py-3 font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                >
                  {periods.map((period) => (
                    <option key={period.period_no} value={period.period_no}>
                      {periodLabel(period)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-black text-slate-700 sm:col-span-2">
                Salle / ressource
                <select
                  value={editModal.room_id}
                  onChange={(event) => setEditModal({ ...editModal, room_id: event.target.value })}
                  className="rounded-2xl border border-slate-200 px-4 py-3 font-semibold outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">Automatique / non renseigné</option>
                  {rooms.map((item) => {
                    const id = getRoomId(item);
                    return (
                      <option key={id} value={id}>
                        {getRoomLabel(item)}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  void applyAction({ action: "unplace", block_id: editModal.block_id });
                  setEditModal(null);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-black text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100"
              >
                <Undo2 className="h-4 w-4" />
                Retirer vers non placés
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditModal(null)}
                  className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-200"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void applyAction({ action: "delete", block_id: editModal.block_id });
                    setEditModal(null);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700 ring-1 ring-red-200 transition hover:bg-red-100"
                >
                  <Trash2 className="h-4 w-4" />
                  Supprimer
                </button>
                <button
                  type="button"
                  onClick={submitEditModal}
                  className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
