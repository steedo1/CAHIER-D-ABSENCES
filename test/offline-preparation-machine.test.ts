import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfflinePreparationMachine,
  type OfflinePreparationDecision,
  type OfflinePreparationSnapshot,
} from "../src/lib/offline-preparation-machine.ts";

type Readiness = {
  revision: number;
  source: "cloud" | "relay" | "device";
  worker_release?: string;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function distinctStates(
  snapshots: Array<OfflinePreparationSnapshot<Readiness>>,
) {
  return snapshots
    .map((snapshot) => snapshot.state)
    .filter((state, index, values) => index === 0 || values[index - 1] !== state);
}

function fakeClock(initial = 0) {
  let current = initial;
  let nextId = 1;
  const scheduled = new Map<
    number,
    { at: number; callback: (...args: unknown[]) => void }
  >();

  const setTimeoutFake = ((
    callback: (...args: unknown[]) => void,
    delay = 0,
  ) => {
    const id = nextId++;
    scheduled.set(id, {
      at: current + Math.max(0, Number(delay) || 0),
      callback,
    });
    return id;
  }) as unknown as typeof globalThis.setTimeout;

  const clearTimeoutFake = ((id: number) => {
    scheduled.delete(Number(id));
  }) as unknown as typeof globalThis.clearTimeout;

  function advance(milliseconds: number) {
    current += milliseconds;
    while (true) {
      const due = Array.from(scheduled.entries())
        .filter(([, task]) => task.at <= current)
        .sort((left, right) => left[1].at - right[1].at);
      if (due.length === 0) break;
      for (const [id, task] of due) {
        if (!scheduled.delete(id)) continue;
        task.callback();
      }
    }
  }

  return {
    now: () => current,
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    advance,
    scheduledCount: () => scheduled.size,
  };
}

test("la machine traverse checking puis preparing_core et termine ready", async () => {
  const check = deferred<OfflinePreparationDecision<Readiness>>();
  const preparation = deferred<Readiness>();
  const states: Array<OfflinePreparationSnapshot<Readiness>> = [];
  let reportProgress: ((message: string) => void) | null = null;

  const machine = createOfflinePreparationMachine<Readiness>({
    minimumCheckIntervalMs: 0,
    check: async () => check.promise,
    prepare: async (_role, context) => {
      reportProgress = context.onProgress;
      return preparation.promise;
    },
    onState: (snapshot) => states.push(snapshot),
  });

  assert.equal(machine.getSnapshot("teacher").state, "idle");
  const running = machine.run("teacher", { trigger: "initial" });
  await flushMicrotasks();
  assert.equal(machine.getSnapshot("teacher").state, "checking");

  check.resolve({ state: "prepare_core", readiness: null });
  await flushMicrotasks();
  assert.equal(machine.getSnapshot("teacher").state, "preparing_core");

  const emitProgress = reportProgress as unknown as (message: string) => void;
  assert.equal(typeof emitProgress, "function");
  emitProgress("Listes d’élèves 1/2…");
  assert.equal(
    machine.getSnapshot("teacher").progress,
    "Listes d’élèves 1/2…",
  );

  preparation.resolve({ revision: 7, source: "cloud" });
  const result = await running;

  assert.equal(result.attempted, true);
  assert.equal(result.prepared, true);
  assert.equal(result.snapshot.state, "ready");
  assert.equal(result.snapshot.preparation_performed, true);
  assert.equal(result.snapshot.error, null);
  assert.deepEqual(distinctStates(states), [
    "checking",
    "preparing_core",
    "ready",
  ]);
});

test("les décisions Cloud seul, relais seul et double panne restent bornées", async (t) => {
  const scenarios: Array<{
    name: string;
    decision: OfflinePreparationDecision<Readiness>;
    prepared: boolean;
    expectedState: "ready" | "ready_local";
  }> = [
    {
      name: "Cloud seul prépare le cœur puis devient prêt",
      decision: { state: "prepare_core", readiness: null },
      prepared: true,
      expectedState: "ready",
    },
    {
      name: "relais seul conserve la préparation locale valide",
      decision: {
        state: "ready_local",
        readiness: { revision: 8, source: "relay" },
      },
      prepared: false,
      expectedState: "ready_local",
    },
    {
      name: "Cloud et relais absents conservent le cache préparé",
      decision: {
        state: "ready_local",
        readiness: { revision: 8, source: "device" },
      },
      prepared: false,
      expectedState: "ready_local",
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      let fullPreparations = 0;
      const machine = createOfflinePreparationMachine<Readiness>({
        minimumCheckIntervalMs: 0,
        check: async () => scenario.decision,
        prepare: async () => {
          fullPreparations += 1;
          return { revision: 8, source: "cloud" };
        },
      });

      const result = await machine.run("teacher", { trigger: "initial" });
      assert.equal(result.snapshot.state, scenario.expectedState);
      assert.equal(result.prepared, scenario.prepared);
      assert.equal(fullPreparations, scenario.prepared ? 1 : 0);
    });
  }
});

