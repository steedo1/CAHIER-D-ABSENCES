/* ─────────────────────────────────────────
   Service Worker - Push (verbose)
   Version horodatée pour vérifier le bon SW
────────────────────────────────────────── */
const SW_VERSION = "2025-11-04T23:00:00Z";
const VERBOSE = true;

function log(stage, meta = {}) {
  if (!VERBOSE) return;
  // Les logs du SW apparaissent dans DevTools > Application > Service Workers (ou la console avec [SW])
  try { console.info(`[SW push] ${stage}`, { v: SW_VERSION, ...meta }); } catch {}
}
function shortId(s, n = 16) {
  s = String(s || "");
  return s.length <= n ? s : `${s.slice(0, Math.max(4, Math.floor(n / 2)))}…${s.slice(-Math.max(4, Math.floor(n / 2)))}`;
}

/* ───────────────── install / activate ───────────────── */
self.addEventListener("install", () => {
  log("install");
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  log("activate");
  e.waitUntil(self.clients.claim());
});

/* ───────────────── push: affiche la notif ───────────────── */
self.addEventListener("push", (event) => {
  const hasData = !!event.data;
  log("push_received", { hasData });

  if (!event.data) return;

  let data = {};
  let parseMode = "none";
  try {
    data = event.data.json();
    parseMode = "json()";
  } catch (e1) {
    try {
      const txt = event.data.text(); // PushMessageData.text() est synchrone
      data = JSON.parse(txt || "{}");
      parseMode = "text()->JSON.parse";
    } catch (e2) {
      parseMode = "failed";
      data = {};
    }
  }

  const title = data.title || "Nouvelle notification";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/badge-72.png",
    tag: data.tag,
    renotify: !!data.renotify,
    requireInteraction: !!data.requireInteraction,
    data: {
      url: data.url || "/",
      ...(data.data || {}),
    },
  };

  log("push_parsed", {
    parseMode,
    title,
    hasBody: !!options.body,
    url: options.data?.url,
    tag: options.tag,
    requireInteraction: options.requireInteraction,
  });

  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => log("showNotification_ok", { title }))
      .catch((err) => log("showNotification_err", { err: String(err) }))
  );
});

/* ───────────────── notification click: focus / open ───────────────── */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";
  log("notification_click", { url });

  event.waitUntil((async () => {
    try {
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      log("clients_matchAll", { count: all.length });

      const targetPath = new URL(url, self.location.origin).pathname;
      for (const client of all) {
        try {
          const u = new URL(client.url);
          if (u.pathname === targetPath) {
            await client.focus();
            log("client_focus", { matched: client.url });
            return;
          }
        } catch (e) {
          // ignore parse errors
        }
      }
      await clients.openWindow(url);
      log("openWindow_ok", { url });
    } catch (err) {
      log("openWindow_err", { err: String(err), url });
    }
  })());
});

/* (facultatif) fermer: on log juste l’info */
self.addEventListener("notificationclose", (event) => {
  const url = event.notification?.data?.url || "/";
  log("notification_close", { url });
});

/* ───────────────── pushsubscriptionchange: réabonnement ───────────────── */
self.addEventListener("pushsubscriptionchange", (event) => {
  log("pushsubscriptionchange_fired");

  event.waitUntil((async () => {
    try {
      const r = await fetch("/api/push/vapid", { cache: "no-store" });
      const { key } = await r.json();
      if (!key) { log("vapid_key_missing"); return; }

      const toUint8 = (base64) => {
        const padding = "=".repeat((4 - (base64.length % 4)) % 4);
        const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
        const raw = atob(base64Safe);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
      };

      const reg = await self.registration;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toUint8(key),
      });
      log("subscribe_ok", { endpoint: shortId(sub?.endpoint) });

      // On envoie la nouvelle sub au backend (inclure les cookies = auth)
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subscription: sub }),
      });

      if (!res.ok) {
        let errText = "";
        try { errText = await res.text(); } catch {}
        log("subscribe_backend_err", { status: res.status, body: errText });
      } else {
        log("subscribe_backend_ok");
      }
    } catch (err) {
      log("pushsubscriptionchange_err", { err: String(err) });
    }
  })());
});
