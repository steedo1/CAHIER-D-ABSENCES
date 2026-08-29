"use client";

import { useEffect } from "react";
import { syncTeacherAttendanceOperationsToCloud } from "@/lib/teacher-attendance-cloud-sync";
import { syncDurableAttendanceOperationsToRelay } from "@/lib/teacher-attendance-relay-sync";
import { teacherSessionCloudAvailable } from "@/lib/teacher-session-delivery";

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

    const run = async () => {
      if (disposed || running) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

      running = true;
      try {
        const cloudAvailable = await teacherSessionCloudAvailable();
        if (cloudAvailable) {
          await syncTeacherAttendanceOperationsToCloud();
        } else {
          await syncDurableAttendanceOperationsToRelay();
        }
      } catch {
        // Toutes les opérations restent dans IndexedDB; le prochain réveil retente.
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
      if (document.visibilityState === "visible") wake();
    };

    wake();
    // Le retour du Relais local ne déclenche pas forcément l'événement "online" :
    // ce réveil périodique est donc indispensable quand Internet reste coupé.
    const interval = window.setInterval(() => void run(), 20_000);
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      if (wakeTimer != null) window.clearTimeout(wakeTimer);
      window.clearInterval(interval);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
