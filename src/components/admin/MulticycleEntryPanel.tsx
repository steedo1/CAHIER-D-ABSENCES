"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  SCHOOL_CYCLE_OPTIONS,
  TEACHING_TRACK_OPTIONS,
  type SchoolCycle,
  type SchoolCyclesSettings,
} from "@/lib/school-cycles";

type CycleSummary = {
  classes: Array<{ id: string; label: string; level: string | null }>;
  count: number;
  students: number;
  teachers: number;
};

type SummaryResponse = {
  ok?: boolean;
  enabled?: boolean;
  academicYear?: string | null;
  totalClasses?: number;
  cycles?: Partial<Record<SchoolCycle, CycleSummary>>;
  error?: string;
};

export default function MulticycleEntryPanel({
  configuration,
}: {
  configuration: SchoolCyclesSettings;
}) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/admin/school-cycles", {
          signal: controller.signal,
          cache: "no-store",
        });
        const result = await response.json() as SummaryResponse;
        if (!response.ok || !result.ok) throw new Error(result.error || "Chargement indisponible.");
        if (live) setSummary(result);
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "Chargement indisponible.");
      }
    })();
    return () => { live = false; controller.abort(); };
  }, []);

  if (!configuration.enabled) return null;

  return (
    <section className="rounded-3xl border border-sky-100 bg-gradient-to-br from-white to-sky-50 p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-sky-700">
            Direction générale
          </p>
          <h2 className="mt-1 text-xl font-black text-slate-900">
            Gestion des cycles scolaires
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Une vue commune pour l'établissement, sans changement de compte.
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-sky-100">
          {summary?.academicYear || "Année scolaire à définir"}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {configuration.enabledCycles
          .slice()
          .sort((a, b) => Number(b === configuration.defaultView) -
            Number(a === configuration.defaultView))
          .map((cycle) => {
          const config = SCHOOL_CYCLE_OPTIONS.find((item) => item.id === cycle);
          const count = summary?.cycles?.[cycle]?.count;
          const programs = configuration.teachingTracksByCycle[cycle] || ["french"];
          return (
            <Link
              key={cycle}
              href={`/admin/cycles?cycle=${encodeURIComponent(cycle)}`}
              className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-sky-400 hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-slate-900">{config?.label || cycle}</h3>
                <span className="text-sky-600 transition group-hover:translate-x-1">→</span>
              </div>
              <div className="mt-3 text-3xl font-black text-slate-800">
                {typeof count === "number" ? count : "—"}
                <span className="ml-2 text-xs font-medium text-slate-500">classes</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <span>{summary?.cycles?.[cycle]?.students ?? "—"} élèves</span>
                <span>{summary?.cycles?.[cycle]?.teachers ?? "—"} enseignants</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {programs.map((program) => (
                  <span key={program} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">
                    {TEACHING_TRACK_OPTIONS.find((x) => x.id === program)?.label || program}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-sm font-bold text-sky-700">Ouvrir le cycle</p>
            </Link>
          );
        })}
      </div>
      {summary?.enabled && (
        <p className="mt-3 text-xs text-slate-500">
          Effectifs dédoublonnés : un élève ou un enseignant partagé entre plusieurs groupes
          est compté une seule fois dans chaque cycle.
        </p>
      )}
      {error && (
        <div role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
          Les effectifs par cycle sont momentanément indisponibles : {error}
        </div>
      )}
    </section>
  );
}
