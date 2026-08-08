"use client";

import {
  cacheGet,
  cacheSet,
  getActiveOfflineWorkerRelease,
  MON_CAHIER_SERVICE_WORKER_RELEASE,
  warmOfflineShell,
} from "@/lib/offline";
import {
  gradesClassesKey,
  gradesComponentsKey,
  gradesEvaluationsKey,
  gradesLockKey,
  gradesPeriodsKey,
  gradesRosterKey,
  gradesScoresKey,
  gradesSettingsKey,
  type GradesOfflineRole,
} from "@/lib/offline-grades";
import {
  TEXTBOOK_BOOTSTRAP_KEY,
  textbookSlotsKey,
} from "@/lib/offline-textbook";
import {
  getAdminBulletin,
  getAdminBulletinClasses,
  getAdminBulletinConduct,
  getAdminBulletinPeriods,
  getAdminBulletinSettings,
} from "@/lib/offline-bulletins";
import {
  getCommunicationHistory,
  getCommunicationMeta,
} from "@/lib/offline-communication";
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
  fetchAdminAttendanceMonitor,
  fetchInstitutionSettings,
  fetchRelayTeacherOfflineSchedule,
  LocalRelayHttpError,
  syncRelayBootstrap,
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
};

export type TeacherScheduleCompatibilityStatus =
  Exclude<SchedulePolicyStatus, "refresh_from_relay">;

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

type GradePeriod = {
  id?: string | null;
};

type GradeEvaluation = {
  id?: string | null;
};

