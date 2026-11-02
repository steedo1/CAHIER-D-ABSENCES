/** One wake-up per channel in flight. Queue rows remain durable in Supabase. */
export type DispatchTriggerOptions = {
  req?: Request; reason?: string; timeoutMs?: number; retries?: number; baseUrl?: string;
};
const key = Symbol.for("mon-cahier.dispatch-wakeups");
const scope = globalThis as typeof globalThis & { [key]?: Map<string, Promise<boolean>> };
const pending = scope[key] ??= new Map();

export function dispatchOrigin(explicit?: string): string {
  const raw = explicit || process.env.RENDER_EXTERNAL_URL || process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.NODE_ENV === "production" ? "https://www.mon-cahier.com" : "http://localhost:3000");
  const url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw Error("INVALID_DISPATCH_ORIGIN");
  // Render subdomains have no www alias. Never invent DNS fallbacks.
  if (url.hostname.startsWith("www.") && url.hostname.endsWith(".onrender.com")) url.hostname = url.hostname.slice(4);
  return url.origin;
}

export async function triggerDispatch(channel: "push" | "sms", opts: DispatchTriggerOptions = {}) {
  const secret = (process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "").trim();
  if (!secret) return false;
  const active = pending.get(channel);
  if (active) return active;
  const work = (async () => {
    const controller = new AbortController();
    // A timeout has an unknown outcome: never start another batch as a fallback.
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(60_000, opts.timeoutMs ?? (channel === "push" ? 1000 : 5000))));
    timer.unref?.();
    try {
      const response = await fetch(`${dispatchOrigin(opts.baseUrl)}/api/${channel}/dispatch`, {
        method: "POST", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-cron-secret": secret },
        body: JSON.stringify({ source: "inline", reason: opts.reason || "" }),
      });
      // Release the connection/body even on a successful wake-up.
      await response.body?.cancel();
      if (!response.ok) console.warn("[dispatch-wakeup]", { channel, status: response.status });
      return response.ok;
    } catch {
      console.warn("[dispatch-wakeup] failed", { channel });
      return false;
    } finally { clearTimeout(timer); }
  })();
  pending.set(channel, work);
  try { return await work; } finally { if (pending.get(channel) === work) pending.delete(channel); }
}
