import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_ATTENDANCE_POLL_MS,
  adminAttendanceCacheKeys,
  adminAttendancePollDelay,
  adminAttendanceViewReducer,
  initialAdminAttendanceViewState,
  isInstitutionScopedAdminAttendanceEnvelope,
  readCloudRelayCache,
} from "../src/lib/admin-attendance-monitor";

test("admin 1 - la source suit Cloud puis relais puis cache sans modifier les cartes", async () => {
  const cloudRows = [{ id: "cloud" }];
  const cloud = await readCloudRelayCache({
    cloud: async () => ({ source: "cloud", rows: cloudRows }),
    relay: async () => { throw new Error("relay_not_expected"); },
    cache: async () => null,
  });
  assert.deepEqual(cloud, { source: "cloud", rows: cloudRows });

  const relayRows = [{ id: "relay" }];
  const relay = await readCloudRelayCache({
    cloud: async () => { throw new Error("cloud_down"); },
    relay: async () => ({ source: "relay", rows: relayRows }),
    cache: async () => ({ source: "cache", rows: [{ id: "cache" }] }),
  });
  assert.deepEqual(relay, { source: "relay", rows: relayRows });

  const cacheRows = [{ id: "cache" }];
  const cache = await readCloudRelayCache({
    cloud: async () => { throw new Error("cloud_down"); },
    relay: async () => { throw new Error("relay_down"); },
    cache: async () => ({ source: "cache", rows: cacheRows }),
  });
  assert.deepEqual(cache, { source: "cache", rows: cacheRows });
});

test("admin 2 - cache vers Cloud et cache vers relais remplacent proprement la source", () => {
  const cacheState = adminAttendanceViewReducer(initialAdminAttendanceViewState<{ id: string }>(), {
    type: "success",
    data: [{ id: "cached-card" }],
    source: "cache",
    savedAt: "2026-08-09T08:00:00.000Z",
  });

  const refreshing = adminAttendanceViewReducer(cacheState, { type: "begin" });
  assert.deepEqual(refreshing.data, [{ id: "cached-card" }]);
  assert.equal(refreshing.source, "cache");
  assert.equal(refreshing.loading, true);

  const cloudState = adminAttendanceViewReducer(refreshing, {
    type: "success",
    data: [{ id: "cloud-card" }],
    source: "cloud",
    savedAt: "2026-08-09T08:01:00.000Z",
  });
  assert.equal(cloudState.source, "cloud");
  assert.deepEqual(cloudState.data, [{ id: "cloud-card" }]);

  const relayState = adminAttendanceViewReducer(cacheState, {
    type: "success",
    data: [{ id: "relay-card" }],
    source: "relay",
    savedAt: "2026-08-09T08:02:00.000Z",
  });
  assert.equal(relayState.source, "relay");
  assert.deepEqual(relayState.data, [{ id: "relay-card" }]);
});

test("admin 3 - une erreur d'actualisation conserve la dernière vue valide", () => {
  const ready = adminAttendanceViewReducer(initialAdminAttendanceViewState<{ id: string }>(), {
    type: "success",
    data: [{ id: "class-a" }, { id: "class-b" }],
    source: "cache",
    savedAt: "2026-08-09T08:00:00.000Z",
  });
  const failed = adminAttendanceViewReducer(
    adminAttendanceViewReducer(ready, { type: "begin" }),
    { type: "failure", error: "network_unavailable" },
  );
  assert.deepEqual(failed.data, ready.data);
  assert.equal(failed.source, "cache");
  assert.equal(failed.savedAt, ready.savedAt);
  assert.equal(failed.error, "network_unavailable");
  assert.equal(failed.loading, false);
});

test("admin 4 - le polling devient moins agressif hors Cloud", () => {
  assert.equal(adminAttendancePollDelay("cloud", false), ADMIN_ATTENDANCE_POLL_MS.cloud);
  assert.equal(adminAttendancePollDelay("relay", false), ADMIN_ATTENDANCE_POLL_MS.relay);
  assert.equal(adminAttendancePollDelay("cache", false), ADMIN_ATTENDANCE_POLL_MS.cache);
  assert.equal(adminAttendancePollDelay(null, true), ADMIN_ATTENDANCE_POLL_MS.error);
  assert.ok(ADMIN_ATTENDANCE_POLL_MS.cache > ADMIN_ATTENDANCE_POLL_MS.relay);
  assert.ok(ADMIN_ATTENDANCE_POLL_MS.relay > ADMIN_ATTENDANCE_POLL_MS.cloud);
});

test("admin 5 - le cache est strictement cloisonné par établissement", () => {
  const query = "from=2026-08-09&to=2026-08-09";
  const schoolA = adminAttendanceCacheKeys(query, "school-a");
  const schoolB = adminAttendanceCacheKeys(query, "school-b");
  assert.notEqual(schoolA.scoped, schoolB.scoped);
  assert.equal(schoolA.legacy, schoolB.legacy);

  const validEnvelope = {
    institution_id: "school-a",
    source: "relay",
    saved_at: "2026-08-09T08:00:00.000Z",
    data: { rows: [{ id: "class-a" }] },
  };
  assert.equal(isInstitutionScopedAdminAttendanceEnvelope(validEnvelope, "school-a"), true);
  assert.equal(isInstitutionScopedAdminAttendanceEnvelope(validEnvelope, "school-b"), false);
});

test("admin 6 - un abort externe interdit le fallback relais/cache", async () => {
  const controller = new AbortController();
  let relayCalls = 0;
  let cacheCalls = 0;
  await assert.rejects(
    readCloudRelayCache({
      signal: controller.signal,
      cloud: async () => {
        controller.abort(new DOMException("cancelled", "AbortError"));
        throw controller.signal.reason;
      },
      relay: async () => {
        relayCalls += 1;
        return { source: "relay" };
      },
      cache: async () => {
        cacheCalls += 1;
        return { source: "cache" };
      },
    }),
    /cancelled/,
  );
  assert.equal(relayCalls, 0);
  assert.equal(cacheCalls, 0);
});
