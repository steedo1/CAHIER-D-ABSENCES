import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la déconnexion hors ligne du téléphone verrouille le PWA sans rechargement complet", async () => {
  const classPage = await read("src/app/class/page.tsx");

  assert.match(classPage, /const offlineLogout =\s*typeof navigator !== "undefined" && navigator\.onLine === false;/);
  assert.match(classPage, /if \(offlineLogout\) setOfflineLogoutLock\("\/class"\);/);
  assert.match(
    classPage,
    /if \(offlineLogout\) \{\s*setLoggingOut\(false\);\s*return;\s*\}/,
  );

  const offlineBranch = classPage.slice(
    classPage.indexOf('if (offlineLogout) setOfflineLogoutLock("/class")'),
    classPage.indexOf('// En ligne, la déconnexion classique'),
  );
  assert.doesNotMatch(offlineBranch, /window\.location/);
});

test("le verrou de déconnexion est séparé du grant durable de l'appareil", async () => {
  const client = await read("src/lib/offline-auth-client.ts");

  assert.match(client, /OFFLINE_LOGOUT_LOCK_KEY = "mc:offline-auth:logout-lock:v1"/);
  assert.match(client, /sessionStorage\.setItem\(OFFLINE_LOGOUT_LOCK_KEY/);
  assert.match(client, /sessionStorage\.removeItem\(OFFLINE_LOGOUT_LOCK_KEY\)/);
  assert.doesNotMatch(
    client.slice(
      client.indexOf("export function setOfflineLogoutLock"),
      client.indexOf("export async function getActiveOfflineAccess"),
    ),
    /deleteDatabase|objectStore\(STORE_NAME\)\.delete/,
  );
});

test("le guard affiche le même LoginCard dans le runtime PWA pour réauthentifier la classe", async () => {
  const guard = await read("src/components/OfflineAccessGuard.tsx");

  assert.match(guard, /import LoginCard from "@\/components\/auth\/LoginCard";/);
  assert.match(guard, /logoutLock === pathname && pathname === "\/class"/);
  assert.match(guard, /inline_reauth: true/);
  assert.match(guard, /forcedMode="phoneOnly"/);
  assert.match(guard, /onAuthenticated=\{async \(destination\) =>/);
  assert.match(guard, /clearOfflineLogoutLock\(\);/);
  assert.match(guard, /setState\(\{ status: "allowed" \}\);/);
});
