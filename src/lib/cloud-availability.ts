"use client";

import {
  isRelayFallbackAllowed,
  readRelayCapability,
  rememberRelayCapability,
} from "@/lib/relay-capability-client";

export type CloudScheduleStatus = {
  ok: true;
  institution_id: string;
  schedule_revision: number;
  generated_at: string;
  web_release: string;
  relay_capable: boolean;
  cloud_reachable: boolean;
};

const CLOUD_PROBE_TIMEOUT_MS = 3_500;

function cloudOnlyFallbackStatus(): CloudScheduleStatus {
  const cached = readRelayCapability();
  return {
    ok: true,
    institution_id: cached?.institution_id || "cloud-only",
    schedule_revision: 0,
    generated_at: "",
    web_release: "unknown",
    relay_capable: false,
    cloud_reachable: false,
  };
}

export async function probeCloudSchedule(
  timeoutMs = CLOUD_PROBE_TIMEOUT_MS,
): Promise<CloudScheduleStatus | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/offline/schedule-status", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      // Un établissement qui n'est pas explicitement équipé du relais reste
      // en expérience Cloud/PWA. Une panne Cloud ne doit jamais inventer un relais.
      return isRelayFallbackAllowed() ? null : cloudOnlyFallbackStatus();
    }

    const payload = await response.json().catch(() => null);
    const institutionId = String(payload?.institution_id || "").trim();
    const revision = Number(payload?.schedule_revision);
    if (
      payload?.ok !== true ||
      !institutionId ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    ) {
      return isRelayFallbackAllowed() ? null : cloudOnlyFallbackStatus();
    }

    const relayCapable = payload?.relay_capable === true;
    rememberRelayCapability(institutionId, relayCapable);

    return {
      ok: true,
      institution_id: institutionId,
      schedule_revision: revision,
      generated_at: String(payload?.generated_at || ""),
      web_release: String(payload?.web_release || "unknown"),
      relay_capable: relayCapable,
      cloud_reachable: true,
    };
  } catch {
    // Fail closed côté relais : sans capacité relais explicitement mémorisée,
    // on conserve le shell Cloud/PWA au lieu de basculer en "mode hors ligne".
    return isRelayFallbackAllowed() ? null : cloudOnlyFallbackStatus();
  } finally {
    window.clearTimeout(timeout);
  }
}
