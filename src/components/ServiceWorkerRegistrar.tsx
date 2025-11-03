"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        // Très important : attendre l'activation
        await navigator.serviceWorker.ready;
        // Optionnel : console.log("SW prêt");
      } catch (err) {
        console.error("SW register failed:", err);
      }
    };

    // On enregistre dès que possible (pas au clic du bouton)
    register();
  }, []);

  return null;
}
