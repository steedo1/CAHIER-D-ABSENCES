"use client";

import { useEffect, useMemo, useState } from "react";
import { parseAverage20, weightedDirectComponentAverage } from "@/lib/grades/direct-subject-averages";

type Component = { id: string; label: string; coeff: number };
type Row = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  average: number | null;
  component_averages: Record<string, number>;
};
type Response = { ok: boolean; error?: string; components?: Component[]; items?: Row[];
  saved?: string[]; values?: Array<Pick<Row, "student_id" | "average" | "component_averages">> };

const asText = (value: number | null | undefined) => value === null || value === undefined
  ? "" : String(value).replace(".", ",");
const parsed = (value: string) => value.trim() === "" ? null : parseAverage20(value);

export default function DirectSubjectAverages({ classId, subjectId, periodId, onDirtyChange, onSavingChange }: {
  classId: string; subjectId: string; periodId: string;
  onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [componentDraft, setComponentDraft] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasComponents = components.length > 0;
  const changed = useMemo(() => rows.filter(row => hasComponents
    ? components.some(comp => {
        const text = componentDraft[row.student_id]?.[comp.id] ?? "";
        return parsed(text) !== (row.component_averages?.[comp.id] ?? null) ||
          (text.trim() !== "" && parseAverage20(text) === null);
      })
    : (() => {
        const text = draft[row.student_id] ?? "";
        return parsed(text) !== row.average ||
          (text.trim() !== "" && parseAverage20(text) === null);
      })()), [rows, components, hasComponents, draft, componentDraft]);
  const dirty = changed.length > 0;

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onSavingChange(saving); }, [saving, onSavingChange]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setNotice(null);
    setRows([]);
    setComponents([]);
    const params = new URLSearchParams({ class_id: classId, subject_id: subjectId, grading_period_id: periodId });
    fetch("/api/admin/grades/direct-averages?" + params.toString(), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json() as Response;
        if (!response.ok || !data.ok) throw new Error(data.error || "Chargement impossible.");
        return data;
      })
      .then(data => {
        const items = data.items || [];
        const available = data.components || [];
        setRows(items);
        setComponents(available);
        setDraft(Object.fromEntries(items.map(row => [row.student_id, asText(row.average)])));
        setComponentDraft(Object.fromEntries(items.map(row => [row.student_id,
          Object.fromEntries(available.map(comp => [comp.id, asText(row.component_averages?.[comp.id])]))])));
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

  const valid = !changed.some(row => hasComponents
    ? components.some(comp => {
        const text = componentDraft[row.student_id]?.[comp.id] || "";
        return text.trim() !== "" && parseAverage20(text) === null;
      })
    : (draft[row.student_id] || "").trim() !== "" && parseAverage20(draft[row.student_id]) === null);

  const reset = () => {
    setDraft(Object.fromEntries(rows.map(row => [row.student_id, asText(row.average)])));
    setComponentDraft(Object.fromEntries(rows.map(row => [row.student_id,
      Object.fromEntries(components.map(comp => [comp.id, asText(row.component_averages?.[comp.id])]))])));
    setError(null);
    setNotice(null);
  };

  async function save() {
    if (!valid) { setError("Saisissez uniquement des moyennes de 0 à 20, avec au plus deux décimales."); return; }
    setError(null);
    setNotice(null);
    const items = changed.map(row => hasComponents ? {
      student_id: row.student_id,
      components: Object.fromEntries(components.map(comp =>
        [comp.id, parsed(componentDraft[row.student_id]?.[comp.id] || "")])),
    } : { student_id: row.student_id, average: parsed(draft[row.student_id] || "") });
    setSaving(true);
    try {
      const response = await fetch("/api/admin/grades/direct-averages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_id: classId, subject_id: subjectId, grading_period_id: periodId, items }),
      });
      const data = await response.json() as Response;
      const saved = new Set(data.saved || []);
      const savedValues = new Map((data.values || []).map(row => [row.student_id, row]));
      // Compatibilité avec les anciennes réponses GET/POST des environnements de test.
      const submitted = new Map(items.map(row => [row.student_id, row]));
      setRows(previous => previous.map(row => {
        if (!saved.has(row.student_id)) return row;
        const item = savedValues.get(row.student_id);
        if (item) return { ...row, average: item.average, component_averages: item.component_averages || {} };
        const input = submitted.get(row.student_id);
        if (!input) return row;
        if ("components" in input) {
          const values = input.components || {};
          const comps = components.map(comp => ({ id: comp.id, coeff: comp.coeff, average: values[comp.id] }));
          return { ...row, average: weightedDirectComponentAverage(comps),
            component_averages: Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null)) as Record<string, number> };
        }
        return { ...row, average: input.average };
      }));
      if (!response.ok || !data.ok)
        throw new Error((data.error || "Enregistrement impossible.") +
          (saved.size ? " " + saved.size + " ligne(s) enregistrée(s) ; les autres restent à saisir." : ""));
      setNotice("Moyennes enregistrées. Les bulletins et les classements utilisent les valeurs officielles.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible. Vos saisies sont conservées.");
    } finally { setSaving(false); }
  }

  return <section className="rounded-2xl border bg-white p-5 shadow-sm" aria-label="Saisie directe des moyennes">
    <h2 className="font-semibold text-slate-900">
      {hasComponents ? "Moyennes des sous-matières — sur 20" : "Moyennes transmises par le professeur — sur 20"}
    </h2>
    <p className="mt-1 text-sm text-slate-600">
      {hasComponents
        ? "Renseignez les sous-matières du Français : Mon Cahier calcule la moyenne pondérée selon les coefficients configurés. Les notes existantes restent intactes. Vider les champs rétablit le calcul habituel."
        : "La moyenne saisie devient la moyenne finale de la matière pour ce trimestre. Les notes de devoirs sont conservées. Videz une moyenne puis enregistrez pour rétablir le calcul à partir des notes."}
    </p>
    {error && <p role="alert" className="my-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="my-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {loading ? <p className="mt-4">Chargement des élèves…</p> : <>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-left">
            <th className="p-3">Élève</th>
            <th className="p-3">Matricule</th>
            {hasComponents ? <>
              {components.map(comp => <th key={comp.id} className="p-3 min-w-[135px]">
                {comp.label}<span className="block font-normal text-slate-500">Coeff. {comp.coeff}</span>
              </th>)}
              <th className="p-3">Moyenne de Français /20</th>
            </> : <>
              <th className="p-3">Moyenne /20</th><th className="p-3">Source enregistrée</th>
            </>}
          </tr></thead>
          <tbody>{rows.map(row => {
            const items = components.map(comp => ({
              id: comp.id, coeff: comp.coeff,
              average: parsed(componentDraft[row.student_id]?.[comp.id] || ""),
            }));
            const computed = hasComponents && valid
              ? weightedDirectComponentAverage(items) : null;
            return <tr key={row.student_id} className="border-t">
              <td className="p-3 font-medium">{row.full_name}</td>
              <td className="p-3">{row.matricule || "—"}</td>
              {hasComponents ? <>
                {components.map(comp => <td key={comp.id} className="p-2">
                  <input aria-label={comp.label + " de " + row.full_name} inputMode="decimal"
                    value={componentDraft[row.student_id]?.[comp.id] ?? ""} disabled={saving}
                    onChange={event => {
                      setComponentDraft(prev => ({ ...prev, [row.student_id]: {
                        ...(prev[row.student_id] || {}), [comp.id]: event.target.value,
                      } }));
                      setNotice(null);
                    }} placeholder="Ex. 12,50"
                    className="w-24 rounded-lg border p-2" />
                </td>)}
                <td className="p-3 font-semibold">
                  {computed === null ? (row.average === null ? "—" : asText(row.average)) : asText(computed)}
                </td>
              </> : <>
                <td className="p-3">
                  <input aria-label={"Moyenne de " + row.full_name} inputMode="decimal"
                    value={draft[row.student_id] ?? ""} disabled={saving}
                    onChange={event => { setDraft(prev => ({ ...prev, [row.student_id]: event.target.value })); setNotice(null); }}
                    placeholder="Ex. 12,50" className="w-28 rounded-lg border p-2" />
                </td>
                <td className="p-3 text-slate-500">{row.average === null ? "Calcul à partir des notes" : "Moyenne saisie"}</td>
              </>}
            </tr>;
          })}</tbody>
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
      {dirty && <p className="mt-2 text-xs text-amber-700">
        Enregistrez ou annulez vos modifications avant de changer de classe, matière ou trimestre.
      </p>}
    </>}
  </section>;
}
