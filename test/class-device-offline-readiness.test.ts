import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  CLASS_DEVICE_COHERENT_BUNDLE_KEY,
  classDeviceReadinessMessage,
  evaluateClassDeviceCoherence,
  validateClassDeviceRelayAccessTokenScope,
  validateClassDeviceScheduleScope,
  type ClassDeviceCoherenceInput,
  type ClassDeviceReadinessLike,
  type ClassDeviceScheduleScope,
} from "../src/lib/offlineClassDevice";

const WEB_RELEASE = "web-current";
const WORKER_RELEASE = "2026-07-30-class-device-lifecycle-v5-2";

const readiness: ClassDeviceReadinessLike = {
  version: 5,
  role: "class-device",
  web_release: WEB_RELEASE,
  service_worker_release: WORKER_RELEASE,
  shell_ready: true,
  institution_id: "school-a",
  authorized_class_id: "class-a",
  authorized_actor_profile_id: "device-a",
  class_count: 1,
  slot_count: 1,
  schedule_revision: 10,
  data_presence: {
    classes: 1,
    students: 2,
    slots: 1,
    assignments: 1,
  },
};

const readyInput: ClassDeviceCoherenceInput = {
  readiness,
  expected_web_release: WEB_RELEASE,
  expected_service_worker_release: WORKER_RELEASE,
  active_service_worker_release: WORKER_RELEASE,
  expected_institution_id: "school-a",
  expected_class_id: "class-a",
  expected_actor_profile_id: "device-a",
  bundle_present: true,
  bundle_schedule_revision: 10,
  bundle_scope_valid: true,
  relay_status: "reachable",
  relay_institution_id: "school-a",
  relay_actor_kind: "class_device",
  relay_class_id: "class-a",
  relay_actor_profile_id: "device-a",
  relay_schedule_available: true,
  relay_revision: 10,
  cloud_revision: 10,
  relay_writes_enabled: true,
  relay_capabilities: {
    attendance_session_open: true,
    attendance_write: true,
    attendance_session_close: true,
    class_device_scope_v1: true,
  },
};

const schedule: ClassDeviceScheduleScope = {
  version: 1,
  scope_version: 1,
  institution_id: "school-a",
  actor_kind: "class_device",
  class_id: "class-a",
  actor_profile_id: "device-a",
  schedule_revision: 10,
  snapshot_completeness: "complete",
  class_count: 1,
  slot_count: 1,
  slots: [
    {
      key: "1|08:00|09:00",
      period_id: "period-a",
      items: [
        {
          class_id: "class-a",
          subject_id: "subject-a",
        },
      ],
    },
  ],
  rosters: {
    "class-a": {
      items: [
        { id: "student-a" },
        { id: "student-b" },
      ],
    },
  },
  assignments: [
    {
      institution_id: "school-a",
      class_id: "class-a",
      teacher_id: "teacher-a",
    },
  ],
};

function accessToken(payload: Record<string, unknown>) {
  return `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.signature`;
}

test("appareil v5 correctement préparé", () => {
  assert.equal(evaluateClassDeviceCoherence(readyInput), "ready");
  assert.deepEqual(
    validateClassDeviceScheduleScope(schedule, {
      institutionId: "school-a",
      classId: "class-a",
      actorProfileId: "device-a",
    }),
    { ok: true, revision: 10 },
  );
});

test("ancienne readiness v4 rejetée prudemment", () => {
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      readiness: { ...readiness, version: 4 },
    }),
    "not_prepared",
  );
});

test("ancienne release Web bloquée", () => {
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      readiness: { ...readiness, web_release: "web-old" },
    }),
    "web_release_stale",
  );
});

test("ancien service worker stocké ou encore actif bloqué", () => {
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      readiness: {
        ...readiness,
        service_worker_release: "worker-old",
      },
      active_service_worker_release: "worker-old",
    }),
    "service_worker_stale",
  );
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      active_service_worker_release: "worker-old",
    }),
    "service_worker_stale",
  );
});

test("téléphone en retard déclenche une actualisation depuis le relais", () => {
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      relay_revision: 11,
      cloud_revision: 11,
    }),
    "refresh_from_relay",
  );
});

test("relais en retard sur le téléphone ou le Cloud bloque", () => {
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      readiness: { ...readiness, schedule_revision: 11 },
      bundle_schedule_revision: 11,
    }),
    "relay_stale",
  );
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      cloud_revision: 11,
    }),
    "relay_stale",
  );
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      relay_revision: 11,
      cloud_revision: 10,
    }),
    "sources_diverged",
  );
});

test("Cloud indisponible reste prêt si téléphone et relais concordent", () => {
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      cloud_revision: null,
    }),
    "ready",
  );
});

