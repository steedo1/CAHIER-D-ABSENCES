"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";

type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

type ImpactSlot = {
  date: string;
  class_id: string;
  class_label: string;
  subject_id: string | null;
  subject_name: string;
  period_id: string;
  period_label: string;
  start_time: string | null;
  end_time: string | null;
  lost_hours: number;
};

type ImpactedClassSummary = {
  class_id: string;
  class_label: string;
  lost_hours: number;
  lost_sessions: number;
  slots: ImpactSlot[];
};

type AbsenceImpactSummary = {
  total_lost_hours: number;
  total_lost_sessions: number;
  impacted_classes: ImpactedClassSummary[];
};

type MakeupPlan = {
  proposed_start_date: string | null;
  proposed_end_date: string | null;
  notes: string;
};

type InstitutionSettings = {
  institution_name?: string | null;
  institution_logo_url?: string | null;
  institution_phone?: string | null;
  institution_email?: string | null;
  institution_region?: string | null;
  institution_postal_address?: string | null;
  institution_status?: string | null;
  institution_head_name?: string | null;
  institution_head_title?: string | null;
};

type ViewerProfile = {
  full_name?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  signature_url?: string | null;
  signature_png?: string | null;
  institution_name?: string | null;
  institution_logo_url?: string | null;
};

type TeacherAbsenceRequestItem = {
  id: string;
  institution_id: string;
  teacher_user_id: string;
  teacher_profile_id: string;
  start_date: string;
  end_date: string;
  reason_code: string;
  reason_label: string;
  details: string;
  requested_days: number;
  signed: boolean;
  source: string;
  status: RequestStatus;
  admin_comment: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  created_at: string;
  updated_at?: string | null;
  lost_hours_total?: number;
  lost_sessions_total?: number;
  impact_summary?: AbsenceImpactSummary | null;
  makeup_plan?: MakeupPlan | null;

  teacher_name?: string | null;
  teacher_signature_url?: string | null;
  teacher_signature_png?: string | null;
  teacher_profile_signature_url?: string | null;

  approved_by_name?: string | null;
  administration_signature_url?: string | null;
  administration_signature_png?: string | null;

  institution_name?: string | null;
  institution_logo_url?: string | null;
};

type ApiListResponse =
  | { ok: true; items: TeacherAbsenceRequestItem[] }
  | { ok: false; error: string };

type ApiCreateResponse =
  | { ok: true; item: TeacherAbsenceRequestItem; message?: string }
  | { ok: false; error: string };

type ImpactResponse =
  | { ok: true; impact: AbsenceImpactSummary }
  | { ok: false; error: string };

function classNames(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}

