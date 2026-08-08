import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfflinePreparationTriggerController,
} from "../src/lib/offline-preparation-triggers.ts";
import type {
  OfflinePreparationTrigger,
} from "../src/lib/offline-preparation-machine.ts";

type RetrySnapshot = { next_retry_at: number | null };

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function fakeTimers(initial = 0) {
  type Task = {
    at: number;
    callback: (...args: unknown[]) => void;
    interval: number | null;
  };

  let current = initial;
  let nextId = 1;
  const tasks = new Map<number, Task>();

  const setTimeoutFake = ((
    callback: (...args: unknown[]) => void,
    delay = 0,
  ) => {
    const id = nextId++;
    tasks.set(id, {
      at: current + Math.max(0, Number(delay) || 0),
      callback,
      interval: null,
    });
    return id;
  }) as unknown as typeof globalThis.setTimeout;

  const setIntervalFake = ((
    callback: (...args: unknown[]) => void,
    delay = 0,
  ) => {
    const id = nextId++;
    const interval = Math.max(1, Number(delay) || 0);
    tasks.set(id, {
      at: current + interval,
      callback,
      interval,
    });
    return id;
  }) as unknown as typeof globalThis.setInterval;

  const clearFake = ((id: number) => {
    tasks.delete(Number(id));
  }) as unknown as typeof globalThis.clearTimeout;

  function advance(milliseconds: number) {
    const target = current + milliseconds;
    while (true) {
      const next = Array.from(tasks.entries())
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;

      const [id, task] = next;
      current = task.at;
      if (task.interval === null) {
        tasks.delete(id);
      } else {
        task.at += task.interval;
      }
      task.callback();
    }
    current = target;
  }

  return {
    now: () => current,
    setTimeout: setTimeoutFake,
    clearTimeout: clearFake,
    setInterval: setIntervalFake,
    clearInterval: clearFake as unknown as typeof globalThis.clearInterval,
    advance,
    taskCount: () => tasks.size,
  };
}

function fakeSignals() {
  const onlineTarget = new EventTarget();
  const focusTarget = new EventTarget();
  const visibilityTarget = new EventTarget();
  const serviceWorkerTarget = new EventTarget();
  const snapshotTarget = new EventTarget();
  let visible = true;
  let subscriptions = 0;
  let removals = 0;

  function subscribe(
    target: EventTarget,
    type: string,
    listener: EventListener,
  ) {
    subscriptions += 1;
    target.addEventListener(type, listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      removals += 1;
      target.removeEventListener(type, listener);
    };
  }

  return {
    subscribeOnline: (listener: EventListener) =>
      subscribe(onlineTarget, "online", listener),
    subscribeFocus: (listener: EventListener) =>
      subscribe(focusTarget, "focus", listener),
    subscribeVisibility: (listener: EventListener) =>
      subscribe(visibilityTarget, "visibilitychange", listener),
    subscribeServiceWorker: (listener: EventListener) =>
      subscribe(serviceWorkerTarget, "controllerchange", listener),
    subscribeSnapshot(listener: (snapshot: RetrySnapshot) => void) {
      const wrapped = (event: Event) => {
        listener((event as Event & { snapshot: RetrySnapshot }).snapshot);
      };
      return subscribe(snapshotTarget, "snapshot", wrapped);
    },
    isVisible: () => visible,
    setVisible: (value: boolean) => {
      visible = value;
    },
    emitOnline: () => onlineTarget.dispatchEvent(new Event("online")),
    emitFocus: () => focusTarget.dispatchEvent(new Event("focus")),
    emitVisibility: () =>
      visibilityTarget.dispatchEvent(new Event("visibilitychange")),
    emitServiceWorker: () =>
      serviceWorkerTarget.dispatchEvent(new Event("controllerchange")),
    emitSnapshot(snapshot: RetrySnapshot) {
      const event = new Event("snapshot") as Event & {
        snapshot: RetrySnapshot;
      };
      event.snapshot = snapshot;
      snapshotTarget.dispatchEvent(event);
    },
    subscriptionCount: () => subscriptions,
    removalCount: () => removals,
  };
}

test("les rafales focus, online, visibility et controllerchange sont coalescées par priorité", async () => {
  const clock = fakeTimers();
  const signals = fakeSignals();
  const runs: OfflinePreparationTrigger[] = [];
  const controller = createOfflinePreparationTriggerController({
    ...signals,
    ...clock,
    initialDelayMs: 10_000,
    intervalMs: 50_000,
    debounceMs: 300,
    run: async (trigger) => {
      runs.push(trigger);
      return null;
    },
  });
  controller.start();

  signals.setVisible(false);
  signals.emitVisibility();
  clock.advance(300);
  await flushMicrotasks();
  assert.deepEqual(runs, []);

  signals.setVisible(true);
  signals.emitFocus();
  signals.emitVisibility();
  signals.emitOnline();
  signals.emitServiceWorker();
  signals.emitFocus();
  signals.emitServiceWorker();
  clock.advance(299);
  await flushMicrotasks();
  assert.deepEqual(runs, []);

  clock.advance(1);
  await flushMicrotasks();
  assert.deepEqual(runs, ["service_worker"]);
  controller.stop();
});

