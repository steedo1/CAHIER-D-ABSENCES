"use client";

import { useEffect, useMemo, useState } from "react";
import type { SchoolCycle, TeachingTrack } from "@/lib/school-cycles";
import type { ProgramPeriod } from "@/lib/school-program-periods";
import { useSchoolNavigation } from "@/components/admin/SchoolNavigationProvider";

type Program = { cycle: SchoolCycle; track: TeachingTrack };
type ApiData = {
  ok?: boolean;
  error?: string;
  year?: string;
  revision?: string;
  programs?: Program[];
  periods?: ProgramPeriod[];
};
const cycleName: Record<SchoolCycle, string> = {
  preschool: "Préscolaire", primary: "Primaire", secondary: "Secondaire",
};
const trackName: Record<TeachingTrack, string> = {
  french: "Français", arabic: "Arabe",
};
const kindOptions: Array<{ value: ProgramPeriod["kind"]; label: string }> = [
  { value: "trimester", label: "Trimestre" },
  { value: "semester", label: "Semestre" },
  { value: "composition", label: "Composition" },
  { value: "sequence", label: "Séquence" },
  { value: "other", label: "Autre période" },
];

function preset(kind: "trimester" | "semester" | "composition", cycle: SchoolCycle): ProgramPeriod[] {
  const count = kind === "semester" ? 2 : 3;
  const prefix = kind === "semester" ? "S" : kind === "composition" ? "C" : "T";
  const noun = kind === "semester" ? "semestre" : kind === "composition" ? "composition" : "trimestre";
  return Array.from({ length: count }, (_, i) => ({
    code: `${prefix}${i + 1}`,
    label: `${i + 1}${i === 0 ? "er" : "e"} ${noun}`,
    shortLabel: `${prefix}${i + 1}`,
    kind, startDate: null, endDate: null, active: true,
    ...(cycle === "secondary" ? { weight: 1 } : {}),
  }));
}
export default function SchoolProgramPeriodsEditor() {
  const navigation = useSchoolNavigation();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selected, setSelected] = useState("");
  const [year, setYear] = useState("");
  const [revision, setRevision] = useState("");
  const [periods, setPeriods] = useState<ProgramPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/admin/school-program-periods", { cache: "no-store" })
      .then(async response => {
        const data = await response.json() as ApiData;
        if (!response.ok || !data.ok) throw new Error(data.error || "Périodes indisponibles");
        return data;
      })
      .then(data => {
        if (!live) return;
        const choices = data.programs || [];
        setPrograms(choices);
        const preference = navigation?.selection;
        const favorite = choices.find(p => p.cycle === preference?.cycle && p.track === preference?.track);
        const first = favorite || choices[0];
        setSelected(first ? `${first.cycle}|${first.track}` : "");
        setYear(data.year || "");
        setRevision(data.revision || "");
      })
      .catch(err => { if (live) setError(String(err?.message || err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  // Navigation context is only the initial preferred program, not a source of grants.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Director General's navigation filter chooses the active editing context.
  // Never interpret that client-side filter as a permission grant.
  useEffect(() => {
    const selection = navigation?.selection;
    const match = programs.find(p => p.cycle === selection?.cycle && p.track === selection?.track);
    if (match) setSelected(`${match.cycle}|${match.track}`);
  }, [navigation?.selection.cycle, navigation?.selection.track, programs]);

  const choice = useMemo(() => programs.find(p => `${p.cycle}|${p.track}` === selected), [programs, selected]);
  const isSecondary = choice?.cycle === "secondary";

  useEffect(() => {
    if (!choice) return;
    const abort = new AbortController();
    let live = true;
    setLoading(true);
    setError("");
    setMessage("");
    fetch(`/api/admin/school-program-periods?cycle=${choice.cycle}&track=${choice.track}`,
      { cache: "no-store", signal: abort.signal })
      .then(async response => {
        const data = await response.json() as ApiData;
        if (!response.ok || !data.ok) throw new Error(data.error || "Périodes indisponibles");
        return data;
      })
      .then(data => {
        if (!live) return;
        setYear(data.year || "");
        setRevision(data.revision || "");
        setPeriods(data.periods || []);
      })
      .catch(err => { if (live && !abort.signal.aborted) setError(String(err?.message || err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; abort.abort(); };
  }, [choice]);

  function update(index: number, patch: Partial<ProgramPeriod>) {
    setMessage("");
    setPeriods(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  function append() {
    setMessage("");
    const number = periods.length + 1;
    setPeriods(rows => [...rows, {
      code: `P${number}`, label: `Période ${number}`,
      shortLabel: `P${number}`, kind: "other", startDate: null, endDate: null,
      active: true, ...(isSecondary ? { weight: 1 } : {}),
    }]);
  }
  async function save() {
    if (!choice || !revision || loading || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/school-program-periods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...choice, year, revision, periods }),
      });
      const data = await response.json() as ApiData;
      if (!response.ok || !data.ok) throw new Error(data.error || "Enregistrement impossible");
      setPeriods(data.periods || []);
      setRevision(data.revision || "");
      setMessage("Périodes enregistrées pour ce cycle et cet enseignement uniquement.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally { setSaving(false); }
  }

  return <section className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-5">
    <div>
      <h2 className="text-lg font-bold text-slate-900">Périodes par cycle et enseignement</h2>
      <p className="mt-1 text-sm text-slate-600">
        Année scolaire active : <strong>{year || "—"}</strong>. Chaque programme possède ses propres
        périodes, sans modifier celles des autres cycles ni les périodes communes des écoles ordinaires.
      </p>
    </div>
    <label className="block max-w-xl text-sm font-semibold text-slate-800">
      Cycle et enseignement
      <select className="mt-1 w-full rounded-lg border px-3 py-2"
        value={selected} onChange={event => setSelected(event.target.value)}
        disabled={loading || saving}>
        {programs.map(p => <option key={`${p.cycle}|${p.track}`} value={`${p.cycle}|${p.track}`}>
          {cycleName[p.cycle]} — {trackName[p.track]}
        </option>)}
      </select>
    </label>
    {choice && <div className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
      {choice.cycle === "preschool" ? "Préscolaire : périodes d’observation des compétences. Ni note /20 ni coefficient." :
       choice.cycle === "primary" ? "Primaire : évaluations avec barèmes définis par niveau. Aucun coefficient de matière ou de période." :
       "Secondaire : trimestres, semestres ou compositions selon le dispositif habituel ; pondérations disponibles."}
    </div>}
    <p className="text-xs text-amber-900">
      Ces périodes sont configurées séparément. Leur raccordement aux évaluations publiées
      nécessite encore de sécuriser les identifiants de période par classe et programme.
      En attendant, la saisie historique n’est pas modifiée.
    </p>
    {loading ? <p role="status">Chargement des périodes…</p> : choice && <>
      <div className="flex flex-wrap gap-2">
        {(["trimester", "semester", "composition"] as const).map(kind =>
          <button key={kind} type="button" onClick={() => setPeriods(preset(kind, choice.cycle))}
            className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-slate-50">
            {kind === "trimester" ? "3 trimestres" : kind === "semester" ? "2 semestres" : "3 compositions"}
          </button>)}
      </div>
      <div className="space-y-3">
        {periods.map((row, index) => <div key={index} className="grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs">Code
            <input className="mt-1 w-full rounded-lg border p-2 text-sm" maxLength={18} value={row.code}
              onChange={e => update(index, { code: e.target.value })}/>
          </label>
          <label className="text-xs lg:col-span-2">Période
            <input className="mt-1 w-full rounded-lg border p-2 text-sm" maxLength={100} value={row.label}
              onChange={e => update(index, { label: e.target.value })}/>
          </label>
          <label className="text-xs">Libellé bulletin
            <input className="mt-1 w-full rounded-lg border p-2 text-sm" maxLength={45} value={row.shortLabel}
              onChange={e => update(index, { shortLabel: e.target.value })}/>
          </label>
          <label className="text-xs">Type
            <select className="mt-1 w-full rounded-lg border p-2 text-sm" value={row.kind}
              onChange={e => update(index, { kind: e.target.value as ProgramPeriod["kind"] })}>
              {kindOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-xs">Début
            <input type="date" className="mt-1 w-full rounded-lg border p-2 text-sm" value={row.startDate || ""}
              onChange={e => update(index, { startDate: e.target.value || null })}/>
          </label>
          <label className="text-xs">Fin
            <input type="date" className="mt-1 w-full rounded-lg border p-2 text-sm" value={row.endDate || ""}
              onChange={e => update(index, { endDate: e.target.value || null })}/>
          </label>
          <div className="flex items-end justify-between gap-2">
            {isSecondary ? <label className="text-xs">Poids
              <input type="number" min={0} max={100} step="0.5"
                className="mt-1 w-20 rounded-lg border p-2 text-sm"
                value={row.weight ?? 1}
                onChange={e => update(index, { weight: Number(e.target.value) })}/>
            </label> : <span className="text-xs text-slate-500">Sans coefficient</span>}
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={row.active}
                onChange={e => update(index, { active: e.target.checked })}/> Actif
            </label>
            <button type="button" className="rounded-lg border border-red-200 px-2 py-2 text-xs text-red-700"
              onClick={() => setPeriods(p => p.filter((_, i) => i !== index))}>Retirer</button>
          </div>
        </div>)}
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={append} disabled={periods.length >= 12}
          className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50">
          + Ajouter une période
        </button>
        <button type="button" disabled={saving || !revision} onClick={() => void save()}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? "Enregistrement…" : "Enregistrer ces périodes"}
        </button>
      </div>
    </>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
  </section>;
}
