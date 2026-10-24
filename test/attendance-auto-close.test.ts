import assert from "node:assert/strict";
import test from "node:test";
import { attendanceAutoCloseAt, watchAttendanceAutoClose } from "../src/lib/attendance-auto-close";
import {
  stageTeacherAttendanceSessionCloseWithDependencies,
  closeTeacherAttendanceSessionWithDependencies,
  type TeacherSessionLifecycleDeliveryRecord,
  type TeacherSessionLifecycleDependencies,
} from "../src/lib/teacher-session-lifecycle-delivery";

const started_at = "2026-10-15T07:00:00.000Z";
const periods = { 4: [
  { id: "p1", weekday: 4, start_time: "07:00:00", end_time: "08:00:00" },
  { id: "p2", weekday: 4, start_time: "08:00:00", end_time: "10:00:00" },
] };
test("official slot end + 2 min wins over the click time, duration, and next course", () => {
  assert.equal(attendanceAutoCloseAt({ started_at, period_id: "p1", expected_minutes: 120 }, periods, "Africa/Abidjan"), "2026-10-15T08:02:00.000Z");
  assert.equal(attendanceAutoCloseAt({ started_at, expected_minutes: 60 }, {}, "Africa/Abidjan"), "2026-10-15T08:02:00.000Z");
  assert.equal(attendanceAutoCloseAt({ started_at, scheduled_end_at: "2026-10-15T09:30:00Z" }, periods, "Africa/Abidjan"), "2026-10-15T09:32:00.000Z");
});
test("legacy restored cloud sessions find their slot; local date and timezone determine the weekday", () => {
  assert.equal(attendanceAutoCloseAt({ started_at, expected_minutes: 120 }, periods, "Africa/Abidjan"), "2026-10-15T08:02:00.000Z");
  assert.equal(attendanceAutoCloseAt({ started_at: "2026-10-14T22:00:00Z", period_id: "p1" }, periods, "Asia/Tokyo"), "2026-10-14T23:02:00.000Z");
  assert.equal(attendanceAutoCloseAt({ started_at: "2026-10-15T07:25:00Z", expected_minutes: 25 }, {}, "Africa/Abidjan"), "2026-10-15T07:52:00.000Z");
});

test("Autre cours utilise sa durée propre pendant un créneau et après restauration Cloud", () => {
  for (const flag of [{ manual_course: true }, { hors_edt: true }]) {
    assert.equal(attendanceAutoCloseAt({
      started_at: "2026-10-15T07:15:00Z", period_id: "p1", expected_minutes: 90,
      scheduled_end_at: "2026-10-15T08:00:00Z", ...flag,
    }, periods, "Africa/Abidjan"), "2026-10-15T08:47:00.000Z");
    assert.equal(attendanceAutoCloseAt({
      started_at, expected_minutes: 20, ...flag,
    }, {}, "Africa/Abidjan"), "2026-10-15T07:22:00.000Z");
  }
});
test("incomplete or corrupt session metadata never closes prematurely", () => {
  for (const session of [null, { started_at: "bad" }, { started_at }, { started_at, expected_minutes: 0 }, { started_at, expected_minutes: NaN }, { started_at, scheduled_end_at: started_at }]) {
    assert.equal(attendanceAutoCloseAt(session, {}, "Africa/Abidjan"), null);
  }
});

function clock() {
  let now = Date.parse("2026-10-15T08:01:59.000Z");
  let id = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const listeners = new Map<string, Set<() => void>>();
  const environment = {
    deadline: "2026-10-15T08:02:00.000Z", now: () => now,
    events: {
      addEventListener(type: string, callback: () => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(callback);
      },
      removeEventListener(type: string, callback: () => void) { listeners.get(type)?.delete(callback); },
    },
    timers: {
      setTimeout(callback: () => void, delay: number) { pending.set(++id, { at: now + delay, callback }); return id; },
      clearTimeout(timer: number) { pending.delete(timer); },
    },
  };
  return {
    environment: environment as unknown as Parameters<typeof watchAttendanceAutoClose>[0],
    async advance(milliseconds: number, suspended = false) {
      const target = now + milliseconds;
      if (suspended) { now = target; return; }
      for (;;) {
        const next = [...pending].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at; pending.delete(next[0]); next[1].callback();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      }
      now = target;
    },
    wake(type = "focus") { for (const callback of listeners.get(type) || []) callback(); },
    pending, listeners,
  };
}

