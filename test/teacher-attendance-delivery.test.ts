import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createIndexedDbTeacherAttendanceStore,
  deliverTeacherAttendanceWithDependencies,
  stageTeacherAttendanceDraftWithDependencies,
  teacherAttendanceDeliveryMessage,
  type DeliverTeacherAttendanceInput,
  type TeacherAttendanceDeliveryDependencies,
  type TeacherAttendanceDeliveryRecord,
  type TeacherAttendanceOperationStore,
} from "../src/lib/teacher-attendance-delivery";

class TestIndexedDbStore implements TeacherAttendanceOperationStore {
  private readonly rows = new Map<string, TeacherAttendanceDeliveryRecord[]>();

  async list(institutionId: string) {
    return structuredClone(this.rows.get(institutionId) || []);
  }

  async put(record: TeacherAttendanceDeliveryRecord) {
    const rows = this.rows.get(record.institution_id) || [];
    const index = rows.findIndex((row) => row.operation_id === record.operation_id);
    if (index >= 0) rows[index] = structuredClone(record);
    else rows.push(structuredClone(record));
    this.rows.set(record.institution_id, rows);
  }
}

type Scenario = {
  cloudAvailable?: boolean;
  operationId?: string;
  cloud?: TeacherAttendanceDeliveryDependencies["postCloud"];
  proof?: TeacherAttendanceDeliveryDependencies["requestPresenceProof"];
  relay?: TeacherAttendanceDeliveryDependencies["postRelay"];
  findLegacy?: TeacherAttendanceDeliveryDependencies["findLegacy"];
  removeLegacy?: TeacherAttendanceDeliveryDependencies["removeLegacy"];
};

function input(overrides: Partial<DeliverTeacherAttendanceInput> = {}): DeliverTeacherAttendanceInput {
  return {
    institutionId: "school-a",
    actorProfileId: "teacher-a",
    sessionReference: "session-a",
    serverSessionId: "session-a",
    classId: "class-a",
    periodId: "period-a",
    marks: [
      { student_id: "student-b", status: "late", comment: "2 min" },
      { student_id: "student-a", status: "absent", comment: null },
    ],
    relayBaseUrl: "http://192.168.1.2:4317",
    relayAccessToken: "signed-teacher-token",
    ...overrides,
  };
}

function scenario(
  store: TeacherAttendanceOperationStore,
  options: Scenario = {},
) {
  let sequence = 0;
  const deps: TeacherAttendanceDeliveryDependencies = {
    store,
    now: () => new Date("2026-07-22T10:00:00.000Z"),
    createOperationId: () => options.operationId || `operation-${++sequence}`,
    cloudManifestAvailable: async () => options.cloudAvailable ?? false,
    postCloud: options.cloud || (async ({ operationId }) => ({
      ok: true,
      status: 200,
      body: { ok: true, operation_id: operationId },
    })),
    requestPresenceProof: options.proof || (async () => ({
      proof: "valid-presence-proof",
      expires_at: "2026-07-23T10:03:00.000Z",
    })),
    postRelay: options.relay || (async ({ payload }) => ({
      ok: true,
      status: 202,
      body: {
        ok: true,
        operation_id: payload.operation_id,
        state: "secured_on_relay",
      },
    })),
    findLegacy: options.findLegacy,
    removeLegacy: options.removeLegacy,
  };
  return deps;
}

test("1 - operation_id reste stable pour une même opération", async () => {
  const store = new TestIndexedDbStore();
  const deps = scenario(store, {
    operationId: "stable-operation",
    relay: async () => ({
      ok: false,
      status: 503,
      body: { error: "teacher_attendance_writes_disabled" },
    }),
  });
  const first = await deliverTeacherAttendanceWithDependencies(input(), deps);
  const second = await deliverTeacherAttendanceWithDependencies(input(), deps);
  assert.equal(first.operation_id, "stable-operation");
  assert.equal(second.operation_id, first.operation_id);
});