test("relais inaccessible ou autorisation refusée ne produit jamais ready", () => {
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      relay_status: "unreachable",
    }),
    "relay_unreachable",
  );
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      relay_status: "access_denied",
    }),
    "relay_access_denied",
  );
});

test("classe absente et capacité d’écriture manquante bloquent", () => {
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      readiness: {
        ...readiness,
        class_count: 0,
        data_presence: { ...readiness.data_presence, classes: 0 },
      },
    }),
    "class_data_missing",
  );
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      relay_capabilities: {
        ...readyInput.relay_capabilities,
        attendance_write: false,
      },
    }),
    "relay_capability_missing",
  );
});

test("ancien relais sans portée appareil de classe est identifié explicitement", () => {
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      relay_capabilities: {
        ...readyInput.relay_capabilities,
        class_device_scope_v1: false,
      },
    }),
    "relay_contract_stale",
  );
  const legacySchedule = structuredClone(schedule) as any;
  delete legacySchedule.scope_version;
  delete legacySchedule.actor_profile_id;
  assert.deepEqual(
    validateClassDeviceScheduleScope(legacySchedule, {
      institutionId: "school-a",
      classId: "class-a",
      actorProfileId: "device-a",
    }),
    { ok: false, status: "relay_contract_stale" },
  );
});

test("planning d’un autre appareil est distingué d’une autre classe", () => {
  const otherDevice = structuredClone(schedule) as any;
  otherDevice.actor_profile_id = "device-b";
  assert.deepEqual(
    validateClassDeviceScheduleScope(otherDevice, {
      institutionId: "school-a",
      classId: "class-a",
      actorProfileId: "device-a",
    }),
    { ok: false, status: "device_mismatch" },
  );
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      relay_actor_profile_id: "device-b",
    }),
    "device_mismatch",
  );
});

test("le jeton v2 doit porter exactement établissement, classe et appareil", () => {
  const exact = {
    v: 2,
    purpose: "attendance_relay_access",
    institution_id: "school-a",
    actor_profile_id: "device-a",
    actor_kind: "class_device",
    class_id: "class-a",
  };
  assert.deepEqual(
    validateClassDeviceRelayAccessTokenScope(accessToken(exact), {
      institutionId: "school-a",
      classId: "class-a",
      actorProfileId: "device-a",
    }),
    { ok: true },
  );
  assert.deepEqual(
    validateClassDeviceRelayAccessTokenScope(
      accessToken({ ...exact, v: 1, actor_kind: undefined, class_id: undefined }),
      {
        institutionId: "school-a",
        classId: "class-a",
        actorProfileId: "device-a",
      },
    ),
    { ok: false, status: "relay_contract_stale" },
  );
  assert.deepEqual(
    validateClassDeviceRelayAccessTokenScope(
      accessToken({ ...exact, class_id: "class-b" }),
      {
        institutionId: "school-a",
        classId: "class-a",
        actorProfileId: "device-a",
      },
    ),
    { ok: false, status: "class_mismatch" },
  );
  assert.deepEqual(
    validateClassDeviceRelayAccessTokenScope(
      accessToken({ ...exact, actor_profile_id: "device-b" }),
      {
        institutionId: "school-a",
        classId: "class-a",
        actorProfileId: "device-a",
      },
    ),
    { ok: false, status: "device_mismatch" },
  );
});

test("shell incomplet ne peut jamais être déclaré prêt", () => {
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      readiness: { ...readiness, shell_ready: false },
    }),
    "shell_not_ready",
  );
});