type TextbookBootstrap = {
  items?: Array<{
    id?: string | null;
    class_id?: string | null;
  }>;
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

async function fetchFreshJson<T = any>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
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

async function fetchAndCache<T = any>(url: string, key: string): Promise<T> {
  const payload = await fetchFreshJson<T>(url);
  await cacheSet(key, payload);
  return payload;
}

async function fetchFirstAndCache<T = any>(
  candidates: Array<{ url: string; key: string }>,
  validator?: (payload: T) => boolean
): Promise<T> {
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const payload = await fetchFreshJson<T>(candidate.url);
      if (validator && !validator(payload)) {
        throw new Error("Aucun créneau administratif n’est disponible.");
      }
      await cacheSet(candidate.key, payload);
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Données de l’établissement indisponibles.");
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

function uniqueGradeClasses(values: GradeClass[]): GradeClass[] {
  const map = new Map<string, GradeClass>();
  for (const item of values) {
    const classId = String(item?.class_id || "").trim();
    if (!classId) continue;
    const subjectId = String(item?.subject_id || "").trim() || null;
    map.set(`${classId}|${subjectId || ""}`, {
      ...item,
      class_id: classId,
      subject_id: subjectId,
    });
  }
  return Array.from(map.values());
}

async function prepareGrades(
  role: GradesOfflineRole,
  onProgress: ProgressCallback
): Promise<{ classIds: string[]; studentIds: Set<string>; evaluationCount: number }> {
  onProgress("Téléchargement des classes du cahier de notes…");
  const classPayload: any = await fetchAndCache(
    "/api/grades/classes",
    gradesClassesKey(role)
  );
  const gradeClasses = uniqueGradeClasses(
    Array.isArray(classPayload?.items) ? classPayload.items : []
  );
  const classIds = uniqueIds(gradeClasses.map((item) => item.class_id));

  const settingsCandidates = [
    "/api/teacher/institution/settings",
    "/api/institution/settings",
    "/api/admin/institution/settings",
  ].map((url) => ({ url, key: gradesSettingsKey(role, url) }));
  try {
    await fetchFirstAndCache(settingsCandidates);
  } catch {
    // Le nom de l'établissement est décoratif ; les notes restent préparables.
  }

  onProgress("Téléchargement des périodes de notes par classe…");
  const periodIdSet = new Set<string>();

  if (classIds.length > 0) {
    await mapLimit(classIds, 4, async (classId, index) => {
      onProgress(`Notes : périodes ${index + 1}/${classIds.length}…`);
      const params = new URLSearchParams({ class_id: classId });
      const suffix = `?${params.toString()}`;
      const periodPayload: any = await fetchFirstAndCache(
        [
          `/api/admin/institution/grading-periods${suffix}`,
          `/api/institution/grading-periods${suffix}`,
          `/api/teacher/institution/grading-periods${suffix}`,
        ].map((url) => ({ url, key: gradesPeriodsKey(role, classId) })),
        (payload: any) => Array.isArray(payload?.items),
      );

      for (const period of Array.isArray(periodPayload?.items)
        ? periodPayload.items
        : []) {
        const id = String((period as GradePeriod)?.id || "").trim();
        if (id) periodIdSet.add(id);
      }
    });
  } else {
    const periodPayload: any = await fetchFirstAndCache(
      [
        "/api/admin/institution/grading-periods",
        "/api/institution/grading-periods",
        "/api/teacher/institution/grading-periods",
      ].map((url) => ({ url, key: gradesPeriodsKey(role) })),
      (payload: any) => Array.isArray(payload?.items),
    );
    for (const period of Array.isArray(periodPayload?.items)
      ? periodPayload.items
      : []) {
      const id = String((period as GradePeriod)?.id || "").trim();
      if (id) periodIdSet.add(id);
    }
  }

  const periodIds = Array.from(periodIdSet);
  const periodVariants: Array<string | null> = periodIds.length ? periodIds : [null];
  const studentIds = new Set<string>();

  onProgress(`Notes : téléchargement de ${classIds.length} liste(s) d’élèves…`);
  await mapLimit(classIds, 4, async (classId, index) => {
    onProgress(`Notes : liste d’élèves ${index + 1}/${classIds.length}…`);
    const rosterUrl =
      role === "teacher"
        ? `/api/teacher/roster?class_id=${encodeURIComponent(classId)}`
        : `/api/grades/roster?class_id=${encodeURIComponent(classId)}`;
    const roster: any = await fetchAndCache(rosterUrl, gradesRosterKey(role, classId));
    for (const student of Array.isArray(roster?.items) ? roster.items : []) {
      const id = String(student?.id || "").trim();
      if (id) studentIds.add(id);
    }
  });

  const componentPairs = gradeClasses.filter(
    (item) => item.class_id && item.subject_id
  );
  await mapLimit(componentPairs, 4, async (item) => {
    const classId = String(item.class_id);
    const subjectId = String(item.subject_id);
    const params = new URLSearchParams({ class_id: classId, subject_id: subjectId });
    await fetchAndCache(
      `/api/teacher/grades/components?${params.toString()}`,
      gradesComponentsKey(role, classId, subjectId)
    );
  });

  const evaluationTasks = gradeClasses.flatMap((item) =>
    periodVariants.map((periodId) => ({ item, periodId }))
  );
  const evaluations = new Map<string, GradeEvaluation>();

  onProgress(
    `Téléchargement de ${evaluationTasks.length} ensemble(s) d’évaluations…`
  );
  await mapLimit(evaluationTasks, 4, async ({ item, periodId }, index) => {
    if (index === 0 || (index + 1) % 5 === 0 || index + 1 === evaluationTasks.length) {
      onProgress(`Évaluations ${index + 1}/${evaluationTasks.length}…`);
    }

    const classId = String(item.class_id || "");
    const subjectId = String(item.subject_id || "").trim() || null;
    const params = new URLSearchParams({ class_id: classId });
    if (subjectId) params.set("subject_id", subjectId);
    if (periodId) params.set("grading_period_id", periodId);
    const endpoint =
      role === "teacher"
        ? `/api/teacher/grades/evaluations?${params.toString()}`
        : `/api/grades/evaluations?${params.toString()}`;
    const payload: any = await fetchAndCache(
      endpoint,
      gradesEvaluationsKey(role, classId, subjectId, periodId)
    );

    for (const evaluation of Array.isArray(payload?.items) ? payload.items : []) {
      const id = String(evaluation?.id || "").trim();
      if (id) evaluations.set(id, evaluation);
    }
  });

  const evaluationList = Array.from(evaluations.values());
  onProgress(`Téléchargement des notes de ${evaluationList.length} évaluation(s)…`);
  await mapLimit(evaluationList, 4, async (evaluation, index) => {
    const evaluationId = String(evaluation.id || "");
    if (index === 0 || (index + 1) % 10 === 0 || index + 1 === evaluationList.length) {
      onProgress(`Notes ${index + 1}/${evaluationList.length}…`);
    }
    const scoresUrl =
      role === "teacher"
        ? `/api/teacher/grades/scores?evaluation_id=${encodeURIComponent(evaluationId)}`
        : `/api/grades/scores?evaluation_id=${encodeURIComponent(evaluationId)}`;
    await fetchAndCache(scoresUrl, gradesScoresKey(role, evaluationId));

    const lockUrl =
      role === "teacher"
        ? `/api/teacher/grades/locks?evaluation_id=${encodeURIComponent(evaluationId)}`
        : `/api/grades/locks?evaluation_id=${encodeURIComponent(evaluationId)}`;
    try {
      await fetchAndCache(lockUrl, gradesLockKey(role, evaluationId));
    } catch {
      // Certaines installations n'activent pas encore le verrouillage par PIN.
    }
  });

  return { classIds, studentIds, evaluationCount: evaluationList.length };
}

async function prepareTextbook(
  onProgress: ProgressCallback,
): Promise<{ classIds: string[]; assignmentCount: number }> {
  onProgress("Téléchargement du cahier de texte…");
  const bootstrap = await fetchAndCache<TextbookBootstrap>(
    "/api/teacher/textbook/bootstrap",
    TEXTBOOK_BOOTSTRAP_KEY,
  );
  const assignments = Array.isArray(bootstrap?.items) ? bootstrap.items : [];
  const classIds = uniqueIds(assignments.map((item) => item?.class_id));

  onProgress(`Cahier de texte : téléchargement de ${classIds.length} grille(s) horaire(s)…`);
  await mapLimit(classIds, 4, async (classId, index) => {
    onProgress(`Cahier de texte : créneaux ${index + 1}/${classIds.length}…`);
    await fetchAndCache(
      `/api/institution/slots?class_id=${encodeURIComponent(classId)}`,
      textbookSlotsKey(classId),
    );
  });

  return { classIds, assignmentCount: assignments.length };
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
    getActiveOfflineWorkerRelease(),
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
    getActiveOfflineWorkerRelease(),
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

async function prepareTeacher(onProgress: ProgressCallback): Promise<OfflineReadiness> {
  onProgress("Téléchargement de l’emploi du temps…");
  const bootstrap = await fetchAndCache<TeacherBootstrap>(
    "/api/teacher/offline/bootstrap",
    "teacher:offline:bootstrap"
  );

  const slots = Array.isArray(bootstrap?.slots) ? bootstrap.slots : [];
  for (const slot of slots) {
    if (!slot?.key) continue;
    const items = Array.isArray(slot.items) ? slot.items : [];
    await cacheSet(`teacher:classes:${slot.key}`, {
      items,
      has_active_slot: true,
      scheduled_for_slot: items.length > 0,
    });
  }

  onProgress("Téléchargement des paramètres de l’établissement…");
  const basics: any = await fetchFirstAndCache(
    [{ url: "/api/teacher/institution/basics", key: "teacher:inst:basics" }],
    (payload: any) => Array.isArray(payload?.periods) && payload.periods.length > 0
  );

  onProgress("Vérification du relais local depuis l’application…");
  const relayPolicy = basics?.attendance_presence || {};
  const relayConnectivity = await checkRelayTeacherConnectivity({
    institutionId: String(basics?.institution_id || ""),
    baseUrl: String(relayPolicy?.relay_local_url || ""),
    accessToken: String(relayPolicy?.relay_access_token || ""),
  });

  // Réglages de conduite : utiles pour les sanctions, mais optionnels si l’établissement
  // utilise encore les valeurs par défaut.
  try {
    await fetchFirstAndCache([
      { url: "/api/teacher/conduct/settings", key: "teacher:conduct:teacher" },
      { url: "/api/institution/conduct/settings", key: "teacher:conduct:institution" },
    ]);
  } catch {
    // Les maxima par défaut du tableau de bord restent utilisables.
  }

  const classIds = uniqueIds(
    slots.flatMap((slot) => (slot.items || []).map((item) => item.class_id || null))
  );
  const studentIds = new Set<string>();

  onProgress(`Téléchargement de ${classIds.length} liste(s) d’élèves…`);
  await mapLimit(classIds, 4, async (classId, index) => {
    onProgress(`Liste d’élèves ${index + 1}/${classIds.length}…`);
    const roster: any = await fetchAndCache(
      `/api/teacher/roster?class_id=${encodeURIComponent(classId)}`,
      `teacher:roster:${classId}`
    );
    for (const student of Array.isArray(roster?.items) ? roster.items : []) {
      const id = String(student?.id || "").trim();
      if (id) studentIds.add(id);
    }
  });

  const preparedGrades = await prepareGrades("teacher", onProgress);
  for (const studentId of preparedGrades.studentIds) studentIds.add(studentId);
  const preparedTextbook = await prepareTextbook(onProgress);

  onProgress("Préparation de l’application…");
  await warmOfflineShell([
    "/login",
    "/choose-book",
    "/attendance",
    "/grades",
    "/enseignant/cahier-de-texte",
  ]);
  rememberOfflineBookDestinations({
    attendance: "/attendance",
    grades: "/grades",
  });
  const activeServiceWorkerRelease = await getActiveOfflineWorkerRelease();
  if (activeServiceWorkerRelease !== MON_CAHIER_SERVICE_WORKER_RELEASE) {
    throw new Error(
      "Le nouveau service hors ligne n’est pas encore actif. Rechargez la page puis relancez la préparation.",
    );
  }

  return {
    version: 5,
    role: "teacher",
    prepared_at: new Date().toISOString(),
    class_count: uniqueIds([
      ...classIds,
      ...preparedGrades.classIds,
      ...preparedTextbook.classIds,
    ]).length,
    student_count: studentIds.size,
    slot_count: slots.length,
    evaluation_count: preparedGrades.evaluationCount,
    textbook_assignment_count: preparedTextbook.assignmentCount,
    bulletin_count: 0,
    parent_child_count: 0,
    grades_ready: true,
    textbook_ready: true,
    consultation_ready: false,
    communication_ready: false,
    shell_ready: true,
    relay_connectivity: relayConnectivity,
    web_release: String(bootstrap.web_release || MON_CAHIER_WEB_RELEASE),
    service_worker_release: activeServiceWorkerRelease,
    schedule_revision: safeRevision(bootstrap.schedule_revision),
    schedule_generated_at: String(bootstrap.generated_at || "") || null,
    data_presence: {
      classes: classIds.length,
      students: studentIds.size,
      slots: slots.length,
      grades: preparedGrades.evaluationCount,
      textbook_assignments: preparedTextbook.assignmentCount,
      assignments: Array.isArray(bootstrap.assignments)
        ? bootstrap.assignments.length
        : 0,
    },
    relay_capabilities: relayConnectivity.capabilities,
    schedule_compatibility:
      bootstrap.snapshot_completeness === "complete" &&
      safeRevision(bootstrap.schedule_revision) !== null &&
      safeRevision(bootstrap.schedule_revision) ===
        safeRevision(relayConnectivity.snapshot_revision) &&
      relayConnectivity.teacher_attendance_writes_enabled === true &&
      completeRelayCapabilities(relayConnectivity.capabilities)
        ? "ready"
        : "not_prepared",
  };
}

async function prepareClassDevice(
  onProgress: ProgressCallback,
  cloudRevision: number | null,
): Promise<OfflineReadiness> {
  onProgress("Téléchargement de la classe autorisée…");
  const classPayload: any = await fetchAndCache(
    "/api/class/my-classes?offline_contract=v5",
    "classDevice:my-classes",
  );
  const preparedAccess = resolveClassDevicePreparationAccess(classPayload);
  const { classId, institutionId, actorProfileId } = preparedAccess;
  const relayPolicy = preparedAccess.relayPolicy;

  onProgress("Vérification du relais et du planning de la classe…");
  const relayConnectivity = await checkRelayTeacherConnectivity({
    institutionId,
    baseUrl: relayPolicy.relayLocalUrl,
    accessToken: relayPolicy.relayAccessToken,
  });
  if (relayConnectivity.status !== "reachable") {
    const status =
      relayConnectivity.status === "access_denied"
        ? "relay_access_denied"
        : relayConnectivity.status === "permission_denied"
          ? "relay_permission_denied"
          : relayConnectivity.status === "incompatible_browser"
            ? "browser_incompatible"
            : "relay_unreachable";
    throw new Error(classDeviceReadinessMessage(status));
  }
  if (relayConnectivity.capabilities?.class_device_scope_v1 !== true) {
    throw new Error(classDeviceReadinessMessage("relay_contract_stale"));
  }
  if (relayConnectivity.actor_kind !== "class_device") {
    throw new Error(classDeviceReadinessMessage("relay_contract_stale"));
  }
  if (String(relayConnectivity.class_id || "").trim() !== classId) {
    throw new Error(classDeviceReadinessMessage("class_mismatch"));
  }
  if (
    String(relayConnectivity.actor_profile_id || "").trim() !==
    actorProfileId
  ) {
    throw new Error(classDeviceReadinessMessage("device_mismatch"));
  }

  let relaySchedule: RelayTeacherOfflineSchedule;
  try {
    relaySchedule = await fetchRelayTeacherOfflineSchedule({
      institutionId,
      baseUrl: relayPolicy.relayLocalUrl,
      accessToken: relayPolicy.relayAccessToken,
    });
  } catch (error) {
    throw new Error(classDeviceReadinessMessage(scheduleFetchFailureStatus(error)));
  }
  const relayScope = validateClassDeviceScheduleScope(relaySchedule, {
    institutionId,
    classId,
    actorProfileId,
  });
  if (!relayScope.ok && "status" in relayScope) {
    throw new Error(classDeviceReadinessMessage(relayScope.status));
  }

  try {
    await fetchAndCache("/api/teacher/sessions/open", "classDevice:open-session");
  } catch {
    // L'absence d'une séance déjà ouverte ne bloque pas la préparation.
    await cacheSet("classDevice:open-session", { item: null });
  }

  onProgress("Téléchargement des paramètres de l’établissement…");
  await fetchFirstAndCache(
    [
      {
        url: "/api/teacher/institution/basics",
        key: "classDevice:inst:basics:teacher",
      },
      {
        url: "/api/institution/basics",
        key: "classDevice:inst:basics:institution",
      },
    ],
    (payload: any) =>
      Array.isArray(payload?.periods) && payload.periods.length > 0,
  );

  const studentIds = new Set<string>();
  const relayRoster = relaySchedule.rosters?.[classId];
  for (const student of Array.isArray(relayRoster?.items)
    ? relayRoster.items
    : []) {
    const id = String(student?.id || "").trim();
    if (id) studentIds.add(id);
  }

  onProgress("Téléchargement des élèves et matières de la classe…");
  const roster: any = await fetchAndCache(
    `/api/class/roster?class_id=${encodeURIComponent(classId)}`,
    `classDevice:roster:${classId}`,
  );
  for (const student of Array.isArray(roster?.items) ? roster.items : []) {
    const id = String(student?.id || "").trim();
    if (id) studentIds.add(id);
  }
  await fetchAndCache(
    `/api/class/subjects?class_id=${encodeURIComponent(classId)}`,
    `classDevice:subjects:${classId}`,
  );

  onProgress(
    `Préparation de ${relaySchedule.slots.length} créneau(x) vérifié(s)…`,
  );
  await mapLimit(relaySchedule.slots, 4, async (slot, index) => {
    if (
      index === 0 ||
      (index + 1) % 5 === 0 ||
      index + 1 === relaySchedule.slots.length
    ) {
      onProgress(`Créneaux ${index + 1}/${relaySchedule.slots.length}…`);
    }
    await fetchAndCache(
      `/api/class/subjects?class_id=${encodeURIComponent(classId)}&slot=${encodeURIComponent(slot.key)}`,
      `classDevice:subjects:${classId}:${slot.key}`,
    );
  });

  const preparedGrades = await prepareGrades("class-device", onProgress);
  for (const studentId of preparedGrades.studentIds) studentIds.add(studentId);
  const preparedTextbook = await prepareTextbook(onProgress);

  onProgress("Préparation et vérification du shell hors ligne…");
  await warmOfflineShell([
    "/login",
    "/choose-book",
    "/class",
    "/grades/class-device",
    "/enseignant/cahier-de-texte",
  ]);
  rememberOfflineBookDestinations({
    attendance: "/class",
    grades: "/grades/class-device",
  });
  const activeServiceWorkerRelease = await getActiveOfflineWorkerRelease();
  if (activeServiceWorkerRelease !== MON_CAHIER_SERVICE_WORKER_RELEASE) {
    throw new Error(classDeviceReadinessMessage("service_worker_stale"));
  }

  const readiness: OfflineReadiness = {
    version: 5,
    role: "class-device",
    prepared_at: new Date().toISOString(),
    checked_at: new Date().toISOString(),
    class_count: 1,
    student_count: studentIds.size,
    slot_count: relaySchedule.slot_count,
    evaluation_count: preparedGrades.evaluationCount,
    textbook_assignment_count: preparedTextbook.assignmentCount,
    bulletin_count: 0,
    parent_child_count: 0,
    grades_ready: true,
    textbook_ready: true,
    consultation_ready: false,
    communication_ready: false,
    shell_ready: true,
    relay_connectivity: relayConnectivity,
    web_release: MON_CAHIER_WEB_RELEASE,
    service_worker_release: activeServiceWorkerRelease,
    schedule_revision: relayScope.revision,
    schedule_generated_at: relaySchedule.generated_at,
    institution_id: institutionId,
    authorized_class_id: classId,
    authorized_actor_profile_id: actorProfileId,
    relay_revision: safeRevision(relayConnectivity.snapshot_revision),
    cloud_revision: cloudRevision,
    relay_capabilities: relayConnectivity.capabilities,
    class_device_compatibility: "ready",
    data_presence: {
      classes: 1,
      students: Array.isArray(relayRoster?.items)
        ? relayRoster.items.length
        : 0,
      slots: relaySchedule.slot_count,
      grades: preparedGrades.evaluationCount,
      textbook_assignments: preparedTextbook.assignmentCount,
      assignments: relaySchedule.assignments.length,
    },
  };
  const status = evaluateClassDeviceCoherence({
    readiness,
    expected_web_release: MON_CAHIER_WEB_RELEASE,
    expected_service_worker_release: MON_CAHIER_SERVICE_WORKER_RELEASE,
    active_service_worker_release: activeServiceWorkerRelease,
    expected_institution_id: institutionId,
    expected_class_id: classId,
    expected_actor_profile_id: actorProfileId,
    bundle_present: true,
    bundle_schedule_revision: relayScope.revision,
    bundle_scope_valid: true,
    relay_status: relayConnectivity.status,
    relay_institution_id: relaySchedule.institution_id,
    relay_actor_kind: relaySchedule.actor_kind || null,
    relay_class_id: relaySchedule.class_id || null,
    relay_actor_profile_id: relaySchedule.actor_profile_id || null,
    relay_schedule_available: true,
    relay_revision: relayScope.revision,
    cloud_revision: cloudRevision,
    relay_writes_enabled:
      relayConnectivity.teacher_attendance_writes_enabled === true,
    relay_capabilities: relayConnectivity.capabilities,
  });
  if (status !== "ready") {
    throw new Error(classDeviceReadinessMessage(status));
  }

  await persistClassDeviceBundle(readiness, relaySchedule);
  await projectClassDeviceScheduleCaches(relaySchedule, classId);
  return readiness;
}

type AdminBulletinClass = {
  id?: string | null;
  academic_year?: string | null;
};

type AdminBulletinPeriod = {
  academic_year?: string | null;
  code?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type AdminAttendancePreparationRow = {
  class_id?: string | null;
  class_label?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
};

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

async function prepareAdmin(onProgress: ProgressCallback): Promise<OfflineReadiness> {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  onProgress("Préparation de la vue administrative par créneau…");
  const [monitor] = await Promise.all([
    fetchAdminAttendanceMonitor<AdminAttendancePreparationRow>(today, today),
    fetchInstitutionSettings<Record<string, unknown>>(),
    warmOfflineShell([
      "/admin/dashboard",
      "/admin/absences/appels",
      "/admin/absences/appels-matrice",
    ]),
  ]);
  await optional(async () => {
    await syncRelayBootstrap();
  });

  const monitorRows = Array.isArray(monitor.data?.rows)
    ? monitor.data.rows
    : [];
  const attendanceClassIds = uniqueIds(
    monitorRows.map((row) => row.class_id || row.class_label || null),
  );
  const attendanceSlots = new Set(
    monitorRows
      .map((row) =>
        `${String(row.planned_start || "").slice(0, 5)}-${String(
          row.planned_end || "",
        ).slice(0, 5)}`,
      )
      .filter((value) => value !== "-"),
  );

  const studentIds = new Set<string>();
  let bulletinCount = 0;
  let classes: AdminBulletinClass[] = [];
  let communicationReady = false;

  onProgress("Préparation complémentaire des bulletins…");
  try {
    const [classPayload] = await Promise.all([
      getAdminBulletinClasses<any>(),
      getAdminBulletinSettings<any>(),
    ]);
    classes = itemsOf<AdminBulletinClass>(classPayload).filter(
      (item) => item?.id,
    );
    const academicYears = uniqueIds(classes.map((item) => item.academic_year));
    const years: Array<string | null> = academicYears.length
      ? academicYears
      : [null];
    const periods: AdminBulletinPeriod[] = [];
    for (const year of years) {
      const payload = await getAdminBulletinPeriods<any>(year);
      periods.push(...itemsOf<AdminBulletinPeriod>(payload));
    }

    const periodMap = new Map<string, AdminBulletinPeriod>();
    for (const period of periods) {
      const from = String(period?.start_date || "").trim();
      const to = String(period?.end_date || "").trim();
      if (!from || !to) continue;
      periodMap.set(
        `${period.academic_year || ""}|${period.code || ""}|${from}|${to}`,
        period,
      );
    }
    const tasks = classes.flatMap((classRow) =>
      Array.from(periodMap.values())
        .filter(
          (period) =>
            !classRow.academic_year ||
            !period.academic_year ||
            classRow.academic_year === period.academic_year,
        )
        .map((period) => ({ classRow, period })),
    );

    await mapLimit(tasks, 2, async ({ classRow, period }, index) => {
      if (index === 0 || (index + 1) % 4 === 0 || index + 1 === tasks.length) {
        onProgress(`Bulletins ${index + 1}/${tasks.length}…`);
      }
      const params = new URLSearchParams({
        class_id: String(classRow.id),
        from: String(period.start_date),
        to: String(period.end_date),
      });
      const academicYear = period.academic_year || classRow.academic_year;
      if (academicYear) params.set("academic_year", academicYear);
      if (period.code) params.set("period_code", period.code);
      const bulletin: any = await getAdminBulletin(params);
      if (bulletin?.ok !== false) bulletinCount += 1;
      for (const item of itemsOf<any>(bulletin)) {
        const id = String(item?.student_id || "").trim();
        if (id) studentIds.add(id);
      }
      await optional(() => getAdminBulletinConduct(params));
    });
  } catch {
    // Les bulletins sont complémentaires : la surveillance des appels reste prête.
  }

  onProgress("Préparation de l’historique des communications…");
  try {
    await Promise.all([
      getCommunicationMeta<any>(),
      getCommunicationHistory<any>(),
    ]);
    communicationReady = true;
  } catch {
    // La communication ne doit pas rendre la vue par créneau indisponible.
  }

  await optional(() =>
    warmOfflineShell(["/admin/bulletins", "/admin/communication"]),
  );

  return {
    version: 4,
    role: "admin",
    prepared_at: new Date().toISOString(),
    class_count: Math.max(classes.length, attendanceClassIds.length),
    student_count: studentIds.size,
    slot_count: attendanceSlots.size,
    evaluation_count: 0,
    textbook_assignment_count: 0,
    bulletin_count: bulletinCount,
    parent_child_count: 0,
    grades_ready: false,
    textbook_ready: false,
    consultation_ready: true,
    communication_ready: communicationReady,
    shell_ready: true,
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
  await warmOfflineShell(["/parents", ...Array.from(new Set(verificationPages))]);

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
  onProgress: ProgressCallback = () => undefined
): Promise<OfflineReadiness> {
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

  const cloud = await probeCloudSchedule();
  if (!cloud) {
    throw new Error("Reconnectez Internet pour actualiser les données hors ligne.");
  }

  const prepared =
    role === "teacher"
      ? await prepareTeacher(onProgress)
      : role === "class-device"
        ? await prepareClassDevice(
            onProgress,
            safeRevision(cloud.schedule_revision),
          )
        : role === "admin"
          ? await prepareAdmin(onProgress)
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
