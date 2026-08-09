//src/lib/offlineClassDevice.ts
"use client";

export const CLASS_DEVICE_COHERENT_BUNDLE_KEY =
  "classDevice:coherent-bundle:v1";

export type ClassDeviceRelayStatus =
  | "reachable"
  | "access_denied"
  | "permission_denied"
  | "incompatible_browser"
  | "unreachable";

export type ClassDeviceReadinessStatus =
  | "ready"
  | "ready_local"
  | "refresh_from_relay"
  | "not_prepared"
  | "web_release_stale"
  | "service_worker_stale"
  | "offline_schema_stale"
  | "shell_not_ready"
  | "relay_unreachable"
  | "relay_access_denied"
  | "relay_permission_denied"
  | "browser_incompatible"
  | "relay_contract_stale"
  | "schedule_not_prepared"
  | "relay_capability_missing"
  | "class_data_missing"
  | "institution_mismatch"
  | "class_mismatch"
  | "device_mismatch"
  | "phone_stale"
  | "relay_stale"
  | "sources_diverged";

export function isClassDeviceOperationalReadiness(
  status: ClassDeviceReadinessStatus | null | undefined,
) {
  return status === "ready" || status === "ready_local";
}

export type ClassDeviceReadinessLike = {
  version?: number;
  role?: string;
  web_release?: string;
  service_worker_release?: string;
  offline_schema_version?: number;
  shell_ready?: boolean;
  institution_id?: string | null;
  authorized_class_id?: string | null;
  authorized_actor_profile_id?: string | null;
  class_count?: number;
  slot_count?: number;
  schedule_revision?: number | null;
  data_presence?: {
    classes?: number;
    students?: number;
    slots?: number;
    assignments?: number;
  };
};

export type ClassDeviceCoherenceInput = {
  readiness: ClassDeviceReadinessLike | null;
  expected_web_release: string;
  expected_service_worker_release: string;
  active_service_worker_release: string | null;
  expected_offline_schema_version: number;
  expected_institution_id: string;
  expected_class_id: string;
  expected_actor_profile_id: string;
  bundle_present: boolean;
  bundle_schedule_revision: number | null;
  bundle_scope_valid: boolean;
  relay_status: ClassDeviceRelayStatus;
  relay_institution_id: string | null;
  relay_actor_kind: string | null;
  relay_class_id: string | null;
  relay_actor_profile_id: string | null;
  relay_schedule_available: boolean;
  relay_revision: number | null;
  cloud_revision: number | null;
  relay_writes_enabled: boolean;
  relay_capabilities?: {
    attendance_session_open?: boolean;
    attendance_write?: boolean;
    attendance_session_close?: boolean;
    class_device_scope_v1?: boolean;
  } | null;
};

export type ClassDeviceScheduleScope = {
  version?: unknown;
  scope_version?: unknown;
  institution_id?: unknown;
  actor_kind?: unknown;
  class_id?: unknown;
  actor_profile_id?: unknown;
  schedule_revision?: unknown;
  snapshot_completeness?: unknown;
  class_count?: unknown;
  slot_count?: unknown;
  slots?: unknown;
  rosters?: unknown;
  assignments?: unknown;
};

export type ClassDeviceCoherentBundle<
  TReadiness extends ClassDeviceReadinessLike = ClassDeviceReadinessLike,
  TSchedule extends ClassDeviceScheduleScope = ClassDeviceScheduleScope,
> = {
  schema_version: 1;
  readiness: TReadiness;
  schedule: TSchedule;
};

function normalizedId(value: unknown) {
  return String(value || "").trim();
}

type ClassDeviceRelayAccessPayload = {
  v?: unknown;
  purpose?: unknown;
  institution_id?: unknown;
  actor_profile_id?: unknown;
  actor_kind?: unknown;
  class_id?: unknown;
};

