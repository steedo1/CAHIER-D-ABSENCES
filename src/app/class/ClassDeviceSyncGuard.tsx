"use client";

import { useEffect, useRef } from "react";
import { repairClassDeviceSyncV2 } from "@/lib/class-device-sync-reconcile-v2";

export default function ClassDeviceSyncGuard() {
  const runningRef = useRef(false);
  const lastRunRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled || runningRef.current) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (window.location.pathname === "/class/recover-sync") return;

      const now = Date.now();
      if (now - lastRunRef.current < 1_500) return;
      lastRunRef.current = now;
      runningRef.current = true;

      try {
        const result = await repairClassDeviceSyncV2();
        if (cancelled) return;
        if (result.flushed > 0 || result.reconciled > 0 || result.after < result.before) {
          // La page /class recalcule son compteur et poursuit son pipeline historique.
          // Le guard ignore les événements synthétiques pour ne jamais boucler.
          window.setTimeout(() => {
            if (!cancelled && navigator.onLine) {
              window.dispatchEvent(new Event("online"));
            }
          }, 50);
        }
      } catch {
        // Aucune purge de secours : en cas d'échec les journaux IndexedDB restent intacts.
      } finally {
        runningRef.current = false;
      }
    };

    const onOnline = (event: Event) => {
      if (event.isTrusted) void run();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };

    void run();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, 15_000);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
