import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureLiveCloudClock,
  captureLiveRelayClock,
  estimateClassDeviceNow,
} from "../src/lib/class-device-clock";
import {
  chooseRestorableClassDeviceOpen,
  runClassDeviceSingleFlight,
  type ClassDeviceCompletionMarker,
  type RestorableClassDeviceOpen,
} from "../src/lib/class-device-session-state";

test("une heure relais fraîche avance avec l'horloge monotone", () => {
  const reference = captureLiveRelayClock("2026-08-01T08:00:00.000Z", {
    wallNowMs: Date.parse("2026-08-01T08:00:02.000Z"),
    monotonicNowMs: 1_000,
  });
  assert.ok(reference);

  const estimate = estimateClassDeviceNow(reference, {
    wallNowMs: Date.parse("2026-08-01T08:05:10.000Z"),
    monotonicNowMs: 301_000,
  });
  assert.equal(estimate.now.toISOString(), "2026-08-01T08:05:00.000Z");
  assert.equal(estimate.source, "relay_estimate");
  assert.equal(estimate.reference_age_ms, 308_000);
});

test("une relay_time ancienne sans observation live n'est jamais traitée comme fraîche", () => {
  const estimate = estimateClassDeviceNow(null, {
    wallNowMs: Date.parse("2026-08-01T12:00:00.000Z"),
    monotonicNowMs: 900_000,
  });
  assert.equal(estimate.now.toISOString(), "2026-08-01T12:00:00.000Z");
  assert.equal(estimate.source, "local_untrusted");
  assert.equal(estimate.reference_age_ms, null);
});

function open(overrides: Partial<RestorableClassDeviceOpen> = {}): RestorableClassDeviceOpen {
  return {
    id: "cloud-session-a",
    class_id: "class-a",
    subject_id: "subject-a",
    started_at: "2026-08-01T08:00:00.000Z",
    ...overrides,
  };
}

function completion(
  overrides: Partial<ClassDeviceCompletionMarker> = {},
): ClassDeviceCompletionMarker {
  return {
    session_id: "client:open-operation-a",
    class_id: "class-a",
    subject_id: "subject-a",
    started_at: "2026-08-01T08:00:00.000Z",
    ended_at: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

test("une fermeture locale plus récente masque la séance Cloud encore ouverte", () => {
  const restored = chooseRestorableClassDeviceOpen({
    localOpen: null,
    serverOpen: open(),
    completion: completion(),
    resolvedCompletionServerId: "cloud-session-a",
  });
  assert.equal(restored, null);
});

test("la fermeture de A ne masque pas le cours suivant B", () => {
  const next = open({
    id: "cloud-session-b",
    subject_id: "subject-b",
    started_at: "2026-08-01T09:00:00.000Z",
  });
  const restored = chooseRestorableClassDeviceOpen({
    localOpen: null,
    serverOpen: next,
    completion: completion(),
    resolvedCompletionServerId: "cloud-session-a",
  });
  assert.deepEqual(restored, next);
});

test("le retour simultane Cloud et relais ne lance qu'une synchronisation", async () => {
  const lock = { current: false };
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const task = async () => {
    runs += 1;
    await gate;
    return "done";
  };

  const first = runClassDeviceSingleFlight(lock, task);
  const second = runClassDeviceSingleFlight(lock, task);
  await Promise.resolve();
  assert.equal(runs, 1);
  assert.equal(await second, undefined);
  release();
  assert.equal(await first, "done");
  assert.equal(lock.current, false);
});

test("une heure Cloud reste distincte d'une estimation relais", () => {
  const reference = captureLiveCloudClock("2026-08-01T12:00:00.000Z", {
    wallNowMs: Date.parse("2026-08-01T12:00:01.000Z"),
    monotonicNowMs: 10_000,
  });
  assert.ok(reference);
  const estimate = estimateClassDeviceNow(reference, {
    wallNowMs: Date.parse("2026-08-01T12:00:06.000Z"),
    monotonicNowMs: 15_000,
  });
  assert.equal(estimate.source, "cloud_live");
  assert.equal(estimate.now.toISOString(), "2026-08-01T12:00:05.000Z");
});
