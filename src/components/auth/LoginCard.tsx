// src/components/auth/LoginCard.tsx
"use client";

import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  activateOfflineAccess,
  authenticateOfflineAccess,
  clearActiveOfflineAccess,
  disableOfflineAccessForIdentifier,
  getOrCreateOfflineDeviceId,
  provisionOfflineAccess,
} from "@/lib/offline-auth-client";

type ForcedMode = "emailOnly" | "phoneOnly";
type LoginMode = "email" | "phone";

type LoginCardProps = {
  redirectTo?: string;
  forcedMode?: ForcedMode;
  onAuthenticated?: (destination: string) => void | Promise<void>;
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
  user_id?: string | null;
  role?: string | null;
  institution_id?: string | null;
  offline_access?: {
    token?: string;
    expires_at?: number;
    destination?: string;
    role?: string;
  } | null;
};

const AUTH_REQUEST_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function humanError(error?: string | null) {
  const value = String(error || "").trim();
  if (!value) return "Connexion impossible. Vérifie les informations saisies.";

  const lower = value.toLowerCase();
  if (value === "PASSWORD_REQUIRED") return "Mot de passe obligatoire.";
  if (value === "EMAIL_OR_PHONE_REQUIRED") return "Email ou numéro obligatoire.";
  if (value === "PHONE_INVALID") return "Numéro de téléphone invalide.";
  if (value === "CLASS_IDENTIFIER_INSTITUTION_REQUIRED") {
    return "Ce numéro est utilisé dans plusieurs établissements. Contacte ton établissement.";
  }
  if (value === "CLASS_IDENTIFIER_INSTITUTION_UNKNOWN") {
    return "Établissement introuvable pour ce numéro.";
  }
  if (value === "SERVER_SESSION_NOT_PERSISTED") {
    return "La session locale n’a pas été enregistrée. Recharge la page puis reconnecte-toi.";
  }
  if (value === "offline_access_not_prepared") {
    return "Cet appareil n’a pas encore été autorisé en ligne pour cette connexion.";
  }
  if (value === "offline_access_expired") {
    return "L’autorisation hors ligne de cet appareil a expiré. Reconnectez-le à Internet.";
  }
  if (value === "offline_access_disabled") {
    return "L’accès hors ligne de ce compte a été désactivé sur cet appareil.";
  }
  if (value === "offline_credentials_invalid") {
    return "Informations incorrectes pour l’accès hors ligne de cet appareil.";
  }
  if (value === "offline_function_not_prepared") {
    return "Les données indispensables à ce rôle ne sont pas encore prêtes sur cet appareil.";
  }
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "Informations incorrectes. Vérifie le numéro ou l’email et le mot de passe.";
  }
  if (lower.includes("email not confirmed")) {
    return "Adresse email non confirmée.";
  }
  if (lower.includes("fetch") || lower.includes("network")) {
    return "Connexion réseau instable. Réessaie dans quelques secondes.";
  }

  return value;
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white"
    />
  );
}

export default function LoginCard({ redirectTo = "/redirect", forcedMode, onAuthenticated }: LoginCardProps) {
  const initialMode: LoginMode = forcedMode === "emailOnly" ? "email" : "phone";

  const [mode, setMode] = useState<LoginMode>(initialMode);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  // ✅ Verrou immédiat anti double-clic, plus fiable que le state React seul.
  const busyRef = useRef(false);

  const modeLocked = !!forcedMode;
  const offlineIdentifier = mode === "email" ? email : phone;
  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (!password.trim()) return false;
    if (mode === "email") return !!email.trim();
    return !!phone.trim();
  }, [busy, email, mode, password, phone]);

  useEffect(() => {
    setMode(forcedMode === "emailOnly" ? "email" : "phone");
  }, [forcedMode]);

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
    const response = await fetchWithTimeout("/api/auth/sync", {
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
    deviceId?: string,
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
      const response = await fetchWithTimeout("/api/auth/role", {
        cache: "no-store",
        credentials: "include",
        headers: deviceId
          ? { "X-Mon-Cahier-Device-Id": deviceId }
          : undefined,
      });
      const payload = (await response.json().catch(() => ({}))) as RoleResponse;
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
      !checked.response.ok ||
      (!!expectedUserId && String(checked.payload?.user_id || "") !== expectedUserId)
    ) {
      throw new Error("SERVER_SESSION_NOT_PERSISTED");
    }
    return checked.payload;
  }

  async function openOfflineSession() {
    setStatusText("Vérification de l’autorisation locale…");
    const authorized = await authenticateOfflineAccess({
      mode,
      identifier: offlineIdentifier,
      password,
    });
    // Le nettoyage intervient seulement après une validation locale complète.
    clearPreviousBrowserSession();
    activateOfflineAccess(authorized);
    setStatusText("Connexion hors ligne autorisée sur cet appareil…");
    if (onAuthenticated) {
      await onAuthenticated(authorized.payload.destination);
      return;
    }
    window.location.assign(authorized.payload.destination);
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
      setStatusText("Vérification…");
      let res: Response;
      try {
        res = await fetchWithTimeout("/api/auth/login", {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: mode === "email" ? email.trim() : undefined,
            phone: mode === "phone" ? phone.trim() : undefined,
            password,
            country: "CI",
          }),
        });
      } catch {
        await openOfflineSession();
        return;
      }

      const json = (await res.json().catch(() => ({}))) as LoginResponse;
      if (!res.ok || !json.ok) {
        if (res.status >= 500) {
          await openOfflineSession();
          return;
        }
        // Un 401/403 explicite n'est jamais converti en connexion hors ligne.
        if (
          (res.status === 401 || res.status === 403) &&
          /disabled|banned|inactive|désactiv/i.test(String(json.error || ""))
        ) {
          await disableOfflineAccessForIdentifier({
            mode,
            identifier: offlineIdentifier,
          }).catch(() => undefined);
        }
        throw new Error(json.error || `HTTP_${res.status}`);
      }

      await clearActiveOfflineAccess().catch(() => undefined);
      setStatusText("Ouverture de votre espace…");
      let deviceId = "";
      try {
        deviceId = getOrCreateOfflineDeviceId();
      } catch {
        // Le login en ligne reste disponible si le stockage local est bloqué.
      }
      const role = await syncBrowserSession(
        json.session?.access_token,
        json.session?.refresh_token,
        json.user?.id,
        deviceId,
      );

      const grantToken = String(role?.offline_access?.token || "");
      if (grantToken && deviceId) {
        setStatusText("Autorisation de cet appareil…");
        await provisionOfflineAccess({
          mode,
          identifier: offlineIdentifier,
          password,
          grantToken,
        }).catch((cause) => {
          console.warn("[offline-auth] provisioning_failed", cause);
        });
      }

      const destination = String(
        role?.offline_access?.destination || redirectTo || "/redirect",
      ).trim() || "/redirect";
      if (onAuthenticated) {
        await onAuthenticated(destination);
        return;
      }

      // Navigation complète pour le login global. Le verrou PWA du téléphone de
      // classe utilise onAuthenticated afin de conserver le runtime déjà chargé.
      window.location.assign(redirectTo || "/redirect");
      return;
    } catch (err: any) {
      setError(humanError(err?.message));
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
            Numéro
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
              Numéro
            </span>
            <input
              type="text"
              inputMode="text"
              autoComplete="username"
              value={phone}
              disabled={busy}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ex. 07 01 02 03 04"
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

    </div>
  );
}
