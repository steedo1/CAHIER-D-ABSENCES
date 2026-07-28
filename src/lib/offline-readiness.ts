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
  fetchRelayTeacherOfflineSchedule,
  type RelayCapabilities,
  type RelayTeacherConnectivityResult,
} from "@/lib/local-relay";
import { probeCloudSchedule } from "@/lib/cloud-availability";
import { MON_CAHIER_WEB_RELEASE } from "@/lib/offline-release";
import {
  decideOfflineSchedulePolicy,
  type SchedulePolicyStatus,
} from "@/lib/offline-schedule-policy";

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

type ProgressCallback = (message: string) => void;

type PeriodLike = {
  weekday?: number | null;
  start_time?: string | null;
  end_time?: string | null;
};

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

function slotKey(period: PeriodLike): string | null {
  const rawWeekday = Number(period.weekday);
  const weekday = rawWeekday === 0 ? 7 : rawWeekday;
  const start = String(period.start_time || "").slice(0, 5);
  const end = String(period.end_time || "").slice(0, 5);
  if (!Number.isFinite(weekday) || weekday < 1 || weekday > 7) return null;
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  return `${weekday}|${start}|${end}`;
}

function uniquePeriods(payload: any): Array<{ key: string; period: PeriodLike }> {
  const map = new Map<string, PeriodLike>();
  for (const period of (Array.isArray(payload?.periods) ? payload.periods : []) as PeriodLike[]) {
    const key = slotKey(period);
    if (key) map.set(key, period);
  }
  return Array.from(map, ([key, period]) => ({ key, period }));
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

  const [cloud, relay, serviceWorkerRelease] = await Promise.all([
    probeCloudSchedule(),
    checkRelayTeacherConnectivity({
      institutionId,
      baseUrl: String(relayPolicy.relay_local_url),
      accessToken: String(relayPolicy.relay_access_token),
    }),
    getActiveOfflineWorkerRelease(),
  ]);
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

async function prepareClassDevice(onProgress: ProgressCallback): Promise<OfflineReadiness> {
  onProgress("Téléchargement des classes du cahier…");
  const classPayload: any = await fetchAndCache(
    "/api/class/my-classes",
    "classDevice:my-classes"
  );
  const classes = Array.isArray(classPayload?.items) ? classPayload.items : [];
  const classIds = uniqueIds(classes.map((item: any) => item?.id));

  try {
    await fetchAndCache("/api/teacher/sessions/open", "classDevice:open-session");
  } catch {
    // L'absence d'une séance serveur ouverte ne bloque pas la préparation.
    await cacheSet("classDevice:open-session", { item: null });
  }

  onProgress("Téléchargement des créneaux…");
  const basics: any = await fetchFirstAndCache([
    { url: "/api/teacher/institution/basics", key: "classDevice:inst:basics:teacher" },
    { url: "/api/institution/basics", key: "classDevice:inst:basics:institution" },
  ], (payload: any) => Array.isArray(payload?.periods) && payload.periods.length > 0);
  const periods = uniquePeriods(basics);
  const studentIds = new Set<string>();

  onProgress(`Téléchargement de ${classIds.length} liste(s) d’élèves…`);
  await mapLimit(classIds, 4, async (classId, index) => {
    onProgress(`Classe ${index + 1}/${classIds.length} : élèves et matières…`);
    const roster: any = await fetchAndCache(
      `/api/class/roster?class_id=${encodeURIComponent(classId)}`,
      `classDevice:roster:${classId}`
    );
    for (const student of Array.isArray(roster?.items) ? roster.items : []) {
      const id = String(student?.id || "").trim();
      if (id) studentIds.add(id);
    }

    await fetchAndCache(
      `/api/class/subjects?class_id=${encodeURIComponent(classId)}`,
      `classDevice:subjects:${classId}`
    );
  });

  const resources = classIds.flatMap((classId) =>
    periods.map(({ key }) => ({ classId, key }))
  );
  onProgress(`Préparation de ${resources.length} combinaison(s) classe-créneau…`);
  await mapLimit(resources, 4, async ({ classId, key }, index) => {
    if (index === 0 || (index + 1) % 5 === 0 || index + 1 === resources.length) {
      onProgress(`Créneaux ${index + 1}/${resources.length}…`);
    }
    await fetchAndCache(
      `/api/class/subjects?class_id=${encodeURIComponent(classId)}&slot=${encodeURIComponent(key)}`,
      `classDevice:subjects:${classId}:${key}`
    );
  });

  const preparedGrades = await prepareGrades("class-device", onProgress);
  for (const studentId of preparedGrades.studentIds) studentIds.add(studentId);
  const preparedTextbook = await prepareTextbook(onProgress);

  onProgress("Préparation de l’application…");
  await warmOfflineShell([
    "/choose-book",
    "/class",
    "/grades/class-device",
    "/enseignant/cahier-de-texte",
  ]);
  rememberOfflineBookDestinations({
    attendance: "/class",
    grades: "/grades/class-device",
  });

  return {
    version: 4,
    role: "class-device",
    prepared_at: new Date().toISOString(),
    class_count: uniqueIds([
      ...classIds,
      ...preparedGrades.classIds,
      ...preparedTextbook.classIds,
    ]).length,
    student_count: studentIds.size,
    slot_count: periods.length,
    evaluation_count: preparedGrades.evaluationCount,
    textbook_assignment_count: preparedTextbook.assignmentCount,
    bulletin_count: 0,
    parent_child_count: 0,
    grades_ready: true,
    textbook_ready: true,
    consultation_ready: false,
    communication_ready: false,
    shell_ready: true,
  };
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
  if (!cloud) {
    throw new Error("Reconnectez Internet pour actualiser les données hors ligne.");
  }

  const readiness =
    role === "teacher"
      ? await prepareTeacher(onProgress)
      : role === "class-device"
        ? await prepareClassDevice(onProgress)
        : role === "admin"
          ? await prepareAdmin(onProgress)
          : await prepareParent(onProgress);
  await cacheSet(readinessKey(role), readiness);
  return readiness;
}
