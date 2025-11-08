// src/app/parents/login/page.tsx
"use client";

import { useState } from "react";

/**
 * ⚠️ Placez votre image de fond dans /public/parent.png
 * (sur Linux/Vercel, la casse du nom de fichier compte).
 */

export default function ParentsLoginPage() {
  const [matricule, setMatricule] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!matricule.trim()) return;
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
      // OK → redirection tableau de bord
      window.location.href = "/parents";
    } catch (e: any) {
      console.error(`[parents.login:${_rid}] fatal`, e);
      setMsg("Échec de connexion. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen">
      {/* --- Fond image + overlays --- */}
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-cover bg-center"
        style={{ backgroundImage: "url(/parent.png)" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-black/50 via-black/25 to-white/70 md:bg-gradient-to-r md:from-black/60 md:via-black/20 md:to-white/70"
      />

      {/* --- Contenu centré --- */}
      <div className="relative z-0 mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 py-10">
        <div className="grid w-full grid-cols-1 gap-8 md:grid-cols-12">
          {/* Pitch (caché sur petits écrans pour garder la sobriété) */}
          <section className="hidden md:col-span-6 md:flex md:flex-col md:justify-center">
            <div className="max-w-md text-white drop-shadow">
              <h1 className="text-3xl font-bold leading-tight md:text-4xl">
                Espace Parents
              </h1>
              <p className="mt-3 text-white/90">
                Suivez en temps réel la présence, les retards et la conduite de votre enfant.
              </p>
            </div>
          </section>

          {/* Carte de connexion */}
          <section className="md:col-span-6 flex items-center justify-center">
            <form
              onSubmit={onSubmit}
              className={[
                "w-full max-w-md rounded-2xl border border-white/40 bg-white/80",
                "backdrop-blur-xl shadow-2xl",
                "p-6 md:p-8 space-y-5",
              ].join(" ")}
            >
              {/* En-tête compact */}
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-600 text-white shadow">
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
                <div>
                  <div className="text-sm font-medium text-slate-700">
                    Mon Cahier d’Absences
                  </div>
                  <div className="text-xs text-slate-500">
                    Connexion par matricule élève
                  </div>
                </div>
              </div>

              {/* Champ matricule */}
              <div>
                <label
                  htmlFor="matricule"
                  className="block text-sm font-medium text-slate-700"
                >
                  Matricule élève
                </label>
                <input
                  id="matricule"
                  value={matricule}
                  onChange={(e) => setMatricule(e.target.value.toUpperCase())}
                  className={[
                    "mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm",
                    "shadow-sm outline-none transition",
                    "placeholder:text-slate-400",
                    "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
                    "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
                  ].join(" ")}
                  placeholder="Ex : 20166309J"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"   // ⬅️ correction: 'latin' -> 'text'
                  required
                  autoFocus
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={busy || !matricule.trim()}
                  className={[
                    "inline-flex items-center justify-center gap-2 rounded-xl",
                    "bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow",
                    "hover:bg-emerald-700 active:translate-y-px",
                    "disabled:opacity-60 disabled:hover:none",
                  ].join(" ")}
                >
                  {busy && (
                    <svg
                      className="h-4 w-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path d="M12 3a9 9 0 1 0 9 9" />
                    </svg>
                  )}
                  {busy ? "Connexion…" : "Se connecter"}
                </button>

                <a
                  href="/parents"
                  className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline"
                >
                  Aller au tableau de bord
                </a>
              </div>

              {/* Message d’erreur */}
              {msg && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                  {msg}
                </div>
              )}

              {/* Aide */}
              <div className="rounded-xl bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
                Astuce : après connexion, activez les <b>notifications push</b> dans
                le tableau de bord parent.
              </div>

              {/* Mentions discrètes */}
              <p className="text-center text-xs text-slate-500">
                En continuant, vous acceptez nos conditions d’utilisation.
              </p>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
