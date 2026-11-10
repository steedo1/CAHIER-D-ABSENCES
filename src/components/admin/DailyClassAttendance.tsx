"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchAdminAttendanceMonitor } from "@/lib/local-relay";
import type { EducationScopedClass, EducationScopeValue } from "@/lib/education-scope";
import { getClassDisplayLabel } from "@/lib/education-scope";
import { summarizeDailyAttendance, type DailyAttendanceRow, type DailyAttendanceStatus } from "@/lib/attendance-daily-class-summary";

type Source = "cloud" | "relay" | "hybrid" | "cache";
type Snapshot = { rows: DailyAttendanceRow[]; source: Source; savedAt: string };

const statusLabels: Record<DailyAttendanceStatus, string> = {
  done: "Fait",
  unreceived: "Non reçu",
  ongoing: "À venir / en cours",
  unconfirmed: "À confirmer",
};

function todayInAbidjan() {
  return new Date().toISOString().slice(0, 10);
}

export default function DailyClassAttendance({ classes }: { classes: EducationScopedClass[] }) {
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(todayInAbidjan);
  const [refreshKey, setRefreshKey] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const classOptions = useMemo(() => [...classes].sort((a, b) =>
    getClassDisplayLabel(a).localeCompare(getClassDisplayLabel(b), "fr", { numeric: true }),
  ), [classes]);

  useEffect(() => {
    if (!classId || !date) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setSnapshot(null);
    setError(null);
    setLoading(true);
    const scope: EducationScopeValue = {
      educationType: "all",
      formationCode: "",
      levelCode: "",
      classId,
    };

    void fetchAdminAttendanceMonitor<DailyAttendanceRow>(
      date, date, controller.signal, scope,
      { includeExpectedStatuses: true, cloudTimeoutMs: 9_000 },
    ).then((result) => {
      if (controller.signal.aborted) return;
      const rows = Array.isArray(result.data?.rows)
        ? result.data.rows.filter((row) => row.class_id === classId && row.date === date)
        : [];
      setSnapshot({ rows, source: result.source, savedAt: result.saved_at });
      setNow(new Date());
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Impossible de charger les appels.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    // Consultation à la demande uniquement : aucun intervalle, aucun polling.
    return () => controller.abort();
  }, [classId, date, refreshKey]);

  const totals = useMemo(() =>
    summarizeDailyAttendance(snapshot?.rows || [], date, now),
  [snapshot, date, now]);
  const verified = snapshot !== null && snapshot.source === "cloud" && !error;
  const selectedClass = classOptions.find((item) => item.id === classId);
  const showNumber = (value: number) => verified ? value : "—";

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
      <h1 className="text-xl font-semibold text-slate-900">Suivi journalier des appels</h1>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-44 flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
          Classe
          <select aria-label="Classe" value={classId} onChange={(e) => setClassId(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="">Choisir une classe</option>
            {classOptions.map((item) => <option key={item.id} value={item.id}>{getClassDisplayLabel(item)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Date
          <input aria-label="Date" type="date" max={todayInAbidjan()} value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2" />
        </label>
        <button type="button" disabled={!classId || loading} onClick={() => setRefreshKey((n) => n + 1)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">
          <RefreshCw className="h-4 w-4" /> Actualiser
        </button>
      </div>

      {!classId ? <p className="text-sm text-slate-600">Choisissez une classe pour consulter les appels de la journée.</p> : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {([
              ["Programmés", showNumber(totals.planned)],
              ["Faits", showNumber(totals.done)],
              ["Non reçus", showNumber(totals.unreceived)],
            ] as const).map(([label, number]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                <div className="text-2xl font-bold text-slate-900">{number}</div>
                <div className="text-xs font-medium text-slate-600">{label}</div>
              </div>
            ))}
          </div>

          {loading && <p role="status" className="text-sm text-slate-600">Chargement des appels…</p>}
          {error && <p role="alert" className="text-sm text-red-700">Chargement impossible : {error}</p>}
          {snapshot?.source === "cache" && (
            <p role="status" className="text-sm text-amber-800">Cloud indisponible : dernier état local non vérifié. Les totaux ne sont pas confirmés.</p>
          )}
          {snapshot && snapshot.source !== "cloud" && snapshot.source !== "cache" && (
            <p role="status" className="text-sm text-amber-800">Données issues d'une source secondaire : les totaux restent à confirmer sur le Cloud.</p>
          )}
          {snapshot && totals.pending > 0 && (
            <p className="text-xs text-slate-500">{totals.pending} cours à venir, en cours ou dont l'appel reste à confirmer.</p>
          )}
          {snapshot && totals.entries.length === 0 && verified && (
            <p className="text-sm text-slate-600">Aucun cours programmé pour {getClassDisplayLabel(selectedClass || { id: classId })} à cette date.</p>
          )}
          {snapshot && totals.entries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[390px] text-left text-sm">
                <thead><tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-2 font-semibold">Horaire</th>
                  <th className="py-2 pr-2 font-semibold">Matière / Professeur</th>
                  <th className="py-2 font-semibold">Appel</th>
                </tr></thead>
                <tbody>{totals.entries.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="py-3 pr-2 whitespace-nowrap">{String(row.planned_start || "").slice(0, 5)}–{String(row.planned_end || "").slice(0, 5)}</td>
                    <td className="py-3 pr-2">
                      <div className="font-semibold text-slate-900">{row.subject_name || "Matière"}</div>
                      <div className="text-slate-600">{row.teacher_name || "Enseignant"}</div>
                    </td>
                    <td className="py-3 font-medium text-slate-800">{statusLabels[row.daily_status]}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {snapshot && (
            <p className="text-xs text-slate-500">« Non reçu » signifie qu'aucun appel n'est confirmé pour le cours terminé, pas que le professeur était absent. Vérifier toute synchronisation en attente.</p>
          )}
        </>
      )}
    </section>
  );
}