function decodeBase64UrlJson(value: string): ClassDeviceRelayAccessPayload | null {
  try {
    const normalized = String(value || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return JSON.parse(
      new TextDecoder().decode(bytes),
    ) as ClassDeviceRelayAccessPayload;
  } catch {
    return null;
  }
}

export function validateClassDeviceRelayAccessTokenScope(
  token: unknown,
  expected: {
    institutionId: string;
    classId: string;
    actorProfileId: string;
  },
):
  | { ok: true }
  | {
      ok: false;
      status: "relay_contract_stale" | "institution_mismatch" | "class_mismatch" | "device_mismatch";
    } {
  const [encodedPayload, encodedSignature, extra] = String(token || "")
    .trim()
    .split(".");
  if (!encodedPayload || !encodedSignature || extra) {
    return { ok: false, status: "relay_contract_stale" };
  }
  const payload = decodeBase64UrlJson(encodedPayload);
  if (
    !payload ||
    payload.v !== 2 ||
    payload.purpose !== "attendance_relay_access" ||
    payload.actor_kind !== "class_device"
  ) {
    return { ok: false, status: "relay_contract_stale" };
  }
  if (
    normalizedId(payload.institution_id) !==
    normalizedId(expected.institutionId)
  ) {
    return { ok: false, status: "institution_mismatch" };
  }
  if (normalizedId(payload.class_id) !== normalizedId(expected.classId)) {
    return { ok: false, status: "class_mismatch" };
  }
  if (
    !normalizedId(payload.actor_profile_id) ||
    normalizedId(payload.actor_profile_id) !==
      normalizedId(expected.actorProfileId)
  ) {
    return { ok: false, status: "device_mismatch" };
  }
  return { ok: true };
}

export function safeClassDeviceRevision(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

export function hasClassDeviceRelayCapabilities(
  capabilities: ClassDeviceCoherenceInput["relay_capabilities"],
) {
  return Boolean(
    capabilities?.attendance_session_open &&
      capabilities.attendance_write &&
      capabilities.attendance_session_close &&
      capabilities.class_device_scope_v1,
  );
}

export function validateClassDeviceScheduleScope(
  schedule: ClassDeviceScheduleScope | null | undefined,
  expected: {
    institutionId: string;
    classId: string;
    actorProfileId: string;
  },
): { ok: true; revision: number } | {
  ok: false;
  status:
    | "schedule_not_prepared"
    | "relay_contract_stale"
    | "institution_mismatch"
    | "class_mismatch"
    | "device_mismatch"
    | "class_data_missing";
} {
  if (
    !schedule ||
    schedule.version !== 1 ||
    schedule.snapshot_completeness !== "complete"
  ) {
    return { ok: false, status: "schedule_not_prepared" };
  }

  const institutionId = normalizedId(schedule.institution_id);
  const classId = normalizedId(schedule.class_id);
  const actorProfileId = normalizedId(schedule.actor_profile_id);
  if (
    schedule.scope_version !== 1 ||
    schedule.actor_kind !== "class_device"
  ) {
    return { ok: false, status: "relay_contract_stale" };
  }
  if (institutionId !== normalizedId(expected.institutionId)) {
    return { ok: false, status: "institution_mismatch" };
  }
  if (classId !== normalizedId(expected.classId)) {
    return { ok: false, status: "class_mismatch" };
  }
  if (
    !actorProfileId ||
    actorProfileId !== normalizedId(expected.actorProfileId)
  ) {
    return { ok: false, status: "device_mismatch" };
  }

  const revision = safeClassDeviceRevision(schedule.schedule_revision);
  const slots = Array.isArray(schedule.slots) ? schedule.slots : [];
  const rosters =
    schedule.rosters && typeof schedule.rosters === "object" && !Array.isArray(schedule.rosters)
      ? schedule.rosters as Record<string, unknown>
      : null;
  const assignments = Array.isArray(schedule.assignments)
    ? schedule.assignments
    : [];
  const rosterKeys = rosters ? Object.keys(rosters) : [];
  const roster = rosters?.[classId] as { items?: unknown } | undefined;
  const slotsAreScoped = slots.every((slot) => {
    if (!slot || typeof slot !== "object") return false;
    const row = slot as {
      period_id?: unknown;
      items?: unknown;
    };
    return (
      normalizedId(row.period_id) !== "" &&
      Array.isArray(row.items) &&
      row.items.length > 0 &&
      row.items.every(
        (item) =>
          item &&
          typeof item === "object" &&
          normalizedId((item as { class_id?: unknown }).class_id) === classId,
      )
    );
  });
  const assignmentsAreScoped = assignments.every(
    (assignment) =>
      assignment &&
      typeof assignment === "object" &&
      normalizedId((assignment as { class_id?: unknown }).class_id) === classId,
  );

  if (
    revision === null ||
    Number(schedule.class_count) !== 1 ||
    Number(schedule.slot_count) !== slots.length ||
    slots.length <= 0 ||
    !slotsAreScoped ||
    !rosters ||
    rosterKeys.length !== 1 ||
    rosterKeys[0] !== classId ||
    !Array.isArray(roster?.items) ||
    !assignmentsAreScoped
  ) {
    return { ok: false, status: "class_data_missing" };
  }

  return { ok: true, revision };
}

export function evaluateClassDeviceCoherence(
  input: ClassDeviceCoherenceInput,
): ClassDeviceReadinessStatus {
  const readiness = input.readiness;
  if (
    !readiness ||
    readiness.version !== 5 ||
    readiness.role !== "class-device" ||
    safeClassDeviceRevision(readiness.schedule_revision) === null
  ) {
    return "not_prepared";
  }
  // Les releases Web et service worker changent à chaque déploiement. Elles
  // servent au diagnostic et à la mise à jour, jamais à invalider les élèves,
  // le planning ou les opérations déjà préparés.
  const rawSchema = Number(readiness.offline_schema_version);
  const offlineSchemaVersion =
    Number.isSafeInteger(rawSchema) && rawSchema > 0
      ? rawSchema
      : readiness.version === 5
        ? 1
        : null;
  if (offlineSchemaVersion !== input.expected_offline_schema_version) {
    return "offline_schema_stale";
  }
  if (readiness.shell_ready !== true) return "shell_not_ready";

  const expectedInstitutionId = normalizedId(input.expected_institution_id);
  const expectedClassId = normalizedId(input.expected_class_id);
  const expectedActorProfileId = normalizedId(
    input.expected_actor_profile_id,
  );
  if (
    !expectedInstitutionId ||
    normalizedId(readiness.institution_id) !== expectedInstitutionId
  ) {
    return "institution_mismatch";
  }
  if (
    !expectedClassId ||
    normalizedId(readiness.authorized_class_id) !== expectedClassId
  ) {
    return "class_mismatch";
  }
  if (
    !expectedActorProfileId ||
    normalizedId(readiness.authorized_actor_profile_id) !==
      expectedActorProfileId
  ) {
    return "device_mismatch";
  }

  const phoneRevision = safeClassDeviceRevision(readiness.schedule_revision);
  if (
    readiness.class_count !== 1 ||
    Number(readiness.data_presence?.classes) !== 1 ||
    Number(readiness.data_presence?.slots) !== Number(readiness.slot_count) ||
    Number(readiness.slot_count) <= 0 ||
    !input.bundle_present ||
    !input.bundle_scope_valid ||
    input.bundle_schedule_revision !== phoneRevision
  ) {
    return "class_data_missing";
  }

  if (input.relay_status === "access_denied") return "relay_access_denied";
  if (input.relay_status === "permission_denied") return "relay_permission_denied";
  if (input.relay_status === "incompatible_browser") return "browser_incompatible";
  if (input.relay_status !== "reachable") return "relay_unreachable";
  if (input.relay_capabilities?.class_device_scope_v1 !== true) {
    return "relay_contract_stale";
  }
  if (!input.relay_schedule_available) return "schedule_not_prepared";
  if (normalizedId(input.relay_institution_id) !== expectedInstitutionId) {
    return "institution_mismatch";
  }
  if (input.relay_actor_kind !== "class_device") {
    return "relay_contract_stale";
  }
  if (normalizedId(input.relay_class_id) !== expectedClassId) {
    return "class_mismatch";
  }
  if (
    normalizedId(input.relay_actor_profile_id) !==
    expectedActorProfileId
  ) {
    return "device_mismatch";
  }
  if (
    !input.relay_writes_enabled ||
    !hasClassDeviceRelayCapabilities(input.relay_capabilities)
  ) {
    return "relay_capability_missing";
  }

  const relayRevision = safeClassDeviceRevision(input.relay_revision);
  if (relayRevision === null) return "schedule_not_prepared";
  const cloudRevision = safeClassDeviceRevision(input.cloud_revision);
  if (cloudRevision !== null && relayRevision !== cloudRevision) {
    return relayRevision < cloudRevision ? "relay_stale" : "sources_diverged";
  }
  if (phoneRevision! < relayRevision) return "refresh_from_relay";
  if (phoneRevision! > relayRevision) return "relay_stale";
  return "ready";
}

export function classDeviceReadinessMessage(
  status: ClassDeviceReadinessStatus,
) {
  const messages: Record<ClassDeviceReadinessStatus, string> = {
    ready: "Le shell, le relais et les données de cette classe sont cohérents.",
    ready_local:
      "Les données d’appel sont vérifiées sur ce téléphone. Le relais peut être indisponible sans bloquer le travail.",
    refresh_from_relay:
      "Le relais possède un planning plus récent. Actualisation sécurisée requise.",
    not_prepared:
      "Cet appareil doit être préparé avec le nouveau contrat hors ligne v5.",
    web_release_stale:
      "Une mise à jour de Mon Cahier est disponible. Les données hors ligne restent utilisables.",
    service_worker_stale:
      "Une mise à jour du service hors ligne est disponible. Elle ne bloque pas l’appel préparé.",
    offline_schema_stale:
      "Le format des données hors ligne a réellement changé. Une nouvelle préparation complète est requise.",
    shell_not_ready:
      "Le shell hors ligne est incomplet. Relancez la préparation de l’appareil.",
    relay_unreachable:
      "Le relais local est inaccessible. Rejoignez le Wi-Fi local avant d’ouvrir l’appel.",
    relay_access_denied:
      "Le relais refuse l’autorisation de cet appareil. Réactualisez son association.",
    relay_permission_denied:
      "La permission d’accès au réseau local est refusée pour ce navigateur.",
    browser_incompatible:
      "Ce navigateur ne peut pas vérifier le relais local.",
    relay_contract_stale:
      "Le relais actif utilise encore un ancien contrat pour les téléphones de classe. Il doit être recompilé puis redémarré.",
    schedule_not_prepared:
      "Le planning d’appel n’est pas préparé sur le relais.",
    relay_capability_missing:
      "Le relais ne confirme pas les capacités requises d’ouverture, d’écriture et de fermeture.",
    class_data_missing:
      "Les données pédagogiques vérifiées de cette classe sont absentes ou incomplètes.",
    institution_mismatch:
      "L’établissement de l’appareil ne correspond pas à celui du relais.",
    class_mismatch:
      "La classe autorisée par le relais ne correspond pas à cet appareil.",
    device_mismatch:
      "L’autorisation du relais appartient à un autre appareil de classe.",
    phone_stale:
      "Le relais est plus récent, mais l’actualisation atomique du téléphone a échoué.",
    relay_stale:
      "Le relais est en retard sur le téléphone ou sur le Cloud. L’administration doit l’actualiser.",
    sources_diverged:
      "Les révisions du Cloud et du relais divergent. L’ouverture de l’appel est bloquée.",
  };
  return messages[status];
}

export type ClassDeviceSnapshot<TState = any> = {
  classId: string;
  updatedAt: string; // ISO
  state: TState;
};

const SNAPSHOT_PREFIX = "moncahier.classDevice.snapshot.";

/**
 * Sauvegarde un snapshot pour une classe.
 * - classId : identifiant de la classe (ex: "5e2" ou l'id Supabase)
 * - state : ton state principal de la page (tableau d'élèves, notes, etc.)
 */
export function saveClassDeviceSnapshot<TState = any>(
  classId: string,
  state: TState
) {
  if (typeof window === "undefined") return;

  const snapshot: ClassDeviceSnapshot<TState> = {
    classId,
    updatedAt: new Date().toISOString(),
    state,
  };

  try {
    localStorage.setItem(
      SNAPSHOT_PREFIX + classId,
      JSON.stringify(snapshot)
    );
  } catch (e) {
    console.warn("[offlineClassDevice] save error", e);
  }
}

/**
 * Charge le snapshot d'une classe si disponible.
 */
export function loadClassDeviceSnapshot<TState = any>(
  classId: string
): ClassDeviceSnapshot<TState> | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem(SNAPSHOT_PREFIX + classId);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ClassDeviceSnapshot<TState>;
  } catch (e) {
    console.warn("[offlineClassDevice] load error", e);
    return null;
  }
}

/**
 * Supprime le snapshot (après sync réussie par exemple).
 */
export function clearClassDeviceSnapshot(classId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SNAPSHOT_PREFIX + classId);
  } catch (e) {
    console.warn("[offlineClassDevice] clear error", e);
  }
}
