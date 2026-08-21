import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const preparationPath = new URL(
  "../src/lib/admin-essential-preparation.ts",
  import.meta.url,
);

test("la préparation Admin borne chaque lecture réseau essentielle", async () => {
  const code = await readFile(preparationPath, "utf8");

  assert.match(code, /ADMIN_ESSENTIAL_REQUEST_TIMEOUT_MS\s*=\s*12_000/);
  assert.match(code, /const controller = new AbortController\(\)/);
  assert.match(code, /window\.setTimeout\([\s\S]*controller\.abort\(\)[\s\S]*ADMIN_ESSENTIAL_REQUEST_TIMEOUT_MS/);
  assert.match(code, /signal:\s*controller\.signal/);
  assert.match(code, /controller\.signal\.aborted/);
  assert.match(code, /admin_essential_request_timeout/);
  assert.match(code, /window\.clearTimeout\(timeout\)/);
});
