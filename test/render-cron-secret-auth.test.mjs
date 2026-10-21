import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const routes = [
  ...[
    "cron/attendance/monitor", "cron/finance/monthly-reminders", "push/dispatch",
    "admin/attendance/alerts", "sms/dispatch",
  ].map(route => ({ path: `src/app/api/${route}/route.ts`, name: "okAuth", key: "CRON_SECRET", bearer: true })),
  { path: "src/app/api/founder/daily-summary/route.ts", name: "okCronAuth", key: "CRON_SECRET", bearer: true },
  { path: "src/app/api/whatsapp/route.ts", name: "okFromCron", key: "CRON_WHATSAPP_SECRET", bearer: false },
  { path: "src/app/api/whatsapp/dispatch/penalties/daily/route.ts", name: "reqOk", key: "CRON_WHATSAPP_SECRET", bearer: false },
];

function extractGuard({ path, name, key }, secret, fallback = false) {
  const source = readFileSync(path, "utf8");
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing auth guard: ${path}`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `Missing auth guard end: ${path}`);
  const expression = source.slice(start, end + 2)
    .replace("req: NextRequest", "req")
    .replace("req: Request", "req");
  return runInNewContext(`(${expression})`, {
    process: { env: secret ? { [fallback ? "CRON_PUSH_SECRET" : key]: secret } : {} },
    console: { info() {} },
  });
}

function request(headers = {}) {
  const entries = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (k) => entries.get(k.toLowerCase()) ?? null, has: (k) => entries.has(k.toLowerCase()) } };
}

for (const route of routes) {
  const { path, key, bearer } = route;
  test(`${path}: forged Vercel header must not bypass authentication`, () => {
    const secret = "integration-test-cron-secret";
    const guard = extractGuard(route, secret);
    assert.equal(guard(request()), false);
    assert.equal(guard(request({ "x-vercel-cron": "1" })), false);
    assert.equal(guard(request({ "x-vercel-cron": "1", "x-cron-secret": "wrong" })), false);
    assert.equal(guard(request({ "x-cron-secret": secret })), true);
    assert.equal(guard(request({ authorization: `Bearer ${secret}` })), bearer);
    assert.equal(guard(request({ authorization: "Bearer wrong" })), false);
    assert.equal(guard(request({ "x-vercel-cron": "1", "x-cron-secret": secret })), true);
    const noSecret = extractGuard(route, "");
    assert.equal(noSecret(request({ "x-vercel-cron": "1" })), false);
    assert.equal(noSecret(request({ "x-cron-secret": secret })), false);
    assert.equal(noSecret(request({ authorization: `Bearer ${secret}` })), false);
    if (key === "CRON_SECRET") {
      const fallback = extractGuard(route, secret, true);
      assert.equal(fallback(request({ "x-cron-secret": secret })), true);
      assert.equal(fallback(request({ "x-vercel-cron": "1" })), false);
    }
  });
}
