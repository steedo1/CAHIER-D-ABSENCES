// src/components/InstallAndPushCTA.tsx
"use client";
import React from "react";

export default function InstallAndPushCTA() {
  const [deferred, setDeferred] = React.useState<any>(null);
  const [isStandalone, setIsStandalone] = React.useState(false);
  const [isiOS, setIsiOS] = React.useState(false);

  // ⭐ AJOUT 1: permission déjà accordée ?
  const [granted, setGranted] = React.useState(false);
  React.useEffect(() => {
    // safe côté SSR + refresh quand l’onglet revient au premier plan
    const refresh = () =>
      setGranted(
        typeof Notification !== "undefined" &&
          Notification.permission === "granted"
      );
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  // (Optionnel +++ : vérifier aussi l’existence d’un abonnement SW pour éviter le faux positif "granted mais pas abonné")

  React.useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    setIsStandalone(mq.matches || (window.navigator as any).standalone === true);
    setIsiOS(/iphone|ipad|ipod/i.test(navigator.userAgent));

    const handler = (e: any) => {
      e.preventDefault();
      setDeferred(e); // Android/Chrome: beforeinstallprompt capturé
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null);
  }

  async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      alert("Votre navigateur ne supporte pas les notifications push.");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      alert("Permission refusée.");
      return;
    }
    const reg = await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await fetch("/api/push/vapid").then((r) => r.json());
      if (!key) {
        alert("Clé VAPID indisponible.");
        return;
      }
      const toU8 = (b64: string) => {
        const p = "=".repeat((4 - (b64.length % 4)) % 4);
        const base64 = (b64 + p).replace(/-/g, "+").replace(/_/g, "/");
        const raw = atob(base64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
      };
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toU8(String(key)),
      });
    }
    // Enreg. côté serveur
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "web", subscription: sub }),
    });
    alert("Notifications activées ✅");
  }

  if (isStandalone) {
    // Déjà “installé” (PWA)
    return (
      <div className="rounded-xl border p-3 flex flex-wrap items-center gap-2">
        <div className="text-sm">Application installée.</div>
        {/* ⭐ AJOUT 2: cacher le bouton si déjà accordé */}
        {granted ? (
          <span className="text-sm text-emerald-700">Notifications déjà activées ✅</span>
        ) : (
          <button
            onClick={enablePush}
            className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm"
          >
            Activer les notifications
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-3 space-y-2">
      {isiOS ? (
        <div className="space-y-2">
          <div className="text-sm">
            <b>iPhone/iPad :</b> Ouvrez dans <b>Safari</b>, appuyez sur{" "}
            <b>Partager</b> → <b>Ajouter à l’écran d’accueil</b>, puis rouvrez
            l’app et cliquez <i>Activer les notifications</i>.
          </div>
          {/* ⭐ AJOUT 3: bouton masqué si déjà accordé */}
          {!granted ? (
            <button
              onClick={enablePush}
              className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm"
            >
              Activer les notifications
            </button>
          ) : (
            <span className="text-sm text-emerald-700">Notifications déjà activées ✅</span>
          )}
        </div>
      ) : deferred ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={install}
            className="rounded-lg bg-slate-900 text-white px-3 py-1.5 text-sm"
          >
            Installer l’app
          </button>
          {/* ⭐ AJOUT 4: bouton masqué si déjà accordé */}
          {!granted ? (
            <button
              onClick={enablePush}
              className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm"
            >
              Activer les notifications
            </button>
          ) : (
            <span className="text-sm text-emerald-700">Notifications déjà activées ✅</span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm">Vous pouvez activer les notifications dès maintenant.</div>
          {/* ⭐ AJOUT 5: bouton masqué si déjà accordé */}
          {!granted ? (
            <button
              onClick={enablePush}
              className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm"
            >
              Activer les notifications
            </button>
          ) : (
            <span className="text-sm text-emerald-700">Notifications déjà activées ✅</span>
          )}
        </div>
      )}
    </div>
  );
}
