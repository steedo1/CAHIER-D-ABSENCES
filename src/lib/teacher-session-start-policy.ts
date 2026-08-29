export type TeacherSessionStartMode =
  | "cloud"
  | "cloud_relay_presence"
  | "cloud_gps_presence"
  | "relay_only"
  | "device_only"
  | "blocked";

export type TeacherSessionStartDecision = {
  mode: TeacherSessionStartMode;
  force_gps: boolean;
  reason: "cloud_and_relay_unavailable" | "relay_schedule_mismatch" | "presence_unavailable" | null;
};

export function decideTeacherSessionStart(input: {
  cloud_available: boolean;
  presence_enabled: boolean;
  allow_gps_fallback: boolean;
  relay_configured: boolean;
  relay_reachable: boolean;
  relay_schedule_matches: boolean;
}): TeacherSessionStartDecision {
  const usableRelay =
    input.relay_configured &&
    input.relay_reachable &&
    input.relay_schedule_matches;

  if (!input.cloud_available) {
    if (usableRelay) {
      return { mode: "relay_only", force_gps: false, reason: null };
    }

    // L'absence simultanée du Cloud et du relais ne doit jamais empêcher
    // l'appel. Le téléphone conserve la séance et les marques localement,
    // puis les rejoue automatiquement dès qu'un chemin réseau revient.
    return {
      mode: "device_only",
      force_gps: false,
      reason: input.relay_reachable
        ? "relay_schedule_mismatch"
        : "cloud_and_relay_unavailable",
    };
  }

  if (!input.presence_enabled) {
    return { mode: "cloud", force_gps: false, reason: null };
  }
  if (usableRelay) {
    return { mode: "cloud_relay_presence", force_gps: false, reason: null };
  }
  if (input.allow_gps_fallback) {
    return { mode: "cloud_gps_presence", force_gps: true, reason: null };
  }
  return { mode: "blocked", force_gps: false, reason: "presence_unavailable" };
}
