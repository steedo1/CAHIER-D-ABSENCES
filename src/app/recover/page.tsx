"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const supabase = getSupabaseBrowserClient();
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/redirect`,
      });
      if (error) throw error;
      setMsg("Email de rÃ©initialisation envoyÃ©.");
    } catch (err: any) {
      setMsg(err.message || "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold mb-4">Mot de passe oubliÃ©</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="email"
          required
          placeholder="email@exemple.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
        <button className="w-full rounded bg-black text-white py-2" disabled={loading}>
          {loading ? "..." : "Envoyer"}
        </button>
        {msg && <p className="text-sm text-gray-600">{msg}</p>}
      </form>
    </main>
  );
}
