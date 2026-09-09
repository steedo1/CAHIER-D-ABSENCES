"use client";

import { useEffect, useRef } from "react";
import { repairClassDeviceCallOutbox } from "@/lib/class-device-outbox-reconcile";

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
        const result = await repairClassDeviceCallOutbox();
        if (cancelled) return;
        if (result.flushed > 0 || result.reconciled > 0) {
          // Le composant historique de la page /class écoute l'événement online.
          // Un événement synthétique lui demande uniquement de recalculer son compteur
          // et de poursuivre son propre pipeline. Ce guard ignore les événements
          // synthétiques pour éviter toute boucle.
          window.setTimeout(() => {
            if (!cancelled && navigator.onLine) {
              window.dispatchEvent(new Event("online"));
            }
          }, 50);
        }
      } catch {
        // Le guard ne doit jamais bloquer l'écran d'appel. Les opérations restent
        // dans IndexedDB et seront retentées au prochain retour réseau/intervalle.
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
