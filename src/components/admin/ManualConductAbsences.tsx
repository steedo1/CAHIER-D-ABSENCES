"use client";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ASSIDUITY_RULES, parseAbsenceHours, parseSanctionPoints, previewManualConduct, type AssiduityRules, type ManualConductItem } from "@/lib/manual-conduct-absences";
type Props = {
  classId: string; academicYear: string; periodCode: string; from: string; to: string;
  onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
};
const format = (n: number) => n.toFixed(2).replace(".", ",");
const initialValue = (item: ManualConductItem) => item.manual_absence_hours === null || item.manual_absence_hours === undefined ? "" : String(item.manual_absence_hours).replace(".", ",");
const initialSanctions = (item: ManualConductItem) => String(item.manual_sanction_points ?? 0).replace(".", ",");
export default function ManualConductAbsences({ classId, academicYear, periodCode, from, to, onDirtyChange, onSavingChange }: Props) {
  const [items, setItems] = useState<ManualConductItem[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sanctions, setSanctions] = useState<Record<string, string>>({});
  const [rules, setRules] = useState<AssiduityRules>(DEFAULT_ASSIDUITY_RULES);
  const [maxes, setMaxes] = useState({ assiduite: 6, tenue: 3, moralite: 4, discipline: 7 });
  const [totalMax, setTotalMax] = useState(20);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const changed = useMemo(() => items.filter(item =>
    (values[item.student_id] ?? "") !== initialValue(item) ||
    (sanctions[item.student_id] ?? "0") !== initialSanctions(item)), [items, values, sanctions]);
  useEffect(() => { onDirtyChange(changed.length > 0); }, [changed.length, onDirtyChange]);
  useEffect(() => { onSavingChange(saving); }, [saving, onSavingChange]);
  useEffect(() => () => { onDirtyChange(false); onSavingChange(false); }, [onDirtyChange, onSavingChange]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setLoading(true); setError(null);
    const query = new URLSearchParams({ class_id: classId, academic_year: academicYear, period_code: periodCode });
    if (from) query.set("from", from); if (to) query.set("to", to);
    void fetch(`/api/admin/conduite/averages?${query}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Impossible de charger les élèves.");
      if (controller.signal.aborted) return;
      const rows: ManualConductItem[] = (data.items || []).sort((a: ManualConductItem, b: ManualConductItem) => a.full_name.localeCompare(b.full_name, "fr", { numeric: true, sensitivity: "base" }));
      setItems(rows); setValues(Object.fromEntries(rows.map(item => [item.student_id, initialValue(item)])));
      setSanctions(Object.fromEntries(rows.map(item => [item.student_id, initialSanctions(item)])));
      setRules(data.assiduite_rules || DEFAULT_ASSIDUITY_RULES);
      setMaxes(data.rubric_max || { assiduite: 6, tenue: 3, moralite: 4, discipline: 7 });
      setTotalMax(Number(data.total_max) || 20);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Chargement impossible.");
    }).finally(() => { window.clearTimeout(timeout); if (!controller.signal.aborted) setLoading(false); });
    // A timeout is visible; navigation cancels silently.
    const timedOut = () => { setLoading(false); setError("Le chargement prend trop de temps. Réessayez."); };
    controller.signal.addEventListener("abort", timedOut, { once: true });
    return () => { controller.signal.removeEventListener("abort", timedOut); window.clearTimeout(timeout); controller.abort(); };
  }, [classId, academicYear, periodCode, from, to, reload]);
  useEffect(() => {
    if (!changed.length) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [changed.length]);
  async function save() {
    const entries = changed.map(item => ({ student_id: item.student_id,
      ...((values[item.student_id] ?? "") !== initialValue(item) ? { absence_hours: parseAbsenceHours(values[item.student_id]) } : {}),
      ...((sanctions[item.student_id] ?? "0") !== initialSanctions(item) ? { sanction_points: parseSanctionPoints(sanctions[item.student_id]) } : {}),
    }));
    if (entries.some(item => item.absence_hours === null || item.sanction_points === null)) {
      setError("Saisissez des heures valides et des sanctions entre 0 et 20 points. Indiquez 0 pour aucune absence ou sanction."); return;
    }
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/admin/conduite/manual-absences", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ class_id: classId, academic_year: academicYear, period_code: periodCode, items: entries }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Impossible d’enregistrer les absences.");
      setMessage(`${entries.length} élève${entries.length > 1 ? "s" : ""} enregistré${entries.length > 1 ? "s" : ""}. La conduite est recalculée automatiquement.`);
      setItems(current => current.map(item => {
        const entry = entries.find(e => e.student_id === item.student_id);
        return entry ? { ...item,
          ...(entry.absence_hours === undefined ? {} : { manual_absence_hours: entry.absence_hours! }),
          ...(entry.sanction_points === undefined ? {} : { manual_sanction_points: entry.sanction_points! }),
        } : item;
      }));
      setValues(current => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, entries.some(e => e.student_id === id && e.absence_hours !== undefined) ? String(parseAbsenceHours(value)).replace(".", ",") : value])));
      setSanctions(current => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, entries.some(e => e.student_id === id && e.sanction_points !== undefined) ? String(parseSanctionPoints(value)).replace(".", ",") : value])));
      setReload(n => n + 1);
    } catch (error) { setError(error instanceof Error ? error.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }
  return <section className="rounded-2xl border bg-white p-5" aria-label="Saisie des absences et sanctions">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Absences et sanctions par élève</h2><p className="text-sm text-slate-600">Saisissez les heures d’absence injustifiées et les points de sanction. La conduite se calcule automatiquement.</p></div>
      <button type="button" onClick={save} disabled={saving || loading || !changed.length} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Enregistrement…" : "Enregistrer"}</button>
    </div>
    {message && <p role="status" className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {error && <div role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}{!changed.length && <button type="button" onClick={() => setReload(n => n + 1)} className="ml-3 font-semibold underline">Réessayer</button>}</div>}
    {loading ? <p role="status" className="py-6 text-sm text-slate-600">Chargement des élèves…</p> : !items.length ? <p className="text-sm text-slate-600">Aucun élève inscrit dans cette classe pour la période choisie.</p> : <>
      <p className="mb-3 text-xs text-slate-500">Barème d’assiduité : {String(rules.penalty_per_hour).replace(".", ",")} point par heure ; seuil : {rules.max_hours_before_zero} h.</p>
      <p className="mb-3 text-xs text-slate-500">Sanctions : 0 par défaut ; 1 point saisi retire 1 point à la conduite calculée.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th scope="col" className="px-3 py-3 text-left">N°</th><th scope="col" className="px-3 py-3 text-left">Nom et prénoms</th><th scope="col" className="px-3 py-3 text-left">Absences (heures)</th><th scope="col" className="px-3 py-3 text-left">Sanctions (points)</th><th scope="col" className="px-3 py-3 text-left">Conduite calculée /{totalMax}</th><th scope="col" className="px-3 py-3 text-left">État</th></tr></thead><tbody>
      {items.map((item, index) => {
        const value = values[item.student_id] ?? "", sanctionValue = sanctions[item.student_id] ?? "0";
        const hoursChanged = value !== initialValue(item), sanctionsChanged = sanctionValue !== initialSanctions(item);
        const hours = hoursChanged ? parseAbsenceHours(value) : Number(item.absence_count || 0);
        const points = parseSanctionPoints(sanctionValue), isChanged = hoursChanged || sanctionsChanged;
        const locked = Boolean(item.is_overridden), hoursLocked = locked || Boolean(item.rubric_overrides?.assiduite);
        const note = !isChanged || hours === null || points === null ? item.total : previewManualConduct(item, hours, maxes, rules, points);
        const recorded = item.manual_absence_updated_at || (item.manual_absence_hours !== null && item.manual_absence_hours !== undefined);
        return <tr key={item.student_id} className="border-t">
          <td className="px-3 py-3">{index + 1}</td><td className="whitespace-nowrap px-3 py-3 font-medium">{item.full_name}</td>
          <td className="px-3 py-3"><input aria-label={`Heures d’absence de ${item.full_name}`} type="text" inputMode="decimal" value={value} placeholder="0" disabled={saving || hoursLocked} onChange={e => { setValues(current => ({ ...current, [item.student_id]: e.target.value })); setError(null); setMessage(null); }} className={`w-24 rounded-lg border px-3 py-2 ${hoursChanged && hours === null ? "border-red-400" : "border-slate-300"}`} /></td>
          <td className="px-3 py-3"><input aria-label={`Points de sanction de ${item.full_name}`} type="text" inputMode="decimal" value={sanctionValue} disabled={saving || locked} onChange={e => { setSanctions(current => ({ ...current, [item.student_id]: e.target.value })); setError(null); setMessage(null); }} className={`w-24 rounded-lg border px-3 py-2 ${sanctionsChanged && points === null ? "border-red-400" : "border-slate-300"}`} /></td>
          <td className="px-3 py-3 font-semibold"><output aria-label={`Conduite calculée de ${item.full_name}`}>{format(note)}</output></td>
          <td className="px-3 py-3 text-xs text-slate-600">{locked ? "Correction existante" : isChanged ? "À enregistrer" : recorded ? "Enregistré" : "Non saisi"}</td>
        </tr>;
      })}</tbody></table></div>
    </>}
  </section>;
}
