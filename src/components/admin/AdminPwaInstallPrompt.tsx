"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
 * Proposition d'installation PWA pour les rôles Admin et Correspondant fichier
 * (contrôlés par le layout serveur). Le visuel est 100% local : pas d'image,
 * pas de téléchargement de logo, pas d'API ni de nouvelle requête Supabase.
 */
export default function AdminPwaInstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isPhone() || isStandalone()) return;

    try {
      const dismissedUntil = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
      if (dismissedUntil > Date.now()) return;
    } catch {
      // Le stockage local n'est pas indispensable à l'invitation.
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

  useEffect(() => {
    if (!visible) return;

    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;

    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [visible]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now() + REMIND_AFTER_MS));
    } catch {
      // Aucun enregistrement sur un serveur.
    }
    setVisible(false);
  };

  const install = async () => {
    // iOS et les navigateurs n'offrant plus beforeinstallprompt :
    // expliquer l'installation manuelle au lieu de présenter un faux succès.
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

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== "Tab") return;

    const buttons = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    if (!buttons.length) return;

    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 px-4 py-6 backdrop-blur-[3px]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-install-title"
        aria-describedby="admin-install-description"
        onKeyDown={onDialogKeyDown}
        tabIndex={-1}
        className="relative max-h-[calc(100dvh-3rem)] w-full max-w-sm overflow-y-auto rounded-[28px] border-2 border-amber-300 bg-slate-900 px-5 pb-6 pt-7 text-center text-white shadow-2xl outline-none"
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fermer la proposition d'installation"
          className="absolute right-3 top-3 rounded-full p-2 text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-200 bg-amber-400 text-slate-950 shadow-lg">
          <Smartphone className="h-9 w-9" aria-hidden="true" />
        </div>

        <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-amber-300">
          Mon Cahier sur mobile
        </p>
        <h2 id="admin-install-title" className="mt-2 text-2xl font-black leading-tight">
          Installez Mon Cahier !
        </h2>
        <p id="admin-install-description" className="mx-auto mt-3 max-w-xs text-sm leading-6 text-slate-200">
          Accédez directement à votre espace scolaire depuis l’écran d’accueil
          de votre téléphone.
        </p>

        <button
          type="button"
          onClick={install}
          disabled={busy}
          aria-expanded={showInstructions}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-amber-400 px-4 py-3.5 text-base font-extrabold text-slate-950 shadow-lg transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-70"
        >
          <Download className="h-5 w-5" aria-hidden="true" />
          {busy ? "Installation…" : "Installer maintenant"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="mt-3 w-full rounded-xl border border-white/40 bg-slate-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
        >
          Plus tard
        </button>

        {showInstructions && (
          <div role="status" className="mt-4 rounded-xl border border-amber-300/50 bg-slate-800 p-3 text-left text-xs leading-5 text-white">
            {isIOS
              ? "Sur iPhone, ouvrez Mon Cahier dans Safari, puis Partager → Ajouter à l’écran d’accueil."
              : "Sur Android, ouvrez Mon Cahier dans Chrome, puis menu ⋮ → Installer l’application (ou Ajouter à l’écran d’accueil)."}
            <p className="mt-2 text-slate-300">
              Si cette option n’apparaît pas, vérifiez que l’application n’est pas déjà installée.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
