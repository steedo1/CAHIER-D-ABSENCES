"use client";

import { useEffect, useState } from "react";
import { Cloud, RefreshCcw, WifiOff } from "lucide-react";
import { flushOutbox, outboxCount } from "@/lib/offline";

type Props = {
  onMessage?: (message: string) => void;
};

export default function OfflineSyncBar({ onMessage }: Props) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  async function refreshPending() {
    try {
      setPending(await outboxCount());
    } catch {
      setPending(0);
    }
  }

  async function syncNow(silent = false) {
    if (syncing || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    setSyncing(true);
    try {
      const result = await flushOutbox();
      await refreshPending();

      if (result.authRequired) {
        onMessage?.(
          "Synchronisation suspendue : reconnectez votre session. Les notes restent conservées sur cet appareil."
        );
      } else if (result.blocked > 0) {
        onMessage?.(
          `${result.blocked} action(s) nécessitent une vérification. Aucune donnée n’a été supprimée.`
        );
      } else if (result.remaining > 0) {
        onMessage?.(
          `Réseau instable : ${result.remaining} action(s) restent conservées sur cet appareil.`
        );
      } else if (!silent || result.flushed > 0) {
        onMessage?.(
          result.flushed > 0
            ? `Synchronisation terminée ✅ (${result.flushed} action(s)).`
            : "Toutes les données sont déjà synchronisées ✅"
        );
      }
    } catch (cause: any) {
      onMessage?.(
        String(cause?.message || "Synchronisation interrompue. Les données restent conservées.")
      );
    } finally {
      setSyncing(false);
      await refreshPending();
    }
  }

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    void refreshPending();

    const interval = window.setInterval(() => void refreshPending(), 3_000);
    const handleOnline = () => {
      setOnline(true);
      void syncNow(true);
    };
    const handleOffline = () => {
      setOnline(false);
      void refreshPending();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // Le composant installe volontairement une seule paire d'écouteurs réseau.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section
      className={`flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between ${
        online
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-amber-200 bg-amber-50 text-amber-950"
      }`}
      aria-live="polite"
    >
      <div className="flex items-center gap-2 font-medium">
        {online ? <Cloud className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        <span>{online ? "En ligne" : "Hors connexion — saisie locale active"}</span>
        {pending > 0 ? (
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold ring-1 ring-current/15">
            {pending} en attente
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void syncNow(false)}
        disabled={!online || syncing || pending === 0}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCcw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Synchronisation…" : "Synchroniser"}
      </button>
    </section>
  );
}
