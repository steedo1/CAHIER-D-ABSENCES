/**
 * Capture l'invite native PWA dès le chargement initial de Mon Cahier.
 * L'interface Admin peut être montée bien après la connexion, lorsque Chrome
 * a déjà émis beforeinstallprompt. Ne conserve rien sur un serveur ou disque.
 */
export type PwaBeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export const PWA_INSTALL_CHANGE_EVENT = "mon-cahier:pwa-install-availability";
export const PWA_INSTALL_OPEN_EVENT = "mon-cahier:pwa-install-open";

let deferredPrompt: PwaBeforeInstallPromptEvent | null = null;
let capturing = false;

function notify() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PWA_INSTALL_CHANGE_EVENT));
  }
}

export function isPwaStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function beginPwaInstallCapture(): void {
  if (typeof window === "undefined" || capturing) return;
  capturing = true;

  window.addEventListener("beforeinstallprompt", (event: Event) => {
    if (isPwaStandalone()) return;
    event.preventDefault();
    deferredPrompt = event as PwaBeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

export function getPwaInstallPrompt(): PwaBeforeInstallPromptEvent | null {
  return isPwaStandalone() ? null : deferredPrompt;
}

/** L'événement Chrome n'est utilisable qu'une fois : le retirer avant prompt(). */
export function consumePwaInstallPrompt(): PwaBeforeInstallPromptEvent | null {
  const prompt = getPwaInstallPrompt();
  deferredPrompt = null;
  notify();
  return prompt;
}

// Installation du listener au chargement du bundle, avant le rendu des routes
// admin. L'appel dans ServiceWorkerRegistrar garde un filet de sécurité.
if (typeof window !== "undefined") beginPwaInstallCapture();
