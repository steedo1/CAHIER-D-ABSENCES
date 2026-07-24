"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  GraduationCap,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import OfflineReadinessCard from "@/components/OfflineReadinessCard";
import OfflineSyncBar from "@/components/OfflineSyncBar";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  getTextbookBootstrap,
  getTextbookSlots,
  saveTextbookLessonStatus,
  saveTextbookSession,
} from "@/lib/offline-textbook";

type Session = {
  id: string;
  session_title: string;
  session_date: string;
  duration_minutes: number;
  session_start_time?: string | null;
  session_end_time?: string | null;
  session_period_label?: string | null;
  content?: string | null;
  homework?: string | null;
};

type PeriodSlot = {
  id: string;
  label: string;
  start_hm: string;
  duration_minutes: number;
  weekday?: number | null;
  period_no?: number | null;
};

type Completion = {
  id: string;
  status: string;
  completed_at?: string | null;
};

type ProgressionItem = {
  id: string;
  item_type: string;
  title: string;
  rubric?: string | null;
  theme?: string | null;
  trimester?: string | null;
  week_label?: string | null;
  planned_duration_minutes?: number | null;
  planned_sessions_count?: number | null;
  sort_order?: number | null;
  indent_level?: number | null;
  sessions?: Session[];
  completion?: Completion | null;
};

type Assignment = {
  id: string;
  class_id: string;
  teacher_id?: string | null;
  effective_teacher_id?: string | null;
  effective_teacher_name?: string | null;
  classes?: {
    id: string;
    label?: string | null;
    level?: string | null;
    academic_year?: string | null;
    education_type?: string | null;
    education_label?: string | null;
    education_short_label?: string | null;
    formation_code?: string | null;
    formation_label?: string | null;
    formation_level_code?: string | null;
    formation_level_label?: string | null;
    education_context_key?: string | null;
    education_context_label?: string | null;
    education_context_complete?: boolean | null;
  } | null;
  progression?: {
    id: string;
    title: string;
    academic_year: string;
    subject_name?: string | null;
    level?: string | null;
    document?: {
      original_name?: string | null;
      signed_url?: string | null;
    } | null;
  } | null;
  progression_items: ProgressionItem[];
};

type TextbookBootstrapPayload = {
  mode?: string;
  items?: Assignment[];
};

type SessionForm = {
  session_title: string;
  session_date: string;
  session_period_id: string;
  session_period_label: string;
  session_start_time: string;
  session_end_time: string;
  content: string;
  homework: string;
  observations: string;
};

const ACTIONABLE_TYPES = new Set([
  "lesson",
  "sequence",
  "session",
  "evaluation",
  "remediation",
  "regulation",
  "revision",
  "other",
]);

function isActionableItem(item: ProgressionItem) {
  return (
    ACTIONABLE_TYPES.has(item.item_type) ||
    Number(item.planned_duration_minutes || 0) > 0 ||
    Number(item.planned_sessions_count || 0) > 0
  );
}

