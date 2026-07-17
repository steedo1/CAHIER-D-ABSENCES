// src/components/InstallAndPushCTA.tsx
"use client";

import React from "react";
import { MON_CAHIER_SW_URL } from "@/lib/offline";

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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: number | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (typeof timer === "number") {
      window.clearTimeout(timer);
    }
  }
}

async function waitForServiceWorkerReady(timeoutMs = 12000) {
  if (!("serviceWorker" in navigator)) return null;

  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) {
    await navigator.serviceWorker.register(MON_CAHIER_SW_URL, { scope: "/" });
  }

  return await withTimeout(
    navigator.serviceWorker.ready,
    timeoutMs,
    "Le service worker ne répond pas. Recharge la page puis réessaie."
  );
}

function formatPermissionHelp() {
  return "Clique sur l’icône cadenas ou la petite cloche dans la barre d’adresse, autorise les notifications, puis recharge la page.";
}

export default function InstallAndPushCTA() {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = React.useState(false);
  const [isiOS, setIsiOS] = React.useState(false);
  const [permission, setPermission] = React.useState<PermissionState>("default");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<string | null>(null);

  React.useEffect(() => {
    const refresh = () => setPermission(getNotificationPermission());

    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);

    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  React.useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");

    setIsStandalone(
      mq.matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );

    setIsiOS(/iphone|ipad|ipod/i.test(navigator.userAgent));

    const handler = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
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
    setStep("Vérification du navigateur…");

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
        setPermission("denied");
        setError(`Les notifications sont bloquées. ${formatPermissionHelp()}`);
        return;
      }

      if (currentPermission !== "granted") {
        setStep("Autorisation navigateur en attente…");

        currentPermission = await withTimeout(
          Notification.requestPermission(),
          15000,
          `Le navigateur attend encore l’autorisation. ${formatPermissionHelp()}`
        );
      }

      setPermission(currentPermission as PermissionState);

      if (currentPermission !== "granted") {
        setError(`Permission de notification non accordée. ${formatPermissionHelp()}`);
        return;
      }

      setStep("Préparation du service worker…");

      const registration = await waitForServiceWorkerReady();

      if (!registration) {
        setError("Le service worker n’est pas prêt. Recharge la page puis réessaie.");
        return;
      }

      setStep("Création ou récupération de l’abonnement push…");

      let subscription = await withTimeout(
        registration.pushManager.getSubscription(),
        8000,
        "Impossible de lire l’abonnement push existant."
      );

      if (!subscription) {
        setStep("Récupération de la clé VAPID…");

        const keyResponse = await withTimeout(
          fetch("/api/push/vapid", {
            cache: "no-store",
            credentials: "include",
          }),
          10000,
          "La route /api/push/vapid ne répond pas."
        );

        if (!keyResponse.ok) {
          const txt = await keyResponse.text().catch(() => "");
          setError(`Impossible de récupérer la clé VAPID (${keyResponse.status}). ${txt}`.trim());
          return;
        }

        const { key } = (await keyResponse.json()) as { key?: string };

        if (!key) {
          setError("Clé VAPID indisponible dans la réponse serveur.");
          return;
        }

        subscription = await withTimeout(
          registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(String(key)),
          }),
          15000,
          `Le navigateur n’a pas terminé la création de l’abonnement. ${formatPermissionHelp()}`
        );
      }

      setStep("Enregistrement dans Mon Cahier…");

      const subscribeResponse = await withTimeout(
        fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            platform: "web",
            subscription,
          }),
        }),
        12000,
        "La route /api/push/subscribe ne répond pas."
      );

      const text = await subscribeResponse.text().catch(() => "");

      let payload: { ok?: boolean; error?: string; user_id?: string; userId?: string } | null = null;

      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (!subscribeResponse.ok || !payload?.ok) {
        setError(
          payload?.error
            ? `Abonnement push refusé : ${payload.error}`
            : `Abonnement push refusé par le serveur (${subscribeResponse.status}). ${text}`.trim()
        );
        return;
      }

      setPermission("granted");
      setMessage("Notifications activées et synchronisées pour ce compte ✅");
      setStep(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erreur inconnue pendant l’activation des notifications."
      );
    } finally {
      setBusy(false);
    }
  }

  const alreadyAuthorized = permission === "granted";
  const denied = permission === "denied";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
      {isiOS && !isStandalone ? (
        <div className="mb-2 text-slate-700">
          <b>iPhone/iPad :</b> ouvrez dans <b>Safari</b>, puis <b>Partager</b> →{" "}
          <b>Ajouter à l’écran d’accueil</b>.
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
        {alreadyAuthorized ? (
          <div className="font-semibold text-emerald-700">
            Notifications déjà autorisées sur ce navigateur ✅
          </div>
        ) : denied ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
            Les notifications sont bloquées. {formatPermissionHelp()}
          </div>
        ) : (
          <div className="text-slate-700">
            Vous pouvez activer les notifications sur cet appareil.
          </div>
        )}

        <button
          type="button"
          onClick={enablePush}
          disabled={busy || denied}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy
            ? "Activation…"
            : alreadyAuthorized
              ? "Synchroniser cet appareil"
              : "Activer les notifications"}
        </button>

        {step && busy ? <div className="text-xs font-medium text-slate-500">{step}</div> : null}

        {message ? <div className="text-emerald-700">{message}</div> : null}

        {error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
