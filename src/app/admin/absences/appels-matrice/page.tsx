"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Users,
  ShieldCheck,
  Hourglass,
} from "lucide-react";

type MonitorStatus =
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
  status: MonitorStatus;
  late_minutes?: number | null;
  opened_from?: "teacher" | "class_device" | null;

  // 🔥 nouveaux champs potentiels renvoyés par l'API
  absence_request_status?: "pending" | "approved" | "rejected" | null;
  absence_reason_label?: string | null;
  absence_admin_comment?: string | null;
};

type FetchState<T> = { loading: boolean; error: string | null; data: T | null };

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
  // priorité d'alerte : missing > pending > late > justified > ok
  if (s === "missing") return 4;
  if (s === "pending_absence") return 3;
  if (s === "late") return 2;
  if (s === "justified_absence") return 1;
  return 0;
}

function statusLabel(s: MonitorStatus): string {
  if (s === "missing") return "Appel manquant";
  if (s === "late") return "Appel en retard";
  if (s === "pending_absence") return "Demande en attente";
  if (s === "justified_absence") return "Absence justifiée";
  return "Appel conforme";
}

function statusHint(
  s: MonitorStatus,
  reason?: string | null,
  comment?: string | null
): string {
  if (s === "missing") {
    return "Aucun appel détecté pour cette classe sur ce créneau.";
  }
  if (s === "late") {
    return "Appel effectué mais en retard par rapport à l’horaire prévu.";
  }
  if (s === "pending_absence") {
    return `Une demande d’absence enseignant est en attente de validation${
      reason ? ` (${reason})` : ""
    }.`;
  }
  if (s === "justified_absence") {
    return `Absence validée par l’administration${reason ? ` (${reason})` : ""}${
      comment ? ` — ${comment}` : ""
    }.`;
  }
  return "Appel réalisé dans les délais du créneau.";
}

function cellColorClasses(s: MonitorStatus): string {
  if (s === "missing") {
    return "bg-red-600 text-white border-red-400 shadow-lg shadow-red-300/40";
  }
  if (s === "late") {
    return "bg-amber-500 text-slate-900 border-amber-300 shadow-lg shadow-amber-300/40";
  }
  if (s === "pending_absence") {
    return "bg-sky-500 text-white border-sky-300 shadow-lg shadow-sky-300/40";
  }
  if (s === "justified_absence") {
    return "bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-300/40";
  }
  return "bg-emerald-600 text-white border-emerald-400 shadow-lg shadow-emerald-300/40";
}

