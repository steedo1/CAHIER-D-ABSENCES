import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/class/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function find(predicate) {
  let found;
  const walk = (node) => {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, walk);
  };
  walk(ast);
  assert.ok(found, "Expected page expression was not found");
  return found;
}

function variable(name) {
  return find((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
    .parent.getText(ast);
}

function compile(input) {
  return ts.transpileModule(input, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function scoped(input, result, state) {
  return new Function("state", "React", `with (state) { ${compile(input)} return ${result}; }`)(state, React);
}

const selectJsx = find((node) => ts.isJsxElement(node) &&
  node.openingElement.tagName.getText(ast) === "Select" &&
  node.openingElement.getText(ast).includes("value={subjectId}"))
  .getText(ast);
const buttonJsx = find((node) => ts.isJsxElement(node) &&
  node.openingElement.tagName.getText(ast) === "Button" &&
  node.openingElement.getText(ast).includes("onClick={startSession}"))
  .getText(ast);
const startFunction = find((node) => ts.isFunctionDeclaration(node) &&
  node.name?.text === "startSession").getText(ast);

const subjects = [
  { id: "subject-de", label: "Allemand" },
  { id: "subject-es", label: "Espagnol" },
];
const period = { id: "period-7", weekday: 5, start_time: "07:00", end_time: "08:00" };
const schedule = { schedule_revision: 2 };

function scenario({ available = subjects, online = true, manual = false, relay = false, delivery = null } = {}) {
  const staged = [];
  const cache = [];
  const relayed = [];
  const cloud = [];
  const state = {
    classId: "class-1a",
    classes: [{ id: "class-1a", label: "1A", institution_id: "CSCA" }],
    selectedClass: {
      id: "class-1a", institution_id: "CSCA", actor_profile_id: "device-1a",
      attendance_presence: relay ? { relay_access_token: "relay-token" } : null,
    },
    subjects: [],
    subjectId: "",
    subjectLoadMode: "empty",
    subjectScheduleIssue: null,
    manualSubjectMode: manual,
    activeConfiguredSlot: manual ? null : period,
    activeSubjectScopeKey: "slot-7|revision-2",
    subjectSelectionSlotRef: { current: "" },
    pendingSnapshotSubjectRef: { current: "" },
    cancelled: false,
    open: null,
    openRef: { current: null },
    busy: false,
    isOnline: online,
    relayUiEnabled: relay,
    usingUnverifiedLegacySubjects: false,
    cloudScheduleRevision: 2,
    relayClassScheduleRef: { current: schedule },
    relayClockRef: { current: null },
    periodsByDay: { 5: [period] },
    inst: { tz: "Africa/Abidjan", default_session_minutes: 60 },
    duration: 60,
    loadClassDeviceSnapshot: () => null,
    setSubjects(list) { state.subjects = list; },
    setSubjectId(value) {
      state.subjectId = typeof value === "function" ? value(state.subjectId) : value;
    },
    setSubjectLoadMode(value) { state.subjectLoadMode = value; },
    setSubjectScheduleIssue(value) { state.subjectScheduleIssue = value; },
    setBusy(value) { state.busy = value; },
    setMsg(value) { state.msg = value; },
    setOpen(value) { state.open = value; },
    setSessionRuntimeState(value) { state.runtime = value; },
    setCloudStatus() {}, setRelayStatus() {}, setRelayClassSchedule() {},
    setPeriodsByDay() {}, setNowTick() {},
    startSession() {},
    ensureAlarmReady() {},
    getClassDeviceCoherentSchedule: async () => schedule,
    scheduleIsCurrent: () => true,
    knownScheduleRevision: () => 2,
    periodsFromRelayClassSchedule: () => ({ 5: [period] }),
    relaySubjectsForSlot: () => available,
    relayAdjustedDate: () => new Date("2026-09-25T07:15:00.000Z"),
    dateKeyInTZ: () => "2026-09-25",
    minutesDiff: () => 60,
    classRelayBaseUrl: () => relay ? "http://relay.test:4317" : null,
    stageTeacherAttendanceSessionOpen: async (input) => {
      staged.push(input);
      return { operation_id: "operation-1", state: "device_pending", subject_id: input.subjectId };
    },
    cacheSet: async (...args) => { cache.push(args); },
    refreshPending: async () => 0,
    openTeacherAttendanceSessionOnRelay: async (input) => {
      relayed.push(input);
      return relay
        ? { state: "relay_opened", session_id: "relay-session-1", subject_id: input.subjectId }
        : { state: "device_pending", last_status: 0 };
    },
    offlineMutateJson: async (url, init, options) => {
      cloud.push({ url, init, options });
      if (delivery) return delivery(url, init, options);
      return online
        ? { ok: true, data: { item: {
            id: "cloud-session-1", class_id: "class-1a", subject_id: init.body.subject_id,
            operation_id: "operation-1", period_id: manual ? null : period.id,
          } } }
        : { ok: false, queued: true, offline: true, status: 0 };
    },
    captureLiveCloudClock: () => null,
    markTeacherSessionOpenedInCloud: async () => {},
    teacherSessionDeliveryMessage: () => "Séance confirmée par le relais.",
    Select: (props) => React.createElement("select", props),
    Button: (props) => React.createElement("button", props),
    Play: () => React.createElement("span"),
  };
  const applyList = scoped(`${variable("normalizeSubjects")}\n${variable("applyList")}`, "applyList", state);
  applyList(available, manual ? "legacy-fallback" : online ? "auto" : "auto-offline");

  function refresh() {
    scoped(`${variable("usingUnverifiedLegacySubjects")}\n${variable("canStartAttendanceNow")}\n${variable("hasSelectedSubject")}`, "(state.canStartAttendanceNow = canStartAttendanceNow, state.hasSelectedSubject = hasSelectedSubject)", state);
    const select = scoped(`const element = (${selectJsx});`, "element", state);
    const button = scoped(`const element = (${buttonJsx});`, "element", state);
    return { select, button, html: renderToStaticMarkup(select) + renderToStaticMarkup(button) };
  }

  return {
    state, staged, cache, relayed, cloud, refresh,
    async start() {
      refresh();
      await scoped(`${startFunction}`, "startSession", state)();
    },
  };
}

test("un seul cours s'affiche et démarre directement avec son ID", async () => {
  const call = scenario({ available: [subjects[0]] });
  const ui = call.refresh();
  assert.equal(ui.button.props.disabled, false);
  assert.doesNotMatch(ui.html, /Choisissez la discipline du professeur présent/);
  await call.start();
  assert.equal(call.state.open.subject_id, "subject-de");
  assert.equal(call.cloud[0].init.body.subject_id, "subject-de");
});

test("deux cours imposent un choix visible, sans afficher une sélection trompeuse", async () => {
  const call = scenario();
  const ui = call.refresh();
  assert.equal(call.state.subjectId, "");
  assert.equal(ui.button.props.disabled, true);
  assert.match(ui.html, /<option value="" selected="">— Choisissez la discipline/);
  await call.start();
  assert.equal(call.staged.length, 0);
});

test("choisir la première discipline active le bouton et conserve cours et créneau", async () => {
  const call = scenario();
  call.refresh().select.props.onChange({ target: { value: "subject-de" } });
  assert.equal(call.refresh().button.props.disabled, false);
  await call.start();
  assert.equal(call.staged[0].subjectId, "subject-de");
  assert.equal(call.relayed[0].subjectId, "subject-de");
  assert.equal(call.cloud[0].init.body.subject_id, "subject-de");
  assert.equal(call.cloud[0].init.body.period_id, period.id);
});

test("avec relais, une discipline choisie ouvre la séance du cours sélectionné", async () => {
  const call = scenario({ online: false, relay: true });
  call.refresh().select.props.onChange({ target: { value: "subject-es" } });
  await call.start();
  assert.equal(call.relayed[0].subjectId, "subject-es");
  assert.equal(call.relayed[0].periodId, period.id);
  assert.equal(call.state.open.subject_id, "subject-es");
  assert.equal(call.state.runtime, "open_relay");
  assert.equal(call.cloud.length, 0);
});

test("changer de discipline avant de démarrer utilise la dernière choisie", async () => {
  const call = scenario();
  call.refresh().select.props.onChange({ target: { value: "subject-de" } });
  call.refresh().select.props.onChange({ target: { value: "subject-es" } });
  assert.equal(call.refresh().button.props.disabled, false);
  await call.start();
  assert.equal(call.staged[0].subjectId, "subject-es");
  assert.equal(call.relayed[0].subjectId, "subject-es");
  assert.equal(call.cloud[0].init.body.subject_id, "subject-es");
  assert.equal(call.state.open.subject_id, "subject-es");
});

test("hors ligne, le cours choisi reste dans la séance locale et la requête à rejouer", async () => {
  const call = scenario({ online: false });
  call.refresh().select.props.onChange({ target: { value: "subject-es" } });
  assert.equal(call.refresh().button.props.disabled, false);
  await call.start();
  assert.equal(call.state.open.subject_id, "subject-es");
  assert.equal(call.state.runtime, "open_local_pending");
  assert.equal(call.cache.find(([key]) => key === "classDevice:local-open")[1].subject_id, "subject-es");
  assert.equal(call.cloud[0].init.body.subject_id, "subject-es");
  assert.equal(call.cloud[0].options.meta.subjectId, "subject-es");
  assert.equal(call.cloud[0].options.meta.periodId, period.id);
});

test("retour Internet : le vrai journal hors ligne rejoue l'ID choisi et le même créneau", async () => {
  const fakeSource = ts.createSourceFile("fake-idb.ts",
    readFileSync(new URL("offline-outbox-ordering.test.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true);
  const fakeFn = fakeSource.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "installFakeIndexedDb");
  assert.ok(fakeFn);
  const restoreDb = new Function(`${compile(fakeFn.getText(fakeSource))}; return installFakeIndexedDb;`)();
  const restore = restoreDb();
  const previousFetch = globalThis.fetch;
  const evaluate = (file, imports) => {
    const exports = {};
    const js = ts.transpileModule(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    new Function("exports", "require", js)(exports, (name) => {
      assert.ok(name in imports, `Unexpected dependency: ${name}`);
      return imports[name];
    });
    return exports;
  };
  const contract = evaluate("src/lib/attendance-cache-contract.ts", {});
  const offline = evaluate("src/lib/offline.ts", {
    "@/lib/attendance-cache-contract": contract,
    "@/lib/attendance-cache-identity": {
      attendanceCacheActor: async () => "device-1a",
      attendanceAuthGeneration: () => 1,
      knownScheduleRevision: () => 2,
      observeScheduleRevision() {},
    },
    "@/lib/offline-release": { MON_CAHIER_OFFLINE_SCHEMA_VERSION: 1 },
    "@/lib/grade-write-capabilities": { isOfflineGradeMutation: () => false },
  });
  const received = [];
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  try {
    const call = scenario({ online: false, delivery: offline.offlineMutateJson });
    call.refresh().select.props.onChange({ target: { value: "subject-es" } });
    await call.start();
    assert.equal((await offline.outboxStats()).total, 1);
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init.body));
      received.push(body);
      const operationId = new Headers(init.headers).get("X-Mon-Cahier-Operation-Id");
      return Response.json({ operation_id: operationId, item: {
        id: "cloud-session-1", operation_id: operationId,
        class_id: body.class_id, subject_id: body.subject_id,
        period_id: body.period_id,
      } });
    };
    const result = await offline.flushOutbox({ releaseNetworkBackoff: true });
    assert.equal(result.flushed, 1);
    assert.equal((await offline.outboxStats()).total, 0);
    assert.equal(received.length, 1);
    assert.equal(received[0].subject_id, "subject-es");
    assert.equal(received[0].period_id, period.id);
    assert.equal(received[0].operation_id, "operation-1");
  } finally {
    globalThis.fetch = previousFetch;
    restore();
  }
});

test("mode Autre cours garde son comportement sans relais obligatoire", async () => {
  const call = scenario({ manual: true });
  assert.equal(call.refresh().button.props.disabled, false);
  await call.start();
  assert.equal(call.cloud[0].init.body.manual_course, true);
  assert.equal(call.cloud[0].init.body.subject_id, "subject-de");
  assert.equal(call.state.open.subject_id, "subject-de");
  assert.equal(call.state.runtime, "open_cloud_fallback");
});
