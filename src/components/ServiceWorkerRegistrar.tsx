"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/offline";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;

    const refresh = async () => {
      if (disposed) return;
      try {
        registration = registration || (await registerServiceWorker());
        await registration?.update().catch(() => undefined);
      } catch (error) {
        console.warn("[SW] update_failed", error);
      }
    };

    void refresh();

    const onOnline = () => void refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