function classNames(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function normalizeHm(value?: string | null) {
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const hh = Math.max(0, Math.min(23, Number(m[1]) || 0));
  const mm = Math.max(0, Math.min(59, Number(m[2]) || 0));
  return `${pad2(hh)}:${pad2(mm)}`;
}

function addMinutes(hm: string, minutes: number) {
  const clean = normalizeHm(hm);
  if (!clean) return "";
  const [h, m] = clean.split(":").map(Number);
  const total = h * 60 + m + Math.max(1, Number(minutes || 0));
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
}

function minutesBetween(start?: string | null, end?: string | null) {
  const s = normalizeHm(start);
  const e = normalizeHm(end);
  if (!s || !e) return 0;
  const [sh, sm] = s.split(":").map(Number);
  const [eh, em] = e.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  return diff > 0 && diff <= 24 * 60 ? diff : 0;
}

function formatTimeRange(start?: string | null, end?: string | null) {
  const s = normalizeHm(start);
  const e = normalizeHm(end);
  if (!s || !e) return "";
  return `${s}–${e}`;
}

function plannedMinutes(item: ProgressionItem) {
  const duration = Number(item.planned_duration_minutes || 0);
  if (duration > 0) return duration;
  const sessions = Number(item.planned_sessions_count || 0);
  if (sessions > 0) return sessions * 55;
  return 0;
}

function formatHours(minutes: number) {
  if (!minutes) return "0 h";
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
}

function buildUniquePeriodSlots(slots: PeriodSlot[]) {
  const seen = new Set<string>();
  const out: PeriodSlot[] = [];
  for (const slot of slots || []) {
    const start = normalizeHm(slot.start_hm);
    const duration = Math.max(1, Number(slot.duration_minutes || 0));
    if (!start || !duration) continue;
    const end = addMinutes(start, duration);
    const key = `${start}|${end}|${slot.period_no || slot.label || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...slot,
      start_hm: start,
      duration_minutes: duration,
      label: slot.label || `Créneau ${slot.period_no || out.length + 1}`,
    });
  }
  return out.sort((a, b) => {
    const pa = Number(a.period_no || 999);
    const pb = Number(b.period_no || 999);
    if (pa !== pb) return pa - pb;
    return String(a.start_hm).localeCompare(String(b.start_hm));
  });
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function classLabel(assignment: Assignment | null) {
  return assignment?.classes?.label || "Classe";
}

function isNonGeneralAssignment(assignment: Assignment | null) {
  return Boolean(
    assignment &&
      String(assignment.classes?.education_type || "general_secondary") !==
        "general_secondary",
  );
}

function assignmentContextLabel(assignment: Assignment | null) {
  if (!assignment) return "Secondaire général";
  return (
    assignment.classes?.education_context_label ||
    assignment.classes?.education_label ||
    "Secondaire général"
  );
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    section: "Section",
    theme: "Thème",
    competency: "Compétence",
    rubric: "Rubrique",
    chapter: "Chapitre",
    lesson: "Leçon",
    sequence: "Séquence",
    session: "Séance prévue",
    evaluation: "Évaluation",
    remediation: "Remédiation",
    regulation: "Régulation",
    revision: "Révision",
    other: "Autre",
  };
  return labels[type] || type;
}

function emptySessionForm(item: ProgressionItem | null, nextIndex?: number): SessionForm {
  const index = nextIndex || (item?.sessions?.length || 0) + 1;
  return {
    session_title: `Séance ${index}`,
    session_date: todayIso(),
    session_period_id: "",
    session_period_label: "",
    session_start_time: "",
    session_end_time: "",
    content: "",
    homework: "",
    observations: "",
  };
}

function humanError(message: string) {
  const labels: Record<string, string> = {
    lesson_requires_session:
      "Enregistrez au moins une séance avant de terminer cette leçon.",
    teacher_not_found_for_class_subject:
      "Aucun enseignant n’est affecté à cette matière dans la classe.",
    forbidden_not_class_device:
      "Ce compte classe n’est pas correctement rattaché à une classe.",
    forbidden: "Vous n’avez pas accès à cette progression.",
    class_education_context_incomplete:
      "Cette classe doit être rattachée à une formation et à une année de formation.",
    subject_not_configured_for_formation_level:
      "Cette matière n’est pas configurée pour la formation et l’année de cette classe.",
    subject_not_resolved_for_assignment:
      "La matière de cette progression ne peut pas être reliée au référentiel de la formation.",
  };
  return labels[message] || message;
}

export default function TeacherTextbookPage() {
  const { isOnline } = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [periodSlots, setPeriodSlots] = useState<PeriodSlot[]>([]);
  const [accessMode, setAccessMode] = useState<"teacher" | "class_device">(
    "teacher",
  );
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [form, setForm] = useState<SessionForm>(emptySessionForm(null));

  const selectedAssignment = useMemo(
    () => assignments.find((a) => a.id === selectedAssignmentId) || null,
    [assignments, selectedAssignmentId],
  );

  const selectedItem = useMemo(
    () =>
      selectedAssignment?.progression_items?.find(
        (item) => item.id === selectedItemId,
      ) || null,
    [selectedAssignment, selectedItemId],
  );

  const classOptions = useMemo(() => {
    const seen = new Set<string>();
    return assignments
      .filter((assignment) => {
        if (!assignment.class_id || seen.has(assignment.class_id)) return false;
        seen.add(assignment.class_id);
        return true;
      })
      .map((assignment) => ({
        id: assignment.class_id,
        label: classLabel(assignment),
        education_type:
          assignment.classes?.education_type || "general_secondary",
        context_key:
          assignment.classes?.education_context_key || "general_secondary",
        context_label: assignmentContextLabel(assignment),
      }))
      .sort((a, b) => {
        const byContext = a.context_label.localeCompare(b.context_label, "fr");
        return byContext || a.label.localeCompare(b.label, "fr");
      });
  }, [assignments]);

  const hasNonGeneralAssignments = useMemo(
    () =>
      classOptions.some(
        (option) => option.education_type !== "general_secondary",
      ),
    [classOptions],
  );

  const classOptionGroups = useMemo(() => {
    const groups = new Map<
      string,
      { label: string; items: typeof classOptions }
    >();
    for (const option of classOptions) {
      const key = option.context_key || option.education_type;
      if (!groups.has(key)) {
        groups.set(key, { label: option.context_label, items: [] });
      }
      groups.get(key)!.items.push(option);
    }
    return Array.from(groups.entries()).map(([key, group]) => ({
      key,
      ...group,
    }));
  }, [classOptions]);

  const subjectAssignments = useMemo(() => {
    if (!selectedAssignment?.class_id) return [];
    return assignments
      .filter((assignment) => assignment.class_id === selectedAssignment.class_id)
      .sort((a, b) =>
        String(a.progression?.subject_name || "").localeCompare(
          String(b.progression?.subject_name || ""),
          "fr",
        ),
      );
  }, [assignments, selectedAssignment?.class_id]);

  const actionableItems = useMemo(
    () =>
      (selectedAssignment?.progression_items || []).filter(isActionableItem),
    [selectedAssignment],
  );

  const progressStats = useMemo(() => {
    const actionable = actionableItems;
    const completed = actionable.filter(
      (item) => item.completion?.status === "completed",
    );
    const plannedTotal = actionable.reduce(
      (sum, item) => sum + plannedMinutes(item),
      0,
    );
    const completedPlanned = completed.reduce(
      (sum, item) => sum + plannedMinutes(item),
      0,
    );
    const sessions = actionable.reduce(
      (sum, item) => sum + (item.sessions?.length || 0),
      0,
    );
    const rate = plannedTotal
      ? Math.round((completedPlanned / plannedTotal) * 1000) / 10
      : actionable.length
        ? Math.round((completed.length / actionable.length) * 1000) / 10
        : 0;
    return {
      total: actionable.length,
      completed: completed.length,
      plannedTotal,
      completedPlanned,
      rate,
      sessions,
    };
  }, [actionableItems]);

  const nextItem = useMemo(
    () =>
      actionableItems.find(
        (item) => item.completion?.status !== "completed",
      ) || actionableItems[0] || null,
    [actionableItems],
  );

  function applyBootstrap(json: TextbookBootstrapPayload) {
    const items = (json.items || []) as Assignment[];
    setAccessMode(json.mode === "class_device" ? "class_device" : "teacher");
    setAssignments(items);
    setSelectedAssignmentId((current) =>
      current && items.some((assignment) => assignment.id === current)
        ? current
        : items[0]?.id || "",
    );
  }

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const json = await getTextbookBootstrap<TextbookBootstrapPayload>();
      applyBootstrap(json);
    } catch (cause: any) {
      setError(cause?.message || "Chargement impossible");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedAssignment) {
      setSelectedItemId("");
      return;
    }

    const currentExists = actionableItems.some(
      (item) => item.id === selectedItemId,
    );
    if (!currentExists) setSelectedItemId(nextItem?.id || "");
  }, [selectedAssignment, actionableItems, nextItem, selectedItemId]);

  useEffect(() => {
    setForm(emptySessionForm(selectedItem));
    setMessage(null);
    setError(null);
  }, [selectedAssignmentId, selectedItemId]);

  useEffect(() => {
    let cancelled = false;
    const classId = selectedAssignment?.class_id || "";

    if (!classId) {
      setPeriodSlots([]);
      return;
    }

    setSlotsLoading(true);
    getTextbookSlots<{ items?: PeriodSlot[] }>(classId)
      .then((json) => {
        if (!cancelled)
          setPeriodSlots(buildUniquePeriodSlots(json.items || []));
      })
      .catch(() => {
        if (!cancelled) setPeriodSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAssignment?.class_id]);

  function handleClassChange(classId: string) {
    const assignment = assignments.find((item) => item.class_id === classId);
    setSelectedAssignmentId(assignment?.id || "");
  }

  function selectItem(itemId: string) {
    if (!actionableItems.some((item) => item.id === itemId)) return;
    setSelectedItemId(itemId);
  }

  function handlePeriodChange(periodId: string) {
    if (periodId === "custom") {
      setForm((current) => ({
        ...current,
        session_period_id: "",
        session_period_label: "Plage personnalisée",
      }));
      return;
    }

    const slot = periodSlots.find((item) => item.id === periodId) || null;
    if (!slot) {
      setForm((current) => ({
        ...current,
        session_period_id: "",
        session_period_label: "",
        session_start_time: "",
        session_end_time: "",
      }));
      return;
    }

    const start = normalizeHm(slot.start_hm);
    const end = addMinutes(start, slot.duration_minutes);
    setForm((current) => ({
      ...current,
      session_period_id: slot.id,
      session_period_label: `${slot.label} · ${formatTimeRange(start, end)}`,
      session_start_time: start,
      session_end_time: end,
    }));
  }

  async function saveSession(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAssignment || !selectedItem) return;

    if (!form.content.trim()) {
      setError("Renseignez le contenu réalisé pendant la séance.");
      return;
    }
    if (!form.session_start_time || !form.session_end_time) {
      setError("Choisissez un créneau ou saisissez une plage horaire.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const previousCount = selectedItem.sessions?.length || 0;
      const { mutation, bootstrap } = await saveTextbookSession<TextbookBootstrapPayload>({
        assignment_id: selectedAssignment.id,
        item_id: selectedItem.id,
        ...form,
        duration_minutes:
          minutesBetween(form.session_start_time, form.session_end_time) || 55,
      });
      if (!mutation.ok && !mutation.queued) {
        throw new Error(humanError(mutation.error || "Enregistrement impossible"));
      }
      if (bootstrap) applyBootstrap(bootstrap);
      setForm(emptySessionForm(selectedItem, previousCount + 2));
      setMessage(
        mutation.ok
          ? "Séance enregistrée avec succès."
          : "Séance conservée sur cet appareil. Elle sera synchronisée automatiquement.",
      );
    } catch (cause: any) {
      setError(cause?.message || "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function updateLessonStatus(status: "completed" | "reopened") {
    if (!selectedAssignment || !selectedItem) return;
    if (status === "completed" && !(selectedItem.sessions?.length || 0)) {
      setError("Enregistrez au moins une séance avant de terminer cette leçon.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { mutation, bootstrap } =
        await saveTextbookLessonStatus<TextbookBootstrapPayload>({
          assignment_id: selectedAssignment.id,
          item_id: selectedItem.id,
          status,
        });
      if (!mutation.ok && !mutation.queued) {
        throw new Error(humanError(mutation.error || "Action impossible"));
      }
      if (bootstrap) applyBootstrap(bootstrap);
      setMessage(
        mutation.ok
          ? status === "completed"
            ? "Leçon marquée comme terminée."
            : "Leçon rouverte pour modification."
          : status === "completed"
            ? "Leçon terminée sur cet appareil. La synchronisation se fera automatiquement."
            : "Réouverture conservée sur cet appareil. La synchronisation se fera automatiquement.",
      );
    } catch (cause: any) {
      setError(cause?.message || "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
        <div className="mx-auto flex max-w-7xl items-center gap-3 rounded-3xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          Chargement du cahier de texte…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-900 sm:px-5 lg:px-7 lg:py-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-4 sm:px-6 lg:px-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700 ring-1 ring-emerald-100">
                  <BookOpen className="h-3.5 w-3.5" />
                  {accessMode === "class_device"
                    ? "Compte classe"
                    : "Espace enseignant"}
                </div>
                <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                  Cahier de texte
                </h1>
              </div>
              <div className="flex items-center gap-2">
                {isOnline && selectedAssignment?.progression?.document?.signed_url ? (
                  <a
                    href={selectedAssignment.progression.document.signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 sm:text-sm"
                  >
                    <FileText className="h-4 w-4" />
                    <span className="hidden sm:inline">Progression officielle</span>
                    <span className="sm:hidden">PDF</span>
                  </a>
                ) : !isOnline && selectedAssignment?.progression?.document?.signed_url ? (
                  <span
                    title="La progression PDF nécessite une connexion."
                    className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-black text-slate-400 sm:text-sm"
                  >
                    <FileText className="h-4 w-4" />
                    <span className="hidden sm:inline">PDF disponible en ligne</span>
                    <span className="sm:hidden">PDF</span>
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-60 sm:text-sm"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span className="hidden sm:inline">Actualiser</span>
                </button>
              </div>
            </div>
          </div>

          {assignments.length ? (
            <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-[minmax(220px,0.8fr)_minmax(280px,1fr)_minmax(300px,1.2fr)] lg:px-7">
              <label className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                  Classe
                </span>
                <div className="relative">
                  <GraduationCap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <select
                    value={selectedAssignment?.class_id || ""}
                    onChange={(event) => handleClassChange(event.target.value)}
                    disabled={accessMode === "class_device" || classOptions.length <= 1}
                    className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-9 text-sm font-black text-slate-900 outline-none transition focus:border-emerald-400 disabled:cursor-default disabled:opacity-80"
                  >
                    {hasNonGeneralAssignments
                      ? classOptionGroups.map((group) => (
                          <optgroup key={group.key} label={group.label}>
                            {group.items.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                        ))
                      : classOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </label>

              <label className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                  Matière
                </span>
                <div className="relative">
                  <BookOpen className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <select
                    value={selectedAssignmentId}
                    onChange={(event) => setSelectedAssignmentId(event.target.value)}
                    className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-9 text-sm font-black text-slate-900 outline-none transition focus:border-emerald-400"
                  >
                    {subjectAssignments.map((assignment) => (
                      <option key={assignment.id} value={assignment.id}>
                        {assignment.progression?.subject_name || "Matière"}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </label>

              <div className="rounded-2xl bg-emerald-50 px-4 py-3 sm:col-span-2 lg:col-span-1">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
                      Avancement
                    </div>
                    <div className="mt-1 text-2xl font-black text-emerald-950">
                      {progressStats.rate}%
                    </div>
                  </div>
                  <div className="text-right text-xs font-bold text-emerald-800">
                    <div>
                      {progressStats.completed}/{progressStats.total} étapes
                    </div>
                    <div>{progressStats.sessions} séance(s)</div>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all"
                    style={{ width: `${Math.min(100, progressStats.rate)}%` }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {isNonGeneralAssignment(selectedAssignment) ? (
            <div className="mx-4 mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm sm:mx-6 lg:mx-7">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-600">
                Contexte pédagogique
              </div>
              <div className="mt-1 font-black text-indigo-950">
                {assignmentContextLabel(selectedAssignment)}
              </div>
              <div className="mt-1 text-xs font-semibold text-indigo-700">
                {classLabel(selectedAssignment)} · {selectedAssignment?.progression?.subject_name || "Matière"}
              </div>
            </div>
          ) : null}
        </header>

        <OfflineSyncBar
          onMessage={(value) => {
            setError(null);
            setMessage(value);
          }}
          onSynced={() => load(true)}
        />
        <OfflineReadinessCard
          role={accessMode === "class_device" ? "class-device" : "teacher"}
        />

        {message ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        ) : null}

        {!assignments.length ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500">
              <FileText className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-xl font-black">Aucune progression affectée</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm font-medium text-slate-500">
              L’administration doit affecter une progression à la classe et à la matière concernées.
            </p>
          </section>
        ) : selectedAssignment ? (
          <>
            <div className="lg:hidden">
              <label className="block rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                  Leçon ou activité
                </span>
                <select
                  value={selectedItemId}
                  onChange={(event) => selectItem(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-black outline-none focus:border-emerald-400"
                >
                  {actionableItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.completion?.status === "completed" ? "✓ " : ""}
                      {typeLabel(item.item_type)} — {item.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.55fr)]">
              <aside className="hidden overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm lg:sticky lg:top-5 lg:block">
                <div className="border-b border-slate-100 px-5 py-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
                    Progression
                  </div>
                  <h2 className="mt-1 line-clamp-2 text-lg font-black text-slate-950">
                    {selectedAssignment.progression?.title || "Progression"}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
                    <span>{selectedAssignment.progression?.academic_year}</span>
                    <span>·</span>
                    <span>{formatHours(progressStats.completedPlanned)} / {formatHours(progressStats.plannedTotal)}</span>
                  </div>
                </div>

                <div className="max-h-[calc(100vh-260px)] overflow-y-auto p-3">
                  <div className="space-y-2">
                    {(selectedAssignment.progression_items || []).map((item) => {
                      const actionable = isActionableItem(item);
                      const selected = item.id === selectedItemId;
                      const complete = item.completion?.status === "completed";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={!actionable}
                          onClick={() => selectItem(item.id)}
                          className={classNames(
                            "w-full rounded-2xl border px-3 py-3 text-left transition",
                            !actionable &&
                              "cursor-default border-transparent bg-slate-50 text-slate-500",
                            actionable &&
                              !selected &&
                              "border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/50",
                            selected &&
                              "border-emerald-300 bg-emerald-50 shadow-sm ring-1 ring-emerald-100",
                          )}
                          style={{
                            paddingLeft: `${12 + Math.min(2, item.indent_level || 0) * 12}px`,
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
                                {typeLabel(item.item_type)}
                              </div>
                              <div
                                className={classNames(
                                  "mt-1 text-sm font-black leading-5",
                                  selected ? "text-emerald-950" : "text-slate-900",
                                )}
                              >
                                {item.title}
                              </div>
                              {actionable ? (
                                <div className="mt-1 text-[11px] font-bold text-slate-500">
                                  {plannedMinutes(item)
                                    ? formatHours(plannedMinutes(item))
                                    : "Durée non définie"}
                                  {item.sessions?.length
                                    ? ` · ${item.sessions.length} séance(s)`
                                    : ""}
                                </div>
                              ) : null}
                            </div>
                            {complete ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            ) : actionable ? (
                              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </aside>

              <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                {selectedItem ? (
                  <form onSubmit={saveSession}>
                    <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-slate-600">
                            {typeLabel(selectedItem.item_type)}
                          </div>
                          <h2 className="mt-2 text-xl font-black leading-tight text-slate-950 sm:text-2xl">
                            {selectedItem.title}
                          </h2>
                          <p className="mt-1 text-xs font-bold text-slate-500 sm:text-sm">
                            {classLabel(selectedAssignment)} · {selectedAssignment.progression?.subject_name || "Matière"}
                            {selectedAssignment.effective_teacher_name
                              ? ` · ${selectedAssignment.effective_teacher_name}`
                              : ""}
                          </p>
                        </div>
                        <div
                          className={classNames(
                            "rounded-full px-3 py-1.5 text-[10px] font-black uppercase",
                            selectedItem.completion?.status === "completed"
                              ? "bg-emerald-50 text-emerald-700"
                              : selectedItem.sessions?.length
                                ? "bg-sky-50 text-sky-700"
                                : "bg-amber-50 text-amber-700",
                          )}
                        >
                          {selectedItem.completion?.status === "completed"
                            ? "Terminée"
                            : selectedItem.sessions?.length
                              ? "En cours"
                              : "À commencer"}
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-2">
                        <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                          <div className="text-[9px] font-black uppercase text-slate-400">Prévu</div>
                          <div className="mt-1 text-sm font-black text-slate-900">
                            {plannedMinutes(selectedItem)
                              ? formatHours(plannedMinutes(selectedItem))
                              : "—"}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                          <div className="text-[9px] font-black uppercase text-slate-400">Séances</div>
                          <div className="mt-1 text-sm font-black text-slate-900">
                            {selectedItem.sessions?.length || 0}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                          <div className="text-[9px] font-black uppercase text-slate-400">Période</div>
                          <div className="mt-1 truncate text-sm font-black text-slate-900">
                            {selectedItem.week_label || selectedItem.trimester || "—"}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-5 p-4 sm:p-6">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                        <label className="space-y-1.5">
                          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                            Titre de la séance
                          </span>
                          <input
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50"
                            value={form.session_title}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                session_title: event.target.value,
                              }))
                            }
                            placeholder="Séance 1"
                          />
                        </label>
                        <label className="space-y-1.5">
                          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                            Date
                          </span>
                          <div className="relative">
                            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              type="date"
                              className="w-full rounded-2xl border border-slate-200 py-3 pl-10 pr-3 text-sm font-bold outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50"
                              value={form.session_date}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  session_date: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </label>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                            Créneau de la séance
                          </label>
                          {slotsLoading ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400">
                              <Loader2 className="h-3 w-3 animate-spin" /> Chargement
                            </span>
                          ) : null}
                        </div>
                        <select
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold outline-none transition focus:border-emerald-400"
                          value={
                            form.session_period_id ||
                            (form.session_period_label === "Plage personnalisée"
                              ? "custom"
                              : "")
                          }
                          onChange={(event) => handlePeriodChange(event.target.value)}
                        >
                          <option value="">Choisir un créneau</option>
                          {periodSlots.map((slot) => {
                            const start = normalizeHm(slot.start_hm);
                            const end = addMinutes(start, slot.duration_minutes);
                            return (
                              <option key={slot.id} value={slot.id}>
                                {slot.label} — {formatTimeRange(start, end)}
                              </option>
                            );
                          })}
                          <option value="custom">Saisir une plage personnalisée</option>
                        </select>

                        {!periodSlots.length && !slotsLoading ? (
                          <p className="mt-2 text-xs font-semibold text-amber-700">
                            Aucun créneau établissement trouvé. Utilisez une plage personnalisée.
                          </p>
                        ) : null}

                        {form.session_period_label === "Plage personnalisée" ? (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <label className="space-y-1">
                              <span className="text-[10px] font-bold text-slate-500">Début</span>
                              <input
                                type="time"
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400"
                                value={form.session_start_time}
                                onChange={(event) =>
                                  setForm((current) => ({
                                    ...current,
                                    session_start_time: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] font-bold text-slate-500">Fin</span>
                              <input
                                type="time"
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400"
                                value={form.session_end_time}
                                onChange={(event) =>
                                  setForm((current) => ({
                                    ...current,
                                    session_end_time: event.target.value,
                                  }))
                                }
                              />
                            </label>
                          </div>
                        ) : null}

                        {form.session_start_time && form.session_end_time ? (
                          <div className="mt-2 text-xs font-bold text-slate-500">
                            {formatTimeRange(form.session_start_time, form.session_end_time)} · {minutesBetween(form.session_start_time, form.session_end_time)} min
                          </div>
                        ) : null}
                      </div>

                      <label className="block space-y-1.5">
                        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                          Contenu réalisé en classe
                        </span>
                        <textarea
                          required
                          className="min-h-48 w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 sm:min-h-56"
                          value={form.content}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              content: event.target.value,
                            }))
                          }
                          placeholder="Décrivez clairement les notions, activités et exercices traités pendant la séance."
                        />
                      </label>

                      <label className="block space-y-1.5">
                        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                          Travail à faire
                        </span>
                        <textarea
                          className="min-h-28 w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50"
                          value={form.homework}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              homework: event.target.value,
                            }))
                          }
                          placeholder="Exercices, leçon à apprendre ou préparation demandée aux élèves."
                        />
                      </label>

                      <details className="rounded-2xl border border-slate-200 bg-slate-50">
                        <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-700">
                          Ajouter une observation interne
                        </summary>
                        <div className="border-t border-slate-200 p-3">
                          <textarea
                            className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-400"
                            value={form.observations}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                observations: event.target.value,
                              }))
                            }
                            placeholder="Observation réservée à l’enseignant et à l’administration."
                          />
                        </div>
                      </details>

                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <button
                          disabled={busy}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          Enregistrer la séance
                        </button>

                        {selectedItem.completion?.status === "completed" ? (
                          <button
                            type="button"
                            onClick={() => updateLessonStatus("reopened")}
                            disabled={busy}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                          >
                            <RotateCcw className="h-4 w-4" /> Réouvrir
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => updateLessonStatus("completed")}
                            disabled={busy || !(selectedItem.sessions?.length || 0)}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3.5 text-sm font-black text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                            title={
                              selectedItem.sessions?.length
                                ? "Marquer la leçon comme terminée"
                                : "Enregistrez d’abord une séance"
                            }
                          >
                            <CheckCircle2 className="h-4 w-4" /> Terminer la leçon
                          </button>
                        )}
                      </div>

                      {selectedItem.sessions?.length ? (
                        <details className="rounded-2xl border border-slate-200">
                          <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-700">
                            Historique des séances ({selectedItem.sessions.length})
                          </summary>
                          <div className="space-y-2 border-t border-slate-100 p-3">
                            {selectedItem.sessions.slice(0, 6).map((session) => (
                              <div
                                key={session.id}
                                className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-600"
                              >
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-black text-slate-700">
                                  <Clock3 className="h-3.5 w-3.5" />
                                  <span>{formatDate(session.session_date)}</span>
                                  <span>·</span>
                                  <span>
                                    {formatTimeRange(
                                      session.session_start_time,
                                      session.session_end_time,
                                    ) || `${session.duration_minutes} min`}
                                  </span>
                                  <span>·</span>
                                  <span>{session.session_title}</span>
                                </div>
                                {session.content ? (
                                  <p className="mt-2 line-clamp-3 font-medium leading-5 text-slate-500">
                                    {session.content}
                                  </p>
                                ) : null}
                                {session.homework ? (
                                  <p className="mt-2 rounded-lg bg-white px-2.5 py-2 font-semibold text-sky-700">
                                    Travail : {session.homework}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </form>
                ) : (
                  <div className="p-8 text-center">
                    <FileText className="mx-auto h-8 w-8 text-slate-300" />
                    <h2 className="mt-3 text-lg font-black text-slate-900">
                      Aucune leçon disponible
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Vérifiez les lignes de cette progression côté administration.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