test("une préparation déjà valide ne déclenche aucun téléchargement complet", async () => {
  let checks = 0;
  let fullPreparations = 0;
  const stored: Readiness = { revision: 12, source: "device" };
  const machine = createOfflinePreparationMachine<Readiness>({
    minimumCheckIntervalMs: 0,
    check: async () => {
      checks += 1;
      return { state: "ready", readiness: stored };
    },
    prepare: async () => {
      fullPreparations += 1;
      return stored;
    },
  });

  const initial = await machine.run("teacher", { trigger: "initial" });
  const focus = await machine.run("teacher", { trigger: "focus" });
  const online = await machine.run("teacher", { trigger: "online" });

  assert.equal(initial.prepared, false);
  assert.equal(focus.prepared, false);
  assert.equal(online.prepared, false);
  assert.equal(checks, 3);
  assert.equal(fullPreparations, 0);
});

test("le single-flight est atomique même lorsque le check est suspendu", async () => {
  const suspendedCheck = deferred<OfflinePreparationDecision<Readiness>>();
  let checkCalls = 0;
  let prepareCalls = 0;
  const machine = createOfflinePreparationMachine<Readiness>({
    minimumCheckIntervalMs: 0,
    check: async () => {
      checkCalls += 1;
      return suspendedCheck.promise;
    },
    prepare: async () => {
      prepareCalls += 1;
      return { revision: 1, source: "cloud" };
    },
  });

  const first = machine.run("teacher", { trigger: "focus" });
  const second = machine.run("teacher", { trigger: "online" });
  assert.strictEqual(second, first);

  await flushMicrotasks();
  assert.equal(checkCalls, 1);
  assert.equal(machine.getSnapshot("teacher").state, "checking");

  suspendedCheck.resolve({
    state: "ready",
    readiness: { revision: 1, source: "device" },
  });
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.strictEqual(firstResult, secondResult);
  assert.equal(prepareCalls, 0);
  assert.equal(firstResult.snapshot.state, "ready");
});

test("les rôles possèdent des verrous et des états indépendants", async () => {
  const checks = new Map<
    string,
    ReturnType<typeof deferred<OfflinePreparationDecision<Readiness>>>
  >();
  const machine = createOfflinePreparationMachine<Readiness>({
    minimumCheckIntervalMs: 0,
    check: async (role) => {
      const pending = deferred<OfflinePreparationDecision<Readiness>>();
      checks.set(role, pending);
      return pending.promise;
    },
    prepare: async () => ({ revision: 1, source: "cloud" }),
  });

  const teacher = machine.run("teacher", { trigger: "initial" });
  const classDevice = machine.run("class-device", { trigger: "initial" });
  assert.notStrictEqual(teacher, classDevice);
  await flushMicrotasks();

  assert.equal(machine.getSnapshot("teacher").state, "checking");
  assert.equal(machine.getSnapshot("class-device").state, "checking");
  checks.get("teacher")?.resolve({
    state: "ready",
    readiness: { revision: 2, source: "cloud" },
  });
  const teacherResult = await teacher;
  assert.equal(teacherResult.snapshot.state, "ready");
  assert.equal(machine.getSnapshot("class-device").state, "checking");

  checks.get("class-device")?.resolve({
    state: "ready_local",
    readiness: { revision: 2, source: "device" },
  });
  const classResult = await classDevice;
  assert.equal(classResult.snapshot.state, "ready_local");
  assert.equal(machine.getSnapshot("teacher").state, "ready");
});

