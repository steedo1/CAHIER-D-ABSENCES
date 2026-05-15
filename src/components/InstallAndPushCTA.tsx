// src/components/InstallAndPushCTA.tsx
"use client";

import React from "react";

type PermissionState = "unsupported" | "default" | "denied" | "granted";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

function getNotificationPermission(): PermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission as PermissionState;
}

async function waitForServiceWorkerReady(timeoutMs = 10000) {
  if (!("serviceWorker" in navigator)) return null;

  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }

  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration | null>((resolve) => {
      window.setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

export default function InstallAndPushCTA() {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = React.useState(false);
  const [isiOS, setIsiOS] = React.useState(false);
  const [permission, setPermission] = React.useState<PermissionState>("default");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const refresh = () => setPermission(getNotificationPermission());
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  React.useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    setIsStandalone(mq.matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true);
    setIsiOS(/iphone|ipad|ipod/i.test(navigator.userAgent));

    const handler = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
  }

  async function enablePush() {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      if (typeof window === "undefined") return;

      if (!window.isSecureContext) {
        setError("Les notifications nécessitent une adresse HTTPS sécurisée.");
        return;
      }

      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setError("Ce navigateur ne supporte pas les notifications push web.");
        return;
      }

      let currentPermission = Notification.permission;

      if (currentPermission === "denied") {
        setError("Les notifications sont bloquées dans le navigateur. Autorise-les depuis l’icône cadenas de la barre d’adresse, puis recharge la page.");
        setPermission("denied");
        return;
      }

      if (currentPermission !== "granted") {
        currentPermission = await Notification.requestPermission();
      }

      setPermission(currentPermission as PermissionState);

      if (currentPermission !== "granted") {
        setError("Permission de notification non accordée.");
        return;
      }

      const registration = await waitForServiceWorkerReady();
      if (!registration) {
        setError("Le service worker n’est pas prêt. Recharge la page puis réessaie.");
        return;
      }

      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        const keyResponse = await fetch("/api/push/vapid", { cache: "no-store" });
        if (!keyResponse.ok) {
          setError("Impossible de récupérer la clé VAPID des notifications.");
          return;
        }

        const { key } = (await keyResponse.json()) as { key?: string };
        if (!key) {
          setError("Clé VAPID indisponible.");
          return;
        }

        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(String(key)),
        });
      }

      const subscribeResponse = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "web", subscription }),
      });

      const payload = await subscribeResponse.json().catch(() => null);

      if (!subscribeResponse.ok || !payload?.ok) {
        setError(
          payload?.error
            ? `Abonnement push refusé : ${payload.error}`
            : "Abonnement push refusé par le serveur."
        );
        return;
      }

      setPermission("granted");
      setMessage("Notifications activées sur cet appareil ✅");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue pendant l’activation des notifications.");
    } finally {
      setBusy(false);
    }
  }

  const alreadyEnabled = permission === "granted";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
      {isiOS && !isStandalone ? (
        <div className="mb-2 text-slate-700">
          <b>iPhone/iPad :</b> ouvrez dans <b>Safari</b>, puis <b>Partager</b> → <b>Ajouter à l’écran d’accueil</b>.
        </div>
      ) : null}

      {deferred && !isStandalone ? (
        <button
          type="button"
          onClick={install}
          className="mb-2 rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white"
        >
          Installer l’app
        </button>
      ) : null}

      <div className="space-y-2">
        {alreadyEnabled ? (
          <div className="font-semibold text-emerald-700">Notifications déjà autorisées ✅</div>
        ) : (
          <>
            <div className="text-slate-700">Vous pouvez activer les notifications sur cet appareil.</div>
            <button
              type="button"
              onClick={enablePush}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Activation..." : "Activer les notifications"}
            </button>
          </>
        )}

        {message ? <div className="text-emerald-700">{message}</div> : null}
        {error ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">{error}</div> : null}
      </div>
    </div>
  );
}