test("une préparation en cours absorbe la rafale puis exécute un seul signal", async () => {
  const clock = fakeTimers();
  const signals = fakeSignals();
  let releaseFirst!: (snapshot: RetrySnapshot | null) => void;
  const firstRun = new Promise<RetrySnapshot | null>((resolve) => {
    releaseFirst = resolve;
  });
  const runs: OfflinePreparationTrigger[] = [];
  let activeRuns = 0;
  let maximumConcurrentRuns = 0;
  const controller = createOfflinePreparationTriggerController({
    ...signals,
    ...clock,
    initialDelayMs: 10_000,
    intervalMs: 50_000,
    debounceMs: 10,
    run: async (trigger) => {
      runs.push(trigger);
      activeRuns += 1;
      maximumConcurrentRuns = Math.max(maximumConcurrentRuns, activeRuns);
      if (runs.length === 1) await firstRun;
      activeRuns -= 1;
      return null;
    },
  });
  controller.start();

  signals.emitFocus();
  clock.advance(10);
  await flushMicrotasks();
  assert.deepEqual(runs, ["focus"]);

  signals.emitFocus();
  signals.emitVisibility();
  signals.emitOnline();
  signals.emitServiceWorker();
  signals.emitOnline();
  clock.advance(10);
  await flushMicrotasks();
  assert.deepEqual(runs, ["focus"]);

  releaseFirst(null);
  await flushMicrotasks();
  clock.advance(10);
  await flushMicrotasks();

  assert.deepEqual(runs, ["focus", "service_worker"]);
  assert.equal(maximumConcurrentRuns, 1);
  controller.stop();
});

test("start est idempotent et stop nettoie écouteurs et tous les timers", async () => {
  const clock = fakeTimers();
  const signals = fakeSignals();
  const runs: OfflinePreparationTrigger[] = [];
  const controller = createOfflinePreparationTriggerController({
    ...signals,
    ...clock,
    initialDelayMs: 1_000,
    intervalMs: 5_000,
    debounceMs: 50,
    run: async (trigger) => {
      runs.push(trigger);
      return null;
    },
  });

  const cleanup = controller.start();
  controller.start();
  assert.equal(typeof cleanup, "function");
  assert.equal(signals.subscriptionCount(), 5);

  signals.emitFocus();
  controller.notifySnapshot({ next_retry_at: clock.now() + 200 });
  assert.ok(clock.taskCount() >= 3);
  cleanup();

  assert.equal(signals.removalCount(), 5);
  assert.equal(clock.taskCount(), 0);
  signals.emitOnline();
  signals.emitFocus();
  signals.emitVisibility();
  signals.emitServiceWorker();
  signals.emitSnapshot({ next_retry_at: clock.now() + 100 });
  clock.advance(10_000);
  await flushMicrotasks();
  assert.deepEqual(runs, []);

  controller.stop();
  assert.equal(signals.removalCount(), 5);
});

test("un retry est replanifié, annulé par le snapshot puis exécuté à échéance", async () => {
  const clock = fakeTimers();
  const signals = fakeSignals();
  const runs: OfflinePreparationTrigger[] = [];
  const controller = createOfflinePreparationTriggerController({
    ...signals,
    ...clock,
    initialDelayMs: 10_000,
    intervalMs: 50_000,
    debounceMs: 10,
    run: async (trigger) => {
      runs.push(trigger);
      return null;
    },
  });
  controller.start();

  controller.notifySnapshot({ next_retry_at: 100 });
  controller.notifySnapshot({ next_retry_at: 200 });
  clock.advance(100);
  await flushMicrotasks();
  assert.deepEqual(runs, []);

  signals.emitSnapshot({ next_retry_at: null });
  clock.advance(100);
  await flushMicrotasks();
  assert.deepEqual(runs, []);

  signals.emitSnapshot({ next_retry_at: 250 });
  clock.advance(49);
  await flushMicrotasks();
  assert.deepEqual(runs, []);
  clock.advance(1);
  await flushMicrotasks();
  assert.deepEqual(runs, ["retry"]);

  controller.notifySnapshot({ next_retry_at: 300 });
  controller.stop();
  clock.advance(50);
  await flushMicrotasks();
  assert.deepEqual(runs, ["retry"]);
});

test("le contrôleur ne consulte jamais navigator.onLine", async (t) => {
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  let onlineReads = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    enumerable: true,
    value: {
      get onLine() {
        onlineReads += 1;
        throw new Error("navigator.onLine ne doit pas être consulté");
      },
    },
  });
  t.after(() => {
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  const clock = fakeTimers();
  const signals = fakeSignals();
  const runs: OfflinePreparationTrigger[] = [];
  const controller = createOfflinePreparationTriggerController({
    ...signals,
    ...clock,
    initialDelayMs: 0,
    intervalMs: 10_000,
    debounceMs: 0,
    run: async (trigger) => {
      runs.push(trigger);
      return null;
    },
  });

  controller.start();
  clock.advance(0);
  await flushMicrotasks();
  signals.emitOnline();
  clock.advance(0);
  await flushMicrotasks();

  assert.deepEqual(runs, ["initial", "online"]);
  assert.equal(onlineReads, 0);
  controller.stop();
});