test("2 - l'opération est conservée après rechargement", async () => {
  const store = new TestIndexedDbStore();
  const first = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
    operationId: "reload-operation",
    relay: async () => { throw new Error("offline"); },
  }));
  const afterReload = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
    operationId: "must-not-be-used",
    relay: async () => { throw new Error("offline"); },
  }));
  assert.equal(afterReload.operation_id, first.operation_id);
  assert.equal((await store.list("school-a")).length, 1);
});

test("3 - succès Cloud sans POST relais", async () => {
  const store = new TestIndexedDbStore();
  let relayPosts = 0;
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
    cloudAvailable: true,
    relay: async () => {
      relayPosts += 1;
      throw new Error("unexpected");
    },
  }));
  assert.equal(result.state, "cloud_synced");
  assert.equal(relayPosts, 0);
});

test("4 - Cloud indisponible et relais disponible : un seul POST relais", async () => {
  const store = new TestIndexedDbStore();
  let relayPosts = 0;
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
    relay: async ({ payload }) => {
      relayPosts += 1;
      return {
        ok: true,
        status: 202,
        body: { operation_id: payload.operation_id, state: "secured_on_relay" },
      };
    },
  }));
  assert.equal(result.state, "relay_secured");
  assert.equal(relayPosts, 1);
});

test("5 - accusé relais distinct de la synchronisation Cloud", async () => {
  const result = await deliverTeacherAttendanceWithDependencies(
    input(),
    scenario(new TestIndexedDbStore()),
  );
  assert.equal(result.state, "relay_secured");
  assert.equal(teacherAttendanceDeliveryMessage(result), "Sécurisé sur le relais local.");
});

test("6 - relais inaccessible : device_pending conservé", async () => {
  const store = new TestIndexedDbStore();
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
    relay: async () => { throw new Error("network"); },
  }));
  assert.equal(result.state, "device_pending");
  assert.equal(result.last_error, "relay_unreachable");
  assert.equal((await store.list("school-a")).length, 1);
});

test("7 - feature flag désactivé : device_pending sans fausse confirmation", async () => {
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(
    new TestIndexedDbStore(),
    {
      relay: async () => ({
        ok: false,
        status: 503,
        body: { error: "teacher_attendance_writes_disabled" },
      }),
    },
  ));
  assert.equal(result.state, "device_pending");
  assert.match(teacherAttendanceDeliveryMessage(result), /désactivées/);
});

test("8 - erreur Cloud ambiguë : delivery_unknown sans relais", async () => {
  let relayPosts = 0;
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(
    new TestIndexedDbStore(),
    {
      cloudAvailable: true,
      cloud: async () => { throw new Error("response lost"); },
      relay: async () => {
        relayPosts += 1;
        throw new Error("unexpected");
      },
    },
  ));
  assert.equal(result.state, "delivery_unknown");
  assert.equal(relayPosts, 0);
});

test("8b - une réponse Cloud perdue est rejouée avec le même operation_id", async () => {
  const store = new TestIndexedDbStore();
  const operationIds: string[] = [];
  let attempt = 0;
  const deps = scenario(store, {
    cloudAvailable: true,
    operationId: "cloud-retry-stable-operation",
    cloud: async ({ operationId }) => {
      operationIds.push(operationId);
      attempt += 1;
      if (attempt === 1) throw new Error("response lost");
      return {
        ok: true,
        status: 200,
        body: { operation_id: operationId },
      };
    },
  });

  const first = await deliverTeacherAttendanceWithDependencies(input(), deps);
  const second = await deliverTeacherAttendanceWithDependencies(input(), deps);
  assert.equal(first.state, "delivery_unknown");
  assert.equal(second.state, "cloud_synced");
  assert.deepEqual(operationIds, [
    "cloud-retry-stable-operation",
    "cloud-retry-stable-operation",
  ]);
});

