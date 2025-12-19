/* ─────────────────────────────────────────
   Service Worker - Push + Offline Cache
   (amélioré, rétro-compatible)

   ✅ Conserve 100% du push existant
   ✅ Ajoute cache "app shell" + pages + assets + quelques GET API utiles
   ✅ Fallback offline sur /offline.html (si présent)
   ✅ Nettoyage des anciens caches à l’activate

   Bumper la version pour forcer l'update
────────────────────────────────────────── */
const SW_VERSION = "2025-12-19T23:59:00Z"; // ← change à chaque déploiement
const VERBOSE = true;

function log(stage, meta = {}) {
  if (!VERBOSE) return;
  try {
    console.info(`[SW push] ${stage}`, { v: SW_VERSION, ...meta });
  } catch {}
}
function shortId(s, n = 16) {
  s = String(s || "");
  return s.length <= n
    ? s
    : `${s.slice(0, Math.max(4, Math.floor(n / 2)))}…${s.slice(
        -Math.max(4, Math.floor(n / 2))
      )}`;
}

const TZ = "Africa/Abidjan";
function isUuidLike(s) {
  return /^[0-9a-f-]{32,36}$/i.test(String(s || "").trim());
}
function fmtDateTimeFR(iso) {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      timeZone: TZ,
      hour12: false,
    });
  } catch {
    return iso || "";
  }
}
function fmtHM(x) {
  try {
    return new Date(x).toLocaleTimeString("fr-FR", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}
function fmtSlot(startIso, minutes = 60) {
  if (!startIso) return "";
  const st = new Date(startIso);
  const en = new Date(st.getTime() + (Number(minutes) || 60) * 60000);
  return `${fmtHM(st)}–${fmtHM(en)}`;
}

/* Robustifier l'extraction du nom élève depuis différents schémas de payload */
function pickStudentName(core) {
  const s = (core && core.student) || {};
  const pieces = [];
  const join = (a, b) => [a, b].filter(Boolean).join(" ").trim();

  pieces.push(s.name);
  pieces.push(s.display_name);
  pieces.push(s.full_name);
  pieces.push(s.label);
  pieces.push(join(s.first_name, s.last_name));
  pieces.push(join(s.firstName, s.lastName));
  pieces.push(s.first_name);
  pieces.push(s.last_name);
  pieces.push(s.firstName);
  pieces.push(s.lastName);
  pieces.push(s.matricule);

  let cand = (pieces.find((x) => String(x || "").trim()) || "").toString().trim();
  if (!cand || isUuidLike(cand)) cand = (s.matricule || "").toString().trim();
  if (!cand) cand = "Élève";
  return cand;
}

/* ─────────────────────────────────────────
   OFFLINE CACHE (ajout)
────────────────────────────────────────── */
const CACHE_PREFIX = "moncahier";
const PAGE_CACHE = `${CACHE_PREFIX}:pages:${SW_VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}:assets:${SW_VERSION}`;
const API_CACHE = `${CACHE_PREFIX}:api:${SW_VERSION}`;
const MISC_CACHE = `${CACHE_PREFIX}:misc:${SW_VERSION}`;

const OFFLINE_FALLBACK_URL = "/offline.html";

/**
 * On reste prudent : on cache seulement des GET API "utiles" à l’appel
 * (sinon on risque de stocker trop de choses).
 */
const API_ALLOWLIST = new Set([
  // Téléphone de classe / Appel
  "/api/class/my-classes",
  "/api/teacher/sessions/open",
  "/api/class/subjects",
  "/api/class/roster",

  // Paramètres / périodes / settings (utiles pour afficher hors ligne)
  "/api/teacher/institution/basics",
  "/api/institution/basics",
  "/api/admin/institution/settings",
  "/api/teacher/conduct/settings",
  "/api/institution/conduct/settings",
  "/api/admin/conduct/settings",
]);

function isSameOrigin(url) {
  try {
    return url.origin === self.location.origin;
  } catch {
    return false;
  }
}

function isExcludedApiPath(pathname) {
  // ⚠️ push/auth : toujours réseau (évite cache de vapid/session/logout)
  return pathname.startsWith("/api/push/") || pathname.startsWith("/api/auth/");
}

function shouldCacheApi(pathname) {
  if (!pathname.startsWith("/api/")) return false;
  if (isExcludedApiPath(pathname)) return false;
  return API_ALLOWLIST.has(pathname);
}

async function cachePut(cacheName, req, res) {
  try {
    if (!res || !res.ok) return;
    // Ne stocker que du basic/cors OK
    const cache = await caches.open(cacheName);
    await cache.put(req, res.clone());
  } catch {
    /* ignore */
  }
}

async function cacheMatch(cacheName, req) {
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(req);
    return hit || null;
  } catch {
    return null;
  }
}

async function cacheFirst(req, cacheName) {
  const hit = await cacheMatch(cacheName, req);
  if (hit) return hit;

  try {
    const res = await fetch(req);
    await cachePut(cacheName, req, res);
    return res;
  } catch (err) {
    // Pas de fallback pertinent pour un JS/CSS => renvoie 504
    return new Response(null, { status: 504, statusText: "offline" });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const hit = await cacheMatch(cacheName, req);

  const fetchPromise = (async () => {
    try {
      const res = await fetch(req);
      await cachePut(cacheName, req, res);
      return res;
    } catch {
      return null;
    }
  })();

  return hit || (await fetchPromise) || new Response(null, { status: 504, statusText: "offline" });
}

async function networkFirstNavigate(req) {
  try {
    const res = await fetch(req);
    await cachePut(PAGE_CACHE, req, res);
    return res;
  } catch {
    const hit = await cacheMatch(PAGE_CACHE, req);
    if (hit) return hit;

    const offline = await cacheMatch(PAGE_CACHE, OFFLINE_FALLBACK_URL);
    return offline || new Response("Offline", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
}

async function clearOldCaches() {
  const keep = new Set([PAGE_CACHE, ASSET_CACHE, API_CACHE, MISC_CACHE]);
  const keys = await caches.keys();
  const toDelete = keys.filter((k) => k.startsWith(`${CACHE_PREFIX}:`) && !keep.has(k));
  await Promise.all(toDelete.map((k) => caches.delete(k)));
  return toDelete.length;
}

/* ───────────────── install / activate ───────────────── */
self.addEventListener("install", (event) => {
  log("install");
  // ⚠️ Ne pas casser l’install si offline.html n’existe pas encore
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(PAGE_CACHE);
       await cache.addAll([
  OFFLINE_FALLBACK_URL,
        "/icons/icon-192.png",
       "/icons/badge-72.png",
    ]);

        log("precache_ok", { urls: [OFFLINE_FALLBACK_URL] });
      } catch (err) {
        log("precache_skip", { err: String(err) });
      }
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  log("activate");
  e.waitUntil(
    (async () => {
      const deleted = await clearOldCaches();
      await self.clients.claim();
      log("activate_done", { deleted });
    })()
  );
});

/* ───────────────── message (optionnel) ───────────────── */
self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg && msg.type === "SKIP_WAITING") {
    log("message_skip_waiting");
    self.skipWaiting();
    return;
  }
  if (msg && msg.type === "CLEAR_CACHES") {
    log("message_clear_caches");
    event.waitUntil(
      (async () => {
        try {
          const keys = await caches.keys();
          const del = keys.filter((k) => k.startsWith(`${CACHE_PREFIX}:`));
          await Promise.all(del.map((k) => caches.delete(k)));
          log("clear_caches_ok", { deleted: del.length });
        } catch (err) {
          log("clear_caches_err", { err: String(err) });
        }
      })()
    );
  }
});

