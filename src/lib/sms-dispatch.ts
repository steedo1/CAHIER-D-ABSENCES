// src/lib/sms-dispatch.ts
// Helper idempotent pour dÃ©clencher /api/sms/dispatch depuis nâ€™importe
// quelle route (prof, admin, cron inline, etc.).
// Ne modifie pas la file ; il appelle juste lâ€™endpoint avec le bon secret.

export type SmsDispatchOpts = {
  req?: Request;     // Request Next.js (pour lire host/proto si besoin)
  reason?: string;   // utile pour les logs cÃ´tÃ© /api/sms/dispatch
  timeoutMs?: number;
  retries?: number;  // nb de tentatives supplÃ©mentaires (dÃ©faut 2)
};

let lastSmsFire = 0;

/** Normalise une base URL : ajoute le schÃ©ma si absent, retire le trailing slash. */
function sanitizeBase(u: string) {
  if (!u) return "";
  let s = u.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, "");
}

/** Bascule entre apex et www (ex: app.moncahier.ci â†” www.app.moncahier.ci). */
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

/**
 * DÃ©duit la base URL.
 * PRIORITÃ‰ :
 *   1) NEXT_PUBLIC_BASE_URL
 *   2) headers de la requÃªte
 *   3) VERCEL_URL
 *   4) localhost en dev
 */
function resolveBaseFromReq(req?: Request) {
  let base = (process.env.NEXT_PUBLIC_BASE_URL || "").trim();

  if (!base && req) {
    const host =
      req.headers.get("x-forwarded-host") ||
      req.headers.get("host") ||
      "";
    let proto = req.headers.get("x-forwarded-proto") || "";
    if (!proto) proto = /^localhost(:\d+)?$/i.test(host) ? "http" : "https";
    if (host) base = `${proto}://${host}`;
  }

  if (!base) {
    base = (process.env.VERCEL_URL || "").trim();
  }

  base = sanitizeBase(base);

  if (!base) base = "http://localhost:3000";

  try {
    const u = new URL(base);
    if (/^localhost(:\d+)?$/i.test(u.host)) u.protocol = "http:";
    base = u.toString().replace(/\/+$/, "");
  } catch {
    // ignore
  }

  return base;
}

async function callOnce(
  url: string,
  body: string,
  secret: string,
  timeoutMs: number,
  mode: "x-cron" | "bearer"
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "mca-inline-sms-dispatch",
    };

    if (mode === "bearer") {
      headers.Authorization = `Bearer ${secret}`;
    } else {
      headers["x-cron-secret"] = secret;
    }

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
    console.warn("[inline-sms-dispatch] non-2xx", {
      url,
      code: res.status,
      mode,
      txt: txt.slice(0, 200),
    });
    return false;
  } catch (e: any) {
    console.warn("[inline-sms-dispatch] fetch_err", {
      url,
      mode,
      err: String(e?.message || e),
    });
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * DÃ©clenche le worker /api/sms/dispatch de maniÃ¨re fire-and-forget.
 * - throttle 200ms pour Ã©viter les rafales
 * - essaie x-cron-secret puis bearer
 * - fallback apex/www
 */
export async function triggerSmsDispatch(opts: SmsDispatchOpts = {}) {
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();
  if (!secret) {
    console.warn("[inline-sms-dispatch] missing CRON_SECRET/CRON_PUSH_SECRET");
    return false;
  }

  const now = Date.now();
  if (now - lastSmsFire < 200) return true;
  lastSmsFire = now;

  const base = resolveBaseFromReq(opts.req);
  const url = `${base}/api/sms/dispatch`;

  const timeoutMs = Math.max(400, Math.min(4000, opts.timeoutMs ?? 1200));
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
    const ok = await callOnce(
      tries[i].url,
      body,
      secret,
      timeoutMs,
      tries[i].mode
    );
    if (ok) return true;

    await new Promise((r) => setTimeout(r, 150 + i * 200));
  }

  return false;
}