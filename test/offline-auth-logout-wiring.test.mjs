import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("toutes les déconnexions ferment la session offline active", async () => {
  const files = await Promise.all([
    read("src/components/auth/TrueLogoutButton.tsx"),
    read("src/components/LogoutButton.tsx"),
    read("src/app/logout/page.tsx"),
    read("src/components/teacher/TeacherDashboard.tsx"),
    read("src/app/class/page.tsx"),
  ]);
  for (const source of files) {
    assert.match(source, /clearActiveOfflineAccess/);
  }
});

test("la déconnexion professeur et téléphone conserve les données préparées", async () => {
  const [teacher, classPage] = await Promise.all([
    read("src/components/teacher/TeacherDashboard.tsx"),
    read("src/app/class/page.tsx"),
  ]);
  assert.doesNotMatch(teacher, /clearOfflineAll/);
  assert.doesNotMatch(classPage, /clearOfflineAll/);
  assert.doesNotMatch(classPage, /clearClassDeviceSnapshot/);
  assert.match(teacher, /conservant ces données sur cet appareil/);
  assert.match(classPage, /conservant ces données sur cet appareil/);

  const logoutPage = await read("src/app/logout/page.tsx");
  assert.doesNotMatch(logoutPage, /clearRelayUserState/);
  assert.match(logoutPage, /cartes admin préparées restent sur l'appareil autorisé/);
});

test("clearActiveOfflineAccess purge les cookies de tous les rôles sans supprimer IndexedDB", async () => {
  const source = await read("src/lib/offline-auth-client.ts");
  assert.match(source, /Object\.values\(OFFLINE_ROLE_DESTINATIONS\)/);
  assert.match(source, /sessionStorage\.removeItem\(ACTIVE_SESSION_KEY\)/);
  assert.doesNotMatch(source, /deleteDatabase/);
  assert.doesNotMatch(source, /objectStore\(STORE_NAME\)\.delete/);
});
