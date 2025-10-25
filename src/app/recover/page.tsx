// src/app/recover/page.tsx
"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    setErr(null);

    const supabase = getSupabaseBrowserClient(); // ✅ appelé dans un handler (navigateur)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/redirect`,
      });
      if (error) throw error;
      setMsg("Email de réinitialisation envoyé.");
    } catch (e: any) {
      setErr(e?.message || "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-semibold">Mot de passe oublié</h1>

      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <input
          type="email"
          required
          placeholder="email@exemple.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border px-3 py-2"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />

        <button
          type="submit"
          className="w-full rounded bg-black py-2 text-white disabled:opacity-60"
          disabled={loading || !email}
        >
          {loading ? "Envoi…" : "Envoyer"}
        </button>

        {msg && (
          <p className="text-sm text-green-700" aria-live="polite">
            {msg}
          </p>
        )}
        {err && (
          <p className="text-sm text-red-700" aria-live="assertive">
            {err}
          </p>
        )}
      </form>
    </main>
  );
}


