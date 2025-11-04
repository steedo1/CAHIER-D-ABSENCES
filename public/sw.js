self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/* Affiche la notif côté SW (iOS incl.) */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json ? event.data.json() : JSON.parse(event.data?.text() || "{}"); } catch {}
  const title = data.title || "Nouvelle notification";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/badge-72.png",
    tag: data.tag,
    renotify: !!data.renotify,
    requireInteraction: !!data.requireInteraction,
    data: { url: data.url || "/", ...(data.data || {}) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Focus/ouvre l’onglet sur clic */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      try {
        const u = new URL(client.url);
        if (u.pathname === new URL(url, self.location.origin).pathname) { await client.focus(); return; }
      } catch {}
    }
    await clients.openWindow(url);
  })());
});

/* Réabonnement auto si l’OS invalide la sub */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    try {
      const r = await fetch("/api/push/vapid");
      const { key } = await r.json();
      if (!key) return;
      const reg = await self.registration;
      const toUint8 = (base64) => {
        const padding = "=".repeat((4 - (base64.length % 4)) % 4);
        const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
        const raw = atob(base64Safe);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
      };
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8(key) });
      await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub }) });
    } catch {}
  })());
});
