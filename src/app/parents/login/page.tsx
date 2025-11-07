"use client";
import { useState } from "react";

export default function ParentsLoginPage() {
  const [matricule, setMatricule] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/parent/children/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matricule }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "ATTACH_FAILED");

      // attach ok -> aller au tableau de bord
      window.location.href = "/parents";
    } catch (e: any) {
      const err = String(e?.message || e);
      setMsg(
        err === "MATRICULE_NOT_FOUND"
          ? "Matricule introuvable."
          : "Échec de connexion. Réessayez."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-linear-to-b from-indigo-50 via-white to-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z" />
            </svg>
          </div>
          <span className="text-slate-900 font-semibold">Connexion parent</span>
        </div>
        <a href="/" className="text-sm text-slate-700 hover:underline">Accueil</a>
      </header>

      <div className="mx-auto max-w-xl px-4 pb-16">
        <form onSubmit={onSubmit} className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Matricule élève</label>
            <input
              value={matricule}
              onChange={(e) => setMatricule(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20"
              placeholder="Ex : 18602047X"
              required
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !matricule.trim()}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? "Connexion…" : "Se connecter"}
            </button>
            <a href="/parents" className="text-sm text-slate-700 hover:underline">Aller au tableau de bord</a>
          </div>

          {msg && <div className="text-sm text-rose-600">{msg}</div>}

          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            Astuce : après connexion, activez les <b>notifications push</b> dans le tableau de bord parent.
          </div>
        </form>
      </div>
    </main>
  );
}
