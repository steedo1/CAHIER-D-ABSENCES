export type SchedulePolicyStatus =
  | "ready"
  | "refresh_from_relay"
  | "not_prepared"
  | "relay_unreachable"
  | "relay_access_denied"
  | "relay_permission_denied"
  | "browser_incompatible"
  | "relay_incompatible"
  | "phone_stale"
  | "relay_stale"
  | "sources_diverged";

export type SchedulePolicyInput = {
  phone_prepared: boolean;
  relay_status:
    | "reachable"
    | "access_denied"
    | "permission_denied"
    | "incompatible_browser"
    | "unreachable";
  relay_contract_complete: boolean;
  phone_revision: number | null;
  relay_revision: number | null;
  cloud_revision: number | null;
};

export function decideOfflineSchedulePolicy(
  input: SchedulePolicyInput,
): SchedulePolicyStatus {
  if (!input.phone_prepared || input.phone_revision === null) {
    return "not_prepared";
  }
  if (input.relay_status === "access_denied") return "relay_access_denied";
  if (input.relay_status === "permission_denied") {
    return "relay_permission_denied";
  }
  if (input.relay_status === "incompatible_browser") {
    return "browser_incompatible";
  }
  if (input.relay_status !== "reachable") return "relay_unreachable";
  if (!input.relay_contract_complete || input.relay_revision === null) {
    return "relay_incompatible";
  }
  if (
    input.cloud_revision !== null &&
    input.relay_revision !== input.cloud_revision
  ) {
    return input.relay_revision < input.cloud_revision
      ? "relay_stale"
      : "sources_diverged";
  }
  if (input.phone_revision < input.relay_revision) {
    return "refresh_from_relay";
  }
  if (input.phone_revision > input.relay_revision) return "relay_stale";
  return "ready";
}

export type TeacherCloudFallbackInput = {
  phone_prepared: boolean;
  phone_revision: number | null;
  cloud_reachable: boolean;
  cloud_revision: number | null;
  presence_enabled: boolean;
  allow_gps_fallback: boolean;
};

/**
 * Le relais ne participe pas à cette décision : cette voie n'est sûre que si
 * le Cloud confirme exactement la révision déjà préparée sur le téléphone.
 * La preuve de présence reste, elle, soumise au réglage GPS de l'établissement.
 */
export function canUseTeacherCloudFallback(
  input: TeacherCloudFallbackInput,
): boolean {
  if (
    !input.phone_prepared ||
    !input.cloud_reachable ||
    input.phone_revision === null ||
    input.cloud_revision === null ||
    input.phone_revision !== input.cloud_revision
  ) {
    return false;
  }
  return !input.presence_enabled || input.allow_gps_fallback;
}
