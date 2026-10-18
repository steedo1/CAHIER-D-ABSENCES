"use client";

import { useEffect, useState } from "react";
import type { TeachingTrack } from "@/lib/school-cycles";

type Director = { name: string };
type Candidate = { id: string; name: string };
type ApiResult = { ok?: boolean; directors?: Partial<Record<TeachingTrack, Director>>;
  candidates?: Candidate[]; revision?: string; error?: string };
const TRACKS: Array<{ id: TeachingTrack; label: string }> = [
  { id: "french", label: "Enseignement français" },
  { id: "arabic", label: "Enseignement arabe" },
];
const BLANK = { french: "", arabic: "" };

export default function SchoolTeachingSignatoriesManager() {
  const [directors, setDirectors] = useState<Partial<Record<TeachingTrack, Director>>>({});
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [revision, setRevision] = useState("");
  const [names, setNames] = useState<Record<TeachingTrack, string>>(BLANK);
  const [selected, setSelected] = useState<Record<TeachingTrack, string>>(BLANK);
  const [busy, setBusy] = useState<TeachingTrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const response = await fetch("/api/admin/school-directors", { cache: "no-store" });
    const data = await response.json() as ApiResult;
    if (!response.ok || !data.ok || !data.revision) throw new Error(data.error || "Chargement impossible.");
    const values = data.directors || {};
    setDirectors(values); setCandidates(data.candidates || []); setRevision(data.revision);
    setNames({ french: values.french?.name || "", arabic: values.arabic?.name || "" });
    setSelected({ ...BLANK });
  }

  useEffect(() => {
    let active = true;
    fetch("/api/admin/school-directors", { cache: "no-store" }).then(async response => {
      const data = await response.json() as ApiResult;
      if (!response.ok || !data.ok || !data.revision) throw new Error(data.error || "Chargement impossible.");
      if (!active) return;
      const values = data.directors || {};
      setDirectors(values); setCandidates(data.candidates || []); setRevision(data.revision);
      setNames({ french: values.french?.name || "", arabic: values.arabic?.name || "" });
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Chargement impossible."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save(track: TeachingTrack, remove = false) {
    if (busy || !revision || (!remove && !selected[track] && names[track].trim().length < 3)) return;
    if (remove && !window.confirm("Retirer ce nom des prochains documents de cet enseignement ?")) return;
    setBusy(track); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/school-directors", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track, revision, ...(remove ? { name: "" } :
          selected[track] ? { candidate_profile_id: selected[track] } : { name: names[track].trim() }) }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "Nomination impossible.");
      setMessage(remove ? "Signature retirée pour cet enseignement." : "Nomination enregistrée pour les documents officiels.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Enregistrement impossible.");
    } finally { setBusy(null); }
  }

  return <section className="rounded-2xl border bg-white p-5 space-y-4">
    <div>
      <h2 className="text-lg font-semibold">Directions des enseignements — signataires</h2>
      <p className="mt-1 text-sm text-slate-600">
        Deux fonctions officielles pour les documents franco-arabes. Ces nominations ne créent
        aucun compte utilisateur, aucune permission, ni espace de connexion.
      </p>
    </div>
    {loading ? <p>Chargement des signataires…</p> : <div className="grid gap-4 md:grid-cols-2">
      {TRACKS.map(track => <div key={track.id} className="space-y-3 rounded-xl border p-4">
        <h3 className="font-semibold">{track.label}</h3>
        <p className="text-sm">Responsable : <strong>{directors[track.id]?.name || "Aucun responsable nommé"}</strong></p>
        <label className="block text-sm">Choisir un enseignant existant (facultatif)
          <select className="mt-1 w-full rounded-lg border p-2" value={selected[track.id]}
            onChange={event => setSelected(current => ({ ...current, [track.id]: event.target.value }))}>
            <option value="">Saisir un nom librement</option>
            {candidates.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        {!selected[track.id] && <label className="block text-sm">Nom complet du signataire
          <input className="mt-1 w-full rounded-lg border p-2" maxLength={120}
            value={names[track.id]}
            onChange={event => setNames(current => ({ ...current, [track.id]: event.target.value }))}/>
        </label>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void save(track.id)} disabled={busy !== null || !revision ||
            (!selected[track.id] && names[track.id].trim().length < 3)}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === track.id ? "Enregistrement…" : "Nommer / remplacer"}
          </button>
          {directors[track.id] && <button type="button" onClick={() => void save(track.id, true)}
            disabled={busy !== null} className="rounded-lg border px-4 py-2 text-sm">Retirer la nomination</button>}
        </div>
      </div>)}
    </div>}
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <p className="text-xs text-slate-500">Les signatures et visas manuscrits restent à apposer selon les procédures de l'établissement.</p>
  </section>;
}
