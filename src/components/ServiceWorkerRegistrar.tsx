//src/components/ServiceWorkerRegistrar.tsx
"use client";

import { useEffect } from "react";

/** ⚠️ Doit correspondre STRICTEMENT au SW_VERSION dans /public/sw.js */
const SW_BUILD = "2025-11-05T19:59:59Z";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const url = `/sw.js?v=${encodeURIComponent(SW_BUILD)}`;

    (async () => {
      try {
        const reg = await navigator.serviceWorker.register(url, { scope: "/" });
        console.info("[SW] registered", { url, scope: reg.scope });

        // Attendre l’activation pour garantir showNotification, etc.
        await navigator.serviceWorker.ready;
        console.info("[SW] ready");
      } catch (err) {
        console.warn("[SW] register_failed", err);
      }
    })();
  }, []);

  return null;
}