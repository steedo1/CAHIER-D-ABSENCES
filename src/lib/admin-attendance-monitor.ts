export type AdminAttendanceDataSource = "cloud" | "relay" | "cache";

export const ADMIN_ATTENDANCE_CLOUD_TIMEOUT_MS = 4_000;
export const ADMIN_ATTENDANCE_POLL_MS = {
  cloud: 5_000,
  relay: 10_000,
  cache: 30_000,
  error: 30_000,
  initial: 30_000,
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
  if (value.source !== "cloud" && value.source !== "relay" && value.source !== "cache") {
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
