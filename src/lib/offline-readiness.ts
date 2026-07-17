"use client";

import { cacheGet, cacheSet, warmOfflineShell } from "@/lib/offline";

export type OfflineRole = "teacher" | "class-device";

export type OfflineReadiness = {
  version: 1;
  role: OfflineRole;
  prepared_at: string;
  class_count: number;
  student_count: number;
  slot_count: number;
  shell_ready: boolean;
};

type ProgressCallback = (message: string) => void;

type PeriodLike = {
  weekday?: number | null;
  start_time?: string | null;
  end_time?: string | null;
};

type TeacherBootstrap = {
  version?: number;
  slots?: Array<{
    key: string;
    items?: Array<{ class_id?: string | null }>;
  }>;
};

const READINESS_PREFIX = "offline:readiness:";

function readinessKey(role: OfflineRole) {
  return `${READINESS_PREFIX}${role}`;
}

function responseMessage(payload: any, status: number) {
  return String(payload?.message || payload?.error || `HTTP ${status}`);
}

async function fetchFreshJson<T = any>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) throw new Error(responseMessage(payload, response.status));
  return payload as T;
}

async function fetchAndCache<T = any>(url: string, key: string): Promise<T> {
  const payload = await fetchFreshJson<T>(url);
  await cacheSet(key, payload);
  return payload;
}

async function fetchFirstAndCache<T = any>(
  candidates: Array<{ url: string; key: string }>,
  validator?: (payload: T) => boolean
): Promise<T> {
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const payload = await fetchFreshJson<T>(candidate.url);
      if (validator && !validator(payload)) {
        throw new Error("Aucun créneau administratif n’est disponible.");
      }
      await cacheSet(candidate.key, payload);
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Données de l’établissement indisponibles.");
}

async function mapLimit<T>(
  values: T[],
  limit: number,
  callback: (value: T, index: number) => Promise<void>
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      await callback(values[index], index);
    }
  });
  await Promise.all(workers);
}

function slotKey(period: PeriodLike): string | null {
  const rawWeekday = Number(period.weekday);
  const weekday = rawWeekday === 0 ? 7 : rawWeekday;
  const start = String(period.start_time || "").slice(0, 5);
  const end = String(period.end_time || "").slice(0, 5);
  if (!Number.isFinite(weekday) || weekday < 1 || weekday > 7) return null;
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  return `${weekday}|${start}|${end}`;
}

function uniquePeriods(payload: any): Array<{ key: string; period: PeriodLike }> {
  const map = new Map<string, PeriodLike>();
  for (const period of (Array.isArray(payload?.periods) ? payload.periods : []) as PeriodLike[]) {
    const key = slotKey(period);
    if (key) map.set(key, period);
  }
  return Array.from(map, ([key, period]) => ({ key, period }));
}

function uniqueIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

export async function getOfflineReadiness(role: OfflineRole): Promise<OfflineReadiness | null> {
  const value = await cacheGet<OfflineReadiness>(readinessKey(role));
  return value?.version === 1 && value.role === role ? value : null;
}

async function prepareTeacher(onProgress: ProgressCallback): Promise<OfflineReadiness> {
  onProgress("Téléchargement de l’emploi du temps…");
  const bootstrap = await fetchAndCache<TeacherBootstrap>(
    "/api/teacher/offline/bootstrap",
    "teacher:offline:bootstrap"
  );

  const slots = Array.isArray(bootstrap?.slots) ? bootstrap.slots : [];
  for (const slot of slots) {
    if (!slot?.key) continue;
    const items = Array.isArray(slot.items) ? slot.items : [];
    await cacheSet(`teacher:classes:${slot.key}`, {
      items,
      has_active_slot: true,
      scheduled_for_slot: items.length > 0,
    });
  }

  onProgress("Téléchargement des paramètres de l’établissement…");
  await fetchFirstAndCache(
    [{ url: "/api/teacher/institution/basics", key: "teacher:inst:basics" }],
    (payload: any) => Array.isArray(payload?.periods) && payload.periods.length > 0
  );

  // Réglages de conduite : utiles pour les sanctions, mais optionnels si l’établissement
  // utilise encore les valeurs par défaut.
  try {
    await fetchFirstAndCache([
      { url: "/api/teacher/conduct/settings", key: "teacher:conduct:teacher" },
      { url: "/api/institution/conduct/settings", key: "teacher:conduct:institution" },
    ]);
  } catch {
    // Les maxima par défaut du tableau de bord restent utilisables.
  }

  const classIds = uniqueIds(
    slots.flatMap((slot) => (slot.items || []).map((item) => item.class_id || null))
  );
  const studentIds = new Set<string>();

  onProgress(`Téléchargement de ${classIds.length} liste(s) d’élèves…`);
  await mapLimit(classIds, 4, async (classId, index) => {
    onProgress(`Liste d’élèves ${index + 1}/${classIds.length}…`);
    const roster: any = await fetchAndCache(
      `/api/teacher/roster?class_id=${encodeURIComponent(classId)}`,
      `teacher:roster:${classId}`
    );
    for (const student of Array.isArray(roster?.items) ? roster.items : []) {
      const id = String(student?.id || "").trim();
      if (id) studentIds.add(id);
    }
  });

  onProgress("Préparation de l’application…");
  await warmOfflineShell(["/attendance"]);

  return {
    version: 1,
    role: "teacher",
    prepared_at: new Date().toISOString(),
    class_count: classIds.length,
    student_count: studentIds.size,
    slot_count: slots.length,
    shell_ready: true,
  };
}

