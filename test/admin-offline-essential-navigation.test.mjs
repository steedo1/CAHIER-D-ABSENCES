import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const auth = await import("../src/lib/offline-auth-contract.ts");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const secret = "offline-admin-nav-test-secret-".padEnd(64, "s");
const now = 1_800_000_000_000;
const deviceId = "device_11111111-2222-4333-8444-555555555555";

test("un grant Admin hors ligne reste limité au périmètre pédagogique essentiel", async () => {
  const grant = await auth.issueOfflineAccessGrant({
    secret,
    userId: "11111111-2222-4333-8444-555555555555",
    institutionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    deviceId,
    role: "admin",
    nowMs: now,
    ttlMs: 60_000,
  });

  const allowed = [
    "/admin/absences/appels",
    "/admin/absences/appels-matrice",
    "/admin/parents",
    "/admin/bulletins",
    "/admin/notes/conseil-classe",
    "/admin/classes/liste/cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  ];
  for (const pathname of allowed) {
    const verified = await auth.verifyOfflineAccessGrant({
      token: grant.token,
      secret,
      pathname,
      deviceId,
      nowMs: now + 1,
    });
    assert.equal(verified?.role, "admin", pathname);
  }

  for (const pathname of [
    "/admin/dashboard",
    "/admin/finance",
    "/admin/parametres",
    "/admin/classes/liste",
    "/admin/classes/liste/a/b",
    "/attendance",
  ]) {
    assert.equal(
      await auth.verifyOfflineAccessGrant({
        token: grant.token,
        secret,
        pathname,
        deviceId,
        nowMs: now + 1,
      }),
      null,
      pathname,
    );
  }

  assert.equal(auth.offlineCookiePathForRole("admin"), "/admin");
  assert.equal(auth.offlineCookiePathForRole("teacher"), "/attendance");
  assert.equal(auth.offlineCookiePathForRole("class_device"), "/class");
});

test("une session Cloud normale garde la priorité sur une intention hors ligne", async () => {
  const guard = await read("src/components/OfflineAccessGuard.tsx");
  const cloudPriority = guard.indexOf("if (session) {");
  const offlineIntent = guard.indexOf("const intent = await getOfflineAccessIntent()", cloudPriority);

  assert.ok(cloudPriority >= 0, "priorité Cloud absente");
  assert.ok(offlineIntent > cloudPriority, "le grant hors ligne ne doit pas précéder la session Cloud");
  assert.match(guard, /isOfflinePathAllowedForRole\(intent\.payload\.role, pathname\)/);
});

test("le shell Admin hors ligne expose seulement les quatre entrées essentielles", async () => {
  const shell = await read("src/app/admin/ui/shell.tsx");

  assert.match(shell, /const OFFLINE_ADMIN_NAV_ITEMS = \[/);
  assert.match(shell, /"\/admin\/absences\/appels-matrice"/);
  assert.match(shell, /"\/admin\/parents"/);
  assert.match(shell, /"\/admin\/bulletins"/);
  assert.match(shell, /"\/admin\/notes\/conseil-classe"/);
  assert.match(shell, /essentialAdminMode \? \(/);
  assert.match(shell, /<OfflineAdminEssentialNav pathname=\{pathname\} \/>/);
  assert.match(shell, /: \(\s*<SidebarNav role=\{role\} \/>/);
});

test("la préparation du shell Admin est Cloud/PWA et ne dépend pas du relais", async () => {
  const shell = await read("src/app/admin/ui/shell.tsx");

  assert.match(shell, /warmOfflineShell\(\[\.\.\.OFFLINE_ADMIN_STATIC_PATHS\]\)/);
  assert.doesNotMatch(shell, /from "@\/lib\/local-relay"/);
  assert.match(shell, /\.catch\(\(\) => undefined\)/);
});

test("le service worker sait servir les écrans Admin essentiels et les listes dynamiques", async () => {
  const worker = await read("public/moncahier-sw.js");

  assert.match(worker, /"\/admin\/bulletins"/);
  assert.match(worker, /"\/admin\/notes\/conseil-classe"/);
  assert.match(worker, /"\/admin\/parents"/);
  assert.match(worker, /\^\\\/admin\\\/classes\\\/liste\\\/\[\^\/\]\+\$/);
});


test("le shell Admin ne confond jamais indisponibilité Cloud et mode Relais", async () => {
  const shell = await read("src/app/admin/ui/shell.tsx");

  assert.match(shell, /useRelayCapability\(\)/);
  assert.match(shell, /!session && adminGrantReady && relayEnabled/);
  assert.match(shell, /const essentialAdminMode = offlineAdminMode/);
  assert.doesNotMatch(shell, /probeCloudSchedule/);
  assert.doesNotMatch(shell, /cloudReachable/);
  assert.doesNotMatch(shell, /cloudFallbackAdminMode/);
});

test("la navigation essentielle force une vraie navigation document hors ligne", async () => {
  const shell = await read("src/app/admin/ui/shell.tsx");

  const essentialNavStart = shell.indexOf("function OfflineAdminEssentialNav");
  const loadingOverlayStart = shell.indexOf("function LoadingOverlay", essentialNavStart);
  const essentialNav = shell.slice(essentialNavStart, loadingOverlayStart);

  assert.match(essentialNav, /<a\s+[\s\S]*?href=\{href\}/);
  assert.doesNotMatch(essentialNav, /<Link/);
  assert.match(shell, /return essentialAdminMode \? \(\s*<a key=\{href\} href=\{href\}/);
});
