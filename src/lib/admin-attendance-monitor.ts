export type AdminAttendanceDataSource = "cloud" | "relay" | "hybrid" | "cache";

export const ADMIN_ATTENDANCE_CLOUD_TIMEOUT_MS = 4_000;
export const ADMIN_ATTENDANCE_POLL_MS = {
  cloud: 20_000,
  relay: 10_000,
  hybrid: 10_000,
  cache: 60_000,
  error: 60_000,
  initial: 60_000,
} as const;

export type AdminAttendanceViewState<T> = {
  loading: boolean;
  error: string | null;
  data: T[] | null;
  source: AdminAttendanceDataSource | null;
  savedAt: string | null;
};

export type AdminAttendanceViewAction<T> =
  | { type: "begin" }
  | {
      type: "success";
      data: T[];
      source: AdminAttendanceDataSource;
      savedAt: string;
    }
  | { type: "failure"; error: string };

export function initialAdminAttendanceViewState<T>(): AdminAttendanceViewState<T> {
  return {
    loading: false,
    error: null,
    data: null,
    source: null,
    savedAt: null,
  };
}

export function adminAttendanceViewReducer<T>(
  state: AdminAttendanceViewState<T>,
  action: AdminAttendanceViewAction<T>,
): AdminAttendanceViewState<T> {
  if (action.type === "begin") return { ...state, loading: true };
  if (action.type === "success") {
    return {
      loading: false,
      error: null,
      data: action.data,
      source: action.source,
      savedAt: action.savedAt,
    };
  }
  return {
    ...state,
    loading: false,
    error: action.error,
  };
}

export function adminAttendancePollDelay(
  source: AdminAttendanceDataSource | null,
  hasError: boolean,
) {
  if (hasError) return ADMIN_ATTENDANCE_POLL_MS.error;
  if (!source) return ADMIN_ATTENDANCE_POLL_MS.initial;
  return ADMIN_ATTENDANCE_POLL_MS[source];
}

export function adminAttendanceCacheKeys(queryString: string, institutionId: string) {
  return {
    legacy: `relay:admin:attendance:${queryString}`,
    scoped: `relay:admin:attendance:${encodeURIComponent(institutionId)}:${queryString}`,
  };
}

export function isInstitutionScopedAdminAttendanceEnvelope(
  envelope: unknown,
  expectedInstitutionId: string,
) {
  if (!envelope || typeof envelope !== "object") return false;
  const value = envelope as Record<string, unknown>;
  if (value.institution_id !== expectedInstitutionId) return false;
  if (
    value.source !== "cloud" &&
    value.source !== "relay" &&
    value.source !== "hybrid" &&
    value.source !== "cache"
  ) {
    return false;
  }
  if (typeof value.saved_at !== "string") return false;
  if (!Number.isFinite(new Date(value.saved_at).getTime())) return false;
  const data = value.data;
  return Boolean(
    data &&
      typeof data === "object" &&
      Array.isArray((data as Record<string, unknown>).rows),
  );
}


export type AdminAttendanceMergeableRow = Record<string, any> & {
  id?: unknown;
  status?: unknown;
};

function attendanceEvidenceRank(status: unknown) {
  const value = String(status || "").trim();
  if (value === "ok" || value === "late") return 3;
  if (value === "started") return 2;
  return 1;
}

/**
 * Fusionne les faits Cloud et Relais sans faire disparaître les métadonnées Cloud.
 *
 * Le Relais gagne uniquement lorsqu'il apporte une preuve de cours plus avancée
 * (ex. Cloud "missing/not_started" mais Relais "started/ok/late").
 * Si les deux sources ont le même niveau de preuve, le Cloud reste prioritaire
 * car il expose davantage de métadonnées de réception.
 */
export function mergeAdminAttendanceRows<T extends AdminAttendanceMergeableRow>(
  cloudRows: readonly T[],
  relayRows: readonly T[],
): T[] {
  const relayById = new Map<string, T>();
  for (const row of relayRows || []) {
    const id = String(row?.id || "").trim();
    if (id) relayById.set(id, row);
  }

  const seen = new Set<string>();
  const merged = (cloudRows || []).map((cloudRow) => {
    const id = String(cloudRow?.id || "").trim();
    if (!id) return cloudRow;
    seen.add(id);
    const relayRow = relayById.get(id);
    if (!relayRow) return cloudRow;

    const cloudRank = attendanceEvidenceRank(cloudRow.status);
    const relayRank = attendanceEvidenceRank(relayRow.status);
    if (relayRank > cloudRank) {
      return { ...cloudRow, ...relayRow } as T;
    }
    return { ...relayRow, ...cloudRow } as T;
  });

  for (const relayRow of relayRows || []) {
    const id = String(relayRow?.id || "").trim();
    if (!id || seen.has(id)) continue;
    merged.push(relayRow);
  }

  return merged;
}

export function createTimedAbortSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(external?.reason);

  if (external?.aborted) {
    onAbort();
  } else {
    external?.addEventListener("abort", onAbort, { once: true });
  }

  const timeout = globalThis.setTimeout(() => {
    controller.abort(new DOMException(timeoutMessage, "TimeoutError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      globalThis.clearTimeout(timeout);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

export async function readCloudRelayCache<T>(options: {
  signal?: AbortSignal;
  cloud: () => Promise<T>;
  relay?: () => Promise<T>;
  cache: () => Promise<T | null>;
}): Promise<T> {
  let cloudError: unknown;

  try {
    return await options.cloud();
  } catch (error) {
    if (options.signal?.aborted) throw error;
    cloudError = error;
  }

  if (options.relay) {
    try {
      return await options.relay();
    } catch (error) {
      if (options.signal?.aborted) throw error;
    }
  }

  const cached = await options.cache();
  if (cached) return cached;
  throw cloudError;
}
