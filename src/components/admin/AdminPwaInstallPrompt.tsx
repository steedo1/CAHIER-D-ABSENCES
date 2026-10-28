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
 * Invitation PWA réservée aux comptes administrateur et correspondant fichier
 * par le layout serveur. Aucun nouveau logo/image, appel API ou accès Supabase.
 *
 * Le fond est purement visuel : il ne capte jamais les clics ou le défilement
 * sur le tableau de bord. Si le navigateur ne fournit pas la boîte native
 * d'installation, l'aide remplace la carte centrale par un guide non bloquant
 * pour que le menu Chrome/Safari soit immédiatement utilisable.
 */
export default function AdminPwaInstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPhone() || isStandalone()) return;

    try {
      const dismissedUntil = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
      if (dismissedUntil > Date.now()) return;
    } catch {
      // Le stockage local est facultatif ; aucun appel réseau de remplacement.
    }

    setIsIOS(/iphone|ipod/i.test(navigator.userAgent));
    setVisible(true);

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const onDisplayModeChange = () => {
      if (isStandalone()) {
        setVisible(false);
        setShowHelp(false);
      }
    };
    const onInstallAvailable = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setVisible(false);
      setShowHelp(false);
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
      // Jamais de requête vers Render ou Supabase.
    }
    setVisible(false);
    setShowHelp(false);
  };

  const install = async () => {
    // Le navigateur n'a pas proposé l'installation automatique :
    // basculer sur un guide léger qui laisse le menu du navigateur utilisable.
    if (!installPrompt) {
      setShowHelp(true);
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
        setShowHelp(true);
      }
    } catch {
      setInstallPrompt(null);
      setShowHelp(true);
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  if (showHelp) {
    return (
      <section
        aria-label="Installer Mon Cahier depuis le navigateur"
        role="status"
        className="pointer-events-none fixed inset-x-3 top-3 z-[200] flex justify-center"
      >
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl border-2 border-amber-400 bg-slate-900 p-4 text-white shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <p className="text-base font-extrabold text-amber-300">
              Installer depuis le navigateur
            </p>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Fermer les instructions d’installation"
              className="shrink-0 rounded-lg p-2 text-white hover:bg-white/10"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-2 text-sm leading-6">
            {isIOS
              ? "Dans Safari : touchez Partager, puis Ajouter à l’écran d’accueil."
              : "Dans Chrome : touchez ⋮ en haut à droite, puis Installer l’application (ou Ajouter à l’écran d’accueil)."}
          </p>
          <p className="mt-2 text-xs text-slate-300">
            Si cette option est absente, l’application peut déjà être installée
            ou le navigateur peut ne pas proposer l’installation.
          </p>
          <button
            type="button"
            onClick={dismiss}
            className="mt-3 w-full rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-slate-950"
          >
            Compris, continuer
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Proposition d’installation de Mon Cahier"
      className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-4 py-5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]"
      />
      <div
        className="pointer-events-auto relative max-h-[calc(100dvh-2.5rem)] w-full max-w-sm overflow-y-auto rounded-[28px] border-2 border-amber-300 bg-slate-900 px-5 pb-5 pt-6 text-center text-white shadow-2xl"
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fermer la proposition d’installation"
          className="absolute right-3 top-3 rounded-full p-2 text-slate-300 hover:bg-white/10"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-400 text-slate-950">
          <Smartphone className="h-8 w-8" aria-hidden="true" />
        </div>
        <p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-amber-300">
          Mon Cahier sur mobile
        </p>
        <h2 className="mt-2 text-2xl font-black leading-tight">
          Installez Mon Cahier !
        </h2>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-slate-200">
          Accédez directement à votre espace scolaire depuis l’écran d’accueil
          de votre téléphone.
        </p>
        <button
          type="button"
          onClick={install}
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl bg-amber-400 px-4 py-3.5 text-base font-extrabold text-slate-950 shadow-lg transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-70"
        >
          <Download className="h-5 w-5" aria-hidden="true" />
          {busy ? "Installation…" : "Installer maintenant"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="mt-3 w-full rounded-xl border border-white/40 bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Plus tard
        </button>
        <p className="mt-3 text-xs text-slate-300">
          Installation facultative. Votre tableau de bord reste accessible.
        </p>
      </div>
    </section>
  );
}
