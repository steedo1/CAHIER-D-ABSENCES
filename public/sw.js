/* public/sw.js */
self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

/** Affiche la notif côté SW (obligatoire pour iOS). */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    // Safari iOS/macOS supporte event.data.json()
    data = event.data?.json ? event.data.json() : JSON.parse(event.data?.text() || "{}");
  } catch (_) {}

  const title = data.title || "Nouvelle notification";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/badge-72.png",
    tag: data.tag,
    renotify: !!data.renotify,
    // iOS ignore encore requireInteraction, mais n’est pas bloquant
    requireInteraction: !!data.requireInteraction,
    data: {
      url: data.url || "/",
      ...data.data,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/** Ouvre/focalise l’onglet voulu quand on clique la notif. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        // si onglet déjà ouvert sur le même chemin -> focus
        try {
          const u = new URL(client.url);
          if (u.pathname === new URL(url, self.location.origin).pathname) {
            await client.focus();
            return;
          }
        } catch {}
      }
      await clients.openWindow(url);
    })()
  );
});

/** Tentative de réabonnement si l’OS invalide la sub. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const appServerKey = (await fetch("/api/push/vapid")).ok
        ? (await (await fetch("/api/push/vapid")).json()).key
        : null;
      if (!appServerKey) return;
      const reg = await self.registration;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: (key => {
          const padding = "=".repeat((4 - (key.length % 4)) % 4);
          const base64 = (key + padding).replace(/-/g, "+").replace(/_/g, "/");
          const raw = atob(base64);
          const out = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
          return out;
        })(appServerKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub }),
      });
    })()
  );
});
