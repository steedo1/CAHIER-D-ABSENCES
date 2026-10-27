"use client";

import { useEffect, useState } from "react";
import { parseAverage20 } from "@/lib/grades/direct-subject-averages";

type Row = { student_id: string; full_name: string; matricule: string | null; average: number | null;
  component_averages?: Record<string, number> };
type Component = { id: string; label: string; coeff: number };
const draftComponents = (items: Row[], comps: Component[]) => Object.fromEntries(items.map(row =>
  [row.student_id, Object.fromEntries(comps.map(comp =>
    [comp.id, row.component_averages?.[comp.id] === undefined ? "" :
      String(row.component_averages[comp.id]).replace(".", ",")]))]));
export default function DirectSubjectAverages({ classId, subjectId, periodId, onDirtyChange, onSavingChange }: {
  classId: string; subjectId: string; periodId: string;
  onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [componentDraft, setComponentDraft] = useState<Record<string, Record<string, string>>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const changed = rows.filter(row => {
    if (components.length) return components.some(comp => {
      const text = componentDraft[row.student_id]?.[comp.id] ?? "";
      const parsed = text.trim() === "" ? null : parseAverage20(text);
      return parsed !== (row.component_averages?.[comp.id] ?? null) ||
        (text.trim() !== "" && parsed === null);
    });
    const text = draft[row.student_id] ?? "";
    return (text.trim() === "" ? null : parseAverage20(text)) !== row.average || (text.trim() !== "" && parseAverage20(text) === null);
  });
  const dirty = changed.length > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onSavingChange(saving); }, [saving, onSavingChange]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ class_id: classId, subject_id: subjectId, grading_period_id: periodId });
    fetch(`/api/admin/grades/direct-averages?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async res => {
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error);
        return { items: data.items as Row[], components: (data.components || []) as Component[] };
      })
      .then(({ items, components: parts }) => {
        setRows(items); setComponents(parts); setComponentDraft(draftComponents(items, parts));
        setDraft(Object.fromEntries(items.map(row => [row.student_id, row.average === null ? "" : String(row.average).replace(".", ",")]));
      })
      .catch(err => { if (!controller.signal.aborted) setError(err.message || "Chargement impossible."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); onDirtyChange(false); onSavingChange(false); };
  }, [classId, subjectId, periodId, onDirtyChange, onSavingChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || saving) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  async function save() {
    setError(null); setNotice(null);
    const invalid = components.length ? changed.some(row => components.some(comp => {
      const value = componentDraft[row.student_id]?.[comp.id] || "";
      return value.trim() !== "" && parseAverage20(value) === null;
    })) : changed.some(row => draft[row.student_id].trim() !== "" && parseAverage20(draft[row.student_id]) === null);
    if (invalid) {
      setError("Saisissez des moyennes comprises entre 0 et 20, avec deux décimales au maximum."); return;
    }
    const items = changed.map(row => components.length
      ? { student_id: row.student_id, component_averages: Object.fromEntries(
          components.filter(comp => {
            const text = componentDraft[row.student_id]?.[comp.id] || "";
            return (text.trim() ? parseAverage20(text) : null) !== (row.component_averages?.[comp.id] ?? null);
          }).map(comp => {
            const text = componentDraft[row.student_id]?.[comp.id] || "";
            return [comp.id, text.trim() ? parseAverage20(text) : null];
          })) }
      : { student_id: row.student_id, average: draft[row.student_id].trim() === "" ? null : parseAverage20(draft[row.student_id]) });
    setSaving(true);
    try {
      const res = await fetch("/api/admin/grades/direct-averages", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_id: classId, subject_id: subjectId, grading_period_id: periodId, items }) });
      const data = await res.json();
      const saved = new Set<string>(data.saved || []);
      setRows(previous => previous.map(row => {
        if (!saved.has(row.student_id)) return row;
        const item = items.find(it => it.student_id === row.student_id)!;
        if ("component_averages" in item && item.component_averages) {
          const updated = { ...(row.component_averages || {}) };
          for (const [id, value] of Object.entries(item.component_averages))
            if (value === null) delete updated[id];
            else updated[id] = value;
          return { ...row, component_averages: updated };
        }
        return { ...row, average: item.average };
      }));
      if (!res.ok || !data.ok) throw new Error(`${data.error || "Enregistrement impossible."}${saved.size ? ` ${saved.size} ligne(s) enregistrée(s) ; les autres restent à saisir.` : ""}`);
      setNotice("Moyennes enregistrées. Les bulletins et les classements utilisent ces valeurs.");
    } catch (err: any) { setError(err.message || "Enregistrement impossible. Vos saisies sont conservées."); }
    finally { setSaving(false); }
  }

  return <section className="rounded-2xl border bg-white p-5 shadow-sm" aria-label="Saisie directe des moyennes">
    <h2 className="font-semibold text-slate-900">{components.length
      ? "Moyennes de Français par sous-matière — sur 20"
      : "Moyennes transmises par le professeur — sur 20"}</h2>
    <p className="mt-1 text-sm text-slate-600">{components.length
      ? "Saisissez les moyennes de Composition française, Expression orale et Orthographe-Grammaire selon le programme de la classe. La moyenne de Français utilise leurs coefficients officiels. Une case vide conserve le calcul des devoirs éventuels ; elle n'est jamais un zéro."
      : "La moyenne saisie devient la moyenne finale de la matière pour ce trimestre. Les notes de devoirs sont conservées. Videz une moyenne puis enregistrez pour rétablir le calcul à partir des notes."}</p>
    {error && <p role="alert" className="my-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="my-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {loading ? <p className="mt-4">Chargement des élèves…</p> : <>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 text-left"><th className="p-3">Élève</th><th className="p-3">Matricule</th>{components.length ? components.map(comp => (
          <th key={comp.id} className="p-3">{comp.label} /20 <span className="text-xs text-slate-500">(coeff. {comp.coeff})</span></th>
        )) : <th className="p-3">Moyenne /20</th>}
        <th className="p-3">Source enregistrée</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.student_id} className="border-t"><td className="p-3 font-medium">{row.full_name}</td><td className="p-3">{row.matricule || "—"}</td>{components.length ? components.map(comp => (
          <td key={comp.id} className="p-3">
            <input aria-label={`${comp.label} de ${row.full_name}`} inputMode="decimal" className="w-28 rounded-lg border p-2"
              value={componentDraft[row.student_id]?.[comp.id] ?? ""} placeholder="Ex. 12,50" disabled={saving}
              onChange={event => { setComponentDraft(previous => ({
                ...previous, [row.student_id]: { ...(previous[row.student_id] || {}), [comp.id]: event.target.value },
              })); setNotice(null); }} />
          </td>
        )) : <td className="p-3">
          <input aria-label={`Moyenne de ${row.full_name}`} inputMode="decimal" value={draft[row.student_id] ?? ""} disabled={saving}
            onChange={event => { setDraft(previous => ({ ...previous, [row.student_id]: event.target.value })); setNotice(null); }} placeholder="Ex. 12,50" className="w-28 rounded-lg border p-2" />
        </td>}
        <td className="p-3 text-slate-500">{components.length
          ? Object.keys(row.component_averages || {}).length ? "Sous-moyennes enregistrées" : "Calcul à partir des notes"
          : row.average === null ? "Calcul à partir des notes" : "Moyenne saisie"}</td></tr>)}</tbody></table></div>
      {!rows.length && !error && <p className="p-3 text-sm">Aucun élève dans cette classe.</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={save} disabled={!dirty || saving} className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{saving ? "Enregistrement…" : "Enregistrer les moyennes"}</button>
        <button type="button" disabled={!dirty || saving} onClick={() => {
          setDraft(Object.fromEntries(rows.map(row => [row.student_id, row.average === null ? "" : String(row.average).replace(".", ",")])));
          setComponentDraft(draftComponents(rows, components)); setError(null);
        }} className="rounded-xl border px-4 py-2 disabled:opacity-50">Annuler les modifications</button>
      </div>
      {dirty && <p className="mt-2 text-xs text-amber-700">Enregistrez ou annulez vos modifications avant de changer de classe, matière ou trimestre.</p>}
    </>}
  </section>;
}
