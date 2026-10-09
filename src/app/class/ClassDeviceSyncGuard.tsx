"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { cacheGet, listOfflineOutboxEntries } from "@/lib/offline";
import { repairClassDeviceSyncV2 } from "@/lib/class-device-sync-reconcile-v2";

const LAST_COMPLETION_KEY = "classDevice:last-completion:v1";
const LOCAL_OPEN_KEY = "classDevice:local-open";

type FriendlySyncState =
  | "ready"
  | "in_progress"
  | "saved_on_device"
  | "syncing"
  | "secured_on_relay"
  | "synced"
  | "needs_attention";

type CompletionRecord = {
  relay_state?: "relay_confirmed" | "cloud_confirmed" | "device_pending" | null;
};

type LocalOpenRecord = {
  id?: string | null;
  delivery_origin?: "relay" | "cloud_fallback" | "local_pending" | null;
  session_state?: "open" | "finalizing" | "closed" | null;
};

function friendlyPresentation(state: FriendlySyncState) {
  switch (state) {
    case "synced":
      return {
        label: "✓ Dernier appel reçu",
        tone: "bg-emerald-500/20 text-emerald-100",
        title: "Le dernier appel est confirmé dans le Cloud.",
      };
    case "secured_on_relay":
      return {
        label: "✓ Dernier appel sécurisé",
        tone: "bg-emerald-500/20 text-emerald-100",
        title: "Le dernier appel est confirmé par le relais local. La remontée Cloud se poursuit en arrière-plan.",
      };
    case "saved_on_device":
      return {
        label: "📱 Enregistrées sur ce téléphone",
        tone: "bg-amber-500/20 text-amber-100",
        title: "Les données du dernier appel sont conservées localement et seront synchronisées au retour du réseau.",
      };
    case "syncing":
      return {
        label: "↻ Synchronisation en cours…",
        tone: "bg-amber-500/20 text-amber-100",
        title: "Le dernier appel est en cours de synchronisation. Consultez les détails pour voir les autres actions en attente.",
      };
    case "needs_attention":
      return {
        label: "⚠ Synchronisation à reprendre",
        tone: "bg-rose-500/20 text-rose-100",
        title: "Le dernier appel n'est pas encore confirmé. Touchez ici pour relancer la récupération sans supprimer de données.",
      };
    case "in_progress":
      return {
        label: "● Appel en cours",
        tone: "bg-indigo-500/25 text-indigo-100",
        title: "Un appel est actuellement ouvert sur ce téléphone.",
      };
    default:
      return {
        label: "✓ Prêt",
        tone: "bg-slate-500/30 text-slate-100",
        title: "Aucun appel récent n'attend de confirmation utilisateur.",
      };
  }
}

