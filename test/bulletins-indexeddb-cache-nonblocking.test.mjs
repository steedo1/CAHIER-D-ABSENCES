import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("IndexedDB: closed connections are no longer reused", () => {
  const src = read("src/lib/offline.ts");
  const section = src.slice(src.indexOf("async function openDB()"), src.indexOf("/* ───────────────────────── KV cache"));
  assert.match(section, /db\.onversionchange\s*=\s*\(\)\s*=>/);
  assert.match(section, /db\.onclose\s*=\s*\(\)\s*=>/);
  assert.match(section, /if \(_dbPromise === opening\) _dbPromise = null/g);
});

test("online admin reads do not fail because optional cache storage closes", () => {
  const src = read("src/lib/offline.ts");
  const section = src.slice(src.indexOf("export async function offlineGetJson"), src.indexOf("/* ───────────────────────── Outbox"));
  assert.match(section, /if \(scoped\)\s*\{\s*await cacheSet\(cacheKey, j\)/);
  assert.match(section, /else\s*\{\s*try\s*\{\s*await cacheSet\(cacheKey, j\);\s*\}\s*catch \(cacheError\)/);
  assert.match(section, /return j as T/);
  // Fail-closed constraints for teacher identity remain in the same path.
  assert.match(section, /attendance_cache_identity_changed/);
  assert.match(section, /attendance_cache_contract_missing/);
});

test("bulletin enrichment and QR preview do not depend on a second cache write", () => {
  const admin = read("src/lib/offline-bulletins.ts");
  const page = read("src/app/admin/bulletins/page.tsx");
  assert.match(admin, /async function rememberBulletinSnapshot/);
  assert.match(admin, /catch \(error\)\s*\{\s*console\.warn/);
  assert.match(admin, /await rememberBulletinSnapshot\(ADMIN_BULLETIN_SETTINGS_KEY, enriched\)/);
  assert.match(admin, /await rememberBulletinSnapshot\(key, enriched\)/);
  assert.match(page, /await prepareBulletinQrPreview\(json, isOnline\)/);
  assert.match(page, /try\s*\{\s*await cacheSet\(adminBulletinDataKey\(params\), json\);\s*\}\s*catch \(cacheError\)/);
});

test("online bulletin errors cannot be concealed by stale NC cache", () => {
  const src = read("src/lib/offline.ts");
  const section = src.slice(src.indexOf("export async function offlineGetJson"),src.indexOf("/* ───────────────────────── Outbox"));
  assert.match(section,/const canUseBulletinCache/);
  assert.match(section,/navigator\.onLine === false/);
  assert.match(section,/if \(!canUseBulletinCache\(\)\)/);
  assert.match(section,/isRetryableStatus\(res\.status\) && canUseBulletinCache\(\)/);
});
