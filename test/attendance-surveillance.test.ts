import assert from "node:assert/strict";
import test from "node:test";
import { attendanceReceiptLabel, readAttendancePages, sessionBelongsToSlot } from "../src/lib/attendance-surveillance";
import { parseAttendanceEndAt } from "../src/lib/attendance-end-time";
import { attendanceCloudAvailableForSync, attendanceConnectionConstrained } from "../src/lib/attendance-network";

test("a late 08:00 call stays attached to 08:00, never the adjacent 09:00 slot", () => {
  assert.equal(sessionBelongsToSlot(480, 480), true);
  assert.equal(sessionBelongsToSlot(480, 540), false);
  assert.equal(sessionBelongsToSlot(NaN, 480), false);
});

test("session, student batch receipt and closure are distinct evidence", () => {
  assert.match(attendanceReceiptLabel({}), /non vérifiable sur cette source/);
  assert.equal(attendanceReceiptLabel({ session_id: null }), "Aucune séance reçue");
  assert.match(attendanceReceiptLabel({ session_id: "s", ended_at: "2026-09-14T09:00:00Z", attendance_receipt_available: true }), /non confirmée/);
  assert.match(attendanceReceiptLabel({ session_id: "s", attendance_received_at: "now", attendance_receipt_available: false }), /non vérifiable/);
  assert.match(attendanceReceiptLabel({ session_id: "s", attendance_received_at: "now", attendance_receipt_available: true }), /non clôturée/);
  assert.match(attendanceReceiptLabel({ session_id: "s", attendance_received_at: "now", attendance_receipt_available: true, ended_at: "now" }), /séance clôturée/);
});

test("pagination continues even when server caps pages below requested size", async () => {
  const all = Array.from({ length: 431 }, (_, i) => i);
  const ranges: number[] = [];
  const result = await readAttendancePages<number>(async (from) => {
    ranges.push(from);
    return { data: all.slice(from, from + 100), count: all.length, error: null };
  });
  assert.deepEqual(result.data, all);
  assert.deepEqual(ranges, [0, 100, 200, 300, 400]);
});

test("incomplete and failed pages never return a misleading partial success", async () => {
  const incomplete = await readAttendancePages<number>(async () => ({ data: [], count: 1, error: null }));
  assert.ok(incomplete.error);
  const failed = await readAttendancePages<number>(async () => ({ data: null, error: { message: "denied" } }));
  assert.equal(failed.data, null);
  assert.equal(failed.error?.message, "denied");
  const tooLarge = await readAttendancePages<number>(async () => ({ data: Array(200).fill(1), count: 400, error: null }), 200);
  assert.ok(tooLarge.error);
});

test("delayed offline closure preserves original time, including more than 30 days", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  assert.equal(parseAttendanceEndAt("2026-08-01T09:00:00Z", now), "2026-08-01T09:00:00.000Z");
  assert.equal(parseAttendanceEndAt("invalid", now), null);
  assert.equal(parseAttendanceEndAt("2026-09-14T13:00:00Z", now), null);
  assert.equal(parseAttendanceEndAt(undefined, now), now.toISOString());
});

test("2G and saveData do not prevent a real sync probe; concurrent probes share one request", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousFetch = globalThis.fetch;
  let requests = 0;
  let online = true;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    get onLine() { return online; }, connection: { effectiveType: "2g", saveData: true, rtt: 1500, downlink: 0.1 },
  } });
  globalThis.fetch = async () => { requests++; return new Response("{}", { status: 200 }); };
  try {
    assert.equal(attendanceConnectionConstrained(), true);
    assert.deepEqual(await Promise.all([attendanceCloudAvailableForSync(), attendanceCloudAvailableForSync()]), [true, true]);
    assert.equal(requests, 1);
    online = false;
    assert.equal(await attendanceCloudAvailableForSync(), false);
    assert.equal(requests, 1);
    online = true;
    globalThis.fetch = async () => new Response("{}", { status: 503 });
    assert.equal(await attendanceCloudAvailableForSync(), false);
    globalThis.fetch = async () => new Response("{}", { status: 401 });
    assert.equal(await attendanceCloudAvailableForSync(), true);
  } finally {
    globalThis.fetch = previousFetch;
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
