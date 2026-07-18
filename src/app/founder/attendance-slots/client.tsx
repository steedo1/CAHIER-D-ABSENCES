"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  School2,
  ShieldCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import { fetchFounderAttendanceSlots, type LocalDataSource } from "@/lib/local-relay";

type PeriodRow = {
  id: string;
  institution_id: string;
  weekday: number | null;
  label: string | null;
  start_time: string | null;
  end_time: string | null;
  startMin: number;
  endMin: number;
};

type SchoolSummary = {
  school: any;
  period: PeriodRow | null;
  periodState: "current" | "upcoming" | "closed" | "none";
  expected: number;
  present: number;
  permissionnaire: number;
  absent: number;
  nextPeriod: PeriodRow | null;
  lastPeriod: PeriodRow | null;
};

export type FounderAttendancePayload = {
  source: "cloud" | "relay" | "cache";
  generated_at: string;
  today: string;
  nowLabel: string;
  rows: SchoolSummary[];
  totals: { schools: number; activeSchools: number; expected: number; present: number; permissionnaire: number; absent: number };
};

function normalizeTimeFromDb(raw: string | null | undefined): string | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function formatPeriod(row: PeriodRow | null) {
  if (!row) return "Aucun créneau";
  return `${normalizeTimeFromDb(row.start_time) || "--:--"} - ${normalizeTimeFromDb(row.end_time) || "--:--"}`;
}

function periodTitle(row: PeriodRow | null) {
  if (!row) return "Aucun créneau";
  const label = String(row.label || "").trim();
  const hours = formatPeriod(row);
  return label ? `${label} • ${hours}` : hours;
}

function statusText(row: SchoolSummary) {
  if (row.periodState === "current") return `Créneau actuel : ${formatPeriod(row.period)}`;
  if (row.periodState === "upcoming") return `Prochain créneau : ${formatPeriod(row.nextPeriod)}`;
  if (row.periodState === "closed") return `Dernier créneau : ${formatPeriod(row.lastPeriod)}`;
  return "Aucun créneau configuré aujourd’hui";
}

