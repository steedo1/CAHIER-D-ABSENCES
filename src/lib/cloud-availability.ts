"use client";

export type CloudScheduleStatus = {
  ok: true;
  institution_id: string;
  schedule_revision: number;
  generated_at: string;
  web_release: string;
};

const CLOUD_PROBE_TIMEOUT_MS = 3_500;

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
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const institutionId = String(payload?.institution_id || "").trim();
    const revision = Number(payload?.schedule_revision);
    if (
      payload?.ok !== true ||
      !institutionId ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    ) {
      return null;
    }
    return {
      ok: true,
      institution_id: institutionId,
      schedule_revision: revision,
      generated_at: String(payload?.generated_at || ""),
      web_release: String(payload?.web_release || "unknown"),
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}