/* ───────────────── fetch (ajout offline) ───────────────── */
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // On ne gère que les GET same-origin (ne pas toucher aux POST/PATCH/PUT/DELETE)
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (!isSameOrigin(url)) return;

  const pathname = url.pathname;

  // 1) Navigations HTML
  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigate(req));
    return;
  }

  // 2) Next.js static assets
  if (pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }

  // 3) Next.js images (optimisées)
  if (pathname.startsWith("/_next/image")) {
    event.respondWith(staleWhileRevalidate(req, MISC_CACHE));
    return;
  }

  // 4) API GET (cache seulement une allowlist "utile appel")
  if (pathname.startsWith("/api/")) {
    if (isExcludedApiPath(pathname)) {
      // push/auth: toujours réseau
      event.respondWith(fetch(req));
      return;
    }
    if (shouldCacheApi(pathname)) {
      event.respondWith(staleWhileRevalidate(req, API_CACHE));
      return;
    }
    // Autres API: réseau (pas de cache)
    event.respondWith(fetch(req));
    return;
  }

  // 5) Autres ressources : images/fonts => SWR, scripts/styles => cache-first
  const dest = req.destination;
  if (dest === "script" || dest === "style" || dest === "worker") {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }
  if (dest === "image" || dest === "font") {
    event.respondWith(staleWhileRevalidate(req, MISC_CACHE));
    return;
  }

  // 6) Fallback
  event.respondWith(staleWhileRevalidate(req, MISC_CACHE));
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

  // Le dispatcher envoie { title, body, url, data: core }.
  // On prend en charge les 2 formats: champs au top-level OU dans data.data.
  const core =
    data && typeof data === "object" && data.data && typeof data.data === "object"
      ? data.data
      : data;

  // Champs communs
  const kind = String(core.kind || core.type || core.event || "").toLowerCase();
  const ev = String(core.event || core.status || "").toLowerCase();

  // Élève (évite les UUID en titre)
  const student = pickStudentName(core);

  const subj = (core?.subject && (core.subject.name || core.subject.label)) || "";
  const klass = (core?.class && (core.class.label || core.class.name)) || "";

  // Créneau / datation
  const startedAt = core?.session?.started_at || core?.started_at || core?.occurred_at || "";
  const expectedMin =
    Number(core?.session?.expected_minutes || core?.expected_minutes || 60) || 60;
  const slot = startedAt ? fmtSlot(startedAt, expectedMin) : "";
  const whenIso = core?.occurred_at || startedAt || core?.created_at || "";
  const whenText = whenIso ? fmtDateTimeFR(whenIso) : "";

  // Par défaut: reprendre ce qui vient du backend
  let title = data.title || "Nouvelle notification";
  let body = data.body || "";

  // ───────── Sanctions
  if (kind === "conduct_penalty" || kind === "penalty") {
    const rubric = String(core.rubric || "discipline").toLowerCase();
    const rubricFR =
      rubric === "tenue" ? "Tenue" : rubric === "moralite" ? "Moralité" : "Discipline";
    const pts = Number(core.points || 0);
    const reason = (core.reason || core.motif || "").toString().trim();

    // ✨ auteur & matière → "Par le prof de <matière>" ou "Par l’administration"
    const role = String(core?.author?.role_label || core?.author_role_label || "")
      .normalize("NFKC")
      .toLowerCase();
    let byline = "";
    if (subj) {
      byline = `Par le prof de ${subj}`;
    } else if (role === "administration" || role === "admin") {
      byline = "Par l’administration";
    }

    title = `Sanction — ${student} (${rubricFR})`;
    body = [byline || rubricFR, klass, whenText, `−${pts} pt${pts > 1 ? "s" : ""}`, reason ? `Motif : ${reason}` : ""]
      .filter(Boolean)
      .join(" • ");
  }

  // ───────── Absences / Retards (avec cas "justifié" + date claire) ─────────
  else if (kind === "attendance" || ev === "absent" || ev === "late") {
    const isJustified =
      core.justified === true || String(core.action || "").toLowerCase() === "justified";

    const ml = Number(core.minutes_late || core.minutesLate || 0);
    const reason = (core.reason || core.motif || "").toString().trim();

    // Date explicite (jour/mois/année + jour de semaine)
    let dateLabel = "";
    if (whenIso) {
      try {
        dateLabel = new Date(whenIso).toLocaleDateString("fr-FR", {
          timeZone: TZ,
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
      } catch {
        dateLabel = whenText || "";
      }
    }

    // Créneau / fallback heure lecture
    const slotLabel = slot || whenText || "";
    const dateSlotLabel = dateLabel && slotLabel ? `${dateLabel} • ${slotLabel}` : slotLabel || dateLabel;

    if (ev === "late") {
      // RETARD
      title = `${isJustified ? "Retard justifié" : "Retard"} — ${student}`;
      body = [
        subj,
        klass,
        dateSlotLabel,
        ml ? `${ml} min` : "",
        isJustified ? "Justifié" : "",
        isJustified && reason ? `Motif : ${reason}` : "",
      ]
        .filter(Boolean)
        .join(" • ");
    } else if (ev === "absent") {
      // ABSENCE
      title = `${isJustified ? "Absence justifiée" : "Absence"} — ${student}`;
      body = [subj, klass, dateSlotLabel, isJustified ? "Justifiée" : "", isJustified && reason ? `Motif : ${reason}` : ""]
        .filter(Boolean)
        .join(" • ");
    } else {
      // autre évolution éventuelle du payload "attendance"
      title = title || `Présence — ${student}`;
      body = [subj, klass, dateSlotLabel].filter(Boolean).join(" • ");
    }
  }

  // ───────── Tag & options (dédup + renotify) ─────────
  let tag = data.tag || "";

  if (!tag) {
    if (kind === "admin_attendance_alert") {
      // On fabrique un tag unique par créneau d'appel
      const date = (core.date || whenIso || "").toString().trim();
      const classLabel = (core.class_label || "").toString().trim();
      const subjectName = (core.subject_name || "").toString().trim();
      const periodLabel = (core.period_label || "").toString().trim();
      const status = (core.status || "").toString().trim();
      const late = core.late_minutes != null ? String(core.late_minutes) : "";

      tag = ["admin_attendance", date, classLabel, subjectName, periodLabel, status, late].filter(Boolean).join(":");
    } else {
      // Comportement historique pour les autres notifs (élèves, sanctions, etc.)
      tag =
        `${kind || "notification"}:` +
        `${(core?.student && core.student.id) || ""}:` +
        `${whenIso || ""}:` +
        `${subj || ""}:` +
        `${klass || ""}`;
    }
  }

  const isAdminAttendance = kind === "admin_attendance_alert";

  const options = {
    body,
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/badge-72.png",
    tag,
    // Pour les alertes admin, on force renotify pour avoir un vrai toast à chaque fois
    renotify: isAdminAttendance ? true : !!data.renotify,
    requireInteraction: !!data.requireInteraction,
    data: {
      url: data.url || "/",
      ...(data.data || {}), // on conserve le payload brut pour la page
    },
  };

  log("push_parsed", {
    parseMode,
    kind,
    ev,
    title,
    hasBody: !!options.body,
    url: options.data?.url,
    tag: options.tag,
    slot: slot || null,
    requireInteraction: options.requireInteraction,
  });

  event.waitUntil(
    self.registration
      .showNotification(title, options)
      .then(() => log("showNotification_ok", { title }))
      .catch((err) => log("showNotification_err", { err: String(err) }))
  );
});

