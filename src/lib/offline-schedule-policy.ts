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

export type TeacherCloudFallbackPolicyStatus =
  | "ready_cloud"
  | "ready_cloud_gps"
  | "not_prepared"
  | "cloud_unreachable"
  | "phone_stale"
  | "sources_diverged"
  | "gps_fallback_disabled"
  | "gps_zones_missing";

export type TeacherCloudFallbackPolicyInput = {
  phone_prepared: boolean;
  phone_revision: number | null;
  cloud_reachable: boolean;
  cloud_revision: number | null;
  presence_required: boolean;
  gps_fallback_allowed: boolean;
  active_gps_zone_count: number;
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

/**
 * Décide si le téléphone personnel du professeur peut ignorer un relais local
 * indisponible et ouvrir la séance directement dans le Cloud.
 *
 * Ce secours reste strict : le planning préparé doit correspondre exactement à
 * la révision Cloud et, lorsque la preuve de présence est activée, le GPS doit
 * être autorisé avec au moins une zone active configurée.
 */
export function decideTeacherCloudFallbackPolicy(
  input: TeacherCloudFallbackPolicyInput,
): TeacherCloudFallbackPolicyStatus {
  if (!input.phone_prepared || input.phone_revision === null) {
    return "not_prepared";
  }
  if (!input.cloud_reachable || input.cloud_revision === null) {
    return "cloud_unreachable";
  }
  if (input.phone_revision < input.cloud_revision) return "phone_stale";
  if (input.phone_revision > input.cloud_revision) {
    return "sources_diverged";
  }
  if (!input.presence_required) return "ready_cloud";
  if (!input.gps_fallback_allowed) return "gps_fallback_disabled";
  if (
    !Number.isFinite(input.active_gps_zone_count) ||
    input.active_gps_zone_count <= 0
  ) {
    return "gps_zones_missing";
  }
  return "ready_cloud_gps";
}