function formatDate(ymd?: string | null) {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeRange(
  start?: string | null,
  end?: string | null,
  fallback?: string | null
) {
  const s = String(start || "").trim();
  const e = String(end || "").trim();

  if (s && e) return `${s}-${e}`;
  if (s) return s;
  if (e) return e;
  return fallback || "Créneau non défini";
}

function statusLabel(status: RequestStatus) {
  switch (status) {
    case "pending":
      return "En attente";
    case "approved":
      return "Approuvée";
    case "rejected":
      return "Rejetée";
    case "cancelled":
      return "Annulée";
    default:
      return status;
  }
}

function statusClasses(status: RequestStatus) {
  switch (status) {
    case "pending":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "approved":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "rejected":
      return "bg-red-50 text-red-800 ring-red-200";
    case "cancelled":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}

function daysLabel(n: number) {
  return n <= 1 ? "1 jour" : `${n} jours`;
}

function getDeep(obj: any, path: string) {
  if (!obj || !path) return undefined;
  return path.split(".").reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function firstString(obj: any, paths: string[], fallback = "") {
  for (const path of paths) {
    const raw = getDeep(obj, path);
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return fallback;
}

function firstObject<T = any>(obj: any, paths: string[]): T | null {
  for (const path of paths) {
    const raw = getDeep(obj, path);
    if (raw && typeof raw === "object") return raw as T;
  }
  return null;
}

function normalizeInstitutionPayload(payload: any): InstitutionSettings | null {
  if (!payload || typeof payload !== "object") return null;
  const data = firstObject<any>(payload, ["institution", "settings", "data", "item"]) || payload;

  const institution_name = firstString(data, [
    "institution_name",
    "institutionName",
    "name",
    "institution.name",
    "school_name",
    "school.name",
  ]);

  const institution_logo_url = firstString(data, [
    "institution_logo_url",
    "institutionLogoUrl",
    "logo_url",
    "logoUrl",
    "institution.logo_url",
    "institution.logoUrl",
    "school.logo_url",
    "school.logoUrl",
  ]);

  const institution_phone = firstString(data, ["institution_phone", "phone", "phone_number"]);
  const institution_email = firstString(data, ["institution_email", "email"]);
  const institution_region = firstString(data, ["institution_region", "region", "city"]);
  const institution_postal_address = firstString(data, [
    "institution_postal_address",
    "postal_address",
    "address",
  ]);
  const institution_status = firstString(data, ["institution_status", "status"]);
  const institution_head_name = firstString(data, [
    "institution_head_name",
    "institutionHeadName",
    "head_name",
    "headName",
    "principal_name",
    "director_name",
  ]);
  const institution_head_title = firstString(data, [
    "institution_head_title",
    "institutionHeadTitle",
    "head_title",
    "principal_title",
    "director_title",
  ]);

  if (
    !institution_name &&
    !institution_logo_url &&
    !institution_phone &&
    !institution_email &&
    !institution_postal_address &&
    !institution_region
  ) {
    return null;
  }

  return {
    institution_name: institution_name || null,
    institution_logo_url: institution_logo_url || null,
    institution_phone: institution_phone || null,
    institution_email: institution_email || null,
    institution_region: institution_region || null,
    institution_postal_address: institution_postal_address || null,
    institution_status: institution_status || null,
    institution_head_name: institution_head_name || null,
    institution_head_title: institution_head_title || null,
  };
}

function normalizeViewerProfile(payload: any): ViewerProfile | null {
  if (!payload || typeof payload !== "object") return null;
  const data = firstObject<any>(payload, ["profile", "teacher", "user", "data", "item"]) || payload;

  const full_name = firstString(data, [
    "full_name",
    "display_name",
    "name",
    "teacher_name",
    "teacher_display_name",
    "profile.full_name",
    "profile.display_name",
  ]);
  const first_name = firstString(data, ["first_name", "firstname"]);
  const last_name = firstString(data, ["last_name", "lastname"]);
  const display_name = full_name || [first_name, last_name].filter(Boolean).join(" ").trim() || "";

  const signature_url = firstString(data, [
    "signature_url",
    "signature_png",
    "teacher_signature_url",
    "teacher_signature_png",
    "signature",
    "profile.signature_url",
    "profile.signature_png",
  ]);

  const institution_name = firstString(data, [
    "institution_name",
    "institution.name",
    "school.name",
  ]);
  const institution_logo_url = firstString(data, [
    "institution_logo_url",
    "institution.logo_url",
    "school.logo_url",
  ]);

  if (!display_name && !signature_url && !institution_name && !institution_logo_url) {
    return null;
  }

  return {
    full_name: full_name || display_name || null,
    display_name: display_name || null,
    first_name: first_name || null,
    last_name: last_name || null,
    signature_url: signature_url || null,
    signature_png: signature_url || null,
    institution_name: institution_name || null,
    institution_logo_url: institution_logo_url || null,
  };
}

function normalizeImpactSummary(payload: any): AbsenceImpactSummary | null {
  if (!payload || typeof payload !== "object") return null;
  const impact =
    firstObject<any>(payload, ["impact_summary", "impactSummary", "impact", "summary"]) || payload;

  if (!impact || typeof impact !== "object") return null;

  const impacted_classes = Array.isArray(impact.impacted_classes)
    ? impact.impacted_classes
    : Array.isArray(impact.impactedClasses)
      ? impact.impactedClasses
      : [];

  return {
    total_lost_hours: Number(impact.total_lost_hours ?? impact.totalLostHours ?? 0) || 0,
    total_lost_sessions: Number(impact.total_lost_sessions ?? impact.totalLostSessions ?? 0) || 0,
    impacted_classes: impacted_classes.map((cls: any) => ({
      class_id: String(cls.class_id ?? cls.classId ?? ""),
      class_label: String(cls.class_label ?? cls.classLabel ?? "Classe"),
      lost_hours: Number(cls.lost_hours ?? cls.lostHours ?? 0) || 0,
      lost_sessions: Number(cls.lost_sessions ?? cls.lostSessions ?? 0) || 0,
      slots: (Array.isArray(cls.slots) ? cls.slots : []).map((slot: any) => ({
        date: String(slot.date ?? ""),
        class_id: String(slot.class_id ?? slot.classId ?? cls.class_id ?? ""),
        class_label: String(slot.class_label ?? slot.classLabel ?? cls.class_label ?? ""),
        subject_id: slot.subject_id ?? slot.subjectId ?? null,
        subject_name: String(slot.subject_name ?? slot.subjectName ?? "Cours"),
        period_id: String(slot.period_id ?? slot.periodId ?? ""),
        period_label: String(slot.period_label ?? slot.periodLabel ?? ""),
        start_time: slot.start_time ?? slot.startTime ?? null,
        end_time: slot.end_time ?? slot.endTime ?? null,
        lost_hours: Number(slot.lost_hours ?? slot.lostHours ?? 0) || 0,
      })),
    })),
  };
}

function normalizeMakeupPlan(payload: any): MakeupPlan | null {
  if (!payload || typeof payload !== "object") return null;

  return {
    proposed_start_date:
      typeof (payload.proposed_start_date ?? payload.proposedStartDate) === "string"
        ? String(payload.proposed_start_date ?? payload.proposedStartDate)
        : null,
    proposed_end_date:
      typeof (payload.proposed_end_date ?? payload.proposedEndDate) === "string"
        ? String(payload.proposed_end_date ?? payload.proposedEndDate)
        : null,
    notes: String(payload.notes ?? payload.text ?? "").trim(),
  };
}

function formatDurationFromHours(value?: number | string | null) {
  const hours = Number(value ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) return "0 min";

  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function normalizeAbsenceItem(raw: any): TeacherAbsenceRequestItem {
  const impact_summary = normalizeImpactSummary(
    raw?.impact_summary ?? raw?.impactSummary ?? raw?.impact ?? raw?.summary ?? null
  );

  const lost_hours_total = Number(
    raw?.lost_hours_total ??
      raw?.lostHoursTotal ??
      impact_summary?.total_lost_hours ??
      0
  );

  const lost_sessions_total = Number(
    raw?.lost_sessions_total ??
      raw?.lostSessionsTotal ??
      impact_summary?.total_lost_sessions ??
      0
  );

  return {
    ...raw,
    lost_hours_total: Number.isFinite(lost_hours_total) ? lost_hours_total : 0,
    lost_sessions_total: Number.isFinite(lost_sessions_total) ? lost_sessions_total : 0,
    impact_summary,
    makeup_plan: normalizeMakeupPlan(raw?.makeup_plan ?? raw?.makeupPlan),
  };
}

async function fetchImpactSummaryForDates(start_date?: string | null, end_date?: string | null) {
  if (!start_date || !end_date) return null;

  try {
    const qs = new URLSearchParams({ start_date, end_date });
    const res = await fetch(`/api/teacher/absence-requests/impact?${qs.toString()}`, {
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) return null;

    return normalizeImpactSummary(json?.impact ?? json);
  } catch {
    return null;
  }
}

async function hydrateTeacherItems(rawItems: any[]): Promise<TeacherAbsenceRequestItem[]> {
  const baseItems = (Array.isArray(rawItems) ? rawItems : []).map(normalizeAbsenceItem);

  return Promise.all(
    baseItems.map(async (item) => {
      const hasImpact =
        !!item.impact_summary?.impacted_classes?.length ||
        Number(item.lost_hours_total ?? 0) > 0 ||
        Number(item.lost_sessions_total ?? 0) > 0;

      if (hasImpact) return item;

      const fallbackImpact = await fetchImpactSummaryForDates(item.start_date, item.end_date);
      if (!fallbackImpact) return item;

      return {
        ...item,
        impact_summary: fallbackImpact,
        lost_hours_total: fallbackImpact.total_lost_hours,
        lost_sessions_total: fallbackImpact.total_lost_sessions,
      };
    })
  );
}

const REASON_OPTIONS = [
  { value: "maladie", label: "Maladie" },
  { value: "formation", label: "Formation" },
  { value: "mission", label: "Mission / déplacement" },
  { value: "evenement_familial", label: "Événement familial" },
  { value: "contrainte_personnelle", label: "Contrainte personnelle" },
  { value: "autre", label: "Autre" },
];

const SIGNATURE_BLUE = "#1d4ed8";
const ABSENCE_PREVIEW_ZOOM = 0.86;

const __SIG_INK_CACHE = new Map<string, string>();
const __SIG_INK_PROMISES = new Map<string, Promise<string | null>>();
const __SIG_TINT_CACHE = new Map<string, string>();
const __SIG_TINT_PROMISES = new Map<string, Promise<string | null>>();

function resolveTeacherDisplayName(
  item: TeacherAbsenceRequestItem,
  viewerProfile: ViewerProfile | null
) {
  return (
    String(item.teacher_name ?? "").trim() ||
    String(viewerProfile?.display_name ?? "").trim() ||
    String(viewerProfile?.full_name ?? "").trim() ||
    "Enseignant"
  );
}

function resolveTeacherSignatureSrc(
  item: TeacherAbsenceRequestItem,
  viewerProfile: ViewerProfile | null
) {
  return (
    String(item.teacher_signature_png ?? "").trim() ||
    String(item.teacher_signature_url ?? "").trim() ||
    String(item.teacher_profile_signature_url ?? "").trim() ||
    String(viewerProfile?.signature_png ?? "").trim() ||
    String(viewerProfile?.signature_url ?? "").trim() ||
    ""
  );
}

function initialsFromName(value?: string | null) {
  const parts = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const letters = parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return letters || "EN";
}

function buildPrintMeta(
  item: TeacherAbsenceRequestItem,
  institution: InstitutionSettings | null,
  viewerProfile: ViewerProfile | null
) {
  const itemInstitution = firstObject<any>(item, ["institution", "school", "settings"]);
  const itemTeacher = firstObject<any>(item, [
    "teacher",
    "teacher_profile",
    "teacherProfile",
    "profile",
    "requester",
    "employee",
  ]);
  const itemApprover = firstObject<any>(item, ["approved_by_user", "approver", "approvedBy", "administrator"]);

  const instName =
    firstString(item, [
      "institution_name",
      "institution.name",
      "school.name",
      "settings.institution_name",
    ]) ||
    firstString(itemInstitution, ["institution_name", "name", "school_name"]) ||
    viewerProfile?.institution_name?.trim() ||
    institution?.institution_name?.trim() ||
    "Établissement";

  const instLogo =
    firstString(item, [
      "institution_logo_url",
      "institution.logo_url",
      "institution.logoUrl",
      "school.logo_url",
      "school.logoUrl",
      "settings.institution_logo_url",
    ]) ||
    firstString(itemInstitution, ["institution_logo_url", "logo_url", "logoUrl"]) ||
    viewerProfile?.institution_logo_url?.trim() ||
    institution?.institution_logo_url?.trim() ||
    "";

  const instPhone =
    firstString(itemInstitution, ["institution_phone", "phone"]) ||
    institution?.institution_phone?.trim() ||
    "";
  const instEmail =
    firstString(itemInstitution, ["institution_email", "email"]) ||
    institution?.institution_email?.trim() ||
    "";
  const instAddress =
    firstString(itemInstitution, ["institution_postal_address", "postal_address", "address"]) ||
    institution?.institution_postal_address?.trim() ||
    "";
  const instRegion =
    firstString(itemInstitution, ["institution_region", "region", "city"]) ||
    institution?.institution_region?.trim() ||
    "";
  const instStatus =
    firstString(itemInstitution, ["institution_status", "status"]) ||
    institution?.institution_status?.trim() ||
    "";

  const teacherName =
    firstString(item, [
      "teacher_name",
      "teacherName",
      "teacher_display_name",
      "teacherDisplayName",
      "teacher_full_name",
      "teacherFullName",
      "teacher.full_name",
      "teacher.display_name",
      "teacher.name",
      "teacher_profile.full_name",
      "teacher_profile.display_name",
      "teacher_profile.name",
      "teacherProfile.full_name",
      "teacherProfile.display_name",
      "teacherProfile.name",
      "profile.full_name",
      "profile.display_name",
      "requester.full_name",
      "requester.display_name",
      "employee.full_name",
      "employee.display_name",
    ]) ||
    firstString(itemTeacher, ["full_name", "display_name", "name"]) ||
    viewerProfile?.display_name?.trim() ||
    viewerProfile?.full_name?.trim() ||
    "Enseignant concerné";

  const teacherSignature =
    firstString(item, [
      "teacher_signature_png",
      "teacher_signature_url",
      "teacher_profile_signature_url",
      "teacher.signature_png",
      "teacher.signature_url",
      "teacher_profile.signature_png",
      "teacher_profile.signature_url",
      "teacherProfile.signature_png",
      "teacherProfile.signature_url",
      "profile.signature_png",
      "profile.signature_url",
    ]) ||
    firstString(itemTeacher, ["signature_png", "signature_url", "signature"]) ||
    viewerProfile?.signature_png?.trim() ||
    viewerProfile?.signature_url?.trim() ||
    "";

  const adminName =
    firstString(item, [
      "approved_by_name",
      "approvedByName",
      "approved_by_display_name",
      "approvedBy.display_name",
      "approvedBy.full_name",
      "approver.full_name",
      "approver.display_name",
      "administrator.full_name",
      "administrator.display_name",
    ]) ||
    firstString(itemApprover, ["full_name", "display_name", "name"]) ||
    institution?.institution_head_name?.trim() ||
    "Administration";

  const adminTitle =
    institution?.institution_head_title?.trim() ||
    firstString(itemApprover, ["title", "role", "job_title"]) ||
    "Administration";

  const adminSignature =
    firstString(item, [
      "administration_signature_png",
      "administration_signature_url",
      "approved_by_signature_png",
      "approved_by_signature_url",
      "approver.signature_png",
      "approver.signature_url",
      "administrator.signature_png",
      "administrator.signature_url",
    ]) ||
    firstString(itemApprover, ["signature_png", "signature_url", "signature"]) ||
    "";

  return {
    instName,
    instLogo,
    instPhone,
    instEmail,
    instAddress,
    instRegion,
    instStatus,
    teacherName,
    teacherSignature,
    adminName,
    adminTitle,
    adminSignature,
  };
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("IMG_LOAD_FAILED"));
    img.src = src;
  });
}

async function tryFetchAsDataUrl(src: string): Promise<string> {
  if (!src) return src;
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;

  try {
    const res = await fetch(src, { mode: "cors", cache: "force-cache" });
    if (!res.ok) return src;
    const blob = await res.blob();

    const dataUrl: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("FILE_READER_FAILED"));
      fr.readAsDataURL(blob);
    });

    return dataUrl || src;
  } catch {
    return src;
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = (hex || "").trim().replace("#", "");
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r, g, b };
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r, g, b };
  }
  return null;
}

