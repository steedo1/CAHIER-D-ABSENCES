import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { RELAY_GLOBAL_STANDBY } from "../src/lib/relay-standby.ts";
import { relayEnabledForInstitutionServer } from "../src/lib/relay-capability-server.ts";
import { enrichClassDeviceAccess } from "../src/lib/class-device-access-server.ts";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("mise en veille Relais globale et réversible sans migration de données", async () => {
  assert.equal(RELAY_GLOBAL_STANDBY, true);
  let attempted = 0;
  assert.equal(await relayEnabledForInstitutionServer({ from() { attempted++; throw Error("read forbidden"); } }, "school-a"), false);
  assert.equal(await relayEnabledForInstitutionServer({ from() { attempted++; throw Error("read forbidden"); } }, "school-b"), false);
  assert.equal(attempted, 0);
});

test("un établissement avec Relais provisionné ne reçoit plus aucun jeton local", async () => {
  const records = {
    institutions: [{ id: "school-a", name: "School A" }],
    institution_attendance_policies: [{ institution_id: "school-a", enabled: true, allow_local_relay: true,
      relay_local_url: "http://relay.local:4317", relay_presence_secret: "s".repeat(64) }],
    relay_sync_devices: [{ institution_id: "school-a", is_active: true, revoked_at: null,
      last_seen_at: "2026-10-22T00:00:00Z", observed_lan_urls: ["http://relay.local:4317"] }],
  };
  const service = { from(table) { return { select(columns) { return {
    in() { return Promise.resolve({ data: table === "institutions" && columns.includes("settings_json")
      ? [{ id: "school-a", settings_json: {} }] : records[table] || [], error: null }); },
  }; } }; } };
  const result = await enrichClassDeviceAccess({ service, actorProfileId: "tablet-a",
    createAccessToken() { throw Error("Un jeton ne doit pas être créé"); },
    items: [{ id: "class-a", institution_id: "school-a", label: "6e1" }] });
  const presence = result.items[0].attendance_presence;
  assert.equal(result.items.length, 1);
  assert.equal(presence.enabled, false);
  assert.equal(presence.allow_local_relay, false);
  assert.equal(presence.relay_access_token, null);
  assert.equal(presence.relay_local_url, null);
});

test("les nouveaux paquets d'appel sont groupés et contrôlés par classe et révision", () => {
  const route = read("src/app/api/class/subjects/route.ts");
  const prep = read("src/lib/offline-readiness.ts");
  assert.match(route, /all_slots.*v1/);
  assert.match(route, /classDeviceMayAccessClass/);
  assert.match(route, /timetable_subject_mapping_incomplete/);
  assert.match(route, /scheduleJson\(\[\], \{/);
  assert.match(prep, /all_slots=v1/);
  assert.match(prep, /bulk\.actor_profile_id !== input\.actorProfileId/);
  assert.match(prep, /preparedSlots\.length !== scheduledByPeriod\.size/);
  assert.match(prep, /fetchFreshJson<\{ items\?: Array<Record<string, unknown>> \}>/);
});
