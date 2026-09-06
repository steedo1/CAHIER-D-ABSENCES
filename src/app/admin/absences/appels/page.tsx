"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Loader2, RefreshCw } from "lucide-react";
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
  class_id?: string | null;
  teacher_name: string;
  subject_name?: string | null;
  started_at?: string | null;
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
  lost_minutes: number;
};

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function findSession(row: MonitorRow, sessions: DailySession[]) {
  const teacher = normalizeText(row.teacher_name);
  const classId = String(row.class_id || "");
  const subject = normalizeText(row.subject_name);
  const plannedStart = hmToMinutes(row.planned_start);

  const candidates = sessions.filter((session) => {
    if (normalizeText(session.teacher_name) !== teacher) return false;
    if (classId && String(session.class_id || "") !== classId) return false;
    return true;
  });

  if (!candidates.length) return null;

  const sameSubject = candidates.filter(
    (session) => subject && normalizeText(session.subject_name) === subject,
  );
  const pool = sameSubject.length ? sameSubject : candidates;

  if (plannedStart === null) return pool[0] || null;

  return (
    [...pool].sort((a, b) => {
      const aStart = hmToMinutes(isoToHm(a.started_at)) ?? Number.MAX_SAFE_INTEGER;
      const bStart = hmToMinutes(isoToHm(b.started_at)) ?? Number.MAX_SAFE_INTEGER;
      return Math.abs(aStart - plannedStart) - Math.abs(bStart - plannedStart);
    })[0] || null
  );
}

function detailLabel(row: DetailedRow) {
  const planned =
    row.planned_start && row.planned_end
      ? `${row.planned_start}–${row.planned_end}`
      : row.period_label || "—";

  if (isAbsenceStatus(row.status)) {
    const suffix =
      row.status === "justified_absence"
        ? "Absence justifiée"
        : row.status === "pending_absence"
          ? "Absence en attente"
          : "Absent";
    return { planned, actual: null, suffix };
  }

  const actual = row.actual_start
    ? `${row.actual_start}–${row.actual_end || "…"}`
    : null;

  const pieces: string[] = [];
  if (row.status === "late" && Number(row.late_minutes || 0) > 0) {
    pieces.push(`+${row.late_minutes} min`);
  }
  if (row.early_departure_minutes > 0) {
    pieces.push(`${row.early_departure_minutes} min avant la fin`);
  }
  if (!pieces.length && row.status !== "not_started") pieces.push("À l'heure");

  return { planned, actual, suffix: pieces.join(" · ") };
}

