import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridgePath = new URL("../src/lib/admin-essential-fetch.ts", import.meta.url);
const preparationPath = new URL(
  "../src/lib/admin-essential-preparation.ts",
  import.meta.url,
);
const contractPath = new URL(
  "../src/lib/admin-essential-contract.ts",
  import.meta.url,
);
const readinessPath = new URL(
  "../src/lib/offline-auth-readiness.ts",
  import.meta.url,
);

async function read(path) {
  return await readFile(path, "utf8");
}

test("le pont hors ligne est strictement limité aux lectures Admin essentielles", async () => {
  const code = await read(bridgePath);

  for (const path of [
    "/api/admin/classes",
    "/api/admin/students",
    "/api/admin/institution/settings",
    "/api/admin/institution/academic-years",
    "/api/admin/institution/grading-periods",
    "/api/admin/grades/bulletin",
    "/api/admin/conduite/averages",
    "/api/admin/affectations/current",
  ]) {
    assert.match(code, new RegExp(path.replaceAll("/", "\\/")));
  }

  assert.match(code, /classes\\\/\[\^\/\]\+\\\/students/);
  assert.match(code, /classes\\\/\[\^\/\]\+\\\/roster/);
  assert.match(code, /requestMethod\(input, init\) !== "GET"/);
  assert.doesNotMatch(code, /\/api\/admin\/enrollments\/assign/);
  assert.doesNotMatch(code, /\/api\/admin\/enrollments\/remove/);
});

test("le cache Admin est cloisonné en ligne et hors ligne par utilisateur et établissement", async () => {
  const code = await read(bridgePath);

  assert.match(code, /getOfflineAccessIntent/);
  assert.match(code, /active\?\.payload\.role === "admin"/);
  assert.match(code, /active\.payload\.user_id/);
  assert.match(code, /active\.payload\.institution_id/);
  assert.match(code, /SESSION_SCOPE_KEY/);
  assert.match(code, /setAdminEssentialSessionUser/);
  assert.match(code, /rememberAdminEssentialScope/);
  assert.match(code, /parsed\.user_id[^\n]+currentSessionUserId/);
  assert.match(code, /scope\.user_id[^\n]+scope\.institution_id/);
});

test("une erreur d'authentification n'est jamais masquée par une ancienne copie", async () => {
  const code = await read(bridgePath);

  assert.match(code, /if \(!cacheAllowedStatus\(response\.status\)\) return response/);
  assert.match(code, /status >= 500/);
  assert.doesNotMatch(code, /status === 401.*cached/s);
  assert.doesNotMatch(code, /status === 403.*cached/s);
});

test("les listes essentielles passent Cloud puis relais puis cache sans modifier les pages", async () => {
  const code = await read(bridgePath);

  assert.match(code, /getRelayConfig/);
  assert.match(code, /\/v1\/admin\/dashboard/);
  assert.match(code, /isRelayBackedAdminReadPath/);
  assert.match(code, /relayDashboard/);
  assert.match(code, /relayRosterResponse/);
  assert.match(code, /fallbackResponse/);
  assert.match(code, /dataResponse\(payload, "relay"\)/);
  assert.match(code, /storeResponse\(url, relay\)/);

  for (const path of [
    "/api/admin/classes",
    "/api/admin/students",
    "/api/admin/institution/settings",
    "/api/admin/institution/academic-years",
    "/api/admin/institution/grading-periods",
  ]) {
    assert.match(code, new RegExp(path.replaceAll("/", "\\/")));
  }

  assert.match(code, /\/api\\\/admin\\\/classes\\\/\(\[\^\/\]\+\)\\\/roster/);
  assert.doesNotMatch(code, /isRelayBackedAdminReadPath[\s\S]*grades\/bulletin/);
  assert.doesNotMatch(code, /isRelayBackedAdminReadPath[\s\S]*conduite\/averages/);
});

test("la préparation exige un scope Cloud confirmé puis couvre les écrans sans ouverture préalable", async () => {
  const code = await read(preparationPath);

  assert.match(code, /userId: string/);
  assert.match(code, /institutionId: string/);
  assert.match(code, /admin_cloud_scope_required/);
  assert.match(code, /rememberAdminEssentialScope\(\{ userId, institutionId \}\)/);
  assert.match(code, /prepareOffline\("admin", onProgress\)/);
  assert.match(code, /"\/api\/admin\/classes\?limit=999"/);
  assert.match(code, /"\/api\/admin\/students"/);
  assert.match(code, /"\/api\/admin\/institution\/academic-years"/);
  assert.match(code, /"\/api\/admin\/affectations\/current"/);
  assert.match(code, /\/api\/admin\/classes\/\$\{encodeURIComponent\(classId\)\}\/roster/);
  assert.match(code, /\/api\/admin\/students\?class_id=/);

  for (const path of [
    "/admin/absences/appels-matrice",
    "/admin/parents",
    "/admin/bulletins",
    "/admin/notes/conseil-classe",
  ]) {
    assert.match(code, new RegExp(path.replaceAll("/", "\\/")));
  }

  assert.match(code, /\/admin\/classes\/liste\/\$\{encodeURIComponent\(classId\)\}/);
});

test("le marqueur complet est publié seulement après la préparation officielle des bulletins", async () => {
  const preparation = await read(preparationPath);
  const contract = await read(contractPath);
  const prepareIndex = preparation.indexOf('prepareOffline("admin", onProgress)');
  const markerIndex = preparation.indexOf("const marker: AdminEssentialPreparationMarker");
  const cacheIndex = preparation.indexOf("adminEssentialPreparationKey(userId, institutionId)");

  assert.ok(prepareIndex >= 0, "préparation officielle Admin absente");
  assert.ok(markerIndex > prepareIndex, "marqueur publié avant la fin de la préparation");
  assert.ok(cacheIndex > markerIndex, "clé readiness publiée trop tôt");
  assert.match(contract, /ADMIN_ESSENTIAL_PREPARATION_VERSION = 1/);
  assert.match(contract, /user_id: string/);
  assert.match(contract, /institution_id: string/);
  assert.match(contract, /shell_ready: true/);
});

test("la connexion Admin hors ligne exige appels ET paquet essentiel du même scope", async () => {
  const code = await read(readinessPath);

  assert.match(code, /hasInstitutionScopedAdminAttendanceMonitorCache/);
  assert.match(code, /adminEssentialPreparationKey\(payload\.user_id, payload\.institution_id\)/);
  assert.match(code, /isAdminEssentialPreparationMarker/);
  assert.match(code, /userId: payload\.user_id/);
  assert.match(code, /institutionId: payload\.institution_id/);
});

test("la préparation essentielle ne fabrique aucune mutation hors ligne", async () => {
  const code = await read(preparationPath);

  assert.doesNotMatch(code, /method:\s*"POST"/);
  assert.doesNotMatch(code, /method:\s*"PATCH"/);
  assert.doesNotMatch(code, /method:\s*"DELETE"/);
  assert.doesNotMatch(code, /enrollments\/assign/);
  assert.doesNotMatch(code, /enrollments\/remove/);
});
