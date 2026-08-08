import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const offline = source("../src/lib/offline.ts");
const relay = source("../src/lib/local-relay.ts");
const logoutButton = source("../src/components/LogoutButton.tsx");
const trueLogout = source("../src/components/auth/TrueLogoutButton.tsx");
const logoutPage = source("../src/app/logout/page.tsx");
const loginCard = source("../src/components/auth/LoginCard.tsx");

test("la purge générale retire aussi snapshots, jeton relais et routage local", () => {
  assert.match(offline, /clearOfflineLocalStorage\(\)/);
  assert.match(offline, /moncahier\.classDevice\.snapshot\./);
  assert.match(offline, /moncahier:relay:token/);
  assert.match(offline, /mc_last_dest_attendance/);
  assert.match(offline, /tx\.objectStore\(storeName\)\.clear\(\)/);
  assert.match(relay, /removeItem\(RELAY_TOKEN_KEY\)/);
  assert.match(relay, /removeItem\(ADMIN_SCHEDULE_SYNC_KEY\)/);
});

test("la déconnexion normale verrouille la session sans détruire la préparation hors ligne", () => {
  for (const content of [logoutButton, trueLogout, logoutPage]) {
    assert.match(content, /clearOfflineLoginSession/);
    assert.doesNotMatch(content, /clearOfflineAll/);
    assert.doesNotMatch(content, /clearRelayUserState/);
  }
});

test("une reconnexion du même utilisateur conserve son bundle mais un autre compte déclenche la purge", () => {
  const accepted = loginCard.indexOf("if (!res.ok || !json.ok)");
  const ownerRead = loginCard.indexOf("getOfflineLoginOwnerUserId()");
  const sameUser = loginCard.indexOf("preparedUserId === authenticatedUserId");
  const preserve = loginCard.indexOf("clearOfflineLoginSession()", sameUser);
  const purge = loginCard.indexOf("Promise.allSettled([clearOfflineAll(), clearRelayUserState()])");
  const sync = loginCard.indexOf("await syncBrowserSession(");

  assert.ok(accepted >= 0);
  assert.ok(ownerRead > accepted);
  assert.ok(sameUser > ownerRead);
  assert.ok(preserve > sameUser);
  assert.ok(purge > preserve);
  assert.ok(sync > purge);
});
