"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  GraduationCap,
  History,
  ListChecks,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";

type TeacherTab = "program" | "entry" | "history";

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
  observations?: string | null;
};

type PeriodSlot = {
  id: string;
  label: string;
  start_hm: string;
  duration_minutes: number;
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
  sessions?: Session[];
  completion?: Completion | null;
};

type Assignment = {
  id: string;
  class_id: string;
  effective_teacher_name?: string | null;
  classes?: {
    id: string;
    label?: string | null;
    level?: string | null;
    academic_year?: string | null;
  } | null;
  progression?: {
    id: string;
    title: string;
    academic_year: string;
    subject_name?: string | null;
    document?: {
      original_name?: string | null;
      signed_url?: string | null;
    } | null;
  } | null;
  progression_items: ProgressionItem[];
};

type BootstrapPayload = {
  ok?: boolean;
  mode?: string;
  items?: Assignment[];
};

type SessionForm = {
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

const TABS: Array<{
  id: TeacherTab;
  label: string;
  subtitle: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}> = [
  {
    id: "program",
    label: "Programme",
    subtitle: "Voir ce qui reste à faire",
    Icon: ListChecks,
  },
  {
    id: "entry",
    label: "Saisir la séance",
    subtitle: "Enregistrer ce qui a été fait",
    Icon: Save,
  },
  {
    id: "history",
    label: "Séances réalisées",
    subtitle: "Relire les séances enregistrées",
    Icon: History,
  },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function normalizeHm(value?: string | null) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hour = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minute = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${pad2(hour)}:${pad2(minute)}`;
}

function addMinutes(hm: string, minutes: number) {
  const value = normalizeHm(hm);
  if (!value) return "";
  const [hour, minute] = value.split(":").map(Number);
  const total = hour * 60 + minute + Math.max(1, Number(minutes || 0));
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
}

function minutesBetween(start?: string | null, end?: string | null) {
  const from = normalizeHm(start);
  const to = normalizeHm(end);
  if (!from || !to) return 0;
  const [fromHour, fromMinute] = from.split(":").map(Number);
  const [toHour, toMinute] = to.split(":").map(Number);
  let diff = toHour * 60 + toMinute - (fromHour * 60 + fromMinute);
  if (diff <= 0) diff += 24 * 60;
  return diff > 0 && diff <= 24 * 60 ? diff : 0;
}

function formatTimeRange(start?: string | null, end?: string | null) {
  const from = normalizeHm(start);
  const to = normalizeHm(end);
  return from && to ? `${from}–${to}` : "";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function plannedMinutes(item: ProgressionItem) {
  const duration = Number(item.planned_duration_minutes || 0);
  if (duration > 0) return duration;
  const sessions = Number(item.planned_sessions_count || 0);
  return sessions > 0 ? sessions * 55 : 0;
}

function typeLabel(value: string) {
  const labels: Record<string, string> = {
    lesson: "Leçon",
    sequence: "Séquence",
    session: "Séance",
    evaluation: "Évaluation",
    remediation: "Remédiation",
    regulation: "Régulation",
    revision: "Révision",
    other: "Activité",
  };
  return labels[value] || "Activité";
}

function isActionableItem(item: ProgressionItem) {
  return (
    ACTIONABLE_TYPES.has(String(item.item_type || "")) ||
    Number(item.planned_duration_minutes || 0) > 0 ||
    Number(item.planned_sessions_count || 0) > 0
  );
}

function emptyForm(): SessionForm {
  return {
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

function progressBar(value: number) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function randomUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  );
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    ...init,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.ok === false) {
    throw new Error(
      json?.message || json?.error || `Erreur HTTP ${response.status}`,
    );
  }
  return json as T;
}

export default function TeacherTextbookPage() {
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [periodSlots, setPeriodSlots] = useState<PeriodSlot[]>([]);
  const [accessMode, setAccessMode] = useState<"teacher" | "class_device">(
    "teacher",
  );
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [activeTab, setActiveTab] = useState<TeacherTab>("program");
  const [form, setForm] = useState<SessionForm>(emptyForm);

  const selectedAssignment = useMemo(
    () =>
      assignments.find((item) => item.id === selectedAssignmentId) || null,
    [assignments, selectedAssignmentId],
  );

  const classOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const assignment of assignments) {
      if (assignment.class_id) {
        map.set(
          assignment.class_id,
          assignment.classes?.label || "Classe",
        );
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, "fr", { numeric: true }),
      );
  }, [assignments]);

  const subjectAssignments = useMemo(() => {
    const classId = selectedAssignment?.class_id;
    if (!classId) return [];
    return assignments
      .filter((assignment) => assignment.class_id === classId)
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

  const selectedItem = useMemo(
    () =>
      actionableItems.find((item) => item.id === selectedItemId) || null,
    [actionableItems, selectedItemId],
  );

  const nextItem = useMemo(
    () =>
      actionableItems.find(
        (item) => item.completion?.status !== "completed",
      ) ||
      actionableItems[0] ||
      null,
    [actionableItems],
  );

  const progressionStats = useMemo(() => {
    const completed = actionableItems.filter(
      (item) => item.completion?.status === "completed",
    );
    const planned = actionableItems.reduce(
      (sum, item) => sum + plannedMinutes(item),
      0,
    );
    const done = completed.reduce(
      (sum, item) => sum + plannedMinutes(item),
      0,
    );
    const rate = planned
      ? Math.round((done / planned) * 1000) / 10
      : actionableItems.length
        ? Math.round((completed.length / actionableItems.length) * 1000) / 10
        : 0;
    return {
      completed: completed.length,
      total: actionableItems.length,
      rate,
    };
  }, [actionableItems]);

  const sessionHistory = useMemo(() => {
    return actionableItems
      .flatMap((item) =>
        (item.sessions || []).map((session) => ({
          ...session,
          item_id: item.id,
          item_title: item.title,
        })),
      )
      .sort((a, b) => {
        const byDate = String(b.session_date || "").localeCompare(
          String(a.session_date || ""),
        );
        if (byDate) return byDate;
        return String(b.session_start_time || "").localeCompare(
          String(a.session_start_time || ""),
        );
      });
  }, [actionableItems]);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);

    try {
      // Association système : classe + matière + enseignant déterminent la progression.
      await fetchJson("/api/teacher/textbook/sync", { method: "POST" });
      const json = await fetchJson<BootstrapPayload>(
        "/api/teacher/textbook/bootstrap",
      );
      const nextAssignments = Array.isArray(json.items) ? json.items : [];
      setAccessMode(
        json.mode === "class_device" ? "class_device" : "teacher",
      );
      setAssignments(nextAssignments);
      setSelectedAssignmentId((current) =>
        current &&
        nextAssignments.some((assignment) => assignment.id === current)
          ? current
          : nextAssignments[0]?.id || "",
      );
    } catch (cause: any) {
      setError(cause?.message || "Chargement du cahier de texte impossible.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!actionableItems.length) {
      setSelectedItemId("");
      return;
    }

    if (!actionableItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(nextItem?.id || actionableItems[0]?.id || "");
    }
  }, [actionableItems, nextItem, selectedItemId]);

  useEffect(() => {
    setForm(emptyForm());
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
    fetchJson<{ items?: PeriodSlot[] }>(
      `/api/institution/slots?class_id=${encodeURIComponent(classId)}`,
    )
      .then((json) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const slots = (json.items || [])
          .map((slot) => {
            const start = normalizeHm(slot.start_hm);
            const duration = Math.max(1, Number(slot.duration_minutes || 0));
            const end = addMinutes(start, duration);
            return {
              ...slot,
              start_hm: start,
              duration_minutes: duration,
              _key: `${start}|${end}|${slot.period_no || slot.label || ""}`,
            };
          })
          .filter((slot) => {
            if (!slot.start_hm || seen.has(slot._key)) return false;
            seen.add(slot._key);
            return true;
          })
          .map(({ _key, ...slot }) => slot)
          .sort(
            (a, b) =>
              Number(a.period_no || 999) - Number(b.period_no || 999) ||
              a.start_hm.localeCompare(b.start_hm),
          );
        setPeriodSlots(slots);
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

  function selectClass(classId: string) {
    const assignment = assignments.find(
      (item) => item.class_id === classId,
    );
    setSelectedAssignmentId(assignment?.id || "");
    setActiveTab("program");
  }

  function selectProgramItem(itemId: string) {
    setSelectedItemId(itemId);
    setActiveTab("entry");
  }

  function selectPeriod(periodId: string) {
    if (periodId === "custom") {
      setForm((current) => ({
        ...current,
        session_period_id: "",
        session_period_label: "Plage personnalisée",
      }));
      return;
    }

    const slot = periodSlots.find((item) => item.id === periodId);
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
      setError("Renseignez le contenu réalisé.");
      return;
    }
    if (!form.session_start_time || !form.session_end_time) {
      setError("Choisissez un créneau ou une plage horaire.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const sessionNumber = (selectedItem.sessions?.length || 0) + 1;
      await fetchJson("/api/teacher/textbook/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: selectedAssignment.id,
          item_id: selectedItem.id,
          client_session_id: randomUuid(),
          session_title: `Séance ${sessionNumber}`,
          ...form,
          duration_minutes:
            minutesBetween(form.session_start_time, form.session_end_time) || 55,
        }),
      });
      setMessage("Séance enregistrée.");
      setForm(emptyForm());
      await load(true);
    } catch (cause: any) {
      setError(cause?.message || "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function updateLessonStatus(status: "completed" | "reopened") {
    if (!selectedAssignment || !selectedItem) return;
    if (status === "completed" && !(selectedItem.sessions?.length || 0)) {
      setError("Enregistrez une séance avant de terminer cette leçon.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      await fetchJson("/api/teacher/textbook/lesson-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: selectedAssignment.id,
          item_id: selectedItem.id,
          status,
        }),
      });
      setMessage(
        status === "completed"
          ? "Leçon terminée."
          : "Leçon rouverte.",
      );
      await load(true);
      if (status === "completed") setActiveTab("program");
    } catch (cause: any) {
      setError(cause?.message || "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-5 text-slate-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          Chargement du cahier de texte…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                {accessMode === "class_device"
                  ? "Compte classe"
                  : "Espace enseignant"}
              </div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                Cahier de texte
              </h1>
            </div>

            <div className="flex items-center gap-2">
              {selectedAssignment?.progression?.document?.signed_url ? (
                <a
                  href={selectedAssignment.progression.document.signed_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
                >
                  <FileText className="h-4 w-4" />
                  Programme PDF
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => void load()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                <RefreshCw className="h-4 w-4" />
                Actualiser
              </button>
            </div>
          </div>

          {assignments.length ? (
            <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 md:grid-cols-[1fr_1fr_220px]">
              <label>
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                  Classe
                </span>
                <div className="relative">
                  <GraduationCap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <select
                    value={selectedAssignment?.class_id || ""}
                    onChange={(event) => selectClass(event.target.value)}
                    disabled={
                      accessMode === "class_device" || classOptions.length <= 1
                    }
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm font-black outline-none focus:border-emerald-400 disabled:opacity-80"
                  >
                    {classOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label>
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                  Discipline
                </span>
                <select
                  value={selectedAssignmentId}
                  onChange={(event) => {
                    setSelectedAssignmentId(event.target.value);
                    setActiveTab("program");
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black outline-none focus:border-emerald-400"
                >
                  {subjectAssignments.map((assignment) => (
                    <option key={assignment.id} value={assignment.id}>
                      {assignment.progression?.subject_name || "Matière"}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-xl bg-emerald-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-black uppercase tracking-[0.1em] text-emerald-700">
                    Avancement
                  </span>
                  <span className="text-xl font-black text-emerald-950">
                    {progressionStats.rate}%
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{ width: `${progressBar(progressionStats.rate)}%` }}
                  />
                </div>
                <div className="mt-1.5 text-right text-[11px] font-bold text-emerald-700">
                  {progressionStats.completed}/{progressionStats.total} étapes
                </div>
              </div>
            </div>
          ) : null}
        </header>

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
          <section className="rounded-[24px] border border-slate-200 bg-white p-10 text-center shadow-sm">
            <BookOpen className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-4 text-xl font-black text-slate-950">
              Aucune progression disponible
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm font-medium text-slate-500">
              Le système associe automatiquement les programmes à vos classes et
              disciplines à partir de vos affectations pédagogiques.
            </p>
          </section>
        ) : (
          <>
            <nav className="grid gap-2 rounded-[24px] border border-slate-200 bg-white p-2 shadow-sm md:grid-cols-3">
              {TABS.map(({ id, label, subtitle, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`min-h-[82px] rounded-2xl px-4 py-3 text-left transition ${
                    activeTab === id
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                        activeTab === id ? "bg-white/15" : "bg-white"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="text-base font-black">{label}</div>
                      <div
                        className={`mt-0.5 text-xs font-semibold ${
                          activeTab === id
                            ? "text-emerald-50"
                            : "text-slate-500"
                        }`}
                      >
                        {subtitle}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </nav>

            {activeTab === "program" ? (
              <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-xl font-black text-slate-950">
                    Programme
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {selectedAssignment?.progression?.subject_name} ·{" "}
                    {selectedAssignment?.classes?.label}
                  </p>
                </div>

                {actionableItems.length ? (
                  <div className="divide-y divide-slate-100">
                    {actionableItems.map((item, index) => {
                      const completed =
                        item.completion?.status === "completed";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => selectProgramItem(item.id)}
                          className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
                        >
                          <span
                            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black ${
                              completed
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {completed ? (
                              <CheckCircle2 className="h-5 w-5" />
                            ) : (
                              index + 1
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-black text-slate-950">
                              {item.title}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
                              <span>{typeLabel(item.item_type)}</span>
                              {item.trimester ? <span>{item.trimester}</span> : null}
                              {item.week_label ? <span>{item.week_label}</span> : null}
                              {plannedMinutes(item) ? (
                                <span>{plannedMinutes(item)} min prévues</span>
                              ) : null}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase ${
                              completed
                                ? "bg-emerald-50 text-emerald-700"
                                : item.sessions?.length
                                  ? "bg-sky-50 text-sky-700"
                                  : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {completed
                              ? "Terminée"
                              : item.sessions?.length
                                ? "En cours"
                                : "À faire"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-6 py-10 text-center text-sm font-semibold text-slate-500">
                    Aucune étape exploitable dans cette progression.
                  </div>
                )}
              </section>
            ) : null}

            {activeTab === "entry" ? (
              <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                {selectedItem ? (
                  <form onSubmit={saveSession}>
                    <div className="border-b border-slate-100 px-5 py-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
                            {typeLabel(selectedItem.item_type)}
                          </div>
                          <h2 className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">
                            {selectedItem.title}
                          </h2>
                        </div>
                        <select
                          value={selectedItemId}
                          onChange={(event) =>
                            setSelectedItemId(event.target.value)
                          }
                          className="max-w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400"
                        >
                          {actionableItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-5 p-5 sm:p-6">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label>
                          <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                            Date
                          </span>
                          <div className="relative">
                            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              type="date"
                              value={form.session_date}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  session_date: event.target.value,
                                }))
                              }
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm font-bold outline-none focus:border-emerald-400"
                            />
                          </div>
                        </label>

                        <label>
                          <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                            Créneau
                          </span>
                          <select
                            value={form.session_period_id || (form.session_period_label === "Plage personnalisée" ? "custom" : "")}
                            onChange={(event) => selectPeriod(event.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400"
                          >
                            <option value="">
                              {slotsLoading
                                ? "Chargement…"
                                : "Choisir un créneau"}
                            </option>
                            {periodSlots.map((slot) => (
                              <option key={slot.id} value={slot.id}>
                                {slot.label} ·{" "}
                                {formatTimeRange(
                                  slot.start_hm,
                                  addMinutes(
                                    slot.start_hm,
                                    slot.duration_minutes,
                                  ),
                                )}
                              </option>
                            ))}
                            <option value="custom">Plage personnalisée</option>
                          </select>
                        </label>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label>
                          <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                            Début
                          </span>
                          <input
                            type="time"
                            value={form.session_start_time}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                session_start_time: event.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400"
                          />
                        </label>
                        <label>
                          <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                            Fin
                          </span>
                          <input
                            type="time"
                            value={form.session_end_time}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                session_end_time: event.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400"
                          />
                        </label>
                      </div>

                      <label>
                        <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.12em] text-slate-600">
                          Contenu réalisé
                        </span>
                        <textarea
                          rows={5}
                          value={form.content}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              content: event.target.value,
                            }))
                          }
                          placeholder="Ce qui a réellement été fait pendant la séance…"
                          className="w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        />
                      </label>

                      <details className="rounded-2xl border border-slate-200 bg-slate-50">
                        <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-700">
                          Devoir et observation — facultatif
                        </summary>
                        <div className="grid gap-4 border-t border-slate-200 p-4 md:grid-cols-2">
                          <label>
                            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                              Travail à faire
                            </span>
                            <textarea
                              rows={3}
                              value={form.homework}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  homework: event.target.value,
                                }))
                              }
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
                            />
                          </label>
                          <label>
                            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                              Observation
                            </span>
                            <textarea
                              rows={3}
                              value={form.observations}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  observations: event.target.value,
                                }))
                              }
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
                            />
                          </label>
                        </div>
                      </details>

                      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
                        <button
                          type="submit"
                          disabled={busy}
                          className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60 sm:flex-none"
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
                            onClick={() => void updateLessonStatus("reopened")}
                            disabled={busy}
                            className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            <RotateCcw className="h-4 w-4" />
                            Rouvrir
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void updateLessonStatus("completed")}
                            disabled={busy || !(selectedItem.sessions?.length || 0)}
                            className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Terminer la leçon
                          </button>
                        )}
                      </div>
                    </div>
                  </form>
                ) : (
                  <div className="px-6 py-12 text-center text-sm font-semibold text-slate-500">
                    Sélectionnez une étape du programme.
                  </div>
                )}
              </section>
            ) : null}

            {activeTab === "history" ? (
              <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-xl font-black text-slate-950">
                    Séances réalisées
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {selectedAssignment?.classes?.label} ·{" "}
                    {selectedAssignment?.progression?.subject_name}
                  </p>
                </div>

                {sessionHistory.length ? (
                  <div className="divide-y divide-slate-100">
                    {sessionHistory.map((session) => (
                      <article
                        key={session.id}
                        className="grid gap-3 px-5 py-4 md:grid-cols-[150px_1fr_160px]"
                      >
                        <div>
                          <div className="font-black text-slate-900">
                            {formatDate(session.session_date)}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatTimeRange(
                              session.session_start_time,
                              session.session_end_time,
                            ) ||
                              session.session_period_label ||
                              `${session.duration_minutes || 0} min`}
                          </div>
                        </div>
                        <div>
                          <div className="font-black text-slate-950">
                            {session.item_title}
                          </div>
                          {session.content ? (
                            <div className="mt-1 text-sm font-medium text-slate-600">
                              {session.content}
                            </div>
                          ) : null}
                          {session.homework ? (
                            <div className="mt-2 text-xs font-semibold text-slate-500">
                              Travail : {session.homework}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-right text-xs font-bold text-slate-500">
                          {session.session_title || "Séance"}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="px-6 py-12 text-center text-sm font-semibold text-slate-500">
                    Aucune séance enregistrée pour cette discipline.
                  </div>
                )}
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
