// src/components/auth/LoginCard.tsx
"use client";

import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { clearOfflineAll } from "@/lib/offline";
import { clearRelayUserState } from "@/lib/local-relay";
import {
  authenticateOfflineLogin,
  clearOfflineLoginSession,
  enrollOfflineLogin,
  getOfflineLoginAvailability,
  getOfflineLoginOwnerUserId,
} from "@/lib/offline-auth";

type ForcedMode = "emailOnly" | "phoneOnly";
type LoginMode = "email" | "phone";

type LoginCardProps = {
  redirectTo?: string;
  forcedMode?: ForcedMode;
};

type LoginResponse = {
  ok?: boolean;
  error?: string;
  user?: { id?: string } | null;
  session?: {
    access_token?: string;
    refresh_token?: string;
  } | null;
};

type RoleResponse = {
  user_id?: string;
  role?: string | null;
  institution_id?: string | null;
};

function humanError(error?: string | null) {
  const value = String(error || "").trim();
  if (!value) return "Connexion impossible. Vérifie les informations saisies.";

  const lower = value.toLowerCase();
  if (value === "PASSWORD_REQUIRED") return "Mot de passe obligatoire.";
  if (value === "EMAIL_OR_PHONE_REQUIRED") return "Email ou téléphone obligatoire.";
  if (value === "PHONE_INVALID") return "Numéro de téléphone invalide.";
  if (value === "SERVER_SESSION_NOT_PERSISTED") {
    return "La session locale n’a pas été enregistrée. Recharge la page puis reconnecte-toi.";
  }
  if (value === "OFFLINE_LOGIN_NOT_CONFIGURED") {
    return "La connexion hors ligne n’a pas encore été activée sur cet appareil. Reconnecte Internet une fois.";
  }
  if (value === "OFFLINE_LOGIN_NOT_PREPARED") {
    return "Les données hors ligne de ce compte ne sont pas encore préparées sur cet appareil.";
  }
  if (value === "OFFLINE_LOGIN_EXPIRED") {
    return "L’autorisation hors ligne a expiré. Reconnecte Internet pour la renouveler.";
  }
  if (value === "OFFLINE_LOGIN_SHELL_STALE") {
    return "L’application hors ligne doit être actualisée. Reconnecte Internet puis relance la préparation.";
  }
  if (value === "OFFLINE_LOGIN_INVALID") {
    return "Identifiants incorrects pour la connexion hors ligne de cet appareil.";
  }
  if (value.startsWith("OFFLINE_LOGIN_LOCKED:")) {
    const seconds = Math.max(1, Number(value.split(":")[1] || 0));
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return `Trop de tentatives. Réessaie dans environ ${minutes} minute(s).`;
  }
  if (
    value === "OFFLINE_LOGIN_BROWSER_UNSUPPORTED" ||
    value === "OFFLINE_LOGIN_CREDENTIAL_INVALID"
  ) {
    return "Ce navigateur ne peut pas utiliser la connexion hors ligne sécurisée.";
  }
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "Identifiants incorrects. Vérifie le compte et le mot de passe.";
  }
  if (lower.includes("email not confirmed")) {
    return "Adresse email non confirmée.";
  }
  if (lower.includes("fetch") || lower.includes("network")) {
    return "Connexion réseau instable. Réessaie dans quelques secondes.";
  }

  return value;
}

function isNetworkFailure(error: unknown) {
  const name = String((error as any)?.name || "");
  const message = String((error as any)?.message || "").toLowerCase();
  return (
    name === "AbortError" ||
    error instanceof TypeError ||
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("réseau") ||
    message.includes("failed to fetch") ||
    message.includes("signal is aborted")
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white"
    />
  );
}

