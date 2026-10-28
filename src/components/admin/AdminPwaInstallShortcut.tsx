"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { isPwaStandalone, PWA_INSTALL_OPEN_EVENT } from "@/lib/pwa-install-prompt";

/** Reprise manuelle toujours possible après « Plus tard » (aucune API). */
export default function AdminPwaInstallShortcut() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const refresh = () => setAvailable(
      /android|iphone|ipod/i.test(navigator.userAgent) && !isPwaStandalone()
    );
    refresh();
    const media = window.matchMedia("(display-mode: standalone)");
    media.addEventListener("change", refresh);
    window.addEventListener("appinstalled", refresh);
    return () => {
      media.removeEventListener("change", refresh);
      window.removeEventListener("appinstalled", refresh);
    };
  }, []);

  if (!available) return null;

  return (
    <button type="button"
      title="Installer Mon Cahier sur ce téléphone"
      aria-label="Installer Mon Cahier sur ce téléphone"
      onClick={() => window.dispatchEvent(new Event(PWA_INSTALL_OPEN_EVENT))}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-amber-300 bg-amber-400 p-2 text-slate-950 shadow-sm transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white md:hidden">
      <Download className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
