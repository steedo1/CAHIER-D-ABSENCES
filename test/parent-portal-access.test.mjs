import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isParentConnectRoute } from "../src/lib/parent-connect/navigation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la connexion, le tableau de bord et les paiements parents évitent le garde hors ligne des personnels", () => {
  for (const path of ["/parents/login", "/parents", "/parents/payments"]) {
    assert.equal(isParentConnectRoute(path), true, path);
  }
  for (const path of ["/parent", "/admin/parents", "/login", "/attendance", "/class", "/parents-autre"]) {
    assert.equal(isParentConnectRoute(path), false, path);
  }
});

test("le garde laisse accéder aux routes parents avant le chargement de session scolaire", async () => {
  const source = await read("src/components/OfflineAccessGuard.tsx");
  assert.match(source, /PUBLIC_PATHS\.has\(pathname\) \|\| isParentConnectRoute\(pathname\)/);
  assert.match(source, /if \(pathname && isParentConnectRoute\(pathname\)\) return children;/);
  assert.ok(source.indexOf("if (pathname && isParentConnectRoute(pathname)) return children;") < source.indexOf('if (loading || state.status === "checking")'));
  assert.match(source, /isOfflinePathAllowedForRole\(intent\.payload\.role, pathname\)/);
});

test("les données parents restent filtrées par le cookie appareil et les rattachements serveur", async () => {
  const [children, attach] = await Promise.all([
    read("src/app/api/parent/children/route.ts"),
    read("src/app/api/parent/children/attach/route.ts"),
  ]);
  assert.match(children, /jar\.get\("parent_device"\)/);
  assert.match(children, /\.from\("parent_device_children"\)/);
  assert.match(attach, /parentConnectDenial\(srv, student\.id\)/);
});
