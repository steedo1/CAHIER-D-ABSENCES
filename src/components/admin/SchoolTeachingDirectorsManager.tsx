"use client";

import { useEffect, useState } from "react";
import type { TeachingTrack } from "@/lib/school-cycles";

type Director = {
  track: TeachingTrack; active: boolean; updated_at: string;
  profile: { id: string; display_name: string | null; phone: string | null; email: string | null } | null;
};
type Candidate = { id: string; display_name: string | null; phone: string | null; email: string | null };
type Result = { ok?: boolean; directors?: Director[]; candidates?: Candidate[]; reused_existing_account?: boolean;
  director?: unknown; temporary_password?: string; error?: string };

const tracks: { value: TeachingTrack; label: string }[] = [
  { value: "french", label: "Enseignement français" },
  { value: "arabic", label: "Enseignement arabe" },
];

export default function SchoolTeachingDirectorsManager() {
  const [directors, setDirectors] = useState<Director[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [existingProfileId, setExistingProfileId] = useState("");
  const [track, setTrack] = useState<TeachingTrack>("french");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const response = await fetch("/api/admin/school-directors", { cache: "no-store" });
    const result = await response.json() as Result;
    if (!response.ok || !result.ok) throw new Error(result.error || "Liste des directions indisponible.");
    setDirectors(result.directors || []);
    setCandidates(result.candidates || []);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/admin/school-directors", { cache: "no-store" })
      .then(async response => {
        const body = await response.json() as Result;
        if (!response.ok || !body.ok) throw new Error(body.error || "Chargement impossible.");
        if (active) { setDirectors(body.directors || []); setCandidates(body.candidates || []); }
      })
      .catch(cause => { if (active) setError(String(cause instanceof Error ? cause.message : cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const current = directors.find(item => item.track === track && item.active);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || current) return;
    setBusy(true); setError(""); setMessage(""); setSecret("");
    try {
      const response = await fetch("/api/admin/school-directors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(existingProfileId
          ? { track, existing_profile_id: existingProfileId }
          : { track, name: name.trim(), phone: phone.trim(), email: email.trim() }),
      });
      const data = await response.json() as Result;
      if (!response.ok || !data.ok) throw new Error(data.error || "Création impossible.");
      setSecret(data.temporary_password || "");
      setMessage(data.reused_existing_account
        ? "Direction attribuée au compte enseignant existant. Aucun mot de passe n'a été changé."
        : "Compte directeur créé. Notez et transmettez le mot de passe provisoire via un canal sûr.");
      setName(""); setPhone(""); setEmail(""); setExistingProfileId("");
      try { await refresh(); } catch {}
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur de création.");
    } finally { setBusy(false); }
  }

  async function revoke() {
    if (!current || busy || !window.confirm("Suspendre l'accès à cette direction ?")) return;
    setBusy(true); setError(""); setMessage(""); setSecret("");
    try {
      const response = await fetch("/api/admin/school-directors", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track }),
      });
      const data = await response.json() as Result;
      if (!response.ok || !data.ok) throw new Error(data.error || "Suspension impossible.");
      setMessage("Accès de direction suspendu.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erreur de suspension.");
    } finally { setBusy(false); }
  }

  return <section className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
    <div>
      <h2 className="text-xl font-bold text-slate-900">Directions des enseignements</h2>
      <p className="mt-1 text-sm text-slate-600">
        Réservé aux établissements franco-arabes. Un directeur par enseignement,
        pour tous les cycles où celui-ci est proposé. Les autres écoles sont inchangées.
      </p>
    </div>
    {loading ? <p>Chargement des directions…</p> : <div className="grid gap-3 md:grid-cols-2">
      {tracks.map(item => {
        const director = directors.find(row => row.track === item.value && row.active);
        return <div key={item.value} className="rounded-xl border p-4">
          <h3 className="font-bold text-slate-900">{item.label}</h3>
          <p className="mt-2 text-sm text-slate-700">
            {director ? director.profile?.display_name || "Directeur nommé" : "Aucun directeur en fonction"}
          </p>
          {director && <p className="text-xs text-slate-500">
            {director.profile?.phone || director.profile?.email || ""}
          </p>}
        </div>;
      })}
    </div>}
    <form onSubmit={create} className="space-y-3 rounded-xl bg-slate-50 p-4">
      <label className="block text-sm font-medium">Direction à attribuer
        <select className="mt-1 block w-full rounded-lg border bg-white p-2" value={track}
          onChange={event => { setTrack(event.target.value as TeachingTrack); setSecret(""); setMessage(""); }}>
          {tracks.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {candidates.length > 0 && !current && <label className="block text-sm font-medium">
        Nommer un enseignant déjà inscrit (compte conservé)
        <select className="mt-1 block w-full rounded-lg border bg-white p-2"
          value={existingProfileId} onChange={event => { setExistingProfileId(event.target.value); setSecret(""); }}>
          <option value="">Créer un nouveau compte à la place</option>
          {candidates.map(person => <option key={person.id} value={person.id}>
            {person.display_name || "Enseignant"} — {person.phone || person.email || "Sans contact"}
          </option>)}
        </select>
      </label>}
      {current ? <div className="space-y-2">
        <p className="text-sm">Ce poste a déjà un directeur. Suspendre l'accès avant de nommer un remplaçant.</p>
        <button type="button" disabled={busy} onClick={() => void revoke()}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-800">
          Suspendre cet accès
        </button>
      </div> : existingProfileId ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-medium">Le compte enseignant sera conservé, avec ses affectations et son mot de passe actuel.</p>
        <button type="submit" disabled={busy}
          className="mt-3 rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-40">
          {busy ? "Nomination…" : "Nommer directeur de cet enseignement"}
        </button>
      </div> : <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">Nom du directeur
          <input className="mt-1 w-full rounded-lg border p-2" value={name}
            onChange={event => setName(event.target.value)} required minLength={3} maxLength={120}/>
        </label>
        <label className="block text-sm">Téléphone (+225)
          <input className="mt-1 w-full rounded-lg border p-2" value={phone}
            onChange={event => setPhone(event.target.value)} placeholder="+2250700000000"/>
        </label>
        <label className="block text-sm md:col-span-2">Email (facultatif si téléphone)
          <input type="email" className="mt-1 w-full rounded-lg border p-2" value={email}
            onChange={event => setEmail(event.target.value)}/>
        </label>
        <button type="submit" disabled={busy || (!phone.trim() && !email.trim())}
          className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-40 md:col-span-2">
          {busy ? "Création…" : "Créer le compte directeur"}
        </button>
      </div>}
    </form>
    {secret && <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-bold">Mot de passe provisoire — affichage unique</p>
      <code className="mt-2 block break-all font-mono text-lg">{secret}</code>
      <p className="mt-2 text-xs">Conservez-le dans un endroit sécurisé. Il ne sera plus affiché après fermeture ou actualisation.</p>
    </div>}
    {message && <p role="status" className="text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    <p className="text-xs text-amber-900">
      Les accès métiers restent limités au portail propre à la direction.
      Les écrans historiques non encore isolés seront ouverts après validation de leurs contrôles serveur.
    </p>
  </section>;
}
