"use client";

import { useCallback, useEffect, useState } from "react";
import type { SchoolCycle, TeachingTrack } from "@/lib/school-cycles";

type SchoolClass = { id: string; label: string; level: string | null; cycle: SchoolCycle };
type Student = {
  id: string;
  name: string;
  matricule: string | null;
  tracks: TeachingTrack[] | null;
};
type Response = {
  ok: boolean;
  academicYear: string;
  revision: string;
  classes: SchoolClass[];
  selectedClassId: string | null;
  availableTracks: TeachingTrack[];
  defaultTracks: TeachingTrack[];
  students: Student[];
  error?: string;
};

const API = "/api/admin/school-student-programs";
const CYCLE_LABEL: Record<SchoolCycle, string> = {
  preschool: "Préscolaire",
  primary: "Primaire",
  secondary: "Secondaire",
};
const programLabel = (track: TeachingTrack) =>
  track === "arabic" ? "Arabe" : "Français";
const code = (tracks: readonly TeachingTrack[]) => [...tracks].sort().join("+");
const options = (available: TeachingTrack[]) => [
  { value: "", label: "Conserver le réglage de la classe", tracks: null },
  ...available.map(track => ({
    value: code([track]), label: programLabel(track), tracks: [track],
  })),
  ...(available.length > 1 ? [{
    value: code(available), label: "Français et arabe", tracks: available,
  }] : []),
];
const labelFor = (tracks: readonly TeachingTrack[]) =>
  tracks.length ? tracks.map(programLabel).join(" + ") : "Non attribué";

export default function SchoolStudentProgramsEditor() {
  const [open, setOpen] = useState(false);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [year, setYear] = useState("");
  const [classId, setClassId] = useState("");
  const [available, setAvailable] = useState<TeachingTrack[]>([]);
  const [defaultTracks, setDefaultTracks] = useState<TeachingTrack[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [overrides, setOverrides] = useState<Record<string, TeachingTrack[] | null>>({});
  const [revision, setRevision] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (selected: string) => {
    setLoading(true);
    setError("");
    try {
      const requestUrl = selected ? `${API}?class_id=${encodeURIComponent(selected)}` : API;
      const response = await fetch(requestUrl, { cache: "no-store" });
      const payload = await response.json() as Response;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Chargement impossible");
      }
      setClasses(payload.classes);
      setYear(payload.academicYear);
      setRevision(payload.revision);
      setClassId(payload.selectedClassId || "");
      setDefaultTracks(payload.defaultTracks);
      setAvailable(payload.availableTracks);
      setStudents(payload.students);
      setOverrides(Object.fromEntries(payload.students.map(row => [row.id, row.tracks])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load("");
  }, [open, load]);

  async function save() {
    if (!classId || !revision || saving) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const nextOverrides = Object.fromEntries(Object.entries(overrides)
        .filter((entry): entry is [string, TeachingTrack[]] => Array.isArray(entry[1]) && !!entry[1].length));
      const response = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, classId, defaultTracks, overrides: nextOverrides }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Enregistrement impossible");
      await load(classId);
      setMessage("Répartition pédagogique enregistrée pour cette classe et cette année scolaire.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <button type="button" className="flex w-full items-center justify-between text-left font-semibold text-slate-900"
        aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span>Répartition des élèves — français et arabe</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <p className="mt-2 text-sm text-slate-600">
        Une seule inscription administrative par élève. Définissez une règle par classe,
        puis uniquement les exceptions individuelles. Aucun enseignement n’est déduit automatiquement.
      </p>

      {open && <div className="mt-5 space-y-4">
        {year && <p className="text-sm font-semibold text-slate-700">Année scolaire active : {year}</p>}
        <label className="block text-sm font-semibold text-slate-800">
          Classe
          <select className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3"
            disabled={loading || saving} value={classId}
            onChange={event => { setMessage(""); void load(event.target.value); }}>
            <option value="">Choisir une classe</option>
            {classes.map(row => <option value={row.id} key={row.id}>
              {CYCLE_LABEL[row.cycle]} — {row.label}
            </option>)}
          </select>
        </label>
        {loading && <p role="status" className="text-sm text-slate-600">Chargement des inscriptions…</p>}
        {!loading && classId && <div className="space-y-4">
          <fieldset className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
            <legend className="px-1 text-sm font-semibold">Enseignements proposés à la classe</legend>
            <div className="mt-2 flex flex-wrap gap-5">
              {available.map(track => (
                <label key={track} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={defaultTracks.includes(track)}
                    onChange={event => setDefaultTracks(old =>
                      event.target.checked ? [...old, track] : old.filter(value => value !== track))}
                  />
                  {programLabel(track)}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-700">
              Réglage par défaut : {labelFor(defaultTracks)}. Sans attribution,
              les élèves ne sont pas comptés comme inscrits à un enseignement.
            </p>
          </fieldset>

          <div className="rounded-xl border border-slate-200">
            <div className="border-b bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
              Exceptions individuelles ({students.length} élève(s) actif(s))
            </div>
            {students.length === 0 ? (
              <p className="p-4 text-sm text-slate-600">Aucun élève inscrit dans cette classe.</p>
            ) : <div className="max-h-[26rem] divide-y overflow-y-auto">
              {students.map(student => (
                <div key={student.id} className="grid gap-2 px-4 py-3 sm:grid-cols-2 sm:items-center">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{student.name}</p>
                    {student.matricule && <p className="text-xs text-slate-500">{student.matricule}</p>}
                  </div>
                  <label className="text-xs font-semibold text-slate-700">
                    Enseignement
                    <select className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                      value={code(overrides[student.id] || [])}
                      onChange={event => {
                        const next = options(available).find(item => item.value === event.target.value);
                        if (next) setOverrides(old => ({ ...old, [student.id]: next.tracks }));
                      }}>
                      {options(available).map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>}
          </div>
          <button type="button" disabled={saving || loading}
            onClick={() => void save()}
            className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "Enregistrement…" : "Enregistrer la répartition"}
          </button>
        </div>}

        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error === "settings_changed_reload_required"
            ? "Les paramètres ont changé ailleurs. Rechargez la classe et réessayez."
            : error}
        </p>}
        {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
      </div>}
    </section>
  );
}
