"use client";

import {
  cacheGet,
  MON_CAHIER_OFFLINE_SCHEMA_VERSION,
} from "@/lib/offline";
import {
  getClassDeviceCoherentSchedule,
  getOfflineReadiness,
} from "@/lib/offline-readiness";
import { hasInstitutionScopedAdminAttendanceMonitorCache } from "@/lib/local-relay";
import {
  adminEssentialPreparationKey,
  isAdminEssentialPreparationMarker,
  type AdminEssentialPreparationMarker,
} from "@/lib/admin-essential-contract";
import type { OfflineAccessGrantPayload } from "@/lib/offline-auth-contract";

function todayInAbidjan() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function teacherPrepared(payload: OfflineAccessGrantPayload) {
  const readiness = await getOfflineReadiness("teacher");
  const basics = await cacheGet<{ institution_id?: string }>(
    "teacher:inst:basics",
  ).catch(() => null);
  const bootstrap = await cacheGet<{
    schedule_revision?: number;
    slots?: Array<{ items?: Array<{ class_id?: string }> }>;
  }>("teacher:offline:bootstrap").catch(() => null);
  const slots = Array.isArray(bootstrap?.slots) ? bootstrap.slots : [];
  const classIds = Array.from(
    new Set(
      slots
        .flatMap((slot) => (Array.isArray(slot.items) ? slot.items : []))
        .map((item) => String(item?.class_id || "").trim())
        .filter(Boolean),
    ),
  );
  if (
    !readiness ||
    readiness.version !== 5 ||
    readiness.role !== "teacher" ||
    readiness.offline_schema_version !== MON_CAHIER_OFFLINE_SCHEMA_VERSION ||
    readiness.shell_ready !== true ||
    String(basics?.institution_id || "") !== payload.institution_id ||
    readiness.slot_count <= 0 ||
    readiness.data_presence?.slots !== readiness.slot_count ||
    Number(readiness.data_presence?.classes || 0) <= 0 ||
    slots.length !== readiness.slot_count ||
    classIds.length <= 0 ||
    Number(bootstrap?.schedule_revision) !== Number(readiness.schedule_revision)
  ) {
    return false;
  }
  const rosters = await Promise.all(
    classIds.map((classId) =>
      cacheGet<{ items?: unknown[] }>(`teacher:roster:${classId}`).catch(
        () => null,
      ),
    ),
  );
  return rosters.every((roster) => Array.isArray(roster?.items));
}

async function classDevicePrepared(payload: OfflineAccessGrantPayload) {
  const readiness = await getOfflineReadiness("class-device");
  const institutionId = String(readiness?.institution_id || "").trim();
  const classId = String(readiness?.authorized_class_id || "").trim();
  const actorProfileId = String(
    readiness?.authorized_actor_profile_id || "",
  ).trim();
  if (
    !readiness ||
    readiness.version !== 5 ||
    readiness.role !== "class-device" ||
    readiness.offline_schema_version !== MON_CAHIER_OFFLINE_SCHEMA_VERSION ||
    readiness.shell_ready !== true ||
    institutionId !== payload.institution_id ||
    actorProfileId !== payload.user_id ||
    !classId ||
    classId !== payload.class_id ||
    (readiness.class_device_compatibility !== "ready" &&
      readiness.class_device_compatibility !== "ready_local")
  ) {
    return false;
  }
  const schedule = await getClassDeviceCoherentSchedule({
    institutionId,
    classId,
    actorProfileId,
  });
  return Boolean(
    schedule &&
      schedule.institution_id === institutionId &&
      schedule.class_id === classId &&
      String(schedule.actor_profile_id || "") === actorProfileId &&
      schedule.slot_count > 0 &&
      Array.isArray(schedule.rosters?.[classId]?.items),
  );
}

async function adminPrepared(payload: OfflineAccessGrantPayload) {
  const date = todayInAbidjan();
  const attendanceReady = await hasInstitutionScopedAdminAttendanceMonitorCache(
    payload.institution_id,
    date,
    date,
  );
  if (!attendanceReady) return false;

  const marker = await cacheGet<AdminEssentialPreparationMarker>(
    adminEssentialPreparationKey(payload.user_id, payload.institution_id),
  ).catch(() => null);
  return isAdminEssentialPreparationMarker(marker, {
    userId: payload.user_id,
    institutionId: payload.institution_id,
  });
}

export async function isOfflineFunctionPrepared(
  payload: OfflineAccessGrantPayload,
) {
  if (payload.role === "teacher") return await teacherPrepared(payload);
  if (payload.role === "class_device") {
    return await classDevicePrepared(payload);
  }
  return await adminPrepared(payload);
}

export async function assertOfflineFunctionPrepared(
  payload: OfflineAccessGrantPayload,
) {
  if (!(await isOfflineFunctionPrepared(payload))) {
    throw new Error("offline_function_not_prepared");
  }
}
