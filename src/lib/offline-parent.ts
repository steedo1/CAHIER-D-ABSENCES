"use client";

import {
  cacheDeleteByPrefixes,
  offlineGetJson,
} from "@/lib/offline";

export const PARENT_CHILDREN_KEY = "parent:children";
export const PARENT_PERIODS_KEY = "parent:grading-periods";
export const PARENT_BULLETINS_KEY = "parent:bulletins";
export const PARENT_NOTIFICATIONS_KEY = "parent:notifications";

function part(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized ? encodeURIComponent(normalized) : "none";
}

export function parentEventsKey(studentId: string) {
  return `parent:events:${part(studentId)}`;
}

export function parentPenaltiesKey(studentId: string) {
  return `parent:penalties:${part(studentId)}`;
}

export function parentGradesKey(studentId: string) {
  return `parent:grades:${part(studentId)}`;
}

export function parentConductKey(studentId: string, from?: string, to?: string) {
  return `parent:conduct:${part(studentId)}:${part(from)}:${part(to)}`;
}

export function parentTextbookKey(studentId: string) {
  return `parent:textbook:${part(studentId)}`;
}

export async function getParentChildren<T = any>(): Promise<T> {
  return await offlineGetJson<T>("/api/parent/children", PARENT_CHILDREN_KEY);
}

export async function getParentGradePeriods<T = any>(): Promise<T> {
  return await offlineGetJson<T>(
    "/api/parent/grading-periods",
    PARENT_PERIODS_KEY,
  );
}

export async function getParentBulletins<T = any>(): Promise<T> {
  return await offlineGetJson<T>("/api/parent/bulletins", PARENT_BULLETINS_KEY);
}

export async function getParentNotifications<T = any>(): Promise<T> {
  return await offlineGetJson<T>(
    "/api/parent/notifications?limit=80",
    PARENT_NOTIFICATIONS_KEY,
  );
}

export async function getParentEvents<T = any>(studentId: string): Promise<T> {
  return await offlineGetJson<T>(
    `/api/parent/children/events?student_id=${encodeURIComponent(studentId)}&limit=50`,
    parentEventsKey(studentId),
  );
}

export async function getParentPenalties<T = any>(studentId: string): Promise<T> {
  return await offlineGetJson<T>(
    `/api/parent/children/penalties?student_id=${encodeURIComponent(studentId)}&limit=20`,
    parentPenaltiesKey(studentId),
  );
}

export async function getParentGrades<T = any>(studentId: string): Promise<T> {
  const sid = encodeURIComponent(studentId);
  const urls = [
    `/api/parent/children/grades?student_id=${sid}&limit=200`,
    `/api/parents/children/grades?student_id=${sid}&limit=200`,
    `/api/parent/children/grades/published?student_id=${sid}&limit=200`,
  ];
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      return await offlineGetJson<T>(url, parentGradesKey(studentId));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Notes indisponibles.");
}

export async function getParentConduct<T = any>(
  studentId: string,
  from?: string,
  to?: string,
): Promise<T> {
  const params = new URLSearchParams({ student_id: studentId });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return await offlineGetJson<T>(
    `/api/parent/children/conduct?${params.toString()}`,
    parentConductKey(studentId, from, to),
  );
}

export async function getParentTextbook<T = any>(studentId: string): Promise<T> {
  return await offlineGetJson<T>(
    `/api/parent/textbook?student_id=${encodeURIComponent(studentId)}`,
    parentTextbookKey(studentId),
  );
}

export async function clearParentOfflineData() {
  await cacheDeleteByPrefixes(["parent:", "offline:readiness:parent"]);
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = registration?.active || registration?.waiting;
    worker?.postMessage({ type: "MON_CAHIER_PURGE_PARENT" });
  } catch {
    // La déconnexion continue même si le service worker est indisponible.
  }
}
