"use client";

import { useEffect, useState } from "react";
import {
  PRIMARY_LEVELS,
  type PrimaryEvent,
  type PrimaryEventKind,
  type PrimaryLevel,
  type PrimaryTrack,
  validatePrimaryEvents,
} from "@/lib/grades/primary-evaluation-events";

const KIND_LABELS: Record<PrimaryEventKind, string> = {
  official: "Composition officielle",
  passage: "Composition de passage (CP1-CM1)",
  internal: "Évaluation interne",
  mock: "Examen blanc (CM2)",
};
const TRACK_LABELS: Record<PrimaryTrack, string> = {
  french: "Français", arabic: "Arabe",
};
let newId = 0;
function blank(kind: PrimaryEventKind): PrimaryEvent {
  newId += 1;
  return {
    code: "EVAL_" + newId,
    label: kind === "passage" ? "Composition de passage" :
      kind === "official" ? "Composition de décembre" :
      kind === "mock" ? "Examen blanc" : "Évaluation de niveau",
    kind, date: "", tracks: ["french", "arabic"],
    levels: kind === "mock" ? ["CM2"] : kind === "passage" ?
      ["CP1", "CP2", "CE1", "CE2", "CM1"] : [...PRIMARY_LEVELS],
    printBulletin: true,
  };
}
export default function PrimaryEvaluationEventsEditor({ academicYear }: { academicYear: string }) {
  const [events, setEvents] = useState<PrimaryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!academicYear) { setEvents([]); return; }
    const controller = new AbortController();
    setLoading(true);
    setMessage("");
    fetch("/api/admin/institution/primary-evaluation-events?academic_year=" +
      encodeURIComponent(academicYear), { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Chargement impossible");
        if (!controller.signal.aborted) setEvents(data.events || []);
      })
      .catch(error => {
        if (!controller.signal.aborted) setMessage(error.message || "Chargement impossible");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [academicYear]);
  function change(code: string, update: Partial<PrimaryEvent>) {
    setEvents(rows => rows.map(row => row.code === code ? { ...row, ...update } : row));
  }
  function toggleTrack(code: string, value: PrimaryTrack) {
    const event = events.find(row => row.code === code);
    if (!event) return;
    change(code, { tracks: event.tracks.includes(value) ?
      event.tracks.filter(track => track !== value) : [...event.tracks, value] });
  }
  function toggleLevel(code: string, value: PrimaryLevel) {
    const event = events.find(row => row.code === code);
    if (!event) return;
    change(code, { levels: event.levels.includes(value) ?
      event.levels.filter(level => level !== value) : [...event.levels, value] });
  }
  async function save() {
    const result = validatePrimaryEvents(events, academicYear);
    if (!result.ok) { setMessage("Vérifiez les codes, dates, niveaux et enseignements de chaque évaluation."); return; }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/institution/primary-evaluation-events", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academic_year: academicYear, events: result.events }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Enregistrement impossible");
      setEvents(data.events);
      setMessage("Calendrier des évaluations enregistré. Les devoirs ordinaires gardent une date libre.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally { setSaving(false); }
  }
  return <section className="space-y-4 rounded-2xl border bg-white p-5">
    <div>
      <h2 className="text-lg font-semibold">Évaluations ponctuelles du primaire</h2>
      <p className="mt-1 text-sm text-slate-600">
        Calendrier par année scolaire, niveau et enseignement. Les compositions et évaluations
        internes sont des événements datés, pas des trimestres. Le devoir de classe reste
        disponible avec une date choisie par le maître.
      </p>
    </div>
    {loading ? <p>Chargement…</p> : <div className="space-y-3">
      {events.map((event, index) => <div key={index} className="space-y-3 rounded-xl border p-3">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-xs font-medium">Code unique
            <input className="mt-1 w-full rounded border p-2" value={event.code}
              onChange={e => change(event.code, { code: e.target.value.toUpperCase() })}/>
          </label>
          <label className="text-xs font-medium md:col-span-1">Libellé
            <input className="mt-1 w-full rounded border p-2" value={event.label}
              onChange={e => change(event.code, { label: e.target.value })}/>
          </label>
          <label className="text-xs font-medium">Nature
            <select className="mt-1 w-full rounded border p-2" value={event.kind}
              onChange={e => {
                const kind = e.target.value as PrimaryEventKind;
                change(event.code, { kind, levels: kind === "mock" ? ["CM2"] :
                  kind === "passage" ? ["CP1", "CP2", "CE1", "CE2", "CM1"] : [...PRIMARY_LEVELS] });
              }}>
              {Object.entries(KIND_LABELS).map(([kind, label]) =>
                <option key={kind} value={kind}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium">Date fixe
            <input type="date" className="mt-1 w-full rounded border p-2" value={event.date}
              onChange={e => change(event.code, { date: e.target.value })}/>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">Enseignement :</span>
          {(["french", "arabic"] as PrimaryTrack[]).map(track =>
            <label key={track} className="inline-flex items-center gap-1">
              <input type="checkbox" checked={event.tracks.includes(track)}
                onChange={() => toggleTrack(event.code, track)}/>{TRACK_LABELS[track]}
            </label>)}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">Niveaux :</span>
          {PRIMARY_LEVELS.map(level =>
            <label key={level} className="inline-flex items-center gap-1">
              <input type="checkbox" checked={event.levels.includes(level)}
                disabled={(event.kind === "passage" && level === "CM2") ||
                  (event.kind === "mock" && level !== "CM2")}
                onChange={() => toggleLevel(event.code, level)}/>{level}
            </label>)}
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={event.printBulletin}
              disabled={event.kind !== "internal"}
              onChange={e => change(event.code, { printBulletin: e.target.checked })}/>
            Bulletin distinct {event.kind === "internal" ? "(au choix)" : "(prévu)"}
          </label>
          <button type="button" className="rounded border px-3 py-1 text-sm text-rose-700"
            onClick={() => setEvents(rows => rows.filter((_, i) => i !== index))}>Retirer</button>
        </div>
      </div>)}
      {events.length === 0 && <p className="text-sm text-slate-500">Aucune évaluation programmée pour cette année.</p>}
    </div>}
    <div className="flex flex-wrap gap-2">
      {(["official", "passage", "internal", "mock"] as PrimaryEventKind[]).map(kind =>
        <button key={kind} type="button" disabled={saving || loading || events.length >= 32}
          className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50"
          onClick={() => setEvents(rows => {
            let candidate = blank(kind);
            while (rows.some(row => row.code === candidate.code)) candidate = blank(kind);
            return [...rows, candidate];
          })}>+ {KIND_LABELS[kind]}</button>)}
    </div>
    <button type="button" disabled={!academicYear || loading || saving}
      className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      onClick={save}>{saving ? "Enregistrement…" : "Enregistrer les évaluations"}</button>
    {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
    <p className="text-xs text-slate-500">
      Les compositions officielles seules entrent dans la moyenne annuelle ;
      la composition de passage compte double au CP1–CM1. Les évaluations internes
      et examens blancs ne comptent pas dans ce calcul. La formule doit être
      confirmée avec les textes 2026–2027 avant la mise en production.
    </p>
  </section>;
}