test("8c - un accusé Cloud portant un autre operation_id est un conflit", async () => {
  const result = await deliverTeacherAttendanceWithDependencies(
    input(),
    scenario(new TestIndexedDbStore(), {
      cloudAvailable: true,
      operationId: "expected-cloud-operation",
      cloud: async () => ({
        ok: true,
        status: 200,
        body: { operation_id: "another-cloud-operation" },
      }),
    }),
  );

  assert.equal(result.state, "conflict");
  assert.equal(result.last_error, "cloud_operation_id_mismatch");
});

test("9 - retry relais réutilise operation_id et payload canonique", async () => {
  const store = new TestIndexedDbStore();
  const payloads: unknown[] = [];
  let attempt = 0;
  const deps = scenario(store, {
    operationId: "same-retry-operation",
    relay: async ({ payload }) => {
      payloads.push(payload);
      attempt += 1;
      if (attempt === 1) throw new Error("response lost");
      return {
        ok: true,
        status: 200,
        body: { operation_id: payload.operation_id, state: "secured_on_relay" },
      };
    },
  });
  const first = await deliverTeacherAttendanceWithDependencies(input(), deps);
  const second = await deliverTeacherAttendanceWithDependencies(input(), deps);
  assert.equal(first.operation_id, second.operation_id);
  assert.deepEqual(payloads[0], payloads[1]);
  assert.equal(second.state, "relay_secured");
});

test("10 - 401 relais conserve l'opération", async () => {
  const store = new TestIndexedDbStore();
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
    relay: async () => ({ ok: false, status: 401, body: { error: "unauthorized" } }),
  }));
  assert.equal(result.state, "device_pending");
  assert.equal(result.requires_authentication, true);
  assert.equal((await store.list("school-a")).length, 1);
});

test("11 - 409 relais devient conflict et ne boucle pas", async () => {
  const store = new TestIndexedDbStore();
  let posts = 0;
  const deps = scenario(store, {
    relay: async () => {
      posts += 1;
      return { ok: false, status: 409, body: { error: "payload_conflict" } };
    },
  });
  const first = await deliverTeacherAttendanceWithDependencies(input(), deps);
  const second = await deliverTeacherAttendanceWithDependencies(input(), deps);
  assert.equal(first.state, "conflict");
  assert.equal(second.state, "conflict");
  assert.equal(posts, 1);
});

test("12 - validation permanente devient blocked", async () => {
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(
    new TestIndexedDbStore(),
    { relay: async () => ({ ok: false, status: 403, body: { error: "student_not_enrolled" } }) },
  ));
  assert.equal(result.state, "blocked");
  assert.equal(result.last_error, "student_not_enrolled");
});

test("13 - preuve valide liée à la même séance", async () => {
  let proofSession = "";
  let postedProof = "";
  await deliverTeacherAttendanceWithDependencies(input(), scenario(new TestIndexedDbStore(), {
    proof: async ({ clientSessionId }) => {
      proofSession = clientSessionId;
      return { proof: "proof-for-session-a", expires_at: "2026-07-22T10:03:00.000Z" };
    },
    relay: async ({ payload }) => {
      postedProof = payload.presence_proof || "";
      return {
        ok: true,
        status: 202,
        body: { operation_id: payload.operation_id, state: "secured_on_relay" },
      };
    },
  }));
  assert.equal(proofSession, "session-a");
  assert.equal(postedProof, "proof-for-session-a");
});

test("14 - preuve absente ou expirée : aucun POST et aucune confirmation", async () => {
  let posts = 0;
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(
    new TestIndexedDbStore(),
    {
      proof: async () => ({ proof: "", expires_at: "2026-07-22T09:59:00.000Z" }),
      relay: async () => {
        posts += 1;
        throw new Error("unexpected");
      },
    },
  ));
  assert.equal(result.state, "device_pending");
  assert.equal(posts, 0);
});

