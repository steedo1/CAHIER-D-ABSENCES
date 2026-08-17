"use client";

import {
  getRelayConfig,
  resolveRelayInstitutionId,
} from "@/lib/local-relay";

export type RelaySupervisionState =
  | "operational"
  | "degraded"
  | "unreachable"
  | "not_configured";

export type RelayAcademicCounts = {
  classes?: number;
  students?: number;
  teachers?: number;
  subjects?: number;
  grading_periods?: number;
  assessments?: number;
  grades?: number;
  published_scores?: number;
};

export type RelayHealthPayload = {
  ok?: boolean;
  relay_version?: string;
  schema_version?: number;
  protocol_version?: number;
  snapshot_revision?: number | null;
  generated_at?: string | null;
  schedule_status?: string | null;
  academic?: {
    ready?: boolean;
    revision?: number | null;
    snapshot_complete?: boolean;
    last_sync_at?: string | null;
    required_collections_complete?: boolean;
    counts?: RelayAcademicCounts;
  };
};

export type RelayDashboardPayload = {
  source?: string;
  generated_at?: string | null;
  institution?: {
    id?: string;
    name?: string;
    code?: string | null;
    timezone?: string;
  };
  counts?: {
    students?: number;
    classes?: number;
    teachers?: number;
    documents?: number;
  };
  sync?: {
    pending_operations?: number;
    blocked_operations?: number;
    unresolved_conflicts?: number;
    materialization_failures?: number;
    last_cloud_sync_at?: string | null;
    last_cloud_sync_error_at?: string | null;
    last_cloud_sync_error?: string | null;
  };
};

export type RelayHealthProbe = {
  checked_at: string;
  configured: boolean;
  base_url: string;
  reachable: boolean;
  data_ready: boolean;
  health: RelayHealthPayload | null;
  error: string | null;
};

export type RelaySupervisionSnapshot = RelayHealthProbe & {
  state: RelaySupervisionState;
  message: string;
  institution_id: string | null;
  dashboard: RelayDashboardPayload | null;
  dashboard_error: string | null;
};

type RelayTargetAddressSpace = "local" | "loopback";

function relayAddressSpace(baseUrl: string): RelayTargetAddressSpace {
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127(?:\.|$)/.test(hostname);
  return loopback ? "loopback" : "local";
}

function supportsRelayTargetAddressSpace() {
  return (
    typeof window !== "undefined" &&
    typeof Request !== "undefined" &&
    "targetAddressSpace" in Request.prototype
  );
}

function normalizeError(error: unknown) {
  if (error instanceof Error) return error.message || error.name;
  return String(error || "relay_request_failed");
}

async function safeJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function localRelayGet<T>(
  baseUrl: string,
  path: string,
  token: string | null,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(6_000);
  const controller = new AbortController();
  const abort = () => controller.abort();
  timeout.addEventListener("abort", abort, { once: true });
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const headers = new Headers({ Accept: "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const init: RequestInit & { targetAddressSpace?: RelayTargetAddressSpace } = {
      method: "GET",
      headers,
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      signal: controller.signal,
    };
    if (supportsRelayTargetAddressSpace()) {
      init.targetAddressSpace = relayAddressSpace(baseUrl);
    }
    const response = await fetch(`${baseUrl}${path}`, init as RequestInit);
    const payload = await safeJson(response);
    if (!response.ok) {
      throw new Error(String(payload?.error || `RELAY_HTTP_${response.status}`));
    }
    return payload as T;
  } finally {
    timeout.removeEventListener("abort", abort);
    signal?.removeEventListener("abort", abort);
  }
}

function isAcademicReady(health: RelayHealthPayload | null) {
  return Boolean(
    health?.academic?.ready === true &&
      health?.academic?.snapshot_complete === true &&
      health?.academic?.required_collections_complete === true,
  );
}

function hasSyncIncident(dashboard: RelayDashboardPayload | null) {
  const sync = dashboard?.sync;
  if (!sync) return false;
  return (
    Number(sync.blocked_operations || 0) > 0 ||
    Number(sync.unresolved_conflicts || 0) > 0 ||
    Number(sync.materialization_failures || 0) > 0 ||
    Boolean(sync.last_cloud_sync_error)
  );
}

