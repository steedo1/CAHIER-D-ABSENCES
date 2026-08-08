import assert from "node:assert/strict";
import test from "node:test";

import { buildTeacherOfflineStatus } from "../src/lib/teacher-offline-status.ts";
import type { TeacherOfflinePendingSummary } from "../src/lib/teacher-offline-pending.ts";

function summary(
  patch: Partial<TeacherOfflinePendingSummary> = {},
): TeacherOfflinePendingSummary {
  const emptyCounts = {
    device_pending: 0,
    relay_secured: 0,
    delivery_unknown: 0,
    blocked: 0,
    total: 0,
  };
  return {
    ...emptyCounts,
    institution_id: "inst-1",
    at_risk: 0,
    requires_authentication: 0,
    breakdown: {
      outbox: { ...emptyCounts },
      session_open: { ...emptyCounts },
      attendance: { ...emptyCounts },
      lifecycle: { ...emptyCounts },
    },
    ...patch,
  };
}

test("aucune opération affiche des données synchronisées", () => {
  const view = buildTeacherOfflineStatus({
    cloud: "connected",
    relay: "connected",
    pending: summary(),
    syncing: false,
  });

  assert.equal(view.cloud.label, "Cloud : disponible");
  assert.equal(view.relay.label, "Relais : disponible");
  assert.equal(view.data.label, "Données : synchronisées");
  assert.equal(view.sync.enabled, false);
  assert.equal(view.sync.label, "Synchronisé");
});

test("les opérations sur le téléphone restent synchronisables sans Cloud", () => {
  const view = buildTeacherOfflineStatus({
    cloud: "unavailable",
    relay: "connected",
    pending: summary({ device_pending: 3, total: 3, at_risk: 3 }),
    syncing: false,
  });

  assert.equal(view.data.label, "Données : 3 sur ce téléphone");
  assert.equal(view.data.tone, "amber");
  assert.equal(view.sync.enabled, true);
  assert.match(view.sync.title, /relais local d’abord/i);
});

test("les données sécurisées sur le relais sont distinguées du téléphone", () => {
  const view = buildTeacherOfflineStatus({
    cloud: "unavailable",
    relay: "connected",
    pending: summary({ relay_secured: 2, total: 2 }),
    syncing: false,
  });

  assert.equal(view.data.label, "Données : 2 sur le relais");
  assert.equal(view.data.tone, "emerald");
  assert.match(view.data.description, /protégées dans l’établissement/i);
});

test("une livraison inconnue est prioritaire sur les autres attentes", () => {
  const view = buildTeacherOfflineStatus({
    cloud: "connected",
    relay: "connected",
    pending: summary({
      device_pending: 1,
      delivery_unknown: 2,
      total: 3,
      at_risk: 3,
    }),
    syncing: false,
  });

  assert.equal(view.data.label, "Données : 2 confirmation Cloud");
  assert.match(view.data.description, /éviter les doublons/i);
});

test("une opération bloquée obtient le niveau d’alerte maximal", () => {
  const view = buildTeacherOfflineStatus({
    cloud: "connected",
    relay: "unavailable",
    pending: summary({ blocked: 1, total: 1, at_risk: 1 }),
    syncing: false,
  });

  assert.equal(view.data.label, "Données : 1 à vérifier");
  assert.equal(view.data.tone, "rose");
});

test("la synchronisation indique explicitement relais puis Cloud", () => {
  const view = buildTeacherOfflineStatus({
    cloud: "unavailable",
    relay: "unavailable",
    pending: summary({ device_pending: 1, total: 1, at_risk: 1 }),
    syncing: true,
  });

  assert.equal(view.data.label, "Données : synchronisation…");
  assert.equal(view.sync.enabled, false);
  assert.match(view.sync.title, /relais local, puis Cloud/i);
});
