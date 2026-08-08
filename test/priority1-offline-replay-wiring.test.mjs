import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("le Cloud utilise l'heure historique uniquement pour un rejeu vérifié", async () => {
  const [start, end] = await Promise.all([
    read("src/app/api/class/sessions/start/route.ts"),
    read("src/app/api/class/sessions/end/route.ts"),
  ]);
  assert.match(start, /validateTeacherSessionReplay/);
  assert.match(start, /if \(replay\) actualCallAt = replay\.eventAt/);
  assert.match(start, /offline_replay_schedule_revision_stale_requires_review/);
  assert.match(start, /offline_replay_period_mismatch/);
  assert.match(end, /effectiveEndAt = replay\.eventAt/);
  assert.doesNotMatch(end, /return now\.toISOString\(\)/);
  assert.match(end, /actual_end_at_too_old_use_offline_replay/);
});

test("le téléphone enrichit ouverture et fermeture avant leur rejeu", async () => {
  const [offline, page, delivery, lifecycle, recovery] = await Promise.all([
    read("src/lib/offline.ts"),
    read("src/app/class/page.tsx"),
    read("src/lib/teacher-session-delivery.ts"),
    read("src/lib/teacher-session-lifecycle-delivery.ts"),
    read("src/lib/teacher-offline-relay-recovery.ts"),
  ]);
  assert.match(offline, /function bodyWithOfflineReplayContext/);
  assert.match(offline, /offline_replay_context_missing/);
  assert.match(page, /scheduleRevision: preparedSchedule\?\.schedule_revision/);
  assert.match(page, /scheduledStartAt: cur\.scheduled_start_at \|\| cur\.started_at/);
  assert.match(delivery, /replayMode: true/);
  assert.match(lifecycle, /resolveOfflineSessionReference\(sessionId\)/);
  assert.match(lifecycle, /`client:\$\{resolvedSession\.sessionReference \|\| sessionId\}`/);
  assert.match(recovery, /`client:\$\{record\.operation_id\}`/);
});

test("le relais accepte le protocole v2 sans modifier le protocole direct", async () => {
  const [open, close] = await Promise.all([
    read("desktop/relay/src/teacher-session-open.mts"),
    read("desktop/relay/src/teacher-session-lifecycle.mts"),
  ]);
  assert.match(open, /RELAY_OFFLINE_REPLAY_PROTOCOL_VERSION/);
  assert.match(open, /eventAt = replay\.eventAt/);
  assert.match(open, /offline_replay_schedule_revision_stale_requires_review/);
  assert.match(close, /eventAt = replay\.eventAt/);
  assert.match(close, /client_session_id LIKE 'client:%'/);
  assert.match(close, /replayProtectionCutoff/);
  assert.match(close, /acceptedClientSessionIds/);
  assert.match(close, /liveReceiptReplayedOffline/);
  assert.match(close, /protocol_version, payload_fingerprint/);
});

test("une réponse perdue est acquittée avant toute revalidation d'un planning devenu obsolète", async () => {
  const [cloudStart, relayOpen] = await Promise.all([
    read("src/app/api/class/sessions/start/route.ts"),
    read("desktop/relay/src/teacher-session-open.mts"),
  ]);

  const cloudExistingLookup = cloudStart.indexOf('.eq("id", deterministicSessionId)');
  const cloudStaleGuard = cloudStart.indexOf(
    "offline_replay_schedule_revision_stale_requires_review",
  );
  assert.ok(cloudExistingLookup >= 0);
  assert.ok(cloudStaleGuard > cloudExistingLookup);
  assert.match(cloudStart, /previously_accepted_operation_acknowledged/);
  assert.match(cloudStart, /operation_id_reused_with_different_payload/);

  const relayFunctionStart = relayOpen.indexOf(
    "export function openTeacherAttendanceSession",
  );
  const relayExistingLookup = relayOpen.indexOf(
    "const existing = storedReceipt",
    relayFunctionStart,
  );
  const relayReplayValidation = relayOpen.indexOf(
    "validateRelayOfflineReplay",
    relayFunctionStart,
  );
  assert.ok(relayExistingLookup >= 0);
  assert.ok(relayReplayValidation > relayExistingLookup);
  assert.match(relayOpen, /liveReceiptReplayedOffline/);
  assert.match(relayOpen, /local_session_mapping_conflict/);
});