test("15 - séance inexistante : diagnostic explicite", async () => {
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(
    new TestIndexedDbStore(),
    { relay: async () => ({ ok: false, status: 404, body: { error: "session_not_found" } }) },
  ));
  assert.equal(result.state, "blocked");
  assert.match(teacherAttendanceDeliveryMessage(result), /préparée sur le relais/);
});

test("16 - rechargement complet : marques et état ne sont pas perdus", async () => {
  const store = new TestIndexedDbStore();
  const before = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
    relay: async () => { throw new Error("offline"); },
  }));
  const [persisted] = await store.list("school-a");
  assert.deepEqual(persisted.marks, before.marks);
  assert.equal(persisted.state, "device_pending");
});

test("17 - deux écoles peuvent avoir les mêmes identifiants sans collision", async () => {
  const store = new TestIndexedDbStore();
  const disabled = async () => ({
    ok: false,
    status: 503,
    body: { error: "teacher_attendance_writes_disabled" },
  });
  const a = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
    operationId: "same-id",
    relay: disabled,
  }));
  const b = await deliverTeacherAttendanceWithDependencies(input({ institutionId: "school-b" }), scenario(store, {
    operationId: "same-id",
    relay: disabled,
  }));
  assert.equal(a.operation_id, b.operation_id);
  assert.equal((await store.list("school-a")).length, 1);
  assert.equal((await store.list("school-b")).length, 1);
});

test("18 - aucun jeton dans l'opération ou le payload métier", async () => {
  let relayPayload: unknown = null;
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(
    new TestIndexedDbStore(),
    {
      relay: async ({ payload }) => {
        relayPayload = payload;
        return {
          ok: true,
          status: 202,
          body: { operation_id: payload.operation_id, state: "secured_on_relay" },
        };
      },
    },
  ));
  assert.equal(JSON.stringify(result).includes("signed-teacher-token"), false);
  assert.equal(JSON.stringify(relayPayload).includes("signed-teacher-token"), false);
});

test("19 - la préparation hors ligne professeur réchauffe seulement Appel et Connexion", async () => {
  const source = await readFile(new URL("../src/lib/offline-readiness.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function prepareTeacher(");
  const end = source.indexOf("async function prepareClassDevice(", start);
  const preparation = source.slice(start, end);
  for (const path of ["/attendance", "/login"]) {
    assert.equal(preparation.includes(`"${path}"`), true, path);
  }
  assert.equal(preparation.includes('"/grades"'), false);
  assert.equal(preparation.includes('"/enseignant/cahier-de-texte"'), false);
});

test("20 - ancienne outbox migrée reprend avec le même operation_id", async () => {
  const store = new TestIndexedDbStore();
  let removed = "";
  let cloudPosts = 0;
  let relayPosts = 0;
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
    findLegacy: async () => ({
      id: "legacy-row",
      operationId: "legacy-operation",
      body: { session_id: "session-a", marks: input().marks },
      state: "pending",
      lastStatus: 0,
      lastError: "network_error",
      createdAt: Date.parse("2026-07-22T09:00:00.000Z"),
    }),
    removeLegacy: async (id) => { removed = id; },
    cloud: async () => {
      cloudPosts += 1;
      return { ok: true, status: 200 };
    },
    relay: async () => {
      relayPosts += 1;
      return { ok: true, status: 202 };
    },
  }));
  assert.equal(result.operation_id, "legacy-operation");
  assert.equal(result.state, "relay_secured");
  assert.equal(removed, "legacy-row");
  assert.equal(cloudPosts, 0);
  assert.equal(relayPosts, 1);
});

test("21 - séance locale absente de SQLite : aucune création aveugle", async () => {
  let proofRequests = 0;
  let relayPosts = 0;
  const result = await deliverTeacherAttendanceWithDependencies(input({
    sessionReference: "client:local-session",
    serverSessionId: null,
  }), scenario(new TestIndexedDbStore(), {
    proof: async () => {
      proofRequests += 1;
      return { proof: "proof", expires_at: "2026-07-22T10:03:00.000Z" };
    },
    relay: async () => {
      relayPosts += 1;
      return { ok: true, status: 202 };
    },
  }));
  assert.equal(result.state, "device_pending");
  assert.equal(result.last_error, "session_not_initialized_on_relay");
  assert.equal(proofRequests + relayPosts, 0);
});

