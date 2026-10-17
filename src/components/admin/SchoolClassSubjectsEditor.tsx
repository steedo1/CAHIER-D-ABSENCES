"use client";

import { useCallback, useEffect, useState } from "react";

type ClassRow = { id: string; label: string; level: string | null;
  cycle: "primary" | "secondary" | "preschool" | null; track: "french" | "arabic" | null };
type Subject = { id: string; name: string };
type ApiResponse = {
  ok?: boolean; error?: string; academicYear?: string; revision?: string;
  classes?: ClassRow[]; selectedClassId?: string | null; subjects?: Subject[];
  selectedSubjectIds?: string[];
};
const endpoint = "/api/admin/school-class-subjects";

export default function SchoolClassSubjectsEditor() {
  const [open, setOpen] = useState(false);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState("");
  const [year, setYear] = useState("");
  const [revision, setRevision] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async (nextClassId: string) => {
    setLoading(true); setError("");
    try {
      const uri = nextClassId ? endpoint + "?class_id=" + encodeURIComponent(nextClassId) : endpoint;
      const response = await fetch(uri, { cache: "no-store" });
      const data = await response.json() as ApiResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "Chargement impossible");
      setClasses(data.classes || []); setYear(data.academicYear || "");
      setClassId(data.selectedClassId || "");
      setSubjects(data.subjects || []); setSelected(data.selectedSubjectIds || []);
      setRevision(data.revision || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (open) void load(""); }, [open, load]);

  async function save() {
    if (!classId || !revision || loading || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, subjectIds: selected, revision }),
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "Enregistrement impossible");
      await load(classId);
      setNotice("Matières de la classe enregistrées pour l'année scolaire active.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }
  const current = classes.find(row => row.id === classId);
  return <section className="rounded-2xl border border-slate-200 bg-white p-5">
    <button type="button" aria-expanded={open} onClick={() => setOpen(prev => !prev)}
      className="flex w-full items-center justify-between text-left font-semibold text-slate-900">
      <span>Matières par classe — enseignement français / arabe</span>
      <span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    <p className="mt-2 text-sm text-slate-600">
      Affectez les matières du catalogue actif à chaque classe de chaque enseignement.
      Un cycle peut contenir plusieurs niveaux avec des matières différentes.
      Les coefficients et barèmes se règlent séparément, sans valeur inventée.
    </p>
    {open && <div className="mt-4 space-y-4">
      {year && <p className="text-sm font-semibold text-slate-700">Année scolaire : {year}</p>}
      <label className="block text-sm font-medium text-slate-800">
        Classe et enseignement
        <select className="mt-1 block w-full rounded-xl border border-slate-300 p-3"
          value={classId} disabled={loading || saving}
          onChange={event => { setNotice(""); void load(event.target.value); }}>
          <option value="">Choisir une classe</option>
          {classes.map(row => <option key={row.id} value={row.id}>
            {row.label} — {row.track === "arabic" ? "Arabe" : row.track === "french" ? "Français" : "À configurer"}
          </option>)}
        </select>
      </label>
      {loading && <p role="status" className="text-sm text-slate-600">Chargement des matières…</p>}
      {!loading && current && !current.track && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
        Définissez d'abord l'enseignement de cette classe dans « Répartition des élèves ».
      </p>}
      {!loading && current?.track && <>
        {subjects.length === 0 ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Aucune matière active n'est encore associée à cet enseignement pour ce cycle.
          Configurez d'abord « Répartition des matières entre les enseignements et les cycles ».
        </p> : <>
          <p className="text-sm text-slate-700">{selected.length} matière(s) sélectionnée(s) sur {subjects.length} proposée(s).</p>
          <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
            {subjects.map(subject => <label key={subject.id}
              className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm">
              <input type="checkbox" className="mt-1" checked={selected.includes(subject.id)}
                onChange={event => setSelected(old => event.target.checked
                  ? [...old, subject.id] : old.filter(id => id !== subject.id))}/>
              <span>{subject.name}</span>
            </label>)}
          </div>
        </>}
        <button type="button" disabled={saving || loading} onClick={() => void save()}
          className="rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? "Enregistrement…" : "Enregistrer les matières de la classe"}
        </button>
      </>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
        {error === "settings_changed_reload_required"
          ? "Configuration modifiée ailleurs : rechargez la classe, puis réessayez." : error}
      </p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    </div>}
  </section>;
}
