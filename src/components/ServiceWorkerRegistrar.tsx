"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/offline";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    (async () => {
      try {
        await registerServiceWorker();
        console.info("[SW] ready");
      } catch (err) {
        console.warn("[SW] register_failed", err);
      }
    })();
  }, []);

  return null;
}
