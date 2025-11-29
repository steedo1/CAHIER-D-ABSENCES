// src/app/parents/login/page.tsx
"use client";

import { useState } from "react";
import Image from "next/image";

/** Icône Famille (inline, pas de dépendance) */
function FamilyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      {...props}
    >
      {/* parents */}
      <circle cx="16" cy="14" r="4" />
      <circle cx="32" cy="12.5" r="4" />
      <path d="M10 28c0-4 3.5-7 8-7s8 3 8 7v7H10v-7Z" />
      <path d="M26 26c0-3.5 3-6.5 7-6.5s7 3 7 6.5v9H26v-9Z" />
      {/* enfant */}
      <circle cx="24" cy="20.5" r="3" />
      <path d="M18.5 34.5c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5V38H18.5v-3.5Z" />
    </svg>
  );
}

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
      try {
        j = await res.json();
      } catch {}

      console.info(`[parents.login:${_rid}] response`, {
        status: res.status,
        body: j,
      });

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
    <main
      className={[
        "relative min-h-[100svh]",
        // Dégradé principal, pro & fun
        "bg-gradient-to-b from-emerald-50 via-white to-sky-50",
      ].join(" ")}
    >
      {/* Décors doux (bulles dégradées) */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="absolute -right-24 top-1/4 h-56 w-56 rounded-full bg-sky-200/40 blur-3xl" />
        <div className="absolute left-1/4 bottom-0 h-60 w-60 rounded-full bg-indigo-200/30 blur-3xl" />
      </div>

      {/* Contenu */}
      <div className="relative z-0 mx-auto flex min-h-[100svh] max-w-7xl items-center justify-center px-4 py-10 md:py-12">
        <div className="grid w-full grid-cols-1 gap-8 md:grid-cols-12">
          {/* Pitch (desktop) */}
          <section className="hidden md:col-span-6 md:flex md:flex-col md:justify-center">
            <div className="max-w-md text-slate-800">
              <h1 className="text-3xl font-extrabold leading-tight md:text-4xl">
                Espace Parents
              </h1>
              <p className="mt-3 text-slate-600">
                Suivez en temps réel la présence, les retards et la conduite de
                votre enfant.
              </p>
              {/* Grande icône déco */}
              <FamilyIcon className="mt-6 h-20 w-20 text-emerald-600" />
            </div>
          </section>

          {/* Carte de connexion */}
          <section className="md:col-span-6 flex items-center justify-center">
            <form
              onSubmit={onSubmit}
              className={[
                "w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/80",
                "backdrop-blur-xl shadow-2xl",
                "p-6 md:p-8 space-y-5",
              ].join(" ")}
            >
              {/* En-tête carte */}
              <div className="flex items-center gap-3">
                <div className="relative h-10 w-10 rounded-xl bg-white shadow">
                  <Image
                    src="/nexa-digital-logo.png" // place ton logo dans /public
                    alt="NEXA DIGITALE FOR EDUCATION"
                    fill
                    className="object-contain"
                    priority
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-800">
                    NEXA DIGITALE FOR EDUCATION
                  </div>
                  <div className="text-xs text-slate-500">
                    Espace Parents · Connexion par matricule élève
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
                  inputMode="text"
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
                      aria-hidden="true"
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
                Astuce : après connexion, activez les <b>notifications push</b>{" "}
                dans le tableau de bord parent.
              </div>

              {/* Mentions */}
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
