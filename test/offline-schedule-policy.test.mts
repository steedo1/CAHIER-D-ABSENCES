import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canUseTeacherCloudFallback,
  decideOfflineSchedulePolicy,
} from "../src/lib/offline-schedule-policy.ts";
import { isOfflineScheduleMutation } from "../src/lib/admin-offline-schedule.ts";

const readyBase = {
  phone_prepared: true,
  relay_status: "reachable" as const,
  relay_contract_complete: true,
  phone_revision: 10,
  relay_revision: 10,
  cloud_revision: 10,
};

test("Wi-Fi local actif avec Cloud coupé reste prêt si téléphone et relais concordent", () => {
  assert.equal(
    decideOfflineSchedulePolicy({ ...readyBase, cloud_revision: null }),
    "ready",
  );
});

test("une révision identique sur les trois sources est prête", () => {
  assert.equal(decideOfflineSchedulePolicy(readyBase), "ready");
});

test("un téléphone ancien peut être actualisé depuis un relais récent compatible", () => {
  assert.equal(
    decideOfflineSchedulePolicy({
      ...readyBase,
      phone_revision: 9,
      relay_revision: 10,
      cloud_revision: 10,
    }),
    "refresh_from_relay",
  );
});

test("un téléphone récent avec un relais ancien est bloqué", () => {
  assert.equal(
    decideOfflineSchedulePolicy({
      ...readyBase,
      phone_revision: 11,
      relay_revision: 10,
      cloud_revision: 11,
    }),
    "relay_stale",
  );
});

test("un relais inaccessible ne peut jamais produire une carte verte", () => {
  assert.equal(
    decideOfflineSchedulePolicy({
      ...readyBase,
      relay_status: "unreachable",
    }),
    "relay_unreachable",
  );
});

test("un ancien relais sans révision complète est incompatible", () => {
  assert.equal(
    decideOfflineSchedulePolicy({
      ...readyBase,
      relay_contract_complete: false,
      relay_revision: null,
    }),
    "relay_incompatible",
  );
});

test("un snapshot partiel ne prépare pas le téléphone", () => {
  assert.equal(
    decideOfflineSchedulePolicy({
      ...readyBase,
      phone_prepared: false,
      phone_revision: null,
    }),
    "not_prepared",
  );
});

test("une divergence multi-source est bloquée", () => {
  assert.equal(
    decideOfflineSchedulePolicy({
      ...readyBase,
      phone_revision: 12,
      relay_revision: 12,
      cloud_revision: 11,
    }),
    "sources_diverged",
  );
});

test("un professeur peut utiliser Cloud + GPS seulement sur la même révision préparée", () => {
  const input = {
    phone_prepared: true,
    phone_revision: 10,
    cloud_reachable: true,
    cloud_revision: 10,
    presence_enabled: true,
    allow_gps_fallback: true,
  };
  assert.equal(canUseTeacherCloudFallback(input), true);
  assert.equal(canUseTeacherCloudFallback({ ...input, cloud_revision: 11 }), false);
  assert.equal(canUseTeacherCloudFallback({ ...input, allow_gps_fallback: false }), false);
});

test("les mutations Paramètres, édition, import et publication déclenchent la propagation", () => {
  for (const path of [
    "/api/admin/institution/periods",
    "/api/admin/timetables/manual",
    "/api/admin/timetables/import",
    "/api/admin/montage-emploi-du-temps/publish",
    "/api/admin/associations",
    "/api/admin/classes/class-1",
    "/api/admin/teachers/subjects/add",
  ]) {
    assert.equal(isOfflineScheduleMutation(path, "POST"), true, path);
  }
  assert.equal(
    isOfflineScheduleMutation("/api/admin/timetables/manual", "GET"),
    false,
  );
  assert.equal(
    isOfflineScheduleMutation("/api/admin/finance/payments", "POST"),
    false,
  );
  assert.equal(
    isOfflineScheduleMutation("/api/admin/teachers/payroll-profile", "POST"),
    false,
  );
  assert.equal(
    isOfflineScheduleMutation("/v1/sync/bootstrap", "POST"),
    false,
  );
});
