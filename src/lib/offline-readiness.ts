"use client";

import {
  cacheGet,
  cacheSet,
  MON_CAHIER_SERVICE_WORKER_RELEASE,
} from "@/lib/offline";
import {
  getPreparationWorkerRelease,
  warmAttendanceOfflineShell,
} from "@/lib/offline-preparation-service-worker";
import {
  getParentBulletins,
  getParentChildren,
  getParentConduct,
  getParentEvents,
  getParentGradePeriods,
  getParentGrades,
  getParentNotifications,
  getParentPenalties,
  getParentTextbook,
} from "@/lib/offline-parent";
import {
  checkRelayTeacherConnectivity,
  fetchRelayTeacherOfflineSchedule,
  fetchAdminAttendanceMonitor,
  LocalRelayHttpError,
  type RelayCapabilities,
  type RelayTeacherConnectivityResult,
  type RelayTeacherOfflineSchedule,
} from "@/lib/local-relay";
import { probeCloudSchedule } from "@/lib/cloud-availability";
import { MON_CAHIER_WEB_RELEASE } from "@/lib/offline-release";
import {
  getOfflineStorageProtection,
  offlineStorageProtectionMessage,
  type OfflineStorageProtection,
} from "@/lib/offline-storage-security";
import {
  decideOfflineSchedulePolicy,
  decideTeacherCloudFallbackPolicy,
  type SchedulePolicyStatus,
} from "@/lib/offline-schedule-policy";
import {
  CLASS_DEVICE_COHERENT_BUNDLE_KEY,
  classDeviceReadinessMessage,
  evaluateClassDeviceCoherence,
  isClassDeviceReadyStatus,
  resolveClassDeviceScheduleAuthority,
  validateClassDeviceRelayAccessTokenScope,
  validateClassDeviceScheduleScope,
  type ClassDeviceCoherentBundle,
  type ClassDeviceReadinessStatus,
  type ClassDeviceScheduleAuthoritySource,
} from "@/lib/offlineClassDevice";

export type OfflineRole = "teacher" | "class-device" | "admin" | "parent";

export type OfflineReadiness = {
  version: 4 | 5;
  role: OfflineRole;
  prepared_at: string;
  class_count: number;
  student_count: number;
  slot_count: number;
  evaluation_count: number;
  textbook_assignment_count: number;
  bulletin_count: number;
  parent_child_count: number;
  grades_ready: boolean;
  textbook_ready: boolean;
  consultation_ready: boolean;
  communication_ready: boolean;
  shell_ready: boolean;
  relay_connectivity?: RelayTeacherConnectivityResult;
  web_release?: string;
  service_worker_release?: string;
  schedule_revision?: number | null;
  schedule_generated_at?: string | null;
  data_presence?: {
    classes: number;
    students: number;
    slots: number;
    grades: number;
    textbook_assignments: number;
    assignments: number;
  };
  relay_capabilities?: RelayCapabilities;
  schedule_compatibility?: TeacherScheduleCompatibilityStatus;
  institution_id?: string | null;
  authorized_class_id?: string | null;
  authorized_actor_profile_id?: string | null;
  relay_revision?: number | null;
  cloud_revision?: number | null;
  checked_at?: string | null;
  class_device_compatibility?: ClassDeviceReadinessStatus;
  storage_protection?: OfflineStorageProtection;
  attendance_core_ready?: boolean;
  queues_ready?: boolean;
  open_session_ready?: boolean;
  identity_ready?: boolean;
  preparation_scope?: "attendance-core" | "legacy";
  actor_profile_id?: string | null;
};

export type TeacherScheduleCompatibilityStatus =
  | Exclude<SchedulePolicyStatus, "refresh_from_relay">
  | "ready_local";

export type TeacherScheduleAssessment = {
  status: TeacherScheduleCompatibilityStatus;
  message: string;
  readiness: OfflineReadiness | null;
  cloud_reachable: boolean;
  phone_revision: number | null;
  relay_revision: number | null;
  cloud_revision: number | null;
};

export type ClassDeviceScheduleAssessment = {
  status: ClassDeviceReadinessStatus;
  message: string;
  readiness: OfflineReadiness | null;
  cloud_reachable: boolean;
  phone_revision: number | null;
  relay_revision: number | null;
  cloud_revision: number | null;
  schedule: RelayTeacherOfflineSchedule | null;
};

export type ClassDeviceAuthoritativeScheduleResolution =
  ClassDeviceScheduleAssessment & {
    allowed: boolean;
    source: ClassDeviceScheduleAuthoritySource | null;
    revision: number | null;
  };

export type ClassDeviceAssessmentContext = {
  institutionId?: string | null;
  classId?: string | null;
  actorProfileId?: string | null;
  relayBaseUrl?: string | null;
  relayAccessToken?: string | null;
};

type ProgressCallback = (message: string) => void;

type TeacherBootstrap = {
  version?: number;
  institution_id?: string | null;
  web_release?: string;
  schedule_revision?: number | null;
  snapshot_completeness?: "complete" | "partial";
  generated_at?: string | null;
  assignments?: Array<Record<string, unknown>>;
  slots?: Array<{
    key: string;
    items?: GradeClass[];
  }>;
};

type GradeClass = {
  class_id?: string | null;
  class_label?: string | null;
  level?: string | null;
  subject_id?: string | null;
  subject_name?: string | null;
};

const READINESS_PREFIX = "offline:readiness:";

function readinessKey(role: OfflineRole) {
  return `${READINESS_PREFIX}${role}`;
}

function rememberOfflineBookDestinations(destinations: {
  attendance: string;
  grades: string;
}) {
  if (typeof document === "undefined") return;

  const attributes = "Path=/; Max-Age=2592000; SameSite=Lax";
  for (const [book, destination] of Object.entries(destinations)) {
    document.cookie = `mc_last_dest_${book}=${encodeURIComponent(destination)}; ${attributes}`;
  }
}

function responseMessage(payload: any, status: number) {
  return String(payload?.message || payload?.error || `HTTP ${status}`);
}

async function fetchFreshJson<T = any>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) throw new Error(responseMessage(payload, response.status));
  return payload as T;
}

async function fetchAndCache<T = any>(
  url: string,
  key: string,
  signal?: AbortSignal,
): Promise<T> {
  const payload = await fetchFreshJson<T>(url, signal);
  await cacheSet(key, payload);
  return payload;
}

async function mapLimit<T>(
  values: T[],
  limit: number,
  callback: (value: T, index: number) => Promise<void>
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      await callback(values[index], index);
    }
  });
  await Promise.all(workers);
}

function uniqueIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

export async function getOfflineReadiness(role: OfflineRole): Promise<OfflineReadiness | null> {
  if (role === "class-device") {
    const bundle = await cacheGet<
      ClassDeviceCoherentBundle<OfflineReadiness, RelayTeacherOfflineSchedule>
    >(CLASS_DEVICE_COHERENT_BUNDLE_KEY).catch(() => null);
    if (
      bundle?.schema_version === 1 &&
      bundle.readiness?.version === 5 &&
      bundle.readiness.role === "class-device"
    ) {
      return bundle.readiness;
    }
  }
  const value = await cacheGet<OfflineReadiness>(readinessKey(role));
  return (value?.version === 4 || value?.version === 5) && value.role === role
    ? value
    : null;
}

