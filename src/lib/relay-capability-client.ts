"use client";

const RELAY_CAPABILITY_KEY = "mc:relay-capability:v1";

type RelayCapabilityRecord = {
  institution_id: string;
  relay_capable: boolean;
  updated_at: string;
};

type RelayCapabilityStore = {
  last_institution_id: string | null;
  by_institution: Record<string, RelayCapabilityRecord>;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function emptyStore(): RelayCapabilityStore {
  return { last_institution_id: null, by_institution: {} };
}

function readStore(): RelayCapabilityStore {
  if (!canUseStorage()) return emptyStore();
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(RELAY_CAPABILITY_KEY) || "null",
    ) as RelayCapabilityStore | null;
    if (!parsed || typeof parsed !== "object") return emptyStore();
    return {
      last_institution_id:
        typeof parsed.last_institution_id === "string"
          ? parsed.last_institution_id
          : null,
      by_institution:
        parsed.by_institution && typeof parsed.by_institution === "object"
          ? parsed.by_institution
          : {},
    };
  } catch {
    return emptyStore();
  }
}

export function rememberRelayCapability(
  institutionId: string,
  relayCapable: boolean,
) {
  if (!canUseStorage()) return;
  const normalizedId = String(institutionId || "").trim();
  if (!normalizedId) return;

  const store = readStore();
  store.last_institution_id = normalizedId;
  store.by_institution[normalizedId] = {
    institution_id: normalizedId,
    relay_capable: relayCapable === true,
    updated_at: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(RELAY_CAPABILITY_KEY, JSON.stringify(store));
  } catch {
    // Le cache de capacité est seulement une optimisation client.
    // La sécurité réelle reste imposée par les routes serveur du relais.
  }
}

export function readRelayCapability(institutionId?: string | null) {
  const store = readStore();
  const normalizedId = String(institutionId || store.last_institution_id || "").trim();
  if (!normalizedId) return null;
  const record = store.by_institution[normalizedId];
  if (!record || record.institution_id !== normalizedId) return null;
  return record;
}

export function isRelayFallbackAllowed(institutionId?: string | null) {
  return readRelayCapability(institutionId)?.relay_capable === true;
}
