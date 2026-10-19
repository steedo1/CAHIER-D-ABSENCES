"use client";

import React from "react";
import { Download, X } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isInstalled() {
  const standalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * Always provides access to PWA installation in class-device interfaces.
 * Chrome's beforeinstallprompt event is optional and can fire before this
 * component mounts, so the button must not depend on that event to exist.
 */
export default function ClassDeviceInstallButton() {
  const [installed, setInstalled] = React.useState(false);
  const [promptEvent, setPromptEvent] = React.useState<InstallPromptEvent | null>(null);
  const [platform, setPlatform] = React.useState<"ios" | "android" | "desktop">("desktop");
  const [showHelp, setShowHelp] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const updateInstalled = () => setInstalled(isInstalled());
    updateInstalled();
    setPlatform(/iphone|ipad|ipod/i.test(navigator.userAgent)
      ? "ios"
      : /android/i.test(navigator.userAgent)
        ? "android"
        : "desktop");

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
      setShowHelp(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    mediaQuery.addEventListener("change", updateInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      mediaQuery.removeEventListener("change", updateInstalled);
    };
  }, []);

  async function onInstall() {
    if (!promptEvent) {
      setShowHelp((open) => !open);
      return;
    }

    setBusy(true);
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice.catch(() => null);
      setPromptEvent(null);
      if (choice?.outcome === "dismissed") setShowHelp(true);
    } catch {
      // Some browsers invalidate the event; explain manual installation instead.
      setPromptEvent(null);
      setShowHelp(true);
    } finally {
      setBusy(false);
    }
  }

  if (installed) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <button
        type="button"
        onClick={onInstall}
        disabled={busy}
        aria-expanded={showHelp}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-emerald-300/70 bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait disabled:opacity-70"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {busy ? "Installation…" : "Installer l’application"}
      </button>

      {showHelp && (
        <div role="status" className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <strong>Installer Mon Cahier</strong>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="rounded p-1 text-slate-600 hover:bg-slate-100"
              aria-label="Fermer les instructions d’installation"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed">
            {platform === "ios"
              ? "Sur iPhone ou iPad, ouvrez Mon Cahier dans Safari, puis Partager → Sur l’écran d’accueil."
              : platform === "android"
                ? "Sur Android, ouvrez Mon Cahier dans Chrome, puis le menu ⋮ → Installer l’application (ou Ajouter à l’écran d’accueil)."
                : "Dans Chrome sur ordinateur, ouvrez le menu ⋮ → Installer Mon Cahier ou utilisez l’icône d’installation dans la barre d’adresse."}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Si l’option n’apparaît pas, vérifiez que le site est ouvert directement dans le navigateur et que l’application n’est pas déjà installée.
          </p>
        </div>
      )}
    </div>
  );
}
