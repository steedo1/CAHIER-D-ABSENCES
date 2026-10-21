// Exactly one authenticated call. A failed/ambiguous POST must not be retried
// automatically: the job may already have created or delivered notifications.
import { pathToFileURL } from "node:url";

const allowedPaths = new Set([
  "/api/admin/attendance/alerts", "/api/push/dispatch", "/api/sms/dispatch",
]);

export async function callProductionCron(env, network = fetch) {
  const endpoint = new URL(String(env.CRON_URL || "").trim());
  const path = String(env.CRON_EXPECTED_PATH || "");
  if (endpoint.protocol !== "https:" || !["mon-cahier.com", "www.mon-cahier.com"].includes(endpoint.host) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !allowedPaths.has(path) || endpoint.pathname !== path) {
    throw new Error("CRON_DESTINATION_INVALID");
  }
  // The apex redirects to www. Resolve the known public host before attaching
  // credentials; fetch must reject every subsequent redirect.
  endpoint.hostname = "www.mon-cahier.com";
  const secret = String(env.CRON_SECRET || "").trim();
  if (!secret) throw new Error("CRON_SECRET_MISSING");
  if (env.CRON_VALIDATE_ONLY === "1") return { ok: true, validated: true, path };
  const response = await network(endpoint.href, {
    method: "POST", redirect: "error", cache: "no-store",
    headers: { "x-cron-secret": secret, "Content-Type": "application/json", "User-Agent": "mon-cahier-github-cron" },
    body: JSON.stringify({ source: "github-actions" }),
    signal: AbortSignal.timeout(25_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) {
    // Do not include server bodies: they can contain school or contact data.
    throw new Error(`CRON_FAILED_HTTP_${response.status}`);
  }
  return { ok: true, status: response.status, path };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(JSON.stringify(await callProductionCron(process.env)) + "\n"); }
  catch { console.error("::error::Cron failed: check configuration or server logs; no automatic replay."); process.exitCode = 1; }
}
