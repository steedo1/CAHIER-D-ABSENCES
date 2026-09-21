import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_ATTENDANCE_POLL_MS,
  adminAttendanceCacheKeys,
  adminAttendancePollDelay,
  createTimedAbortSignal,
  isInstitutionScopedAdminAttendanceEnvelope,
  mergeAdminAttendanceRows,
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
  assert.equal(adminAttendancePollDelay("hybrid", false), ADMIN_ATTENDANCE_POLL_MS.hybrid);
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


test("la fusion privilégie une preuve Relais plus avancée sans perdre les métadonnées Cloud", () => {
  const cloud = [{
    id: "2026-09-21|p1|c1|s1|t1",
    status: "missing",
    session_id: null,
    attendance_receipt_available: true,
    class_label: "3e1",
  }];
  const relay = [{
    id: "2026-09-21|p1|c1|s1|t1",
    status: "ok",
    opened_from: "class_device",
    class_label: "3e1",
  }];

  const merged = mergeAdminAttendanceRows(cloud, relay);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.status, "ok");
  assert.equal(merged[0]?.opened_from, "class_device");
  assert.equal(merged[0]?.attendance_receipt_available, true);
  assert.equal(merged[0]?.session_id, null);
});

test("la fusion conserve le Cloud lorsqu'il possède déjà une preuve équivalente ou supérieure", () => {
  const cloud = [{
    id: "row-1",
    status: "ok",
    session_id: "cloud-session",
    actual_call_at: "2026-09-21T10:02:00.000Z",
  }];
  const relay = [{
    id: "row-1",
    status: "started",
    opened_from: "teacher",
  }];

  const merged = mergeAdminAttendanceRows(cloud, relay);
  assert.equal(merged[0]?.status, "ok");
  assert.equal(merged[0]?.session_id, "cloud-session");
  assert.equal(merged[0]?.actual_call_at, "2026-09-21T10:02:00.000Z");
});

test("la fusion conserve aussi les lignes présentes uniquement sur le Relais", () => {
  const merged = mergeAdminAttendanceRows(
    [{ id: "cloud-only", status: "not_started" }],
    [{ id: "relay-only", status: "started" }],
  );
  assert.deepEqual(
    merged.map((row) => row.id),
    ["cloud-only", "relay-only"],
  );
});
