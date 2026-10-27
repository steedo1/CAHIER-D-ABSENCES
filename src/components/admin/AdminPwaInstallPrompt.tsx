"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "mon-cahier:admin-pwa-install-dismissed-until:v1";
const REMIND_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isPhone() {
  return /android|iphone|ipod/i.test(navigator.userAgent);
}

/**
 * Invitation locale à installer la PWA, réservée aux espaces Admin et
 * Correspondant fichier par le layout serveur authentifié.
 * Aucun appel réseau, aucune écriture Supabase et aucun nouvel abonnement push.
 */
export default function AdminPwaInstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPhone() || isStandalone()) return;

    try {
      const dismissedUntil = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
      if (dismissedUntil > Date.now()) return;
    } catch {
      // Stockage bloqué : l'installation reste facultative et accessible.
    }

    setIsIOS(/iphone|ipod/i.test(navigator.userAgent));
    setVisible(true);

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const onDisplayModeChange = () => {
      if (isStandalone()) setVisible(false);
    };
    const onInstallAvailable = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setVisible(false);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onInstallAvailable);
    window.addEventListener("appinstalled", onInstalled);
    mediaQuery.addEventListener("change", onDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallAvailable);
      window.removeEventListener("appinstalled", onInstalled);
      mediaQuery.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now() + REMIND_AFTER_MS));
    } catch {
      // Aucun serveur ni stockage n'est requis.
    }
    setVisible(false);
  };

  const install = async () => {
    // Sur iPhone et lorsque l'événement Chromium a déjà été émis avant
    // la connexion, expliquer l'installation via le menu du navigateur.
    if (!installPrompt) {
      setShowInstructions(true);
      return;
    }

    setBusy(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice.catch(() => null);
      setInstallPrompt(null);
      if (choice?.outcome === "accepted") {
        setVisible(false);
      } else {
        setShowInstructions(true);
      }
    } catch {
      setInstallPrompt(null);
      setShowInstructions(true);
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <aside
      aria-label="Installer Mon Cahier sur votre téléphone"
      className="fixed inset-x-3 bottom-[5.75rem] z-[45] mx-auto max-w-sm rounded-2xl border border-emerald-200 bg-white p-4 text-slate-800 shadow-2xl md:hidden"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          <Smartphone className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Mon Cahier sur votre téléphone</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Ajoutez Mon Cahier à votre écran d’accueil pour y accéder comme une application.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Ne pas proposer l'installation maintenant"
          className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={install}
          disabled={busy}
          aria-expanded={showInstructions}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {busy ? "Installation…" : "Installer"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
        >
          Plus tard
        </button>
      </div>

      {showInstructions && (
        <div role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-950">
          {isIOS
            ? "Sur iPhone, ouvrez Mon Cahier dans Safari, touchez Partager, puis Ajouter à l’écran d’accueil."
            : "Sur Android, ouvrez Mon Cahier dans Chrome, puis menu ⋮ → Installer l’application ou Ajouter à l’écran d’accueil."}
          <p className="mt-1 text-emerald-800">
            Si l’option n’apparaît pas, vérifiez que Mon Cahier n’est pas déjà installé.
          </p>
        </div>
      )}
    </aside>
  );
}
