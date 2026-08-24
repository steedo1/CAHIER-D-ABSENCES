"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import {
  getAdminScheduleSyncState,
  getRelayConfig,
  markRelayScheduleSyncPending,
  relayBootstrapErrorMessage,
  subscribeAdminScheduleSync,
  syncRelayScheduleAfterMutation,
  type AdminScheduleSyncState,
} from "@/lib/local-relay";
import { isOfflineScheduleMutation } from "@/lib/admin-offline-schedule";

type RelayMode = "checking" | "enabled" | "disabled";

type RolePayload = {
  relay?: {
    configured?: boolean;
    enabled?: boolean;
    local_url?: string | null;
  } | null;
};

function requestPath(input: RequestInfo | URL) {
  try {
    if (input instanceof Request) return new URL(input.url).pathname;
    return new URL(String(input), window.location.origin).pathname;
  } catch {
    return "";
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

export default function OfflineScheduleSyncBridge() {
  const [state, setState] = useState<AdminScheduleSyncState | null>(null);
  const [relayMode, setRelayMode] = useState<RelayMode>("checking");
  const relayModeRef = useRef<RelayMode>("checking");

  useEffect(() => subscribeAdminScheduleSync((next) => {
    if (relayModeRef.current === "enabled") setState(next);
  }), []);

  useEffect(() => {
    let cancelled = false;
    const previousFetch = window.fetch;

    const refreshRelayMode = async () => {
      let enabled = false;
      let localUrl: string | null = null;

      try {
        const response = await previousFetch("/api/auth/role", {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const payload = (await response.json().catch(() => ({}))) as RolePayload;
        enabled = response.ok && payload?.relay?.enabled === true;
        localUrl = enabled
          ? String(payload?.relay?.local_url || "").trim() || null
          : null;
      } catch {
        // Fail closed : une politique relais impossible à confirmer ne doit jamais
        // transformer un établissement Cloud normal en établissement relais.
        enabled = false;
      }

      if (cancelled) return;

      const nextMode: RelayMode = enabled ? "enabled" : "disabled";
      relayModeRef.current = nextMode;
      setRelayMode(nextMode);

      if (!enabled) {
        setState(null);
        return;
      }

      // L'URL enregistrée par le serveur est seulement une aide de configuration.
      // On ne remplace jamais ici un réglage local déjà provisionné avec son jeton.
      if (localUrl && !window.localStorage.getItem("moncahier:relay:url")) {
        window.localStorage.setItem("moncahier:relay:url", localUrl);
      }

      const persisted = getAdminScheduleSyncState();
      setState(persisted);
      if (
        persisted &&
        persisted.status !== "synced" &&
        getRelayConfig().token
      ) {
        void syncRelayScheduleAfterMutation();
      }
    };

    const interceptedFetch: typeof window.fetch = async (input, init) => {
      const response = await previousFetch(input, init);
      if (
        response.ok &&
        relayModeRef.current === "enabled" &&
        isOfflineScheduleMutation(
          requestPath(input),
          requestMethod(input, init),
        )
      ) {
        markRelayScheduleSyncPending();
        if (getRelayConfig().token) {
          void syncRelayScheduleAfterMutation();
        }
      }
      return response;
    };

    window.fetch = interceptedFetch;
    void refreshRelayMode();

    return () => {
      cancelled = true;
      if (window.fetch === interceptedFetch) window.fetch = previousFetch;
    };
  }, []);

  if (relayMode !== "enabled" || !state || state.status === "synced") {
    return null;
  }

  const relayTokenAvailable = Boolean(getRelayConfig().token);
  const updateRequired = state.error === "relay_update_required";
  const pendingMessage = relayTokenAvailable
    ? relayBootstrapErrorMessage(
        { error: state.error, details: state.error_details },
        "La modification est enregistrée dans le Cloud, mais le PC relais ne l'a pas encore confirmée.",
      )
    : "La modification est enregistrée dans le Cloud. La synchronisation avec le PC relais reprendra depuis un poste administrateur configuré pour ce relais.";

  return (
    <aside className="fixed bottom-4 right-4 z-[120] max-w-sm rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-2xl">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <div className="font-bold">
            {state.status === "syncing"
              ? "Actualisation du relais en cours…"
              : updateRequired
                ? "Mise à jour du programme relais requise"
                : "Le relais doit être actualisé"}
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-900">
            {state.status === "syncing"
              ? "Le snapshot Cloud est en cours de transmission et de vérification sur le PC relais."
              : pendingMessage}
          </p>
          {state.status === "pending" && state.error && relayTokenAvailable && (
            <details className="mt-2 text-[11px] text-amber-800">
              <summary className="cursor-pointer font-semibold">Diagnostic technique</summary>
              <code className="mt-1 block break-all">{state.error}</code>
            </details>
          )}
          {state.status === "pending" && relayTokenAvailable && (
            <button
              type="button"
              onClick={() => void syncRelayScheduleAfterMutation()}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white hover:bg-amber-800"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Réessayer
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
