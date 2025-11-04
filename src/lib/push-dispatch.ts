// src/lib/push-dispatch.ts
export type Opts = {
  req?: Request;
  reason?: string;
  timeoutMs?: number;
  retries?: number;
};

let lastFire = 0;

function sanitizeBase(u: string) {
  if (!u) return "";
  let s = u.trim();
  // ne touche pas si http/https déjà présent
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

function resolveBaseFromReq(req?: Request) {
  // 1) Env prioritaire si présent
  let base = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL || "";

  // 2) Headers (meilleure source en prod)
  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    let proto = req.headers.get("x-forwarded-proto") || "";

    // Localhost => http
    if (!proto) {
      if (/^localhost(:\d+)?$/i.test(host)) proto = "http";
      else proto = "https";
    }
    if (host) base = `${proto}://${host}`;
  }

  base = sanitizeBase(base);

  // Dernier filet : dev Next peut omettre les headers → force http://localhost:3000
  if (!base) base = "http://localhost:3000";

  // Corrige le combo https://localhost:3000 → http
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
  if (now - lastFire < 200) return true;
  lastFire = now;

  const base = resolveBaseFromReq(opts.req);
  const url  = `${base}/api/push/dispatch`;

  const timeoutMs = Math.max(400, Math.min(3000, opts.timeoutMs ?? 1000));
  const retries   = Math.max(0, Math.min(3, opts.retries ?? 2));
  const body      = JSON.stringify({ source: "inline", reason: opts.reason || "" });

  const tries: Array<{ url: string; mode: "x-cron" | "bearer" }> = [
    { url, mode: "x-cron" },
    { url, mode: "bearer" },
    { url: swapApexWww(url), mode: "x-cron" },
    { url: swapApexWww(url), mode: "bearer" },
  ];

  for (let i = 0; i < tries.length && i <= retries + 1; i++) {
    const ok = await callOnce(tries[i].url, body, secret, timeoutMs, tries[i].mode);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 150 + i * 200));
  }
  return false;
}
