"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Printer,
  RefreshCw,
} from "lucide-react";
import {
  adminAttendancePollDelay,
  type AdminAttendanceDataSource,
} from "@/lib/admin-attendance-monitor";
import { fetchAdminAttendanceMonitor } from "@/lib/local-relay";

type MonitorStatus =
  | "not_started"
  | "started"
  | "missing"
  | "late"
  | "ok"
  | "pending_absence"
  | "justified_absence";

type MonitorRow = {
  id: string;
  date: string;
  planned_start?: string | null;
  planned_end?: string | null;
  period_label?: string | null;
  class_id?: string | null;
  class_label?: string | null;
  subject_name?: string | null;
  teacher_name: string;
  status: MonitorStatus;
  late_minutes?: number | null;
};

type DailySession = {
  id: string;
  session_date?: string | null;
  class_id?: string | null;
  teacher_name: string;
  subject_name?: string | null;
  started_at?: string | null;
  actual_call_at?: string | null;
  ended_at?: string | null;
};

type DetailedRow = MonitorRow & {
  actual_start: string | null;
  actual_end: string | null;
  early_departure_minutes: number;
};

type TeacherControlRow = {
  key: string;
  teacher_name: string;
  disciplines: string[];
  rows: DetailedRow[];
  late_count: number;
  absence_count: number;
  early_departure_count: number;
  late_minutes: number;
  early_departure_minutes: number;
  expected_sessions: number;
  actual_sessions: number;
  expected_minutes: number;
  effective_minutes: number;
  lost_minutes: number;
};

type ReportContext = {
  institution_name: string;
  logo_url: string | null;
  head_name: string | null;
  head_title: string | null;
};

type PeriodPreset = "today" | "week" | "month" | "custom";
type LoadOptions = { background?: boolean };

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayYmd() {
  return ymd(new Date());
}

function daysAgoYmd(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return ymd(date);
}

function formatDateFr(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatGeneratedAt() {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Abidjan",
  }).format(new Date());
}