async function inkifySignaturePng(src: string): Promise<string | null> {
  if (!src) return null;

  const cached = __SIG_INK_CACHE.get(src);
  if (cached) return cached;

  const pending = __SIG_INK_PROMISES.get(src);
  if (pending) return pending;

  const job = (async () => {
    try {
      if (typeof window === "undefined") return src;

      const safeSrc = await tryFetchAsDataUrl(src);
      const img = await loadHtmlImage(safeSrc);

      const w = img.naturalWidth || (img as any).width || 0;
      const h = img.naturalHeight || (img as any).height || 0;
      if (!w || !h) return src;

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return src;

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0);

      const imgData = ctx.getImageData(0, 0, w, h);
      const d = imgData.data;

      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const a = d[i + 3];

        if (a < 8) {
          d[i + 3] = 0;
          continue;
        }

        if (r > 240 && g > 240 && b > 240) {
          d[i + 3] = 0;
          continue;
        }

        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        let boostedA = (255 - lum) * 3.4;
        if (!Number.isFinite(boostedA)) boostedA = a;

        const newA = Math.min(255, Math.max(170, Math.max(a, Math.round(boostedA))));

        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = newA;
      }

      const orig = new Uint8ClampedArray(d);
      const W = w;

      for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          const idx = (y * W + x) * 4;
          const a = orig[idx + 3];
          if (a === 0) continue;

          const spread = Math.min(255, Math.round(a * 0.7));

          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (dx === 0 && dy === 0) continue;
              const j = ((y + dy) * W + (x + dx)) * 4;
              if (d[j + 3] < spread) {
                d[j] = 0;
                d[j + 1] = 0;
                d[j + 2] = 0;
                d[j + 3] = spread;
              }
            }
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
      const out = canvas.toDataURL("image/png");
      if (out) __SIG_INK_CACHE.set(src, out);
      return out || src;
    } catch (e) {
      console.warn("[Autorisations] inkifySignaturePng fallback", e);
      return src;
    } finally {
      __SIG_INK_PROMISES.delete(src);
    }
  })();

  __SIG_INK_PROMISES.set(src, job);
  return job;
}

