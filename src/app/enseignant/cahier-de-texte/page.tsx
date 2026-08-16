"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  GraduationCap,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";

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
  academic_year?: string | null;
  academic_years?: string[];
  items?: Assignment[];
};

type SyncPayload = {
  ok?: boolean;
  academic_year?: string | null;
  academic_years?: string[];
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

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function progressionStats(items: ProgressionItem[]) {
  const actionable = items.filter(isActionableItem);
  const completed = actionable.filter(
    (item) => item.completion?.status === "completed",
  );
  const planned = actionable.reduce(
    (sum, item) => sum + plannedMinutes(item),
    0,
  );
  const done = completed.reduce(
    (sum, item) => sum + plannedMinutes(item),
    0,
  );
  const rate = planned
    ? Math.round((done / planned) * 1000) / 10
    : actionable.length
      ? Math.round((completed.length / actionable.length) * 1000) / 10
      : 0;
  return { completed: completed.length, total: actionable.length, rate };
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
  const [busyAction, setBusyAction] = useState<"save" | "status" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [academicYears, setAcademicYears] = useState<string[]>([]);
  const [academicYear, setAcademicYear] = useState("");
  const [periodSlots, setPeriodSlots] = useState<PeriodSlot[]>([]);
  const [accessMode, setAccessMode] = useState<"teacher" | "class_device">(
    "teacher",
  );
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [form, setForm] = useState<SessionForm>(emptyForm);

  async function load(
    year?: string,
    silent = false,
    syncAssignments = true,
  ) {
    if (!silent) setLoading(true);
    setError(null);

    try {
      let targetYear = String(year || academicYear || "").trim();
      let syncYears: string[] = academicYears;

      if (syncAssignments) {
        const syncJson = await fetchJson<SyncPayload>(
          "/api/teacher/textbook/sync",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              targetYear ? { academic_year: targetYear } : {},
            ),
          },
        );
        targetYear = targetYear || String(syncJson.academic_year || "").trim();
        syncYears = Array.isArray(syncJson.academic_years)
          ? syncJson.academic_years.filter(Boolean)
          : syncYears;
      }

      const json = await fetchJson<BootstrapPayload>(
        "/api/teacher/textbook/bootstrap",
      );
      const allAssignments = Array.isArray(json.items) ? json.items : [];
      const assignmentYears = Array.from(
        new Set(
          allAssignments
            .map((assignment) =>
              String(
                assignment.progression?.academic_year ||
                  assignment.classes?.academic_year ||
                  "",
              ).trim(),
            )
            .filter(Boolean),
        ),
      ).sort((a, b) => b.localeCompare(a));
      const nextYears = Array.from(
        new Set([...syncYears, ...assignmentYears, targetYear].filter(Boolean)),
      ).sort((a, b) => b.localeCompare(a));
      const resolvedYear = String(targetYear || nextYears[0] || "").trim();
      const nextAssignments = resolvedYear
        ? allAssignments.filter(
            (assignment) =>
              String(
                assignment.progression?.academic_year ||
                  assignment.classes?.academic_year ||
                  "",
              ).trim() === resolvedYear,
          )
        : allAssignments;

      setAccessMode(
        json.mode === "class_device" ? "class_device" : "teacher",
      );
      setAcademicYears(nextYears);
      setAcademicYear(resolvedYear);
      setAssignments(nextAssignments);

      setSelectedClassId((current) => {
        const available = new Set(
          nextAssignments.map((assignment) => assignment.class_id),
        );
        return current && available.has(current)
          ? current
          : nextAssignments[0]?.class_id || "";
      });
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
    // Le premier chargement résout l'année scolaire active côté serveur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const classAssignments = useMemo(
    () =>
      assignments
        .filter((assignment) => assignment.class_id === selectedClassId)
        .sort((a, b) =>
          String(a.progression?.subject_name || "").localeCompare(
            String(b.progression?.subject_name || ""),
            "fr",
          ),
        ),
    [assignments, selectedClassId],
  );

  useEffect(() => {
    if (!classOptions.length) {
      if (selectedClassId) setSelectedClassId("");
      return;
    }
    if (!classOptions.some((option) => option.id === selectedClassId)) {
      setSelectedClassId(classOptions[0].id);
    }
  }, [classOptions, selectedClassId]);

  useEffect(() => {
    if (!classAssignments.length) {
      if (selectedAssignmentId) setSelectedAssignmentId("");
      return;
    }
    if (
      !classAssignments.some(
        (assignment) => assignment.id === selectedAssignmentId,
      )
    ) {
      setSelectedAssignmentId(classAssignments[0].id);
    }
  }, [classAssignments, selectedAssignmentId]);

  const selectedAssignment = useMemo(
    () =>
      classAssignments.find((item) => item.id === selectedAssignmentId) ||
      null,
    [classAssignments, selectedAssignmentId],
  );

  const actionableItems = useMemo(
    () =>
      (selectedAssignment?.progression_items || []).filter(isActionableItem),
    [selectedAssignment],
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

  useEffect(() => {
    if (!actionableItems.length) {
      if (selectedItemId) setSelectedItemId("");
      return;
    }
    if (!actionableItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(nextItem?.id || actionableItems[0].id);
    }
  }, [actionableItems, nextItem, selectedItemId]);

  const selectedItem = useMemo(
    () =>
      actionableItems.find((item) => item.id === selectedItemId) || null,
    [actionableItems, selectedItemId],
  );

  const selectedStats = useMemo(
    () => progressionStats(actionableItems),
    [actionableItems],
  );

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

  function changeAcademicYear(value: string) {
    setAcademicYear(value);
    setSelectedClassId("");
    setSelectedAssignmentId("");
    setSelectedItemId("");
    setMessage(null);
    void load(value, false, true);
  }

  function changeClass(value: string) {
    setSelectedClassId(value);
    const first = assignments.find((item) => item.class_id === value);
    setSelectedAssignmentId(first?.id || "");
    setSelectedItemId("");
  }

  function selectLesson(itemId: string) {
    setSelectedItemId(itemId);
    setMessage(null);
    setError(null);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      window.setTimeout(() => {
        document
          .getElementById("lesson-workspace")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }

  function selectPeriod(periodId: string) {
    if (periodId === "custom") {
      setForm((current) => ({
        ...current,
        session_period_id: "",
        session_period_label: "Plage personnalisée",
        session_start_time: "",
        session_end_time: "",
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

    if (!form.session_start_time || !form.session_end_time) {
      setError("Choisissez un créneau ou une plage horaire.");
      return;
    }

    setBusyAction("save");
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
      await load(academicYear, true, false);
    } catch (cause: any) {
      setError(cause?.message || "Enregistrement impossible.");
    } finally {
      setBusyAction(null);
    }
  }

  async function updateLessonStatus(status: "completed" | "reopened") {
    if (!selectedAssignment || !selectedItem) return;

    setBusyAction("status");
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
        status === "completed" ? "Leçon terminée." : "Leçon rouverte.",
      );
      await load(academicYear, true, false);
    } catch (cause: any) {
      setError(cause?.message || "Action impossible.");
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6">
        <div className="mx-auto flex max-w-6xl items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          Chargement du cahier de texte…
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-900 sm:px-6 sm:py-5">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">
                {accessMode === "class_device" ? "Compte classe" : "Espace enseignant"}
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
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 hover:bg-slate-50"
                >
                  <FileText className="h-4 w-4" />
                  <span className="hidden sm:inline">Programme PDF</span>
                  <span className="sm:hidden">PDF</span>
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => void load(academicYear, false, true)}
                disabled={Boolean(busyAction)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">Actualiser</span>
              </button>
            </div>
          </div>
        </header>

        <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.12em] text-slate-600">
                Année scolaire
              </span>
              <select
                value={academicYear}
                onChange={(event) => changeAcademicYear(event.target.value)}
                disabled={accessMode === "class_device" || Boolean(busyAction)}
                className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-black outline-none focus:border-emerald-400 disabled:opacity-70"
              >
                {academicYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.12em] text-slate-600">
                Classe
              </span>
              <div className="relative">
                <GraduationCap className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <select
                  value={selectedClassId}
                  onChange={(event) => changeClass(event.target.value)}
                  disabled={
                    accessMode === "class_device" ||
                    classOptions.length <= 1 ||
                    Boolean(busyAction)
                  }
                  className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-11 pr-3 text-base font-black outline-none focus:border-emerald-400 disabled:opacity-70"
                >
                  {classOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </div>
        </section>

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
          <section className="rounded-[22px] border border-slate-200 bg-white p-8 text-center shadow-sm">
            <BookOpenCheck className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-3 text-xl font-black text-slate-950">
              Aucune progression disponible
            </h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {academicYear || "Cette année scolaire"}
            </p>
          </section>
        ) : (
          <>
            <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-black text-slate-950 sm:text-xl">
                  Progressions
                </h2>
                <span className="text-xs font-bold text-slate-500">
                  {selectedAssignment?.classes?.label}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {classAssignments.map((assignment) => {
                  const stats = progressionStats(assignment.progression_items || []);
                  const active = assignment.id === selectedAssignmentId;
                  return (
                    <button
                      key={assignment.id}
                      type="button"
                      onClick={() => {
                        setSelectedAssignmentId(assignment.id);
                        setSelectedItemId("");
                      }}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        active
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-base font-black text-slate-950">
                          {assignment.progression?.subject_name || "Discipline"}
                        </span>
                        <span className="text-lg font-black text-emerald-700">
                          {stats.rate.toLocaleString("fr-FR", {
                            maximumFractionDigits: 1,
                          })}%
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-emerald-600"
                          style={{ width: `${clampPercent(stats.rate)}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {selectedAssignment ? (
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
                <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">
                          Leçons
                        </div>
                        <h2 className="mt-1 text-xl font-black text-slate-950">
                          {selectedAssignment.progression?.subject_name || "Programme"}
                        </h2>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-black text-emerald-700">
                          {selectedStats.rate.toLocaleString("fr-FR", {
                            maximumFractionDigits: 1,
                          })}%
                        </div>
                        <div className="text-[11px] font-bold text-slate-500">
                          {selectedStats.completed}/{selectedStats.total}
                        </div>
                      </div>
                    </div>
                  </div>

                  {actionableItems.length ? (
                    <div className="divide-y divide-slate-100">
                      {actionableItems.map((item, index) => {
                        const completed = item.completion?.status === "completed";
                        const active = item.id === selectedItemId;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => selectLesson(item.id)}
                            className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition sm:px-5 ${
                              active ? "bg-emerald-50" : "hover:bg-slate-50"
                            }`}
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
                              <div className="text-[15px] font-black leading-snug text-slate-950 sm:text-base">
                                {item.title}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
                                {item.trimester ? <span>{item.trimester}</span> : null}
                                {item.sessions?.length ? (
                                  <span>{item.sessions.length} séance(s)</span>
                                ) : null}
                              </div>
                            </div>
                            <span
                              className={`shrink-0 text-[11px] font-black ${
                                completed ? "text-emerald-700" : "text-slate-400"
                              }`}
                            >
                              {completed ? "Terminée" : typeLabel(item.item_type)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-5 py-8 text-center text-sm font-semibold text-slate-500">
                      Aucune leçon disponible.
                    </div>
                  )}
                </section>

                <section
                  id="lesson-workspace"
                  className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm scroll-mt-4"
                >
                  {selectedItem ? (
                    <form onSubmit={saveSession}>
                      <div className="border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">
                              {typeLabel(selectedItem.item_type)}
                              {selectedItem.trimester ? ` · ${selectedItem.trimester}` : ""}
                            </div>
                            <h2 className="mt-1 text-xl font-black leading-tight text-slate-950 sm:text-2xl">
                              {selectedItem.title}
                            </h2>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1.5 text-[11px] font-black ${
                              selectedItem.completion?.status === "completed"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {selectedItem.completion?.status === "completed"
                              ? "Terminée"
                              : "En cours"}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-5 p-4 sm:p-6">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label>
                            <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.12em] text-slate-600">
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
                                className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-3 text-base font-bold outline-none focus:border-emerald-400"
                              />
                            </div>
                          </label>

                          <label>
                            <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.12em] text-slate-600">
                              Créneau
                            </span>
                            <select
                              value={
                                form.session_period_id ||
                                (form.session_period_label === "Plage personnalisée"
                                  ? "custom"
                                  : "")
                              }
                              onChange={(event) => selectPeriod(event.target.value)}
                              className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-bold outline-none focus:border-emerald-400"
                            >
                              <option value="">
                                {slotsLoading ? "Chargement…" : "Choisir un créneau"}
                              </option>
                              {periodSlots.map((slot) => (
                                <option key={slot.id} value={slot.id}>
                                  {slot.label} · {formatTimeRange(
                                    slot.start_hm,
                                    addMinutes(slot.start_hm, slot.duration_minutes),
                                  )}
                                </option>
                              ))}
                              <option value="custom">Plage personnalisée</option>
                            </select>
                          </label>
                        </div>

                        {form.session_period_label === "Plage personnalisée" ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label>
                              <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.12em] text-slate-600">
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
                                className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-bold outline-none focus:border-emerald-400"
                              />
                            </label>
                            <label>
                              <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.12em] text-slate-600">
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
                                className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-bold outline-none focus:border-emerald-400"
                              />
                            </label>
                          </div>
                        ) : null}

                        <label className="block">
                          <div className="mb-2 flex items-baseline justify-between gap-3">
                            <span className="text-sm font-black uppercase tracking-[0.11em] text-slate-800">
                              Contenu réalisé
                            </span>
                            <span className="text-xs font-bold text-slate-400">
                              Facultatif
                            </span>
                          </div>
                          <textarea
                            rows={7}
                            value={form.content}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                content: event.target.value,
                              }))
                            }
                            placeholder="Ce qui a été fait pendant la séance…"
                            className="w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-medium leading-relaxed outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          />
                        </label>

                        <label className="block rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                          <span className="mb-2 block text-sm font-black uppercase tracking-[0.11em] text-amber-900">
                            Travail à faire
                          </span>
                          <textarea
                            rows={4}
                            value={form.homework}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                homework: event.target.value,
                              }))
                            }
                            placeholder="Exercices, leçon à apprendre, recherche…"
                            className="w-full resize-y rounded-xl border border-amber-200 bg-white px-4 py-3 text-base font-medium leading-relaxed outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                          />
                        </label>

                        <details className="rounded-xl border border-slate-200 bg-slate-50">
                          <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-600">
                            Observation facultative
                          </summary>
                          <div className="border-t border-slate-200 p-4">
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
                          </div>
                        </details>

                        <div className="grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
                          <button
                            type="submit"
                            disabled={Boolean(busyAction)}
                            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-base font-black text-white hover:bg-slate-800 disabled:opacity-60"
                          >
                            {busyAction === "save" ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <Save className="h-5 w-5" />
                            )}
                            Enregistrer la séance
                          </button>

                          {selectedItem.completion?.status === "completed" ? (
                            <button
                              type="button"
                              onClick={() => void updateLessonStatus("reopened")}
                              disabled={Boolean(busyAction)}
                              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              {busyAction === "status" ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-5 w-5" />
                              )}
                              Rouvrir la leçon
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void updateLessonStatus("completed")}
                              disabled={Boolean(busyAction)}
                              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-base font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                              {busyAction === "status" ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-5 w-5" />
                              )}
                              Terminer la leçon
                            </button>
                          )}
                        </div>

                        {selectedItem.sessions?.length ? (
                          <details className="rounded-xl border border-slate-200 bg-white">
                            <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-700">
                              Séances enregistrées ({selectedItem.sessions.length})
                            </summary>
                            <div className="divide-y divide-slate-100 border-t border-slate-200">
                              {selectedItem.sessions.map((session) => (
                                <article key={session.id} className="px-4 py-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-black text-slate-900">
                                      {formatDate(session.session_date)}
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                                      <Clock3 className="h-3.5 w-3.5" />
                                      {formatTimeRange(
                                        session.session_start_time,
                                        session.session_end_time,
                                      ) || session.session_period_label || `${session.duration_minutes || 0} min`}
                                    </div>
                                  </div>
                                  {session.content ? (
                                    <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">
                                      {session.content}
                                    </p>
                                  ) : null}
                                  {session.homework ? (
                                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                                      Travail à faire : {session.homework}
                                    </div>
                                  ) : null}
                                </article>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </form>
                  ) : (
                    <div className="px-6 py-12 text-center text-sm font-semibold text-slate-500">
                      Sélectionnez une leçon.
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
