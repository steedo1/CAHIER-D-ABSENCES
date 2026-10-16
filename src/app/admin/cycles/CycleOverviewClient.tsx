"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  SCHOOL_CYCLE_OPTIONS,
  TEACHING_TRACK_OPTIONS,
  isSchoolCycle,
  type SchoolCycle,
  type TeachingTrack,
} from "@/lib/school-cycles";

type SchoolClass = { id: string; label: string; level: string | null };
type CycleSummary = { classes: SchoolClass[]; count: number };
type Data = {
  ok?: boolean;
  enabled?: boolean;
  institution?: { name: string };
  academicYear?: string | null;
  configuration?: {
    enabledCycles: SchoolCycle[];
    teachingTracksByCycle: Partial<Record<SchoolCycle, TeachingTrack[]>>;
    defaultView: "all" | SchoolCycle;
  };
  cycles?: Partial<Record<SchoolCycle, CycleSummary>>;
  totalClasses?: number;
  error?: string;
};

export default function CycleOverviewClient({ initialCycle }: { initialCycle: SchoolCycle | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [cycle, setCycle] = useState<SchoolCycle | "all">(initialCycle || "all");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/admin/school-cycles", {
          signal: controller.signal, cache: "no-store",
        });
        const payload = await res.json() as Data;
        if (!res.ok || !payload.ok) throw new Error(payload.error || "Chargement indisponible.");
        if (!active) return;
        setData(payload);
        if (!initialCycle && payload.configuration?.defaultView) {
          setCycle(payload.configuration.defaultView);
        } else if (initialCycle && !payload.configuration?.enabledCycles.includes(initialCycle)) {
          setCycle("all");
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Erreur de chargement.");
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [initialCycle]);

  const enabledCycles = data?.configuration?.enabledCycles || [];
  const shownCycles = useMemo(
    () => cycle === "all" ? enabledCycles : enabledCycles.filter((id) => id === cycle),
    [cycle, enabledCycles],
  );

  if (error) return (
    <div role="alert" className="rounded-xl bg-red-50 p-5 text-red-800">{error}</div>
  );
  if (!data) return (
    <p className="rounded-xl bg-white p-5 text-sm text-slate-600">Chargement des cycles scolaires…</p>
  );
  if (!data.enabled) return (
    <div className="rounded-xl bg-white p-5">
      <p className="text-slate-700">Le mode multicyle n'est pas activé pour cet établissement.</p>
      <Link href="/admin/dashboard" className="mt-2 inline-block font-semibold text-sky-700">Retour au tableau de bord</Link>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <Link href="/admin/dashboard" className="text-sm font-semibold text-sky-700">
          ← Direction générale
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">Cycles scolaires</h1>
        <p className="mt-1 text-sm text-slate-600">
          {data.institution?.name} · {data.academicYear || "Année scolaire non définie"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCycle("all")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${cycle === "all" ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            Toute l'école
          </button>
          {enabledCycles.map((id) => (
            <button
              type="button"
              key={id}
              onClick={() => setCycle(id)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${cycle === id ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {SCHOOL_CYCLE_OPTIONS.find((option) => option.id === id)?.label || id}
            </button>
          ))}
        </div>
      </div>

      {shownCycles.map((id) => {
        const cycleName = SCHOOL_CYCLE_OPTIONS.find((option) => option.id === id)?.label || id;
        const classes = data.cycles?.[id]?.classes || [];
        const programs = data.configuration?.teachingTracksByCycle[id] || ["french"];
        return (
          <section key={id} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{cycleName}</h2>
                <p className="mt-1 text-sm text-slate-600">{classes.length} classe(s) pour l'année active</p>
              </div>
              <Link href="/admin/classes" className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white">
                Gérer les classes
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {programs.map((program) => (
                <span key={program} className="rounded-lg bg-sky-50 px-2 py-1 text-xs text-sky-800">
                  {TEACHING_TRACK_OPTIONS.find((option) => option.id === program)?.label || program}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Programmes autorisés pour ce cycle ; la répartition des élèves et des enseignants
              sera définie séparément lors de la configuration pédagogique.
            </p>

            {classes.length === 0 ? (
              <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                Aucune classe enregistrée pour l'année scolaire active.
              </p>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {classes
                  .slice()
                  .sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }))
                  .map((schoolClass) => (
                    <div key={schoolClass.id} className="rounded-xl border border-slate-200 p-3">
                      <p className="font-semibold text-slate-900">{schoolClass.label}</p>
                      <p className="text-xs text-slate-500">Niveau : {schoolClass.level || "non renseigné"}</p>
                    </div>
                  ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
