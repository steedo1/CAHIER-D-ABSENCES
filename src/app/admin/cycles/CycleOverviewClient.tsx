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
type CycleSummary = { classes: SchoolClass[]; count: number; students: number; teachers: number };
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
  reviewNeeded?: SchoolClass[];
  outsideEnabledCycles?: SchoolClass[];
  uniqueStudents?: number;
  uniqueTeachers?: number;
  programs?: Partial<Record<SchoolCycle, Partial<Record<TeachingTrack, {
    subjects: Array<{ id: string; name: string }>;
    uniqueTeachers: number;
  }>>>>;
  error?: string;
};

export default function CycleOverviewClient({ initialCycle }: { initialCycle: SchoolCycle | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [cycle, setCycle] = useState<SchoolCycle | "all">(initialCycle || "all");
  const [programForCycle, setProgramForCycle] = useState<Partial<Record<SchoolCycle, TeachingTrack | "all">>>({});
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
        <div className="mt-3 text-sm text-slate-700">
          {data.uniqueStudents ?? "—"} élèves distincts · {data.uniqueTeachers ?? "—"} enseignants distincts
        </div>
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

      {(data.outsideEnabledCycles?.length || 0) > 0 && (
        <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-bold">{data.outsideEnabledCycles?.length} classe(s) hors des cycles autorisés</p>
          <p className="mt-1">
            Ces classes ne sont pas incluses dans les effectifs ci-dessous.
            Le Super Admin doit revoir leur rattachement.
          </p>
          <p className="mt-2">{data.outsideEnabledCycles?.map((c) => c.label).join(", ")}</p>
        </div>
      )}
      {(data.reviewNeeded?.length || 0) > 0 && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <p className="font-bold">{data.reviewNeeded?.length} classe(s) à vérifier</p>
          <p className="mt-1">
            Leur intitulé de niveau n'est pas reconnu automatiquement.
            Un rattachement explicite dans Super Admin évitera un mauvais classement.
          </p>
          <p className="mt-2">{data.reviewNeeded?.map((c) => c.label).join(", ")}</p>
        </div>
      )}

      {shownCycles.map((id) => {
        const cycleName = SCHOOL_CYCLE_OPTIONS.find((option) => option.id === id)?.label || id;
        const classes = data.cycles?.[id]?.classes || [];
        const programs = data.configuration?.teachingTracksByCycle[id] || ["french"];
        const selectedProgram = programForCycle[id] || "all";
        const teachingData = selectedProgram === "all" ? null : data.programs?.[id]?.[selectedProgram];
        return (
          <section key={id} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{cycleName}</h2>
                <p className="mt-1 text-sm text-slate-600">{classes.length} classe(s) · {data.cycles?.[id]?.students ?? "—"} élèves · {data.cycles?.[id]?.teachers ?? "—"} enseignants</p>
              </div>
              <Link href="/admin/classes" className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white">
                Gérer les classes
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2" aria-label={`Enseignement de ${cycleName}`}>
              <button
                type="button"
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${selectedProgram === "all"
                  ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-700"}`}
                onClick={() => setProgramForCycle((current) => ({ ...current, [id]: "all" }))}
              >
                Tous les enseignements
              </button>
              {programs.map((program) => (
                <button
                  key={program}
                  type="button"
                  onClick={() => setProgramForCycle((current) => ({ ...current, [id]: program }))}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${selectedProgram === program
                    ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-700"}`}
                >
                  {TEACHING_TRACK_OPTIONS.find((option) => option.id === program)?.label || program}
                </button>
              ))}
            </div>
            {selectedProgram !== "all" && (
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
                <p className="text-sm font-bold text-sky-900">
                  {teachingData?.uniqueTeachers ?? 0} enseignant(s) affecté(s) aux disciplines classées
                </p>
                {teachingData?.subjects?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {teachingData.subjects.map((subject) => (
                      <span key={subject.id} className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
                        {subject.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-amber-900">
                    Aucune discipline encore classée pour cet enseignement.
                    La configuration se fait dans Super Admin.
                  </p>
                )}
                <p className="mt-3 text-xs text-slate-600">
                  Les classes et les élèves ci-dessous restent communs aux enseignements :
                  ce choix ne crée pas de deuxième inscription.
                </p>
              </div>
            )}
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
