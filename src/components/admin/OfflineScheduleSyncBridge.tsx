"use client";

import { useEffect, useState } from "react";
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

function hasConfiguredAdminRelay() {
  return Boolean(getRelayConfig().token);
}

export default function OfflineScheduleSyncBridge() {
  const [state, setState] = useState<AdminScheduleSyncState | null>(null);

  useEffect(() => {
    const relayConfigured = hasConfiguredAdminRelay();
    const persisted = relayConfigured ? getAdminScheduleSyncState() : null;
    setState(persisted);
    const unsubscribe = subscribeAdminScheduleSync((nextState) => {
      setState(hasConfiguredAdminRelay() ? nextState : null);
    });
    if (relayConfigured && persisted && persisted.status !== "synced") {
      void syncRelayScheduleAfterMutation();
    }
    return unsubscribe;
  }, []);

  useEffect(() => {
    const previousFetch = window.fetch;
    const interceptedFetch: typeof window.fetch = async (input, init) => {
      const response = await previousFetch(input, init);
      if (
        response.ok &&
        hasConfiguredAdminRelay() &&
        isOfflineScheduleMutation(
          requestPath(input),
          requestMethod(input, init),
        )
      ) {
        markRelayScheduleSyncPending();
        void syncRelayScheduleAfterMutation();
      }
      return response;
    };
    window.fetch = interceptedFetch;
    return () => {
      if (window.fetch === interceptedFetch) window.fetch = previousFetch;
    };
  }, []);

  if (!state || state.status === "synced") return null;

  const updateRequired = state.error === "relay_update_required";
  const pendingMessage = relayBootstrapErrorMessage(
    { error: state.error, details: state.error_details },
    "La modification est enregistrée dans le Cloud, mais le PC relais ne l'a pas encore confirmée.",
  );

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
          {state.status === "pending" && state.error && (
            <details className="mt-2 text-[11px] text-amber-800">
              <summary className="cursor-pointer font-semibold">Diagnostic technique</summary>
              <code className="mt-1 block break-all">{state.error}</code>
            </details>
          )}
          {state.status === "pending" && (
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
