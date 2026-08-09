"use client";

import {
  cacheGet,
  cacheSet,
  getActiveOfflineWorkerInfo,
  MON_CAHIER_OFFLINE_SCHEMA_VERSION,
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
  fetchRelayTeacherOfflineSchedule,
  LocalRelayHttpError,
  type RelayCapabilities,
  type RelayTeacherConnectivityResult,
  type RelayTeacherOfflineSchedule,
} from "@/lib/local-relay";
import { probeCloudSchedule } from "@/lib/cloud-availability";
import { MON_CAHIER_WEB_RELEASE } from "@/lib/offline-release";
import {
  decideOfflineSchedulePolicy,
  type SchedulePolicyStatus,
} from "@/lib/offline-schedule-policy";
import {
  CLASS_DEVICE_COHERENT_BUNDLE_KEY,
  classDeviceReadinessMessage,
  evaluateClassDeviceCoherence,
  isClassDeviceOperationalReadiness,
  validateClassDeviceRelayAccessTokenScope,
  validateClassDeviceScheduleScope,
  type ClassDeviceCoherentBundle,
  type ClassDeviceReadinessStatus,
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
  offline_schema_version?: number;
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
  preparation_source?: "relay" | "cloud" | "local";
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

function rememberOfflineBookDestinations(
  destinations: Partial<Record<"attendance" | "grades", string>>,
) {
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

async function fetchFreshOrCached<T = any>(
  url: string,
  key: string,
): Promise<{ payload: T; source: "cloud" | "cache" }> {
  try {
    return { payload: await fetchAndCache<T>(url, key), source: "cloud" };
  } catch (freshError) {
    const cached = await cacheGet<T>(key).catch(() => null);
    if (cached !== null && cached !== undefined) {
      return { payload: cached, source: "cache" };
    }
    throw freshError;
  }
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

function migrateOfflineReadinessSchema(
  value: OfflineReadiness | null | undefined,
): OfflineReadiness | null {
  if (!value || (value.version !== 4 && value.version !== 5)) return null;
  const rawSchema = Number(value.offline_schema_version);
  const offlineSchemaVersion =
    Number.isSafeInteger(rawSchema) && rawSchema > 0
      ? rawSchema
      : 1;
  return value.offline_schema_version === offlineSchemaVersion
    ? value
    : { ...value, offline_schema_version: offlineSchemaVersion };
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
      const migrated = migrateOfflineReadinessSchema(bundle.readiness);
      if (migrated && migrated !== bundle.readiness) {
        const nextBundle = { ...bundle, readiness: migrated };
        await cacheSet(CLASS_DEVICE_COHERENT_BUNDLE_KEY, nextBundle).catch(
          () => undefined,
        );
        await cacheSet(readinessKey(role), migrated).catch(() => undefined);
      }
      return migrated;
    }
  }
  const value = await cacheGet<OfflineReadiness>(readinessKey(role));
  const migrated =
    value?.role === role ? migrateOfflineReadinessSchema(value) : null;
  if (migrated && migrated !== value) {
    await cacheSet(readinessKey(role), migrated).catch(() => undefined);
  }
  return migrated;
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
    offline_schema_version: MON_CAHIER_OFFLINE_SCHEMA_VERSION,
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
  const initialSchema = Number(initial?.offline_schema_version || 1);
  if (
    !initial ||
    initial.version !== 5 ||
    initial.role !== "teacher" ||
    initialSchema !== MON_CAHIER_OFFLINE_SCHEMA_VERSION ||
    initial.data_presence?.slots !== initial.slot_count ||
    Number(initial.data_presence?.slots || 0) <= 0 ||
    Number(initial.data_presence?.classes || 0) <= 0
  ) {
    return {
      ...base,
      status: "not_prepared",
      message:
        initial && initialSchema !== MON_CAHIER_OFFLINE_SCHEMA_VERSION
          ? "Le format des données hors ligne a changé. Une nouvelle préparation est requise."
          : "La préparation de cet appareil doit être actualisée.",
    };
  }

  const basics: any = await cacheGet("teacher:inst:basics").catch(() => null);
  const institutionId = String(basics?.institution_id || "").trim();
  const relayPolicy = basics?.attendance_presence || {};
  if (
    !institutionId ||
    !relayPolicy?.relay_local_url ||
    !relayPolicy?.relay_access_token
  ) {
    return {
      ...base,
      status: "not_prepared",
      message: "Les données d’accès professeur au relais sont absentes.",
    };
  }

  const [cloud, relay, workerInfo] = await Promise.all([
    probeCloudSchedule(),
    checkRelayTeacherConnectivity({
      institutionId,
      baseUrl: String(relayPolicy.relay_local_url),
      accessToken: String(relayPolicy.relay_access_token),
    }),
    getActiveOfflineWorkerInfo(),
  ]);
  const cloudRevision = safeRevision(cloud?.schedule_revision);
  const relayRevision = safeRevision(relay.snapshot_revision);
  const state = {
    ...base,
    cloud_reachable: Boolean(cloud),
    relay_revision: relayRevision,
    cloud_revision: cloudRevision,
  };
  if (
    workerInfo &&
    workerInfo.offlineSchemaVersion !== MON_CAHIER_OFFLINE_SCHEMA_VERSION
  ) {
    return {
      ...state,
      status: "not_prepared",
      message:
        "Le format du service hors ligne est incompatible. Une actualisation complète est requise.",
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
    return {
      ...state,
      status: initialPolicy,
      message:
        initialPolicy === "relay_permission_denied"
          ? "La permission d’accès au réseau local est refusée."
          : initialPolicy === "browser_incompatible"
            ? "Ce navigateur ne peut pas contrôler le relais local."
            : initialPolicy === "relay_access_denied"
              ? "Le relais refuse le jeton professeur signé."
              : "Le relais local est inaccessible.",
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
  label?: string | null;
  level?: string | null;
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

type ClassDeviceInstitutionPeriod = {
  id?: string | null;
  weekday?: number | null;
  label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

type ClassDeviceInstitutionBasics = {
  periods?: ClassDeviceInstitutionPeriod[];
};

type ClassDeviceSubjectItem = {
  id?: string | null;
  label?: string | null;
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

function resolveClassDevicePreparationIdentity(classPayload: unknown) {
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
  if (!institutionId || !actorProfileId) {
    throw new Error(classDeviceReadinessMessage("class_data_missing"));
  }
  return { classes, classId, selectedClass, institutionId, actorProfileId };
}

export function resolveClassDevicePreparationAccess(classPayload: unknown) {
  const identity = resolveClassDevicePreparationIdentity(classPayload);
  const {
    classes,
    classId,
    selectedClass,
    institutionId,
    actorProfileId,
  } = identity;
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
  if (!tokenScope.ok) {
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

function classDevicePeriodTime(value: unknown) {
  return String(value || "").slice(0, 5);
}

function classDevicePeriodKey(period: ClassDeviceInstitutionPeriod) {
  const weekday = Number(period.weekday);
  const start = classDevicePeriodTime(period.start_time);
  const end = classDevicePeriodTime(period.end_time);
  if (
    !Number.isInteger(weekday) ||
    weekday < 1 ||
    weekday > 7 ||
    !/^\d{2}:\d{2}$/.test(start) ||
    !/^\d{2}:\d{2}$/.test(end)
  ) {
    return null;
  }
  return `${weekday}|${start}|${end}`;
}

async function buildClassDeviceScheduleFromCloud(input: {
  institutionId: string;
  classId: string;
  actorProfileId: string;
  selectedClass: CachedClassDevice;
  scheduleRevision: number;
  generatedAt: string | null;
  onProgress: ProgressCallback;
}): Promise<RelayTeacherOfflineSchedule> {
  input.onProgress("Téléchargement des créneaux d’appel…");
  const basics = await fetchFirstAndCache<ClassDeviceInstitutionBasics>(
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
    (payload) => Array.isArray(payload?.periods) && payload.periods.length > 0,
  );
  const periods = (Array.isArray(basics.periods) ? basics.periods : []).filter(
    (period) => Boolean(String(period?.id || "").trim()) && classDevicePeriodKey(period),
  );
  if (periods.length === 0) {
    throw new Error(classDeviceReadinessMessage("class_data_missing"));
  }

  input.onProgress("Téléchargement de la liste des élèves…");
  const roster = await fetchAndCache<{ items?: Array<Record<string, unknown>> }>(
    `/api/class/roster?class_id=${encodeURIComponent(input.classId)}`,
    `classDevice:roster:${input.classId}`,
  );
  const rosterItems = Array.isArray(roster?.items) ? roster.items : [];

  const slots: Array<RelayTeacherOfflineSchedule["slots"][number] | null> =
    Array.from({ length: periods.length }, () => null);
  await mapLimit(periods, 4, async (period, index) => {
    if (
      index === 0 ||
      (index + 1) % 5 === 0 ||
      index + 1 === periods.length
    ) {
      input.onProgress(`Créneaux d’appel ${index + 1}/${periods.length}…`);
    }
    const key = classDevicePeriodKey(period);
    const periodId = String(period.id || "").trim();
    if (!key || !periodId) return;
    const params = new URLSearchParams({
      class_id: input.classId,
      slot: key,
      period_id: periodId,
    });
    const subjects = await fetchAndCache<{ items?: ClassDeviceSubjectItem[] }>(
      `/api/class/subjects?${params.toString()}`,
      `classDevice:subjects:${input.classId}:${key}`,
    );
    const items = (Array.isArray(subjects?.items) ? subjects.items : [])
      .map((subject) => ({
        class_id: input.classId,
        class_label: String(input.selectedClass.label || "Classe").trim() || "Classe",
        level: String(input.selectedClass.level || "").trim(),
        subject_id: String(subject?.id || "").trim(),
        subject_name: String(subject?.label || "Matière").trim() || "Matière",
      }))
      .filter((subject) => Boolean(subject.subject_id));
    if (items.length === 0) return;
    slots[index] = {
      key,
      period_id: periodId,
      weekday: Number(period.weekday),
      label: String(period.label || "Séance").trim() || "Séance",
      start_time: classDevicePeriodTime(period.start_time),
      end_time: classDevicePeriodTime(period.end_time),
      items,
    };
  });

  const preparedSlots = slots.filter(
    (slot): slot is RelayTeacherOfflineSchedule["slots"][number] => Boolean(slot),
  );
  if (preparedSlots.length === 0) {
    throw new Error(classDeviceReadinessMessage("class_data_missing"));
  }

  const assignments = Array.from(
    new Map(
      preparedSlots.flatMap((slot) =>
        slot.items.map((item) => [
          `${item.class_id}|${item.subject_id}`,
          {
            institution_id: input.institutionId,
            class_id: item.class_id,
            subject_id: item.subject_id,
          },
        ] as const),
      ),
    ).values(),
  );

  return {
    version: 1,
    scope_version: 1,
    institution_id: input.institutionId,
    actor_kind: "class_device",
    class_id: input.classId,
    actor_profile_id: input.actorProfileId,
    schedule_revision: input.scheduleRevision,
    generated_at: input.generatedAt || new Date().toISOString(),
    relay_time: null,
    snapshot_completeness: "complete",
    source: "cloud",
    slots: preparedSlots,
    class_count: 1,
    slot_count: preparedSlots.length,
    rosters: {
      [input.classId]: { items: rosterItems },
    },
    assignments,
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
    evaluation_count: 0,
    textbook_assignment_count: 0,
    grades_ready: false,
    textbook_ready: false,
    shell_ready: true,
    service_worker_release: serviceWorkerRelease,
    offline_schema_version: MON_CAHIER_OFFLINE_SCHEMA_VERSION,
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
    preparation_source: "relay" as const,
    data_presence: {
      classes: 1,
      students: studentCount,
      slots: schedule.slot_count,
      grades: 0,
      textbook_assignments: 0,
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
  const readiness = migrateOfflineReadinessSchema(
    bundle?.readiness?.version === 5 &&
      bundle.readiness.role === "class-device"
      ? bundle.readiness
      : initial,
  );
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
  const [cloud, workerInfo] = await Promise.all([
    probeCloudSchedule(),
    getActiveOfflineWorkerInfo(),
  ]);
  const activeServiceWorkerRelease = workerInfo?.release || null;
  const cloudRevision = safeRevision(cloud?.schedule_revision);
  const bundleValidation = validateClassDeviceScheduleScope(
    bundle?.schedule,
    { institutionId, classId, actorProfileId },
  );
  const baseState = {
    readiness,
    cloud_reachable: Boolean(cloud),
    phone_revision: safeRevision(readiness?.schedule_revision),
    relay_revision: null,
    cloud_revision: cloudRevision,
    schedule: bundleValidation.ok ? bundle!.schedule : null,
  };

  if (
    workerInfo &&
    workerInfo.offlineSchemaVersion !== MON_CAHIER_OFFLINE_SCHEMA_VERSION
  ) {
    return classDeviceAssessment("offline_schema_stale", baseState);
  }

  const preflight = evaluateClassDeviceCoherence({
    readiness,
    expected_web_release: MON_CAHIER_WEB_RELEASE,
    expected_service_worker_release: MON_CAHIER_SERVICE_WORKER_RELEASE,
    active_service_worker_release: activeServiceWorkerRelease,
    expected_offline_schema_version: MON_CAHIER_OFFLINE_SCHEMA_VERSION,
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
      "ready_local",
      {
        ...baseState,
        schedule: bundleValidation.ok ? bundle!.schedule : null,
      },
      "Les données d’appel sont vérifiées sur ce téléphone. Le relais n’est pas configuré ou ses paramètres sont indisponibles.",
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
    const observed =
      readiness?.version === 5
        ? {
            ...readiness,
            checked_at: new Date().toISOString(),
            cloud_revision: cloudRevision,
            relay_revision: relayRevision,
            relay_connectivity: relay,
            relay_capabilities: relay.capabilities,
            class_device_compatibility: "ready_local" as const,
          }
        : readiness;
    if (observed && bundleValidation.ok) {
      await persistClassDeviceBundle(observed, bundle!.schedule).catch(
        () => undefined,
      );
    }
    const relayStatus =
      relay.status === "access_denied"
        ? "relay_access_denied"
        : relay.status === "permission_denied"
          ? "relay_permission_denied"
          : relay.status === "incompatible_browser"
            ? "browser_incompatible"
            : "relay_unreachable";
    return classDeviceAssessment(
      "ready_local",
      {
        ...withRelay,
        readiness: observed,
        schedule: bundleValidation.ok ? bundle!.schedule : null,
      },
      `${classDeviceReadinessMessage("ready_local")} ${classDeviceReadinessMessage(relayStatus)}`,
    );
  }

  let relaySchedule: RelayTeacherOfflineSchedule;
  try {
    relaySchedule = await fetchRelayTeacherOfflineSchedule({
      institutionId: context.institutionId,
      baseUrl: context.relayBaseUrl,
      accessToken: context.relayAccessToken,
    });
  } catch (error) {
    return classDeviceAssessment(
      "ready_local",
      {
        ...withRelay,
        schedule: bundleValidation.ok ? bundle!.schedule : null,
      },
      `${classDeviceReadinessMessage("ready_local")} ${classDeviceReadinessMessage(scheduleFetchFailureStatus(error))}`,
    );
  }
  const relayScope = validateClassDeviceScheduleScope(relaySchedule, {
    institutionId: context.institutionId,
    classId: context.classId,
    actorProfileId: context.actorProfileId,
  });
  if (!relayScope.ok) {
    return classDeviceAssessment(
      "ready_local",
      {
        ...withRelay,
        schedule: bundleValidation.ok ? bundle!.schedule : null,
      },
      `${classDeviceReadinessMessage("ready_local")} ${classDeviceReadinessMessage(relayScope.status)}`,
    );
  }

  const evaluated = evaluateClassDeviceCoherence({
    readiness,
    expected_web_release: MON_CAHIER_WEB_RELEASE,
    expected_service_worker_release: MON_CAHIER_SERVICE_WORKER_RELEASE,
    active_service_worker_release: activeServiceWorkerRelease,
    expected_offline_schema_version: MON_CAHIER_OFFLINE_SCHEMA_VERSION,
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

  if (evaluated === "refresh_from_relay") {
    try {
      const refreshed = refreshedClassDeviceReadiness(
        readiness!,
        relaySchedule,
        relay,
        cloudRevision,
        activeServiceWorkerRelease ||
          readiness?.service_worker_release ||
          MON_CAHIER_SERVICE_WORKER_RELEASE,
      );
      await persistClassDeviceBundle(refreshed, relaySchedule);
      await projectClassDeviceScheduleCaches(relaySchedule, context.classId);
      return classDeviceAssessment("ready", {
        readiness: refreshed,
        cloud_reachable: Boolean(cloud),
        phone_revision: relayScope.revision,
        relay_revision: relayScope.revision,
        cloud_revision: cloudRevision,
        schedule: relaySchedule,
      });
    } catch {
      return classDeviceAssessment(
        "ready_local",
        {
          ...withRelay,
          schedule: bundleValidation.ok ? bundle!.schedule : null,
        },
        "Le planning plus récent du relais n’a pas pu remplacer atomiquement la préparation locale. L’appel reste possible avec la dernière préparation valide.",
      );
    }
  }

  const operationalEvaluated = isClassDeviceOperationalReadiness(evaluated)
    ? evaluated
    : "ready_local";
  const observed =
    readiness?.version === 5
      ? {
          ...readiness,
          checked_at: new Date().toISOString(),
          relay_revision: relayScope.revision,
          cloud_revision: cloudRevision,
          relay_connectivity: relay,
          relay_capabilities: relay.capabilities,
          class_device_compatibility: operationalEvaluated,
        }
      : readiness;
  if (observed && bundleValidation.ok) {
    try {
      await persistClassDeviceBundle(observed, bundle!.schedule);
    } catch {
      return classDeviceAssessment(
        "ready_local",
        {
          ...withRelay,
          readiness,
          schedule: bundle!.schedule,
        },
        "La mise à jour de l’état du relais n’a pas pu être conservée, mais la dernière préparation locale valide reste utilisable.",
      );
    }
  }
  return classDeviceAssessment(operationalEvaluated, {
    readiness: observed,
    cloud_reachable: Boolean(cloud),
    phone_revision: safeRevision(observed?.schedule_revision),
    relay_revision: relayScope.revision,
    cloud_revision: cloudRevision,
    schedule:
      evaluated === "ready"
        ? relaySchedule
        : bundleValidation.ok
          ? bundle!.schedule
          : null,
  },
  evaluated === operationalEvaluated
    ? classDeviceReadinessMessage(operationalEvaluated)
    : `${classDeviceReadinessMessage("ready_local")} ${classDeviceReadinessMessage(evaluated)}`,
  );
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
    "/choose-book",
    "/attendance",
    "/grades",
    "/enseignant/cahier-de-texte",
  ]);
  rememberOfflineBookDestinations({
    attendance: "/attendance",
    grades: "/grades",
  });
  const workerInfo = await getActiveOfflineWorkerInfo();
  if (
    workerInfo &&
    workerInfo.offlineSchemaVersion !== MON_CAHIER_OFFLINE_SCHEMA_VERSION
  ) {
    throw new Error(
      "Le format du service hors ligne est incompatible. Rechargez l’application puis relancez la préparation.",
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
    service_worker_release:
      workerInfo?.release || MON_CAHIER_SERVICE_WORKER_RELEASE,
    offline_schema_version: MON_CAHIER_OFFLINE_SCHEMA_VERSION,
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
  cloud: { schedule_revision?: unknown; generated_at?: unknown } | null,
): Promise<OfflineReadiness> {
  const cloudRevision = safeRevision(cloud?.schedule_revision);
  const cloudGeneratedAt = String(cloud?.generated_at || "").trim() || null;
  const existingBundle = await readClassDeviceBundle();

  onProgress("Chargement de la classe autorisée…");
  let classId = "";
  let institutionId = "";
  let actorProfileId = "";
  let selectedClass: CachedClassDevice = {};
  let relayPolicy: {
    relayLocalUrl: string;
    relayAccessToken: string;
  } | null = null;
  let accessError: unknown = null;

  try {
    const classPayload = await fetchFreshOrCached(
      "/api/class/my-classes?offline_contract=v5",
      "classDevice:my-classes",
    );
    const identity = resolveClassDevicePreparationIdentity(
      classPayload.payload,
    );
    classId = identity.classId;
    institutionId = identity.institutionId;
    actorProfileId = identity.actorProfileId;
    selectedClass = identity.selectedClass || {};

    try {
      relayPolicy = resolveClassDevicePreparationAccess(
        classPayload.payload,
      ).relayPolicy;
    } catch (error) {
      // Un relais absent ou mal configuré ne doit pas empêcher une préparation
      // Cloud valide. Son accès reste simplement désactivé pour cette tentative.
      accessError = error;
      relayPolicy = null;
    }
  } catch (error) {
    accessError = error;
    const previous = existingBundle?.readiness;
    institutionId = String(previous?.institution_id || "").trim();
    classId = String(previous?.authorized_class_id || "").trim();
    actorProfileId = String(
      previous?.authorized_actor_profile_id || "",
    ).trim();
    const previousScope = validateClassDeviceScheduleScope(
      existingBundle?.schedule,
      { institutionId, classId, actorProfileId },
    );
    if (!previousScope.ok) throw error;
    selectedClass = { id: classId, institution_id: institutionId };
  }

  const expectedScope = { institutionId, classId, actorProfileId };
  const existingScope = validateClassDeviceScheduleScope(
    existingBundle?.schedule,
    expectedScope,
  );

  let relayConnectivity: RelayTeacherConnectivityResult = {
    status: "unreachable",
    checked_at: new Date().toISOString(),
  };
  let relaySchedule: RelayTeacherOfflineSchedule | null = null;
  let relayScopeRevision: number | null = null;
  let lastSourceError: unknown = accessError;

  if (relayPolicy) {
    onProgress("Recherche du relais local…");
    relayConnectivity = await checkRelayTeacherConnectivity({
      institutionId,
      baseUrl: relayPolicy.relayLocalUrl,
      accessToken: relayPolicy.relayAccessToken,
    });
    if (
      relayConnectivity.status === "reachable" &&
      relayConnectivity.capabilities?.class_device_scope_v1 === true &&
      relayConnectivity.actor_kind === "class_device" &&
      String(relayConnectivity.class_id || "").trim() === classId &&
      String(relayConnectivity.actor_profile_id || "").trim() === actorProfileId
    ) {
      try {
        const candidate = await fetchRelayTeacherOfflineSchedule({
          institutionId,
          baseUrl: relayPolicy.relayLocalUrl,
          accessToken: relayPolicy.relayAccessToken,
        });
        const scope = validateClassDeviceScheduleScope(candidate, expectedScope);
        if (scope.ok) {
          relaySchedule = candidate;
          relayScopeRevision = scope.revision;
        } else {
          lastSourceError = new Error(classDeviceReadinessMessage(scope.status));
        }
      } catch (error) {
        lastSourceError = error;
      }
    } else if (relayConnectivity.status !== "reachable") {
      lastSourceError = new Error(
        classDeviceReadinessMessage(
          relayConnectivity.status === "access_denied"
            ? "relay_access_denied"
            : relayConnectivity.status === "permission_denied"
              ? "relay_permission_denied"
              : relayConnectivity.status === "incompatible_browser"
                ? "browser_incompatible"
                : "relay_unreachable",
        ),
      );
    }
  }

  let schedule: RelayTeacherOfflineSchedule | null = null;
  let preparationSource: "relay" | "cloud" | "local" | null = null;

  if (
    relaySchedule &&
    (cloudRevision === null || relayScopeRevision === cloudRevision)
  ) {
    schedule = relaySchedule;
    preparationSource = "relay";
  }

  if (!schedule && cloudRevision !== null) {
    try {
      schedule = await buildClassDeviceScheduleFromCloud({
        institutionId,
        classId,
        actorProfileId,
        selectedClass,
        scheduleRevision: cloudRevision,
        generatedAt: cloudGeneratedAt,
        onProgress,
      });
      preparationSource = "cloud";
    } catch (error) {
      lastSourceError = error;
    }
  }

  if (!schedule && relaySchedule) {
    const localRevision = existingScope.ok ? existingScope.revision : null;
    if (localRevision === null || (relayScopeRevision ?? -1) >= localRevision) {
      schedule = relaySchedule;
      preparationSource = "relay";
    }
  }

  if (!schedule && existingScope.ok) {
    schedule = existingBundle!.schedule;
    preparationSource = "local";
  }

  if (!schedule || !preparationSource) {
    throw lastSourceError instanceof Error
      ? lastSourceError
      : new Error(
          "Aucune préparation d’appel complète n’est disponible sur le Cloud, le relais ou ce téléphone.",
        );
  }

  const selectedScope = validateClassDeviceScheduleScope(
    schedule,
    expectedScope,
  );
  if (!selectedScope.ok) {
    throw new Error(classDeviceReadinessMessage(selectedScope.status));
  }

  if (cloudRevision !== null) {
    try {
      await fetchAndCache(
        "/api/teacher/sessions/open",
        "classDevice:open-session",
      );
    } catch {
      // Une séance Cloud indisponible ne doit jamais annuler une préparation valide.
    }
  }

  onProgress("Préparation du seul écran d’appel…");
  await warmOfflineShell(["/class"]);
  rememberOfflineBookDestinations({ attendance: "/class" });
  const workerInfo = await getActiveOfflineWorkerInfo();
  if (
    workerInfo &&
    workerInfo.offlineSchemaVersion !== MON_CAHIER_OFFLINE_SCHEMA_VERSION
  ) {
    throw new Error(classDeviceReadinessMessage("offline_schema_stale"));
  }

  const roster = schedule.rosters?.[classId];
  const rosterItems = Array.isArray(roster?.items) ? roster.items : [];
  const now = new Date().toISOString();
  const preparedAt =
    preparationSource === "local" && existingBundle?.readiness?.prepared_at
      ? existingBundle.readiness.prepared_at
      : now;
  const compatibility: ClassDeviceReadinessStatus =
    preparationSource === "relay" &&
    relayConnectivity.status === "reachable" &&
    (cloudRevision === null || selectedScope.revision === cloudRevision)
      ? "ready"
      : "ready_local";

  const readiness: OfflineReadiness = {
    version: 5,
    role: "class-device",
    prepared_at: preparedAt,
    checked_at: now,
    class_count: 1,
    student_count: rosterItems.length,
    slot_count: schedule.slot_count,
    evaluation_count: 0,
    textbook_assignment_count: 0,
    bulletin_count: 0,
    parent_child_count: 0,
    grades_ready: false,
    textbook_ready: false,
    consultation_ready: false,
    communication_ready: false,
    shell_ready: true,
    relay_connectivity: relayConnectivity,
    web_release: MON_CAHIER_WEB_RELEASE,
    service_worker_release:
      workerInfo?.release || MON_CAHIER_SERVICE_WORKER_RELEASE,
    offline_schema_version: MON_CAHIER_OFFLINE_SCHEMA_VERSION,
    schedule_revision: selectedScope.revision,
    schedule_generated_at: schedule.generated_at,
    institution_id: institutionId,
    authorized_class_id: classId,
    authorized_actor_profile_id: actorProfileId,
    relay_revision: relayScopeRevision,
    cloud_revision: cloudRevision,
    relay_capabilities: relayConnectivity.capabilities,
    class_device_compatibility: compatibility,
    preparation_source: preparationSource,
    data_presence: {
      classes: 1,
      students: rosterItems.length,
      slots: schedule.slot_count,
      grades: 0,
      textbook_assignments: 0,
      assignments: schedule.assignments.length,
    },
  };

  await persistClassDeviceBundle(readiness, schedule);
  await projectClassDeviceScheduleCaches(schedule, classId);
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
  onProgress("Téléchargement des classes et de l’identité de l’établissement…");
  const [classPayload] = await Promise.all([
    getAdminBulletinClasses<any>(),
    getAdminBulletinSettings<any>(),
  ]);
  const classes = itemsOf<AdminBulletinClass>(classPayload).filter((item) => item?.id);
  const academicYears = uniqueIds(classes.map((item) => item.academic_year));
  const years: Array<string | null> = academicYears.length ? academicYears : [null];

  onProgress("Téléchargement des périodes de bulletins…");
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
  const uniquePeriodList = Array.from(periodMap.values());
  const tasks = classes.flatMap((classRow) =>
    uniquePeriodList
      .filter(
        (period) =>
          !classRow.academic_year ||
          !period.academic_year ||
          classRow.academic_year === period.academic_year,
      )
      .map((period) => ({ classRow, period })),
  );
  const studentIds = new Set<string>();
  let bulletinCount = 0;

  onProgress(`Préparation de ${tasks.length} bulletin(s) de classe…`);
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

  onProgress("Préparation de l’historique des communications…");
  await Promise.all([
    getCommunicationMeta<any>(),
    getCommunicationHistory<any>(),
  ]);

  onProgress("Préparation des écrans bulletins et communication…");
  await warmOfflineShell(["/admin/bulletins", "/admin/communication"]);

  return {
    version: 4,
    role: "admin",
    offline_schema_version: MON_CAHIER_OFFLINE_SCHEMA_VERSION,
    prepared_at: new Date().toISOString(),
    class_count: classes.length,
    student_count: studentIds.size,
    slot_count: 0,
    evaluation_count: 0,
    textbook_assignment_count: 0,
    bulletin_count: bulletinCount,
    parent_child_count: 0,
    grades_ready: false,
    textbook_ready: false,
    consultation_ready: true,
    communication_ready: true,
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
    offline_schema_version: MON_CAHIER_OFFLINE_SCHEMA_VERSION,
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
  const cloud = await probeCloudSchedule();
  if (!cloud && role !== "class-device") {
    throw new Error("Reconnectez Internet pour actualiser les données hors ligne.");
  }

  const readiness =
    role === "teacher"
      ? await prepareTeacher(onProgress)
      : role === "class-device"
        ? await prepareClassDevice(onProgress, cloud)
        : role === "admin"
          ? await prepareAdmin(onProgress)
          : await prepareParent(onProgress);
  await cacheSet(readinessKey(role), readiness);
  return readiness;
}
