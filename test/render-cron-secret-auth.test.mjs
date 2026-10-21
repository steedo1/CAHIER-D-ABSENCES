import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const routes = [
  "src/app/api/cron/attendance/monitor/route.ts",
  "src/app/api/cron/finance/monthly-reminders/route.ts",
  "src/app/api/push/dispatch/route.ts",
];

function extractGuard(path, secret) {
  const source = readFileSync(path, "utf8");
  const start = source.indexOf("function okAuth(");
  assert.ok(start >= 0, `Missing auth guard: ${path}`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `Missing auth guard end: ${path}`);
  const expression = source.slice(start, end + 2)
    .replace("req: NextRequest", "req")
    .replace("req: Request", "req");
  return runInNewContext(`(${expression})`, {
    process: { env: secret ? { CRON_SECRET: secret } : {} },
    console: { info() {} },
  });
}

function request(headers = {}) {
  const entries = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (k) => entries.get(k.toLowerCase()) ?? null, has: (k) => entries.has(k.toLowerCase()) } };
}

for (const path of routes) {
  test(`${path}: forged Vercel header must not bypass authentication`, () => {
    const secret = "integration-test-cron-secret";
    const guard = extractGuard(path, secret);
    assert.equal(guard(request()), false);
    assert.equal(guard(request({ "x-vercel-cron": "1" })), false);
    assert.equal(guard(request({ "x-vercel-cron": "1", "x-cron-secret": "wrong" })), false);
    assert.equal(guard(request({ "x-cron-secret": secret })), true);
    assert.equal(guard(request({ authorization: `Bearer ${secret}` })), true);
    assert.equal(guard(request({ "x-vercel-cron": "1", "x-cron-secret": secret })), true);
    const noSecret = extractGuard(path, "");
    assert.equal(noSecret(request({ "x-vercel-cron": "1" })), false);
    assert.equal(noSecret(request({ "x-cron-secret": secret })), false);
  });
}
