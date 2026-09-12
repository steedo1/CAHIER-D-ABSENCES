"use client";

import { cacheSet, offlineGetJson } from "@/lib/offline";

export const ADMIN_BULLETIN_CLASSES_KEY = "admin:bulletins:classes:v2";
export const ADMIN_BULLETIN_SETTINGS_KEY = "admin:bulletins:settings";

function part(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized ? encodeURIComponent(normalized) : "all";
}

function normalizedParams(value: URLSearchParams | string) {
  const source =
    typeof value === "string" ? new URLSearchParams(value) : value;
  const entries = Array.from(source.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return new URLSearchParams(entries).toString();
}

function normalizeBulletinSubjectName(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function bulletinSubjectDisplayName(value: unknown) {
  const original = String(value || "").trim();
  const normalized = normalizeBulletinSubjectName(original);

  if (
    normalized === "sciences de la vie et de la terre" ||
    normalized === "science de la vie et de la terre" ||
    normalized === "svt"
  ) {
    return "S.V.T.";
  }

  if (
    normalized === "education physique et sportive" ||
    normalized === "education physique et sport" ||
    normalized === "eps"
  ) {
    return "E.P.S.";
  }

  if (
    normalized === "education aux droits de l homme et a la citoyennete" ||
    normalized === "education aux droits de l homme et de la citoyennete" ||
    normalized === "edhc"
  ) {
    return "E.D.H.C.";
  }

  return original;
}

function abbreviateBulletinSubjectNames(payload: any) {
  if (!payload || typeof payload !== "object") return payload;

  const next = { ...payload };

  if (Array.isArray(payload.subjects)) {
    next.subjects = payload.subjects.map((subject: any) => {
      if (!subject || typeof subject !== "object") return subject;
      const subjectName = bulletinSubjectDisplayName(subject.subject_name);
      return subjectName && subjectName !== subject.subject_name
        ? { ...subject, subject_name: subjectName }
        : subject;
    });
  }

  if (Array.isArray(payload.subject_groups)) {
    next.subject_groups = payload.subject_groups.map((group: any) => {
      if (!group || typeof group !== "object" || !Array.isArray(group.items)) {
        return group;
      }
      return {
        ...group,
        items: group.items.map((item: any) => {
          if (!item || typeof item !== "object") return item;
          const subjectName = bulletinSubjectDisplayName(item.subject_name);
          return subjectName && subjectName !== item.subject_name
            ? { ...item, subject_name: subjectName }
            : item;
        }),
      };
    });
  }

  return next;
}

export function adminBulletinPeriodsKey(
  academicYear?: string | null,
  classId?: string | null,
) {
  const base = `admin:bulletins:periods:${part(academicYear)}`;
  return classId ? `${base}:class:${part(classId)}` : base;
}

export function adminBulletinDataKey(params: URLSearchParams | string) {
  return `admin:bulletins:data:${part(normalizedParams(params))}`;
}

export function adminBulletinConductKey(params: URLSearchParams | string) {
  return `admin:bulletins:conduct:${part(normalizedParams(params))}`;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("image_conversion_failed"));
    reader.readAsDataURL(blob);
  });
}

async function inlineImage(value: unknown) {
  const url = String(value || "").trim();
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (typeof navigator !== "undefined" && !navigator.onLine) return url;

  try {
    const response = await fetch(url, {
      credentials: "include",
      cache: "force-cache",
    });
    if (!response.ok) return url;
    return (await blobToDataUrl(await response.blob())) || url;
  } catch {
    return url;
  }
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  callback: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await callback(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function enrichSettingsForOffline(payload: any) {
  if (!payload || typeof payload !== "object") return payload;
  const logo = await inlineImage(payload.institution_logo_url);
  return logo && logo !== payload.institution_logo_url
    ? { ...payload, institution_logo_url: logo }
    : payload;
}

async function enrichBulletinForOffline(payload: any) {
  const displayPayload = abbreviateBulletinSubjectNames(payload);
  if (!displayPayload || !Array.isArray(displayPayload.items)) {
    return displayPayload;
  }
  const items = await mapLimit(displayPayload.items, 4, async (item: any) => {
    const photoSource = item?.student_photo_url || item?.photo_url || "";
    const photo = await inlineImage(photoSource);
    const perSubject = await mapLimit(
      Array.isArray(item?.per_subject) ? item.per_subject : [],
      4,
      async (subject: any) => {
        const signature = await inlineImage(subject?.teacher_signature_png);
        return signature && signature !== subject?.teacher_signature_png
          ? { ...subject, teacher_signature_png: signature }
          : subject;
      },
    );
    return {
      ...item,
      ...(photo
        ? {
            photo_url: photo,
            student_photo_url: photo,
          }
        : {}),
      per_subject: perSubject,
    };
  });
  return { ...displayPayload, items, offline_images_ready: true };
}

export async function getAdminBulletinClasses<T = any>(): Promise<T> {
  return await offlineGetJson<T>(
    "/api/admin/classes",
    ADMIN_BULLETIN_CLASSES_KEY,
  );
}

export async function getAdminBulletinSettings<T = any>(): Promise<T> {
  const payload = await offlineGetJson<any>(
    "/api/admin/institution/settings",
    ADMIN_BULLETIN_SETTINGS_KEY,
  );
  const enriched = await enrichSettingsForOffline(payload);
  await cacheSet(ADMIN_BULLETIN_SETTINGS_KEY, enriched);
  return enriched as T;
}

export async function getAdminBulletinPeriods<T = any>(
  academicYear?: string | null,
  classId?: string | null,
): Promise<T> {
  const params = new URLSearchParams();
  if (academicYear) params.set("academic_year", academicYear);
  if (classId) params.set("class_id", classId);
  const query = params.toString();
  return await offlineGetJson<T>(
    `/api/admin/institution/grading-periods${query ? `?${query}` : ""}`,
    adminBulletinPeriodsKey(academicYear, classId),
  );
}

export async function getAdminBulletin<T = any>(
  params: URLSearchParams,
): Promise<T> {
  const query = normalizedParams(params);
  const key = adminBulletinDataKey(query);
  const payload = await offlineGetJson<any>(
    `/api/admin/grades/bulletin?${query}`,
    key,
  );
  const enriched = await enrichBulletinForOffline(payload);
  await cacheSet(key, enriched);
  return enriched as T;
}

export async function getAdminBulletinConduct<T = any>(
  params: URLSearchParams,
): Promise<T> {
  const query = normalizedParams(params);
  return await offlineGetJson<T>(
    `/api/admin/conduite/averages?${query}`,
    adminBulletinConductKey(query),
  );
}