function normalizeText(value?: string | null) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hmToMinutes(value?: string | null) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isoToHm(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function plannedIso(row: MonitorRow, field: "planned_start" | "planned_end") {
  const raw = String(row[field] || "").match(/^(\d{1,2}):(\d{2})/);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  const hh = raw[1].padStart(2, "0");
  const mm = raw[2];
  const ms = Date.parse(`${row.date}T${hh}:${mm}:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function plannedDuration(row: MonitorRow) {
  const start = hmToMinutes(row.planned_start);
  const end = hmToMinutes(row.planned_end);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

function isAbsenceStatus(status: MonitorStatus) {
  return status === "missing" || status === "pending_absence" || status === "justified_absence";
}

function formatMinutes(total: number) {
  const minutes = Math.max(0, Math.round(total));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

function plural(count: number, singular: string, pluralForm?: string) {
  return `${count} ${count > 1 ? pluralForm || `${singular}s` : singular}`;
}

function sameSessionScope(row: MonitorRow, session: DailySession) {
  if (session.session_date && session.session_date !== row.date) return false;
  if (normalizeText(session.teacher_name) !== normalizeText(row.teacher_name)) return false;
  if (row.class_id && String(session.class_id || "") !== String(row.class_id)) return false;
  const rowSubject = normalizeText(row.subject_name);
  const sessionSubject = normalizeText(session.subject_name);
  if (rowSubject && sessionSubject && rowSubject !== sessionSubject) return false;
  return true;
}

function matchSessions(rows: MonitorRow[], sessions: DailySession[]) {
  const matches = new Map<string, DailySession>();
  const used = new Set<string>();

  const orderedRows = [...rows].sort((a, b) =>
    `${a.date} ${a.planned_start || ""}`.localeCompare(`${b.date} ${b.planned_start || ""}`),
  );

  for (const row of orderedRows) {
    if (isAbsenceStatus(row.status)) continue;
    const plannedStart = hmToMinutes(row.planned_start);
    if (plannedStart === null) continue;

    const candidates = sessions
      .filter((session) => !used.has(session.id) && sameSessionScope(row, session))
      .map((session) => {
        // started_at reste l'ancre canonique du créneau pour faire la correspondance.
        // actual_call_at est utilisé ensuite comme fait réel de présence.
        const canonicalStart = hmToMinutes(isoToHm(session.started_at));
        return {
          session,
          distance:
            canonicalStart === null
              ? Number.MAX_SAFE_INTEGER
              : Math.abs(canonicalStart - plannedStart),
        };
      })
      .filter((candidate) => candidate.distance <= 90)
      .sort((a, b) => a.distance - b.distance);

    const selected = candidates[0]?.session;
    if (!selected) continue;
    matches.set(`${row.date}:${row.id}`, selected);
    used.add(selected.id);
  }

  return matches;
}

function rawLateMinutes(row: MonitorRow, session: DailySession | null) {
  if (!session?.actual_call_at) return Math.max(0, Number(row.late_minutes || 0));
  const planned = plannedIso(row, "planned_start");
  const actual = Date.parse(session.actual_call_at);
  if (planned === null || !Number.isFinite(actual) || actual <= planned) return 0;
  // Surveillance = fait brut : tout dépassement positif est visible dès la première minute.
  return Math.ceil((actual - planned) / 60_000);
}

function rawEarlyDepartureMinutes(row: MonitorRow, session: DailySession | null) {
  if (!session?.ended_at) return 0;
  const plannedEnd = plannedIso(row, "planned_end");
  const actualEnd = Date.parse(session.ended_at);
  if (plannedEnd === null || !Number.isFinite(actualEnd) || actualEnd >= plannedEnd) return 0;
  return Math.ceil((plannedEnd - actualEnd) / 60_000);
}

function effectiveDuration(row: DetailedRow) {
  if (isAbsenceStatus(row.status) || !row.actual_start || !row.actual_end) return 0;
  const planned = plannedDuration(row);
  if (!planned) return 0;
  const start = hmToMinutes(row.actual_start);
  const end = hmToMinutes(row.actual_end);
  if (start === null || end === null || end <= start) return 0;
  const observed = end - start;
  const afterLate = Math.max(0, planned - Math.max(0, Number(row.late_minutes || 0)));
  return Math.min(afterLate, observed);
}

function detailLabel(row: DetailedRow) {
  const planned = row.planned_start && row.planned_end
    ? `${row.planned_start}–${row.planned_end}`
    : row.period_label || "—";

  if (isAbsenceStatus(row.status)) {
    const suffix = row.status === "justified_absence"
      ? "Absence justifiée"
      : row.status === "pending_absence"
        ? "Absence en attente"
        : "Absent";
    return { planned, actual: null, suffix };
  }

  const actual = row.actual_start ? `${row.actual_start}–${row.actual_end || "…"}` : null;
  const pieces: string[] = [];
  if (row.status === "late" && Number(row.late_minutes || 0) > 0) {
    pieces.push(`+${row.late_minutes} min`);
  }
  if (row.early_departure_minutes > 0) {
    pieces.push(`${row.early_departure_minutes} min avant la fin`);
  }
  if (!pieces.length && row.status === "ok") pieces.push("À l'heure");
  if (!pieces.length && row.status === "started") pieces.push("Cours démarré");
  return { planned, actual, suffix: pieces.join(" · ") };
}

function buildTeacherRows(detailedRows: DetailedRow[]) {
  const grouped = new Map<string, DetailedRow[]>();
  for (const row of detailedRows) {
    const key = normalizeText(row.teacher_name);
    if (!key) continue;
    const current = grouped.get(key) || [];
    current.push(row);
    grouped.set(key, current);
  }

  return Array.from(grouped.entries()).map(([key, teacherRows]) => {
    const sortedRows = [...teacherRows].sort((a, b) =>
      `${a.date} ${a.planned_start || ""}`.localeCompare(`${b.date} ${b.planned_start || ""}`),
    );
    const lateRows = sortedRows.filter((row) => row.status === "late");
    const absenceRows = sortedRows.filter((row) => isAbsenceStatus(row.status));
    const earlyRows = sortedRows.filter((row) => row.early_departure_minutes > 0);
    const lateMinutes = lateRows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.late_minutes || 0)),
      0,
    );
    const earlyMinutes = earlyRows.reduce(
      (sum, row) => sum + row.early_departure_minutes,
      0,
    );
    const absenceMinutes = absenceRows.reduce(
      (sum, row) => sum + plannedDuration(row),
      0,
    );

    return {
      key,
      teacher_name: sortedRows[0]?.teacher_name || "Enseignant",
      disciplines: Array.from(
        new Set(
          sortedRows
            .map((row) => String(row.subject_name || "").trim())
            .filter(Boolean),
        ),
      ),
      rows: sortedRows,
      late_count: lateRows.length,
      absence_count: absenceRows.length,
      early_departure_count: earlyRows.length,
      late_minutes: lateMinutes,
      early_departure_minutes: earlyMinutes,
      expected_sessions: sortedRows.length,
      actual_sessions: sortedRows.filter((row) => Boolean(row.actual_start)).length,
      expected_minutes: sortedRows.reduce((sum, row) => sum + plannedDuration(row), 0),
      effective_minutes: sortedRows.reduce((sum, row) => sum + effectiveDuration(row), 0),
      lost_minutes: lateMinutes + earlyMinutes + absenceMinutes,
    } satisfies TeacherControlRow;
  });
}

export default function SurveillanceAppelsPage() {
  const today = useMemo(() => todayYmd(), []);
  const [preset, setPreset] = useState<PeriodPreset>("today");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [sessions, setSessions] = useState<DailySession[]>([]);
  const [reportContext, setReportContext] = useState<ReportContext>({
    institution_name: "Établissement",
    logo_url: null,
    head_name: null,
    head_title: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const refreshInFlightRef = useRef(false);
  const dataSourceRef = useRef<AdminAttendanceDataSource | null>(null);
  const refreshErrorRef = useRef(false);

  const choosePreset = useCallback((next: PeriodPreset) => {
    setPreset(next);
    if (next === "today") {
      setStartDate(today);
      setEndDate(today);
    } else if (next === "week") {
      setStartDate(daysAgoYmd(6));
      setEndDate(today);
    } else if (next === "month") {
      setStartDate(daysAgoYmd(29));
      setEndDate(today);
    }
  }, [today]);

  const load = useCallback(async (options: LoadOptions = {}) => {
    const background = options.background === true;
    if (!startDate || !endDate || startDate > endDate) {
      setError("La période sélectionnée est invalide.");
      return;
    }
    if (background && refreshInFlightRef.current) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    refreshInFlightRef.current = true;
    if (!background) {
      setLoading(true);
      setError(null);
    }

    try {
      const monitorResult = await fetchAdminAttendanceMonitor<MonitorRow>(
        startDate,
        endDate,
        controller.signal,
        undefined,
        { includeExpectedStatuses: true },
      );
      const monitorRows = Array.isArray(monitorResult.data?.rows)
        ? monitorResult.data.rows
        : [];

      const [sessionResponse, contextResponse] = await Promise.all([
        fetch(
          `/api/admin/attendance/daily-sessions?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`,
          { cache: "no-store", signal: controller.signal },
        ),
        fetch("/api/admin/attendance/report-context", {
          cache: "no-store",
          signal: controller.signal,
        }).catch(() => null),
      ]);

      const sessionPayload = sessionResponse.ok
        ? await sessionResponse.json().catch(() => ({}))
        : {};
      const sessionRows: DailySession[] = Array.isArray(sessionPayload?.rows)
        ? sessionPayload.rows
        : [];

      if (contextResponse?.ok) {
        const payload = await contextResponse.json().catch(() => null);
        if (payload?.institution_name) {
          setReportContext({
            institution_name: String(payload.institution_name),
            logo_url: payload.logo_url ? String(payload.logo_url) : null,
            head_name: payload.head_name ? String(payload.head_name) : null,
            head_title: payload.head_title ? String(payload.head_title) : null,
          });
        }
      }

      dataSourceRef.current = monitorResult.source;
      refreshErrorRef.current = false;
      setError(null);
      setRows(monitorRows);
      setSessions(sessionRows);
      if (!background) setExpandedTeacher(null);
    } catch (cause: any) {
      if (cause?.name === "AbortError") return;
      refreshErrorRef.current = true;
      if (!background) {
        setError(cause?.message || "Impossible de charger le contrôle des appels.");
      }
    } finally {
      if (abortRef.current === controller) {
        refreshInFlightRef.current = false;
        if (!background && !controller.signal.aborted) setLoading(false);
      }
    }
  }, [startDate, endDate]);

  useEffect(() => {
    let stopped = false;
    let pollTimer: number | null = null;
    const liveToday = startDate === today && endDate === today;

    const scheduleNext = () => {
      if (stopped || !liveToday) return;
      const delay = adminAttendancePollDelay(
        dataSourceRef.current,
        refreshErrorRef.current,
      );
      pollTimer = window.setTimeout(async () => {
        if (document.visibilityState === "visible" && navigator.onLine) {
          await load({ background: true });
        }
        scheduleNext();
      }, delay);
    };

    const refreshNow = () => {
      if (!liveToday) return;
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      void load({ background: true });
    };

    void load().finally(() => {
      if (liveToday) scheduleNext();
    });
    if (liveToday) {
      window.addEventListener("focus", refreshNow);
      window.addEventListener("online", refreshNow);
      document.addEventListener("visibilitychange", refreshNow);
    }

    return () => {
      stopped = true;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener("online", refreshNow);
      document.removeEventListener("visibilitychange", refreshNow);
      abortRef.current?.abort();
    };
  }, [endDate, load, startDate, today]);

  const detailedRows = useMemo<DetailedRow[]>(() => {
    const matches = matchSessions(rows, sessions);

    return rows.map((row) => {
      const session = matches.get(`${row.date}:${row.id}`) || null;
      const actualStart = isoToHm(session?.actual_call_at);
      const actualEnd = isoToHm(session?.ended_at);
      const measuredLate = rawLateMinutes(row, session);
      const hasTrustedRealStart = Boolean(session?.actual_call_at);

      let effectiveStatus = row.status;
      let effectiveLateMinutes = row.status === "late"
        ? Math.max(0, Number(row.late_minutes || 0))
        : 0;

      if (!isAbsenceStatus(row.status) && hasTrustedRealStart) {
        effectiveStatus = measuredLate > 0 ? "late" : "ok";
        effectiveLateMinutes = measuredLate;
      }

      return {
        ...row,
        status: effectiveStatus,
        late_minutes: effectiveLateMinutes,
        actual_start: actualStart,
        actual_end: actualEnd,
        early_departure_minutes: rawEarlyDepartureMinutes(row, session),
      };
    });
  }, [rows, sessions]);

  const allTeachers = useMemo(
    () => buildTeacherRows(detailedRows).sort((a, b) =>
      a.teacher_name.localeCompare(b.teacher_name, "fr", { sensitivity: "base" }),
    ),
    [detailedRows],
  );

  const teachers = useMemo(
    () => allTeachers
      .filter((teacher) =>
        teacher.late_count > 0 ||
        teacher.absence_count > 0 ||
        teacher.early_departure_count > 0,
      )
      .sort((a, b) => {
        if (b.absence_count !== a.absence_count) {
          return b.absence_count - a.absence_count;
        }
        if (b.lost_minutes !== a.lost_minutes) {
          return b.lost_minutes - a.lost_minutes;
        }
        return a.teacher_name.localeCompare(b.teacher_name, "fr", {
          sensitivity: "base",
        });
      }),
    [allTeachers],
  );

  const teacherCount = allTeachers.length;
  const totalLate = allTeachers.reduce((sum, teacher) => sum + teacher.late_count, 0);
  const totalLateMinutes = allTeachers.reduce((sum, teacher) => sum + teacher.late_minutes, 0);
  const totalAbsences = allTeachers.reduce((sum, teacher) => sum + teacher.absence_count, 0);
  const totalEarly = allTeachers.reduce(
    (sum, teacher) => sum + teacher.early_departure_count,
    0,
  );
  const totalEarlyMinutes = allTeachers.reduce(
    (sum, teacher) => sum + teacher.early_departure_minutes,
    0,
  );
  const totalExpected = allTeachers.reduce((sum, teacher) => sum + teacher.expected_sessions, 0);
  const totalActual = allTeachers.reduce((sum, teacher) => sum + teacher.actual_sessions, 0);
  const isToday = startDate === today && endDate === today;
  const periodLabel = isToday
    ? "Aujourd’hui"
    : `${formatDateFr(startDate)} → ${formatDateFr(endDate)}`;

  function situation(teacher: TeacherControlRow) {
    const parts: string[] = [];
    if (teacher.late_count) {
      parts.push(`${plural(teacher.late_count, "retard")} · ${formatMinutes(teacher.late_minutes)}`);
    }
    if (teacher.absence_count) parts.push(plural(teacher.absence_count, "absence"));
    if (teacher.early_departure_count) {
      parts.push(
        `${plural(teacher.early_departure_count, "départ anticipé", "départs anticipés")} · ${formatMinutes(teacher.early_departure_minutes)}`,
      );
    }
    return parts.join(" · ");
  }

  function toggleTeacher(key: string) {
    setExpandedTeacher((current) => current === key ? null : key);
  }

  return (
    <>
      <style>{`
        .surveillance-print-root { display: none; }
        @media print {
          @page { size: A4 landscape; margin: 9mm; }
          body * { visibility: hidden !important; }
          .surveillance-print-root, .surveillance-print-root * { visibility: visible !important; }
          .surveillance-print-root {
            display: block !important;
            position: absolute;
            inset: 0;
            width: 100%;
            background: white;
            color: #0f172a;
            font-family: Arial, Helvetica, sans-serif;
          }
          .surveillance-screen-root { display: none !important; }
          .surveillance-print-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          .surveillance-print-table th, .surveillance-print-table td {
            border: 1px solid #cbd5e1;
            padding: 5px 6px;
            font-size: 9px;
            vertical-align: middle;
          }
          .surveillance-print-table th { background: #f1f5f9; font-weight: 700; }
          .surveillance-print-table tr { break-inside: avoid; }
        }
      `}</style>

      <main className="surveillance-screen-root min-h-screen bg-slate-50 px-3 py-4 sm:px-5 md:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
                Surveillance des appels
              </h1>
              <p className="mt-3 text-base font-semibold text-slate-900 sm:text-lg">
                {periodLabel} — {teacherCount} enseignant{teacherCount > 1 ? "s" : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                <span className="rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-900">
                  {plural(totalLate, "retard")} · {formatMinutes(totalLateMinutes)}
                </span>
                <span className="rounded-md bg-red-50 px-2 py-1 font-medium text-red-800">
                  {plural(totalAbsences, "absence")}
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
                  {plural(totalEarly, "départ anticipé", "départs anticipés")} · {formatMinutes(totalEarlyMinutes)}
                </span>
              </div>
              <p className="mt-2 text-xs font-medium text-slate-500">
                Données factuelles brutes : aucune tolérance de paie n’est appliquée ici.
              </p>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                disabled={loading || rows.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                <span className="hidden sm:inline">Imprimer / PDF</span>
                <span className="sm:hidden">PDF</span>
              </button>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                aria-label="Actualiser"
              >
                {loading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />}
                <span className="hidden sm:inline">Actualiser</span>
              </button>
            </div>
          </div>

          <div className="mb-5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap gap-2">
              {([
                ["today", "Aujourd’hui"],
                ["week", "7 jours"],
                ["month", "30 jours"],
                ["custom", "Période"],
              ] as [PeriodPreset, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => choosePreset(value)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    preset === value
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {preset === "custom" ? (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="text-xs font-semibold text-slate-600">
                  Du
                  <input
                    type="date"
                    value={startDate}
                    max={endDate || today}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Au
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    max={today}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </label>
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : loading && rows.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Chargement…
            </div>
          ) : (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <h2 className="text-lg font-bold text-slate-950">
                  À surveiller — {teachers.length}
                </h2>
              </div>

              {teachers.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-600">
                  Aucune anomalie détectée sur cette période.
                </div>
              ) : (
                <>
                  <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
                    <table className="w-full table-fixed text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-700">
                        <tr>
                          <th className="w-[24%] px-4 py-3 font-semibold">Enseignant</th>
                          <th className="w-[22%] px-4 py-3 font-semibold">Discipline</th>
                          <th className="w-[38%] px-4 py-3 font-semibold">Situation</th>
                          <th className="w-[16%] px-4 py-3 text-right font-semibold">Temps perdu</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {teachers.map((teacher) => (
                          <FragmentRow
                            key={teacher.key}
                            teacher={teacher}
                            expanded={expandedTeacher === teacher.key}
                            onToggle={() => toggleTeacher(teacher.key)}
                            situation={situation(teacher)}
                            showDate={!isToday}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-2 md:hidden">
                    {teachers.map((teacher) => {
                      const expanded = expandedTeacher === teacher.key;
                      return (
                        <div
                          key={teacher.key}
                          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                        >
                          <button
                            type="button"
                            onClick={() => toggleTeacher(teacher.key)}
                            className="w-full px-3 py-3 text-left"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-bold text-slate-950">
                                  {teacher.teacher_name}
                                </div>
                                <div className="mt-0.5 truncate text-sm text-slate-600">
                                  {teacher.disciplines.join(" · ") || "—"}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2 font-bold text-slate-900">
                                {formatMinutes(teacher.lost_minutes)}
                                {expanded
                                  ? <ChevronUp className="h-4 w-4" />
                                  : <ChevronDown className="h-4 w-4" />}
                              </div>
                            </div>
                            <div className="mt-2 text-sm font-medium text-slate-700">
                              {situation(teacher)}
                            </div>
                          </button>
                          {expanded
                            ? <TeacherDetails rows={teacher.rows} showDate={!isToday} />
                            : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </main>

      <section className="surveillance-print-root">
        <div style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #0f172a", paddingBottom: 8, marginBottom: 10 }}>
          {reportContext.logo_url ? (
            <img
              src={reportContext.logo_url}
              alt="Logo établissement"
              style={{ width: 54, height: 54, objectFit: "contain" }}
            />
          ) : null}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{reportContext.institution_name}</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              RAPPORT DE SURVEILLANCE DES APPELS ENSEIGNANTS
            </div>
            <div style={{ fontSize: 9, marginTop: 3, color: "#475569" }}>
              Période : {formatDateFr(startDate)} au {formatDateFr(endDate)} · Généré le {formatGeneratedAt()}
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 9, lineHeight: 1.45 }}>
            <strong>Mon Cahier</strong><br />
            Données factuelles brutes<br />
            Aucune tolérance de paie
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginBottom: 10 }}>
          {[
            ["Enseignants", teacherCount],
            ["Cours prévus", totalExpected],
            ["Cours assurés", totalActual],
            ["Absences", totalAbsences],
            ["Retards", `${totalLate} / ${formatMinutes(totalLateMinutes)}`],
            ["Sorties anticipées", `${totalEarly} / ${formatMinutes(totalEarlyMinutes)}`],
          ].map(([label, value]) => (
            <div key={String(label)} style={{ border: "1px solid #cbd5e1", borderRadius: 5, padding: "6px 7px" }}>
              <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase" }}>{label}</div>
              <div style={{ fontSize: 12, fontWeight: 800, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>

        <table className="surveillance-print-table">
          <thead>
            <tr>
              <th style={{ width: "20%", textAlign: "left" }}>Enseignant</th>
              <th style={{ width: "9%" }}>Cours prévus</th>
              <th style={{ width: "9%" }}>Cours assurés</th>
              <th style={{ width: "9%" }}>Absences</th>
              <th style={{ width: "13%" }}>Retards</th>
              <th style={{ width: "13%" }}>Sorties anticipées</th>
              <th style={{ width: "13%" }}>Durée prévue</th>
              <th style={{ width: "14%" }}>Durée effective</th>
            </tr>
          </thead>
          <tbody>
            {allTeachers.map((teacher) => (
              <tr key={`print-${teacher.key}`}>
                <td style={{ fontWeight: 700 }}>{teacher.teacher_name}</td>
                <td style={{ textAlign: "center" }}>{teacher.expected_sessions}</td>
                <td style={{ textAlign: "center" }}>{teacher.actual_sessions}</td>
                <td style={{ textAlign: "center" }}>{teacher.absence_count}</td>
                <td style={{ textAlign: "center" }}>
                  {teacher.late_count ? `${teacher.late_count} (${formatMinutes(teacher.late_minutes)})` : "0"}
                </td>
                <td style={{ textAlign: "center" }}>
                  {teacher.early_departure_count
                    ? `${teacher.early_departure_count} (${formatMinutes(teacher.early_departure_minutes)})`
                    : "0"}
                </td>
                <td style={{ textAlign: "center" }}>{formatMinutes(teacher.expected_minutes)}</td>
                <td style={{ textAlign: "center", fontWeight: 700 }}>{formatMinutes(teacher.effective_minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginTop: 10, fontSize: 8, color: "#475569" }}>
          <div style={{ maxWidth: "70%" }}>
            <strong>Règle de lecture :</strong> les retards et sorties anticipées correspondent aux heures réellement enregistrées par le cahier d’appel. Aucune franchise ni tolérance utilisée pour la paie n’est appliquée à ce rapport.
          </div>
          <div style={{ textAlign: "right" }}>
            {reportContext.head_title || "Administration"}
            {reportContext.head_name ? <><br /><strong>{reportContext.head_name}</strong></> : null}
          </div>
        </div>
      </section>
    </>
  );
}

function FragmentRow({
  teacher,
  expanded,
  onToggle,
  situation,
  showDate,
}: {
  teacher: TeacherControlRow;
  expanded: boolean;
  onToggle: () => void;
  situation: string;
  showDate: boolean;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer transition hover:bg-slate-50"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <td className="px-4 py-3 font-bold text-slate-950">
          <span className="inline-flex items-center gap-2">
            {teacher.teacher_name}
            {expanded
              ? <ChevronUp className="h-4 w-4 text-slate-400" />
              : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </span>
        </td>
        <td className="px-4 py-3 text-slate-700">
          {teacher.disciplines.join(" · ") || "—"}
        </td>
        <td className="px-4 py-3 text-slate-700">{situation}</td>
        <td className="px-4 py-3 text-right font-bold text-slate-950">
          {formatMinutes(teacher.lost_minutes)}
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={4} className="bg-slate-50/80 px-4 py-0">
            <TeacherDetails rows={teacher.rows} showDate={showDate} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TeacherDetails({ rows, showDate }: { rows: DetailedRow[]; showDate: boolean }) {
  return (
    <div className="border-t border-slate-100 px-3 py-3 md:border-0 md:px-2 md:py-3">
      <div className="space-y-2">
        {rows.map((row) => {
          const detail = detailLabel(row);
          return (
            <div key={`${row.date}-${row.id}`} className="text-sm leading-6 text-slate-700">
              {showDate ? (
                <>
                  <span className="font-semibold text-slate-500">{formatDateFr(row.date)}</span>
                  <span className="text-slate-400"> · </span>
                </>
              ) : null}
              <span className="font-semibold text-slate-950">{row.class_label || "Classe"}</span>
              <span className="text-slate-400"> · </span>
              prévu {detail.planned}
              {detail.actual ? (
                <>
                  <span className="text-slate-400"> · </span>
                  réel {detail.actual}
                </>
              ) : null}
              {detail.suffix ? (
                <>
                  <span className="text-slate-400"> · </span>
                  <strong className={isAbsenceStatus(row.status) ? "text-red-700" : "text-slate-950"}>
                    {detail.suffix}
                  </strong>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
