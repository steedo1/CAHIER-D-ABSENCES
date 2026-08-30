"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, ShieldCheck } from "lucide-react";

export default function CreateFileCorrespondentPage() {
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!phone.trim() || busy) return;

    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/users/create-file-correspondent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          phone: phone.trim(),
          email: email.trim() || null,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Impossible de créer le compte.",
        );
      }

      setMessage("Compte Correspondant fichier créé avec succès.");
      setDisplayName("");
      setPhone("");
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-600">
            Utilisateurs & rôles
          </div>
          <h1 className="mt-1 text-2xl font-black text-slate-950">
            Créer un Correspondant fichier
          </h1>
        </div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Link>
      </div>

      <section className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white shadow-sm">
            <FileSpreadsheet className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-base font-black text-slate-950">Accès strictement dédié</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Ce profil possède sa propre navigation. Il ne voit pas le tableau de bord
              Admin ni les autres modules de l’établissement.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-800">Correspondant fichier</span>
              <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">Organisation scolaire</span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Paramètres</span>
            </div>
          </div>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center gap-2 text-sm font-black text-slate-900">
          <ShieldCheck className="h-5 w-5 text-violet-600" />
          Informations du compte
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-bold text-slate-600">Nom affiché</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10"
              placeholder="Mme/M. NOM"
              autoComplete="name"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-bold text-slate-600">Téléphone *</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10"
              placeholder="+225..."
              autoComplete="tel"
              required
            />
          </label>

          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-bold text-slate-600">Email (optionnel)</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10"
              placeholder="utilisateur@exemple.com"
              autoComplete="email"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || !phone.trim()}
            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Création…" : "Créer le compte"}
          </button>

          {message ? (
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {message}
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}
      </form>
    </main>
  );
}
