"use client";

import { useEffect, useState } from "react";
import {
  SCHOOL_CYCLE_OPTIONS,
  type SchoolCycle,
  type TeachingTrack,
  type SchoolCyclesSettings,
} from "@/lib/school-cycles";

type Subject = { id: string; name: string };
type Response = {
  ok?: boolean;
  configuration?: SchoolCyclesSettings;
  subjects?: Subject[];
  error?: string;
  revision?: string;
};

/** All curricular choices belong to the school admin; not platform billing. */
export default function SchoolSubjectProgramsEditor({ onSaved }: { onSaved: () => void }) {
  const [configuration, setConfiguration] = useState<SchoolCyclesSettings | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/admin/bulletin-templates", {
          cache: "no-store", signal: controller.signal,
        });
        const data = await res.json() as Response;
        if (!res.ok || !data.ok || !data.configuration) {
          throw new Error(data.error || "Impossible de charger les disciplines.");
        }
        if (!active) return;
        setConfiguration(data.configuration);
        setRevision(data.revision || "");
        setSubjects(data.subjects || []);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Chargement impossible.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, []);

  function toggle(cycle: SchoolCycle, subjectId: string, track: TeachingTrack) {
    setNotice("");
    setConfiguration(current => {
      if (!current) return current;
      const perCycle = { ...current.subjectTracksByCycle[cycle] };
      const oldTracks = perCycle[subjectId] || [];
      const next = oldTracks.includes(track)
        ? oldTracks.filter(t => t !== track) : [...oldTracks, track];
      if (next.length) perCycle[subjectId] = next;
      else delete perCycle[subjectId];
      return {
        ...current,
        subjectTracksByCycle: {
          ...current.subjectTracksByCycle, [cycle]: perCycle,
        },
      };
    });
  }

  async function save() {
    if (!configuration || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/bulletin-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision,
          subjectTracksByCycle: configuration.subjectTracksByCycle,
        }),
      });
      const data = await response.json() as Response;
      if (!response.ok || !data.ok || !data.configuration) {
        throw new Error(data.error || "Impossible d'enregistrer les disciplines.");
      }
      setConfiguration(data.configuration);
      setRevision(data.revision || "");
      setNotice("Disciplines de l'établissement enregistrées.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="rounded-xl border bg-white p-4">Chargement des matières…</p>;
  if (!configuration?.enabled) return null;
  const isBilingual = configuration.enabledCycles.some(cycle =>
    configuration.teachingTracksByCycle[cycle]?.includes("arabic"));

  return <section className="rounded-2xl border bg-white p-5 shadow-sm">
    <h2 className="text-xl font-bold text-slate-900">Matières proposées par votre établissement</h2>
    <p className="mt-2 text-sm text-slate-600">
      Activez les disciplines réellement enseignées dans chaque cycle.
      Pour une école franco-arabe, choisissez également l’enseignement concerné.
      Les matières et coefficients seront ensuite précisés par niveau dans les paramètres du bulletin.
    </p>
    {!subjects.length && (
      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
        Aucun enseignement ne peut être configuré tant qu’aucune discipline n’est activée dans votre établissement.
      </p>
    )}
    <div className="mt-4 space-y-4">
      {configuration.enabledCycles.map(cycle => {
        const tracks = configuration.teachingTracksByCycle[cycle] || ["french"];
        return <section key={cycle} className="rounded-xl border p-4">
          <h3 className="font-semibold">
            {SCHOOL_CYCLE_OPTIONS.find(option => option.id === cycle)?.label || cycle}
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {subjects.map(subject => (
              <div key={subject.id} className="rounded-lg bg-slate-50 p-3">
                <p className="text-sm font-medium">{subject.name}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {tracks.map(track => <label key={track} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" disabled={saving}
                      checked={(configuration.subjectTracksByCycle[cycle]?.[subject.id] || []).includes(track)}
                      onChange={() => toggle(cycle, subject.id, track)}/>
                    {!isBilingual ? "Enseignée" : track === "french" ? "Français" : "Arabe"}
                  </label>)}
                </div>
              </div>
            ))}
          </div>
        </section>;
      })}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
    <button type="button" onClick={() => void save()} disabled={saving || !subjects.length}
      className="mt-4 rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-50">
      {saving ? "Enregistrement…" : "Enregistrer les matières"}
    </button>
  </section>;
}
