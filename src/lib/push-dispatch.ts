// src/lib/push-dispatch.ts
// Enclenche /api/push/dispatch immédiatement après l'insert en BDD.
// - Auth via x-cron-secret (fallback Bearer).
// - Détecte la bonne BASE URL (headers req > NEXT_PUBLIC_BASE_URL > VERCEL_URL).
// - Retries courts + fallback apex<->www, sans bloquer la route (utiliser `void` à l'appel).

type Opts = {
  req?: Request;           // pour récupérer host/proto (Vercel)
  reason?: string;         // tag log (ex: "attendance_bulk")
  timeoutMs?: number;      // 400..3000 (par défaut 1000)
  retries?: number;        // 0..3 (par défaut 2)
};

let lastFire = 0; // petit anti-storm global au process

function sanitizeBase(u: string) {
  if (!u) return "";
  let s = u.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, "");
}

function swapApexWww(u: string) {
  try {
    const url = new URL(u);
    const h = url.host;
    url.host = h.startsWith("www.") ? h.slice(4) : `www.${h}`;
    return url.toString();
  } catch { return u; }
}

async function callOnce(url: string, body: string, secret: string, timeoutMs: number, mode: "x-cron" | "bearer") {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "mca-inline-dispatch",
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
      redirect: "follow", // attention: 301/302 peuvent switcher en GET; on évite les redirs en choisissant la bonne base
    });
    if (res.ok) return true;

    const txt = await res.text().catch(() => "");
    console.warn("[inline-dispatch] non-2xx", { url, code: res.status, mode, txt: txt.slice(0, 160) });
    return false;
  } catch (e: any) {
    console.warn("[inline-dispatch] fetch_err", { url, mode, err: String(e?.message || e) });
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function triggerPushDispatch(opts: Opts = {}) {
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();
  if (!secret) {
    console.warn("[inline-dispatch] missing CRON_SECRET/CRON_PUSH_SECRET");
    return false;
  }

  const now = Date.now();
  if (now - lastFire < 200) return true; // debouncing léger
  lastFire = now;

  // 1) Résoudre la base URL
  let base = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL || "";
  if (opts.req) {
    const proto = opts.req.headers.get("x-forwarded-proto") || "https";
    const host  = opts.req.headers.get("x-forwarded-host") || opts.req.headers.get("host") || "";
    if (host) base = `${proto}://${host}`;
  }
  base = sanitizeBase(base);
  const url = `${base}/api/push/dispatch`;

  const timeoutMs = Math.max(400, Math.min(3000, opts.timeoutMs ?? 1000));
  const retries   = Math.max(0, Math.min(3, opts.retries ?? 2));
  const body      = JSON.stringify({ source: "inline", reason: opts.reason || "" });

  // 2) Tentatives: x-cron -> bearer -> swap host x-cron -> swap host bearer
  const tries: Array<{ url: string; mode: "x-cron" | "bearer" }> = [
    { url, mode: "x-cron" },
    { url, mode: "bearer" },
    { url: swapApexWww(url), mode: "x-cron" },
    { url: swapApexWww(url), mode: "bearer" },
  ];

  for (let i = 0; i < tries.length && i <= retries + 1; i++) {
    const ok = await callOnce(tries[i].url, body, secret, timeoutMs, tries[i].mode);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 150 + i * 200)); // petit backoff
  }
  return false;
}