test("le timeout d’une préparation infinie libère le verrou", async () => {
  const clock = fakeClock();
  let shouldHang = true;
  let prepareCalls = 0;
  const preparationSignals: AbortSignal[] = [];
  const machine = createOfflinePreparationMachine<Readiness>({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    timeoutMs: 50,
    minimumCheckIntervalMs: 0,
    retryDelaysMs: [1_000],
    check: async () => ({ state: "prepare_core", readiness: null }),
    prepare: async (_role, context) => {
      prepareCalls += 1;
      preparationSignals.push(context.signal);
      if (shouldHang) return new Promise<Readiness>(() => undefined);
      return { revision: 3, source: "cloud" };
    },
  });

  const first = machine.run("teacher", { trigger: "initial" });
  await flushMicrotasks();
  assert.equal(machine.getSnapshot("teacher").state, "preparing_core");
  assert.equal(clock.scheduledCount(), 1);

  clock.advance(50);
  const timedOut = await first;
  assert.equal(timedOut.snapshot.state, "retry_wait");
  assert.match(String(timedOut.snapshot.error), /délai maximal/i);
  assert.equal(preparationSignals[0]?.aborted, true);

  shouldHang = false;
  const second = machine.run("teacher", { trigger: "manual" });
  assert.notStrictEqual(second, first);
  const recovered = await second;
  assert.equal(recovered.snapshot.state, "ready");
  assert.equal(recovered.prepared, true);
  assert.equal(prepareCalls, 2);
  assert.equal(clock.scheduledCount(), 0);
});

test("le backoff bloque les signaux automatiques jusqu’à son échéance", async () => {
  const clock = fakeClock();
  let checkCalls = 0;
  const machine = createOfflinePreparationMachine<Readiness>({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    timeoutMs: 10_000,
    minimumCheckIntervalMs: 0,
    retryDelaysMs: [100, 500],
    check: async () => {
      checkCalls += 1;
      if (checkCalls === 1) throw new Error("cloud_unreachable");
      return {
        state: "ready_local",
        readiness: { revision: 5, source: "device" },
      };
    },
    prepare: async () => ({ revision: 5, source: "cloud" }),
  });

  const failed = await machine.run("teacher", { trigger: "initial" });
  assert.equal(failed.snapshot.state, "retry_wait");
  assert.equal(failed.snapshot.next_retry_at, 100);

  const immediate = await machine.run("teacher", { trigger: "online" });
  assert.equal(immediate.attempted, false);
  clock.advance(99);
  const tooEarly = await machine.run("teacher", { trigger: "focus" });
  assert.equal(tooEarly.attempted, false);
  assert.equal(checkCalls, 1);

  clock.advance(1);
  const retry = await machine.run("teacher", { trigger: "retry" });
  assert.equal(retry.attempted, true);
  assert.equal(retry.snapshot.state, "ready_local");
  assert.equal(checkCalls, 2);
});

test("une demande manuelle force le contrôle pendant le backoff", async () => {
  const clock = fakeClock();
  let checkCalls = 0;
  const machine = createOfflinePreparationMachine<Readiness>({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    timeoutMs: 10_000,
    minimumCheckIntervalMs: 60_000,
    retryDelaysMs: [30_000],
    check: async () => {
      checkCalls += 1;
      if (checkCalls === 1) throw new Error("temporary_failure");
      return {
        state: "ready",
        readiness: { revision: 6, source: "cloud" },
      };
    },
    prepare: async () => ({ revision: 6, source: "cloud" }),
  });

  const failed = await machine.run("teacher", { trigger: "initial" });
  assert.equal(failed.snapshot.state, "retry_wait");
  const manual = await machine.run("teacher", { trigger: "manual" });

  assert.equal(manual.attempted, true);
  assert.equal(manual.snapshot.state, "ready");
  assert.equal(manual.snapshot.trigger, "manual");
  assert.equal(checkCalls, 2);
});

