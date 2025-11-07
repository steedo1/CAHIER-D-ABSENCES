"use client";

import { useState } from "react";

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition",
        "placeholder:text-slate-400",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

export default function ParentsLoginPage() {
  const [matricule, setMatricule] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);

    try {
      const m = (matricule || "").trim().toUpperCase().replace(/\s+/g, "");
      if (!m) {
        setMsg("Veuillez saisir le matricule de l’élève.");
        setBusy(false);
        return;
      }

      // 👉 Attache le device parent à l’élève par matricule (pas de PIN)
      const res = await fetch("/api/parent/children/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ matricule: m }),
      });
      const j = await res.json().catch(() => ({} as any));

      if (!res.ok) throw new Error(j?.error || "Matricule introuvable.");

      // Succès → aller au tableau de bord parent
      window.location.href = "/parents";
    } catch (e: any) {
      setMsg(e?.message || "Matricule introuvable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-linear-to-b from-indigo-50 via-white to-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z" />
            </svg>
          </div>
          <span className="text-slate-900 text-sm font-semibold">
            Espace parent
          </span>
        </div>

        <a
          href="/"
          className="rounded-full bg-white px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
        >
          Accueil
        </a>
      </header>

      <section className="mx-auto my-6 w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Connexion parent</h1>
        <p className="mt-1 text-sm text-slate-600">
          Saisissez le <b>matricule de l’élève</b>. (Aucun PIN requis)
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <div>
            <label className="text-sm font-medium text-slate-700">
              Matricule élève
            </label>
            <Input
              inputMode="text"
              autoCapitalize="characters"
              value={matricule}
              onChange={(e) => setMatricule(e.target.value)}
              placeholder="Ex. 18602047X"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? "Connexion…" : "Se connecter"}
            </button>

            <a
              href="/parents"
              className="rounded-xl px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              Aller au tableau de bord
            </a>
          </div>

          {msg && <div className="text-sm text-rose-700">{msg}</div>}

          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-900">
            Astuce : après connexion, activez les <b>notifications push</b> dans le tableau de
            bord parent pour recevoir les alertes d’absence/retard.
          </div>
        </form>
      </section>
    </main>
  );
}
