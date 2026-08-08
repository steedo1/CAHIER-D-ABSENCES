import type { OfflineStorageProtectionStatus } from "@/lib/offline-storage-security";

export type OfflineAutoPreparationInput = {
  has_readiness: boolean;
  stale: boolean;
  preparing: boolean;
  storage_status?: OfflineStorageProtectionStatus | null;
};

export function shouldAutomaticallyPrepareOffline(
  input: OfflineAutoPreparationInput,
): boolean {
  if (input.preparing) return false;
  if (input.storage_status === "low_space") return false;
  return !input.has_readiness || input.stale;
}

export function shouldShowOfflinePreparationRetry(input: {
  preparing: boolean;
  error?: string | null;
  storage_status?: OfflineStorageProtectionStatus | null;
}): boolean {
  if (input.preparing) return false;
  return Boolean(input.error) || input.storage_status === "low_space";
}
