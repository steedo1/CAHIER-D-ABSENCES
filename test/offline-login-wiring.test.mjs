import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const loginCard = source("../src/components/auth/LoginCard.tsx");
const offlineAuth = source("../src/lib/offline-auth.ts");
const readiness = source("../src/lib/offline-readiness.ts");
const serviceWorker = source("../public/moncahier-sw.js");
const release = source("../src/lib/offline-release.ts");
const offline = source("../src/lib/offline.ts");
const roleRoute = source("../src/app/api/auth/role/route.ts");
const guard = source("../src/components/Guard.tsx");
const layout = source("../src/app/layout.tsx");

test("la page de connexion fait partie du shell enseignant et compte-classe", () => {
  assert.match(serviceWorker, /OFFLINE_PAGE_PATHS[\s\S]*"\/login"/);
  assert.ok((readiness.match(/"\/login"/g) || []).length >= 2);
  assert.match(release, /2026-08-08-offline-final-v1/);
  assert.match(serviceWorker, /2026-08-08-offline-final-v1/);
});

test("le login bascule vers la vérification locale uniquement après une panne réseau", () => {
  assert.match(loginCard, /isNetworkFailure/);
  assert.match(loginCard, /authenticateOfflineLogin/);
  assert.match(loginCard, /Cloud indisponible\. Vérification sécurisée/);
  assert.match(loginCard, /enrollOfflineLogin/);
  assert.match(loginCard, /signal: controller\.signal/);
});

test("le secret local utilise PBKDF2, expire et se verrouille après plusieurs erreurs", () => {
  assert.match(offlineAuth, /PBKDF2-SHA-256/);
  assert.match(offlineAuth, /30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(offlineAuth, /MAX_FAILED_ATTEMPTS = 5/);
  assert.match(offlineAuth, /LOCK_DURATION_MS = 15 \* 60 \* 1000/);
  assert.doesNotMatch(
    offlineAuth,
    /credential:\s*\{[\s\S]{0,800}\bpassword\s*:/,
  );
});

test("la déconnexion purge la session hors ligne et les comptes-classe sont reconnus", () => {
  assert.match(offline, /moncahier:offline-session:v1/);
  assert.match(roleRoute, /class_phone_e164/);
  assert.match(roleRoute, /role: classDeviceInstitutionId \? "class_device"/);
});

test("le verrou global protège réellement les pages préparées hors ligne", () => {
  assert.match(layout, /<Providers><Guard>\{children\}<\/Guard><\/Providers>/);
  assert.match(guard, /readOfflineLoginSession/);
  assert.match(guard, /roleAllowsPath/);
  assert.match(guard, /window\.location\.replace\("\/login"\)/);
  assert.match(guard, /probeCloudSchedule/);
});


test("la préparation hors ligne expose seulement l'identifiant du propriétaire pour distinguer reconnexion et changement de compte", () => {
  assert.match(offlineAuth, /export async function getOfflineLoginOwnerUserId/);
  assert.match(offlineAuth, /credential\?\.user_id \|\| null/);
  assert.match(loginCard, /preparedUserId === authenticatedUserId/);
});
