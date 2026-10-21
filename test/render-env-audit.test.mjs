import assert from "node:assert/strict";
import test from "node:test";
import { auditEnvironment, environmentContract } from "../scripts/audit-render-env.mjs";

test("preflight reports absent feature credentials without leaking any value", () => {
  const report = auditEnvironment({ SUPABASE_SERVICE_ROLE_KEY: "fixture-private-key", UNRELATED_SECRET: "another-fixture" });
  const output = JSON.stringify(report);
  assert.equal(report.rows.length, 27);
  assert.equal(output.includes("fixture-private-key"), false);
  assert.equal(output.includes("another-fixture"), false);
  assert.equal(output.includes("UNRELATED_SECRET"), false);
  assert.ok(report.issues.some(x => x.key === "CRON_SECRET" && x.code === "MISSING"));
  assert.equal(report.ok, false);
});

test("preflight checks actual production origins and matching public push keys", () => {
  const env = Object.fromEntries(environmentContract.map(([key]) => [key, "fixture-value"]));
  for (const key of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_BASE_URL", "NEXT_PUBLIC_SITE_URL"]) env[key] = "https://www.mon-cahier.com";
  assert.equal(auditEnvironment(env).ok, true);
  env.NEXT_PUBLIC_APP_URL = "https://old-project.vercel.app";
  env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "different-public-key";
  const report = auditEnvironment(env);
  assert.deepEqual(report.issues.map(x => x.code), ["INVALID_PRODUCTION_ORIGIN", "PUBLIC_KEY_MISMATCH"]);
});