export async function probeRelayHealth(signal?: AbortSignal): Promise<RelayHealthProbe> {
  const config = getRelayConfig();
  const checkedAt = new Date().toISOString();
  try {
    // /health est volontairement public sur le LAN : aucun secret n'est envoyé
    // pour le simple voyant de disponibilité affiché dans le shell Admin.
    const health = await localRelayGet<RelayHealthPayload>(
      config.baseUrl,
      "/health",
      null,
      signal,
    );
    return {
      checked_at: checkedAt,
      configured: Boolean(config.token),
      base_url: config.baseUrl,
      reachable: health.ok === true,
      data_ready: isAcademicReady(health),
      health,
      error: null,
    };
  } catch (error) {
    return {
      checked_at: checkedAt,
      configured: Boolean(config.token),
      base_url: config.baseUrl,
      reachable: false,
      data_ready: false,
      health: null,
      error: normalizeError(error),
    };
  }
}

export async function readRelaySupervision(
  signal?: AbortSignal,
): Promise<RelaySupervisionSnapshot> {
  const config = getRelayConfig();
  const probe = await probeRelayHealth(signal);

  if (!probe.reachable) {
    return {
      ...probe,
      state: "unreachable",
      message:
        "Le PC relais ne répond pas. Vérifiez qu'il est allumé et que Mon Cahier Relay est lancé.",
      institution_id: null,
      dashboard: null,
      dashboard_error: probe.error,
    };
  }

  if (!config.token) {
    return {
      ...probe,
      state: "not_configured",
      message:
        "Le relais répond, mais ce navigateur n'a pas encore de jeton administrateur configuré.",
      institution_id: null,
      dashboard: null,
      dashboard_error: null,
    };
  }

  const institutionId = await resolveRelayInstitutionId(signal).catch(() => null);
  if (!institutionId) {
    return {
      ...probe,
      state: "degraded",
      message:
        "Le relais répond, mais l'établissement de ce compte n'a pas encore été associé dans ce navigateur.",
      institution_id: null,
      dashboard: null,
      dashboard_error: "relay_institution_missing",
    };
  }

  let dashboard: RelayDashboardPayload | null = null;
  let dashboardError: string | null = null;
  try {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Abidjan",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const query = new URLSearchParams({ institution_id: institutionId, date });
    dashboard = await localRelayGet<RelayDashboardPayload>(
      config.baseUrl,
      `/v1/admin/dashboard?${query.toString()}`,
      config.token,
      signal,
    );
  } catch (error) {
    dashboardError = normalizeError(error);
  }

  if (!dashboard) {
    return {
      ...probe,
      state: "degraded",
      message:
        dashboardError === "unauthorized"
          ? "Le relais répond, mais le jeton administrateur n'est pas reconnu pour cet établissement."
          : "Le relais répond, mais son diagnostic administrateur n'est pas disponible.",
      institution_id: institutionId,
      dashboard: null,
      dashboard_error: dashboardError,
    };
  }

  if (!probe.data_ready) {
    return {
      ...probe,
      state: "degraded",
      message:
        "Relais détecté, mais les données académiques hors ligne ne sont pas encore complètement prêtes.",
      institution_id: institutionId,
      dashboard,
      dashboard_error: null,
    };
  }

  if (hasSyncIncident(dashboard)) {
    return {
      ...probe,
      state: "degraded",
      message:
        "Le relais fonctionne, mais une anomalie de synchronisation demande une vérification.",
      institution_id: institutionId,
      dashboard,
      dashboard_error: null,
    };
  }

  return {
    ...probe,
    state: "operational",
    message:
      "Relais opérationnel — l'établissement peut continuer à utiliser les fonctions préparées en cas de coupure Internet.",
    institution_id: institutionId,
    dashboard,
    dashboard_error: null,
  };
}

export function sanitizedRelayDiagnostic(snapshot: RelaySupervisionSnapshot) {
  return {
    checked_at: snapshot.checked_at,
    state: snapshot.state,
    message: snapshot.message,
    configured: snapshot.configured,
    base_url: snapshot.base_url,
    reachable: snapshot.reachable,
    data_ready: snapshot.data_ready,
    institution_id: snapshot.institution_id,
    health: snapshot.health,
    dashboard: snapshot.dashboard,
    dashboard_error: snapshot.dashboard_error,
  };
}