async function checkRelayWithin(
  input: Parameters<typeof checkRelayTeacherConnectivity>[0],
  signal?: AbortSignal,
  timeoutMs = 4_000,
): Promise<RelayTeacherConnectivityResult> {
  if (signal?.aborted) {
    throw signal.reason || new Error("Préparation annulée.");
  }
  const checkedAt = new Date().toISOString();
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeout = new Promise<RelayTeacherConnectivityResult>((resolve) => {
    timer = globalThis.setTimeout(
      () => resolve({ status: "unreachable", checked_at: checkedAt }),
      Math.max(1, timeoutMs),
    );
  });
  try {
    return await Promise.race([
      checkRelayTeacherConnectivity(input),
      timeout,
    ]);
  } finally {
    if (timer !== null) globalThis.clearTimeout(timer);
  }
}

function completeRelayCapabilities(capabilities?: RelayCapabilities) {
  return Boolean(
    capabilities?.attendance_session_open &&
      capabilities.attendance_write &&
      capabilities.attendance_session_close &&
      capabilities.attendance_transition,
  );
}

function safeRevision(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

async function applyTeacherScheduleFromRelay(
  readiness: OfflineReadiness,
  basics: any,
) {
  const schedule = await fetchRelayTeacherOfflineSchedule({
    institutionId: String(basics?.institution_id || ""),
    baseUrl: String(basics?.attendance_presence?.relay_local_url || ""),
    accessToken: String(basics?.attendance_presence?.relay_access_token || ""),
  });
  await cacheSet("teacher:offline:bootstrap", schedule);
  for (const slot of schedule.slots) {
    await cacheSet(`teacher:classes:${slot.key}`, {
      items: slot.items,
      has_active_slot: true,
      scheduled_for_slot: slot.items.length > 0,
    });
  }
  for (const [classId, roster] of Object.entries(schedule.rosters || {})) {
    await cacheSet(`teacher:roster:${classId}`, roster);
  }

  const studentIds = new Set<string>();
  for (const roster of Object.values(schedule.rosters || {})) {
    for (const student of roster.items || []) {
      const id = String(student?.id || "").trim();
      if (id) studentIds.add(id);
    }
  }
  const next: OfflineReadiness = {
    ...readiness,
    version: 5,
    prepared_at: new Date().toISOString(),
    class_count: schedule.class_count,
    student_count: studentIds.size,
    slot_count: schedule.slot_count,
    schedule_revision: schedule.schedule_revision,
    schedule_generated_at: schedule.generated_at,
    data_presence: {
      classes: schedule.class_count,
      students: studentIds.size,
      slots: schedule.slot_count,
      grades: readiness.evaluation_count,
      textbook_assignments: readiness.textbook_assignment_count,
      assignments: schedule.assignments.length,
    },
  };
  await cacheSet(readinessKey("teacher"), next);
  return next;
}

export async function assessTeacherOfflineReadiness(
  initial: OfflineReadiness | null,
): Promise<TeacherScheduleAssessment> {
  const base = {
    readiness: initial,
    cloud_reachable: false,
    phone_revision: safeRevision(initial?.schedule_revision),
    relay_revision: null,
    cloud_revision: null,
  };
  if (
    !initial ||
    initial.version !== 5 ||
    initial.role !== "teacher" ||
    initial.web_release !== MON_CAHIER_WEB_RELEASE ||
    initial.service_worker_release !== MON_CAHIER_SERVICE_WORKER_RELEASE ||
    initial.data_presence?.slots !== initial.slot_count ||
    Number(initial.data_presence?.slots || 0) <= 0 ||
    Number(initial.data_presence?.classes || 0) <= 0
  ) {
    return {
      ...base,
      status: "not_prepared",
      message: "La préparation de cet appareil doit être actualisée.",
    };
  }

  const basics: any = await cacheGet("teacher:inst:basics").catch(() => null);
  const institutionId = String(basics?.institution_id || "").trim();
  const relayPolicy = basics?.attendance_presence || {};
  if (!institutionId) {
    return {
      ...base,
      status: "not_prepared",
      message: "L’établissement associé à cette préparation est absent.",
    };
  }

  const relayConfigured = Boolean(
    relayPolicy?.allow_local_relay !== false &&
      String(relayPolicy?.relay_local_url || "").trim() &&
      String(relayPolicy?.relay_access_token || "").trim(),
  );
  const [cloudProbe, relay, serviceWorkerRelease] = await Promise.all([
    probeCloudSchedule(),
    relayConfigured
      ? checkRelayTeacherConnectivity({
          institutionId,
          baseUrl: String(relayPolicy.relay_local_url),
          accessToken: String(relayPolicy.relay_access_token),
        })
      : Promise.resolve<RelayTeacherConnectivityResult>({
          status: "unreachable",
          checked_at: new Date().toISOString(),
        }),
    getPreparationWorkerRelease(),
  ]);
  const cloud =
    cloudProbe &&
    String(cloudProbe.institution_id || "").trim() === institutionId
      ? cloudProbe
      : null;
  const cloudRevision = safeRevision(cloud?.schedule_revision);
  const relayRevision = safeRevision(relay.snapshot_revision);
  const state = {
    ...base,
    cloud_reachable: Boolean(cloud),
    relay_revision: relayRevision,
    cloud_revision: cloudRevision,
  };
  if (serviceWorkerRelease !== MON_CAHIER_SERVICE_WORKER_RELEASE) {
    return {
      ...state,
      status: "not_prepared",
      message:
        "Le service worker actif n’est pas celui de cette version Web. Rechargez l’application puis réessayez.",
    };
  }
  const initialPolicy = decideOfflineSchedulePolicy({
    phone_prepared: true,
    relay_status: relay.status,
    relay_contract_complete:
      relay.teacher_attendance_writes_enabled === true &&
      completeRelayCapabilities(relay.capabilities),
    phone_revision: base.phone_revision,
    relay_revision: relayRevision,
    cloud_revision: cloudRevision,
  });
  if (initialPolicy === "not_prepared") {
    return {
      ...state,
      status: "not_prepared",
      message: "La préparation ne contient pas de révision complète.",
    };
  }
  if (
    initialPolicy === "relay_unreachable" ||
    initialPolicy === "relay_access_denied" ||
    initialPolicy === "relay_permission_denied" ||
    initialPolicy === "browser_incompatible"
  ) {
    const activeGpsZoneCount = Array.isArray(relayPolicy?.zones)
      ? relayPolicy.zones.filter((zone: any) => zone?.is_active !== false).length
      : 0;
    const cloudFallback = decideTeacherCloudFallbackPolicy({
      phone_prepared: true,
      phone_revision: base.phone_revision,
      cloud_reachable: Boolean(cloud),
      cloud_revision: cloudRevision,
      presence_required: relayPolicy?.enabled === true,
      gps_fallback_allowed: relayPolicy?.allow_gps_fallback === true,
      active_gps_zone_count: activeGpsZoneCount,
    });

    if (cloudFallback === "ready_cloud" || cloudFallback === "ready_cloud_gps") {
      return {
        ...state,
        status: "ready",
        message:
          cloudFallback === "ready_cloud_gps"
            ? "Relais local indisponible : le Cloud et le téléphone utilisent la même révision. Le GPS sera vérifié au démarrage de l’appel."
            : "Relais local indisponible : le Cloud et le téléphone utilisent la même révision.",
      };
    }
    if (cloudFallback === "phone_stale") {
      return {
        ...state,
        status: "phone_stale",
        message:
          "Le Cloud est plus récent que ce téléphone. Actualisez la préparation avant de commencer l’appel.",
      };
    }
    if (cloudFallback === "sources_diverged") {
      return {
        ...state,
        status: "sources_diverged",
        message:
          "La révision de ce téléphone est plus récente que celle du Cloud. Une vérification administrative est nécessaire.",
      };
    }
    if (cloudFallback === "gps_fallback_disabled") {
      return {
        ...state,
        status: initialPolicy,
        message:
          "Le relais local est indisponible et le secours GPS n’est pas autorisé pour cet établissement.",
      };
    }
    if (cloudFallback === "gps_zones_missing") {
      return {
        ...state,
        status: "relay_unreachable",
        message:
          "Le relais local est indisponible et aucune zone GPS active n’est configurée pour autoriser le secours Cloud.",
      };
    }

    return {
      ...state,
      status: initialPolicy,
      message:
        initialPolicy === "relay_permission_denied"
          ? "La permission d’accès au réseau local est refusée et le Cloud n’est pas disponible pour le secours GPS."
          : initialPolicy === "browser_incompatible"
            ? "Ce navigateur ne peut pas contrôler le relais local et le Cloud n’est pas disponible pour le secours GPS."
            : initialPolicy === "relay_access_denied"
              ? "Le relais refuse le jeton professeur signé et le Cloud n’est pas disponible pour le secours GPS."
              : "Le relais local et le Cloud sont indisponibles.",
    };
  }
  if (initialPolicy === "relay_incompatible") {
    return {
      ...state,
      status: "relay_incompatible",
      message:
        "Le relais ne confirme pas toutes les capacités d’appel ou sa révision complète.",
    };
  }

  let readiness = initial;
  let phoneRevision = safeRevision(readiness.schedule_revision);
  if (initialPolicy === "refresh_from_relay") {
    try {
      readiness = await applyTeacherScheduleFromRelay(readiness, basics);
      phoneRevision = safeRevision(readiness.schedule_revision);
    } catch {
      return {
        ...state,
        status: "phone_stale",
        message:
          "Le relais est plus récent, mais l’actualisation professeur sécurisée a échoué.",
      };
    }
  }

  const withPhone = {
    ...state,
    readiness,
    phone_revision: phoneRevision,
  };
  const finalPolicy = decideOfflineSchedulePolicy({
    phone_prepared: true,
    relay_status: relay.status,
    relay_contract_complete:
      relay.teacher_attendance_writes_enabled === true &&
      completeRelayCapabilities(relay.capabilities),
    phone_revision: phoneRevision,
    relay_revision: relayRevision,
    cloud_revision: cloudRevision,
  });
  if (finalPolicy === "relay_stale" || finalPolicy === "sources_diverged") {
    return {
      ...withPhone,
      status: finalPolicy,
      message:
        finalPolicy === "relay_stale" &&
        cloudRevision !== null &&
        relayRevision !== null &&
        relayRevision < cloudRevision
          ? "Le Cloud est plus récent que le relais. L’administration doit réactualiser le relais."
          : finalPolicy === "relay_stale"
            ? "Le téléphone est plus récent que le relais."
            : "Les révisions du Cloud et du relais divergent.",
    };
  }
  if (finalPolicy === "phone_stale") {
    return {
      ...withPhone,
      status: "phone_stale",
      message: "Les données d’appel de ce téléphone doivent être actualisées.",
    };
  }
  if (finalPolicy === "refresh_from_relay" || finalPolicy === "not_prepared") {
    return {
      ...withPhone,
      status: "phone_stale",
      message: "Les données d’appel de ce téléphone doivent être actualisées.",
    };
  }
  return {
    ...withPhone,
    status: "ready",
    message: cloud
      ? "Cloud, relais et téléphone utilisent la même révision."
      : "Cloud indisponible : le relais et le téléphone utilisent la même révision.",
  };
}

type CachedClassDevice = {
  id?: string | null;
  institution_id?: string | null;
  actor_profile_id?: string | null;
  attendance_presence?: {
    enabled?: boolean;
    allow_local_relay?: boolean;
    access_contract_version?: number | null;
    actor_kind?: "class_device" | null;
    authorized_class_id?: string | null;
    authorized_actor_profile_id?: string | null;
    relay_local_url?: string | null;
    relay_access_token?: string | null;
    diagnostic?: string | null;
  } | null;
};

type ResolvedClassDeviceContext = {
  institutionId: string;
  classId: string;
  actorProfileId: string;
  relayBaseUrl: string;
  relayAccessToken: string;
};

export function classDeviceAccessDiagnosticMessage(value: unknown) {
  const messages: Record<string, string> = {
    institution_id_missing:
      "L’identifiant de l’établissement de la classe est absent.",
    class_id_missing:
      "L’identifiant de la classe autorisée est absent.",
    relay_policy_missing:
      "La politique d’accès au relais est absente pour cet établissement.",
    relay_disabled:
      "L’accès au relais est désactivé pour cet établissement.",
    relay_local_access_disabled:
      "L’accès local au relais n’est pas autorisé pour cet établissement.",
    relay_url_missing:
      "L’adresse locale du relais est absente de la politique.",
    relay_secret_missing:
      "La clé de signature du relais est absente de la politique.",
    relay_secret_too_short:
      "La clé de signature du relais est invalide ou trop courte.",
    relay_access_contract_stale:
      "Le serveur Web fournit encore un ancien contrat d’accès pour ce téléphone de classe.",
    relay_access_scope_mismatch:
      "Le jeton signé ne correspond pas à la classe ou à l’appareil actuellement connecté.",
  };
  return messages[String(value || "")] || null;
}

export function resolveClassDevicePreparationAccess(classPayload: unknown) {
  const payload = classPayload as { items?: CachedClassDevice[] } | null;
  const classes = Array.isArray(payload?.items) ? payload.items : [];
  const classIds = uniqueIds(classes.map((item) => item?.id));
  if (classIds.length !== 1) {
    throw new Error(classDeviceReadinessMessage("class_data_missing"));
  }
  const classId = classIds[0];
  const selectedClass = classes.find(
    (item) => String(item?.id || "").trim() === classId,
  );
  const institutionId = String(selectedClass?.institution_id || "").trim();
  const actorProfileId = String(
    selectedClass?.actor_profile_id || "",
  ).trim();
  const relayPolicy = selectedClass?.attendance_presence;
  if (
    !institutionId ||
    !actorProfileId ||
    !relayPolicy?.enabled ||
    relayPolicy.allow_local_relay === false ||
    !relayPolicy.relay_local_url ||
    !relayPolicy.relay_access_token
  ) {
    throw new Error(
      classDeviceAccessDiagnosticMessage(relayPolicy?.diagnostic) ||
        "Les données d’accès signées de la classe autorisée au relais sont absentes.",
    );
  }
  if (
    relayPolicy.access_contract_version !== 2 ||
    relayPolicy.actor_kind !== "class_device"
  ) {
    throw new Error(
      classDeviceAccessDiagnosticMessage("relay_access_contract_stale")!,
    );
  }
  if (
    String(relayPolicy.authorized_class_id || "").trim() !== classId ||
    String(relayPolicy.authorized_actor_profile_id || "").trim() !==
      actorProfileId
  ) {
    throw new Error(
      classDeviceAccessDiagnosticMessage("relay_access_scope_mismatch")!,
    );
  }
  const tokenScope = validateClassDeviceRelayAccessTokenScope(
    relayPolicy.relay_access_token,
    { institutionId, classId, actorProfileId },
  );
  if (!tokenScope.ok && "status" in tokenScope) {
    throw new Error(classDeviceReadinessMessage(tokenScope.status));
  }
  return {
    classes,
    classId,
    selectedClass,
    institutionId,
    actorProfileId,
    relayPolicy: {
      relayLocalUrl: relayPolicy.relay_local_url,
      relayAccessToken: relayPolicy.relay_access_token,
    },
  };
}

async function readClassDeviceBundle() {
  const bundle = await cacheGet<
    ClassDeviceCoherentBundle<OfflineReadiness, RelayTeacherOfflineSchedule>
  >(CLASS_DEVICE_COHERENT_BUNDLE_KEY).catch(() => null);
  return bundle?.schema_version === 1 ? bundle : null;
}

async function resolveClassDeviceContext(
  readiness: OfflineReadiness | null,
  requested: ClassDeviceAssessmentContext,
): Promise<ResolvedClassDeviceContext | null> {
  const payload = await cacheGet<{ items?: CachedClassDevice[] }>(
    "classDevice:my-classes",
  ).catch(() => null);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const requestedClassId = String(
    requested.classId || readiness?.authorized_class_id || "",
  ).trim();
  const cached = items.find(
    (item) => String(item?.id || "").trim() === requestedClassId,
  );
  const institutionId = String(
    requested.institutionId ||
      readiness?.institution_id ||
      cached?.institution_id ||
      "",
  ).trim();
  const actorProfileId = String(
    requested.actorProfileId ||
      readiness?.authorized_actor_profile_id ||
      cached?.actor_profile_id ||
      "",
  ).trim();
  const relay = cached?.attendance_presence;
  const relayBaseUrl = String(
    requested.relayBaseUrl || relay?.relay_local_url || "",
  ).trim();
  const relayAccessToken = String(
    requested.relayAccessToken || relay?.relay_access_token || "",
  ).trim();
  if (
    !institutionId ||
    !requestedClassId ||
    !actorProfileId ||
    !relayBaseUrl ||
    !relayAccessToken ||
    relay?.enabled === false ||
    relay?.allow_local_relay === false
  ) {
    return null;
  }
  if (
    relay?.access_contract_version !== 2 ||
    relay.actor_kind !== "class_device" ||
    String(relay.authorized_class_id || "").trim() !== requestedClassId ||
    String(relay.authorized_actor_profile_id || "").trim() !== actorProfileId
  ) {
    return null;
  }
  const tokenScope = validateClassDeviceRelayAccessTokenScope(
    relayAccessToken,
    {
      institutionId,
      classId: requestedClassId,
      actorProfileId,
    },
  );
  if (!tokenScope.ok) return null;
  return {
    institutionId,
    classId: requestedClassId,
    actorProfileId,
    relayBaseUrl,
    relayAccessToken,
  };
}

function classDeviceAssessment(
  status: ClassDeviceReadinessStatus,
  state: Omit<ClassDeviceScheduleAssessment, "status" | "message">,
  message = classDeviceReadinessMessage(status),
): ClassDeviceScheduleAssessment {
  return { ...state, status, message };
}

function scheduleFetchFailureStatus(error: unknown): ClassDeviceReadinessStatus {
  if (error instanceof LocalRelayHttpError) {
    if (error.status === 401 || error.status === 403) {
      return "relay_access_denied";
    }
    if (
      error.code === "schedule_snapshot_not_prepared" ||
      error.code === "teacher_offline_schedule_failed"
    ) {
      return "schedule_not_prepared";
    }
  }
  if (
    error instanceof Error &&
    (error.message === "relay_schedule_snapshot_invalid" ||
      error.message === "schedule_snapshot_not_prepared")
  ) {
    return "schedule_not_prepared";
  }
  return "relay_unreachable";
}

async function persistClassDeviceBundle(
  readiness: OfflineReadiness,
  schedule: RelayTeacherOfflineSchedule,
) {
  const bundle: ClassDeviceCoherentBundle<
    OfflineReadiness,
    RelayTeacherOfflineSchedule
  > = {
    schema_version: 1,
    readiness,
    schedule,
  };
  // Cette écriture KV unique est le point de validation atomique. Les caches
  // historiques ci-dessous ne sont que des projections de consultation.
  await cacheSet(CLASS_DEVICE_COHERENT_BUNDLE_KEY, bundle);
  await cacheSet(readinessKey("class-device"), readiness).catch(() => undefined);
}

async function projectClassDeviceScheduleCaches(
  schedule: RelayTeacherOfflineSchedule,
  classId: string,
) {
  const roster = schedule.rosters?.[classId];
  if (roster) {
    await cacheSet(`classDevice:roster:${classId}`, roster).catch(
      () => undefined,
    );
  }
  await Promise.all(
    schedule.slots.map(async (slot) => {
      const subjects = slot.items
        .filter((item) => item.class_id === classId)
        .map((item) => ({
          id: item.subject_id,
          label: item.subject_name,
        }));
      await cacheSet(`classDevice:subjects:${classId}:${slot.key}`, {
        items: subjects,
      }).catch(() => undefined);
    }),
  );
}

function refreshedClassDeviceReadiness(
  readiness: OfflineReadiness,
  schedule: RelayTeacherOfflineSchedule,
  relay: RelayTeacherConnectivityResult,
  cloudRevision: number | null,
  serviceWorkerRelease: string,
) {
  const classId = String(schedule.class_id || "");
  const roster = schedule.rosters?.[classId];
  const studentCount = Array.isArray(roster?.items) ? roster.items.length : 0;
  return {
    ...readiness,
    version: 5 as const,
    role: "class-device" as const,
    prepared_at: new Date().toISOString(),
    checked_at: new Date().toISOString(),
    class_count: 1,
    student_count: studentCount,
    slot_count: schedule.slot_count,
    shell_ready: true,
    service_worker_release: serviceWorkerRelease,
    institution_id: schedule.institution_id,
    authorized_class_id: classId,
    authorized_actor_profile_id: String(
      schedule.actor_profile_id || "",
    ).trim(),
    schedule_revision: schedule.schedule_revision,
    schedule_generated_at: schedule.generated_at,
    relay_revision: safeRevision(relay.snapshot_revision),
    cloud_revision: cloudRevision,
    relay_connectivity: relay,
    relay_capabilities: relay.capabilities,
    class_device_compatibility: "ready" as const,
    data_presence: {
      classes: 1,
      students: studentCount,
      slots: schedule.slot_count,
      grades: readiness.evaluation_count,
      textbook_assignments: readiness.textbook_assignment_count,
      assignments: schedule.assignments.length,
    },
  } satisfies OfflineReadiness;
}

export async function getClassDeviceCoherentSchedule(input: {
  institutionId: string;
  classId: string;
  actorProfileId: string;
}) {
  const bundle = await readClassDeviceBundle();
  const validation = validateClassDeviceScheduleScope(bundle?.schedule, input);
  return validation.ok ? bundle!.schedule : null;
}

export async function assessClassDeviceOfflineReadiness(
  initial: OfflineReadiness | null,
  requested: ClassDeviceAssessmentContext = {},
): Promise<ClassDeviceScheduleAssessment> {
  const bundle = await readClassDeviceBundle();
  const readiness =
    bundle?.readiness?.version === 5 &&
    bundle.readiness.role === "class-device"
      ? bundle.readiness
      : initial;
  const context = await resolveClassDeviceContext(readiness, requested);
  const institutionId = String(
    requested.institutionId || readiness?.institution_id || "",
  ).trim();
  const classId = String(
    requested.classId || readiness?.authorized_class_id || "",
  ).trim();
  const actorProfileId = String(
    requested.actorProfileId ||
      readiness?.authorized_actor_profile_id ||
      "",
  ).trim();
  const expectedScope = { institutionId, classId, actorProfileId };
  const [cloud, activeServiceWorkerRelease] = await Promise.all([
    probeCloudSchedule(),
    getPreparationWorkerRelease(),
  ]);
  const cloudRevision = safeRevision(cloud?.schedule_revision);
  const bundleValidation = validateClassDeviceScheduleScope(
    bundle?.schedule,
    expectedScope,
  );
  const preparedSchedule = bundleValidation.ok ? bundle!.schedule : null;
  const baseState = {
    readiness,
    cloud_reachable: Boolean(cloud),
    phone_revision: safeRevision(readiness?.schedule_revision),
    relay_revision: null,
    cloud_revision: cloudRevision,
    schedule: preparedSchedule,
  };

  const preflight = evaluateClassDeviceCoherence({
    readiness,
    expected_web_release: MON_CAHIER_WEB_RELEASE,
    expected_service_worker_release: MON_CAHIER_SERVICE_WORKER_RELEASE,
    active_service_worker_release: activeServiceWorkerRelease,
    expected_institution_id: institutionId,
    expected_class_id: classId,
    expected_actor_profile_id: actorProfileId,
    bundle_present: Boolean(bundle),
    bundle_schedule_revision: bundleValidation.ok
      ? bundleValidation.revision
      : null,
    bundle_scope_valid: bundleValidation.ok,
    relay_status: "unreachable",
    relay_institution_id: null,
    relay_actor_kind: null,
    relay_class_id: null,
    relay_actor_profile_id: null,
    relay_schedule_available: false,
    relay_revision: null,
    cloud_revision: cloudRevision,
    relay_writes_enabled: false,
    relay_capabilities: null,
  });
  if (preflight !== "relay_unreachable") {
    return classDeviceAssessment(preflight, baseState);
  }
  if (!context) {
    return classDeviceAssessment(
      "not_prepared",
      baseState,
      "Les données d’accès de la classe autorisée au relais sont absentes. Relancez la préparation.",
    );
  }

  const relay = await checkRelayTeacherConnectivity({
    institutionId: context.institutionId,
    baseUrl: context.relayBaseUrl,
    accessToken: context.relayAccessToken,
  });
  const relayRevision = safeRevision(relay.snapshot_revision);
  const withRelay = {
    ...baseState,
    relay_revision: relayRevision,
  };
  if (relay.status !== "reachable") {
    const relayFailureStatus =
      relay.status === "access_denied"
        ? "relay_access_denied"
        : relay.status === "permission_denied"
          ? "relay_permission_denied"
          : relay.status === "incompatible_browser"
            ? "browser_incompatible"
            : "relay_unreachable";

    if (relayFailureStatus !== "relay_unreachable") {
      return classDeviceAssessment(relayFailureStatus, withRelay);
    }

    const authority = resolveClassDeviceScheduleAuthority({
      expected: expectedScope,
      preparedSchedule,
      relaySchedule: null,
      relayAvailable: false,
      cloudRevision,
    });
    if (!authority.allowed) {
      return classDeviceAssessment(authority.status, {
        ...withRelay,
        schedule: preparedSchedule,
      });
    }

    const observed = {
      ...readiness!,
      checked_at: new Date().toISOString(),
      relay_revision: relayRevision,
      cloud_revision: cloudRevision,
      relay_connectivity: relay,
      relay_capabilities: relay.capabilities,
      class_device_compatibility: authority.status,
    } satisfies OfflineReadiness;
    try {
      await persistClassDeviceBundle(observed, authority.schedule);
    } catch {
      return classDeviceAssessment(
        "phone_stale",
        { ...withRelay, schedule: null },
        "Le planning local est cohérent, mais sa validation atomique a échoué. Relancez la préparation.",
      );
    }
    return classDeviceAssessment(authority.status, {
      readiness: observed,
      cloud_reachable: Boolean(cloud),
      phone_revision: authority.revision,
      relay_revision: relayRevision,
      cloud_revision: cloudRevision,
      schedule: authority.schedule,
    });
  }

  let relaySchedule: RelayTeacherOfflineSchedule;
  try {
    relaySchedule = await fetchRelayTeacherOfflineSchedule({
      institutionId: context.institutionId,
      baseUrl: context.relayBaseUrl,
      accessToken: context.relayAccessToken,
    });
  } catch (error) {
    return classDeviceAssessment(scheduleFetchFailureStatus(error), withRelay);
  }
  const relayScope = validateClassDeviceScheduleScope(
    relaySchedule,
    expectedScope,
  );
  if (!relayScope.ok && "status" in relayScope) {
    return classDeviceAssessment(relayScope.status, {
      ...withRelay,
      schedule: preparedSchedule,
    });
  }

  const evaluated = evaluateClassDeviceCoherence({
    readiness,
    expected_web_release: MON_CAHIER_WEB_RELEASE,
    expected_service_worker_release: MON_CAHIER_SERVICE_WORKER_RELEASE,
    active_service_worker_release: activeServiceWorkerRelease,
    expected_institution_id: context.institutionId,
    expected_class_id: context.classId,
    expected_actor_profile_id: context.actorProfileId,
    bundle_present: Boolean(bundle),
    bundle_schedule_revision: bundleValidation.ok
      ? bundleValidation.revision
      : null,
    bundle_scope_valid: bundleValidation.ok,
    relay_status: relay.status,
    relay_institution_id: relaySchedule.institution_id,
    relay_actor_kind: relaySchedule.actor_kind || null,
    relay_class_id: relaySchedule.class_id || null,
    relay_actor_profile_id: relaySchedule.actor_profile_id || null,
    relay_schedule_available: true,
    relay_revision: relayScope.revision,
    cloud_revision: cloudRevision,
    relay_writes_enabled: relay.teacher_attendance_writes_enabled === true,
    relay_capabilities: relay.capabilities,
  });

  if (evaluated !== "ready" && evaluated !== "refresh_from_relay") {
    const observed =
      readiness?.version === 5
        ? {
            ...readiness,
            checked_at: new Date().toISOString(),
            relay_revision: relayScope.revision,
            cloud_revision: cloudRevision,
            relay_connectivity: relay,
            relay_capabilities: relay.capabilities,
            class_device_compatibility: evaluated,
          }
        : readiness;
    if (observed && preparedSchedule) {
      try {
        await persistClassDeviceBundle(observed, preparedSchedule);
      } catch {
        return classDeviceAssessment(
          "phone_stale",
          { ...withRelay, schedule: null },
          "La vérification est correcte, mais sa conservation atomique a échoué. Relancez la préparation.",
        );
      }
    }
    return classDeviceAssessment(evaluated, {
      readiness: observed,
      cloud_reachable: Boolean(cloud),
      phone_revision: safeRevision(observed?.schedule_revision),
      relay_revision: relayScope.revision,
      cloud_revision: cloudRevision,
      schedule: preparedSchedule,
    });
  }

  const authority = resolveClassDeviceScheduleAuthority({
    expected: expectedScope,
    preparedSchedule,
    relaySchedule,
    relayAvailable: true,
    cloudRevision,
  });
  if (!authority.allowed) {
    return classDeviceAssessment(authority.status, {
      ...withRelay,
      schedule: preparedSchedule,
    });
  }

  const observed = authority.should_persist
    ? refreshedClassDeviceReadiness(
        readiness!,
        authority.schedule,
        relay,
        cloudRevision,
        activeServiceWorkerRelease!,
      )
    : ({
        ...readiness!,
        checked_at: new Date().toISOString(),
        relay_revision: authority.revision,
        cloud_revision: cloudRevision,
        relay_connectivity: relay,
        relay_capabilities: relay.capabilities,
        class_device_compatibility: "ready",
      } satisfies OfflineReadiness);

  try {
    // Même à révision égale, le planning vivant validé devient le bundle utilisé
    // par l’écran et par l’ouverture : aucune ancienne projection ne peut revenir.
    await persistClassDeviceBundle(observed, authority.schedule);
    await projectClassDeviceScheduleCaches(authority.schedule, context.classId);
  } catch {
    return classDeviceAssessment("phone_stale", {
      ...withRelay,
      schedule: null,
    });
  }

  return classDeviceAssessment("ready", {
    readiness: observed,
    cloud_reachable: Boolean(cloud),
    phone_revision: authority.revision,
    relay_revision: authority.revision,
    cloud_revision: cloudRevision,
    schedule: authority.schedule,
  });
}

export async function resolveAuthoritativeClassDeviceSchedule(
  initial: OfflineReadiness | null,
  requested: ClassDeviceAssessmentContext = {},
): Promise<ClassDeviceAuthoritativeScheduleResolution> {
  const assessment = await assessClassDeviceOfflineReadiness(
    initial,
    requested,
  );
  const scope = assessment.schedule
    ? validateClassDeviceScheduleScope(assessment.schedule, {
        institutionId: String(
          requested.institutionId || assessment.readiness?.institution_id || "",
        ).trim(),
        classId: String(
          requested.classId ||
            assessment.readiness?.authorized_class_id ||
            "",
        ).trim(),
        actorProfileId: String(
          requested.actorProfileId ||
            assessment.readiness?.authorized_actor_profile_id ||
            "",
        ).trim(),
      })
    : null;
  const allowed =
    isClassDeviceReadyStatus(assessment.status) &&
    Boolean(assessment.schedule) &&
    scope?.ok === true;

  return {
    ...assessment,
    allowed,
    source: allowed
      ? assessment.status === "ready_local"
        ? "prepared-phone"
        : "relay"
      : null,
    revision: allowed && scope?.ok ? scope.revision : null,
  };
}

async function prepareTeacher(
  onProgress: ProgressCallback,
  signal?: AbortSignal,
): Promise<OfflineReadiness> {
  onProgress("Téléchargement du noyau d’appel professeur…");
  const bootstrap = await fetchAndCache<TeacherBootstrap>(
    "/api/teacher/offline/bootstrap",
    "teacher:offline:bootstrap",
    signal,
  );
  const scheduleRevision = safeRevision(bootstrap?.schedule_revision);
  const slots = Array.isArray(bootstrap?.slots) ? bootstrap.slots : [];
  if (
    bootstrap?.snapshot_completeness !== "complete" ||
    scheduleRevision === null ||
    !String(bootstrap?.institution_id || "").trim()
  ) {
    throw new Error("Le planning professeur reçu du Cloud est incomplet.");
  }

  for (const slot of slots) {
    if (!slot?.key) continue;
    const items = Array.isArray(slot.items) ? slot.items : [];
    await cacheSet(`teacher:classes:${slot.key}`, {
      items,
      has_active_slot: true,
      scheduled_for_slot: items.length > 0,
    });
  }

  onProgress("Vérification de l’identité et de l’établissement…");
  const [identity, basics] = await Promise.all([
    fetchAndCache<any>("/api/auth/role", "teacher:offline:identity", signal),
    fetchAndCache<any>(
      "/api/teacher/institution/basics",
      "teacher:inst:basics",
      signal,
    ),
  ]);
  const institutionId = String(bootstrap.institution_id || "").trim();
  const actorProfileId = String(identity?.user_id || "").trim();
  if (
    !actorProfileId ||
    String(identity?.institution_id || "").trim() !== institutionId ||
    String(basics?.institution_id || "").trim() !== institutionId
  ) {
    throw new Error("L’identité locale ne correspond pas au planning professeur.");
  }

  const relayPolicy = basics?.attendance_presence || {};
  const relayConfigured = Boolean(
    relayPolicy?.allow_local_relay !== false &&
      String(relayPolicy?.relay_local_url || "").trim() &&
      String(relayPolicy?.relay_access_token || "").trim(),
  );
  const relayConnectivityPromise: Promise<RelayTeacherConnectivityResult> = relayConfigured
    ? checkRelayWithin(
        {
          institutionId,
          baseUrl: String(relayPolicy.relay_local_url),
          accessToken: String(relayPolicy.relay_access_token),
        },
        signal,
      )
    : Promise.resolve({
        status: "unreachable",
        checked_at: new Date().toISOString(),
      } satisfies RelayTeacherConnectivityResult);

  const classIds = uniqueIds(
    slots.flatMap((slot) => (slot.items || []).map((item) => item.class_id || null)),
  );
  const studentIds = new Set<string>();
  onProgress(`Téléchargement de ${classIds.length} liste(s) d’élèves…`);
  await mapLimit(classIds, 4, async (classId, index) => {
    if (signal?.aborted) throw signal.reason || new Error("Préparation annulée.");
    onProgress(`Listes d’élèves ${index + 1}/${classIds.length}…`);
    const roster: any = await fetchAndCache(
      `/api/teacher/roster?class_id=${encodeURIComponent(classId)}`,
      `teacher:roster:${classId}`,
      signal,
    );
    for (const student of Array.isArray(roster?.items) ? roster.items : []) {
      const id = String(student?.id || "").trim();
      if (id) studentIds.add(id);
    }
  });

  onProgress("Vérification de la séance professeur ouverte…");
  await fetchAndCache(
    "/api/teacher/sessions/open",
    "teacher:open-session",
    signal,
  );

  onProgress("Préparation du seul écran d’appel…");
  await warmAttendanceOfflineShell(["/login", "/attendance"], { signal });
  rememberOfflineBookDestinations({ attendance: "/attendance", grades: "/grades" });
  const activeServiceWorkerRelease = await getPreparationWorkerRelease(signal);
  if (activeServiceWorkerRelease !== MON_CAHIER_SERVICE_WORKER_RELEASE) {
    throw new Error(
      "Le service hors ligne actif ne correspond pas à cette version de l’application.",
    );
  }
  const relayConnectivity = await relayConnectivityPromise;

  const relayRevision = safeRevision(relayConnectivity.snapshot_revision);
  const relayReady =
    relayConnectivity.status === "reachable" &&
    relayConnectivity.teacher_attendance_writes_enabled === true &&
    completeRelayCapabilities(relayConnectivity.capabilities) &&
    relayRevision === scheduleRevision;

  return {
    version: 5,
    role: "teacher",
    prepared_at: new Date().toISOString(),
    checked_at: new Date().toISOString(),
    class_count: classIds.length,
    student_count: studentIds.size,
    slot_count: slots.length,
    evaluation_count: 0,
    textbook_assignment_count: 0,
    bulletin_count: 0,
    parent_child_count: 0,
    grades_ready: false,
    textbook_ready: false,
    consultation_ready: false,
    communication_ready: false,
    shell_ready: true,
    attendance_core_ready: true,
    queues_ready: true,
    open_session_ready: true,
    identity_ready: true,
    preparation_scope: "attendance-core",
    actor_profile_id: actorProfileId,
    institution_id: institutionId,
    relay_connectivity: relayConnectivity,
    relay_capabilities: relayConnectivity.capabilities,
    web_release: String(bootstrap.web_release || MON_CAHIER_WEB_RELEASE),
    service_worker_release: activeServiceWorkerRelease,
    schedule_revision: scheduleRevision,
    schedule_generated_at: String(bootstrap.generated_at || "") || null,
    relay_revision: relayRevision,
    cloud_revision: scheduleRevision,
    schedule_compatibility: relayReady ? "ready" : "ready_local",
    data_presence: {
      classes: classIds.length,
      students: studentIds.size,
      slots: slots.length,
      grades: 0,
      textbook_assignments: 0,
      assignments: Array.isArray(bootstrap.assignments)
        ? bootstrap.assignments.length
        : 0,
    },
  };
}

async function prepareClassDevice(
  onProgress: ProgressCallback,
  signal?: AbortSignal,
): Promise<OfflineReadiness> {
  onProgress("Téléchargement du planning strict de la classe…");
  const classPayload: any = await fetchAndCache(
    "/api/class/my-classes?offline_contract=v5",
    "classDevice:my-classes",
    signal,
  );
  const preparedAccess = resolveClassDevicePreparationAccess(classPayload);
  const { classId, institutionId, actorProfileId } = preparedAccess;
  const relayPolicy = preparedAccess.relayPolicy;
  const cloudSchedule = classPayload?.offline_schedule as
    | RelayTeacherOfflineSchedule
    | null
    | undefined;
  const cloudScope = cloudSchedule
    ? validateClassDeviceScheduleScope(cloudSchedule, {
        institutionId,
        classId,
        actorProfileId,
      })
    : null;
  if (!cloudSchedule || !cloudScope?.ok) {
    throw new Error(classDeviceReadinessMessage("schedule_not_prepared"));
  }

  const relayConnectivityPromise = checkRelayWithin(
    {
      institutionId,
      baseUrl: relayPolicy.relayLocalUrl,
      accessToken: relayPolicy.relayAccessToken,
    },
    signal,
  );

  onProgress("Préparation du seul écran d’appel de la classe…");
  await warmAttendanceOfflineShell(["/login", "/class"], { signal });
  const activeServiceWorkerRelease = await getPreparationWorkerRelease(signal);
  if (activeServiceWorkerRelease !== MON_CAHIER_SERVICE_WORKER_RELEASE) {
    throw new Error(classDeviceReadinessMessage("service_worker_stale"));
  }

  onProgress("Vérification facultative du relais local…");
  const relayConnectivity = await relayConnectivityPromise;
  let authoritativeSchedule = cloudSchedule;
  let relayUsable = false;
  if (
    relayConnectivity.status === "reachable" &&
    relayConnectivity.capabilities?.class_device_scope_v1 === true &&
    relayConnectivity.actor_kind === "class_device" &&
    String(relayConnectivity.class_id || "").trim() === classId &&
    String(relayConnectivity.actor_profile_id || "").trim() === actorProfileId
  ) {
    try {
      const relaySchedule = await fetchRelayTeacherOfflineSchedule({
        institutionId,
        baseUrl: relayPolicy.relayLocalUrl,
        accessToken: relayPolicy.relayAccessToken,
      });
      const relayScope = validateClassDeviceScheduleScope(relaySchedule, {
        institutionId,
        classId,
        actorProfileId,
      });
      if (relayScope.ok && relayScope.revision >= cloudScope.revision) {
        authoritativeSchedule = relaySchedule;
      }
      relayUsable = relayScope.ok;
    } catch {
      relayUsable = false;
    }
  }

  await projectClassDeviceScheduleCaches(authoritativeSchedule, classId);
  await fetchAndCache(
    "/api/teacher/sessions/open",
    "classDevice:open-session",
    signal,
  ).catch(async (error) => {
    if (signal?.aborted) throw error;
    await cacheSet("classDevice:open-session", { item: null });
  });

  const roster = authoritativeSchedule.rosters?.[classId];
  const studentCount = Array.isArray(roster?.items) ? roster.items.length : 0;
  const status = relayUsable ? "ready" : "ready_local";
  const readiness: OfflineReadiness = {
    version: 5,
    role: "class-device",
    prepared_at: new Date().toISOString(),
    checked_at: new Date().toISOString(),
    class_count: 1,
    student_count: studentCount,
    slot_count: authoritativeSchedule.slot_count,
    evaluation_count: 0,
    textbook_assignment_count: 0,
    bulletin_count: 0,
    parent_child_count: 0,
    grades_ready: false,
    textbook_ready: false,
    consultation_ready: false,
    communication_ready: false,
    shell_ready: true,
    attendance_core_ready: true,
    queues_ready: true,
    open_session_ready: true,
    identity_ready: true,
    preparation_scope: "attendance-core",
    actor_profile_id: actorProfileId,
    relay_connectivity: relayConnectivity,
    web_release: MON_CAHIER_WEB_RELEASE,
    service_worker_release: activeServiceWorkerRelease,
    schedule_revision: safeRevision(authoritativeSchedule.schedule_revision),
    schedule_generated_at: authoritativeSchedule.generated_at,
    institution_id: institutionId,
    authorized_class_id: classId,
    authorized_actor_profile_id: actorProfileId,
    relay_revision: safeRevision(relayConnectivity.snapshot_revision),
    cloud_revision: cloudScope.revision,
    relay_capabilities: relayConnectivity.capabilities,
    class_device_compatibility: status,
    data_presence: {
      classes: 1,
      students: studentCount,
      slots: authoritativeSchedule.slot_count,
      grades: 0,
      textbook_assignments: 0,
      assignments: authoritativeSchedule.assignments.length,
    },
  };

  await persistClassDeviceBundle(readiness, authoritativeSchedule);
  return readiness;
}

type AdminAttendancePreparationRow = Record<string, unknown>;

function itemsOf<T = any>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function optional(task: () => Promise<unknown>) {
  try {
    await task();
  } catch {
    // Une ressource facultative ne doit pas annuler toute la préparation.
  }
}

async function prepareAdmin(
  onProgress: ProgressCallback,
  signal?: AbortSignal,
): Promise<OfflineReadiness> {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  onProgress("Préparation de la supervision des appels…");
  const monitor = await fetchAdminAttendanceMonitor<AdminAttendancePreparationRow>(
    today,
    today,
    signal,
  );
  await cacheSet("admin:attendance:core", monitor);
  await warmAttendanceOfflineShell(
    ["/admin/absences/appels", "/admin/absences/appels-matrice"],
    { signal },
  );
  const activeServiceWorkerRelease = await getPreparationWorkerRelease(signal);
  if (activeServiceWorkerRelease !== MON_CAHIER_SERVICE_WORKER_RELEASE) {
    throw new Error("Le service hors ligne Admin doit être actualisé.");
  }

  return {
    version: 5,
    role: "admin",
    prepared_at: new Date().toISOString(),
    class_count: 0,
    student_count: 0,
    slot_count: 0,
    evaluation_count: 0,
    textbook_assignment_count: 0,
    bulletin_count: 0,
    parent_child_count: 0,
    grades_ready: false,
    textbook_ready: false,
    consultation_ready: true,
    communication_ready: false,
    shell_ready: true,
    attendance_core_ready: true,
    queues_ready: true,
    open_session_ready: false,
    identity_ready: true,
    preparation_scope: "attendance-core",
    web_release: MON_CAHIER_WEB_RELEASE,
    service_worker_release: activeServiceWorkerRelease,
    data_presence: {
      classes: 0,
      students: 0,
      slots: 0,
      grades: 0,
      textbook_assignments: 0,
      assignments: 0,
    },
  };
}

type ParentChild = { id?: string | null };
type ParentPeriod = { start_date?: string | null; end_date?: string | null };
type ParentBulletin = { code?: string | null; url?: string | null };

async function prepareParent(onProgress: ProgressCallback): Promise<OfflineReadiness> {
  onProgress("Téléchargement de l’espace parent…");
  const [childrenPayload, periodsPayload, bulletinsPayload] = await Promise.all([
    getParentChildren<any>(),
    getParentGradePeriods<any>(),
    getParentBulletins<any>(),
    getParentNotifications<any>(),
  ]);
  const children = itemsOf<ParentChild>(childrenPayload).filter((item) => item?.id);
  const periods = itemsOf<ParentPeriod>(periodsPayload).filter(
    (item) => item?.start_date && item?.end_date,
  );
  const bulletins = itemsOf<ParentBulletin>(bulletinsPayload);

  onProgress(`Préparation des données de ${children.length} enfant(s)…`);
  await mapLimit(children, 2, async (child, index) => {
    const studentId = String(child.id);
    onProgress(`Enfant ${index + 1}/${children.length} : notes, absences et cahier de texte…`);
    await Promise.all([
      getParentEvents(studentId),
      getParentPenalties(studentId),
      getParentGrades(studentId),
      getParentTextbook(studentId),
    ]);
    if (periods.length) {
      for (const period of periods) {
        await optional(() =>
          getParentConduct(
            studentId,
            String(period.start_date),
            String(period.end_date),
          ),
        );
      }
    } else {
      await optional(() => getParentConduct(studentId));
    }
  });

  const verificationPages = bulletins
    .map((bulletin) => {
      const code = String(bulletin?.code || "").trim();
      if (code) return `/v/${encodeURIComponent(code)}`;
      const rawUrl = String(bulletin?.url || "").trim();
      try {
        const parsed = new URL(rawUrl, window.location.origin);
        return /^\/v\/[^/]+$/.test(parsed.pathname) ? parsed.pathname : null;
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value));

  onProgress("Préparation de la consultation et des bulletins…");
  await warmAttendanceOfflineShell(["/parents", ...Array.from(new Set(verificationPages))]);

  return {
    version: 4,
    role: "parent",
    prepared_at: new Date().toISOString(),
    class_count: 0,
    student_count: children.length,
    slot_count: 0,
    evaluation_count: 0,
    textbook_assignment_count: 0,
    bulletin_count: bulletins.length,
    parent_child_count: children.length,
    grades_ready: true,
    textbook_ready: true,
    consultation_ready: true,
    communication_ready: false,
    shell_ready: true,
  };
}

export async function prepareOffline(
  role: OfflineRole,
  onProgress: ProgressCallback = () => undefined,
  options: { signal?: AbortSignal } = {},
): Promise<OfflineReadiness> {
  const signal = options.signal;
  if (signal?.aborted) throw signal.reason || new Error("Préparation annulée.");
  onProgress("Protection du stockage local…");
  const storageProtection = await getOfflineStorageProtection({
    requestPersistence: true,
  });
  if (storageProtection.status === "low_space") {
    throw new Error(
      offlineStorageProtectionMessage(storageProtection) ||
        "L’espace local disponible est insuffisant.",
    );
  }

  const prepared =
    role === "teacher"
      ? await prepareTeacher(onProgress, signal)
      : role === "class-device"
        ? await prepareClassDevice(onProgress, signal)
        : role === "admin"
          ? await prepareAdmin(onProgress, signal)
          : await prepareParent(onProgress);
  const readiness: OfflineReadiness = {
    ...prepared,
    storage_protection: storageProtection,
  };

  if (role === "class-device") {
    const bundle = await cacheGet<
      ClassDeviceCoherentBundle<OfflineReadiness, RelayTeacherOfflineSchedule>
    >(CLASS_DEVICE_COHERENT_BUNDLE_KEY).catch(() => null);
    if (bundle?.schema_version === 1 && bundle.schedule) {
      await persistClassDeviceBundle(readiness, bundle.schedule);
    }
  }

  await cacheSet(readinessKey(role), readiness);
  return readiness;
}
