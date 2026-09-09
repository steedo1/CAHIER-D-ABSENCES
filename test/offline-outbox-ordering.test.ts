import assert from "node:assert/strict";
import test from "node:test";
import {
  cacheGet,
  cacheSet,
  clearOfflineAll,
  flushOutbox,
  offlineMutateJson,
  outboxStats,
} from "../src/lib/offline";
import {
  getTeacherAttendanceSyncStatus,
  syncTeacherAttendanceOperationsToCloud,
} from "../src/lib/teacher-attendance-cloud-sync";

type StoredValue = Record<string, any>;
type StoreDefinition = {
  keyPath: string;
  values: Map<unknown, StoredValue>;
  indexes: Map<string, string>;
};

function installFakeIndexedDb() {
  const databases = new Map<string, Map<string, StoreDefinition>>();

  class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    error: Error | null = null;
    private completionScheduled = false;

    constructor(private readonly stores: Map<string, StoreDefinition>) {}

    scheduleCompletion() {
      if (this.completionScheduled) return;
      this.completionScheduled = true;
      setTimeout(() => this.oncomplete?.(), 0);
    }

    objectStore(name: string) {
      const definition = this.stores.get(name);
      if (!definition) throw new Error(`missing fake store ${name}`);
      return fakeObjectStore(definition, this);
    }
  }

  function request<T>(value: T, transaction: FakeTransaction) {
    const result: any = {
      result: value,
      error: null,
      onsuccess: null,
      onerror: null,
    };
    queueMicrotask(() => {
      result.onsuccess?.();
      transaction.scheduleCompletion();
    });
    return result;
  }

  function fakeObjectStore(
    definition: StoreDefinition,
    transaction: FakeTransaction,
  ) {
    return {
      indexNames: {
        contains: (name: string) => definition.indexes.has(name),
      },
      createIndex(name: string, keyPath: string) {
        definition.indexes.set(name, keyPath);
      },
      get: (key: unknown) =>
        request(structuredClone(definition.values.get(key)), transaction),
      getAll: () =>
        request(
          structuredClone(Array.from(definition.values.values())),
          transaction,
        ),
      getAllKeys: () =>
        request(Array.from(definition.values.keys()), transaction),
      count: () => request(definition.values.size, transaction),
      put: (value: StoredValue) => {
        definition.values.set(
          value[definition.keyPath],
          structuredClone(value),
        );
        transaction.scheduleCompletion();
      },
      delete: (key: unknown) => {
        definition.values.delete(key);
        transaction.scheduleCompletion();
      },
      clear: () => {
        definition.values.clear();
        transaction.scheduleCompletion();
      },
      index: (name: string) => {
        const keyPath = definition.indexes.get(name);
        if (!keyPath) throw new Error(`missing fake index ${name}`);
        return {
          getAll: (key: unknown) =>
            request(
              structuredClone(
                Array.from(definition.values.values()).filter(
                  (value) => value[keyPath] === key,
                ),
              ),
              transaction,
            ),
        };
      },
    };
  }

  const fakeIndexedDb = {
    deleteDatabase(name: string) {
      databases.delete(name);
      const result: any = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => result.onsuccess?.());
      return result;
    },
    open(name: string) {
      const stores =
        databases.get(name) || new Map<string, StoreDefinition>();
      databases.set(name, stores);
      const upgradeTransaction = new FakeTransaction(stores);
      const result: any = {
        result: null,
        error: null,
        transaction: upgradeTransaction,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      const db = {
        objectStoreNames: {
          contains: (storeName: string) => stores.has(storeName),
        },
        createObjectStore(
          storeName: string,
          options: { keyPath?: string } = {},
        ) {
          const definition: StoreDefinition = {
            keyPath: options.keyPath || "id",
            values: new Map(),
            indexes: new Map(),
          };
          stores.set(storeName, definition);
          return fakeObjectStore(definition, upgradeTransaction);
        },
        transaction() {
          return new FakeTransaction(stores);
        },
        close() {},
      };
      result.result = db;
      setTimeout(() => {
        result.onupgradeneeded?.();
        result.onsuccess?.();
      }, 0);
      return result;
    },
  };

  const previousWindow = (globalThis as any).window;
  const previousIndexedDb = (globalThis as any).indexedDB;
  (globalThis as any).window = globalThis;
  (globalThis as any).indexedDB = fakeIndexedDb;
  return () => {
    (globalThis as any).window = previousWindow;
    (globalThis as any).indexedDB = previousIndexedDb;
  };
}

