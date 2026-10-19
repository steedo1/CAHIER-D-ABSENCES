"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  PRIMARY_LEVELS, type PrimaryEvaluationEvent, type PrimaryEventKind,
  type PrimaryLevel,
} from "@/lib/grades/primary-evaluation-events";

type ApiResult = {
  ok?: boolean; error?: string; events?: PrimaryEvaluationEvent[];
  revision?: string;
};
const LABELS: Record<PrimaryEventKind,string> = {
  composition:"Composition", passage:"Composition de passage",
  examen_blanc:"Examen blanc", interne:"Évaluation de niveau",
};
const initialLevels = (kind: PrimaryEventKind): PrimaryLevel[] =>
  kind === "passage" ? ["CP1","CP2","CE1","CE2","CM1"] :
  kind === "examen_blanc" ? ["CM2"] : [...PRIMARY_LEVELS];

export default function PrimaryEvaluationsSettings({ academicYear }: { academicYear: string }) {
  const [events, setEvents] = useState<PrimaryEvaluationEvent[]>([]);
  const [revision, setRevision] = useState("");
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!academicYear) { setAvailable(false); setEvents([]); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/school/primary-evaluations?academic_year=${encodeURIComponent(academicYear)}`, { cache:"no-store" });
      if (response.status === 404) { setAvailable(false); setEvents([]); return; }
      const data: ApiResult = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error || "Chargement impossible");
      setAvailable(true);
      setEvents(data.events || []);
      setRevision(data.revision || "");
      setMessage("");
    } catch (err) {
      setAvailable(false);
      setMessage(err instanceof Error ? err.message : "Chargement impossible");
    } finally { setBusy(false); }
  }, [academicYear]);
  useEffect(() => { void load(); }, [load]);

  function add(kind: PrimaryEventKind) {
    setEvents(prev => [...prev, {
      id: crypto.randomUUID(), kind, label:LABELS[kind], date:"",
      levels:initialLevels(kind), bulletin:true,
    }]);
  }
  function edit(id: string, patch: Partial<PrimaryEvaluationEvent>) {
    setEvents(prev => prev.map(event => event.id === id ? { ...event, ...patch } : event));
  }
  function toggleLevel(item: PrimaryEvaluationEvent, level: PrimaryLevel) {
    const allowed = item.kind === "passage" ? level !== "CM2" :
      item.kind === "examen_blanc" ? level === "CM2" : true;
    if (!allowed) return;
    edit(item.id, { levels: item.levels.includes(level)
      ? item.levels.filter(value => value !== level) : [...item.levels, level] });
  }
  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/school/primary-evaluations", {
        method:"PUT", headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ academic_year:academicYear, events, revision }),
      });
      const data: ApiResult = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error === "settings_changed_reload_required"
        ? "Paramètres modifiés ailleurs : rechargez la liste avant de recommencer."
        : data.error || "Enregistrement impossible");
      setRevision(data.revision || "");
      setEvents(data.events || []);
      setMessage("Évaluations du primaire enregistrées.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally { setSaving(false); }
  }

  if (!available && !busy) return message ? <p role="alert" className="text-sm text-rose-700">{message}</p> : null;
  return (
    <section className="my-6 rounded-2xl border border-emerald-200 bg-white p-4 space-y-4">
      <div>
        <h3 className="text-lg font-bold text-slate-900">Évaluations du primaire</h3>
        <p className="text-sm text-slate-600">
          Année {academicYear}. Chaque composition et évaluation interne est un événement daté,
          indépendant des périodes du secondaire. Les évaluations internes ne comptent pas
          dans la moyenne annuelle. Les devoirs sont datés par l’enseignant.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["composition","passage","examen_blanc","interne"] as const).map(kind => (
          <button key={kind} type="button" onClick={() => add(kind)}
            className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
            + {LABELS[kind]}
          </button>
        ))}
      </div>
      {busy ? <p>Chargement des évaluations…</p> : events.length === 0 ?
        <p className="text-sm text-slate-600">Aucune évaluation programmée. Ajoutez les compositions et leurs dates.</p> :
        <div className="space-y-3">
          {events.map(item => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                <label className="text-xs font-semibold text-slate-700">Intitulé
                  <input aria-label="Intitulé de l’évaluation" value={item.label}
                    onChange={e => edit(item.id,{ label:e.target.value })}
                    maxLength={100} className="mt-1 w-full rounded-lg border p-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-700">Date prévue
                  <input aria-label="Date de l’évaluation" type="date" value={item.date}
                    onChange={e => edit(item.id,{ date:e.target.value })}
                    className="mt-1 block rounded-lg border p-2 text-sm" />
                </label>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" checked={item.bulletin} disabled={item.kind !== "interne"}
                    onChange={e => edit(item.id,{ bulletin:e.target.checked })} />
                  Bulletin
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-xs font-semibold text-slate-600">Niveaux :</span>
                {PRIMARY_LEVELS.map(level => (
                  <label key={level} className="inline-flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={item.levels.includes(level)}
                      disabled={item.kind === "passage" && level === "CM2" ||
                        item.kind === "examen_blanc" && level !== "CM2"}
                      onChange={() => toggleLevel(item,level)} />
                    {level}
                  </label>
                ))}
                <button type="button" onClick={() => setEvents(prev => prev.filter(event => event.id !== item.id))}
                  className="ml-auto text-xs font-semibold text-rose-700">Retirer</button>
              </div>
              <p className="text-xs text-slate-500">{item.kind === "interne"
                ? "Interne : hors moyenne annuelle." : item.kind === "passage"
                ? "Composition de passage : coefficient 2 pour la moyenne générale annuelle."
                : item.kind === "examen_blanc" ? "Examen blanc CM2 : hors formule de passage."
                : "Composition officielle : intervient dans la moyenne des compositions ordinaires."}</p>
            </div>
          ))}
        </div>}
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || saving || !academicYear} onClick={() => void save()}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {saving ? "Enregistrement…" : "Enregistrer les évaluations"}
        </button>
        <button type="button" disabled={busy || saving} onClick={() => void load()}
          className="rounded-lg border px-4 py-2 text-sm">Recharger</button>
      </div>
    </section>
  );
}
