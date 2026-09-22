"use client";

// The auth provider sets this before notifying screens. Undefined means that
// initial hydration has not yet resolved the persisted Supabase session.
let sessionActor: string | null | undefined;
let generation = 0;
export function setAttendanceCacheActor(actor: string | null) {
  if (sessionActor !== actor) generation++;
  sessionActor = actor;
}
export function attendanceAuthGeneration() { return generation; }

export async function attendanceCacheActor(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (sessionActor === undefined) {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase-browser");
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    if (data.session?.user.id) return data.session.user.id;
  } else if (sessionActor) return sessionActor;
  const { getOfflineAccessIntent, getOfflineLogoutLock } = await import("@/lib/offline-auth-client");
  if (getOfflineLogoutLock()) return null;
  return (await getOfflineAccessIntent())?.payload.user_id || null;
}

const revisionKey = (institutionId: string) => `mc:official-schedule-revision:v1:${institutionId}`;
export function knownScheduleRevision(institutionId: string): number | null {
  try {
    const raw = window.localStorage.getItem(revisionKey(institutionId));
    const value = raw === null ? NaN : Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch { return null; }
}
export function observeScheduleRevision(institutionId: string, revision: number) {
  if (!institutionId || !Number.isSafeInteger(revision) || revision < 0) return;
  const previous = knownScheduleRevision(institutionId);
  if (previous !== null && previous >= revision) return;
  try { window.localStorage.setItem(revisionKey(institutionId), String(revision)); } catch {}
  window.dispatchEvent(new Event("moncahier:schedule-revision"));
}
