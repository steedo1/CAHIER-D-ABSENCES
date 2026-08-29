import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la capacité Relais vient de l'appareil provisionné, jamais du réseau", async () => {
  const [serverCapability, browserCapability, roleRoute] = await Promise.all([
    read("src/lib/relay-capability-server.ts"),
    read("src/lib/relay-capability.ts"),
    read("src/app/api/auth/role/route.ts"),
  ]);

  assert.match(serverCapability, /from\("relay_sync_devices"\)/);
  assert.match(serverCapability, /row\.is_active === true/);
  assert.match(serverCapability, /row\.last_seen_at/);
  assert.match(serverCapability, /return false/);
  assert.doesNotMatch(serverCapability, /navigator\.onLine|probeCloud|fetch\(/);
  assert.match(browserCapability, /relay_enabled === true/);
  assert.doesNotMatch(browserCapability, /navigator\.onLine|127\.0\.0\.1|4317|fetch\(/);
  assert.match(roleRoute, /relay_enabled: relayEnabled/);
  assert.match(roleRoute, /relayEnabledForInstitutionServer/);
});

test("un échec Cloud ne déclenche ni shell ni navigation Relais", async () => {
  const [shell, guard] = await Promise.all([
    read("src/app/admin/ui/shell.tsx"),
    read("src/components/OfflineAccessGuard.tsx"),
  ]);

  assert.match(shell, /!session && adminGrantReady && relayEnabled/);
  assert.doesNotMatch(shell, /cloudReachable|cloudFallbackAdminMode|probeCloudSchedule/);
  assert.match(
    guard,
    /intent\.payload\.role === "admin" &&[\s\S]*?pathname\.startsWith\("\/admin"\) &&[\s\S]*?!relayEnabled/,
  );
  assert.doesNotMatch(guard, /window\.location|router\.(?:push|replace)/);
});

test("sans capacité, snapshot, sondes locales et fallback Relais sont court-circuités", async () => {
  const [relay, essential, readiness, badge, bridge] = await Promise.all([
    read("src/lib/local-relay.ts"),
    read("src/lib/admin-essential-fetch.ts"),
    read("src/lib/offline-readiness.ts"),
    read("src/components/admin/RelaySupervisionBadge.tsx"),
    read("src/components/admin/OfflineScheduleSyncBridge.tsx"),
  ]);

  const bootstrapStart = relay.indexOf("export async function syncRelayBootstrap");
  const capabilityGuard = relay.indexOf("relayEnabledForInstitution(institutionId)", bootstrapStart);
  const snapshotRead = relay.indexOf("loadCompleteRelaySnapshot()", bootstrapStart);
  assert.ok(capabilityGuard > bootstrapStart && capabilityGuard < snapshotRead);
  assert.match(relay.slice(bootstrapStart, snapshotRead), /skipped: "relay_disabled"/);
  assert.match(relay, /function assertRelayCapability/);
  assert.match(relay, /assertRelayCapability\(input\.institutionId\)/);
  assert.match(relay, /assertRelayCapability\(relayInstitutionFromAccessToken\(input\.accessToken\)\)/);

  const essentialGuard = essential.indexOf("relayEnabledForInstitution(scope.institution_id)");
  const essentialRelayRead = essential.indexOf("relayDashboard", essentialGuard);
  assert.ok(essentialGuard >= 0 && essentialRelayRead > essentialGuard);
  assert.match(readiness, /if \(!relayEnabled\) \{/);
  assert.match(readiness, /données PWA préparées restent utilisables/);
  assert.match(badge, /if \(!relayEnabled \|\| !getRelayConfig\(\)\.token\)/);
  assert.match(bridge, /if \(!relayEnabled\) return/);
});

test("les accès enseignant et appareil de classe restent fail-closed", async () => {
  const [teacherBasics, classAccess, presence] = await Promise.all([
    read("src/app/api/teacher/institution/basics/route.ts"),
    read("src/lib/class-device-access-server.ts"),
    read("src/lib/attendance-presence-server.ts"),
  ]);

  assert.match(teacherBasics, /relayProvisioned/);
  assert.match(teacherBasics, /allow_local_relay: relayEnabled/);
  assert.match(classAccess, /relay_not_provisioned/);
  assert.match(classAccess, /!text\(row\.last_seen_at\)/);
  assert.match(presence, /relayEnabledForInstitutionServer/);
  assert.match(presence, /relay_not_enabled_for_institution/);
});
