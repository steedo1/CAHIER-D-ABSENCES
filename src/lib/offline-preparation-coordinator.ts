"use client";

import { probeCloudSchedule } from "@/lib/cloud-availability";
import {
  getOfflineReadiness,
  prepareOffline,
  type ClassDeviceAssessmentContext,
  type OfflineReadiness,
  type OfflineRole,
} from "@/lib/offline-readiness";
import { cacheGet } from "@/lib/offline";
import { getPreparationWorkerRelease } from "@/lib/offline-preparation-service-worker";
import {
  checkRelayTeacherConnectivity,
  type RelayTeacherConnectivityResult,
} from "@/lib/local-relay";
import {
  createOfflinePreparationMachine,
  type OfflinePreparationDecision,
  type OfflinePreparationSnapshot,
  type OfflinePreparationTrigger,
} from "@/lib/offline-preparation-machine";
import {
  MON_CAHIER_SERVICE_WORKER_RELEASE,
} from "@/lib/offline-release";

export const OFFLINE_PREPARATION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const OFFLINE_PREPARATION_LIGHT_CHECK_INTERVAL_MS = 5 * 60 * 1_000;
export const OFFLINE_PREPARATION_TIMEOUT_MS = 60_000;

const classDeviceContexts = new Map<string, ClassDeviceAssessmentContext>();

function roleKey(role: OfflineRole) {
  return role;
}

function contextSignature(context?: ClassDeviceAssessmentContext) {
  if (!context) return "";
  return [
    context.institutionId,
    context.classId,
    context.actorProfileId,
    context.relayBaseUrl,
    context.relayAccessToken,
  ]
    .map((value) => String(value || "").trim())
    .join("|");
}

export function setOfflinePreparationContext(
  role: OfflineRole,
  context?: ClassDeviceAssessmentContext,
) {
  if (role !== "class-device") return;
  const previous = classDeviceContexts.get(roleKey(role));
  const changed = contextSignature(previous) !== contextSignature(context);
  if (context) classDeviceContexts.set(roleKey(role), context);
  else classDeviceContexts.delete(roleKey(role));
  if (changed && context) {
    queueMicrotask(() => {
      void machine.run(role, { trigger: "context_change" });
    });
  }
}

