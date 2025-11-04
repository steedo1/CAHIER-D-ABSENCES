// src/lib/push-dispatch.ts
// Petit helper idempotent pour déclencher /api/push/dispatch depuis n’importe
// quelle route (classe, prof, admin…). Ne modifie pas la file ; il “tape” juste
// l’endpoint avec le bon secret et gère quelques fallback (apex/www).
export type Opts = {
  req?: Request;     // Request Next.js (pour lire les headers host/proto en prod)
  reason?: string;   // Juste pour les logs côté /api/push/dispatch
  timeoutMs?: number;
  retries?: number;  // nb de tentatives supplémentaires (par défaut 2)
};

let lastFire = 0;

/** Normalise une base URL : ajoute le schéma si absent, retire le trailing slash. */
function sanitizeBase(u: string) {
  if (!u) return "";
  let s = u.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, "");
}

/** Bascule entre apex et www (ex: mca.com ↔ www.mca.com) pour contourner certains DNS. */
function swapApexWww(u: string) {
  try {
    const url = new URL(u);
    const h = url.host;
    url.host = h.startsWith("www.") ? h.slice(4) : `www.${h}`;
    return url.toString();
  } catch {
    return u;
  }
}

/** Déduit la base URL à partir des envs et des headers de la requête (si fournie). */
function resolveBaseFromReq(req?: Request) {
  // 1) Env (prioritaire si défini proprement)
  let base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.VERCEL_URL || // souvent sans schéma
    "";

  // 2) Headers (source la plus fiable en prod)
  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    let proto = req.headers.get("x-forwarded-proto") || "";
    if (!proto) proto = /^localhost(:\d+)?$/i.test(host) ? "http" : "https";
    if (host) base = `${proto}://${host}`;
  }

  base = sanitizeBase(base);

  // 3) Filet de sécurité en dev local
  if (!base) base = "http://localhost:3000";

  // Corrige le cas https://localhost:3000 (force http)
  try {
    const u = new URL(base);
    if (/^localhost(:\d+)?$/i.test(u.host)) u.protocol = "http:";
    base = u.toString().replace(/\/+$/, "");
  } catch {}

  return base;
}

async function callOnce(
  url: string,
  body: string,
  secret: string,
  timeoutMs: number,
  mode: "x-cron" | "bearer",
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "mca-inline-dispatch",
      // certains middlewares vérifient ce header côté Vercel
      "x-vercel-cron": "1",
    };
    if (mode === "bearer") headers.Authorization = `Bearer ${secret}`;
    else headers["x-cron-secret"] = secret;

    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers,
      body,
      signal: controller.signal,
      redirect: "follow",
    });

    if (res.ok) return true;

    const txt = await res.text().catch(() => "");
    console.warn("[inline-dispatch] non-2xx", {
      url,
      code: res.status,
      mode,
      txt: txt.slice(0, 160),
    });
    return false;
  } catch (e: any) {
    console.warn("[inline-dispatch] fetch_err", { url, mode, err: String(e?.message || e) });
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Déclenche le worker /api/push/dispatch de manière “fire-and-forget”.
 * - throttle 200ms pour éviter les rafales
 * - essaie x-cron puis bearer, avec fallback apex/www
 */
export async function triggerPushDispatch(opts: Opts = {}) {
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();
  if (!secret) {
    console.warn("[inline-dispatch] missing CRON_SECRET/CRON_PUSH_SECRET");
    return false;
  }

  // anti-rafale : si on a déjà déclenché il y a <200ms, on considère OK
  const now = Date.now();
  if (now - lastFire < 200) return true;
  lastFire = now;

  const base = resolveBaseFromReq(opts.req);
  const url = `${base}/api/push/dispatch`;

  const timeoutMs = Math.max(400, Math.min(3000, opts.timeoutMs ?? 1000));
  const retries = Math.max(0, Math.min(3, opts.retries ?? 2));

  const body = JSON.stringify({
    source: "inline",
    reason: opts.reason || "",
    ts: new Date().toISOString(),
  });

  const tries: Array<{ url: string; mode: "x-cron" | "bearer" }> = [
    { url, mode: "x-cron" },
    { url, mode: "bearer" },
    { url: swapApexWww(url), mode: "x-cron" },
    { url: swapApexWww(url), mode: "bearer" },
  ];

  for (let i = 0; i < tries.length && i <= retries + 1; i++) {
    const ok = await callOnce(tries[i].url, body, secret, timeoutMs, tries[i].mode);
    if (ok) return true;
    // petit backoff linéaire
    await new Promise((r) => setTimeout(r, 150 + i * 200));
  }

  return false;
}