export default function ClassDeviceSyncGuard() {
  const runningRef = useRef(false);
  const lastRunRef = useRef(0);
  const nextAttemptRef = useRef(0);
  const failedAttemptsRef = useRef(0);
  const pendingSinceRef = useRef<number | null>(null);
  const manualRunRef = useRef<() => Promise<void>>(async () => undefined);
  const [friendlyState, setFriendlyState] = useState<FriendlySyncState>("ready");
  const [statusHost, setStatusHost] = useState<HTMLElement | null>(null);
  const [protectedCount, setProtectedCount] = useState(0);

  useEffect(() => {
    if (window.location.pathname !== "/class") return;

    let cancelled = false;
    let oldStatus: HTMLElement | null = null;
    let oldButton: HTMLElement | null = null;

    const attach = () => {
      if (cancelled) return;
      const status = document.querySelector<HTMLElement>(
        '[title="État de conservation et de synchronisation de l’appel"]',
      );
      if (!status?.parentElement) return;

      oldStatus = status;
      oldButton = status.nextElementSibling instanceof HTMLElement
        ? status.nextElementSibling
        : null;
      oldStatus.style.display = "none";
      if (oldButton?.tagName === "BUTTON") oldButton.style.display = "none";
      setStatusHost(status.parentElement);
    };

    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      if (oldStatus) oldStatus.style.display = "";
      if (oldButton?.tagName === "BUTTON") oldButton.style.display = "";
      setStatusHost(null);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshFriendlyState = async () => {
      if (cancelled || window.location.pathname !== "/class") return;
      const [completion, localOpen, outbox] = await Promise.all([
        cacheGet<CompletionRecord>(LAST_COMPLETION_KEY).catch(() => null),
        cacheGet<LocalOpenRecord>(LOCAL_OPEN_KEY).catch(() => null),
        listOfflineOutboxEntries().catch(() => []),
      ]);
      if (cancelled) return;
      setProtectedCount(outbox.filter((entry) => entry.state === "blocked").length);

      const online = typeof navigator === "undefined" ? true : navigator.onLine;
      const openStillActive = Boolean(
        localOpen &&
          localOpen.session_state !== "closed" &&
          String(localOpen.id || "").trim(),
      );

      if (openStillActive) {
        pendingSinceRef.current = null;
        const localPending =
          !online ||
          localOpen?.delivery_origin === "local_pending" ||
          String(localOpen?.id || "").startsWith("client:");
        setFriendlyState(localPending ? "saved_on_device" : "in_progress");
        return;
      }

      if (completion?.relay_state === "cloud_confirmed") {
        pendingSinceRef.current = null;
        setFriendlyState("synced");
        return;
      }
      if (completion?.relay_state === "relay_confirmed") {
        pendingSinceRef.current = null;
        setFriendlyState("secured_on_relay");
        return;
      }
      if (completion?.relay_state === "device_pending") {
        if (!online) {
          pendingSinceRef.current = null;
          setFriendlyState("saved_on_device");
          return;
        }
        if (pendingSinceRef.current == null) pendingSinceRef.current = Date.now();
        const waitingMs = Date.now() - pendingSinceRef.current;
        setFriendlyState(waitingMs >= 45_000 ? "needs_attention" : "syncing");
        return;
      }

      pendingSinceRef.current = null;
      setFriendlyState("ready");
    };

    const postpone = () => {
      failedAttemptsRef.current += 1;
      nextAttemptRef.current = Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(failedAttemptsRef.current, 4));
    };
    const run = async (force = false) => {
      if (cancelled || runningRef.current) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await refreshFriendlyState();
        return;
      }
      if (window.location.pathname !== "/class") return;

      const now = Date.now();
      if (now - lastRunRef.current < 1_500 || (!force && now < nextAttemptRef.current)) {
        await refreshFriendlyState();
        return;
      }
      lastRunRef.current = now;
      runningRef.current = true;

      try {
        const result = await repairClassDeviceSyncV2({ force });
        if (cancelled) return;
        const progressed = result.flushed > 0 || result.reconciled > 0 || result.after < result.before;
        if (!progressed && (result.after > 0 || result.completion_pending)) postpone();
        else { failedAttemptsRef.current = 0; nextAttemptRef.current = 0; }
        if (result.flushed > 0 || result.reconciled > 0 || result.after < result.before) {
          // La page /class recalcule son compteur technique et poursuit son pipeline historique.
          // Ce compteur n'est plus exposé à l'utilisateur : l'état visible suit le dernier appel.
          window.setTimeout(() => {
            if (!cancelled && navigator.onLine) {
              window.dispatchEvent(new Event("online"));
            }
          }, 50);
        }
      } catch {
        // Aucune purge de secours : en cas d'échec les journaux IndexedDB restent intacts.
        postpone();
      } finally {
        runningRef.current = false;
        await refreshFriendlyState();
      }
    };

    manualRunRef.current = async () => {
      lastRunRef.current = 0;
      nextAttemptRef.current = 0;
      failedAttemptsRef.current = 0;
      await run(true);
    };

    const onOnline = (event: Event) => {
      if (event.isTrusted) { nextAttemptRef.current = 0; void run(); }
    };
    const onOffline = () => void refreshFriendlyState();
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };

    void refreshFriendlyState();
    void run();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshFriendlyState();
        if (navigator.onLine) void run();
      }
    }, 5_000);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, []);

  if (!statusHost) return null;
  const presentation = friendlyPresentation(friendlyState);

  return createPortal(
    <>
    <button
      type="button"
      onClick={() => {
        if (friendlyState === "syncing" || friendlyState === "needs_attention") {
          void manualRunRef.current();
        }
      }}
      className={[
        "rounded-full px-3 py-1 text-xs font-semibold transition",
        presentation.tone,
        friendlyState === "syncing" || friendlyState === "needs_attention"
          ? "cursor-pointer hover:ring-2 hover:ring-white/20"
          : "cursor-default",
      ].join(" ")}
      title={presentation.title}
      aria-live="polite"
    >
      {friendlyState === "needs_attention" ? "⚠ Reprendre la synchronisation" : presentation.label}
    </button>
    <Link href="/class/recover-sync-v2" className="rounded-full border border-white/30 px-3 py-1 text-xs font-semibold text-white hover:bg-white/10">
      {protectedCount > 0 ? `${protectedCount} action(s) à vérifier — Détails` : "Détails de synchronisation"}
    </Link>
    </>,
    statusHost,
  );
}
