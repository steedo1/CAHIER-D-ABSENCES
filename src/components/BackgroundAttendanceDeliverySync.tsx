"use client";

import { useEffect } from "react";
import { syncTeacherAttendanceOperationsToCloud } from "@/lib/teacher-attendance-cloud-sync";

/**
 * Rejoue silencieusement les appels durables après le retour du réseau.
 *
 * OfflineSyncBar s'occupe déjà de l'outbox historique (dont l'ouverture et la
 * fermeture des séances). Ce composant passe juste après pour envoyer les
 * marques d'appel IndexedDB une fois les mappings de séance disponibles.
 * Il est global afin de couvrir aussi bien les comptes professeurs que classes.
 */
export default function BackgroundAttendanceDeliverySync() {
  useEffect(() => {
    let disposed = false;
    let running = false;
    let wakeTimer: number | null = null;

    const run = async () => {
      if (disposed || running) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

      running = true;
      try {
        await syncTeacherAttendanceOperationsToCloud();
      } catch {
        // Les enregistrements restent dans IndexedDB; le prochain réveil retente.
      } finally {
        running = false;
      }
    };

    const wake = () => {
      if (disposed) return;
      if (wakeTimer != null) window.clearTimeout(wakeTimer);
      // Laisse OfflineSyncBar rejouer d'abord l'ouverture de séance afin que les
      // identifiants client:* disposent de leur mapping serveur.
      wakeTimer = window.setTimeout(() => void run(), 1_500);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") wake();
    };

    wake();
    const interval = window.setInterval(() => void run(), 20_000);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      if (wakeTimer != null) window.clearTimeout(wakeTimer);
      window.clearInterval(interval);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
