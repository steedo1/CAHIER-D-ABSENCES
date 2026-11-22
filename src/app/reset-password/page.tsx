"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Phase = "verifying" | "ready" | "invalid" | "success";
const RECOVERY_MARKER = "mca-password-recovery-started";

function explainError(code: string) {
  if (code.includes("expired") || code.includes("invalid")) {
    return "Ce lien de récupération est expiré, a déjà été utilisé ou n'est plus valide. Demande un nouveau courriel, puis ouvre uniquement le lien le plus récent.";
  }
  return "Le lien de récupération n'a pas pu être vérifié. Demande un nouveau courriel.";
}

export default function ResetPasswordPage() {
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>("verifying");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let mounted = true;

    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const failure = query.get("error_code") || fragment.get("error_code") ||
      query.get("error") || fragment.get("error");

    const tokenHash = query.get("token_hash");
    const code = query.get("code");
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    const recoveryType = fragment.get("type") === "recovery" || query.get("type") === "recovery";
    const markedAt = Number(window.sessionStorage.getItem(RECOVERY_MARKER) || "0");
    const recentlyStarted = markedAt > 0 && Date.now() - markedAt < 15 * 60 * 1000;

    // Supprime les codes/tokens de l'URL visible dès leur lecture.
    window.history.replaceState(window.history.state, "", "/reset-password");

    if (failure) {
      window.sessionStorage.removeItem(RECOVERY_MARKER);
      setError(explainError(failure));
      setPhase("invalid");
      return;
    }

    if (!(recoveryType || (tokenHash && query.get("type") === "recovery") || (code && recentlyStarted) || recentlyStarted)) {
      setError("Utilise le lien reçu par email pour choisir un nouveau mot de passe.");
      setPhase("invalid");
      return;
    }

    const verify = async () => {
      try {
        const supabase = getSupabaseBrowserClient();

        if (tokenHash && query.get("type") === "recovery") {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            type: "recovery",
            token_hash: tokenHash,
          });
          if (verifyError) throw verifyError;
        } else if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (accessToken && refreshToken && recoveryType) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        }

        // Le mot de passe ne peut être changé que pour l'identité vérifiée par Supabase.
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) throw userError || new Error("Aucune session de récupération valide.");
        if (mounted) setPhase("ready");
      } catch (e: unknown) {
        if (mounted) {
          const message = e instanceof Error ? e.message : "invalid";
          setError(explainError(message.toLowerCase()));
          setPhase("invalid");
        }
        window.sessionStorage.removeItem(RECOVERY_MARKER);
      }
    };
    void verify();
    return () => { mounted = false; };
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || phase !== "ready") return;
    setError("");
    if (password.length < 8) {
      setError("Utilise au moins 8 caractères.");
      return;
    }
    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      window.sessionStorage.removeItem(RECOVERY_MARKER);
      setPassword("");
      setConfirmation("");
      setPhase("success");
      // Terminer la session de récupération sans réutiliser une connexion ouverte.
      await supabase.auth.signOut().catch(() => undefined);
      await fetch("/api/auth/sync", { method: "DELETE", credentials: "include", cache: "no-store" }).catch(() => undefined);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Impossible de modifier le mot de passe.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-sky-50 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-emerald-100 bg-white p-6 shadow-xl shadow-emerald-900/10 sm:p-9">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-lg font-black text-white">M</div>
          <div>
            <p className="text-sm font-black text-emerald-700">Mon Cahier</p>
            <p className="text-xs text-slate-500">Sécurité du compte</p>
          </div>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-slate-950">Nouveau mot de passe</h1>
        {phase === "verifying" && <p className="mt-4 text-sm text-slate-600" role="status">Vérification du lien sécurisé…</p>}

        {phase === "ready" && (
          <>
            <p className="mt-3 text-sm text-slate-600">Choisis un nouveau mot de passe pour ton compte. L'ancien mot de passe n'est pas nécessaire.</p>
            <form className="mt-6 space-y-4" onSubmit={submit}>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Nouveau mot de passe</span>
                <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" disabled={busy} />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Confirmer le mot de passe</span>
                <input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" disabled={busy} />
              </label>
              {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
              <button type="submit" disabled={busy} className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy ? "Enregistrement…" : "Enregistrer mon nouveau mot de passe"}
              </button>
            </form>
          </>
        )}

        {phase === "invalid" && (
          <div className="mt-5 space-y-4">
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">{error}</p>
            <Link href="/recover" className="inline-flex rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700">Demander un nouveau lien</Link>
          </div>
        )}

        {phase === "success" && (
          <div className="mt-5 space-y-4">
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status">Ton mot de passe a été modifié avec succès.</p>
            <Link href="/login?space=fondateur" className="inline-flex rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700">Se connecter</Link>
          </div>
        )}
        <div className="mt-7 border-t border-slate-100 pt-5">
          <Link href="/login?space=fondateur" className="text-sm font-semibold text-emerald-700 hover:underline">Retour à la connexion</Link>
        </div>
      </section>
    </main>
  );
}
