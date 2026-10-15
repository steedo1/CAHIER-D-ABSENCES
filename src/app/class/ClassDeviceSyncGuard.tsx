"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getClassDeviceLocalSyncStatus, repairClassDeviceSyncV2 } from "@/lib/class-device-sync-reconcile-v2";
import { classDeviceFriendlySyncState, type ClassDeviceFriendlySyncState, type ClassDeviceSyncScope } from "@/lib/class-device-sync-state";

const presentations: Record<ClassDeviceFriendlySyncState, { label: string; tone: string; title: string }> = {
  ready: { label: "✓ Prêt", tone: "bg-slate-500/30 text-slate-100", title: "Aucun appel de cette classe n’attend de confirmation." },
  in_progress: { label: "● Appel en cours", tone: "bg-indigo-500/25 text-indigo-100", title: "Un appel est ouvert pour cette classe." },
  saved_on_device: { label: "📱 En attente d’envoi", tone: "bg-amber-500/20 text-amber-100", title: "Les données sont conservées sur ce téléphone. L’envoi sera réessayé automatiquement." },
  syncing: { label: "↻ Synchronisation en cours…", tone: "bg-amber-500/20 text-amber-100", title: "Une tentative d’envoi est en cours pour cette classe." },
  secured_on_relay: { label: "✓ Dernier appel sécurisé", tone: "bg-emerald-500/20 text-emerald-100", title: "Le relais local a confirmé le dernier appel de cette classe." },
  synced: { label: "✓ Dernier appel reçu", tone: "bg-emerald-500/20 text-emerald-100", title: "Le Cloud a confirmé l’appel et sa fermeture." },
  needs_attention: { label: "⚠ Actions à vérifier", tone: "bg-rose-500/20 text-rose-100", title: "Consultez les détails des actions de cette classe. Les données restent conservées." },
};

export default function ClassDeviceSyncGuard({ scope, syncing = false, onRetry }: {
  scope: ClassDeviceSyncScope; syncing?: boolean; onRetry?: () => Promise<void>;
}) {
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;
  const manualRunRef = useRef<() => Promise<void>>(async () => undefined);
  const [friendlyState, setFriendlyState] = useState<ClassDeviceFriendlySyncState>("ready");
  const [protectedCount, setProtectedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    let checking = false;
    let lastRun = 0;
    let nextAttempt = 0;
    let failedAttempts = 0;
    let reviewedBlocked = "";
    const activeScope = { id: scope.id, institution_id: scope.institution_id, actor_profile_id: scope.actor_profile_id };

    const refresh = async () => {
      const status = await getClassDeviceLocalSyncStatus(activeScope);
      if (!cancelled) {
        setProtectedCount(status.blocked);
        setFriendlyState(classDeviceFriendlySyncState({
          ...status, online: navigator.onLine, syncing: running,
        }));
      }
      return status;
    };

    const run = async (force = false) => {
      if (cancelled || running || checking) return;
      checking = true;
      try {
        const status = await refresh();
        if (cancelled || !navigator.onLine) return;
        const receiptPending = status.completion?.relay_state === "device_pending" && status.blocked === 0;
        const blockedKey = status.blocked > 0 ? status.operations
          .filter((operation) => operation.blocked).map((operation) => operation.operationId).sort().join("|") : "";
        const needsReview = Boolean(blockedKey && blockedKey !== reviewedBlocked);
        if (!force && !status.retryable && !receiptPending && !needsReview) return;
        const now = Date.now();
        if (now - lastRun < 1_500 || (!force && now < nextAttempt)) return;
        lastRun = now;
        if (needsReview) reviewedBlocked = blockedKey;
        running = true;
        await refresh();
        const result = await repairClassDeviceSyncV2({ force, scope: activeScope });
        if (cancelled) return;
        const progressed = result.flushed > 0 || result.reconciled > 0 || result.after < result.before;
        if (!progressed && (result.after > 0 || result.completion_pending)) {
          failedAttempts += 1;
          nextAttempt = Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(failedAttempts, 4));
        } else {
          failedAttempts = 0;
          nextAttempt = 0;
        }
        if (progressed) window.dispatchEvent(new Event("class-device-sync-updated"));
      } catch {
        if (!cancelled) setFriendlyState("needs_attention");
        failedAttempts += 1;
        nextAttempt = Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(failedAttempts, 4));
      } finally {
        running = false;
        checking = false;
        if (!cancelled) await refresh().catch(() => undefined);
      }
    };
    manualRunRef.current = async () => {
      await retryRef.current?.();
      nextAttempt = 0;
      await run(true);
    };
    const onOnline = () => { nextAttempt = 0; reviewedBlocked = ""; void run(); };
    const onUpdated = () => { void refresh().catch(() => undefined); };
    const onVisible = () => { if (document.visibilityState === "visible") void run(); };
    void run();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onUpdated);
    window.addEventListener("class-device-sync-updated", onUpdated);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(onVisible, 5_000);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onUpdated);
      window.removeEventListener("class-device-sync-updated", onUpdated);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [scope.id, scope.institution_id, scope.actor_profile_id]);

  const displayState = syncing && friendlyState === "saved_on_device" ? "syncing" : friendlyState;
  const presentation = presentations[displayState];
  const retryable = displayState === "saved_on_device";
  return (
    <>
      <button
        type="button"
        disabled={!retryable}
        onClick={() => { if (retryable) void manualRunRef.current(); }}
        className={["rounded-full px-3 py-1 text-xs font-semibold", presentation.tone,
          retryable ? "hover:ring-2 hover:ring-white/20" : "cursor-default"].join(" ")}
        title={presentation.title}
        aria-live="polite"
        aria-busy={displayState === "syncing"}
      >
        {presentation.label}
      </button>
      <Link href={`/class/recover-sync-v2?class_id=${encodeURIComponent(scope.id)}`} className="rounded-full border border-white/30 px-3 py-1 text-xs font-semibold text-white hover:bg-white/10">
        {protectedCount > 0 ? `${protectedCount} action(s) à vérifier — Détails` : "Détails de synchronisation"}
      </Link>
    </>
  );
}
