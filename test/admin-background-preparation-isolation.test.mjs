import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL(
  "../src/components/BackgroundAttendancePreparation.tsx",
  import.meta.url,
);

async function source() {
  return await readFile(sourcePath, "utf8");
}

test("la préparation Admin couvre les fonctions essentielles sans dépendre de la page ouverte", async () => {
  const code = await source();

  assert.match(code, /prepareAdminEssentialOffline/);
  assert.doesNotMatch(
    code,
    /role === "admin"\s*&&\s*!isAdminAttendancePath\(pathnameRef\.current\)\) return/,
  );
  assert.match(code, /if \(role === "admin"\) \{/);
  assert.match(code, /cloudRoleVerified/);
  assert.match(code, /institutionId = String\(payload\.institution_id \|\| ""\)\.trim\(\)/);
  assert.match(
    code,
    /await prepareAdminEssentialOffline\(\{ userId, institutionId \}\)/,
  );
});

test("le scope cache est remplacé avant les effets de lecture des pages", async () => {
  const code = await source();

  assert.match(code, /useLayoutEffect/);
  assert.match(code, /setAdminEssentialSessionUser/);
  assert.match(
    code,
    /setAdminEssentialSessionUser\(session\?\.user\?\.id \|\| null\)/,
  );
});

test("la page des appels reste seule propriétaire de son actualisation", async () => {
  const code = await source();

  assert.doesNotMatch(code, /prepareAdminAttendanceView/);
  assert.doesNotMatch(code, /fetchAdminAttendanceMonitor/);
  assert.doesNotMatch(code, /warmOfflineShell/);
});

test("une session Cloud résiduelle hors réseau ne marque pas une fausse préparation réussie", async () => {
  const code = await source();

  assert.match(code, /let prepared = false/);
  assert.match(code, /if \(prepared\) writeStorage\(successKey, Date\.now\(\)\)/);
  assert.doesNotMatch(
    code,
    /await withCrossTabLock\([\s\S]*?\n\s*writeStorage\(successKey, Date\.now\(\)\);\n\s*\}\);/,
  );
});

test("la préparation globale reste silencieuse et ne pollue pas les écrans Admin", async () => {
  const code = await source();

  assert.doesNotMatch(code, /Actualisation impossible, ancienne préparation conservée/);
  assert.doesNotMatch(code, /fixed bottom-3 left-3/);
  assert.doesNotMatch(code, /setStatus\(/);
  assert.doesNotMatch(code, /setMessage\(/);
  assert.match(code, /return null;/);
});

test("les événements multi-onglets ne répètent pas le contrôle Cloud", async () => {
  const code = await source();

  assert.match(code, /const BACKGROUND_CHECK_TTL_MS = 55_000/);
  assert.match(code, /mc:attendance-background-check:/);
  assert.match(code, /now - numberFromStorage\(checkKey\) < BACKGROUND_CHECK_TTL_MS/);
  assert.match(code, /writeStorage\(checkKey, now\)/);
});
