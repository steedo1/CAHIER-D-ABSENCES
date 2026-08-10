"use client";

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Users,
  ShieldCheck,
  Hourglass,
  Loader2,
  CircleDashed,
} from "lucide-react";
import { fetchAdminAttendanceMonitor, type LocalDataSource } from "@/lib/local-relay";
import {
  adminAttendancePollDelay,
  adminAttendanceViewReducer,
  initialAdminAttendanceViewState,
} from "@/lib/admin-attendance-monitor";

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
  date: string; // "YYYY-MM-DD"
  weekday_label?: string | null;
  period_label?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  class_label?: string | null;
  subject_name?: string | null;
  teacher_name: string;
  teacher_phone?: string | null;
  status: MonitorStatus;
  late_minutes?: number | null;
  opened_from?: "teacher" | "class_device" | null;

  absence_request_status?: "pending" | "approved" | "rejected" | null;
  absence_reason_label?: string | null;
  absence_admin_comment?: string | null;
};

type Slot = {
  key: string;
  start: string; // HH:MM
  end: string; // HH:MM
  label: string;
};

type ClassCell = {
  class_label: string;
  status: MonitorStatus;
  subjects: string[];
  teachers: string[];
  teacher_contacts: { name: string; phone: string | null }[];
  absence_reason_label?: string | null;
  absence_admin_comment?: string | null;
};