async function prepareClassDevice(onProgress: ProgressCallback): Promise<OfflineReadiness> {
  onProgress("Téléchargement des classes du cahier…");
  const classPayload: any = await fetchAndCache(
    "/api/class/my-classes",
    "classDevice:my-classes"
  );
  const classes = Array.isArray(classPayload?.items) ? classPayload.items : [];
  const classIds = uniqueIds(classes.map((item: any) => item?.id));

  try {
    await fetchAndCache("/api/teacher/sessions/open", "classDevice:open-session");
  } catch {
    // L'absence d'une séance serveur ouverte ne bloque pas la préparation.
    await cacheSet("classDevice:open-session", { item: null });
  }

  onProgress("Téléchargement des créneaux…");
  const basics: any = await fetchFirstAndCache([
    { url: "/api/teacher/institution/basics", key: "classDevice:inst:basics:teacher" },
    { url: "/api/institution/basics", key: "classDevice:inst:basics:institution" },
  ], (payload: any) => Array.isArray(payload?.periods) && payload.periods.length > 0);
  const periods = uniquePeriods(basics);
  const studentIds = new Set<string>();

  onProgress(`Téléchargement de ${classIds.length} liste(s) d’élèves…`);
  await mapLimit(classIds, 4, async (classId, index) => {
    onProgress(`Classe ${index + 1}/${classIds.length} : élèves et matières…`);
    const roster: any = await fetchAndCache(
      `/api/class/roster?class_id=${encodeURIComponent(classId)}`,
      `classDevice:roster:${classId}`
    );
    for (const student of Array.isArray(roster?.items) ? roster.items : []) {
      const id = String(student?.id || "").trim();
      if (id) studentIds.add(id);
    }

    await fetchAndCache(
      `/api/class/subjects?class_id=${encodeURIComponent(classId)}`,
      `classDevice:subjects:${classId}`
    );
  });

  const resources = classIds.flatMap((classId) =>
    periods.map(({ key }) => ({ classId, key }))
  );
  onProgress(`Préparation de ${resources.length} combinaison(s) classe-créneau…`);
  await mapLimit(resources, 4, async ({ classId, key }, index) => {
    if (index === 0 || (index + 1) % 5 === 0 || index + 1 === resources.length) {
      onProgress(`Créneaux ${index + 1}/${resources.length}…`);
    }
    await fetchAndCache(
      `/api/class/subjects?class_id=${encodeURIComponent(classId)}&slot=${encodeURIComponent(key)}`,
      `classDevice:subjects:${classId}:${key}`
    );
  });

  onProgress("Préparation de l’application…");
  await warmOfflineShell(["/class"]);

  return {
    version: 1,
    role: "class-device",
    prepared_at: new Date().toISOString(),
    class_count: classIds.length,
    student_count: studentIds.size,
    slot_count: periods.length,
    shell_ready: true,
  };
}

export async function prepareOffline(
  role: OfflineRole,
  onProgress: ProgressCallback = () => undefined
): Promise<OfflineReadiness> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("Reconnectez Internet pour actualiser les données hors ligne.");
  }

  const readiness =
    role === "teacher"
      ? await prepareTeacher(onProgress)
      : await prepareClassDevice(onProgress);
  await cacheSet(readinessKey(role), readiness);
  return readiness;
}
