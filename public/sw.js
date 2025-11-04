/* public/sw.js */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/** Affiche la notification (obligatoire pour iOS/Safari). */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event?.data?.json ? event.data.json() : JSON.parse(event?.data?.text() || "{}");
  } catch (_) {}

  const title = data.title || "Nouvelle notification";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/badge-72.png",
    tag: data.tag,
    renotify: !!data.renotify,
    requireInteraction: !!data.requireInteraction,
    data: { url: data.url || "/parents", ...(data.data || {}) },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/** Ouvre/focalise l’onglet voulu quand on clique la notif. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/parents";

  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      try {
        const u = new URL(client.url);
        if (u.pathname === new URL(url, self.location.origin).pathname) {
          await client.focus();
          return;
        }
      } catch {}
    }
    await clients.openWindow(url);
  })());
});

/** Tentative de réabonnement si l’OS invalide la sub. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    try {
      const r = await fetch("/api/push/vapid");
      if (!r.ok) return;
      const { key } = await r.json();
      if (!key) return;

      const base64UrlToUint8 = (k) => {
        const padding = "=".repeat((4 - (k.length % 4)) % 4);
        const base64 = (k + padding).replace(/-/g, "+").replace(/_/g, "/");
        const raw = atob(base64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
      };

      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8(key),
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub, platform: "web" }),
      });
    } catch {}
  })());
});
