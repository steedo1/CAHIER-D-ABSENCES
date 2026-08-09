import assert from "node:assert/strict";
import test from "node:test";
import {
  clearOfflineAll,
  flushOutbox,
  offlineMutateJson,
  outboxStats,
} from "../src/lib/offline";

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
