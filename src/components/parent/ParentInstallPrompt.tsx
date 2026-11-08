"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_UNTIL_KEY = "mon-cahier-parent-install-dismissed-until";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function recentlyDismissed() {
  try {
    return Date.now() < Number(window.localStorage.getItem(DISMISS_UNTIL_KEY) || "0");
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISS_UNTIL_KEY, String(Date.now() + DISMISS_MS));
  } catch {
    // Browsers may disallow storage; dismissal still applies to this view.
  }
}

/** Parent Connect only: optional, non-blocking PWA installation invitation. */
export default function ParentInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const onBeforeInstall = (event: Event) => {
      if (isStandalone() || recentlyDismissed()) return;
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    rememberDismissal();
    setVisible(false);
    setInstallEvent(null);
  }

  async function install() {
    const event = installEvent;
    if (!event) return;
    setVisible(false);
    setInstallEvent(null);
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      // A dismissed browser dialog should not immediately trigger our banner again.
      if (outcome === "dismissed") rememberDismissal();
    } catch {
      rememberDismissal();
    }
  }

  if (!visible || !installEvent) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-50">
      <section
        role="dialog"
        aria-modal="false"
        aria-label="Installer Mon Cahier"
        className="pointer-events-auto mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-[#111111] p-4 text-white shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#003766]">
            <Download size={22} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">Installer Mon Cahier</h2>
            <p className="mt-1 text-sm leading-5 text-white/75">
              Accédez rapidement à l’espace parent depuis l’écran d’accueil de votre téléphone.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Fermer l’invitation d’installation"
            className="rounded-lg p-1 text-white/70 hover:text-white"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          <button type="button" onClick={dismiss} className="rounded-lg px-3 py-2 text-sm font-semibold text-white/80">
            Plus tard
          </button>
          <button
            type="button"
            onClick={() => void install()}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <Download size={16} aria-hidden="true" />
            Installer
          </button>
        </div>
      </section>
    </div>
  );
}
