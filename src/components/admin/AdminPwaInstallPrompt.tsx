"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone, X, Info } from "lucide-react";
import {
  beginPwaInstallCapture,
  consumePwaInstallPrompt,
  getPwaInstallPrompt,
  isPwaStandalone,
  PWA_INSTALL_CHANGE_EVENT,
  PWA_INSTALL_OPEN_EVENT,
} from "@/lib/pwa-install-prompt";

const DISMISS_KEY = "mon-cahier:admin-pwa-install-dismissed-until:v1";
const REMIND_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

function isPhone() {
  return /android|iphone|ipod/i.test(navigator.userAgent);
}

function isIOS() {
  return /iphone|ipod/i.test(navigator.userAgent);
}

/**
 * Invitation admin / correspondant fichier, exclusivement locale :
 * - Prompt Chrome capturé dès l'accueil, avant le passage /login → /admin.
 * - Vrai bouton Installer UNIQUEMENT si Chrome autorise le dialogue natif.
 * - Sinon une aide explicite, jamais un faux téléchargement.
 * - Écran sous-jacent toujours accessible ; raccourci manuel dans le header.
 * Aucune image ni nouvelle requête Render ou Supabase.
 */
export default function AdminPwaInstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [hasNativePrompt, setHasNativePrompt] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [ios, setIos] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPhone() || isPwaStandalone()) return;
    beginPwaInstallCapture();

    setIos(isIOS());
    const updateAvailability = () => setHasNativePrompt(Boolean(getPwaInstallPrompt()));
    const closeOnInstalled = () => {
      if (isPwaStandalone()) {
        setVisible(false);
        setShowHelp(false);
      }
      updateAvailability();
    };
    const onShortcutClick = () => {
      if (isPwaStandalone()) return;
      updateAvailability();
      setShowHelp(false);
      setVisible(true);
    };

    updateAvailability();
    window.addEventListener(PWA_INSTALL_CHANGE_EVENT, updateAvailability);
    window.addEventListener(PWA_INSTALL_OPEN_EVENT, onShortcutClick);
    window.addEventListener("appinstalled", closeOnInstalled);

    const media = window.matchMedia("(display-mode: standalone)");
    media.addEventListener("change", closeOnInstalled);

    try {
      const dismissedUntil = Number(window.localStorage.getItem(DISMISS_KEY) ?? 0);
      if (dismissedUntil <= Date.now()) setVisible(true);
    } catch {
      setVisible(true);
    }

    return () => {
      window.removeEventListener(PWA_INSTALL_CHANGE_EVENT, updateAvailability);
      window.removeEventListener(PWA_INSTALL_OPEN_EVENT, onShortcutClick);
      window.removeEventListener("appinstalled", closeOnInstalled);
      media.removeEventListener("change", closeOnInstalled);
    };
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now() + REMIND_AFTER_MS));
    } catch {
      // Aucune écriture en base et aucun appel au serveur.
    }
    setVisible(false);
    setShowHelp(false);
  };

  const install = async () => {
    const event = consumePwaInstallPrompt();
    if (!event) {
      // iOS, navigateur intégré, prompt Chrome manqué ou PWA non éligible :
      // expliquer l'installation via le menu, sans laisser croire à un succès.
      setHasNativePrompt(false);
      setShowHelp(true);
      return;
    }

    setBusy(true);
    try {
      await event.prompt();
      const choice = await event.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") {
        // Acceptation de Chrome, pas un téléchargement fictif. Le navigateur
        // terminera l'installation ; appinstalled masquera les autres invites.
        setVisible(false);
      } else {
        setShowHelp(true);
      }
    } catch {
      setShowHelp(true);
    } finally {
      setBusy(false);
      setHasNativePrompt(Boolean(getPwaInstallPrompt()));
    }
  };

  if (!visible) return null;

  if (showHelp) {
    return (
      <section
        aria-label="Instructions d’installation Mon Cahier"
        role="status"
        className="pointer-events-none fixed inset-x-3 top-16 z-[200] flex justify-center"
      >
        <div className="pointer-events-auto max-h-[70dvh] w-full max-w-sm overflow-y-auto rounded-2xl border-2 border-amber-400 bg-slate-900 p-4 text-white shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-extrabold text-amber-300">Installer avec votre navigateur</h2>
            <button type="button" aria-label="Fermer les instructions" onClick={dismiss}
              className="shrink-0 rounded-lg p-2 text-white hover:bg-white/10">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-2 text-sm leading-6">
            {ios
              ? "Ouvrez Mon Cahier dans Safari, appuyez sur Partager, puis Ajouter à l’écran d’accueil."
              : "Ouvrez Mon Cahier directement dans Chrome, appuyez sur le menu ⋮, puis Installer l’application ou Ajouter à l’écran d’accueil."}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-300">
            L’installation est gérée par votre navigateur : elle n’affiche pas nécessairement un téléchargement. 
            Si l’option manque, ouvrez le site dans Chrome ou Safari plutôt que dans un navigateur intégré.
          </p>
          <button type="button" onClick={dismiss}
            className="mt-3 w-full rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-extrabold text-slate-950">
            Compris, accéder à Mon Cahier
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Installer Mon Cahier"
      className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-4 py-5"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-slate-950/50 backdrop-blur-[1px]" />
      <div className="pointer-events-auto relative max-h-[calc(100dvh-2.5rem)] w-full max-w-sm overflow-y-auto rounded-[28px] border-2 border-amber-300 bg-slate-900 px-5 pb-5 pt-6 text-center text-white shadow-2xl">
        <button type="button" aria-label="Fermer l’invitation" onClick={dismiss}
          className="absolute right-3 top-3 rounded-full p-2 text-slate-200 hover:bg-white/10">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-200 bg-amber-400 text-slate-950">
          <Smartphone className="h-8 w-8" aria-hidden="true" />
        </div>
        <p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-amber-300">
          Mon Cahier sur mobile
        </p>
        <h2 className="mt-2 text-2xl font-black leading-tight">Mon Cahier sur votre téléphone</h2>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-slate-200">
          Accédez directement à votre espace scolaire depuis l’écran d’accueil de votre téléphone.
        </p>
        <button type="button" onClick={install} disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl bg-amber-400 px-4 py-3.5 text-base font-extrabold text-slate-950 shadow-lg transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-70">
          {hasNativePrompt ? <Download className="h-5 w-5" aria-hidden="true" /> : <Info className="h-5 w-5" aria-hidden="true" />}
          {busy ? "Ouverture de Chrome…" : hasNativePrompt ? "Installer maintenant" : "Voir comment installer"}
        </button>
        <button type="button" onClick={dismiss}
          className="mt-3 w-full rounded-xl border border-white/40 bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700">
          Plus tard
        </button>
        {!hasNativePrompt && (
          <p className="mt-3 text-xs text-slate-300">
            Votre navigateur ne propose pas encore l’installation directe.
          </p>
        )}
        <p className="mt-2 text-xs text-slate-300">Vous pourrez réessayer depuis l’icône d’installation du menu.</p>
      </div>
    </section>
  );
}
