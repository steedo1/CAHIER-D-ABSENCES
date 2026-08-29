"use client";

import { getRelayConfig, getRememberedRelayInstitution } from "@/lib/local-relay";

const CAPABILITY_PREFIX = "moncahier:relay:capability:";
const CAPABILITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type RelayCapabilityPayload = {
  institution_id?: string | null;
  relay_installed?: boolean;
  relay_enabled?: boolean;
};

type CachedRelayCapability = {
  institution_id: string;
  enabled: boolean;
  checked_at: string;
};

let inFlight: Promise<boolean> | null = null;

function browser() {
  return typeof window !== "undefined";
}

function cacheKey(institutionId: string) {
  return `${CAPABILITY_PREFIX}${institutionId}`;
}

function readCachedVerifiedCapability() {
  if (!browser() || !getRelayConfig().token) return false;
  const institutionId = getRememberedRelayInstitution();
  if (!institutionId) return false;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(cacheKey(institutionId)) || "null",
    ) as CachedRelayCapability | null;
    if (!parsed || parsed.institution_id !== institutionId || parsed.enabled !== true) {
      return false;
    }
    const checkedAt = Date.parse(parsed.checked_at);
    if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > CAPABILITY_MAX_AGE_MS) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function rememberVerifiedCapability(payload: RelayCapabilityPayload) {
  if (!browser()) return;
  const institutionId = String(payload.institution_id || "").trim();
  if (!institutionId) return;
  const enabled =
    payload.relay_installed === true &&
    payload.relay_enabled === true &&
    Boolean(getRelayConfig().token);
  window.localStorage.setItem(
    cacheKey(institutionId),
    JSON.stringify({
      institution_id: institutionId,
      enabled,
      checked_at: new Date().toISOString(),
    } satisfies CachedRelayCapability),
  );
}

export async function readAdminRelayCapability(): Promise<boolean> {
  if (!browser() || !getRelayConfig().token) return false;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch("/api/admin/attendance/presence-settings", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return readCachedVerifiedCapability();
      const payload = (await response.json().catch(() => null)) as RelayCapabilityPayload | null;
      if (!payload) return readCachedVerifiedCapability();
      rememberVerifiedCapability(payload);
      return (
        payload.relay_installed === true &&
        payload.relay_enabled === true &&
        Boolean(getRelayConfig().token)
      );
    } catch {
      return readCachedVerifiedCapability();
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
