// src/lib/sms-dispatch.ts
// Helper idempotent pour déclencher /api/sms/dispatch depuis n’importe
// quelle route (prof, admin, cron inline, etc.).
// Ne modifie pas la file ; il appelle juste l’endpoint avec le bon secret.

export type SmsDispatchOpts = {
  req?: Request;
  reason?: string;
  timeoutMs?: number;
  retries?: number;
  baseUrl?: string;
};

let lastSmsFire = 0;

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
  } catch {
    return u;
  }
}

function resolveBaseFromReq(req?: Request, explicitBase?: string) {
  let base = "";
  let source = "";

  if (explicitBase?.trim()) {
    base = explicitBase.trim();
    source = "opts.baseUrl";
  }

  if (!base && process.env.NEXT_PUBLIC_APP_URL?.trim()) {
    base = process.env.NEXT_PUBLIC_APP_URL.trim();
    source = "NEXT_PUBLIC_APP_URL";
  }

  if (!base && process.env.NEXT_PUBLIC_BASE_URL?.trim()) {
    base = process.env.NEXT_PUBLIC_BASE_URL.trim();
    source = "NEXT_PUBLIC_BASE_URL";
  }

  if (!base && req) {
    const host =
      req.headers.get("x-forwarded-host") ||
      req.headers.get("host") ||
      "";
    let proto = req.headers.get("x-forwarded-proto") || "";
    if (!proto) proto = /^localhost(:\d+)?$/i.test(host) ? "http" : "https";
    if (host) {
      base = `${proto}://${host}`;
      source = "request_headers";
    }
  }

  if (!base && process.env.VERCEL_URL?.trim()) {
    base = process.env.VERCEL_URL.trim();
    source = "VERCEL_URL";
  }

  base = sanitizeBase(base);

  if (!base) {
    base = "http://localhost:3000";
    source = "localhost_fallback";
  }

  try {
    const u = new URL(base);
    if (/^localhost(:\d+)?$/i.test(u.host)) u.protocol = "http:";
    base = u.toString().replace(/\/+$/, "");
  } catch {
    // ignore
  }

  return { base, source };
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

    if (res.ok) {
      console.info("[inline-sms-dispatch] ok", {
        url,
        code: res.status,
        mode,
      });
      return true;
    }

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

export async function triggerSmsDispatch(opts: SmsDispatchOpts = {}) {
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();

  if (!secret) {
    console.warn("[inline-sms-dispatch] missing CRON_SECRET/CRON_PUSH_SECRET");
    return false;
  }

  const now = Date.now();
  if (now - lastSmsFire < 200) return true;
  lastSmsFire = now;

  const { base, source } = resolveBaseFromReq(opts.req, opts.baseUrl);
  const url = `${base}/api/sms/dispatch`;

  const timeoutMs = Math.max(1500, Math.min(10000, opts.timeoutMs ?? 5000));
  const retries = Math.max(0, Math.min(3, opts.retries ?? 2));

  const body = JSON.stringify({
    source: "inline",
    reason: opts.reason || "",
    ts: new Date().toISOString(),
  });

  console.info("[inline-sms-dispatch] start", {
    base,
    baseSource: source,
    url,
    timeoutMs,
    retries,
    hasReq: !!opts.req,
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