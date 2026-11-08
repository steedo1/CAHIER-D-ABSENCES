import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware.ts";
import {
  issueOfflineAccessGrant, OFFLINE_ACCESS_COOKIE, OFFLINE_DEVICE_COOKIE,
} from "../src/lib/offline-auth-contract.ts";

const userId = "22222222-2222-4222-8222-222222222222";
const institutionId = "11111111-1111-4111-8111-111111111111";
const request = (path, cookie = "") => new NextRequest(`https://www.mon-cahier.com${path}`, {
  headers: cookie ? { cookie } : {},
});

test("middleware keeps public pages and API authorization boundaries without a staff session", async () => {
  for (const path of ["/", "/login", "/recover", "/parent-login", "/api/health", "/api/class/roster"]) {
    const response = await middleware(request(path));
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
    assert.equal(response.headers.has("location"), false, path);
  }
  for (const path of ["/class", "/attendance", "/admin", "/super", "/founder"]) {
    const response = await middleware(request(path));
    assert.equal(response.status, 307, path);
    assert.equal(new URL(response.headers.get("location")).pathname, "/login");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("offline signed grant stays restricted to its role, device and expiration", async () => {
  const original = process.env.MON_CAHIER_OFFLINE_AUTH_SECRET;
  const secret = "isolated-offline-runtime-test-secret".padEnd(64, "s");
  process.env.MON_CAHIER_OFFLINE_AUTH_SECRET = secret;
  const deviceId = "device_11111111-2222-4333-8444-555555555555";
  try {
    const grant = await issueOfflineAccessGrant({ secret, userId, institutionId, deviceId,
      role: "teacher", ttlMs: 60_000 });
    const cookie = `${OFFLINE_ACCESS_COOKIE}=${grant.token}; ${OFFLINE_DEVICE_COOKIE}=${deviceId}`;
    const accepted = await middleware(request("/attendance", cookie));
    assert.equal(accepted.headers.get("x-mon-cahier-offline-access"), "1");
    assert.equal(accepted.headers.has("location"), false);
    assert.equal((await middleware(request("/admin", cookie))).status, 307);
    assert.equal((await middleware(request("/class", cookie))).status, 307);
    assert.equal((await middleware(request("/attendance", cookie.replace(deviceId, "different-device")))).status, 307);
    const expired = await issueOfflineAccessGrant({ secret, userId, institutionId, deviceId,
      role: "teacher", nowMs: Date.now() - 120_000, ttlMs: 60_000 });
    assert.equal((await middleware(request("/attendance",
      `${OFFLINE_ACCESS_COOKIE}=${expired.token}; ${OFFLINE_DEVICE_COOKIE}=${deviceId}`))).status, 307);
  } finally {
    if (original === undefined) delete process.env.MON_CAHIER_OFFLINE_AUTH_SECRET;
    else process.env.MON_CAHIER_OFFLINE_AUTH_SECRET = original;
  }
});

test("expired SDK cookie refreshes once and propagates cookies without making responses cacheable", async () => {
  const original = { ...process.env };
  const calls = [];
  const jwt = (exp) => `header.${Buffer.from(JSON.stringify({ exp, sub: userId })).toString("base64url")}.signature`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    if (req.url !== "/auth/v1/token?grant_type=refresh_token" || req.method !== "POST") {
      res.writeHead(404).end(); return;
    }
    req.resume();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ access_token: jwt(expires), refresh_token: "renewed-test-refresh",
      expires_in: 3600, token_type: "bearer", user: { id: userId, aud: "authenticated",
        app_metadata: {}, user_metadata: {} } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.SUPABASE_ANON_KEY = "isolated-test-anon";
    const expired = Math.floor(Date.now() / 1000) - 60;
    const session = { access_token: jwt(expired), refresh_token: "expired-test-refresh",
      expires_at: expired, expires_in: 0, token_type: "bearer" };
    const response = await middleware(request("/class", `mca-auth-v1=${encodeURIComponent(JSON.stringify(session))}`));
    assert.deepEqual(calls, ["POST /auth/v1/token?grant_type=refresh_token"]);
    assert.equal(response.headers.has("location"), false);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.ok(response.cookies.getAll().some(cookie => cookie.name === "mca-auth-v1"));
    assert.match(response.headers.get("x-middleware-request-cookie"), /mca-auth-v1=/);
  } finally {
    process.env = original;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
