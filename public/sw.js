/* ─────────────────────────────────────────
   Service Worker - Push (amélioré, rétro-compatible)
   Bumper la version pour forcer l'update
────────────────────────────────────────── */
const SW_VERSION = "2025-11-05T19:59:59Z"; // ← change à chaque déploiement
const VERBOSE = true;

function log(stage, meta = {}) {
  if (!VERBOSE) return;
  try { console.info(`[SW push] ${stage}`, { v: SW_VERSION, ...meta }); } catch {}
}
function shortId(s, n = 16) {
  s = String(s || "");
  return s.length <= n ? s : `${s.slice(0, Math.max(4, Math.floor(n / 2)))}…${s.slice(-Math.max(4, Math.floor(n / 2)))}`;
}
const TZ = "Africa/Abidjan";
function isUuidLike(s) { return /^[0-9a-f-]{32,36}$/i.test(String(s||"").trim()); }
function fmtDateTimeFR(iso) {
  try { return new Date(iso).toLocaleString("fr-FR", { timeZone: TZ, hour12: false }); } catch { return iso || ""; }
}
function fmtHM(x) {
  try { return new Date(x).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return ""; }
}
function fmtSlot(startIso, minutes = 60) {
  if (!startIso) return "";
  const st = new Date(startIso);
  const en = new Date(st.getTime() + (Number(minutes)||60) * 60000);
  return `${fmtHM(st)}–${fmtHM(en)}`;
}

/* Robustifier l'extraction du nom élève depuis différents schémas de payload */
function pickStudentName(core) {
  const s = (core && core.student) || {};
  const pieces = [];
  const join = (a,b) => [a,b].filter(Boolean).join(" ").trim();

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

  let cand = (pieces.find(x => String(x||"").trim()) || "").toString().trim();
  if (!cand || isUuidLike(cand)) cand = (s.matricule || "").toString().trim();
  if (!cand) cand = "Élève";
  return cand;
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

  // Le dispatcher envoie { title, body, url, data: core }.
  // On prend en charge les 2 formats: champs au top-level OU dans data.data.
  const core = (data && typeof data === "object" && data.data && typeof data.data === "object")
    ? data.data
    : data;

  // Champs communs
  const kind = String(core.kind || core.type || core.event || "").toLowerCase();
  const ev   = String(core.event || core.status || "").toLowerCase();

  // Élève (évite les UUID en titre)
  const student = pickStudentName(core);

  const subj  = (core?.subject && (core.subject.name || core.subject.label)) || "";
  const klass = (core?.class   && (core.class.label   || core.class.name))   || "";

  // Créneau / datation
  const startedAt = core?.session?.started_at || core?.started_at || core?.occurred_at || "";
  const expectedMin = Number(core?.session?.expected_minutes || core?.expected_minutes || 60) || 60;
  const slot = startedAt ? fmtSlot(startedAt, expectedMin) : "";
  const whenIso = core?.occurred_at || startedAt || core?.created_at || "";
  const whenText = whenIso ? fmtDateTimeFR(whenIso) : "";

  // Par défaut: reprendre ce qui vient du backend
  let title = data.title || "Nouvelle notification";
  let body  = data.body  || "";

  // ───────── Sanctions
  if (kind === "conduct_penalty" || kind === "penalty") {
    const rubric = String(core.rubric || "discipline").toLowerCase();
    const rubricFR = rubric === "tenue" ? "Tenue" : rubric === "moralite" ? "Moralité" : "Discipline";
    const pts = Number(core.points || 0);
    const reason = (core.reason || core.motif || "").toString().trim();

    // ✨ auteur & matière → "Par le prof de <matière>" ou "Par l’administration"
    const role =
      String(core?.author?.role_label || core?.author_role_label || "")
        .normalize("NFKC")
        .toLowerCase();
    let byline = "";
    if (subj) {
      byline = `Par le prof de ${subj}`;
    } else if (role === "administration" || role === "admin") {
      byline = "Par l’administration";
    }

    title = `Sanction — ${student} (${rubricFR})`;
    body = [
      byline || rubricFR,
      klass,
      whenText,
      `−${pts} pt${pts > 1 ? "s" : ""}`,
      reason ? `Motif : ${reason}` : ""
    ].filter(Boolean).join(" • ");
  }

  // ───────── Absences / Retards
  else if (kind === "attendance" || ev === "absent" || ev === "late") {
    if (ev === "late") {
      const ml = Number(core.minutes_late || core.minutesLate || 0);
      title = `Retard — ${student}`;
      body  = [subj, klass, slot || whenText, ml ? `${ml} min` : ""].filter(Boolean).join(" • ");
    } else if (ev === "absent") {
      title = `Absence — ${student}`;
      body  = [subj, klass, slot || whenText].filter(Boolean).join(" • ");
    } else {
      // autre évolution éventuelle du payload "attendance"
      title = title || `Présence — ${student}`;
      body  = [subj, klass, slot || whenText].filter(Boolean).join(" • ");
    }
  }

  // Tag pour limiter les doublons de même élève/événement
  const tag =
    data.tag ||
    `${kind || "notification"}:${core?.student?.id || ""}:${whenIso || ""}:${subj || ""}:${klass || ""}`;

  const options = {
    body,
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/badge-72.png",
    tag,
    renotify: !!data.renotify,
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
        } catch { /* ignore */ }
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