async function tintSignaturePng(src: string, hexColor: string): Promise<string | null> {
  if (!src) return null;

  const rgb = hexToRgb(hexColor) || hexToRgb(SIGNATURE_BLUE);
  if (!rgb) return src;

  const cacheKey = `${hexColor}|${src}`;
  const cached = __SIG_TINT_CACHE.get(cacheKey);
  if (cached) return cached;

  const pending = __SIG_TINT_PROMISES.get(cacheKey);
  if (pending) return pending;

  const job = (async () => {
    try {
      if (typeof window === "undefined") return src;

      const safeSrc = await tryFetchAsDataUrl(src);
      const img = await loadHtmlImage(safeSrc);

      const w = img.naturalWidth || (img as any).width || 0;
      const h = img.naturalHeight || (img as any).height || 0;
      if (!w || !h) return src;

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return src;

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0);

      const imgData = ctx.getImageData(0, 0, w, h);
      const d = imgData.data;

      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a === 0) continue;
        d[i] = rgb.r;
        d[i + 1] = rgb.g;
        d[i + 2] = rgb.b;
      }

      ctx.putImageData(imgData, 0, 0);
      const out = canvas.toDataURL("image/png");
      if (out) __SIG_TINT_CACHE.set(cacheKey, out);
      return out || src;
    } catch (e) {
      console.warn("[Autorisations] tintSignaturePng fallback", e);
      return src;
    } finally {
      __SIG_TINT_PROMISES.delete(cacheKey);
    }
  })();

  __SIG_TINT_PROMISES.set(cacheKey, job);
  return job;
}

