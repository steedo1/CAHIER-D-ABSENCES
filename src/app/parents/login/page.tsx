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
    const _rid = Math.random().toString(36).slice(2, 8);
    try {
      console.info(`[parents.login:${_rid}] submit`, { matricule });
      const res = await fetch("/api/parent/children/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matricule }),
      });
      let j: any = {};
      try { j = await res.json(); } catch {}
      console.info(`[parents.login:${_rid}] response`, { status: res.status, body: j });

      if (!res.ok) {
        const err = String(j?.error || "ATTACH_FAILED");
        setMsg(err === "MATRICULE_NOT_FOUND" ? "Matricule introuvable." : err);
        return;
      }
      // OK → redirection
      window.location.href = "/parents";
    } catch (e: any) {
      console.error(`[parents.login:${_rid}] fatal`, e);
      setMsg("Échec de connexion. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-linear-to-b from-indigo-50 via-white to-white">
      <div className="mx-auto max-w-xl px-4 py-12">
        <form onSubmit={onSubmit} className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Matricule élève</label>
            <input
              value={matricule}
              onChange={(e) => setMatricule(e.target.value.toUpperCase())}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20"
              placeholder="Ex : 20166309J"
              required
              autoFocus
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
