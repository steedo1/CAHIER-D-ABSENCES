import assert from "node:assert/strict";
import test from "node:test";
import { callProductionCron } from "../scripts/call-production-cron.mjs";

const config = { CRON_URL: "https://mon-cahier.com/api/sms/dispatch", CRON_EXPECTED_PATH: "/api/sms/dispatch", CRON_SECRET: "fixture-secret" };

test("canonical Render domain receives one secret-authenticated call", async () => {
  const calls = [];
  const result = await callProductionCron(config, async (...args) => { calls.push(args); return Response.json({ ok: true }); });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://www.mon-cahier.com/api/sms/dispatch");
  assert.equal(calls[0][1].redirect, "error");
  assert.equal(calls[0][1].headers["x-cron-secret"], config.CRON_SECRET);
  assert.equal(JSON.stringify(result).includes(config.CRON_SECRET), false);
});

test("configuration validation sends no request", async () => {
  await callProductionCron({ ...config, CRON_VALIDATE_ONLY: "1" }, () => assert.fail("must not call the network"));
});

test("wrong hosts, paths and credential-bearing URLs fail before transmission", async () => {
  for (const url of ["https://old.vercel.app/api/sms/dispatch", "http://www.mon-cahier.com/api/sms/dispatch", "https://www.mon-cahier.com/api/push/dispatch", "https://www.mon-cahier.com/api/sms/dispatch?secret=test", "https://user:password@www.mon-cahier.com/api/sms/dispatch"]) {
    await assert.rejects(callProductionCron({ ...config, CRON_URL: url }, () => assert.fail("must not call the network")), /CRON_DESTINATION_INVALID/);
  }
  await assert.rejects(callProductionCron({ ...config, CRON_SECRET: "" }, () => assert.fail("must not call the network")), /CRON_SECRET_MISSING/);
});

test("HTTP failures, application errors and ambiguous timeouts never replay the POST", async () => {
  for (const response of [Response.json({ ok: false, error: "private school detail" }), Response.json({ ok: false }, { status: 403 }), new Response("<html>error</html>", { status: 502 })]) {
    let calls = 0;
    await assert.rejects(callProductionCron(config, async () => { calls++; return response; }), /CRON_FAILED_HTTP_/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(callProductionCron(config, async () => { calls++; throw new Error("timeout"); }), /timeout/);
  assert.equal(calls, 1);
});
