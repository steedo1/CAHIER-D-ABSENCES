const RELAY_CAPABILITY_PREFIX = "moncahier:relay-capability:v1:";

export type RelayCapabilityRecord = {
  version: 1;
  institution_id: string;
  relay_enabled: boolean;
  confirmed_at: string;
};

function browser() {
  return typeof window !== "undefined";
}

function capabilityKey(institutionId: string) {
  return `${RELAY_CAPABILITY_PREFIX}${institutionId}`;
}

export function rememberRelayCapability(input: {
  institutionId: string | null | undefined;
  relayEnabled: boolean;
}) {
  if (!browser()) return;
  const institutionId = String(input.institutionId || "").trim();
  if (!institutionId) return;
  const record: RelayCapabilityRecord = {
    version: 1,
    institution_id: institutionId,
    relay_enabled: input.relayEnabled === true,
    confirmed_at: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(capabilityKey(institutionId), JSON.stringify(record));
  } catch {
    // Le mode privé peut refuser localStorage : la décision reste désactivée.
  }
}

export function readRelayCapability(
  institutionId: string | null | undefined,
): RelayCapabilityRecord | null {
  if (!browser()) return null;
  const normalizedInstitutionId = String(institutionId || "").trim();
  if (!normalizedInstitutionId) return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(capabilityKey(normalizedInstitutionId)) || "null",
    ) as RelayCapabilityRecord | null;
    if (
      !parsed ||
      parsed.version !== 1 ||
      parsed.institution_id !== normalizedInstitutionId ||
      typeof parsed.relay_enabled !== "boolean"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Décision centrale et fail-closed côté navigateur. Ni le réseau, ni un port
 * local, ni un jeton résiduel ne peuvent transformer cette valeur en true.
 */
export function relayEnabledForInstitution(
  institutionId: string | null | undefined,
) {
  return readRelayCapability(institutionId)?.relay_enabled === true;
}