test("22 - plusieurs clics rapides ne produisent qu'un envoi", async () => {
  const store = new TestIndexedDbStore();
  let cloudPosts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const deps = scenario(store, {
    cloudAvailable: true,
    cloud: async () => {
      cloudPosts += 1;
      await gate;
      return { ok: true, status: 200, body: { ok: true } };
    },
  });
  const first = deliverTeacherAttendanceWithDependencies(input(), deps);
  const second = deliverTeacherAttendanceWithDependencies(input(), deps);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(cloudPosts, 1);
  assert.equal(a.operation_id, b.operation_id);
});

test("23 - ancienne donnée IndexedDB sans period_id ne casse pas l'écran", async () => {
  const result = await deliverTeacherAttendanceWithDependencies(input({ periodId: null }), scenario(
    new TestIndexedDbStore(),
  ));
  assert.equal(result.state, "device_pending");
  assert.equal(result.last_error, "period_not_initialized");
});

test("24 - crash après départ Cloud devient inconnu au rechargement", async () => {
  const store = new TestIndexedDbStore();
  const original: TeacherAttendanceDeliveryRecord = {
    schema_version: 1,
    institution_id: "school-a",
    operation_id: "crashed-operation",
    session_reference: "session-a",
    session_id: "session-a",
    class_id: "class-a",
    period_id: "period-a",
    marks: [
      {
        student_id: "student-a",
        status: "absent",
        comment: null,
        observed_at: null,
      },
      {
        student_id: "student-b",
        status: "late",
        comment: "2 min",
        observed_at: null,
      },
    ],
    content_key: JSON.stringify({
      class_id: "class-a",
      period_id: "period-a",
      marks: [
        {
          student_id: "student-a",
          status: "absent",
          comment: null,
          observed_at: null,
        },
        {
          student_id: "student-b",
          status: "late",
          comment: "2 min",
          observed_at: null,
        },
      ],
    }),
    state: "device_pending",
    channel: "cloud",
    created_at: "2026-07-22T09:59:00.000Z",
    updated_at: "2026-07-22T10:00:00.000Z",
    cloud_attempted_at: "2026-07-22T10:00:00.000Z",
    relay_attempted_at: null,
    last_status: null,
    last_error: "cloud_attempt_in_progress",
    requires_authentication: false,
  };
  await store.put(original);
  const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
    cloudAvailable: true,
  }));
  assert.equal(result.state, "delivery_unknown");
});

