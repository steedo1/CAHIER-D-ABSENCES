import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridgePath = new URL("../src/lib/admin-essential-fetch.ts", import.meta.url);
const preparationPath = new URL(
  "../src/lib/admin-essential-preparation.ts",
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

test("le cache Admin est cloisonné par le grant utilisateur et établissement", async () => {
  const code = await read(bridgePath);

  assert.match(code, /getOfflineAccessIntent/);
  assert.match(code, /active\.payload\.role !== "admin"/);
  assert.match(code, /active\.payload\.user_id/);
  assert.match(code, /active\.payload\.institution_id/);
  assert.match(code, /CACHE_PREFIX.*scope/s);
});

test("une erreur d'authentification n'est jamais masquée par une ancienne copie", async () => {
  const code = await read(bridgePath);

  assert.match(code, /if \(!cacheAllowedStatus\(response\.status\)\) return response/);
  assert.match(code, /status >= 500/);
  assert.doesNotMatch(code, /status === 401.*cached/s);
  assert.doesNotMatch(code, /status === 403.*cached/s);
});

test("la préparation couvre Listes, Bulletins et Conseil sans ouverture préalable", async () => {
  const code = await read(preparationPath);

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

test("la préparation essentielle ne fabrique aucune mutation hors ligne", async () => {
  const code = await read(preparationPath);

  assert.doesNotMatch(code, /method:\s*"POST"/);
  assert.doesNotMatch(code, /method:\s*"PATCH"/);
  assert.doesNotMatch(code, /method:\s*"DELETE"/);
  assert.doesNotMatch(code, /enrollments\/assign/);
  assert.doesNotMatch(code, /enrollments\/remove/);
});
