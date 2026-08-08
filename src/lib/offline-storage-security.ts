"use client";

export type OfflineStorageProtectionStatus =
  | "persistent"
  | "best_effort"
  | "low_space"
  | "unsupported";

export type OfflineStorageProtection = {
  checked_at: string;
  status: OfflineStorageProtectionStatus;
  supported: boolean;
  persisted: boolean;
  persistence_requested: boolean;
  quota_bytes: number | null;
  usage_bytes: number | null;
  available_bytes: number | null;
  usage_ratio: number | null;
};

type StorageEstimateLike = {
  quota?: number;
  usage?: number;
};

export type OfflineStorageManagerLike = {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<StorageEstimateLike>;
};

export const MIN_OFFLINE_AVAILABLE_BYTES = 32 * 1024 * 1024;
export const MAX_OFFLINE_USAGE_RATIO = 0.95;

function finiteNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function ratio(usage: number | null, quota: number | null): number | null {
  if (usage === null || quota === null || quota <= 0) return null;
  return Math.max(0, Math.min(1, usage / quota));
}

export async function inspectOfflineStorageProtection(input: {
  storage?: OfflineStorageManagerLike | null;
  requestPersistence?: boolean;
  now?: () => Date;
} = {}): Promise<OfflineStorageProtection> {
  const storage = input.storage ?? null;
  const now = input.now ?? (() => new Date());
  const supported = Boolean(
    storage &&
      (typeof storage.persisted === "function" ||
        typeof storage.persist === "function" ||
        typeof storage.estimate === "function"),
  );

  if (!supported || !storage) {
    return {
      checked_at: now().toISOString(),
      status: "unsupported",
      supported: false,
      persisted: false,
      persistence_requested: false,
      quota_bytes: null,
      usage_bytes: null,
      available_bytes: null,
      usage_ratio: null,
    };
  }

  let persisted = false;
  let persistenceRequested = false;
  try {
    persisted =
      typeof storage.persisted === "function"
        ? await storage.persisted()
        : false;
  } catch {
    persisted = false;
  }

  if (
    !persisted &&
    input.requestPersistence === true &&
    typeof storage.persist === "function"
  ) {
    persistenceRequested = true;
    try {
      persisted = await storage.persist();
    } catch {
      persisted = false;
    }
  }

  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;
  if (typeof storage.estimate === "function") {
    try {
      const estimate = await storage.estimate();
      quotaBytes = finiteNonNegative(estimate?.quota);
      usageBytes = finiteNonNegative(estimate?.usage);
    } catch {
      quotaBytes = null;
      usageBytes = null;
    }
  }

  const availableBytes =
    quotaBytes !== null && usageBytes !== null
      ? Math.max(0, quotaBytes - usageBytes)
      : null;
  const usageRatio = ratio(usageBytes, quotaBytes);
  const lowSpace =
    (availableBytes !== null &&
      availableBytes < MIN_OFFLINE_AVAILABLE_BYTES) ||
    (usageRatio !== null && usageRatio >= MAX_OFFLINE_USAGE_RATIO);

  return {
    checked_at: now().toISOString(),
    status: lowSpace
      ? "low_space"
      : persisted
        ? "persistent"
        : "best_effort",
    supported: true,
    persisted,
    persistence_requested: persistenceRequested,
    quota_bytes: quotaBytes,
    usage_bytes: usageBytes,
    available_bytes: availableBytes,
    usage_ratio: usageRatio,
  };
}

export async function getOfflineStorageProtection(options: {
  requestPersistence?: boolean;
} = {}): Promise<OfflineStorageProtection> {
  if (typeof navigator === "undefined") {
    return await inspectOfflineStorageProtection();
  }
  const storage = (navigator as Navigator & {
    storage?: OfflineStorageManagerLike;
  }).storage;
  return await inspectOfflineStorageProtection({
    storage,
    requestPersistence: options.requestPersistence,
  });
}

export function formatOfflineStorageBytes(value: number | null | undefined) {
  const bytes = finiteNonNegative(value);
  if (bytes === null) return null;
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1024) return `${Math.round(megabytes)} Mo`;
  return `${(megabytes / 1024).toFixed(1)} Go`;
}

export function offlineStorageProtectionMessage(
  protection: OfflineStorageProtection | null | undefined,
) {
  if (!protection) return null;
  const available = formatOfflineStorageBytes(protection.available_bytes);
  if (protection.status === "persistent") {
    return available
      ? `Stockage protégé par le navigateur — ${available} disponibles.`
      : "Stockage protégé par le navigateur.";
  }
  if (protection.status === "low_space") {
    return available
      ? `Espace local faible — seulement ${available} disponibles. Libérez de l’espace avant une nouvelle préparation.`
      : "Espace local insuffisant ou presque saturé. Libérez de l’espace avant une nouvelle préparation.";
  }
  if (protection.status === "best_effort") {
    return available
      ? `Stockage disponible (${available}), mais la protection permanente n’a pas été accordée par le navigateur.`
      : "La protection permanente du stockage n’a pas été accordée par le navigateur.";
  }
  return "Ce navigateur ne permet pas de vérifier la protection permanente du stockage local.";
}
