"use client";
import { attendanceCacheActor, observeScheduleRevision } from "@/lib/attendance-cache-identity";

export type CloudScheduleStatus = {
  ok: true;
  institution_id: string;
  actor_profile_id?: string;
  schedule_revision: number;
  generated_at: string;
  web_release: string;
};

const CLOUD_PROBE_TIMEOUT_MS = 3_500;
const CLOUD_PROBE_SUCCESS_TTL_MS = 45_000;
const CLOUD_PROBE_FAILURE_TTL_MS = 10_000;

let cloudProbeInFlight: Promise<CloudScheduleStatus | null> | null = null;
let lastCloudProbe: { checkedAt: number; value: CloudScheduleStatus | null } | null = null;
let probeActor: string | null = null;

export async function probeCloudSchedule(
  timeoutMs = CLOUD_PROBE_TIMEOUT_MS,
  force = false,
): Promise<CloudScheduleStatus | null> {
  const actor = await attendanceCacheActor();
  if (actor !== probeActor) {
    probeActor = actor;
    cloudProbeInFlight = null;
    lastCloudProbe = null;
  }
  const now = Date.now();
  const cacheTtl = lastCloudProbe?.value
    ? CLOUD_PROBE_SUCCESS_TTL_MS
    : CLOUD_PROBE_FAILURE_TTL_MS;
  if (!force && lastCloudProbe && now - lastCloudProbe.checkedAt < cacheTtl) {
    return lastCloudProbe.value;
  }
  if (cloudProbeInFlight) return cloudProbeInFlight;

  const task = runCloudScheduleProbe(timeoutMs).then(async (value) => {
    if (actor !== await attendanceCacheActor()) return null;
    if (value?.actor_profile_id && value.actor_profile_id !== actor) return null;
    if (value) observeScheduleRevision(value.institution_id, value.schedule_revision);
    lastCloudProbe = { checkedAt: Date.now(), value };
    return value;
  });
  cloudProbeInFlight = task;
  try {
    return await task;
  } finally {
    if (cloudProbeInFlight === task) cloudProbeInFlight = null;
  }
}

async function runCloudScheduleProbe(
  timeoutMs: number,
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
      actor_profile_id: String(payload?.actor_profile_id || ""),
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
