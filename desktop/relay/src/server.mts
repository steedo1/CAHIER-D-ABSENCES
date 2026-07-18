import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { adminDashboard } from "./admin-dashboard.mjs";
import { attendanceMonitor } from "./attendance-monitor.mjs";
import type { RelayConfig } from "./config.mjs";
import type { RelayStore } from "./store.mjs";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_BOOTSTRAP_BODY_BYTES = 32 * 1024 * 1024;

export function createRelayServer(config: RelayConfig, store: RelayStore) {
  return createServer(async (request, response) => {
    secureHeaders(response);
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      if (request.method === "GET" && url.pathname === "/health") {
        return json(response, 200, { ok: true });
      }
      if (!authorized(request, config.token)) return json(response, 401, { error: "unauthorized" });

      if (request.method === "GET" && url.pathname === "/v1/status") {
        return json(response, 200, store.status());
      }
      if (request.method === "GET" && url.pathname === "/v1/sync/outbox") {
        const limit = Number(url.searchParams.get("limit") || "100");
        return json(response, 200, { items: store.listPending(limit) });
      }
      if (request.method === "POST" && url.pathname === "/v1/sync/enqueue") {
        return json(response, 200, store.enqueue(await readJson(request)));
      }
      if (request.method === "POST" && url.pathname === "/v1/sync/apply") {
        return json(response, 200, store.applyRemote(await readJson(request)));
      }
      if (request.method === "POST" && url.pathname === "/v1/sync/bootstrap") {
        return json(response, 200, store.bootstrap(await readJson(request, MAX_BOOTSTRAP_BODY_BYTES)));
      }
      if (request.method === "POST" && url.pathname.startsWith("/v1/sync/conflicts/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/sync/conflicts/".length));
        const body = await readJson(request) as Record<string, unknown>;
        const resolution = body.resolution;
        if (resolution !== "accept_remote" && resolution !== "keep_local") {
          throw new HttpError(400, "resolution_invalid");
        }
        const resolvedBy = String(body.resolved_by || "local_admin").trim();
        return json(response, 200, store.resolveConflict(id, resolution, resolvedBy));
      }
      if (request.method === "GET" && url.pathname === "/v1/admin/dashboard") {
        const institutionId = requiredParam(url, "institution_id");
        const date = requiredParam(url, "date");
        return json(response, 200, adminDashboard(store.db, { institutionId, date }));
      }
      if (request.method === "GET" && url.pathname === "/v1/admin/attendance/monitor") {
        const institutionId = requiredParam(url, "institution_id");
        const from = requiredParam(url, "from");
        const to = requiredParam(url, "to");
        return json(response, 200, {
          rows: attendanceMonitor(store.db, { institutionId, from, to }),
        });
      }
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      const message = error instanceof Error ? error.message : "relay_request_failed";
      return json(response, status, { error: message });
    }
  });
}

function requiredParam(url: URL, name: string) {
  const value = String(url.searchParams.get(name) || "").trim();
  if (!value) throw new HttpError(400, `${name}_required`);
  return value;
}

function authorized(request: IncomingMessage, token: string | null) {
  if (!token) return true;
  const authorization = String(request.headers.authorization || "");
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const expectedHash = createHash("sha256").update(token).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

async function readJson(
  request: IncomingMessage,
  maxBodyBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBodyBytes) throw new HttpError(413, "request_body_too_large");
    chunks.push(bytes);
  }
  if (chunks.length === 0) throw new HttpError(400, "request_body_required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function secureHeaders(response: ServerResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
