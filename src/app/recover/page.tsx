"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin + "/reset-password",
      });
      if (sendError) throw sendError;
      setMessage("Si cette adresse possède un compte, un lien de récupération vient d'être envoyé. Ouvre uniquement le courriel le plus récent.");
    } catch {
      setError("Envoi impossible pour le moment. Réessaie dans quelques instants.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-sky-50 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-emerald-100 bg-white p-6 shadow-xl shadow-emerald-900/10 sm:p-9">
        <p className="text-xs font-black uppercase tracking-widest text-emerald-700">Mon Cahier — Sécurité</p>
        <h1 className="mt-3 text-2xl font-black text-slate-950">Mot de passe oublié ?</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Indique l'adresse email de ton compte. Nous t'enverrons un lien pour choisir un nouveau mot de passe.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Adresse email</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@exemple.com" className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
          </label>
          <button type="submit" disabled={loading || !email.trim()} className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            {loading ? "Envoi…" : "Recevoir un lien de récupération"}
          </button>
          {message && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-800">{message}</p>}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700">{error}</p>}
        </form>
        <Link href="/login?space=fondateur" className="mt-6 inline-block text-sm font-semibold text-emerald-700 hover:underline">Retour à la connexion</Link>
      </section>
    </main>
  );
}
