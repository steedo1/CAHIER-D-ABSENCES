"use client";

import { useEffect, useMemo, useState } from "react";
import { parseAverage20 } from "@/lib/grades/direct-subject-averages";

type Component = { id: string; label: string; coeff_in_subject: number };
type Row = {
  student_id: string; full_name: string; matricule: string | null;
  average: number | null; component_averages?: Record<string, number>;
};
type Response = { ok: boolean; items?: Row[]; components?: Component[]; error?: string };
const valueOf = (text: string) => text.trim() === "" ? null : parseAverage20(text);
const cellKey = (studentId: string, componentId: string) => studentId + "__" + componentId;
const formatted = (value: number | null | undefined) => value === null || value === undefined ? "" : String(value).replace(".", ",");

export default function DirectSubjectAverages({ classId, subjectId, periodId, onDirtyChange, onSavingChange }: {
  classId: string; subjectId: string; periodId: string;
  onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [componentDraft, setComponentDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const withComponents = components.length > 0;
  const changed = useMemo(() => rows.filter(row => {
    if (withComponents) return components.some(comp => {
      const text = componentDraft[cellKey(row.student_id, comp.id)] ?? "";
      const val = valueOf(text);
      return val !== (row.component_averages?.[comp.id] ?? null) || (text.trim() !== "" && val === null);
    });
    const text = draft[row.student_id] ?? "";
    const val = valueOf(text);
    return val !== row.average || (text.trim() !== "" && val === null);
  }), [rows, draft, componentDraft, components, withComponents]);
  const dirty = changed.length > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onSavingChange(saving); }, [saving, onSavingChange]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setNotice(null); setRows([]); setComponents([]); setDraft({}); setComponentDraft({});
    const params = new URLSearchParams({ class_id: classId, subject_id: subjectId, grading_period_id: periodId });
    fetch("/api/admin/grades/direct-averages?" + params, { cache: "no-store", signal: controller.signal })
      .then(async res => {
        const data = await res.json() as Response;
        if (!res.ok || !data.ok) throw new Error(data.error || "Chargement impossible.");
        return data;
      })
      .then(data => {
        const items = data.items || [];
        const list = data.components || [];
        setRows(items); setComponents(list);
        setDraft(Object.fromEntries(items.map(row => [row.student_id, formatted(row.average)])));
        setComponentDraft(Object.fromEntries(items.flatMap(row =>
          list.map(comp => [cellKey(row.student_id, comp.id), formatted(row.component_averages?.[comp.id])]))));
      })
      .catch(err => { if (!controller.signal.aborted) setError(err.message || "Chargement impossible."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); onDirtyChange(false); onSavingChange(false); };
  }, [classId, subjectId, periodId, onDirtyChange, onSavingChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || saving) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  function reset() {
    setDraft(Object.fromEntries(rows.map(row => [row.student_id, formatted(row.average)])));
    setComponentDraft(Object.fromEntries(rows.flatMap(row =>
      components.map(comp => [cellKey(row.student_id, comp.id), formatted(row.component_averages?.[comp.id])]))));
    setError(null); setNotice(null);
  }

  function preview(row: Row): string {
    let sum = 0, weight = 0;
    for (const c of components) {
      const raw = componentDraft[cellKey(row.student_id, c.id)] ?? "";
      const avg = valueOf(raw);
      if (avg !== null && c.coeff_in_subject > 0) {
        sum += avg * c.coeff_in_subject; weight += c.coeff_in_subject;
      }
    }
    return weight ? (sum / weight).toFixed(2).replace(".", ",") : "—";
  }

  async function save() {
    setError(null); setNotice(null);
    const invalid = withComponents
      ? changed.some(row => components.some(comp => {
          const raw = componentDraft[cellKey(row.student_id, comp.id)] ?? "";
          return raw.trim() !== "" && valueOf(raw) === null;
        }))
      : changed.some(row => (draft[row.student_id] ?? "").trim() !== "" && valueOf(draft[row.student_id]) === null);
    if (invalid) {
      setError("Les moyennes doivent être comprises entre 0 et 20, avec deux décimales au maximum."); return;
    }
    const items = changed.map(row => withComponents
      ? {
          student_id: row.student_id,
          components: Object.fromEntries(components.map(comp => [
            comp.id, valueOf(componentDraft[cellKey(row.student_id, comp.id)] ?? ""),
          ])),
        }
      : { student_id: row.student_id, average: valueOf(draft[row.student_id] ?? "") });
    setSaving(true);
    try {
      const res = await fetch("/api/admin/grades/direct-averages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_id: classId, subject_id: subjectId, grading_period_id: periodId, items }),
      });
      const data = await res.json();
      const saved = new Set<string>(data.saved || []);
      setRows(previous => previous.map(row => {
        if (!saved.has(row.student_id)) return row;
        if (withComponents) {
          const item = items.find(item => item.student_id === row.student_id);
          const component_averages = "components" in (item || {}) ? (item as { components: Record<string, number | null> }).components : {};
          return { ...row, average: null,
            component_averages: Object.fromEntries(Object.entries(component_averages).filter(([, val]) => val !== null)) as Record<string, number> };
        }
        return { ...row, average: valueOf(draft[row.student_id] ?? ""), component_averages: {} };
      }));
      if (!res.ok || !data.ok)
        throw new Error((data.error || "Enregistrement impossible.") + (saved.size ? " " + saved.size + " ligne(s) enregistrée(s) ; les autres restent à saisir." : ""));
      setNotice(withComponents ? "Sous-matières enregistrées pour ce trimestre." : "Moyennes enregistrées.");
    } catch (err: any) {
      setError(err.message || "Enregistrement impossible. Vos saisies sont conservées.");
    } finally { setSaving(false); }
  }

  return <section className="rounded-2xl border bg-white p-5 shadow-sm" aria-label="Saisie directe des moyennes">
    <h2 className="font-semibold text-slate-900">{withComponents ? "Moyennes des sous-matières — sur 20" : "Moyennes transmises par le professeur — sur 20"}</h2>
    {withComponents
      ? <p className="mt-1 text-sm text-slate-600">La moyenne de la matière est calculée selon les coefficients affichés. Une case vide conserve le calcul à partir des notes existantes, si elles sont disponibles.</p>
      : <p className="mt-1 text-sm text-slate-600">La moyenne saisie devient la moyenne finale de la matière pour ce trimestre. Videz une moyenne et enregistrez pour rétablir le calcul à partir des notes.</p>}
    {withComponents && rows.some(r => r.average !== null) &&
      <p className="mt-2 text-xs text-amber-700">Une moyenne globale avait déjà été saisie pour certains élèves. Elle sera remplacée pour ces élèves lorsque leurs sous-matières seront enregistrées.</p>}
    {error && <p role="alert" className="my-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="my-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {loading ? <p className="mt-4">Chargement des élèves…</p> : <>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-max w-full text-sm">
          <thead><tr className="bg-slate-50 text-left">
            <th className="p-3">Élève</th><th className="p-3">Matricule</th>
            {withComponents ? <>
              {components.map(comp => <th className="p-3" key={comp.id}>{comp.label} <span className="font-normal">(coef. {comp.coeff_in_subject})</span></th>)}
              <th className="p-3">Français /20</th>
            </> : <><th className="p-3">Moyenne /20</th><th className="p-3">Source enregistrée</th></>}
          </tr></thead>
          <tbody>{rows.map(row => <tr key={row.student_id} className="border-t">
            <td className="p-3 font-medium">{row.full_name}</td>
            <td className="p-3">{row.matricule || "—"}</td>
            {withComponents ? <>
              {components.map(comp => <td className="p-3" key={comp.id}>
                <input aria-label={comp.label + " de " + row.full_name} inputMode="decimal" maxLength={5}
                  value={componentDraft[cellKey(row.student_id, comp.id)] ?? ""} disabled={saving}
                  onChange={event => {
                    setComponentDraft(previous => ({ ...previous, [cellKey(row.student_id, comp.id)]: event.target.value }));
                    setNotice(null);
                  }} placeholder="Ex. 12,50" className="w-24 rounded-lg border p-2" />
              </td>)}
              <td className="p-3 font-semibold">{preview(row)}</td>
            </> : <>
              <td className="p-3"><input aria-label={"Moyenne de " + row.full_name} inputMode="decimal" maxLength={5}
                value={draft[row.student_id] ?? ""} disabled={saving}
                onChange={event => { setDraft(previous => ({ ...previous, [row.student_id]: event.target.value })); setNotice(null); }}
                placeholder="Ex. 12,50" className="w-28 rounded-lg border p-2" /></td>
              <td className="p-3 text-slate-500">{row.average === null ? "Calcul à partir des notes" : "Moyenne saisie"}</td>
            </>}
          </tr>)}</tbody>
        </table>
      </div>
      {!rows.length && !error && <p className="p-3 text-sm">Aucun élève dans cette classe.</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={() => void save()} disabled={!dirty || saving}
          className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {saving ? "Enregistrement…" : "Enregistrer les moyennes"}
        </button>
        <button type="button" disabled={!dirty || saving} onClick={reset}
          className="rounded-xl border px-4 py-2 disabled:opacity-50">Annuler les modifications</button>
      </div>
      {dirty && <p className="mt-2 text-xs text-amber-700">Enregistrez ou annulez les modifications avant de changer de classe, matière ou trimestre.</p>}
    </>}
  </section>;
}
