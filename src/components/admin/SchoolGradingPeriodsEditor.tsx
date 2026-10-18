"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SCHOOL_CYCLE_OPTIONS, TEACHING_TRACK_OPTIONS,
  type SchoolCycle, type TeachingTrack,
} from "@/lib/school-cycles";
import { useSchoolNavigation } from "@/components/admin/SchoolNavigationProvider";

type Program = { cycle: SchoolCycle; track: TeachingTrack };
type GradePeriod = {
  id: string; code: string; label: string; short_label: string;
  kind: string; start_date: string; end_date: string; is_active: boolean;
  coeff: number;
};
const endpoint = "/api/admin/school-grading-periods";
let nextTemporaryId = 0;

export default function SchoolGradingPeriodsEditor({ academicYear, allowedPrograms }: { academicYear: string; allowedPrograms?: Program[] }) {
  const navigation = useSchoolNavigation();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programKey, setProgramKey] = useState("");
  const [items, setItems] = useState<GradePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const current = useMemo(() => programs.find(program =>
    `${program.cycle}|${program.track}` === programKey), [programs, programKey]);
  const canEdit = Boolean(academicYear && current) && !loading && !saving;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (allowedPrograms) {
      // Director portal receives only the server-authorized track/cycles.
      // Do not call the admin-only bulletin-templates API or show other tracks.
      const unique = [...new Map(allowedPrograms.map(p => [`${p.cycle}|${p.track}`, p])).values()];
      setPrograms(unique);
      setProgramKey(unique[0] ? `${unique[0].cycle}|${unique[0].track}` : "");
      setLoading(false);
      return () => { active = false; controller.abort(); };
    }
    (async () => {
      try {
        const response = await fetch("/api/admin/bulletin-templates", {
          signal: controller.signal, cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok || !data.ok || !data.configuration?.enabled) {
          throw new Error(data.error || "Cycles non configurés.");
        }
        if (!active) return;
        const config = data.configuration as {
          enabledCycles: SchoolCycle[];
          teachingTracksByCycle: Partial<Record<SchoolCycle, TeachingTrack[]>>;
        };
        const available = config.enabledCycles.flatMap(cycle =>
          (config.teachingTracksByCycle[cycle] || []).map(track => ({ cycle, track })));
        setPrograms(available);
        const preferred = available.find(p =>
          (!navigation || navigation.selection.cycle === "all" || navigation.selection.cycle === p.cycle) &&
          (!navigation || navigation.selection.track === "all" || navigation.selection.track === p.track));
        const first = preferred || available[0];
        setProgramKey(first ? `${first.cycle}|${first.track}` : "");
      } catch (err) {
        if (active && !controller.signal.aborted) setError(
          err instanceof Error ? err.message : "Impossible de charger les enseignements.");
      }
    })();
    return () => { active = false; controller.abort(); };
    // Program list belongs to this editor. A navigation filter may be changed
    // later using the explicit selector without discarding unsaved rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setItems([]);
    setNotice("");
    if (!academicYear || !current) { setLoading(false); return; }
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      academic_year: academicYear, cycle: current.cycle, track: current.track,
    });
    (async () => {
      try {
        const response = await fetch(`${endpoint}?${params.toString()}`, {
          cache: "no-store", signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Chargement des périodes impossible.");
        if (!active) return;
        setItems((data.items || []).map((row: any) => ({
          id: String(row.id),
          code: String(row.code || ""),
          label: String(row.label || ""),
          short_label: String(row.short_label || row.label || ""),
          kind: String(row.kind || ""),
          start_date: String(row.start_date || "").slice(0, 10),
          end_date: String(row.end_date || "").slice(0, 10),
          is_active: row.is_active !== false,
          coeff: Number(row.coeff ?? 1),
        })));
      } catch (err) {
        if (active && !controller.signal.aborted) setError(
          err instanceof Error ? err.message : "Impossible de charger les périodes.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [academicYear, programKey, current?.cycle, current?.track]);

  function patch(id: string, changes: Partial<GradePeriod>) {
    setNotice("");
    setItems(old => old.map(row => row.id === id ? { ...row, ...changes } : row));
  }
  function add() {
    ++nextTemporaryId;
    setItems(old => [...old, {
      id: `temp_${nextTemporaryId}`, code: "", label: "", short_label: "",
      kind: "", start_date: "", end_date: "", is_active: true, coeff: 1,
    }]);
    setNotice("");
  }
  function move(index: number, delta: number) {
    setItems(old => {
      const target = index + delta;
      if (target < 0 || target >= old.length) return old;
      const copy = [...old];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }
  async function save() {
    if (!canEdit || !current) return;
    setSaving(true); setError(""); setNotice("");
    try {
      if (items.some(p => !p.code.trim() || !p.label.trim() || !p.start_date ||
          !p.end_date || p.start_date > p.end_date)) {
        throw new Error("Renseignez le code, le libellé et les dates valides de chaque période.");
      }
      const response = await fetch(endpoint, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academic_year: academicYear, cycle: current.cycle, track: current.track,
          periods: items.map(row => ({
            ...row, id: row.id.startsWith("temp_") ? null : row.id,
            coeff: current.cycle === "secondary" ? row.coeff : 1,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(
        data.error === "period_used_by_evaluations"
          ? "Une période est déjà utilisée dans des évaluations et ne peut pas être supprimée."
          : data.error || "Enregistrement impossible.");
      setItems((data.items || []).map((row: any) => ({
        id: String(row.id), code: String(row.code || ""),
        label: String(row.label || ""), short_label: String(row.short_label || ""),
        kind: String(row.kind || ""),
        start_date: String(row.start_date || "").slice(0, 10),
        end_date: String(row.end_date || "").slice(0, 10),
        is_active: row.is_active !== false, coeff: Number(row.coeff ?? 1),
      })));
      setNotice("Périodes enregistrées pour ce cycle et cet enseignement.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return <section id="grading-periods" className="space-y-4 rounded-2xl border bg-white p-5">
    <div>
      <h2 className="text-xl font-bold">Périodes d'évaluation — par cycle et enseignement</h2>
      <p className="mt-1 text-sm text-slate-600">
        Configurez les périodes réelles utilisées par les évaluations : chaque cycle et enseignement dispose
        de ses propres dates et libellés, sans modèle imposé.
        Les classes doivent être affectées à un seul enseignement dans la configuration pédagogique.
      </p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold">
        Année scolaire
        <div className="mt-2 rounded-lg border bg-slate-50 p-2">{academicYear || "Choisir l'année dans les paramètres"}</div>
      </label>
      <label className="text-sm font-semibold">
        Cycle et enseignement
        <select className="mt-2 w-full rounded-lg border bg-white p-2"
          value={programKey} disabled={saving || programs.length === 0}
          onChange={e => setProgramKey(e.target.value)}>
          {programs.map(p => <option key={`${p.cycle}|${p.track}`}
            value={`${p.cycle}|${p.track}`}>
            {SCHOOL_CYCLE_OPTIONS.find(x => x.id === p.cycle)?.label || p.cycle}
            {" — "}
            {TEACHING_TRACK_OPTIONS.find(x => x.id === p.track)?.label || p.track}
          </option>)}
        </select>
      </label>
    </div>
    {current?.cycle === "preschool" && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      Préscolaire : périodes de suivi des compétences, sans note chiffrée ni coefficient.
    </p>}
    {current?.cycle === "primary" && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
      Primaire : les périodes sont indépendantes de celles des autres cycles.
      Les barèmes se configurent dans les paramètres des bulletins.
    </p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    {loading ? <p className="text-sm text-slate-600">Chargement des périodes…</p> :
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[740px] text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr><th className="p-2 text-left">Code</th><th className="p-2 text-left">Période</th>
              <th className="p-2 text-left">Bulletin</th><th className="p-2 text-left">Début</th>
              <th className="p-2 text-left">Fin</th>
              {current?.cycle === "secondary" && <th className="p-2">Coeff.</th>}
              <th className="p-2">Active</th><th className="p-2">Actions</th></tr>
          </thead>
          <tbody className="divide-y">
            {items.map((p, index) => <tr key={p.id}>
              <td className="p-2"><input aria-label={`Code période ${index + 1}`} className="w-20 rounded border p-1"
                value={p.code} onChange={e => patch(p.id, { code: e.target.value })}/></td>
              <td className="p-2"><input aria-label={`Libellé période ${index + 1}`} className="w-full min-w-32 rounded border p-1"
                value={p.label} onChange={e => patch(p.id, { label: e.target.value })}/></td>
              <td className="p-2"><input aria-label={`Libellé bulletin ${index + 1}`} className="w-full min-w-24 rounded border p-1"
                value={p.short_label} onChange={e => patch(p.id, { short_label: e.target.value })}/></td>
              <td className="p-2"><input type="date" aria-label={`Début période ${index + 1}`}
                className="rounded border p-1" value={p.start_date}
                onChange={e => patch(p.id, { start_date: e.target.value })}/></td>
              <td className="p-2"><input type="date" aria-label={`Fin période ${index + 1}`}
                className="rounded border p-1" value={p.end_date}
                onChange={e => patch(p.id, { end_date: e.target.value })}/></td>
              {current?.cycle === "secondary" && <td className="p-2">
                <input aria-label={`Coefficient période ${index + 1}`}
                  className="w-16 rounded border p-1" type="number" min={0} max={99} step=".5"
                  value={p.coeff} onChange={e => patch(p.id, { coeff: Number(e.target.value) })}/>
              </td>}
              <td className="p-2 text-center"><input aria-label={`Période active ${index + 1}`}
                type="checkbox" checked={p.is_active} onChange={e => patch(p.id, { is_active: e.target.checked })}/></td>
              <td className="p-2"><div className="flex gap-2">
                <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                <button type="button" disabled={index === items.length - 1} onClick={() => move(index, 1)}>↓</button>
                <button type="button" className="text-red-700" onClick={() => setItems(old => old.filter(x => x.id !== p.id))}>Retirer</button>
              </div></td>
            </tr>)}
            {items.length === 0 && <tr><td colSpan={current?.cycle === "secondary" ? 8 : 7}
              className="p-4 text-slate-500">Aucune période définie pour ce cycle et cet enseignement.</td></tr>}
          </tbody>
        </table>
      </div>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!canEdit} onClick={add}
        className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50">+ Ajouter une période</button>
      <button type="button" disabled={!canEdit} onClick={() => void save()}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {saving ? "Enregistrement…" : "Enregistrer les périodes"}
      </button>
    </div>
    <p className="text-xs text-slate-500">
      Les périodes déjà liées à des évaluations conservent leur identifiant et ne peuvent pas être supprimées.
      Les établissements classiques conservent leurs périodes communes.
    </p>
  </section>;
}