test("closes at the exact boundary offline; wakeup bursts cannot duplicate a running finish", async () => {
  const c = clock(); const calls: string[] = [];
  let release!: () => void;
  const stop = watchAttendanceAutoClose({ ...c.environment, ready: () => true, close: async (at) => {
    calls.push(at); await new Promise<void>((resolve) => { release = resolve; });
  } });
  await c.advance(999); assert.equal(calls.length, 0);
  await c.advance(1); assert.deepEqual(calls, [c.environment.deadline]);
  c.wake(); c.wake("online"); c.wake("visibilitychange");
  await c.advance(20_000); assert.equal(calls.length, 1);
  stop(); release(); await Promise.resolve(); await Promise.resolve();
  assert.equal(c.pending.size, 0);
  assert.ok([...c.listeners.values()].every((set) => set.size === 0));
});
test("suspension catches up with the planned time; loading and storage failure delay safely and retry", async () => {
  const c = clock(); let ready = false; const calls: string[] = [];
  const stop = watchAttendanceAutoClose({ ...c.environment, ready: () => ready, close: async (at) => {
    calls.push(at); throw new Error("storage_full");
  } });
  await c.advance(60_000, true); c.wake("pageshow");
  await Promise.resolve(); assert.equal(calls.length, 0);
  ready = true; c.wake("visibilitychange");
  await c.advance(0); assert.deepEqual(calls, [c.environment.deadline]);
  await c.advance(14_999); assert.equal(calls.length, 1);
  await c.advance(1); assert.equal(calls.length, 2);
  stop();
});
test("manual finish/unmount cancels a timer before it can close the next session", async () => {
  const c = clock(); let calls = 0;
  const stop = watchAttendanceAutoClose({ ...c.environment, ready: () => true, close: async () => { calls++; } });
  stop(); await c.advance(120_000); c.wake();
  assert.equal(calls, 0);
});

test("relay close journal preserves the planned deadline across network retries", async () => {
  const records: TeacherSessionLifecycleDeliveryRecord[] = [];
  let payload: any;
  const deps: TeacherSessionLifecycleDependencies = {
    store: { list: async () => records, put: async (record) => {
      const index = records.findIndex((r) => r.operation_id === record.operation_id);
      if (index < 0) records.push(record); else records[index] = record;
    } },
    now: () => new Date("2026-10-15T08:30:00.000Z"), createOperationId: () => "automatic-close-a",
    postClose: async (input) => { payload = input.payload; throw new Error("offline"); },
    postTransition: async () => { throw new Error("unused"); },
  };
  const input = { institutionId: "school-a", sessionId: "session-a", classId: "class-a", attendanceOperationId: "marks-a", capturedAtDevice: "2026-10-15T08:02:00.000Z" };
  const staged = await stageTeacherAttendanceSessionCloseWithDependencies(input, deps);
  assert.equal(staged.device_requested_at, input.capturedAtDevice);
  await closeTeacherAttendanceSessionWithDependencies({ ...input, capturedAtDevice: "2026-10-15T08:31:00.000Z", relayBaseUrl: "http://relay.local:4317", relayAccessToken: "test" }, deps);
  assert.equal(records.length, 1);
  assert.equal(payload.captured_at_device, input.capturedAtDevice);
  assert.equal(records[0].attendance_operation_id, "marks-a");
});