test("25 - adaptateur IndexedDB réel relit l'opération après réouverture", async () => {
  const databases = new Map<string, Map<string, Map<unknown, any>>>();

  class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    error: Error | null = null;
    private completionScheduled = false;

    constructor(private readonly stores: Map<string, Map<unknown, any>>) {}

    scheduleCompletion() {
      if (this.completionScheduled) return;
      this.completionScheduled = true;
      setTimeout(() => this.oncomplete?.(), 0);
    }

    objectStore(name: string) {
      const values = this.stores.get(name);
      if (!values) throw new Error(`missing fake store ${name}`);
      return fakeObjectStore(values, this);
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

  function fakeObjectStore(values: Map<unknown, any>, transaction: FakeTransaction) {
    return {
      indexNames: { contains: () => false },
      createIndex: () => undefined,
      get: (key: unknown) => request(structuredClone(values.get(key)), transaction),
      getAll: () => request(structuredClone(Array.from(values.values())), transaction),
      getAllKeys: () => request(Array.from(values.keys()), transaction),
      count: () => request(values.size, transaction),
      put: (value: any) => {
        values.set(value.key ?? value.id, structuredClone(value));
        transaction.scheduleCompletion();
      },
      delete: (key: unknown) => {
        values.delete(key);
        transaction.scheduleCompletion();
      },
      clear: () => {
        values.clear();
        transaction.scheduleCompletion();
      },
      index: () => ({ getAll: () => request([], transaction) }),
    };
  }

  const fakeIndexedDb = {
    open(name: string) {
      const stores = databases.get(name) || new Map<string, Map<unknown, any>>();
      databases.set(name, stores);
      const result: any = {
        result: null,
        error: null,
        transaction: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      const db = {
        objectStoreNames: { contains: (storeName: string) => stores.has(storeName) },
        createObjectStore(storeName: string) {
          const values = new Map<unknown, any>();
          stores.set(storeName, values);
          return fakeObjectStore(values, new FakeTransaction(stores));
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
  try {
    const store = createIndexedDbTeacherAttendanceStore();
    const record = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
      operationId: "indexed-db-operation",
      relay: async () => { throw new Error("offline"); },
    }));
    const reopened = createIndexedDbTeacherAttendanceStore();
    const [persisted] = await reopened.list("school-a");
    assert.equal(persisted.operation_id, record.operation_id);
    assert.deepEqual(persisted.marks, record.marks);
    assert.equal(persisted.state, "device_pending");
  } finally {
    (globalThis as any).window = previousWindow;
    (globalThis as any).indexedDB = previousIndexedDb;
  }
});

test("26 - après bootstrap, session_not_found se retente avec le même operation_id", async () => {
  const store = new TestIndexedDbStore();
  let attempt = 0;
  const deps = scenario(store, {
    operationId: "bootstrap-retry-operation",
    relay: async ({ payload }) => {
      attempt += 1;
      if (attempt === 1) {
        return { ok: false, status: 404, body: { error: "session_not_found" } };
      }
      return {
        ok: true,
        status: 202,
        body: { operation_id: payload.operation_id, state: "secured_on_relay" },
      };
    },
  });
  const beforeBootstrap = await deliverTeacherAttendanceWithDependencies(input(), deps);
  const afterBootstrap = await deliverTeacherAttendanceWithDependencies(input(), deps);
  assert.equal(beforeBootstrap.state, "blocked");
  assert.equal(afterBootstrap.state, "relay_secured");
  assert.equal(afterBootstrap.operation_id, beforeBootstrap.operation_id);
  assert.equal(attempt, 2);
});

test("27 - ancien relais joignable avec route absente : device_pending pour tout corps 404", async (t) => {
  const legacyBodies: Array<{ name: string; body: Record<string, unknown> }> = [
    { name: "vide", body: {} },
    { name: "inconnu", body: { error: "not_found" } },
    { name: "ancien", body: { message: "Cannot POST /v1/teacher/attendance-operations" } },
  ];

  for (const legacy of legacyBodies) {
    await t.test(legacy.name, async () => {
      const store = new TestIndexedDbStore();
      let relayPosts = 0;
      let proofRequests = 0;
      const result = await deliverTeacherAttendanceWithDependencies(input(), scenario(store, {
        operationId: `legacy-relay-${legacy.name}`,
        proof: async () => {
          proofRequests += 1;
          return {
            proof: "valid-presence-proof",
            expires_at: "2026-07-22T10:03:00.000Z",
          };
        },
        relay: async () => {
          relayPosts += 1;
          return { ok: false, status: 404, body: legacy.body };
        },
      }));
      const persisted = await store.list("school-a");
      assert.equal(proofRequests, 1, "relais local joignable et preuve obtenue");
      assert.equal(relayPosts, 1, "aucune boucle automatique");
      assert.equal(result.state, "device_pending");
      assert.equal(result.operation_id, `legacy-relay-${legacy.name}`);
      assert.equal(result.last_error, "relay_attendance_route_unavailable");
      assert.equal(persisted.length, 1, "aucune suppression IndexedDB");
      assert.equal(persisted[0].operation_id, result.operation_id);
      assert.notEqual(result.state, "blocked");
      assert.doesNotMatch(teacherAttendanceDeliveryMessage(result), /Sécurisé/);
    });
  }
});

test("28 - après mise à jour de l'ancien relais, nouveau clic reprend le même canal et operation_id", async () => {
  const store = new TestIndexedDbStore();
  let relayPosts = 0;
  let cloudProbes = 0;
  let cloudPosts = 0;
  const deps = scenario(store, {
    operationId: "old-relay-upgrade-operation",
    cloud: async () => {
      cloudPosts += 1;
      return { ok: true, status: 200, body: { ok: true } };
    },
    relay: async ({ payload }) => {
      relayPosts += 1;
      if (relayPosts === 1) return { ok: false, status: 404, body: {} };
      return {
        ok: true,
        status: 202,
        body: { operation_id: payload.operation_id, state: "secured_on_relay" },
      };
    },
  });
  deps.cloudManifestAvailable = async () => {
    cloudProbes += 1;
    return false;
  };

  const oldRelay = await deliverTeacherAttendanceWithDependencies(input(), deps);
  deps.cloudManifestAvailable = async () => {
    cloudProbes += 1;
    return true;
  };
  const updatedRelay = await deliverTeacherAttendanceWithDependencies(input(), deps);

  assert.equal(oldRelay.state, "device_pending");
  assert.equal(updatedRelay.state, "relay_secured");
  assert.equal(updatedRelay.operation_id, oldRelay.operation_id);
  assert.equal(relayPosts, 2);
  assert.equal(cloudProbes, 1, "le canal relais est conservé après le premier POST local");
  assert.equal(cloudPosts, 0, "aucun second envoi Cloud après l'échec local");
});

test("29 - une séance créée par le relais force l'appel sur le relais sans probe ni POST Cloud", async () => {
  const store = new TestIndexedDbStore();
  let cloudProbes = 0;
  let cloudPosts = 0;
  let relayPosts = 0;
  const deps = scenario(store, {
    cloudAvailable: true,
    cloud: async () => {
      cloudPosts += 1;
      return { ok: true, status: 200, body: { ok: true } };
    },
    relay: async ({ payload }) => {
      relayPosts += 1;
      return {
        ok: true,
        status: 202,
        body: { operation_id: payload.operation_id, state: "secured_on_relay" },
      };
    },
  });
  deps.cloudManifestAvailable = async () => {
    cloudProbes += 1;
    return true;
  };
  const result = await deliverTeacherAttendanceWithDependencies(input({
    sessionReference: "relay-local-session",
    serverSessionId: "relay-local-session",
    preferredChannel: "relay",
  }), deps);
  assert.equal(result.state, "relay_secured");
  assert.equal(relayPosts, 1);
  assert.equal(cloudPosts, 0);
  assert.equal(cloudProbes, 0);
});

test("30 - une synchronisation sans séance Cloud conserve l'ouverture locale du relais", async () => {
  const source = await readFile(
    new URL("../src/components/teacher/TeacherDashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("else if (openLocal?.local_relay)"), true);
  assert.equal(source.includes("setOpen(openLocal);"), true);
});

test("31 - une correction remplace l'ancienne tentative sans risque de rejeu", async () => {
  const store = new TestIndexedDbStore();
  const deps = scenario(store, {
    relay: async () => { throw new Error("offline"); },
  });

  const first = await deliverTeacherAttendanceWithDependencies(input(), deps);
  const corrected = await deliverTeacherAttendanceWithDependencies(input({
    marks: [
      { student_id: "student-b", status: "present", comment: null },
      { student_id: "student-a", status: "late", comment: "5 min" },
    ],
  }), deps);

  const records = await store.list("school-a");
  assert.equal(records.length, 2);
  assert.notEqual(corrected.operation_id, first.operation_id);
  assert.equal(
    records.find((record) => record.operation_id === first.operation_id)?.state,
    "superseded",
  );
  assert.equal(
    records.find((record) => record.operation_id === corrected.operation_id)?.state,
    "device_pending",
  );
  assert.equal(
    teacherAttendanceDeliveryMessage(
      records.find((record) => record.operation_id === first.operation_id)!,
    ),
    "Remplacé par une version plus récente.",
  );
});

test("32 - un vieux brouillon fige la capture à la première validation et la garde aux retries", async () => {
  const store = new TestIndexedDbStore();
  let current = new Date("2026-07-22T08:00:00.000Z");
  const capturedPayloads: Array<string | undefined> = [];
  const deps = scenario(store, {
    operationId: "draft-then-submit",
    relay: async ({ payload }) => {
      capturedPayloads.push(payload.captured_at_device);
      return {
        ok: false,
        status: 503,
        body: { error: "teacher_attendance_writes_disabled" },
      };
    },
  });
  deps.now = () => current;

  const draft = await stageTeacherAttendanceDraftWithDependencies(input(), deps);
  assert.ok(draft);
  assert.equal(draft.created_at, "2026-07-22T08:00:00.000Z");
  assert.equal(draft.captured_at_device, undefined);

  current = new Date("2026-07-22T10:00:00.000Z");
  const firstAttempt = await deliverTeacherAttendanceWithDependencies(input(), deps);
  assert.equal(firstAttempt.captured_at_device, "2026-07-22T10:00:00.000Z");

  current = new Date("2026-07-22T10:05:00.000Z");
  const retry = await deliverTeacherAttendanceWithDependencies(input(), deps);
  assert.equal(retry.operation_id, firstAttempt.operation_id);
  assert.equal(retry.captured_at_device, "2026-07-22T10:00:00.000Z");
  assert.deepEqual(capturedPayloads, [
    "2026-07-22T10:00:00.000Z",
    "2026-07-22T10:00:00.000Z",
  ]);
});

test("33 - le trajet Cloud reçoit le même captured_at_device que l'opération locale", async () => {
  const store = new TestIndexedDbStore();
  let received: string | null = null;
  const deps = scenario(store, {
    cloudAvailable: true,
    operationId: "cloud-captured-operation",
    cloud: async ({ operationId, capturedAtDevice }) => {
      received = capturedAtDevice;
      return {
        ok: true,
        status: 200,
        body: { ok: true, operation_id: operationId },
      };
    },
  });
  deps.now = () => new Date("2026-07-22T11:30:00.000Z");

  const result = await deliverTeacherAttendanceWithDependencies(input(), deps);
  assert.equal(result.state, "cloud_synced");
  assert.equal(result.captured_at_device, "2026-07-22T11:30:00.000Z");
  assert.equal(received, result.captured_at_device);
});

test("34 - l'instant fourni par le clic prévaut et reste stable lors des retries", async () => {
  const store = new TestIndexedDbStore();
  const captures: string[] = [];
  const deps = scenario(store, {
    operationId: "explicit-captured-operation",
    relay: async ({ payload }) => {
      captures.push(String(payload.captured_at_device));
      throw new Error("offline");
    },
  });
  deps.now = () => new Date("2026-07-22T15:00:00.000Z");

  const first = await deliverTeacherAttendanceWithDependencies(input({
    capturedAtDevice: "2026-07-22T08:15:00.000Z",
  }), deps);
  const retry = await deliverTeacherAttendanceWithDependencies(input({
    capturedAtDevice: "2026-07-22T09:45:00.000Z",
  }), deps);

  assert.equal(first.captured_at_device, "2026-07-22T08:15:00.000Z");
  assert.equal(retry.captured_at_device, first.captured_at_device);
  assert.deepEqual(captures, [
    "2026-07-22T08:15:00.000Z",
    "2026-07-22T08:15:00.000Z",
  ]);
});