test("une erreur non réparatrice ne lance ni préparation ni retry automatique", async () => {
  let prepareCalls = 0;
  const machine = createOfflinePreparationMachine<Readiness>({
    minimumCheckIntervalMs: 60_000,
    check: async () => ({
      state: "error",
      readiness: null,
      message: "Aucune affectation de classe autorisée.",
    }),
    prepare: async () => {
      prepareCalls += 1;
      return { revision: 1, source: "cloud" };
    },
  });

  const result = await machine.run("teacher", { trigger: "initial" });
  assert.equal(result.snapshot.state, "error");
  assert.equal(result.snapshot.next_retry_at, null);
  assert.equal(result.snapshot.error, "Aucune affectation de classe autorisée.");
  assert.equal(prepareCalls, 0);

  const noisyOnlineSignal = await machine.run("teacher", { trigger: "online" });
  assert.equal(noisyOnlineSignal.attempted, false);
  assert.equal(prepareCalls, 0);
});

test("une classification non réparatrice après téléchargement reste en erreur", async () => {
  const machine = createOfflinePreparationMachine<Readiness>({
    minimumCheckIntervalMs: 0,
    check: async () => ({ state: "prepare_core", readiness: null }),
    prepare: async () => ({ revision: 9, source: "cloud" }),
    classifyPrepared: async (_role, readiness) => ({
      state: "error",
      readiness,
      message: "Le service worker actif reste incompatible.",
    }),
  });

  const result = await machine.run("teacher", { trigger: "initial" });
  assert.equal(result.prepared, true);
  assert.equal(result.snapshot.state, "error");
  assert.equal(result.snapshot.next_retry_at, null);
  assert.equal(result.snapshot.error, "Le service worker actif reste incompatible.");
});

test("un service worker obsolète puis prêt provoque une seule préparation", async () => {
  const expectedRelease = "worker-v2";
  let activeRelease = "worker-v1";
  let checks = 0;
  let fullPreparations = 0;
  const states: Array<OfflinePreparationSnapshot<Readiness>> = [];
  const machine = createOfflinePreparationMachine<Readiness>({
    minimumCheckIntervalMs: 0,
    check: async () => {
      checks += 1;
      if (activeRelease !== expectedRelease) {
        return {
          state: "prepare_core",
          readiness: {
            revision: 11,
            source: "device",
            worker_release: activeRelease,
          },
          message: "Service worker obsolète.",
        };
      }
      return {
        state: "ready",
        readiness: {
          revision: 11,
          source: "device",
          worker_release: activeRelease,
        },
      };
    },
    prepare: async () => {
      fullPreparations += 1;
      activeRelease = expectedRelease;
      return {
        revision: 11,
        source: "cloud",
        worker_release: activeRelease,
      };
    },
    classifyPrepared: async (_role, readiness) => ({
      state: activeRelease === expectedRelease ? "ready" : "error",
      readiness,
    }),
    onState: (snapshot) => states.push(snapshot),
  });

  const refreshed = await machine.run("teacher", { trigger: "initial" });
  const subsequentFocus = await machine.run("teacher", { trigger: "focus" });
  const subsequentOnline = await machine.run("teacher", { trigger: "online" });

  assert.equal(refreshed.snapshot.state, "ready");
  assert.equal(subsequentFocus.snapshot.state, "ready");
  assert.equal(subsequentOnline.snapshot.state, "ready");
  assert.equal(fullPreparations, 1);
  assert.equal(checks, 3);
  assert.equal(
    states.filter((snapshot) => snapshot.state === "preparing_core").length,
    1,
  );
});