function revision(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function coreIsValid(
  readiness: OfflineReadiness | null,
  role: OfflineRole,
): readiness is OfflineReadiness {
  if (!readiness || readiness.version !== 5 || readiness.role !== role) return false;
  if (
    readiness.preparation_scope !== "attendance-core" ||
    readiness.attendance_core_ready !== true ||
    readiness.queues_ready !== true ||
    readiness.identity_ready !== true ||
    readiness.shell_ready !== true
  ) {
    return false;
  }
  if (readiness.service_worker_release !== MON_CAHIER_SERVICE_WORKER_RELEASE) {
    return false;
  }
  if (role === "teacher") {
    return (
      Boolean(readiness.institution_id) &&
      Boolean(readiness.actor_profile_id) &&
      revision(readiness.schedule_revision) !== null &&
      Number(readiness.class_count || 0) >= 0 &&
      Number(readiness.slot_count || 0) >= 0
    );
  }
  if (role === "class-device") {
    return (
      Boolean(readiness.institution_id) &&
      Boolean(readiness.authorized_class_id) &&
      Boolean(readiness.authorized_actor_profile_id) &&
      revision(readiness.schedule_revision) !== null &&
      Number(readiness.class_count || 0) === 1 &&
      Number(readiness.slot_count || 0) >= 0
    );
  }
  return true;
}

async function relayCheckWithin(
  input: Parameters<typeof checkRelayTeacherConnectivity>[0],
  signal: AbortSignal,
  timeoutMs = 4_000,
): Promise<RelayTeacherConnectivityResult> {
  if (signal.aborted) throw signal.reason || new Error("Préparation annulée.");
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

async function relayForTeacher(
  signal: AbortSignal,
): Promise<RelayTeacherConnectivityResult> {
  const basics: any = await cacheGet("teacher:inst:basics").catch(() => null);
  const institutionId = String(basics?.institution_id || "").trim();
  const policy = basics?.attendance_presence || {};
  if (
    !institutionId ||
    policy?.allow_local_relay === false ||
    !String(policy?.relay_local_url || "").trim() ||
    !String(policy?.relay_access_token || "").trim()
  ) {
    return { status: "unreachable", checked_at: new Date().toISOString() };
  }
  if (signal.aborted) throw signal.reason;
  return relayCheckWithin(
    {
      institutionId,
      baseUrl: String(policy.relay_local_url),
      accessToken: String(policy.relay_access_token),
    },
    signal,
  );
}

async function relayForClassDevice(
  readiness: OfflineReadiness,
  signal: AbortSignal,
): Promise<RelayTeacherConnectivityResult> {
  const context = classDeviceContexts.get(roleKey("class-device"));
  const institutionId = String(
    context?.institutionId || readiness.institution_id || "",
  ).trim();
  const baseUrl = String(context?.relayBaseUrl || "").trim();
  const accessToken = String(context?.relayAccessToken || "").trim();
  if (!institutionId || !baseUrl || !accessToken) {
    return { status: "unreachable", checked_at: new Date().toISOString() };
  }
  if (signal.aborted) throw signal.reason;
  return relayCheckWithin(
    { institutionId, baseUrl, accessToken },
    signal,
  );
}

async function checkCore(
  role: OfflineRole,
  signal: AbortSignal,
  trigger: OfflinePreparationTrigger,
): Promise<OfflinePreparationDecision<OfflineReadiness>> {
  const readiness = await getOfflineReadiness(role).catch(() => null);
  if (!coreIsValid(readiness, role)) {
    return {
      state: "prepare_core",
      readiness,
      message: "Préparation du noyau d’appel hors ligne…",
    };
  }

  const checkedAt = new Date(readiness.checked_at || readiness.prepared_at).getTime();
  const forceLightCheck =
    trigger === "online" ||
    trigger === "service_worker" ||
    trigger === "context_change" ||
    trigger === "retry" ||
    trigger === "manual";
  const lightCheckDue =
    !Number.isFinite(checkedAt) ||
    Date.now() - checkedAt >= OFFLINE_PREPARATION_LIGHT_CHECK_INTERVAL_MS;
  if (!forceLightCheck && !lightCheckDue) {
    return { state: "ready", readiness };
  }

  const activeRelease = await getPreparationWorkerRelease(signal);
  if (activeRelease !== MON_CAHIER_SERVICE_WORKER_RELEASE) {
    return {
      state: "prepare_core",
      readiness,
      message: "Actualisation contrôlée du service hors ligne…",
    };
  }

  if (role === "admin" || role === "parent") {
    return { state: "ready", readiness };
  }

  const phoneRevision = revision(readiness.schedule_revision);
  const [cloud, relay] = await Promise.all([
    probeCloudSchedule(3_500),
    role === "teacher"
      ? relayForTeacher(signal)
      : relayForClassDevice(readiness, signal),
  ]);
  const cloudMatchesInstitution =
    cloud &&
    String(cloud.institution_id || "").trim() ===
      String(readiness.institution_id || "").trim()
      ? cloud
      : null;
  const cloudRevision = revision(cloudMatchesInstitution?.schedule_revision);
  const relayRevision = revision(relay.snapshot_revision);

  if (
    cloudRevision !== null &&
    phoneRevision !== null &&
    cloudRevision > phoneRevision
  ) {
    return {
      state: "prepare_core",
      readiness,
      message: "Une nouvelle révision du planning d’appel est disponible…",
    };
  }
  if (
    cloudRevision !== null &&
    phoneRevision !== null &&
    cloudRevision < phoneRevision
  ) {
    return {
      state: "error",
      readiness,
      message: "La révision Cloud est plus ancienne que celle de cet appareil.",
    };
  }

  if (cloudRevision === phoneRevision) return { state: "ready", readiness };
  if (relay.status === "reachable" && relayRevision === phoneRevision) {
    return { state: "ready_local", readiness };
  }
  return {
    state: "ready_local",
    readiness,
    message:
      relay.status === "reachable" &&
      relayRevision !== null &&
      phoneRevision !== null &&
      relayRevision > phoneRevision
        ? "Le relais possède un planning plus récent ; l’appel peut utiliser le relais et le cache sera actualisé au retour du Cloud."
        : "Cloud et relais indisponibles : le noyau d’appel déjà préparé reste utilisable.",
  };
}

const machine = createOfflinePreparationMachine<OfflineReadiness>({
  timeoutMs: OFFLINE_PREPARATION_TIMEOUT_MS,
  minimumCheckIntervalMs: 15_000,
  retryDelaysMs: [15_000, 45_000, 120_000, 300_000],
  check: async (role, context) =>
    checkCore(role as OfflineRole, context.signal, context.trigger),
  prepare: async (role, context) =>
    prepareOffline(role as OfflineRole, context.onProgress, {
      signal: context.signal,
    }),
  classifyPrepared: async (_role, readiness) => ({
    state:
      readiness.schedule_compatibility === "ready_local" ||
      readiness.class_device_compatibility === "ready_local"
        ? "ready_local"
        : "ready",
    readiness,
  }),
});

export function runCoordinatedOfflinePreparation(
  role: OfflineRole,
  options: {
    trigger: OfflinePreparationTrigger;
    classDeviceContext?: ClassDeviceAssessmentContext;
  },
) {
  if (role === "class-device") {
    setOfflinePreparationContext(role, options.classDeviceContext);
  }
  return machine.run(role, { trigger: options.trigger });
}

export function getOfflinePreparationSnapshot(role: OfflineRole) {
  return machine.getSnapshot(role);
}

export function subscribeOfflinePreparation(
  role: OfflineRole,
  listener: (snapshot: OfflinePreparationSnapshot<OfflineReadiness>) => void,
) {
  return machine.subscribe((snapshot) => {
    if (snapshot.role === role) listener(snapshot);
  });
}
