import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function builtRelease(env) {
  const clean = { ...process.env };
  for (const key of ["NEXT_PUBLIC_MON_CAHIER_RELEASE", "RENDER_GIT_COMMIT", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA"]) delete clean[key];
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    'import config from "./next.config.mjs"; console.log(JSON.stringify(config.env));'],
    { cwd: process.cwd(), env: { ...clean, ...env }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("Render commit reaches the public release without exporting secrets", () => {
  assert.deepEqual(builtRelease({ RENDER_GIT_COMMIT: "render-commit", SUPABASE_SERVICE_ROLE_KEY: "fixture-secret" }),
    { NEXT_PUBLIC_MON_CAHIER_RELEASE: "render-commit" });
  assert.equal(builtRelease({ NEXT_PUBLIC_MON_CAHIER_RELEASE: "manual", RENDER_GIT_COMMIT: "render-commit" }).NEXT_PUBLIC_MON_CAHIER_RELEASE, "manual");
  assert.equal(builtRelease({}).NEXT_PUBLIC_MON_CAHIER_RELEASE, "development");
});

test("health response has no database or authentication dependency", async () => {
  const { GET } = await import("../src/app/api/health/route.ts");
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true });
});