/* ───────────────── notification click: focus / open ───────────────── */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";
  log("notification_click", { url });

  event.waitUntil(
    (async () => {
      try {
        const all = await clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
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
          } catch {
            /* ignore */
          }
        }
        await clients.openWindow(url);
        log("openWindow_ok", { url });
      } catch (err) {
        log("openWindow_err", { err: String(err), url });
      }
    })()
  );
});

/* (facultatif) fermer: on log juste l’info */
self.addEventListener("notificationclose", (event) => {
  const url = event.notification?.data?.url || "/";
  log("notification_close", { url });
});

/* ───────────────── pushsubscriptionchange: réabonnement ───────────────── */
self.addEventListener("pushsubscriptionchange", (event) => {
  log("pushsubscriptionchange_fired");

  event.waitUntil(
    (async () => {
      try {
        const r = await fetch("/api/push/vapid", { cache: "no-store" });
        const { key } = await r.json();
        if (!key) {
          log("vapid_key_missing");
          return;
        }

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
          try {
            errText = await res.text();
          } catch {}
          log("subscribe_backend_err", { status: res.status, body: errText });
        } else {
          log("subscribe_backend_ok");
        }
      } catch (err) {
        log("pushsubscriptionchange_err", { err: String(err) });
      }
    })()
  );
});
