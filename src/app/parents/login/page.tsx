"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = p;
  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow transition",
        "bg-emerald-600 text-white hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/30",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        className ?? "",
      ].join(" ")}
    />
  );
}

export default function ParentsLoginPage() {
  const router = useRouter();
  const [matricule, setMatricule] = useState("");
  const [pin, setPin] = useState(""); // optionnel
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!matricule.trim()) {
      setMsg("Entre le matricule de l’élève.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/parent/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ matricule: matricule.trim(), pin: pin.trim() || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(j?.error || "Échec de connexion. Vérifie le matricule (et le PIN si requis).");
      } else {
        router.replace("/parents"); // redirige vers le tableau de bord parent
      }
    } catch (err: any) {
      setMsg(err?.message || "Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-linear-to-b from-indigo-50 via-white to-white">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-slate-800">Espace Parent</span>
        </div>
        <a
          href="/"
          className="rounded-full bg-slate-900 px-3 py-1.5 text-sm text-white ring-1 ring-slate-700 hover:bg-slate-800"
        >
          Accueil
        </a>
      </header>

      <section className="mx-auto max-w-md px-4 pb-16">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Connexion parent</h1>
          <p className="mt-1 text-sm text-slate-600">
            Saisissez le <b>matricule</b> de l’élève (et le <b>PIN</b> si l’établissement en a défini un).
          </p>

          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div>
              <div className="mb-1 text-xs text-slate-500">Matricule élève</div>
              <Input
                autoFocus
                placeholder="Ex. CSK-000657"
                value={matricule}
                onChange={(e) => setMatricule(e.target.value)}
                autoComplete="off"
                inputMode="text"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>PIN (optionnel)</span>
                <button
                  type="button"
                  onClick={() => setShowPin((v) => !v)}
                  className="text-emerald-700 underline-offset-2 hover:underline"
                >
                  {showPin ? "Masquer" : "Afficher"}
                </button>
              </div>
              <Input
                type={showPin ? "text" : "password"}
                placeholder="PIN si requis"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </div>

            <div className="pt-2">
              <Button type="submit" disabled={loading || !matricule.trim()}>
                {loading ? "Connexion…" : "Se connecter"}
              </Button>
              <a
                href="/parents"
                className="ml-3 text-sm text-slate-700 underline-offset-2 hover:underline"
                title="Aller au tableau de bord"
              >
                Aller au tableau de bord
              </a>
            </div>

            {msg && (
              <div className="text-sm text-rose-700">{msg}</div>
            )}
          </form>

          <div className="mt-4 rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
            Astuce : après connexion, activez les <b>notifications push</b> dans le tableau de bord parent pour recevoir les alertes d’absence/retard.
          </div>
        </div>
      </section>
    </main>
  );
}