export default function SurveillanceAppelsPage() {
  const date = useMemo(() => todayYmd(), []);
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const [sessions, setSessions] = useState<DailySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const [monitorResult, sessionResponse] = await Promise.all([
        fetchAdminAttendanceMonitor<MonitorRow>(
          date,
          date,
          controller.signal,
          undefined,
          { includeExpectedStatuses: true },
        ),
        fetch(`/api/admin/attendance/daily-sessions?date=${encodeURIComponent(date)}`, {
          cache: "no-store",
          signal: controller.signal,
        }),
      ]);

      const sessionPayload = sessionResponse.ok
        ? await sessionResponse.json().catch(() => ({}))
        : {};

      setRows(Array.isArray(monitorResult.data?.rows) ? monitorResult.data.rows : []);
      setSessions(Array.isArray(sessionPayload?.rows) ? sessionPayload.rows : []);
    } catch (cause: any) {
      if (cause?.name === "AbortError") return;
      setError(cause?.message || "Impossible de charger le contrôle des appels.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const detailedRows = useMemo<DetailedRow[]>(() => {
    return rows.map((row) => {
      const session = findSession(row, sessions);
      const actualStart = isoToHm(session?.started_at);
      const actualEnd = isoToHm(session?.ended_at);
      const plannedEnd = hmToMinutes(row.planned_end);
      const endedMin = hmToMinutes(actualEnd);
      const earlyDeparture =
        plannedEnd !== null && endedMin !== null && endedMin < plannedEnd
          ? plannedEnd - endedMin
          : 0;

      return {
        ...row,
        actual_start: actualStart,
        actual_end: actualEnd,
        early_departure_minutes: earlyDeparture,
      };
    });
  }, [rows, sessions]);

  const teacherCount = useMemo(
    () => new Set(rows.map((row) => normalizeText(row.teacher_name)).filter(Boolean)).size,
    [rows],
  );

  const teachers = useMemo<TeacherControlRow[]>(() => {
    const grouped = new Map<string, DetailedRow[]>();
    for (const row of detailedRows) {
      const key = normalizeText(row.teacher_name);
      if (!key) continue;
      const current = grouped.get(key) || [];
      current.push(row);
      grouped.set(key, current);
    }

    return Array.from(grouped.entries())
      .map(([key, teacherRows]) => {
        const lateRows = teacherRows.filter((row) => row.status === "late");
        const absenceRows = teacherRows.filter((row) => isAbsenceStatus(row.status));
        const earlyRows = teacherRows.filter((row) => row.early_departure_minutes > 0);
        const lostMinutes =
          lateRows.reduce((sum, row) => sum + Math.max(0, Number(row.late_minutes || 0)), 0) +
          absenceRows.reduce((sum, row) => sum + plannedDuration(row), 0) +
          earlyRows.reduce((sum, row) => sum + row.early_departure_minutes, 0);

        return {
          key,
          teacher_name: teacherRows[0]?.teacher_name || "Enseignant",
          disciplines: Array.from(
            new Set(
              teacherRows
                .map((row) => String(row.subject_name || "").trim())
                .filter(Boolean),
            ),
          ),
          rows: [...teacherRows].sort((a, b) =>
            String(a.planned_start || "").localeCompare(String(b.planned_start || "")),
          ),
          late_count: lateRows.length,
          absence_count: absenceRows.length,
          early_departure_count: earlyRows.length,
          lost_minutes: lostMinutes,
        };
      })
      .filter(
        (teacher) =>
          teacher.late_count > 0 ||
          teacher.absence_count > 0 ||
          teacher.early_departure_count > 0,
      )
      .sort((a, b) => {
        if (b.absence_count !== a.absence_count) return b.absence_count - a.absence_count;
        if (b.lost_minutes !== a.lost_minutes) return b.lost_minutes - a.lost_minutes;
        return a.teacher_name.localeCompare(b.teacher_name, "fr", { sensitivity: "base" });
      });
  }, [detailedRows]);

  const totalLate = teachers.reduce((sum, teacher) => sum + teacher.late_count, 0);
  const totalAbsences = teachers.reduce((sum, teacher) => sum + teacher.absence_count, 0);
  const totalEarly = teachers.reduce(
    (sum, teacher) => sum + teacher.early_departure_count,
    0,
  );

  function situation(teacher: TeacherControlRow) {
    const parts: string[] = [];
    if (teacher.late_count) parts.push(plural(teacher.late_count, "retard"));
    if (teacher.absence_count) parts.push(plural(teacher.absence_count, "absence"));
    if (teacher.early_departure_count) {
      parts.push(plural(teacher.early_departure_count, "départ anticipé", "départs anticipés"));
    }
    return parts.join(" · ");
  }

  function toggleTeacher(key: string) {
    setExpandedTeacher((current) => (current === key ? null : key));
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-4 sm:px-5 md:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
              Surveillance des appels
            </h1>
            <p className="mt-3 text-base font-semibold text-slate-900 sm:text-lg">
              Aujourd’hui — {teacherCount} enseignant{teacherCount > 1 ? "s" : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <span className="rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-900">
                {plural(totalLate, "retard")}
              </span>
              <span className="rounded-md bg-red-50 px-2 py-1 font-medium text-red-800">
                {plural(totalAbsences, "absence")}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
                {plural(totalEarly, "départ anticipé", "départs anticipés")}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
            aria-label="Actualiser"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Actualiser</span>
          </button>
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
              <h2 className="text-lg font-bold text-slate-950">À surveiller — {teachers.length}</h2>
            </div>

            {teachers.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-600">
                Aucune anomalie détectée aujourd’hui.
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
                      {teachers.map((teacher) => {
                        const expanded = expandedTeacher === teacher.key;
                        return (
                          <FragmentRow
                            key={teacher.key}
                            teacher={teacher}
                            expanded={expanded}
                            onToggle={() => toggleTeacher(teacher.key)}
                            situation={situation(teacher)}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2 md:hidden">
                  {teachers.map((teacher) => {
                    const expanded = expandedTeacher === teacher.key;
                    return (
                      <div key={teacher.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <button
                          type="button"
                          onClick={() => toggleTeacher(teacher.key)}
                          className="w-full px-3 py-3 text-left"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-bold text-slate-950">{teacher.teacher_name}</div>
                              <div className="mt-0.5 truncate text-sm text-slate-600">
                                {teacher.disciplines.join(" · ") || "—"}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 font-bold text-slate-900">
                              {formatMinutes(teacher.lost_minutes)}
                              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </div>
                          </div>
                          <div className="mt-2 text-sm font-medium text-slate-700">{situation(teacher)}</div>
                        </button>
                        {expanded ? <TeacherDetails rows={teacher.rows} /> : null}
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
  );
}

function FragmentRow({
  teacher,
  expanded,
  onToggle,
  situation,
}: {
  teacher: TeacherControlRow;
  expanded: boolean;
  onToggle: () => void;
  situation: string;
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
            {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </span>
        </td>
        <td className="px-4 py-3 text-slate-700">{teacher.disciplines.join(" · ") || "—"}</td>
        <td className="px-4 py-3 text-slate-700">{situation}</td>
        <td className="px-4 py-3 text-right font-bold text-slate-950">{formatMinutes(teacher.lost_minutes)}</td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={4} className="bg-slate-50/80 px-4 py-0">
            <TeacherDetails rows={teacher.rows} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TeacherDetails({ rows }: { rows: DetailedRow[] }) {
  return (
    <div className="border-t border-slate-100 px-3 py-3 md:border-0 md:px-2 md:py-3">
      <div className="space-y-2">
        {rows.map((row) => {
          const detail = detailLabel(row);
          return (
            <div key={row.id} className="text-sm leading-6 text-slate-700">
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
