"use client";

import { useEffect } from "react";
import {
  OFFLINE_PREPARATION_CHECK_INTERVAL_MS,
  runCoordinatedOfflinePreparation,
} from "@/lib/offline-preparation-coordinator";
import type { OfflineRole } from "@/lib/offline-readiness";

export default function OfflinePreparationCoordinator({
  role,
}: {
  role: OfflineRole;
}) {
  useEffect(() => {
    let stopped = false;

    const refresh = () => {
      if (stopped) return;
      void runCoordinatedOfflinePreparation(role).catch(() => {
        // La préparation reste silencieuse et sera reprise au prochain signal.
      });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    const initial = window.setTimeout(refresh, 1_000);
    const periodic = window.setInterval(
      refresh,
      OFFLINE_PREPARATION_CHECK_INTERVAL_MS,
    );
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      stopped = true;
      window.clearTimeout(initial);
      window.clearInterval(periodic);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [role]);

  return null;
}
