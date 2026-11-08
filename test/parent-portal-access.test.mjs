import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isParentConnectRoute } from "../src/lib/parent-connect/navigation.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la connexion, le tableau de bord et les paiements parents évitent le garde hors ligne des personnels", () => {
  for (const path of ["/parents/login", "/parents", "/parents/payments"]) {
    assert.equal(isParentConnectRoute(path), true, path);
  }
  for (const path of ["/parent", "/admin/parents", "/login", "/attendance", "/class", "/parents-autre"]) {
    assert.equal(isParentConnectRoute(path), false, path);
  }
});

test("le garde laisse accéder aux routes parents avant le chargement de session scolaire", async () => {
  const source = await read("src/components/OfflineAccessGuard.tsx");
  assert.match(source, /PUBLIC_PATHS\.has\(pathname\) \|\| isParentConnectRoute\(pathname\)/);
  assert.match(source, /if \(pathname && isParentConnectRoute\(pathname\)\) return children;/);
  assert.ok(source.indexOf("if (pathname && isParentConnectRoute(pathname)) return children;") < source.indexOf('if (loading || state.status === "checking")'));
  assert.match(source, /isOfflinePathAllowedForRole\(intent\.payload\.role, pathname\)/);
});

test("les données parents restent filtrées par le cookie appareil et les rattachements serveur", async () => {
  const [children, attach] = await Promise.all([
    read("src/app/api/parent/children/route.ts"),
    read("src/app/api/parent/children/attach/route.ts"),
  ]);
  assert.match(children, /jar\.get\("parent_device"\)/);
  assert.match(children, /\.from\("parent_device_children"\)/);
  assert.match(attach, /parentConnectDenial\(srv, student\.id\)/);
});

test("les absences affichent uniquement les vraies séances et leurs matières", async () => {
  const [api, page] = await Promise.all([
    read("src/app/api/parent/children/events/route.ts"),
    read("src/app/parents/page.tsx"),
  ]);
  assert.match(api, /session:session_id!inner/);
  assert.match(api, /\.gte\("session\.started_at", fromISO\)/);
  assert.match(api, /\.in\("status", \["absent", "late"\]\)/);
  assert.match(api, /Number\.isFinite\(sessionTime\) && sessionTime >= minTime/);
  assert.match(api, /when: String\(s\.started_at\)/);
  assert.doesNotMatch(api, /s\.started_at \|\| new Date\(\)/);
  assert.doesNotMatch(api, /const penItems|\.from\("conduct_penalties"\)/);
  assert.match(api, /subject_name: s\.subject_id \? \(subjName\.get/);
  assert.match(api, /class_label: s\.class_id \? \(className\.get/);
  assert.match(page, /event\.subject_name \|\| "Matière non précisée"/);
  assert.match(api, /parentConnectDenial\(srv, student_id\)/);
  assert.match(api, /\.from\("parent_device_children"\)/);
});

test("les messages parents ne lisent que leur destinataire et les diffusions sans parent", async () => {
  const api = await read("src/app/api/parent/notifications/route.ts");
  assert.match(api, /and\(parent_id\.is\.null/);
  assert.match(api, /normalizeParentNotifications\(filtered\)/);
  assert.match(api, /mark_id,session_id/);
  assert.doesNotMatch(api, /parent_id\.eq\.\$\{uid\},student_id\.eq\.\$\{sid\}/);
  assert.match(api, /filterParentConnectNotifications/);
  assert.match(api, /\.or\(ownerOr\)/);
});

test("les alertes identiques de plusieurs parents ne gonflent pas la boîte de messages", async () => {
  const { normalizeParentNotifications } = await import("../src/lib/parent-connect/notification-inbox.ts");
  const now = Date.parse("2026-11-08T08:00:00Z");
  const attendance = {
    student_id: "child",
    mark_id: "mark-1",
    created_at: "2026-11-04T06:56:00Z",
    title: null,
    body: null,
    severity: null,
    read_at: null,
    payload: { kind: "attendance", event: "late", session: { started_at: "2026-11-03T10:15:00Z" },
      title: "Retard 2 min", body: "Anglais • 5e2", severity: "medium" },
  };
  const rows = [
    ...["a","b","c","d","e","f"].map((s) => ({ ...attendance, id: "notif-" + s })),
    { ...attendance, id: "old", mark_id: "mark-2", created_at: "2026-02-13T10:25:00Z", payload: { ...attendance.payload, session: { started_at: "2026-02-13T10:15:00Z" } } },
    { id: "message", student_id: "child", created_at: "2026-11-04T07:00:00Z", title: null, body: null, payload: { kind: "communication", title: "Réunion", body: "Vendredi" } },
  ];
  const got = normalizeParentNotifications(rows, now);
  assert.equal(got.length, 2);
  const attendanceItem = got.find((item) => item.title === "Retard 2 min");
  const communicationItem = got.find((item) => item.title === "Réunion");
  assert.ok(attendanceItem);
  assert.ok(communicationItem);
  assert.equal(attendanceItem.id, "historique:child:mark-1");
  assert.equal(attendanceItem.body, "Anglais • 5e2");
  assert.equal(attendanceItem.severity, "medium");
  assert.equal(attendanceItem.created_at, "2026-11-03T10:15:00.000Z");
  assert.ok(attendanceItem.read_at);
  assert.equal(communicationItem.body, "Vendredi");
});

test("un nouveau parent voit les cinq événements récents sans fausses notifications non lues", async () => {
  const { normalizeParentNotifications } = await import("../src/lib/parent-connect/notification-inbox.ts");
  const now = Date.parse("2026-11-08T08:00:00Z");
  const marks = [
    ["m1", "late", "2026-11-03T10:15:00Z"],
    ["m2", "late", "2026-10-06T08:10:00Z"],
    ["m3", "absent", "2026-10-02T16:20:00Z"],
    ["m4", "absent", "2026-09-14T09:05:00Z"],
    ["m5", "absent", "2026-09-11T15:25:00Z"],
    ["m6", "late", "2026-02-13T10:15:00Z"],
    ["m7", "absent", "2026-01-14T07:15:00Z"],
  ];
  const records = marks.flatMap(([mark,event,started_at]) => Array.from({ length: 6 }, (_, i) => ({
    id: mark + "-recipient-" + i, parent_id: "older-parent-" + i, mark_id: mark,
    student_id: "child", created_at: started_at, read_at: null,
    payload: { kind: "attendance", event, session: { started_at },
      title: event === "late" ? "Retard" : "Absence", body: "Cours" },
  })));
  const fresh = normalizeParentNotifications(records, now, ["new-parent"]);
  assert.equal(fresh.length, 5);
  assert.ok(fresh.every((x) => Boolean(x.read_at) && x.id.startsWith("historique:")));
  const recipient = normalizeParentNotifications(records, now, ["older-parent-4"]);
  assert.equal(recipient.length, 5);
  assert.ok(recipient.every((x) => !x.read_at && x.id.endsWith("-recipient-4")));
});
