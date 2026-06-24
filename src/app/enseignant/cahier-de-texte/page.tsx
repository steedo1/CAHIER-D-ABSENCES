"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  RefreshCw,
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
  classes?: { id: string; label?: string | null; level?: string | null } | null;
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
  if (!minutes) return "0h";
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
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
  return d.toLocaleDateString("fr-FR");
}

function classLabel(a: Assignment | null) {
  return a?.classes?.label || "Classe";
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

export default function TeacherTextbookPage() {
  const [loading, setLoading] = useState(true);
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
  const [screen, setScreen] = useState<"list" | "progression" | "session">(
    "list",
  );
  const [form, setForm] = useState({
    session_title: "",
    session_date: todayIso(),
    session_period_id: "",
    session_period_label: "",
    session_start_time: "",
    session_end_time: "",
    content: "",
    homework: "",
    observations: "",
  });

  const selectedAssignment = useMemo(
    () => assignments.find((a) => a.id === selectedAssignmentId) || null,
    [assignments, selectedAssignmentId],
  );

  const selectedItem = useMemo(
    () =>
      selectedAssignment?.progression_items?.find(
        (it) => it.id === selectedItemId,
      ) || null,
    [selectedAssignment, selectedItemId],
  );

  const progressStats = useMemo(() => {
    const items = selectedAssignment?.progression_items || [];
    const actionable = items.filter(isActionableItem);
    const completed = actionable.filter(
      (it) => it.completion?.status === "completed",
    );
    const plannedTotal = actionable.reduce(
      (sum, it) => sum + plannedMinutes(it),
      0,
    );
    const completedPlanned = completed.reduce(
      (sum, it) => sum + plannedMinutes(it),
      0,
    );
    const sessions = items.reduce(
      (sum, it) => sum + (it.sessions?.length || 0),
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
  }, [selectedAssignment]);

  async function fetchJson(url: string, init?: RequestInit) {
    const res = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      ...init,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.ok === false)
      throw new Error(
        json?.error || json?.details || `Erreur HTTP ${res.status}`,
      );
    return json;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [json, slotsJson] = await Promise.all([
        fetchJson("/api/teacher/textbook/bootstrap"),
        fetchJson("/api/institution/slots").catch(() => ({ items: [] })),
      ]);
      const items = json.items || [];
      setAccessMode(json.mode === "class_device" ? "class_device" : "teacher");
      setAssignments(items);
      setPeriodSlots(buildUniquePeriodSlots(slotsJson.items || []));
      setSelectedAssignmentId((current) =>
        current && items.some((a: Assignment) => a.id === current) ? current : "",
      );
    } catch (e: any) {
      setError(e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setSelectedItemId("");
  }, [selectedAssignmentId]);

  function openAssignment(assignment: Assignment) {
    setSelectedAssignmentId(assignment.id);
    setSelectedItemId("");
    setScreen("progression");
  }

  function backToList() {
    setSelectedItemId("");
    setSelectedAssignmentId("");
    setScreen("list");
  }

  function backToProgression() {
    setSelectedItemId("");
    setScreen("progression");
  }

  function openItem(item: ProgressionItem) {
    if (!isActionableItem(item)) return;
    const nextIndex = (item.sessions?.length || 0) + 1;
    const defaultSlot = periodSlots[0] || null;
    const start = defaultSlot?.start_hm || "";
    const end = defaultSlot
      ? addMinutes(defaultSlot.start_hm, defaultSlot.duration_minutes)
      : "";
    setSelectedItemId(item.id);
    setScreen("session");
    setForm({
      session_title: `Séance ${nextIndex}`,
      session_date: todayIso(),
      session_period_id: defaultSlot?.id || "",
      session_period_label: defaultSlot
        ? `${defaultSlot.label} · ${formatTimeRange(start, end)}`
        : "",
      session_start_time: start,
      session_end_time: end,
      content: "",
      homework: "",
      observations: "",
    });
  }

  function handlePeriodChange(periodId: string) {
    if (periodId === "custom") {
      setForm((f) => ({
        ...f,
        session_period_id: "",
        session_period_label: "Plage personnalisée",
      }));
      return;
    }

    const slot = periodSlots.find((s) => s.id === periodId) || null;
    if (!slot) return;
    const start = normalizeHm(slot.start_hm);
    const end = addMinutes(start, slot.duration_minutes);
    setForm((f) => ({
      ...f,
      session_period_id: slot.id,
      session_period_label: `${slot.label} · ${formatTimeRange(start, end)}`,
      session_start_time: start,
      session_end_time: end,
    }));
  }

  async function saveSession(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAssignment || !selectedItem) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fetchJson("/api/teacher/textbook/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: selectedAssignment.id,
          item_id: selectedItem.id,
          ...form,
          duration_minutes:
            minutesBetween(form.session_start_time, form.session_end_time) || 55,
        }),
      });
      setMessage("Séance enregistrée dans le cahier de texte.");
      await load();
    } catch (e: any) {
      setError(e?.message || "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function markCompleted() {
    if (!selectedAssignment || !selectedItem) return;
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
          status: "completed",
        }),
      });
      setMessage("Leçon marquée comme terminée.");
      await load();
    } catch (e: any) {
      setError(e?.message || "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 text-slate-900 md:px-6 md:py-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-[24px] border border-slate-200 bg-white/95 p-4 shadow-sm md:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700 ring-1 ring-emerald-100">
                <BookOpen className="h-3.5 w-3.5" />
                {accessMode === "class_device" ? "Compte classe" : "Espace enseignant"}
              </div>
              <h1 className="mt-2 text-xl font-black tracking-tight text-slate-950 md:text-3xl">
                Cahier de texte
              </h1>
              <p className="mt-1 hidden max-w-2xl text-sm font-semibold text-slate-500 md:block">
                Sélectionnez une progression, puis une leçon à renseigner.
              </p>
            </div>
            <button
              onClick={load}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 shadow-sm transition hover:bg-emerald-100 md:px-4 md:text-sm"
            >
              <RefreshCw className="h-4 w-4" /> Actualiser
            </button>
          </div>
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

        {loading ? (
          <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin" /> Chargement du cahier de
            texte…
          </div>
        ) : !assignments.length ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500">
              <FileText className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-xl font-black">
              Aucune progression affectée
            </h2>
            <p className="mt-2 text-sm font-medium text-slate-500">
              L’administration doit d’abord créer une progression et l’affecter
              à la classe et à la discipline concernées.
            </p>
          </div>
        ) : screen === "list" ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">
                  {accessMode === "class_device"
                    ? "Progressions de la classe"
                    : "Mes progressions"}
                </div>
                <h2 className="mt-1 text-2xl font-black text-slate-950">
                  Choisir une progression
                </h2>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                {assignments.length}
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {assignments.map((a) => {
                const actionable = (a.progression_items || []).filter(isActionableItem);
                const completed = actionable.filter(
                  (it) => it.completion?.status === "completed",
                );
                const rate = actionable.length
                  ? Math.round((completed.length / actionable.length) * 100)
                  : 0;
                return (
                  <button
                    key={a.id}
                    onClick={() => openAssignment(a)}
                    className="group relative min-h-[132px] overflow-hidden rounded-[24px] border-2 border-emerald-100 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                  >
                    <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-emerald-500 to-sky-500" />
                    <div className="flex items-start justify-between gap-3 pl-2">
                      <div className="min-w-0">
                        <div className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                          {a.progression?.subject_name || "Matière"}
                        </div>
                        <h3 className="mt-3 text-lg font-black text-slate-950">
                          {classLabel(a)}
                        </h3>
                        <p className="mt-1 line-clamp-2 text-xs font-bold leading-5 text-slate-500">
                          {a.progression?.title || "Progression"}
                          {a.effective_teacher_name
                            ? ` · ${a.effective_teacher_name}`
                            : ""}
                        </p>
                      </div>
                      <div className="grid h-10 w-10 flex-none place-items-center rounded-2xl bg-slate-50 text-emerald-700 transition group-hover:bg-emerald-50">
                        <ChevronRight className="h-5 w-5" />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 pl-2 text-xs font-black text-slate-500">
                      <span>{completed.length}/{actionable.length} terminé(s)</span>
                      <span className="text-emerald-700">{rate}%</span>
                    </div>
                    <div className="mt-2 ml-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-600"
                        style={{ width: `${Math.min(100, rate)}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : screen === "progression" && selectedAssignment ? (
          <section className="space-y-4">
            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={backToList}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-200"
                  >
                    <ChevronRight className="h-4 w-4 rotate-180" /> Mes progressions
                  </button>
                  <div className="mt-4 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">
                    {classLabel(selectedAssignment)}
                  </div>
                  <h2 className="mt-1 text-2xl font-black text-slate-950 md:text-3xl">
                    {selectedAssignment.progression?.title || "Progression"}
                  </h2>
                  <p className="mt-1 text-sm font-bold text-slate-500">
                    {selectedAssignment.progression?.subject_name || "Matière"} · {selectedAssignment.progression?.academic_year}
                    {selectedAssignment.effective_teacher_name
                      ? ` · ${selectedAssignment.effective_teacher_name}`
                      : ""}
                  </p>
                </div>
                <div className="w-full rounded-2xl bg-emerald-50 p-4 md:w-auto md:min-w-[210px]">
                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
                    Avancement
                  </div>
                  <div className="mt-1 text-3xl font-black text-emerald-950">
                    {progressStats.rate}%
                  </div>
                  <div className="mt-1 text-xs font-bold text-emerald-800">
                    {progressStats.completed}/{progressStats.total} élément(s)
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{ width: `${Math.min(100, progressStats.rate)}%` }}
                    />
                  </div>
                </div>
              </div>
              {selectedAssignment.progression?.document?.signed_url ? (
                <a
                  href={selectedAssignment.progression.document.signed_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-700"
                >
                  <FileText className="h-4 w-4" /> Progression officielle
                </a>
              ) : null}
            </div>

            <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 md:px-5">
                <div>
                  <h3 className="text-lg font-black text-slate-950">
                    Tableau de progression
                  </h3>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    Cliquez sur une leçon pour renseigner la séance.
                  </p>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                  {progressStats.sessions} séance(s)
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Élément</th>
                      <th className="px-4 py-3">Période</th>
                      <th className="px-4 py-3">Temps</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedAssignment.progression_items.map((item) => {
                      const actionable = isActionableItem(item);
                      const complete = item.completion?.status === "completed";
                      return (
                        <tr
                          key={item.id}
                          onClick={actionable ? () => openItem(item) : undefined}
                          className={classNames(
                            "transition",
                            actionable
                              ? "cursor-pointer hover:bg-emerald-50/70"
                              : "bg-slate-50/60 text-slate-500",
                          )}
                        >
                          <td className="whitespace-nowrap px-4 py-3 align-top">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">
                              {typeLabel(item.item_type)}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div
                              className="font-black text-slate-950"
                              style={{ paddingLeft: `${(item.indent_level || 0) * 18}px` }}
                            >
                              {item.title}
                            </div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">
                              {item.theme || item.rubric || ""}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-top text-xs font-bold text-slate-600">
                            {item.trimester || "—"}
                            {item.week_label ? (
                              <span className="block text-slate-400">{item.week_label}</span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 align-top text-xs font-bold text-slate-600">
                            {plannedMinutes(item) ? formatHours(plannedMinutes(item)) : "—"}
                            {item.sessions?.length ? (
                              <span className="block text-sky-700">
                                {item.sessions.length} séance(s)
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right align-top">
                            {complete ? (
                              <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-700">
                                Terminé
                              </span>
                            ) : actionable ? (
                              <span className="inline-flex items-center justify-end gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-black text-white">
                                Saisir <ChevronRight className="h-3.5 w-3.5" />
                              </span>
                            ) : (
                              <span className="text-xs font-bold text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        ) : screen === "session" && selectedAssignment && selectedItem ? (
          <section className="space-y-4">
            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
              <button
                type="button"
                onClick={backToProgression}
                className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-200"
              >
                <ChevronRight className="h-4 w-4 rotate-180" /> Retour au tableau
              </button>
              <div className="mt-4 rounded-2xl bg-emerald-50 p-4">
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">
                  Séance réalisée
                </div>
                <h2 className="mt-1 text-xl font-black text-emerald-950 md:text-2xl">
                  {selectedItem.title}
                </h2>
                <p className="mt-1 text-xs font-bold text-emerald-800">
                  {classLabel(selectedAssignment)} · {selectedAssignment.progression?.subject_name || "Matière"}
                </p>
              </div>
            </div>

            <form
              onSubmit={saveSession}
              className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm md:p-6"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400 md:col-span-2"
                  value={form.session_title}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      session_title: e.target.value,
                    }))
                  }
                  placeholder="Séance 1"
                />
                <input
                  type="date"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                  value={form.session_date}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      session_date: e.target.value,
                    }))
                  }
                />

                <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
                  <label className="text-xs font-black uppercase tracking-wide text-slate-500">
                    Plage horaire de la séance
                  </label>
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-400"
                    value={form.session_period_id || "custom"}
                    onChange={(e) => handlePeriodChange(e.target.value)}
                  >
                    {periodSlots.map((slot) => {
                      const start = normalizeHm(slot.start_hm);
                      const end = addMinutes(start, slot.duration_minutes);
                      return (
                        <option key={slot.id} value={slot.id}>
                          {slot.label} — {formatTimeRange(start, end)}
                        </option>
                      );
                    })}
                    <option value="custom">Plage personnalisée</option>
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="time"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-400"
                      value={form.session_start_time}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          session_period_id: "",
                          session_period_label: "Plage personnalisée",
                          session_start_time: e.target.value,
                        }))
                      }
                    />
                    <input
                      type="time"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-emerald-400"
                      value={form.session_end_time}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          session_period_id: "",
                          session_period_label: "Plage personnalisée",
                          session_end_time: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="text-xs font-bold text-slate-500">
                    Durée calculée : {minutesBetween(form.session_start_time, form.session_end_time) || 55} min
                  </div>
                </div>

                <textarea
                  className="min-h-32 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-400 md:col-span-2"
                  value={form.content}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      content: e.target.value,
                    }))
                  }
                  placeholder="Contenu réalisé en classe"
                />
                <textarea
                  className="min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-400"
                  value={form.homework}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      homework: e.target.value,
                    }))
                  }
                  placeholder="Travail à faire"
                />
                <textarea
                  className="min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-400"
                  value={form.observations}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      observations: e.target.value,
                    }))
                  }
                  placeholder="Observations"
                />
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <button
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Enregistrer la séance
                </button>

                <button
                  type="button"
                  onClick={markCompleted}
                  disabled={busy || selectedItem.completion?.status === "completed"}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" /> Marquer la leçon terminée
                </button>
              </div>

              {selectedItem.sessions?.length ? (
                <div className="mt-5 rounded-2xl border border-slate-200 p-3">
                  <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
                    Historique récent
                  </div>
                  <div className="space-y-2">
                    {selectedItem.sessions.slice(0, 4).map((s) => (
                      <div
                        key={s.id}
                        className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600"
                      >
                        <div className="flex items-center gap-2">
                          <Clock3 className="h-3.5 w-3.5" /> {formatDate(s.session_date)} · {formatTimeRange(s.session_start_time, s.session_end_time) || `${s.duration_minutes} min`} · {s.session_title}
                        </div>
                        {s.content ? (
                          <div className="mt-1 font-medium text-slate-500">
                            {s.content}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </form>
          </section>
        ) : (
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-bold text-slate-600">
              Sélectionnez une progression pour continuer.
            </p>
            <button
              type="button"
              onClick={backToList}
              className="mt-4 inline-flex items-center justify-center rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white"
            >
              Voir mes progressions
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
