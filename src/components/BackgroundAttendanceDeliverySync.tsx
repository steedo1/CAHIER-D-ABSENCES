"use client";

import { useEffect } from "react";
import { syncTeacherAttendanceOperationsToCloud } from "@/lib/teacher-attendance-cloud-sync";
import { syncDurableAttendanceOperationsToRelay } from "@/lib/teacher-attendance-relay-sync";
import { RELAY_LOCAL_DISABLED } from "@/lib/relay-capability";

/**
 * Rejoue silencieusement les appels durables dès qu'un chemin redevient disponible.
 *
 * - Cloud disponible : l'outbox historique crée d'abord les mappings de séance,
 *   puis les marques IndexedDB sont rejouées vers le Cloud.
 * - Cloud indisponible : si l'établissement possède réellement un Relais, les
 *   séances device-only puis leurs marques sont reprises vers le Relais local.
 *
 * Les deux chemins conservent les operation_id d'origine afin de rester
 * idempotents après plusieurs réveils, changements de page ou redémarrages PWA.
 */
export default function BackgroundAttendanceDeliverySync() {
  useEffect(() => {
    let disposed = false;
    let running = false;
    let wakeTimer: number | null = null;
    let failures = 0;
    let nextAttemptAt = 0;

    const run = async () => {
      if (disposed || running || Date.now() < nextAttemptAt) return;

      // Ne jamais annuler une reprise uniquement parce que l'écran est masqué.
      // Sur mobile, l'événement online peut arriver après verrouillage ou
      // changement d'application ; si le navigateur nous donne du CPU, on
      // profite de cette fenêtre pour vider l'outbox.
      running = true;
      try {
        // Le synchroniseur consulte d'abord les données locales : zéro sondage
        // Cloud quand aucune opération ne peut être rejouée.
        const result = await syncTeacherAttendanceOperationsToCloud();
        if (result.remaining > 0 && result.flushed === 0) {
          failures += 1;
          nextAttemptAt = Date.now() + Math.min(300_000, 10_000 * 2 ** Math.min(failures, 5));
        } else {
          failures = 0;
          nextAttemptAt = 0;
        }
        if (!RELAY_LOCAL_DISABLED && result.retryableFailure) {
          await syncDurableAttendanceOperationsToRelay();
        }
      } catch {
        // Toutes les opérations restent dans IndexedDB; le prochain réveil retente.
        failures += 1;
        nextAttemptAt = Date.now() + Math.min(300_000, 10_000 * 2 ** Math.min(failures, 5));
      } finally {
        running = false;
      }
    };

    const wake = () => {
      if (disposed) return;
      if (wakeTimer != null) window.clearTimeout(wakeTimer);
      // Au retour Cloud, laisse l'ancienne outbox rejouer d'abord l'ouverture de
      // séance. Hors Cloud, ce délai évite aussi de marteler un Relais qui redémarre.
      wakeTimer = window.setTimeout(() => void run(), 1_500);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") nextAttemptAt = 0;
      wake();
    };
    const onOnline = () => { nextAttemptAt = 0; failures = 0; wake(); };

    wake();
    // Le retour du Relais local ne déclenche pas forcément l'événement "online" :
    // ce réveil périodique est donc indispensable quand Internet reste coupé.
    const interval = window.setInterval(() => void run(), 20_000);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", wake);
    window.addEventListener("class-device-sync-updated", wake);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      if (wakeTimer != null) window.clearTimeout(wakeTimer);
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", wake);
      window.removeEventListener("class-device-sync-updated", wake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