export default function LoginCard({ redirectTo = "/redirect", forcedMode }: LoginCardProps) {
  const initialMode: LoginMode = forcedMode === "emailOnly" ? "email" : "phone";

  const [mode, setMode] = useState<LoginMode>(initialMode);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);

  // ✅ Verrou immédiat anti double-clic, plus fiable que le state React seul.
  const busyRef = useRef(false);

  const modeLocked = !!forcedMode;
  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (!password.trim()) return false;
    if (mode === "email") return !!email.trim();
    return !!phone.trim();
  }, [busy, email, mode, password, phone]);

  useEffect(() => {
    setMode(forcedMode === "emailOnly" ? "email" : "phone");
  }, [forcedMode]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      setBrowserOnline(navigator.onLine);
      const availability = await getOfflineLoginAvailability().catch(() => null);
      if (!cancelled) setOfflineReady(Boolean(availability?.available));
    };
    void refresh();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);

  async function clearPreviousServerCookies() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_500);
    try {
      await fetch("/api/auth/sync", {
        method: "DELETE",
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      });
    } catch {
      // Tolérant : le login qui suit réécrira les bons cookies.
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function clearPreviousBrowserSession() {
    // On nettoie localement sans appeler supabase.auth.signOut() pour éviter
    // qu’un événement SIGNED_OUT asynchrone vienne effacer les nouveaux cookies
    // juste après une reconnexion rapide.
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (
          key === "mca-auth-v1" ||
          key.startsWith("sb-") ||
          key.includes("supabase.auth.token") ||
          key.includes("auth-token")
        ) {
          keys.push(key);
        }
      }
      keys.forEach((key) => window.localStorage.removeItem(key));
    } catch {
      // Tolérant.
    }

    try {
      const keys: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i += 1) {
        const key = window.sessionStorage.key(i);
        if (!key) continue;
        if (
          key === "mca-auth-v1" ||
          key.startsWith("sb-") ||
          key.includes("supabase.auth.token") ||
          key.includes("auth-token")
        ) {
          keys.push(key);
        }
      }
      keys.forEach((key) => window.sessionStorage.removeItem(key));
    } catch {
      // Tolérant.
    }
  }

  async function writeServerSession(accessToken: string, refreshToken: string) {
    const response = await fetch("/api/auth/sync", {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error("SERVER_SESSION_NOT_PERSISTED");
    }
  }

  async function syncBrowserSession(
    accessToken?: string,
    refreshToken?: string,
    expectedUserId?: string,
  ) {
    if (!accessToken || !refreshToken) {
      throw new Error("SERVER_SESSION_NOT_PERSISTED");
    }

    const supabase = getSupabaseBrowserClient();
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) throw sessionError;

    await writeServerSession(accessToken, refreshToken);

    // Vérification réelle : la requête suivante doit relire les cookies HttpOnly
    // et retrouver exactement le compte qui vient de se connecter.
    async function readServerSession() {
      const response = await fetch("/api/auth/role", {
        cache: "no-store",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    }

    let checked = await readServerSession();
    const wrongUser =
      !!expectedUserId && String(checked.payload?.user_id || "") !== expectedUserId;

    if (checked.response.status === 401 || wrongUser) {
      // Une seconde écriture couvre les navigateurs qui appliquent les cookies
      // à la fin du premier cycle de requête ou une ancienne session résiduelle.
      await writeServerSession(accessToken, refreshToken);
      checked = await readServerSession();
    }

    if (
      checked.response.status === 401 ||
      (!!expectedUserId && String(checked.payload?.user_id || "") !== expectedUserId)
    ) {
      throw new Error("SERVER_SESSION_NOT_PERSISTED");
    }

    return checked.payload as RoleResponse;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // ✅ Empêche les clics répétés avant même le prochain render.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setStatusText("Préparation de la connexion…");

    try {
      const identifierKind = mode === "email" ? "email" : "phone";
      const identifier = mode === "email" ? email.trim() : phone.trim();

      // Important après une déconnexion/reconnexion : on enlève les anciens restes.
      clearPreviousBrowserSession();
      await clearPreviousServerCookies();

      setStatusText("Vérification des identifiants…");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      let res: Response;
      try {
        res = await fetch("/api/auth/login", {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: mode === "email" ? email.trim() : undefined,
            phone: mode === "phone" ? phone.trim() : undefined,
            password,
            country: "CI",
          }),
        });
      } finally {
        window.clearTimeout(timeout);
      }

      const json = (await res.json().catch(() => ({}))) as LoginResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP_${res.status}`);
      }

      setStatusText("Sécurisation de cet appareil…");
      const authenticatedUserId = String(json.user?.id || "").trim();
      const preparedUserId = await getOfflineLoginOwnerUserId().catch(() => null);

      if (authenticatedUserId && preparedUserId === authenticatedUserId) {
        // Même utilisateur : conserver son bundle, ses opérations en attente et
        // son accès relais. Seule l'ancienne session locale est fermée.
        clearOfflineLoginSession();
      } else {
        // Changement réel de compte : aucune donnée de l'ancien utilisateur ne
        // doit être exposée au nouveau compte.
        await Promise.allSettled([clearOfflineAll(), clearRelayUserState()]);
      }

      setStatusText("Ouverture de votre espace…");
      const role = await syncBrowserSession(
        json.session?.access_token,
        json.session?.refresh_token,
        authenticatedUserId,
      );

      await enrollOfflineLogin({
        identifierKind,
        identifier,
        password,
        userId: String(json.user?.id || role?.user_id || ""),
        role: role?.role,
        institutionId: role?.institution_id,
      }).catch((offlineError) => {
        console.warn(
          "[login] activation hors ligne ignorée:",
          String((offlineError as any)?.message || offlineError),
        );
      });

      // ✅ Navigation complète volontaire : évite les caches client/RSC et la course avec /redirect.
      window.location.assign(redirectTo || "/redirect");
      return;
    } catch (err: any) {
      if (isNetworkFailure(err)) {
        try {
          setStatusText("Cloud indisponible. Vérification sécurisée sur cet appareil…");
          const offline = await authenticateOfflineLogin({
            identifierKind: mode === "email" ? "email" : "phone",
            identifier: mode === "email" ? email.trim() : phone.trim(),
            password,
          });
          setStatusText("Connexion hors ligne confirmée. Ouverture de l’application…");
          window.location.assign(offline.destination);
          return;
        } catch (offlineError: any) {
          setError(humanError(offlineError?.message));
        }
      } else {
        setError(humanError(err?.message));
      }
      setStatusText(null);
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[28px] border border-white/60 bg-white/95 p-5 shadow-2xl shadow-slate-900/20 backdrop-blur md:p-6">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
          Connexion sécurisée
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
          Accéder à Mon Cahier
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Saisis tes identifiants puis patiente pendant l’ouverture de ton espace.
        </p>
      </div>

      {!modeLocked ? (
        <div className="mb-4 grid grid-cols-2 rounded-2xl bg-slate-100 p-1 text-sm font-semibold text-slate-600">
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("phone")}
            className={[
              "rounded-xl px-3 py-2 transition disabled:cursor-not-allowed disabled:opacity-60",
              mode === "phone" ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950",
            ].join(" ")}
          >
            Téléphone
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("email")}
            className={[
              "rounded-xl px-3 py-2 transition disabled:cursor-not-allowed disabled:opacity-60",
              mode === "email" ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950",
            ].join(" ")}
          >
            Email
          </button>
        </div>
      ) : null}

      {offlineReady ? (
        <div
          className={[
            "mb-4 rounded-2xl border px-4 py-3 text-sm font-medium",
            browserOnline
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800",
          ].join(" ")}
        >
          {browserOnline
            ? "Connexion hors ligne prête sur cet appareil."
            : "Internet indisponible : utilise les mêmes identifiants pour ouvrir les données préparées."}
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={onSubmit}>
        {mode === "email" ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="direction@ecole.ci"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">
              Téléphone
            </span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              disabled={busy}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07 13 02 37 62"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            />
          </label>
        )}

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">
            Mot de passe
          </span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : null}

        {statusText ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {statusText}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          aria-busy={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#003766] px-4 py-3 text-sm font-extrabold text-white shadow-lg shadow-slate-900/20 transition hover:bg-[#002b50] focus:outline-none focus:ring-4 focus:ring-[#003766]/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Spinner /> : null}
          {busy ? "Connexion en cours…" : "Connexion"}
        </button>
      </form>

      <p className="mt-4 text-center text-xs leading-5 text-slate-500">
        Un seul clic suffit : le bouton reste verrouillé pendant la vérification et la redirection.
      </p>
    </div>
  );
}
