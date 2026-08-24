import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const roleRoutePath = new URL(
  "../src/app/api/auth/role/route.ts",
  import.meta.url,
);
const bridgePath = new URL(
  "../src/components/admin/OfflineScheduleSyncBridge.tsx",
  import.meta.url,
);

async function source(path) {
  return await readFile(path, "utf8");
}

test("le rôle expose un opt-in relais explicite et fail-closed par établissement", async () => {
  const code = await source(roleRoutePath);

  assert.match(code, /institution_attendance_policies/);
  assert.match(code, /select\("enabled,allow_local_relay,relay_local_url"\)/);
  assert.match(
    code,
    /const enabled = data\.enabled === true && data\.allow_local_relay === true/,
  );
  assert.match(code, /if \(error \|\| !data\) return RELAY_DISABLED/);
  assert.match(code, /const relay = await resolveInstitutionRelayState\(institutionId\)/);
  assert.match(code, /institution_id: institutionId \|\| null,\s*relay,/s);
  assert.doesNotMatch(code, /relay_presence_secret/);
});

test("une mutation Cloud ne déclenche jamais le relais sans opt-in confirmé", async () => {
  const code = await source(bridgePath);

  assert.match(code, /type RelayMode = "checking" \| "enabled" \| "disabled"/);
  assert.match(code, /enabled = response\.ok && payload\?\.relay\?\.enabled === true/);
  assert.match(
    code,
    /response\.ok &&\s*relayModeRef\.current === "enabled" &&\s*isOfflineScheduleMutation/s,
  );
  assert.match(
    code,
    /markRelayScheduleSyncPending\(\);\s*if \(getRelayConfig\(\)\.token\) \{\s*void syncRelayScheduleAfterMutation\(\);/s,
  );
  assert.match(
    code,
    /if \(relayMode !== "enabled" \|\| !state \|\| state\.status === "synced"\) \{\s*return null;/s,
  );
});

test("une politique relais impossible à confirmer reste Cloud/PWA uniquement", async () => {
  const code = await source(bridgePath);
  const start = code.indexOf("const refreshRelayMode = async () =>");
  const end = code.indexOf("const interceptedFetch", start);

  assert.ok(start >= 0 && end > start, "résolution du mode relais introuvable");
  const resolver = code.slice(start, end);
  assert.match(resolver, /catch \{[\s\S]*enabled = false;/);
  assert.match(
    resolver,
    /if \(!enabled\) \{\s*setState\(null\);\s*return;/s,
  );
});

test("aucun jeton secret du relais n'est exposé au navigateur", async () => {
  const roleCode = await source(roleRoutePath);
  const bridgeCode = await source(bridgePath);

  assert.doesNotMatch(roleCode, /relay_presence_secret/);
  assert.doesNotMatch(bridgeCode, /relay_presence_secret/);
});
