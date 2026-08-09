import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_ATTENDANCE_POLL_MS,
  adminAttendanceCacheKeys,
  adminAttendancePollDelay,
  createTimedAbortSignal,
  isInstitutionScopedAdminAttendanceEnvelope,
  readCloudRelayCache,
} from "../src/lib/admin-attendance-monitor";

test("la clé de cache est cloisonnée par établissement tout en gardant la clé legacy", () => {
  const first = adminAttendanceCacheKeys("from=2026-08-09&to=2026-08-09", "inst/1");
  const second = adminAttendanceCacheKeys("from=2026-08-09&to=2026-08-09", "inst-2");

  assert.equal(first.legacy, second.legacy);
  assert.notEqual(first.scoped, second.scoped);
  assert.match(first.scoped, /inst%2F1/);
});

test("une enveloppe cache sans preuve d'établissement n'est jamais acceptée", () => {
  const base = {
    data: { rows: [] },
    source: "cloud",
    saved_at: "2026-08-09T08:00:00.000Z",
  };

  assert.equal(isInstitutionScopedAdminAttendanceEnvelope(base, "inst-1"), false);
  assert.equal(
    isInstitutionScopedAdminAttendanceEnvelope(
      { ...base, institution_id: "inst-2" },
      "inst-1",
    ),
    false,
  );
  assert.equal(
    isInstitutionScopedAdminAttendanceEnvelope(
      { ...base, institution_id: "inst-1" },
      "inst-1",
    ),
    true,
  );
});

test("le polling s'adapte à la source et ralentit après une erreur", () => {
  assert.equal(adminAttendancePollDelay("cloud", false), ADMIN_ATTENDANCE_POLL_MS.cloud);
  assert.equal(adminAttendancePollDelay("relay", false), ADMIN_ATTENDANCE_POLL_MS.relay);
  assert.equal(adminAttendancePollDelay("cache", false), ADMIN_ATTENDANCE_POLL_MS.cache);
  assert.equal(adminAttendancePollDelay("cloud", true), ADMIN_ATTENDANCE_POLL_MS.error);
  assert.equal(adminAttendancePollDelay(null, false), ADMIN_ATTENDANCE_POLL_MS.initial);
});

test("la lecture essaie Cloud puis relais sans consulter le cache si le relais répond", async () => {
  const calls: string[] = [];
  const result = await readCloudRelayCache({
    cloud: async () => {
      calls.push("cloud");
      throw new Error("cloud_unreachable");
    },
    relay: async () => {
      calls.push("relay");
      return "relay-data";
    },
    cache: async () => {
      calls.push("cache");
      return "cache-data";
    },
  });

  assert.equal(result, "relay-data");
  assert.deepEqual(calls, ["cloud", "relay"]);
});

test("la lecture revient au cache après les échecs Cloud et relais", async () => {
  const calls: string[] = [];
  const result = await readCloudRelayCache({
    cloud: async () => {
      calls.push("cloud");
      throw new Error("cloud_unreachable");
    },
    relay: async () => {
      calls.push("relay");
      throw new Error("relay_unreachable");
    },
    cache: async () => {
      calls.push("cache");
      return "cache-data";
    },
  });

  assert.equal(result, "cache-data");
  assert.deepEqual(calls, ["cloud", "relay", "cache"]);
});

test("une annulation externe est propagée sans tenter le relais ni le cache", async () => {
  const controller = new AbortController();
  const calls: string[] = [];

  await assert.rejects(
    readCloudRelayCache({
      signal: controller.signal,
      cloud: async () => {
        calls.push("cloud");
        controller.abort(new DOMException("navigation", "AbortError"));
        throw controller.signal.reason;
      },
      relay: async () => {
        calls.push("relay");
        return "relay-data";
      },
      cache: async () => {
        calls.push("cache");
        return "cache-data";
      },
    }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.deepEqual(calls, ["cloud"]);
});

test("le signal temporisé relaie l'annulation externe et nettoie son timer", () => {
  const external = new AbortController();
  const timed = createTimedAbortSignal(external.signal, 60_000, "timeout");
  const reason = new DOMException("navigation", "AbortError");
  external.abort(reason);

  assert.equal(timed.signal.aborted, true);
  assert.equal(timed.signal.reason, reason);
  timed.cleanup();
});