test("échec partiel d’un asset essentiel fait échouer le warm shell", async () => {
  const workerSource = await readFile(
    new URL("../public/moncahier-sw.js", import.meta.url),
    "utf8",
  );
  const listeners = new Map<string, Array<(event: any) => void>>();
  const stores = new Map<string, Map<string, Response>>();
  const origin = "https://mon-cahier.test";
  const requestKey = (request: Request | string) =>
    typeof request === "string"
      ? new URL(request, origin).href
      : request.url;
  const fetchMock = async (request: Request | string) => {
    const url = new URL(requestKey(request));
    if (url.pathname === "/class") {
      return new Response(
        '<html><script src="/_next/static/app.js"></script><link href="/_next/static/app.css" rel="stylesheet"></html>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (url.pathname.endsWith(".css")) {
      return new Response("missing", { status: 503 });
    }
    return new Response("asset", { status: 200 });
  };
  const cachesMock = {
    async open(name: string) {
      const values = stores.get(name) || new Map<string, Response>();
      stores.set(name, values);
      return {
        async add(request: Request | string) {
          const response = await fetchMock(request);
          if (!response.ok) throw new Error(`HTTP_${response.status}`);
          values.set(requestKey(request), response.clone());
        },
        async put(request: Request | string, response: Response) {
          values.set(requestKey(request), response.clone());
        },
        async match(request: Request | string) {
          return values.get(requestKey(request))?.clone();
        },
        async keys() {
          return Array.from(values.keys(), (url) => new Request(url));
        },
        async delete(request: Request | string) {
          return values.delete(requestKey(request));
        },
      };
    },
    async keys() {
      return Array.from(stores.keys());
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  const selfMock = {
    location: { origin },
    clients: {
      claim: async () => undefined,
      matchAll: async () => [],
      openWindow: async () => undefined,
    },
    registration: {
      showNotification: async () => undefined,
    },
    skipWaiting: async () => undefined,
    addEventListener(type: string, listener: (event: any) => void) {
      const values = listeners.get(type) || [];
      values.push(listener);
      listeners.set(type, values);
    },
  };
  runInNewContext(workerSource, {
    self: selfMock,
    caches: cachesMock,
    fetch: fetchMock,
    URL,
    Request,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  });

  let completion: Promise<unknown> | null = null;
  let response: any = null;
  const listener = listeners.get("message")?.[0];
  assert.ok(listener, "le service worker doit enregistrer son listener message");
  listener({
    data: { type: "MON_CAHIER_WARM_SHELL", urls: ["/class"] },
    ports: [{ postMessage: (value: any) => { response = value; } }],
    waitUntil: (promise: Promise<unknown>) => { completion = promise; },
  });
  assert.ok(completion, "la préparation doit être suivie par waitUntil");
  await completion;
  assert.equal(response?.ok, false);
  assert.match(String(response?.error || ""), /Ressource essentielle indisponible.*app\.css/);
});

test("bundle atomique reste cohérent après sérialisation et réouverture", () => {
  const serialized = JSON.stringify({
    schema_version: 1,
    readiness,
    schedule,
  });
  const reopened = JSON.parse(serialized) as {
    schema_version: number;
    readiness: ClassDeviceReadinessLike;
    schedule: ClassDeviceScheduleScope;
  };
  const scope = validateClassDeviceScheduleScope(reopened.schedule, {
    institutionId: "school-a",
    classId: "class-a",
    actorProfileId: "device-a",
  });
  assert.equal(CLASS_DEVICE_COHERENT_BUNDLE_KEY, "classDevice:coherent-bundle:v1");
  assert.deepEqual(scope, { ok: true, revision: 10 });
  assert.equal(
    evaluateClassDeviceCoherence({
      ...readyInput,
      readiness: reopened.readiness,
      bundle_schedule_revision: scope.ok ? scope.revision : null,
      bundle_scope_valid: scope.ok,
    }),
    "ready",
  );
});

test("isolation stricte entre écoles et classes", () => {
  assert.deepEqual(
    validateClassDeviceScheduleScope(schedule, {
      institutionId: "school-b",
      classId: "class-a",
      actorProfileId: "device-a",
    }),
    { ok: false, status: "institution_mismatch" },
  );
  assert.deepEqual(
    validateClassDeviceScheduleScope(schedule, {
      institutionId: "school-a",
      classId: "class-b",
      actorProfileId: "device-a",
    }),
    { ok: false, status: "class_mismatch" },
  );
  const contaminated = structuredClone(schedule) as any;
  contaminated.rosters["class-b"] = { items: [] };
  assert.deepEqual(
    validateClassDeviceScheduleScope(contaminated, {
      institutionId: "school-a",
      classId: "class-a",
      actorProfileId: "device-a",
    }),
    { ok: false, status: "class_data_missing" },
  );
});

test("échec d’actualisation ne conserve aucun message vert", () => {
  assert.match(
    classDeviceReadinessMessage("phone_stale"),
    /actualisation atomique.*échoué/i,
  );
  assert.doesNotMatch(
    classDeviceReadinessMessage("phone_stale"),
    /cohérent|prêt/i,
  );
});

test("la préparation reste stricte et l'ancien endpoint délègue au démarrage contrôlé", async () => {
  const source = await readFile(
    new URL("../src/app/class/page.tsx", import.meta.url),
    "utf8",
  );
  const start = source.slice(
    source.indexOf("async function startSession()"),
    source.indexOf("async function endSession()"),
  );
  assert.match(start, /if \(relayDelivery\.state === "blocked"\)/);
  assert.match(start, /\/api\/class\/sessions\/start/);
  assert.match(start, /delivery_origin: "local_pending"/);
  const legacyRoute = await readFile(
    new URL("../src/app/api/class/sessions/open/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    legacyRoute,
    /export \{ POST \} from "\.\.\/start\/route"/,
  );
  assert.doesNotMatch(start, /id:\s*`client:/);
  assert.match(source, /ancien cache reste consultable/i);
});