test("une présence bloquée empêche seulement la fermeture du même cours", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const previousFetch = globalThis.fetch;
  const called: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const path = String(url);
    called.push(path);
    if (path.includes("attendance/bulk")) {
      return new Response(JSON.stringify({ error: "invalid_marks" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    const operationId = path.includes("course-b") ? "open-b" : "open-a";
    return new Response(
      JSON.stringify({
        item: {
          id: `server-${operationId}`,
          operation_id: operationId,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const clientA = "client:open-a";
    await offlineMutateJson(
      "/api/class/sessions/start?course-a",
      { method: "POST", body: { client_session_id: clientA } },
      {
        operationId: "open-a",
        queueOnly: true,
        meta: { operationType: "session-start", clientSessionId: clientA },
      },
    );
    await offlineMutateJson(
      "/api/teacher/attendance/bulk",
      { method: "POST", body: { session_id: clientA, marks: [] } },
      {
        operationId: "attendance-a",
        queueOnly: true,
        meta: { operationType: "attendance", clientSessionId: clientA },
      },
    );
    await offlineMutateJson(
      "/api/class/sessions/end",
      { method: "PATCH", body: { session_id: clientA } },
      {
        operationId: "close-a",
        queueOnly: true,
        meta: { operationType: "session-end", clientSessionId: clientA },
      },
    );
    const clientB = "client:open-b";
    await offlineMutateJson(
      "/api/class/sessions/start?course-b",
      { method: "POST", body: { client_session_id: clientB } },
      {
        operationId: "open-b",
        queueOnly: true,
        meta: { operationType: "session-start", clientSessionId: clientB },
      },
    );

    const result = await flushOutbox();
    assert.deepEqual(called, [
      "/api/class/sessions/start?course-a",
      "/api/teacher/attendance/bulk",
      "/api/class/sessions/start?course-b",
    ]);
    assert.equal(result.flushed, 2);
    assert.equal(result.blocked, 1);
    assert.equal(result.remaining, 2);
    assert.equal(result.acknowledged.length, 2);
    assert.equal(result.lastError, "invalid_marks");
    assert.equal(result.lastStatus, 409);
    assert.deepEqual(await outboxStats(), {
      total: 2,
      pending: 1,
      blocked: 1,
      lastError: "queued_by_client",
      lastStatus: null,
    });
  } finally {
    globalThis.fetch = previousFetch;
    restoreIndexedDb();
  }
});


test("un accusé Cloud avec un autre operation_id est bloqué", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        item: { id: "server-wrong", operation_id: "another-operation" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  try {
    await clearOfflineAll();
    const clientSessionId = "client:expected-operation";
    await offlineMutateJson(
      "/api/class/sessions/start",
      { method: "POST", body: { client_session_id: clientSessionId } },
      {
        operationId: "expected-operation",
        queueOnly: true,
        meta: { operationType: "session-start", clientSessionId },
      },
    );

    const result = await flushOutbox();
    assert.equal(result.flushed, 0);
    assert.equal(result.remaining, 1);
    assert.equal(result.blocked, 1);
    assert.equal(result.lastError, "offline_operation_id_mismatch");
    assert.equal(result.lastStatus, 409);
  } finally {
    globalThis.fetch = previousFetch;
    restoreIndexedDb();
  }
});

test("un succès immédiat sans le même operation_id reste dans la file locale", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        operation_id: "unexpected-operation",
        session_id: "server-session",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  try {
    await clearOfflineAll();
    const result = await offlineMutateJson(
      "/api/teacher/attendance/bulk",
      {
        method: "POST",
        body: { session_id: "server-session", marks: [] },
      },
      {
        operationId: "expected-attendance-operation",
        meta: {
          operationType: "attendance",
          clientSessionId: "client:open-a",
        },
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.queued, true);
    assert.equal(result.error, "offline_operation_id_mismatch");
    assert.deepEqual(await outboxStats(), {
      total: 1,
      pending: 1,
      blocked: 0,
      lastError: "offline_operation_id_mismatch",
      lastStatus: 409,
    });
  } finally {
    globalThis.fetch = previousFetch;
    restoreIndexedDb();
  }
});

test("le compteur reprend exactement 9 → 5 puis 4 → 0 après une coupure", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const previousFetch = globalThis.fetch;
  let networkAvailable = true;
  const calls: string[] = [];
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const operationId = new Headers(init?.headers).get(
      "X-Mon-Cahier-Operation-Id",
    ) || "";
    calls.push(operationId);
    if (!networkAvailable) throw new DOMException("network_lost", "AbortError");
    return new Response(
      JSON.stringify({
        operation_id: operationId,
        item: { id: `server-${operationId}` },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await clearOfflineAll();
    for (let index = 1; index <= 9; index += 1) {
      const operationId = `counter-operation-${index}`;
      await offlineMutateJson(
        `/api/teacher/sessions/start?counter=${index}`,
        {
          method: "POST",
          body: { client_session_id: operationId },
        },
        {
          operationId,
          queueOnly: true,
          meta: {
            operationType: "session-start",
            clientSessionId: operationId,
          },
        },
      );
    }

    const counts = [(await outboxStats()).total];
    for (let index = 0; index < 4; index += 1) {
      const result = await flushOutbox({ maxAcknowledgements: 1 });
      assert.equal(result.flushed, 1);
      counts.push((await outboxStats()).total);
    }
    assert.deepEqual(counts, [9, 8, 7, 6, 5]);

    networkAvailable = false;
    const interrupted = await flushOutbox({
      maxAcknowledgements: 1,
      releaseNetworkBackoff: true,
    });
    assert.equal(interrupted.flushed, 0);
    assert.equal(interrupted.retryableFailure, true);
    assert.equal(interrupted.lastStatus, 0);
    assert.equal((await outboxStats()).total, 5);

    networkAvailable = true;
    const resumedCounts: number[] = [];
    while ((await outboxStats()).total > 0) {
      const result = await flushOutbox({
        maxAcknowledgements: 1,
        releaseNetworkBackoff: true,
      });
      assert.equal(result.flushed, 1);
      resumedCounts.push((await outboxStats()).total);
    }
    assert.deepEqual(resumedCounts, [4, 3, 2, 1, 0]);
    assert.equal(calls.length, 10);
    assert.equal(calls[4], calls[5]);
  } finally {
    globalThis.fetch = previousFetch;
    restoreIndexedDb();
  }
});

test("un timeout après application rejoue le même operation_id sans doublon", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const previousFetch = globalThis.fetch;
  const received: string[] = [];
  const applied = new Set<string>();
  let loseFirstResponse = true;
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const operationId = new Headers(init?.headers).get(
      "X-Mon-Cahier-Operation-Id",
    ) || "";
    received.push(operationId);
    applied.add(operationId);
    if (loseFirstResponse) {
      loseFirstResponse = false;
      throw new DOMException("request_timeout", "TimeoutError");
    }
    return new Response(JSON.stringify({ operation_id: operationId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await clearOfflineAll();
    await offlineMutateJson(
      "/api/teacher/attendance/bulk",
      {
        method: "POST",
        body: {
          session_id: "server-session",
          captured_at_device: "2026-09-09T08:00:00.000Z",
          marks: [],
        },
      },
      {
        operationId: "attendance-idempotent-operation",
        queueOnly: true,
        meta: { operationType: "attendance" },
      },
    );

    const first = await flushOutbox();
    assert.equal(first.remaining, 1);
    assert.equal(first.lastStatus, 0);
    const replay = await flushOutbox({ releaseNetworkBackoff: true });
    assert.equal(replay.flushed, 1);
    assert.equal(replay.remaining, 0);
    assert.deepEqual(received, [
      "attendance-idempotent-operation",
      "attendance-idempotent-operation",
    ]);
    assert.equal(applied.size, 1);
  } finally {
    globalThis.fetch = previousFetch;
    restoreIndexedDb();
  }
});

test("un HTTP 200 incomplet ne supprime jamais l'appel local", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true, applied: 3 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  try {
    await clearOfflineAll();
    await offlineMutateJson(
      "/api/teacher/attendance/bulk",
      { method: "POST", body: { session_id: "server-session", marks: [] } },
      {
        operationId: "attendance-missing-ack-operation",
        queueOnly: true,
        meta: { operationType: "attendance" },
      },
    );
    const result = await flushOutbox();
    assert.equal(result.flushed, 0);
    assert.equal(result.remaining, 1);
    assert.equal(result.blocked, 1);
    assert.equal(result.lastError, "offline_operation_id_missing");
  } finally {
    globalThis.fetch = previousFetch;
    restoreIndexedDb();
  }
});

for (const scenario of [
  {
    name: "401 conserve l'action et réclame une authentification",
    status: 401,
    expectedState: "pending",
    authRequired: true,
    retryableFailure: false,
  },
  {
    name: "422 bloque explicitement sans supprimer",
    status: 422,
    expectedState: "blocked",
    authRequired: false,
    retryableFailure: false,
  },
  {
    name: "503 conserve l'action pour le backoff",
    status: 503,
    expectedState: "pending",
    authRequired: false,
    retryableFailure: true,
  },
]) {
  test(scenario.name, async () => {
    const restoreIndexedDb = installFakeIndexedDb();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: `http_${scenario.status}` }), {
        status: scenario.status,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    try {
      await clearOfflineAll();
      await offlineMutateJson(
        "/api/teacher/attendance/bulk",
        { method: "POST", body: { session_id: "server-session", marks: [] } },
        {
          operationId: `attendance-http-${scenario.status}`,
          queueOnly: true,
          meta: { operationType: "attendance" },
        },
      );
      const result = await flushOutbox();
      const stats = await outboxStats();
      assert.equal(result.flushed, 0);
      assert.equal(result.remaining, 1);
      assert.equal(result.authRequired, scenario.authRequired);
      assert.equal(result.retryableFailure, scenario.retryableFailure);
      assert.equal(stats.pending, scenario.expectedState === "pending" ? 1 : 0);
      assert.equal(stats.blocked, scenario.expectedState === "blocked" ? 1 : 0);
    } finally {
      globalThis.fetch = previousFetch;
      restoreIndexedDb();
    }
  });
}

test("présent, absent, retard, commentaire et horodatage traversent le rejeu inchangés", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const previousFetch = globalThis.fetch;
  let receivedBody: any = null;
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    receivedBody = JSON.parse(String(init?.body || "{}"));
    const operationId = new Headers(init?.headers).get(
      "X-Mon-Cahier-Operation-Id",
    );
    return new Response(JSON.stringify({ operation_id: operationId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const marks = [
    { student_id: "student-present", status: "present", reason: null, observed_at: null },
    { student_id: "student-absent", status: "absent", reason: "Malade", observed_at: null },
    {
      student_id: "student-late",
      status: "late",
      reason: "Transport",
      observed_at: "2026-09-09T08:17:00.000Z",
    },
  ];
  try {
    await clearOfflineAll();
    await offlineMutateJson(
      "/api/teacher/attendance/bulk",
      {
        method: "POST",
        body: {
          session_id: "server-session",
          captured_at_device: "2026-09-09T08:18:00.000Z",
          marks,
        },
      },
      {
        operationId: "attendance-semantic-operation",
        queueOnly: true,
        meta: { operationType: "attendance" },
      },
    );
    assert.equal((await flushOutbox()).flushed, 1);
    assert.deepEqual(receivedBody, {
      session_id: "server-session",
      captured_at_device: "2026-09-09T08:18:00.000Z",
      marks,
    });
  } finally {
    globalThis.fetch = previousFetch;
    restoreIndexedDb();
  }
});

test("les anciens journaux PWA sont matérialisés puis ACKés dans l'ordre complet", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const previousFetch = globalThis.fetch;
  const order: string[] = [];
  const attemptKey =
    "class-a_subject-a_2026-09-09T08:00:00.000Z";
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const path = String(url);
    if (path === "/api/auth/role") {
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const operationId = new Headers(init?.headers).get(
      "X-Mon-Cahier-Operation-Id",
    ) || "";
    const body = JSON.parse(String(init?.body || "{}"));
    if (path.includes("sessions/start")) {
      order.push("start");
      assert.equal(body.client_session_id, attemptKey);
      return new Response(JSON.stringify({
        operation_id: operationId,
        item: { id: "server-session-a" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path.includes("attendance/bulk")) {
      order.push("attendance");
      assert.equal(body.session_id, "server-session-a");
      return new Response(JSON.stringify({
        operation_id: operationId,
        session_id: "server-session-a",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    order.push("end");
    assert.equal(body.session_id, "server-session-a");
    return new Response(JSON.stringify({
      operation_id: operationId,
      item: { id: "server-session-a" },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await clearOfflineAll();
    await cacheSet("teacher:inst:basics", { institution_id: "school-a" });
    await cacheSet("teacher:attendance-delivery:v1:institutions", ["school-a"]);
    await cacheSet("teacher:session-delivery:v1:school-a", [{
      schema_version: 1,
      institution_id: "school-a",
      operation_id: "durable-start-operation",
      class_id: "class-a",
      period_id: "period-a",
      attempt_key: attemptKey,
      content_key: "start-content",
      state: "device_pending",
      session_id: null,
      subject_id: null,
      started_at: null,
      actual_call_at: null,
      scheduled_end_at: null,
      grace_expires_at: null,
      relay_time: null,
      session_state: null,
      created_at: "2026-09-09T08:02:00.000Z",
      updated_at: "2026-09-09T08:02:00.000Z",
      relay_attempted_at: null,
      last_status: 0,
      last_error: "relay_configuration_missing",
      requires_authentication: false,
    }]);
    await cacheSet("teacher:attendance-delivery:v1:school-a", [{
      schema_version: 1,
      institution_id: "school-a",
      operation_id: "durable-attendance-operation",
      session_reference: `client:${attemptKey}`,
      session_id: `client:${attemptKey}`,
      class_id: "class-a",
      period_id: "period-a",
      marks: [{
        student_id: "student-a",
        status: "late",
        comment: "Transport",
        observed_at: "2026-09-09T08:17:00.000Z",
      }],
      content_key: "attendance-content",
      state: "device_pending",
      channel: null,
      captured_at_device: "2026-09-09T08:18:00.000Z",
      created_at: "2026-09-09T08:18:00.000Z",
      updated_at: "2026-09-09T08:18:00.000Z",
      cloud_attempted_at: null,
      relay_attempted_at: null,
      last_status: 0,
      last_error: null,
      requires_authentication: false,
    }]);
    await offlineMutateJson(
      "/api/teacher/sessions/end",
      {
        method: "PATCH",
        body: {
          client_session_id: attemptKey,
          actual_end_at: "2026-09-09T09:00:00.000Z",
        },
      },
      {
        operationId: "durable-close-operation",
        queueOnly: true,
        meta: {
          operationType: "session-end",
          clientSessionId: attemptKey,
          institutionId: "school-a",
          classId: "class-a",
        },
      },
    );

    assert.equal((await getTeacherAttendanceSyncStatus("school-a")).total, 3);
    const result = await syncTeacherAttendanceOperationsToCloud("school-a");
    assert.deepEqual(order, ["start", "attendance", "end"]);
    assert.equal(result.flushed, 3);
    assert.equal(result.remaining, 0);
    assert.equal((await getTeacherAttendanceSyncStatus("school-a")).total, 0);
    assert.equal(
      (await cacheGet<any[]>("teacher:attendance-delivery:v1:school-a"))?.[0]?.state,
      "cloud_synced",
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreIndexedDb();
  }
});

test("école sans Relais : trois appels PWA se synchronisent seuls en 9 ACK ordonnés", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const previousFetch = globalThis.fetch;
  const order: string[] = [];
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const path = String(url);
    if (path === "/api/auth/role") {
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const operationId = new Headers(init?.headers).get(
      "X-Mon-Cahier-Operation-Id",
    ) || "";
    const body = JSON.parse(String(init?.body || "{}"));
    if (path.includes("sessions/start")) {
      order.push(`start:${body.client_session_id}`);
      return new Response(JSON.stringify({
        operation_id: operationId,
        item: { id: `server-${body.client_session_id}` },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path.includes("attendance/bulk")) {
      order.push(`attendance:${body.session_id}`);
    } else {
      order.push(`end:${body.session_id}`);
    }
    return new Response(JSON.stringify({
      operation_id: operationId,
      session_id: body.session_id,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await clearOfflineAll();
    await cacheSet("teacher:inst:basics", { institution_id: "pwa-only-school" });
    for (let index = 1; index <= 3; index += 1) {
      const clientId = `pwa-course-${index}`;
      const meta = {
        clientSessionId: clientId,
        institutionId: "pwa-only-school",
        classId: `class-${index}`,
      };
      await offlineMutateJson(
        "/api/teacher/sessions/start",
        { method: "POST", body: { client_session_id: clientId } },
        {
          operationId: `pwa-start-operation-${index}`,
          queueOnly: true,
          meta: { ...meta, operationType: "session-start" },
        },
      );
      await offlineMutateJson(
        "/api/teacher/attendance/bulk",
        {
          method: "POST",
          body: { session_id: `client:${clientId}`, marks: [] },
        },
        {
          operationId: `pwa-attendance-operation-${index}`,
          queueOnly: true,
          meta: { ...meta, operationType: "attendance" },
        },
      );
      await offlineMutateJson(
        "/api/teacher/sessions/end",
        { method: "PATCH", body: { client_session_id: clientId } },
        {
          operationId: `pwa-end-operation-${index}`,
          queueOnly: true,
          meta: { ...meta, operationType: "session-end" },
        },
      );
    }

    assert.equal((await getTeacherAttendanceSyncStatus("pwa-only-school")).total, 9);
    const result = await syncTeacherAttendanceOperationsToCloud("pwa-only-school");
    assert.equal(result.flushed, 9);
    assert.equal(result.remaining, 0);
    assert.deepEqual(order, [
      "start:pwa-course-1",
      "start:pwa-course-2",
      "start:pwa-course-3",
      "attendance:server-pwa-course-1",
      "attendance:server-pwa-course-2",
      "attendance:server-pwa-course-3",
      "end:server-pwa-course-1",
      "end:server-pwa-course-2",
      "end:server-pwa-course-3",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    restoreIndexedDb();
  }
});