/* ========= Helpers niveau ========= */

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
  const [rowsState, setRowsState] = useState<FetchState<MonitorRow[]>>({
    loading: false,
    error: null,
    data: null,
  });

  const [now, setNow] = useState<Date>(() => new Date());
  const today = useMemo(() => toLocalDateInputValue(now), [now]);

  const [levelFilter, setLevelFilter] = useState<string>("all");

  async function loadRows() {
    setRowsState((prev) => ({ ...prev, loading: !prev.data, error: null }));
    try {
      const qs = new URLSearchParams({ from: today, to: today });
      const res = await fetch(`/api/admin/attendance/monitor?${qs.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(
          `API /api/admin/attendance/monitor non disponible (HTTP ${res.status}).`
        );
      }
      const json = await res.json().catch(() => null);
      const rows = (json?.rows || []) as MonitorRow[];
      setRowsState({ loading: false, error: null, data: rows });
    } catch (e: any) {
      setRowsState({
        loading: false,
        error: e?.message || "Erreur lors du chargement des données.",
        data: null,
      });
    }
  }

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      setNow(new Date());
      loadRows();
    }, 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = rowsState.data ?? [];
  const currentTime = nowHHMM(now);

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
        absence_reason_label: r.absence_reason_label ?? null,
        absence_admin_comment: r.absence_admin_comment ?? null,
      };

      if (statusScore(r.status) > statusScore(existing.status)) {
        existing.status = r.status;
        existing.absence_reason_label = r.absence_reason_label ?? existing.absence_reason_label;
        existing.absence_admin_comment =
          r.absence_admin_comment ?? existing.absence_admin_comment;
      }

      if (r.subject_name && !existing.subjects.includes(r.subject_name)) {
        existing.subjects.push(r.subject_name);
      }
      if (r.teacher_name && !existing.teachers.includes(r.teacher_name)) {
        existing.teachers.push(r.teacher_name);
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

  const totalPresent = classCells.filter((c) => c.status === "ok").length;
  const totalLate = classCells.filter((c) => c.status === "late").length;
  const totalMissing = classCells.filter((c) => c.status === "missing").length;
  const totalPending = classCells.filter((c) => c.status === "pending_absence").length;
  const totalJustified = classCells.filter(
    (c) => c.status === "justified_absence"
  ).length;

  const hasAnySlot = slots.length > 0;

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

      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
              Vue panoramique
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">
              Appels par créneau — Tableau de classes
            </h1>
            <p className="mt-1 text-sm text-slate-500 max-w-2xl">
              Surveillez en temps réel quelles classes ont un enseignant présent,
              quelles classes sont sans appel, quelles demandes sont en attente et
              quelles absences sont déjà justifiées.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-xs text-slate-700 shadow-sm flex flex-col gap-1">
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
              onClick={loadRows}
              className="mt-2 inline-flex items-center gap-1 self-end rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
            >
              <RefreshCw className="h-3 w-3" />
              Actualiser maintenant
            </button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-5">
          <div className="rounded-2xl border border-red-100 bg-red-50/80 p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-red-800 uppercase tracking-wide">
                Sans appel
              </span>
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div className="text-2xl font-semibold text-red-900">{totalMissing}</div>
            <p className="text-[11px] text-red-800/80">
              Cours prévu mais aucun appel détecté.
            </p>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-amber-900 uppercase tracking-wide">
                En retard
              </span>
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div className="text-2xl font-semibold text-amber-900">{totalLate}</div>
            <p className="text-[11px] text-amber-900/80">
              Appels effectués hors délai.
            </p>
          </div>

          <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-sky-900 uppercase tracking-wide">
                En attente
              </span>
              <Hourglass className="h-5 w-5 text-sky-600" />
            </div>
            <div className="text-2xl font-semibold text-sky-900">{totalPending}</div>
            <p className="text-[11px] text-sky-900/80">
              Demandes d’absence soumises, non encore validées.
            </p>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-blue-900 uppercase tracking-wide">
                Justifiées
              </span>
              <ShieldCheck className="h-5 w-5 text-blue-600" />
            </div>
            <div className="text-2xl font-semibold text-blue-900">{totalJustified}</div>
            <p className="text-[11px] text-blue-900/80">
              Absences validées par l’administration.
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-900 uppercase tracking-wide">
                Conformes
              </span>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="text-2xl font-semibold text-emerald-900">
              {totalPresent}
            </div>
            <p className="text-[11px] text-emerald-900/80">
              Appels réalisés dans les délais.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 md:p-5 space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Users className="h-4 w-4 text-slate-500" />
              <span>Grille des classes sur le créneau suivi</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500 mc-blink" />
                  Conforme
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-amber-500 mc-blink" />
                  Retard
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-sky-500 mc-blink" />
                  En attente
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-blue-600 mc-blink" />
                  Justifiée
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-red-600 mc-blink" />
                  Sans appel
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

          {rowsState.loading && !rows.length ? (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 w-full animate-pulse rounded-2xl bg-slate-100"
                />
              ))}
            </div>
          ) : rowsState.error ? (
            <div className="p-4 border border-red-200 rounded-2xl bg-red-50 text-red-700 text-sm">
              {rowsState.error}
            </div>
          ) : !hasAnySlot ? (
            <div className="p-4 border border-slate-200 rounded-2xl bg-slate-50 text-slate-600 text-sm">
              Aucun créneau horaire n&apos;a été trouvé pour aujourd&apos;hui.
            </div>
          ) : !activeSlot ? (
            <div className="p-4 border border-amber-200 rounded-2xl bg-amber-50 text-amber-800 text-sm">
              Aucun créneau ne correspond actuellement à l&apos;heure{" "}
              <span className="font-mono font-semibold">{currentTime}</span>.
            </div>
          ) : classCells.length === 0 ? (
            <div className="p-4 border border-slate-200 rounded-2xl bg-slate-50 text-slate-600 text-sm">
              {levelFilter === "all"
                ? "Aucun cours planifié sur ce créneau ou aucune donnée de surveillance n'a été générée pour l'instant."
                : "Aucun cours planifié sur ce créneau pour ce niveau, ou aucune donnée de surveillance n'a été générée pour l'instant."}
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {classCells.map((cell) => (
                <div
                  key={cell.class_label}
                  className={[
                    "relative flex flex-col rounded-2xl border px-3 py-3 text-xs",
                    "mc-blink",
                    cellColorClasses(cell.status),
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">
                      {cell.class_label}
                    </span>
                    <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase">
                      {cell.status === "missing"
                        ? "OFF"
                        : cell.status === "late"
                        ? "RETARD"
                        : cell.status === "pending_absence"
                        ? "ATTENTE"
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
                    {cell.teachers.length > 0 && (
                      <div className="truncate">
                        <span className="font-medium">Prof :</span>{" "}
                        {cell.teachers.join(", ")}
                      </div>
                    )}
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
            Cette vue temps réel réutilise la surveillance des appels et est prête à
            afficher aussi les demandes d'autoristation d'absence enseignants en attente ou validées.
          </p>
        </section>
      </div>
    </main>
  );
}