function statusBadgeClass(row: SchoolSummary) {
  if (row.periodState !== "current") return "border-slate-200 bg-slate-50 text-slate-600";
  if (row.absent > 0) return "border-rose-200 bg-rose-50 text-rose-700";
  if (row.permissionnaire > 0) return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function FounderAttendanceSlotsClient({ initialData }: { initialData: FounderAttendancePayload }) {
  const [payload, setPayload] = useState(initialData);
  const [source, setSource] = useState<LocalDataSource>(initialData.source || "cloud");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const refresh = async () => {
      try {
        const result = await fetchFounderAttendanceSlots<FounderAttendancePayload>();
        if (!alive) return;
        setPayload({ ...result.data, source: result.source });
        setSource(result.source);
        setError(null);
      } catch (e: any) {
        if (alive) setError(String(e?.message || "Actualisation impossible"));
      } finally {
        if (alive) timer = window.setTimeout(refresh, 60_000);
      }
    };
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    void refresh();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const { today, nowLabel, rows } = payload;
  const activeRows = rows.filter((row) => row.periodState === "current");
  const totalExpected = activeRows.reduce((sum, row) => sum + row.expected, 0);
  const totalPresent = activeRows.reduce((sum, row) => sum + row.present, 0);
  const totalPermissionnaire = activeRows.reduce((sum, row) => sum + row.permissionnaire, 0);
  const totalAbsent = activeRows.reduce((sum, row) => sum + row.absent, 0);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className={`rounded-2xl border px-4 py-2 text-xs font-black ${
        source === "cloud"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : source === "relay"
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }`}>
        {source === "cloud"
          ? "Données Cloud à jour"
          : source === "relay"
          ? "Mode relais local — établissement présent sur ce réseau"
          : "Dernière vue locale connue"}
        {error ? ` · ${error}` : ""}
      </div>
      <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-700">
              Vue créneau fondateur
            </p>
            <h1 className="mt-1 text-xl font-black tracking-tight text-slate-950 sm:text-2xl">
              Suivi temps réel par établissement
            </h1>
            <p className="mt-1 text-xs font-semibold text-slate-500 sm:text-sm">
              {today} · Actualisé à {nowLabel}
            </p>
          </div>

          <div className="w-fit rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
            Présent = appel fait
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
            <School2 className="h-4 w-4" /> Écoles
          </div>
          <div className="mt-2 text-3xl font-black text-slate-950">{rows.length}</div>
          <p className="mt-1 text-xs font-semibold text-slate-500">Établissements suivis</p>
        </div>

        <div className="rounded-[24px] border border-sky-100 bg-sky-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-sky-700">
            <Clock3 className="h-4 w-4" /> En cours
          </div>
          <div className="mt-2 text-3xl font-black text-sky-900">{activeRows.length}</div>
          <p className="mt-1 text-xs font-semibold text-sky-800">École(s) en créneau</p>
        </div>

        <div className="rounded-[24px] border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Présents
          </div>
          <div className="mt-2 text-3xl font-black text-emerald-900">{totalPresent}</div>
          <p className="mt-1 text-xs font-semibold text-emerald-800">Appels faits</p>
        </div>

        <div className="rounded-[24px] border border-sky-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-sky-700">
            <ShieldCheck className="h-4 w-4" /> Permissionnaires
          </div>
          <div className="mt-2 text-3xl font-black text-sky-900">{totalPermissionnaire}</div>
          <p className="mt-1 text-xs font-semibold text-sky-800">Demandes autorisées</p>
        </div>

        <div className="rounded-[24px] border border-rose-100 bg-rose-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-rose-700">
            <XCircle className="h-4 w-4" /> Absents
          </div>
          <div className="mt-2 text-3xl font-black text-rose-900">{totalAbsent}</div>
          <p className="mt-1 text-xs font-semibold text-rose-800">Appels non faits</p>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-black text-slate-950">
            <UsersRound className="h-4 w-4 text-slate-500" /> Supervision des établissements
          </div>
          <p className="text-xs font-semibold text-slate-500">
            {totalExpected} enseignant(s) attendu(s) sur les créneaux en cours
          </p>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {rows.length === 0 ? (
          <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800">
            Aucune école rattachée trouvée pour ce compte fondateur.
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.school.id} className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-black text-slate-950">
                    <School2 className="h-4 w-4 shrink-0 text-slate-500" />
                    <span className="truncate">{row.school.name || "Établissement"}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusBadgeClass(row)}`}>
                      {statusText(row)}
                    </span>
                    {row.periodState === "current" ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                        En cours
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="w-fit rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600">
                  {row.expected} prof(s)
                </div>
              </div>

              {row.periodState === "current" ? (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-center sm:p-4">
                    <div className="mx-auto grid h-8 w-8 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm sm:h-9 sm:w-9">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div className="mt-2 text-[10px] font-black uppercase tracking-[0.1em] text-emerald-700 sm:text-[11px]">
                      Présents
                    </div>
                    <div className="mt-1 text-2xl font-black text-emerald-900 sm:text-3xl">{row.present}</div>
                  </div>

                  <div className="rounded-2xl border border-sky-100 bg-sky-50 p-3 text-center sm:p-4">
                    <div className="mx-auto grid h-8 w-8 place-items-center rounded-xl bg-white text-sky-700 shadow-sm sm:h-9 sm:w-9">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div className="mt-2 text-[10px] font-black uppercase tracking-[0.1em] text-sky-700 sm:text-[11px]">
                      Permission
                    </div>
                    <div className="mt-1 text-2xl font-black text-sky-900 sm:text-3xl">{row.permissionnaire}</div>
                  </div>

                  <div className="rounded-2xl border border-rose-100 bg-rose-50 p-3 text-center sm:p-4">
                    <div className="mx-auto grid h-8 w-8 place-items-center rounded-xl bg-white text-rose-700 shadow-sm sm:h-9 sm:w-9">
                      <XCircle className="h-4 w-4" />
                    </div>
                    <div className="mt-2 text-[10px] font-black uppercase tracking-[0.1em] text-rose-700 sm:text-[11px]">
                      Absents
                    </div>
                    <div className="mt-1 text-2xl font-black text-rose-900 sm:text-3xl">{row.absent}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-slate-500 shadow-sm">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-black text-slate-800">Aucun créneau en cours</div>
                      {row.nextPeriod ? (
                        <p className="mt-1 text-xs font-black text-sky-700">
                          Prochain : {periodTitle(row.nextPeriod)}
                        </p>
                      ) : row.lastPeriod ? (
                        <p className="mt-1 text-xs font-black text-slate-600">
                          Dernier : {periodTitle(row.lastPeriod)}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          Aucun créneau actif configuré aujourd’hui.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

}