function toLocalDateInputValue(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function timeFromRowPart(v?: string | null): string | null {
  if (!v) return null;
  const s = v.slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  return null;
}

function nowHHMM(d = new Date()): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function statusScore(s: MonitorStatus): number {
  if (s === "missing") return 6;
  if (s === "pending_absence") return 5;
  if (s === "late") return 4;
  if (s === "justified_absence") return 2;
  if (s === "not_started") return 1;
  return 0;
}

function statusHint(
  s: MonitorStatus,
  reason?: string | null,
  comment?: string | null
): string {
  if (s === "not_started") {
    return "Ce créneau n’a pas encore commencé.";
  }
  if (s === "started") {
    return "Appel commencé dans le délai prévu.";
  }
  if (s === "missing") {
    return "Délai dépassé : aucun appel commencé pour cette classe.";
  }
  if (s === "late") {
    return "Appel commencé après le délai prévu.";
  }
  if (s === "pending_absence") {
    return `Une justification d’absence enseignant est à examiner${
      reason ? ` (${reason})` : ""
    }.`;
  }
  if (s === "justified_absence") {
    return `Absence validée par l’administration${reason ? ` (${reason})` : ""}${
      comment ? ` — ${comment}` : ""
    }.`;
  }
  return "Appel commencé dans le délai prévu.";
}

function cellColorClasses(s: MonitorStatus): string {
  if (s === "not_started") {
    return "bg-slate-500 text-white border-slate-300 shadow-lg shadow-slate-300/40";
  }
  if (s === "missing") {
    return "bg-red-600 text-white border-red-400 shadow-lg shadow-red-300/40";
  }
  if (s === "late") {
    return "bg-amber-500 text-slate-900 border-amber-300 shadow-lg shadow-amber-300/40";
  }
  if (s === "pending_absence") {
    return "bg-yellow-400 text-slate-900 border-yellow-300 shadow-lg shadow-yellow-200/50";
  }
  if (s === "justified_absence") {
    return "bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-300/40";
  }
  return "bg-emerald-600 text-white border-emerald-400 shadow-lg shadow-emerald-300/40";
}

const LEVEL_ORDER: string[] = [
  "6e",
  "5e",
  "4e",
  "3e",
  "seconde",
  "première",
  "terminale",
];

function inferLevelFromClassLabel(label?: string | null): string | null {
  if (!label) return null;
  const s = label.toLowerCase().trim();

  if (s.startsWith("6e") || s.startsWith("6ème") || s.startsWith("6 eme")) return "6e";
  if (s.startsWith("5e") || s.startsWith("5ème") || s.startsWith("5 eme")) return "5e";
  if (s.startsWith("4e") || s.startsWith("4ème") || s.startsWith("4 eme")) return "4e";
  if (s.startsWith("3e") || s.startsWith("3ème") || s.startsWith("3 eme")) return "3e";

  if (s.startsWith("2nde") || s.startsWith("2de") || s.startsWith("2nd")) return "seconde";
  if (s.startsWith("1re") || s.startsWith("1ère") || s.startsWith("1er")) return "première";

  if (s.startsWith("t") || s.startsWith("term")) return "terminale";

  return null;
}

function compareLevels(a: string, b: string): number {
  const ia = LEVEL_ORDER.indexOf(a);
  const ib = LEVEL_ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b, "fr");
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

export default function AppelsMatricePage() {
  const [rowsState, dispatchRows] = useReducer(
    adminAttendanceViewReducer<MonitorRow>,
    initialAdminAttendanceViewState<MonitorRow>(),
  );
  const dataSource: LocalDataSource | null = rowsState.source;
  const savedAt = rowsState.savedAt;

  const [now, setNow] = useState<Date>(() => new Date());
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [pollCycle, setPollCycle] = useState(0);

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadRows = useCallback(async (requestedAt = new Date()) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    setNow(requestedAt);
    const requestedDate = toLocalDateInputValue(requestedAt);

    dispatchRows({ type: "begin" });

    try {
      const result = await fetchAdminAttendanceMonitor<MonitorRow>(
        requestedDate,
        requestedDate,
        controller.signal,
        undefined,
        { includeExpectedStatuses: true },
      );
      dispatchRows({
        type: "success",
        source: result.source,
        savedAt: result.saved_at,
        data: result.data.rows || [],
      });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return;
      }

      dispatchRows({
        type: "failure",
        error: e?.message || "Erreur lors du chargement des données.",
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      inFlightRef.current = false;
      if (!controller.signal.aborted) setPollCycle((value) => value + 1);
    }
  }, []);

  useEffect(() => {
    void loadRows(new Date());
  }, [loadRows]);

  const pollDelayMs = adminAttendancePollDelay(
    dataSource,
    Boolean(rowsState.error),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const id = window.setTimeout(() => {
      void loadRows(new Date());
    }, pollDelayMs);

    return () => window.clearTimeout(id);
  }, [loadRows, pollCycle, pollDelayMs]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const refreshNow = () => {
      void loadRows(new Date());
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshNow();
      }
    };

    const onFocus = () => {
      refreshNow();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", refreshNow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", refreshNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadRows]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const rows = useMemo(() => rowsState.data ?? [], [rowsState.data]);
  const currentTime = nowHHMM(now);
  const initialLoading = rowsState.loading && rows.length === 0;
  const refreshing = rowsState.loading && rows.length > 0;

  const levelOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const lvl = inferLevelFromClassLabel(r.class_label);
      if (lvl) s.add(lvl);
    }
    return Array.from(s.values()).sort(compareLevels);
  }, [rows]);

  const slots: Slot[] = useMemo(() => {
    const map = new Map<string, Slot>();

    for (const r of rows) {
      const start = timeFromRowPart(r.planned_start);
      const end = timeFromRowPart(r.planned_end);
      if (!start || !end) continue;

      const key = `${start}-${end}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          start,
          end,
          label: `${start} – ${end}`,
        });
      }
    }

    const list = Array.from(map.values());
    list.sort((a, b) => a.start.localeCompare(b.start));
    return list;
  }, [rows]);

  const activeSlot: Slot | null = useMemo(() => {
    if (!slots.length) return null;

    const live = slots.find((s) => s.start <= currentTime && currentTime < s.end);
    if (live) return live;

    const before = slots.filter((s) => s.end <= currentTime);
    if (before.length) {
      return before.sort((a, b) => a.end.localeCompare(b.end))[before.length - 1];
    }

    return slots[0];
  }, [slots, currentTime]);

  const classCells: ClassCell[] = useMemo(() => {
    if (!activeSlot) return [];

    const byClass = new Map<string, ClassCell>();

    for (const r of rows) {
      const start = timeFromRowPart(r.planned_start);
      const end = timeFromRowPart(r.planned_end);
      if (!start || !end) continue;

      const key = `${start}-${end}`;
      if (key !== activeSlot.key) continue;

      const label = r.class_label || "Classe ?";

      const existing = byClass.get(label) || {
        class_label: label,
        status: r.status,
        subjects: [] as string[],
        teachers: [] as string[],
        teacher_contacts: [] as { name: string; phone: string | null }[],
        absence_reason_label: r.absence_reason_label ?? null,
        absence_admin_comment: r.absence_admin_comment ?? null,
      };

      if (statusScore(r.status) > statusScore(existing.status)) {
        existing.status = r.status;
        existing.absence_reason_label =
          r.absence_reason_label ?? existing.absence_reason_label;
        existing.absence_admin_comment =
          r.absence_admin_comment ?? existing.absence_admin_comment;
      }

      if (r.subject_name && !existing.subjects.includes(r.subject_name)) {
        existing.subjects.push(r.subject_name);
      }
      if (r.teacher_name && !existing.teachers.includes(r.teacher_name)) {
        existing.teachers.push(r.teacher_name);
      }
      if (r.teacher_name) {
        const phone = String(r.teacher_phone || "").trim() || null;
        const contactKey = `${r.teacher_name}|${phone || ""}`;
        const alreadyAdded = existing.teacher_contacts.some(
          (contact) => `${contact.name}|${contact.phone || ""}` === contactKey
        );

        if (!alreadyAdded) {
          existing.teacher_contacts.push({ name: r.teacher_name, phone });
        }
      }

      byClass.set(label, existing);
    }

    let arr = Array.from(byClass.values()).sort((a, b) =>
      a.class_label.localeCompare(b.class_label, "fr")
    );

    if (levelFilter !== "all") {
      arr = arr.filter(
        (cell) => inferLevelFromClassLabel(cell.class_label) === levelFilter
      );
    }

    return arr;
  }, [rows, activeSlot, levelFilter]);

  const totalPresent = classCells.filter(
    (c) => c.status === "ok" || c.status === "started"
  ).length;
  const totalNotStarted = classCells.filter((c) => c.status === "not_started").length;
  const totalLate = classCells.filter((c) => c.status === "late").length;
  const totalMissing = classCells.filter((c) => c.status === "missing").length;
  const totalPending = classCells.filter((c) => c.status === "pending_absence").length;
  const totalJustified = classCells.filter(
    (c) => c.status === "justified_absence"
  ).length;

  const hasAnySlot = slots.length > 0;
  const savedAtLabel = useMemo(() => {
    if (!savedAt) return null;
    const value = new Date(savedAt);
    if (!Number.isFinite(value.getTime())) return null;
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Africa/Abidjan",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(value);
  }, [savedAt]);

  return (
    <main className="min-h-screen bg-slate-50/80 p-4 md:p-6">
      <style jsx global>{`
        @keyframes mc-blink {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
        }
        .mc-blink {
          animation: mc-blink 1.2s ease-in-out infinite;
        }
      `}</style>

      {refreshing && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white/95 px-3 py-2 text-xs font-medium text-emerald-700 shadow-lg shadow-emerald-100/70 backdrop-blur">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Actualisation...
        </div>
      )}

      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
              Vue panoramique
            </p>
            <div className={`mb-2 inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold ${
              dataSource === null
                ? "border-slate-200 bg-slate-50 text-slate-600"
                : dataSource === "cloud"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : dataSource === "relay"
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}>
              {dataSource === null
                ? "Source en attente"
                : dataSource === "cloud"
                ? "Cloud"
                : dataSource === "relay"
                ? "Relais local"
                : "Dernière vue locale"}
            </div>
            <p className="mb-2 text-[11px] text-slate-500">
              {savedAtLabel
                ? `Données enregistrées le ${savedAtLabel}`
                : "Aucune donnée n’a encore été reçue."}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">
              Appels par créneau — Tableau de classes
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Suivez le créneau en cours : appels conformes, appels en retard,
              classes sans appel et justificatifs d’absence à traiter.
            </p>
          </div>

          <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-xs text-slate-700 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">
                Heure actuelle
              </span>
              <span className="font-mono text-sm font-semibold text-slate-900">
                {currentTime}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">
                Créneau suivi
              </span>
              {activeSlot ? (
                <span className="font-mono text-xs font-semibold text-emerald-700">
                  {activeSlot.label}
                </span>
              ) : (
                <span className="text-[11px] text-amber-700">
                  Aucun créneau défini pour aujourd&apos;hui
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => void loadRows()}
              disabled={rowsState.loading}
              className="mt-2 inline-flex items-center gap-1 self-end rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {rowsState.loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {rowsState.loading ? "Actualisation..." : "Actualiser maintenant"}
            </button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-100/90 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-700">
                À venir
              </span>
              <CircleDashed className="h-5 w-5 text-slate-500" />
            </div>
            <div className="text-2xl font-semibold text-slate-900">{totalNotStarted}</div>
            <p className="text-[11px] text-slate-700/80">
              Créneaux qui n’ont pas encore commencé.
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-emerald-900">
                Conformes
              </span>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="text-2xl font-semibold text-emerald-900">
              {totalPresent}
            </div>
            <p className="text-[11px] text-emerald-900/80">
              Appels commencés dans le délai prévu.
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-red-100 bg-red-50/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-red-800">
                Sans appel
              </span>
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div className="text-2xl font-semibold text-red-900">{totalMissing}</div>
            <p className="text-[11px] text-red-800/80">
              Délai dépassé, aucun appel commencé.
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-amber-100 bg-amber-50/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-amber-900">
                En retard
              </span>
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div className="text-2xl font-semibold text-amber-900">{totalLate}</div>
            <p className="text-[11px] text-amber-900/80">
              Appels commencés après le délai prévu.
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-yellow-100 bg-yellow-50/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-yellow-900">
                À valider
              </span>
              <Hourglass className="h-5 w-5 text-yellow-600" />
            </div>
            <div className="text-2xl font-semibold text-yellow-900">{totalPending}</div>
            <p className="text-[11px] text-yellow-900/80">
              Justifications reçues à examiner.
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-blue-100 bg-blue-50/80 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-blue-900">
                Justifiées
              </span>
              <ShieldCheck className="h-5 w-5 text-blue-600" />
            </div>
            <div className="text-2xl font-semibold text-blue-900">{totalJustified}</div>
            <p className="text-[11px] text-blue-900/80">
              Absences validées par l’administration.
            </p>
          </div>
        </section>

        <section
          aria-busy={rowsState.loading}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5"
        >
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Users className="h-4 w-4 text-slate-500" />
              <span>Grille des classes sur le créneau suivi</span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-slate-500" />
                  À venir
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="mc-blink inline-block h-3 w-3 rounded-sm bg-emerald-500" />
                  Conforme
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="mc-blink inline-block h-3 w-3 rounded-sm bg-red-600" />
                  Sans appel
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="mc-blink inline-block h-3 w-3 rounded-sm bg-amber-500" />
                  En retard
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="mc-blink inline-block h-3 w-3 rounded-sm bg-yellow-400" />
                  À valider
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="mc-blink inline-block h-3 w-3 rounded-sm bg-blue-600" />
                  Justifiée
                </span>
              </div>

              <div className="flex items-center gap-1">
                <span className="text-slate-600">Niveau :</span>
                <select
                  value={levelFilter}
                  onChange={(e) => setLevelFilter(e.target.value)}
                  disabled={!levelOptions.length}
                  className="rounded-full border border-slate-200 bg-white/90 px-2 py-1 text-[11px] text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-60"
                >
                  <option value="all">Tous les niveaux</option>
                  {levelOptions.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl === "seconde"
                        ? "Seconde"
                        : lvl === "première"
                        ? "Première"
                        : lvl === "terminale"
                        ? "Terminale"
                        : lvl.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {dataSource === "cache" && rows.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Cloud et relais indisponibles : la dernière vue locale valide reste affichée
              {savedAtLabel ? ` (enregistrée le ${savedAtLabel})` : ""}.
            </div>
          )}

          {rowsState.error && rows.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Actualisation impossible : les cartes précédentes sont conservées. {rowsState.error}
            </div>
          )}

          {initialLoading ? (
            <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-emerald-600" />
              <p className="text-sm font-medium text-slate-800">
                Chargement de la surveillance des appels...
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Veuillez patienter quelques instants.
              </p>
            </div>
          ) : rowsState.error && rows.length === 0 ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {rowsState.error}
            </div>
          ) : !hasAnySlot ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Aucun créneau horaire n&apos;a été trouvé pour aujourd&apos;hui.
            </div>
          ) : !activeSlot ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Aucun créneau ne correspond actuellement à l&apos;heure{" "}
              <span className="font-mono font-semibold">{currentTime}</span>.
            </div>
          ) : classCells.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              {levelFilter === "all"
                ? "Aucun cours planifié sur ce créneau ou aucune donnée de surveillance n'a été générée pour l'instant."
                : "Aucun cours planifié sur ce créneau pour ce niveau, ou aucune donnée de surveillance n'a été générée pour l'instant."}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {classCells.map((cell) => (
                <div
                  key={cell.class_label}
                  className={[
                    "relative flex flex-col rounded-2xl border px-3 py-3 text-xs",
                    cell.status === "not_started" ? "" : "mc-blink",
                    cellColorClasses(cell.status),
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {cell.class_label}
                    </span>
                    <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase">
                      {cell.status === "not_started"
                        ? "À VENIR"
                        : cell.status === "missing"
                        ? "OFF"
                        : cell.status === "late"
                        ? "RETARD"
                        : cell.status === "pending_absence"
                        ? "À VALIDER"
                        : cell.status === "justified_absence"
                        ? "JUSTIF."
                        : "OK"}
                    </span>
                  </div>

                  <div className="mt-1 space-y-0.5 text-[11px]">
                    {cell.subjects.length > 0 && (
                      <div className="truncate">
                        <span className="font-medium">Discipline :</span>{" "}
                        {cell.subjects.join(", ")}
                      </div>
                    )}

                    {cell.teacher_contacts.length > 0 ? (
                      <div className="space-y-0.5">
                        {cell.teacher_contacts.map((teacher) => (
                          <div key={`${teacher.name}|${teacher.phone || ""}`} className="space-y-0.5">
                            <div className="truncate">
                              <span className="font-medium">Prof :</span>{" "}
                              {teacher.name}
                            </div>
                            <div className="truncate">
                              <span className="font-medium">Tél :</span>{" "}
                              {teacher.phone || "Non renseigné"}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : cell.teachers.length > 0 ? (
                      <div className="truncate">
                        <span className="font-medium">Prof :</span>{" "}
                        {cell.teachers.join(", ")}
                      </div>
                    ) : null}

                    <p className="mt-1 text-[10px] opacity-90">
                      {statusHint(
                        cell.status,
                        cell.absence_reason_label,
                        cell.absence_admin_comment
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="mt-3 text-[11px] text-slate-500">
            Le statut du créneau dépend de l’heure de démarrage de l’appel : dans le délai,
            l’appel est conforme ; après le délai, il est en retard.
          </p>
        </section>
      </div>
    </main>
  );
}
