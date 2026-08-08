"use client";

import {
  getOfflineReadiness,
  prepareOffline,
  type OfflineReadiness,
  type OfflineRole,
} from "@/lib/offline-readiness";
import { shouldAutomaticallyPrepareOffline } from "@/lib/offline-auto-preparation";
import { getOfflineStorageProtection } from "@/lib/offline-storage-security";

export const OFFLINE_PREPARATION_EVENT = "moncahier:offline-preparation-updated";
export const OFFLINE_PREPARATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const OFFLINE_PREPARATION_CHECK_INTERVAL_MS = 15 * 60 * 1000;

type ProgressCallback = (message: string) => void;

const inFlight = new Map<OfflineRole, Promise<OfflineReadiness>>();

export function offlineReadinessIsStale(
  readiness: OfflineReadiness | null,
  now = Date.now(),
) {
  if (!readiness) return true;
  const preparedAt = new Date(readiness.prepared_at).getTime();
  return (
    !Number.isFinite(preparedAt) ||
    now - preparedAt > OFFLINE_PREPARATION_MAX_AGE_MS
  );
}

function announce(role: OfflineRole, readiness: OfflineReadiness) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(OFFLINE_PREPARATION_EVENT, {
      detail: { role, readiness },
    }),
  );
}

export async function runCoordinatedOfflinePreparation(
  role: OfflineRole,
  options: {
    force?: boolean;
    onProgress?: ProgressCallback;
  } = {},
): Promise<{ attempted: boolean; readiness: OfflineReadiness | null }> {
  const current = inFlight.get(role);
  if (current) {
    return { attempted: true, readiness: await current };
  }

  const [stored, storageProtection] = await Promise.all([
    getOfflineReadiness(role).catch(() => null),
    getOfflineStorageProtection().catch(() => null),
  ]);
  const shouldPrepare =
    options.force === true ||
    shouldAutomaticallyPrepareOffline({
      has_readiness: Boolean(stored),
      stale: offlineReadinessIsStale(stored),
      preparing: false,
      storage_status:
        storageProtection?.status || stored?.storage_protection?.status,
    });

  if (!shouldPrepare) {
    return { attempted: false, readiness: stored };
  }

  const job = prepareOffline(role, options.onProgress)
    .then((readiness) => {
      announce(role, readiness);
      return readiness;
    })
    .finally(() => {
      if (inFlight.get(role) === job) inFlight.delete(role);
    });
  inFlight.set(role, job);
  return { attempted: true, readiness: await job };
}