function SignatureInk({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [displaySrc, setDisplaySrc] = useState<string>(src);

  useEffect(() => {
    let cancelled = false;
    setDisplaySrc(src);

    (async () => {
      const inked = await inkifySignaturePng(src);
      const tinted = inked ? await tintSignaturePng(inked, SIGNATURE_BLUE) : null;
      const out = tinted || inked || src;
      if (!cancelled && out) setDisplaySrc(out);
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={displaySrc || src} alt={alt} className={classNames("sig-img", className)} />;
}

function SafeImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [displaySrc, setDisplaySrc] = useState<string>(src);

  useEffect(() => {
    let cancelled = false;
    setDisplaySrc(src);

    (async () => {
      const safeSrc = await tryFetchAsDataUrl(src);
      if (!cancelled && safeSrc) setDisplaySrc(safeSrc);
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={displaySrc || src} alt={alt} className={className} />;
}

function ApprovedRequestPrintSheet({
  item,
  institution,
  viewerProfile,
  previewZoomForMeasure,
}: {
  item: TeacherAbsenceRequestItem;
  institution: InstitutionSettings | null;
  viewerProfile: ViewerProfile | null;
  previewZoomForMeasure: number;
}) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [printFitScale, setPrintFitScale] = useState(1);

  const {
    instName,
    instLogo,
    instPhone,
    instEmail,
    instAddress,
    instRegion,
    instStatus,
    teacherName,
    teacherSignature,
    adminName,
    adminTitle,
    adminSignature,
  } = useMemo(() => buildPrintMeta(item, institution, viewerProfile), [item, institution, viewerProfile]);

  const setScale = (s: number) => {
    const v = Number.isFinite(s) ? s : 1;
    setPrintFitScale(v);
    if (pageRef.current) {
      pageRef.current.style.setProperty("--print-fit-scale", String(v));
    }
  };

  const computePrintFit = () => {
    const el = pageRef.current;
    if (!el || typeof window === "undefined") return;

    const zoom = Math.max(0.1, Number(previewZoomForMeasure || 1));
    const rect = el.getBoundingClientRect();
    const naturalH = rect.height / zoom;
    const cs = window.getComputedStyle(el);
    const minHPx = parseFloat(cs.minHeight || "0");

    if (!Number.isFinite(naturalH) || naturalH <= 0) return;
    if (!Number.isFinite(minHPx) || minHPx <= 0) {
      setScale(1);
      return;
    }

    if (naturalH <= minHPx + 0.5) {
      setScale(1);
      return;
    }

    const cushion = Math.max(10, Math.round(minHPx * 0.012));
    const usable = Math.max(1, minHPx - cushion);
    const raw = Math.min(1, usable / naturalH);
    const safe = Math.min(1, raw * 0.99);
    const clamped = Math.max(0.45, safe);
    setScale(clamped);
  };

  useLayoutEffect(() => {
    computePrintFit();

    const t1 = window.setTimeout(computePrintFit, 120);
    const t2 = window.setTimeout(computePrintFit, 550);
    const t3 = window.setTimeout(computePrintFit, 1200);

    const onResize = () => computePrintFit();
    const onBeforePrint = () => computePrintFit();

    window.addEventListener("resize", onResize);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("absence-print:recalc-fit" as any, onBeforePrint as any);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && pageRef.current) {
      ro = new ResizeObserver(() => computePrintFit());
      ro.observe(pageRef.current);
    }

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("absence-print:recalc-fit" as any, onBeforePrint as any);
      if (ro) ro.disconnect();
    };
  }, [item.id, previewZoomForMeasure, teacherSignature, adminSignature]);

  const metaLine = [instRegion, instAddress, instPhone, instEmail, instStatus].filter(Boolean).join(" • ");

  return (
    <div className="absence-print-sheet-wrap">
      <div ref={pageRef} className="absence-print-page" style={{ ["--print-fit-scale" as any]: printFitScale }}>
        <div className="absence-print-topbar" />

        <div className="absence-print-header">
          <div className="absence-logo-box">
            {instLogo ? (
              <SafeImage src={instLogo} alt="Logo établissement" className="absence-logo-img" />
            ) : (
              <div className="absence-logo-fallback">Logo<br />établissement</div>
            )}
          </div>

          <div className="min-w-0">
            <div className="absence-doc-kicker">Document administratif</div>
            <div className="absence-inst-name">{instName}</div>
            <div className="absence-inst-meta">{metaLine || "Établissement scolaire"}</div>
          </div>
        </div>

        <div className="absence-approved-banner">
          <div className="absence-approved-big">AUTORISATION D’ABSENCE VALIDÉE</div>
          <div className="absence-approved-small">
            Validation administrative enregistrée le {formatDateTime(item.approved_at)}
          </div>
        </div>

        <div className="absence-doc-title">Fiche d’autorisation d’absence</div>

        <div className="absence-grid">
          <div className="absence-card">
            <div className="absence-label">Enseignant</div>
            <div className="absence-value">{teacherName}</div>
          </div>

          <div className="absence-card">
            <div className="absence-label">Durée</div>
            <div className="absence-value">{daysLabel(item.requested_days)}</div>
          </div>

          <div className="absence-card">
            <div className="absence-label">Période</div>
            <div className="absence-value">{formatDate(item.start_date)} au {formatDate(item.end_date)}</div>
          </div>

          <div className="absence-card">
            <div className="absence-label">Motif</div>
            <div className="absence-value">{item.reason_label}</div>
          </div>

          <div className="absence-card absence-card-full">
            <div className="absence-label">Détails fournis par l’enseignant</div>
            <div className="absence-value absence-value-normal whitespace-pre-line">{item.details || "—"}</div>
          </div>

          <div className="absence-card absence-card-full">
            <div className="absence-label">Plan de rattrapage</div>
            <div className="absence-value absence-value-normal whitespace-pre-line">{item.makeup_plan?.notes || "—"}</div>
          </div>

          {item.admin_comment ? (
            <div className="absence-card absence-card-full">
              <div className="absence-label">Commentaire de l’administration</div>
              <div className="absence-value absence-value-normal whitespace-pre-line">{item.admin_comment}</div>
            </div>
          ) : null}
        </div>

        <div className="absence-impact-section">
          <div className="absence-impact-title">Classes impactées et heures à rattraper</div>

          {item.impact_summary?.impacted_classes?.length ? (
            <div className="space-y-2.5">
              {item.impact_summary.impacted_classes.map((cls) => (
                <div key={cls.class_id} className="absence-impact-card">
                  <div className="absence-impact-head">
                    <strong>{cls.class_label}</strong>
                    <span>{formatDurationFromHours(cls.lost_hours)} • {cls.lost_sessions} créneau(x)</span>
                  </div>

                  {cls.slots?.length ? (
                    <div className="absence-impact-slots">
                      {cls.slots.map((slot, index) => (
                        <div key={`${cls.class_id}_${slot.date}_${slot.period_id}_${index}`} className="absence-impact-slot">
                          {formatDate(slot.date)} • {slot.subject_name} • {formatTimeRange(slot.start_time, slot.end_time, slot.period_label)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="absence-empty-box">Aucune classe impactée indiquée.</div>
          )}
        </div>

        <div className="absence-signature-grid">
          <div className="absence-signature-card">
            <div className="absence-signature-head">Signature de l’enseignant</div>
            <div className="absence-signature-role">Nom de l’enseignant</div>
            <div className="absence-signature-name">{teacherName}</div>
            <div className="absence-signature-box">
              {teacherSignature ? (
                <SignatureInk src={teacherSignature} alt="Signature enseignant" className="absence-signature-img" />
              ) : (
                <div className="absence-signature-placeholder">Signature électronique non disponible</div>
              )}
            </div>
          </div>

          <div className="absence-signature-card absence-signature-card-admin">
            <div className="absence-signature-head">Visa de l’administration</div>
            <div className="absence-approval-stamp">DEMANDE APPROUVÉE</div>
            <div className="absence-signature-role">{adminTitle}</div>
            <div className="absence-signature-name">{adminName}</div>
            <div className="absence-signature-box absence-signature-box-admin">
              {adminSignature ? (
                <SignatureInk src={adminSignature} alt="Signature administration" className="absence-signature-img" />
              ) : (
                <div className="absence-signature-placeholder">Signature et cachet de l’administration</div>
              )}
            </div>
          </div>
        </div>

        <div className="absence-foot">
          <div><strong>Statut :</strong> Demande approuvée</div>
          <div><strong>Document généré le :</strong> {formatDateTime(new Date().toISOString())}</div>
        </div>
      </div>
    </div>
  );
}

export default function EnseignantAutorisationAbsencePage() {
  const [items, setItems] = useState<TeacherAbsenceRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactPreview, setImpactPreview] = useState<AbsenceImpactSummary | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [institution, setInstitution] = useState<InstitutionSettings | null>(null);
  const [institutionLoading, setInstitutionLoading] = useState(false);
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile | null>(null);
  const [previewZoom, setPreviewZoom] = useState<number>(ABSENCE_PREVIEW_ZOOM);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [printPreviewItem, setPrintPreviewItem] = useState<TeacherAbsenceRequestItem | null>(null);

  const [form, setForm] = useState({
    start_date: "",
    end_date: "",
    reason_code: "maladie",
    details: "",
    signed: true,
    makeup_notes: "",
  });

  async function load() {
    try {
      setError(null);
      setRefreshing(true);

      const res = await fetch("/api/teacher/absence-requests", {
        method: "GET",
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as ApiListResponse | null;

      if (!res.ok || !json?.ok) {
        throw new Error(
          (json && "error" in json && json.error) ||
            "Impossible de charger vos demandes d’absence."
        );
      }

      const hydrated = await hydrateTeacherItems(Array.isArray(json.items) ? json.items : []);
      setItems(hydrated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadImpact() {
      if (!form.start_date || !form.end_date) {
        setImpactPreview(null);
        return;
      }

      try {
        setImpactLoading(true);

        const qs = new URLSearchParams({
          start_date: form.start_date,
          end_date: form.end_date,
        });

        const res = await fetch(
          `/api/teacher/absence-requests/impact?${qs.toString()}`,
          { cache: "no-store" }
        );

        const json = (await res.json().catch(() => null)) as ImpactResponse | null;
        const normalizedImpact = json && json.ok
          ? normalizeImpactSummary(json.impact ?? json)
          : null;

        if (!res.ok || !json || !json.ok || !normalizedImpact) {
          if (!cancelled) setImpactPreview(null);
          return;
        }

        if (!cancelled) {
          setImpactPreview(normalizedImpact);
        }
      } finally {
        if (!cancelled) setImpactLoading(false);
      }
    }

    void loadImpact();

    return () => {
      cancelled = true;
    };
  }, [form.start_date, form.end_date]);

  async function fetchFirstWorkingJson(urls: string[]) {
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: "GET", cache: "no-store" });
        if (!res.ok) continue;
        const json = await res.json().catch(() => null);
        if (json) return json;
      } catch {
        // ignore
      }
    }
    return null;
  }

  async function loadInstitutionData() {
    const payload = await fetchFirstWorkingJson([
      "/api/teacher/institution/settings",
      "/api/admin/institution/settings",
      "/api/institution/settings",
      "/api/settings/institution",
    ]);
    return normalizeInstitutionPayload(payload);
  }

  async function loadViewerProfileData() {
    const payload = await fetchFirstWorkingJson([
      "/api/teacher/profile",
      "/api/teacher/me",
      "/api/profile/me",
      "/api/me",
    ]);
    return normalizeViewerProfile(payload);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInstitution() {
      try {
        setInstitutionLoading(true);
        const nextInstitution = await loadInstitutionData();
        if (!cancelled && nextInstitution) {
          setInstitution(nextInstitution);
        }
      } finally {
        if (!cancelled) setInstitutionLoading(false);
      }
    }

    async function loadViewer() {
      const nextViewer = await loadViewerProfileData();
      if (!cancelled && nextViewer) {
        setViewerProfile(nextViewer);
      }
    }

    void Promise.all([loadInstitution(), loadViewer()]);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const computePreviewZoom = () => {
      if (typeof window === "undefined") return ABSENCE_PREVIEW_ZOOM;
      const A4_PX = (202 / 25.4) * 96;
      const vw = window.innerWidth || 0;
      const padding = vw < 768 ? 20 : 88;
      const avail = Math.max(250, vw - padding);
      const z = Math.min(1, avail / A4_PX);
      return Math.max(0.34, Number.isFinite(z) ? z : ABSENCE_PREVIEW_ZOOM);
    };

    const apply = () => setPreviewZoom(computePreviewZoom());
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const open = !!printPreviewItem;
    document.body.classList.toggle("absence-print-open", open);
    if (open) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.classList.remove("absence-print-open");
        document.body.style.overflow = previousOverflow;
      };
    }

    return () => {
      document.body.classList.remove("absence-print-open");
    };
  }, [printPreviewItem]);

  const counts = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.status] += 1;
        return acc;
      },
      {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        cancelled: 0,
      }
    );
  }, [items]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!form.start_date || !form.end_date) {
      setError("Veuillez renseigner la date de début et la date de fin.");
      setSuccess(null);
      return;
    }

    if (!form.details.trim()) {
      setError("Veuillez préciser le motif de votre demande.");
      setSuccess(null);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setSuccess(null);

      const selectedReason =
        REASON_OPTIONS.find((option) => option.value === form.reason_code)?.label ?? form.reason_code;

      const res = await fetch("/api/teacher/absence-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start_date: form.start_date,
          end_date: form.end_date,
          reason_code: form.reason_code,
          reason_label: selectedReason,
          details: form.details.trim(),
          signed: form.signed,
          source: "teacher_portal",
          makeup_plan: {
            proposed_start_date: null,
            proposed_end_date: null,
            notes: form.makeup_notes.trim(),
          },
        }),
      });

      const json = (await res.json().catch(() => null)) as ApiCreateResponse | null;

      if (!res.ok || !json?.ok) {
        throw new Error(
          (json && "error" in json && json.error) ||
            "La demande n’a pas pu être enregistrée."
        );
      }

      setForm({
        start_date: "",
        end_date: "",
        reason_code: "maladie",
        details: "",
        signed: true,
        makeup_notes: "",
      });
      setImpactPreview(null);

      setSuccess("Votre demande d’autorisation d’absence a bien été soumise.");
      setHistoryOpen(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l’envoi.");
      setSuccess(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePrintApprovedRequest(item: TeacherAbsenceRequestItem) {
    if (item.status !== "approved") return;

    setError(null);
    setSuccess(null);
    setPrintingId(item.id);

    try {
      let nextItem: TeacherAbsenceRequestItem = normalizeAbsenceItem(item);

      if (!nextItem.impact_summary?.impacted_classes?.length && nextItem.start_date && nextItem.end_date) {
        const fallbackImpact = await fetchImpactSummaryForDates(nextItem.start_date, nextItem.end_date);
        if (fallbackImpact) {
          nextItem = {
            ...nextItem,
            impact_summary: fallbackImpact,
            lost_hours_total: fallbackImpact.total_lost_hours,
            lost_sessions_total: fallbackImpact.total_lost_sessions,
          };
        }
      }

      if (!institution) {
        const nextInstitution = await loadInstitutionData();
        if (nextInstitution) setInstitution(nextInstitution);
      }

      if (!viewerProfile) {
        const nextViewer = await loadViewerProfileData();
        if (nextViewer) setViewerProfile(nextViewer);
      }

      setPrintPreviewItem(nextItem);
    } finally {
      setPrintingId(null);
    }
  }

  function handleClosePrintPreview() {
    setPrintPreviewItem(null);
  }

  function handleConfirmPrint() {
    if (!printPreviewItem || typeof window === "undefined") return;
    window.dispatchEvent(new Event("absence-print:recalc-fit"));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }

  return (
    <>
      <main className="space-y-6">
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-sm sm:p-6">
          <div
            className="pointer-events-none absolute inset-0 opacity-20"
            style={{
              background:
                "radial-gradient(500px 200px at 10% -10%, rgba(255,255,255,0.45), transparent 60%), radial-gradient(320px 140px at 90% 120%, rgba(255,255,255,0.22), transparent 60%)",
            }}
          />
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/10">
                <ShieldCheck className="h-3.5 w-3.5" />
                Espace enseignant
              </div>
              <h1 className="mt-3 text-2xl font-extrabold tracking-tight">
                Autorisation d’absence
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/85">
                Soumettez une demande d’absence, visualisez les classes impactées,
                puis indiquez quand vous comptez rattraper les heures perdues.
              </p>
              {institutionLoading ? (
                <div className="mt-2 text-xs font-semibold text-white/70">
                  Chargement des informations de l’établissement…
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <RefreshCw className={classNames("h-4 w-4", refreshing && "animate-spin")} />
              Actualiser
            </button>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</div>
            <div className="mt-2 text-3xl font-extrabold text-slate-950">{counts.total}</div>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">En attente</div>
            <div className="mt-2 text-3xl font-extrabold text-amber-900">{counts.pending}</div>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Approuvées</div>
            <div className="mt-2 text-3xl font-extrabold text-emerald-900">{counts.approved}</div>
          </div>

          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-red-700">Rejetées</div>
            <div className="mt-2 text-3xl font-extrabold text-red-900">{counts.rejected}</div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
              <FileText className="h-4 w-4 text-emerald-600" />
              Nouvelle demande
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-800">Date de début</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-800">Date de fin</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
                />
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-bold text-slate-900">Impact prévisionnel de l’absence</div>

              {impactLoading ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Calcul des heures perdues...
                </div>
              ) : !form.start_date || !form.end_date ? (
                <p className="mt-2 text-sm text-slate-500">
                  Sélectionnez la plage d’absence pour voir les classes impactées.
                </p>
              ) : !impactPreview || impactPreview.impacted_classes.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  Aucun cours impacté trouvé sur cette période.
                </p>
              ) : (
                <>
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Vous perdrez des heures dans les classes suivantes : <strong>{formatDurationFromHours(impactPreview.total_lost_hours)}</strong> sur <strong>{impactPreview.total_lost_sessions}</strong> créneau(x).
                  </div>

                  <div className="mt-3 space-y-3">
                    {impactPreview.impacted_classes.map((cls) => (
                      <div key={cls.class_id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold text-slate-900">{cls.class_label}</div>
                          <div className="text-sm text-slate-600">{formatDurationFromHours(cls.lost_hours)} perdues • {cls.lost_sessions} créneau(x)</div>
                        </div>

                        <div className="mt-2 space-y-2 text-sm text-slate-600">
                          {cls.slots.map((slot, index) => (
                            <div
                              key={`${cls.class_id}_${slot.date}_${slot.period_id}_${index}`}
                              className="rounded-xl bg-slate-50 px-3 py-2"
                            >
                              {formatDate(slot.date)} • {slot.subject_name} • {formatTimeRange(slot.start_time, slot.end_time, slot.period_label)}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-slate-800">Motif</label>
              <select
                value={form.reason_code}
                onChange={(e) => setForm((prev) => ({ ...prev, reason_code: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
              >
                {REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-slate-800">Détails</label>
              <textarea
                rows={5}
                value={form.details}
                onChange={(e) => setForm((prev) => ({ ...prev, details: e.target.value }))}
                placeholder="Expliquez brièvement le motif de la demande..."
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-bold text-emerald-900">Quand comptez-vous rattraper ces heures ?</div>

              <div className="mt-4">
                <label className="mb-2 block text-sm font-semibold text-slate-800">
                  Jours, heures et classes de rattrapage
                </label>
                <textarea
                  rows={5}
                  value={form.makeup_notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, makeup_notes: e.target.value }))}
                  placeholder="Ex. 6e1 : mardi 28/04 de 07:10 à 08:05 ; 6e2 : jeudi 30/04 de 10:15 à 11:10 ; 5e3 : vendredi 01/05 de 08:05 à 09:00."
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
                />
              </div>
            </div>

            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <input
                type="checkbox"
                checked={form.signed}
                onChange={(e) => setForm((prev) => ({ ...prev, signed: e.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-500"
              />
              <span className="text-sm text-slate-700">
                J’atteste cette demande et j’autorise l’utilisation de ma signature électronique si elle est enregistrée.
              </span>
            </label>

            <div className="mt-5">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Soumettre la demande
              </button>
            </div>
          </form>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                <CalendarDays className="h-4 w-4 text-emerald-600" />
                Historique
              </div>

              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                aria-expanded={historyOpen}
              >
                {historyOpen ? (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Masquer
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-4 w-4" />
                    Déplier
                  </>
                )}
              </button>
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                {error}
              </div>
            ) : null}

            {success ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {success}
              </div>
            ) : null}

            {historyOpen ? (
              <div className="mt-4 space-y-4">
                {loading ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-10">
                    <div className="flex items-center justify-center gap-3 text-slate-600">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Chargement des demandes...
                    </div>
                  </div>
                ) : items.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-10 text-center">
                    <FileText className="mx-auto h-10 w-10 text-slate-300" />
                    <div className="mt-3 text-lg font-bold text-slate-900">Aucune demande pour le moment</div>
                    <p className="mt-1 text-sm text-slate-500">Vos prochaines demandes apparaîtront ici.</p>
                  </div>
                ) : (
                  items.map((item) => {
                    const teacherDisplayName = resolveTeacherDisplayName(item, viewerProfile);
                    const teacherSignatureSrc = resolveTeacherSignatureSrc(item, viewerProfile);
                    const teacherInitials = initialsFromName(teacherDisplayName);

                    return (
                      <article
                        key={item.id}
                        className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm"
                      >
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-4">
                              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                {teacherSignatureSrc ? (
                                  <SignatureInk
                                    src={teacherSignatureSrc}
                                    alt={`Signature de ${teacherDisplayName}`}
                                    className="h-full w-full object-contain p-2"
                                  />
                                ) : (
                                  <span className="text-sm font-black uppercase text-slate-500">
                                    {teacherInitials}
                                  </span>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                                  Demande de l’enseignant
                                </div>

                                <div className="mt-1 text-lg font-extrabold text-slate-950">
                                  {teacherDisplayName}
                                </div>

                                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                                  <span>
                                    {formatDate(item.start_date)} → {formatDate(item.end_date)}
                                  </span>
                                  <span className="text-slate-300">•</span>
                                  <span>{item.reason_label}</span>
                                </div>

                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  {teacherSignatureSrc ? (
                                    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Signature de l’enseignant disponible
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                                      <XCircle className="h-3.5 w-3.5" />
                                      Signature non disponible
                                    </span>
                                  )}

                                  {item.signed ? (
                                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
                                      Demande signée
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={classNames(
                                "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1",
                                statusClasses(item.status)
                              )}
                            >
                              {statusLabel(item.status)}
                            </span>

                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                              <Clock3 className="h-3.5 w-3.5" />
                              {daysLabel(item.requested_days)}
                            </span>

                            {Number(item.lost_hours_total ?? 0) > 0 ? (
                              <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                                {formatDurationFromHours(item.lost_hours_total)} à rattraper
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                          <div className="rounded-2xl bg-white px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Enseignant</div>
                            <div className="mt-1 font-semibold text-slate-900">{teacherDisplayName}</div>
                          </div>

                          <div className="rounded-2xl bg-white px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Signature</div>
                            <div className="mt-1 font-semibold text-slate-900">
                              {teacherSignatureSrc
                                ? "Disponible"
                                : item.signed
                                  ? "Demandée mais indisponible"
                                  : "Non jointe"}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Période</div>
                            <div className="mt-1 font-semibold text-slate-900">
                              {formatDate(item.start_date)} → {formatDate(item.end_date)}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Motif</div>
                            <div className="mt-1 font-semibold text-slate-900">{item.reason_label}</div>
                          </div>

                          <div className="rounded-2xl bg-white px-4 py-3 sm:col-span-2">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Détails</div>
                            <div className="mt-1 leading-6 text-slate-700">{item.details}</div>
                          </div>

                          <div className="rounded-2xl bg-white px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Créée le</div>
                            <div className="mt-1 font-semibold text-slate-900">{formatDateTime(item.created_at)}</div>
                          </div>

                          <div className="rounded-2xl bg-white px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Décision</div>
                            <div className="mt-1 font-semibold text-slate-900">
                              {item.status === "approved"
                                ? formatDateTime(item.approved_at)
                                : item.status === "rejected"
                                  ? formatDateTime(item.rejected_at)
                                  : "—"}
                            </div>
                          </div>
                        </div>

                        {item.impact_summary?.impacted_classes?.length ? (
                          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                            <div className="text-sm font-bold text-amber-900">Classes impactées</div>
                            <div className="mt-2 space-y-3">
                              {item.impact_summary.impacted_classes.map((cls) => (
                                <div
                                  key={cls.class_id}
                                  className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-semibold text-slate-900">{cls.class_label}</div>
                                    <div className="text-slate-600">
                                      {formatDurationFromHours(cls.lost_hours)} • {cls.lost_sessions} créneau(x)
                                    </div>
                                  </div>

                                  {cls.slots?.length ? (
                                    <div className="mt-2 space-y-2">
                                      {cls.slots.map((slot, index) => (
                                        <div
                                          key={`${cls.class_id}_${slot.date}_${slot.period_id}_${index}`}
                                          className="rounded-xl bg-slate-50 px-3 py-2"
                                        >
                                          {formatDate(slot.date)} • {slot.subject_name} • {formatTimeRange(
                                            slot.start_time,
                                            slot.end_time,
                                            slot.period_label
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {item.makeup_plan ? (
                          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-slate-700">
                            <div className="font-bold text-emerald-900">Proposition de rattrapage</div>
                            <div className="mt-2 rounded-2xl bg-white px-4 py-3">
                              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Notes</div>
                              <div className="mt-1 leading-6 text-slate-700">{item.makeup_plan.notes || "—"}</div>
                            </div>
                          </div>
                        ) : null}

                        {item.admin_comment ? (
                          <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                            <div className="font-bold text-slate-900">Commentaire administratif</div>
                            <div className="mt-1 leading-6">{item.admin_comment}</div>
                          </div>
                        ) : null}

                        {item.status === "approved" ? (
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <div className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                              <CheckCircle2 className="h-4 w-4" />
                              Votre demande a été approuvée.
                            </div>

                            <button
                              type="button"
                              onClick={() => void handlePrintApprovedRequest(item)}
                              disabled={printingId === item.id}
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              {printingId === item.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Printer className="h-4 w-4" />
                              )}
                              Imprimer la demande approuvée
                            </button>
                          </div>
                        ) : null}

                        {item.status === "rejected" ? (
                          <div className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                            <XCircle className="h-4 w-4" />
                            Votre demande a été rejetée.
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-6 text-center text-sm text-slate-500">
                Historique masqué.
              </div>
            )}
          </section>
        </section>
      </main>

      {printPreviewItem ? (
        <div className="absence-print-overlay screen-only">
          <div className="absence-print-toolbar">
            <div>
              <div className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                Demande approuvée
              </div>
              <div className="mt-1 text-lg font-extrabold text-slate-950">
                Aperçu avant impression
              </div>
              <div className="mt-1 text-sm text-slate-600">
                Vérifiez les signatures, le logo et la mise en page A4 avant d’imprimer.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleClosePrintPreview}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <X className="h-4 w-4" />
                Fermer
              </button>

              <button
                type="button"
                onClick={handleConfirmPrint}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
              >
                <Printer className="h-4 w-4" />
                Imprimer
              </button>
            </div>
          </div>

          <div className="absence-print-preview-shell">
            <div className="absence-preview-overlay" style={{ ["--preview-zoom" as any]: previewZoom }}>
              <ApprovedRequestPrintSheet
                item={printPreviewItem}
                institution={institution}
                viewerProfile={viewerProfile}
                previewZoomForMeasure={previewZoom}
              />
            </div>
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .absence-print-overlay {
          position: fixed;
          inset: 0;
          z-index: 70;
          background: rgba(15, 23, 42, 0.56);
          backdrop-filter: blur(8px);
          display: flex;
          flex-direction: column;
        }

        .absence-print-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          padding: 16px 20px;
          background: rgba(255, 255, 255, 0.96);
          border-bottom: 1px solid rgba(148, 163, 184, 0.25);
        }

        .absence-print-preview-shell {
          flex: 1;
          overflow: auto;
          padding: 24px;
        }

        .absence-preview-overlay {
          width: fit-content;
          margin: 0 auto;
          transform: scale(var(--preview-zoom, 1));
          transform-origin: top center;
        }

        .absence-print-sheet-wrap {
          width: 794px;
        }

        .absence-print-page {
          width: 794px;
          min-height: 1122px;
          background: #ffffff;
          color: #0f172a;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.18);
          padding: 28px;
          position: relative;
        }

        .absence-print-topbar {
          height: 8px;
          border-radius: 999px;
          background: linear-gradient(90deg, #0f172a 0%, #065f46 100%);
          margin-bottom: 22px;
        }

        .absence-print-header {
          display: grid;
          grid-template-columns: 90px minmax(0, 1fr);
          gap: 16px;
          align-items: center;
        }

        .absence-logo-box {
          width: 90px;
          height: 90px;
          border: 1px solid #cbd5e1;
          border-radius: 20px;
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .absence-logo-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .absence-logo-fallback {
          font-size: 11px;
          color: #64748b;
          line-height: 1.25;
          text-align: center;
          font-weight: 700;
        }

        .absence-doc-kicker {
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #64748b;
        }

        .absence-inst-name {
          margin-top: 6px;
          font-size: 28px;
          line-height: 1.05;
          font-weight: 900;
          color: #0f172a;
        }

        .absence-inst-meta {
          margin-top: 7px;
          font-size: 12px;
          line-height: 1.5;
          color: #475569;
        }

        .absence-approved-banner {
          margin-top: 24px;
          border: 1px solid #bbf7d0;
          background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
          border-radius: 24px;
          padding: 18px 20px;
        }

        .absence-approved-big {
          font-size: 22px;
          line-height: 1.1;
          font-weight: 900;
          color: #14532d;
          letter-spacing: 0.03em;
        }

        .absence-approved-small {
          margin-top: 6px;
          font-size: 12px;
          color: #166534;
          font-weight: 600;
        }

        .absence-doc-title {
          margin-top: 20px;
          font-size: 20px;
          font-weight: 900;
          color: #0f172a;
        }

        .absence-grid {
          margin-top: 16px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .absence-card {
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          background: #fff;
          padding: 14px 16px;
        }

        .absence-card-full {
          grid-column: 1 / -1;
        }

        .absence-label {
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #64748b;
        }

        .absence-value {
          margin-top: 7px;
          font-size: 15px;
          line-height: 1.4;
          font-weight: 800;
          color: #0f172a;
        }

        .absence-value-normal {
          font-weight: 500;
        }

        .absence-impact-section {
          margin-top: 18px;
          border: 1px solid #fde68a;
          border-radius: 22px;
          background: #fffbeb;
          padding: 16px;
        }

        .absence-impact-title {
          font-size: 13px;
          font-weight: 900;
          color: #92400e;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }

        .absence-impact-card {
          border: 1px solid #fcd34d;
          background: #fff;
          border-radius: 16px;
          padding: 12px 14px;
        }

        .absence-impact-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          font-size: 13px;
          color: #78350f;
        }

        .absence-impact-slots {
          margin-top: 8px;
          display: grid;
          gap: 8px;
        }

        .absence-impact-slot {
          border-radius: 12px;
          background: #f8fafc;
          padding: 8px 10px;
          font-size: 12px;
          color: #334155;
        }

        .absence-empty-box {
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.85);
          padding: 12px 14px;
          color: #6b7280;
          font-size: 12px;
        }

        .absence-signature-grid {
          margin-top: 18px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .absence-signature-card {
          border: 1px solid #dbeafe;
          border-radius: 22px;
          background: #eff6ff;
          padding: 16px;
          position: relative;
          overflow: hidden;
        }

        .absence-signature-card-admin {
          border-color: #c7d2fe;
          background: #eef2ff;
        }

        .absence-signature-head {
          font-size: 11px;
          font-weight: 900;
          color: #1e3a8a;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .absence-signature-role {
          margin-top: 10px;
          font-size: 11px;
          color: #475569;
          font-weight: 700;
        }

        .absence-signature-name {
          margin-top: 4px;
          font-size: 18px;
          font-weight: 900;
          color: #0f172a;
          line-height: 1.2;
        }

        .absence-signature-box {
          margin-top: 14px;
          min-height: 120px;
          border: 1px dashed #94a3b8;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.9);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 10px;
        }

        .absence-signature-box-admin {
          min-height: 140px;
        }

        .absence-signature-img,
        .sig-img {
          max-width: 100%;
          max-height: 100px;
          object-fit: contain;
        }

        .absence-signature-placeholder {
          font-size: 12px;
          line-height: 1.5;
          text-align: center;
          color: #64748b;
          font-weight: 600;
        }

        .absence-approval-stamp {
          position: absolute;
          right: 14px;
          top: 14px;
          border: 2px solid rgba(22, 101, 52, 0.25);
          color: #166534;
          background: rgba(255, 255, 255, 0.8);
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          transform: rotate(-6deg);
        }

        .absence-foot {
          margin-top: 18px;
          padding-top: 14px;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          gap: 16px;
          font-size: 12px;
          color: #475569;
        }

        @media (max-width: 900px) {
          .absence-print-toolbar {
            flex-direction: column;
          }
        }

        @media (max-width: 768px) {
          .absence-grid,
          .absence-signature-grid {
            grid-template-columns: 1fr;
          }

          .absence-print-preview-shell {
            padding: 12px;
          }
        }

        @media print {
          body.absence-print-open main,
          body.absence-print-open .screen-only:not(.absence-print-overlay) {
            display: none !important;
          }

          body.absence-print-open .absence-print-overlay {
            position: static !important;
            inset: auto !important;
            background: transparent !important;
            backdrop-filter: none !important;
            display: block !important;
          }

          body.absence-print-open .absence-print-toolbar {
            display: none !important;
          }

          body.absence-print-open .absence-print-preview-shell {
            padding: 0 !important;
            overflow: visible !important;
          }

          body.absence-print-open .absence-preview-overlay {
            transform: none !important;
            margin: 0 !important;
          }

          body.absence-print-open .absence-print-sheet-wrap {
            width: auto !important;
          }

          body.absence-print-open .absence-print-page {
            width: 210mm !important;
            min-height: 297mm !important;
            box-shadow: none !important;
            margin: 0 !important;
            padding: 10mm 10mm 12mm 10mm !important;
            transform: scale(var(--print-fit-scale, 1));
            transform-origin: top center;
            page-break-after: avoid;
            break-after: avoid-page;
          }
        }
      `}</style>
    </>
  );
}
