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
  assert.match(
    code,
    /if \(sessionRef\.current\) \{\s*await prepareAdminEssentialOffline\(\);\s*\}/s,
  );
});

test("la vue des appels conserve sa préparation relais spécifique", async () => {
  const code = await source();

  assert.match(code, /usePathname/);
  assert.match(code, /"\/admin\/absences\/appels"/);
  assert.match(code, /"\/admin\/absences\/appels-matrice"/);
  assert.match(
    code,
    /if \(isAdminAttendancePath\(pathnameRef\.current\)\) \{\s*await prepareAdminAttendanceView\(\);\s*\}/s,
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

test("un échec du shell d'appels ne transforme pas une lecture admin réussie en échec", async () => {
  const code = await source();
  const start = code.indexOf("async function prepareAdminAttendanceView()");
  const end = code.indexOf("function numberFromStorage", start);
  assert.ok(start >= 0 && end > start, "préparation admin des appels introuvable");
  const preparation = code.slice(start, end);

  assert.match(preparation, /await fetchAdminAttendanceMonitor\(/);
  assert.match(
    preparation,
    /warmOfflineShell\(\["\/admin\/absences\/appels-matrice"\]\)\.catch\(\(\) => undefined\)/,
  );
  assert.doesNotMatch(preparation, /Promise\.all\(/);
});
