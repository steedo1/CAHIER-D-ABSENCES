// src/app/admin/bulletins/page.tsx
"use client";

import React, {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Printer, RefreshCw, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import OfflineReadinessCard from "@/components/OfflineReadinessCard";
import OfflineSyncBar from "@/components/OfflineSyncBar";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  getAdminBulletin,
  getAdminBulletinClasses,
  getAdminBulletinConduct,
  getAdminBulletinPeriods,
  getAdminBulletinSettings,
} from "@/lib/offline-bulletins";

/* ───────── Types ───────── */

type ClassRow = {
  id: string;
  name?: string;
  label?: string | null;
  level?: string | null;
  academic_year?: string | null;
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

  // 🆕 pour l’en-tête officiel façon MEN
  country_name?: string | null;
  country_motto?: string | null;
  ministry_name?: string | null;
  institution_code?: string | null;

  // 🆕 option signatures numérisées
  bulletin_signatures_enabled?: boolean | null;

  // (compat éventuelle)
  settings_json?: any;
};

type BulletinSubject = {
  subject_id: string;
  subject_name: string;
  coeff_bulletin: number;
  include_in_average?: boolean;

  // CSCA : Latin / Religion restent visibles, mais sont hors moyenne trimestrielle.
  // Ils servent seulement au calcul spécial de la conduite.
  is_conduct_component_only?: boolean | null;
};

type BulletinSubjectComponent = {
  id: string;
  subject_id: string; // parent subject (subjects.id)
  label: string;
  short_label: string | null;
  coeff_in_subject: number;
  order_index: number;
};

type BulletinGroupItem = {
  id: string;
  group_id: string;
  subject_id: string;
  subject_name: string;
  order_index: number;
  subject_coeff_override: number | null;
};

type BulletinGroup = {
  id: string;
  code: string;
  label: string;
  short_label: string | null;
  order_index: number;
  is_active: boolean;
  annual_coeff: number;
  items: BulletinGroupItem[];
};

type PerSubjectAvg = {
  subject_id: string;
  avg20: number | null;
  subject_rank?: number | null;
  teacher_id?: string | null;
  teacher_name?: string | null;

  // ✅ Métadonnées renvoyées par l’API bulletin NC
  // 0 reste une vraie note ; null = non classé / pas de moyenne publiée.
  has_grade?: boolean | null;
  is_nc?: boolean | null;
  is_assigned?: boolean | null;

  // 🆕 signature (data URL) renvoyée par l’API quand activé
  teacher_signature_png?: string | null;
};

type PerGroupAvg = {
  group_id: string;
  group_avg: number | null;
  group_rank?: number | null;
};

type PerSubjectComponentAvg = {
  subject_id: string;
  component_id: string;
  avg20: number | null;
  component_rank?: number | null;
};

type BulletinMissingSubject = {
  subject_id: string;
  subject_name: string;
};

type BulletinCoverage = {
  expected_subjects?: number;
  covered_subjects?: number;
  missing_subjects?: BulletinMissingSubject[];
  is_complete?: boolean;
  has_academic_grade?: boolean;
  status?: "complete" | "partial" | "empty" | string;
};

type BulletinMissingPeriod = {
  from?: string | null;
  to?: string | null;
  code?: string | null;
  label?: string | null;
  short_label?: string | null;
};

type BulletinAnnualCoverage = {
  expected_periods?: number;
  covered_periods?: number;
  missing_periods?: BulletinMissingPeriod[];
  is_complete?: boolean;
  status?: "complete" | "partial" | "empty" | "not_last_period" | string;
};

type BulletinPreviousPeriodAverage = {
  from?: string | null;
  to?: string | null;
  code?: string | null;
  label?: string | null;
  short_label?: string | null;
  avg20?: number | null;
  rank?: number | null;
};

type BulletinItemBase = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  rank?: number | null;

  // Infos élève
  sex?: string | null;
  gender?: string | null;
  birthdate?: string | null;
  birth_date?: string | null;
  birth_place?: string | null;
  nationality?: string | null;
  regime?: string | null;
  is_boarder?: boolean | null;
  is_scholarship?: boolean | null;
  is_repeater?: boolean | null;
  is_assigned?: boolean | null;
  is_affecte?: boolean | null;

  // PHOTO (optionnel)
  photo_url?: string | null;
  student_photo_url?: string | null;

  // ✅ QR renvoyé par l’API
  qr_url?: string | null;
  qr_token?: string | null;
  qr_code?: string | null;

  // Registre officiel / duplicata
  official_document_source_id?: string | null;
  official_document_number?: string | null;
  official_issue_id?: string | null;
  official_print_kind?: "original" | "duplicate" | "offline_copy" | null;
  official_duplicate_number?: number | null;
  official_issued_at?: string | null;
  official_printed_at?: string | null;

  // ✅ QR PNG généré côté serveur (PRIORITAIRE pour l’affichage)
  qr_png?: string | null;

  per_subject: PerSubjectAvg[];
  per_group: PerGroupAvg[];
  general_avg: number | null;

  // ✅ Couverture officielle renvoyée par l’API bulletin
  coverage?: BulletinCoverage | null;
  general_avg_is_complete?: boolean | null;
  general_avg_status?: "complete" | "partial" | "empty" | string | null;

  per_subject_components?: PerSubjectComponentAvg[];

  // ✅ ANNUEL (rempli par l’API seulement sur la dernière période)
  annual_avg?: number | null;
  annual_rank?: number | null;
  annual_coverage?: BulletinAnnualCoverage | null;
  annual_avg_is_complete?: boolean | null;
  annual_avg_status?: "complete" | "partial" | "empty" | "not_last_period" | string | null;

  // ✅ Rappel des moyennes précédentes (T1 / T2), renvoyé seulement au dernier trimestre.
  previous_period_avgs?: BulletinPreviousPeriodAverage[] | null;

  // ✅ Décision administrative centralisée : NC au général.
  // Si true, la moyenne/rang général affichés doivent être NC,
  // sans masquer les moyennes par matière.
  admin_forced_nc?: boolean | null;
  admin_nc_reason?: string | null;
  admin_nc_missing_subjects_snapshot?: BulletinMissingSubject[] | null;

  // Valeurs conservées par l’API pour permettre l’aperçu/restauration locale
  // si l’admin décoche NC sans recharger toute la page.
  general_avg_before_admin_nc?: number | null;
  annual_avg_before_admin_nc?: number | null;
  annual_rank_before_admin_nc?: number | null;
};

type BulletinItemWithRank = BulletinItemBase & {
  rank: number | null;
};

type BulletinResponse = {
  ok: boolean;
  class: {
    id: string;
    label: string;
    code?: string | null;
    level?: string | null;
    official_track_code?: string | null;
    academic_year?: string | null;
    head_teacher?: {
      id: string;
      display_name: string | null;
      phone: string | null;
      email: string | null;
    } | null;
  };
  period: {
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
    coeff?: number | null;
    periods_defined?: boolean | null;
    is_last?: boolean | null;
    last_period?: {
      from: string | null;
      to: string | null;
      code?: string | null;
      label?: string | null;
      short_label?: string | null;
      academic_year?: string | null;
      coeff?: number | null;
    } | null;
  };
  subjects: BulletinSubject[];
  subject_groups: BulletinGroup[];
  subject_components?: BulletinSubjectComponent[];
  items: BulletinItemBase[];
  official_snapshot_locked?: boolean;
  official_total_students?: number | null;
  official_stats_snapshot?: ClassStats | null;

  qr?: {
    enabled?: boolean;
    mode?: string;
    verify_path?: string;
    legacy_verify_path?: string;
  } | null;
  signatures?: {
    enabled?: boolean;
  } | null;
};

type ClassStats = {
  highest: number | null;
  lowest: number | null;
  classAvg: number | null;
};

type EnrichedBulletin = {
  response: BulletinResponse;
  items: BulletinItemWithRank[];
  stats: ClassStats;
};

/** Périodes de notes */
type GradePeriod = {
  id: string;
  academic_year: string | null;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  coeff: number | null;
};

type ConductRubricMax = {
  assiduite: number;
  tenue: number;
  moralite: number;
  discipline: number;
};

type ConductItem = {
  student_id: string;
  full_name: string;
  breakdown: {
    assiduite: number;
    tenue: number;
    moralite: number;
    discipline: number;
  };
  total: number;
  conduct_label?: string | null;
  conduct_teacher_id?: string | null;
  conduct_teacher_name?: string | null;
  appreciation: string;
  absence_count?: number;
  tardy_count?: number;
  absence_minutes?: number;
  tardy_minutes?: number;
  official_rank_snapshot?: number | null;
};

type ConductSummaryResponse = {
  class_label: string;
  conduct_label?: string | null;
  conduct_teacher_id?: string | null;
  conduct_teacher_name?: string | null;
  is_csca?: boolean;
  rubric_max: ConductRubricMax;
  total_max: number;
  items: ConductItem[];
};

/* ───────── Mentions conseil de classe ───────── */

type CouncilMentions = {
  distinction: "excellence" | "honour" | "encouragement" | null;
  sanction:
    | "warningWork"
    | "warningConduct"
    | "blameWork"
    | "blameConduct"
    | null;
};

function computeCouncilMentions(
  generalAvg: number | null | undefined,
  conductOn20: number | null | undefined,
  isCsca = false
): CouncilMentions {
  let distinction: CouncilMentions["distinction"] = null;
  let sanction: CouncilMentions["sanction"] = null;

  if (
    generalAvg !== null &&
    generalAvg !== undefined &&
    Number.isFinite(generalAvg)
  ) {
    const g = Number(generalAvg);
    const felicitationMin = isCsca ? 15 : 14;
    const encouragementMin = isCsca ? 14 : 12;

    if (g >= 16) distinction = "excellence";
    else if (g >= felicitationMin) distinction = "honour";
    else if (g >= encouragementMin) distinction = "encouragement";
    else if (g < 8) sanction = "blameWork";
    else if (g < 10) sanction = "warningWork";
  }

  if (
    conductOn20 !== null &&
    conductOn20 !== undefined &&
    Number.isFinite(conductOn20)
  ) {
    const c = Number(conductOn20);
    const ratio = c / 20;
    if (ratio <= 0.4) sanction = "blameConduct";
    else if (ratio <= 0.6 && !sanction) sanction = "warningConduct";
  }

  return { distinction, sanction };
}

function clampTo20(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 20) return 20;
  return n;
}

function computeCouncilAppreciationText(
  mentions: CouncilMentions,
  generalAvg: number | null | undefined,
  conductOn20: number | null | undefined
): string {
  const g =
    generalAvg !== null && generalAvg !== undefined ? Number(generalAvg) : null;
  const c =
    conductOn20 !== null &&
    conductOn20 !== undefined &&
    Number.isFinite(conductOn20)
      ? Number(conductOn20)
      : null;

  if (mentions.sanction === "blameConduct") return "Conduite très insuffisante.";
  if (mentions.sanction === "warningConduct") return "Conduite à améliorer.";
  if (mentions.sanction === "blameWork") return "Résultats très insuffisants.";
  if (mentions.sanction === "warningWork") return "Résultats insuffisants.";

  if (mentions.distinction === "excellence") return "Excellent travail.";
  if (mentions.distinction === "honour") return "Très bon travail.";
  if (mentions.distinction === "encouragement") return "Assez bon travail.";

  if (g !== null && Number.isFinite(g)) {
    if (g >= 10) return "Travail passable.";
    return "Travail moyen.";
  }

  if (c !== null && Number.isFinite(c)) {
    if (c >= 14) return "Conduite satisfaisante.";
    if (c >= 10) return "Conduite correcte.";
    return "Conduite à suivre.";
  }

  return "";
}

function isAutresGroupLabel(label?: string | null): boolean {
  if (!label) return false;
  const key = label
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  return (
    key.includes("AUTRES") ||
    key.includes("DIVERS") ||
    key.includes("VIESCOLAIRE") ||
    key.includes("CONDUITE")
  );
}

function isAutresGroup(g: BulletinGroup): boolean {
  return isAutresGroupLabel(g.label) || isAutresGroupLabel(g.code);
}

/* ───────── UI helpers ───────── */

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

function Button({ variant = "primary", ...props }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-4";
  const variants: Record<string, string> = {
    primary:
      "bg-emerald-500 text-white hover:bg-emerald-600 focus:ring-emerald-500/30 disabled:bg-emerald-300",
    ghost:
      "bg-white/80 backdrop-blur border border-slate-300 text-slate-700 hover:bg-slate-100 focus:ring-slate-400/30 disabled:opacity-60",
  };
  return (
    <button
      {...props}
      className={[base, variants[variant], props.className ?? ""].join(" ")}
    />
  );
}

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return Number(n).toFixed(digits);
}

function formatRankOrNC(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "NC";
  return `${Number(n)}e`;
}

function formatReminderPeriodLabel(
  row: BulletinPreviousPeriodAverage,
  idx: number
): string {
  const raw = String(row.label || row.short_label || row.code || "").trim();
  if (raw) {
    const normalized = raw.toLowerCase();
    if (normalized.includes("1") && normalized.includes("trim")) return "1er trimestre";
    if (normalized.includes("2") && normalized.includes("trim")) return "2e trimestre";
    if (normalized.includes("3") && normalized.includes("trim")) return "3e trimestre";
    return raw;
  }
  if (idx === 0) return "1er trimestre";
  if (idx === 1) return "2e trimestre";
  return `${idx + 1}e trimestre`;
}

function formatReminderRank(
  rank: number | null | undefined,
  total: number
): string {
  if (rank === null || rank === undefined || !Number.isFinite(Number(rank))) return "NC";
  return `${formatRankOrNC(rank)} / ${total}`;
}

function hasNumericValue(n: number | null | undefined): boolean {
  return n !== null && n !== undefined && Number.isFinite(Number(n));
}

function formatNumberOrNCWithMarker(
  n: number | null | undefined,
  _showMarker: boolean,
  digits = 2
): string {
  if (!hasNumericValue(n)) return "NC";
  return `${Number(n).toFixed(digits)}`;
}


function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDateFR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR");
}

function formatOfficialDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}


function formatYesNo(value: boolean | null | undefined): string {
  if (value === true) return "Oui";
  if (value === false) return "Non";
  return "—";
}

function computeSubjectAppreciation(avg: number | null | undefined): string {
  if (avg === null || avg === undefined) return "";
  if (!Number.isFinite(avg)) return "";
  const a = Number(avg);
  if (a >= 18) return "Excellent";
  if (a >= 16) return "TRÈS bien";
  if (a >= 14) return "Bien";
  if (a >= 12) return "Assez bien";
  if (a >= 10) return "Passable";
  if (a >= 8) return "Insuffisant";
  if (a >= 6) return "Faible";
  return "Blâme";
}

/* ───────── QR Code (généré côté client) ───────── */

const QR_SIZE = 140;
const __QR_CACHE = new Map<string, string>();
let __qrLibPromise: Promise<any> | null = null;

async function getQrLib() {
  if (!__qrLibPromise) {
    // @ts-ignore
    __qrLibPromise = import("qrcode");
  }
  return __qrLibPromise;
}

async function generateQrDataUrl(
  text: string,
  size: number = QR_SIZE
): Promise<string | null> {
  const cacheKey = `${size}|${text}`;
  const cached = __QR_CACHE.get(cacheKey);
  if (cached) return cached;

  try {
    const mod: any = await getQrLib();
    const toDataURL =
      (mod && typeof mod.toDataURL === "function" && mod.toDataURL) ||
      (mod?.default &&
        typeof mod.default.toDataURL === "function" &&
        mod.default.toDataURL);

    if (typeof toDataURL !== "function") return null;

    const url: string = await toDataURL(text, {
      width: size,
      margin: 2,
      errorCorrectionLevel: "Q",
    });

    if (url) __QR_CACHE.set(cacheKey, url);
    return url || null;
  } catch (e) {
    console.warn("[Bulletins] QR indisponible (import qrcode a échoué)", e);
    return null;
  }
}

/* ───────── SIGNATURES : encre + teinte bleue (IMG robuste) ───────── */

const SIGNATURE_BLUE = "#1d4ed8";

const __SIG_INK_CACHE = new Map<string, string>();
const __SIG_INK_PROMISES = new Map<string, Promise<string | null>>();

const __SIG_TINT_CACHE = new Map<string, string>();
const __SIG_TINT_PROMISES = new Map<string, Promise<string | null>>();

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

        const newA = Math.min(
          255,
          Math.max(170, Math.max(a, Math.round(boostedA)))
        );

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
      console.warn("[Bulletins] inkifySignaturePng failed, fallback original", e);
      return src;
    } finally {
      __SIG_INK_PROMISES.delete(src);
    }
  })();

  __SIG_INK_PROMISES.set(src, job);
  return job;
}

async function tintSignaturePng(
  src: string,
  hexColor: string
): Promise<string | null> {
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
      console.warn("[Bulletins] tintSignaturePng failed, fallback", e);
      return src;
    } finally {
      __SIG_TINT_PROMISES.delete(cacheKey);
    }
  })();

  __SIG_TINT_PROMISES.set(cacheKey, job);
  return job;
}

function SignatureInk({ src, className }: { src: string; className?: string }) {
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
  return (
    <img
      src={displaySrc || src}
      alt="Signature"
      className={["sig-img", className ?? ""].join(" ")}
    />
  );
}

/* ───────── Rangs sous-matières (front) ───────── */

function applyComponentRanksFront(
  items: (BulletinItemBase | BulletinItemWithRank)[]
) {
  type Entry = { itemIndex: number; compIndex: number; avg: number; key: string };
  const byKey = new Map<string, Entry[]>();

  items.forEach((it, itemIndex) => {
    const comps = it.per_subject_components ?? [];
    comps.forEach((psc, compIndex) => {
      const raw = psc.avg20;
      if (raw === null || raw === undefined) return;
      const avg = Number(raw);
      if (!Number.isFinite(avg)) return;
      const key = `${psc.subject_id}__${psc.component_id}`;
      const arr = byKey.get(key) ?? [];
      arr.push({ itemIndex, compIndex, avg, key });
      byKey.set(key, arr);
    });
  });

  byKey.forEach((entries) => {
    entries.sort((a, b) => b.avg - a.avg);

    let lastAvg: number | null = null;
    let currentRank = 0;
    let position = 0;

    entries.forEach(({ itemIndex, compIndex, avg }) => {
      position += 1;
      if (lastAvg === null || avg !== lastAvg) {
        currentRank = position;
        lastAvg = avg;
      }
      const comps = items[itemIndex].per_subject_components;
      if (!comps || !comps[compIndex]) return;
      (comps[compIndex] as any).component_rank = currentRank;
    });
  });
}

/* ───────── Rangs groupes (front) ───────── */

function applyGroupRanksFront(items: (BulletinItemBase | BulletinItemWithRank)[]) {
  type Entry = {
    itemIndex: number;
    groupIndex: number;
    avg: number;
    groupId: string;
  };
  const byGroup = new Map<string, Entry[]>();

  items.forEach((it, itemIndex) => {
    const groups = it.per_group ?? [];
    groups.forEach((g, groupIndex) => {
      const raw = g.group_avg;
      if (raw === null || raw === undefined) return;
      const avg = Number(raw);
      if (!Number.isFinite(avg)) return;
      const groupId = g.group_id;
      const arr = byGroup.get(groupId) ?? [];
      arr.push({ itemIndex, groupIndex, avg, groupId });
      byGroup.set(groupId, arr);
    });
  });

  byGroup.forEach((entries) => {
    entries.sort((a, b) => b.avg - a.avg);

    let lastAvg: number | null = null;
    let currentRank = 0;
    let position = 0;

    entries.forEach(({ itemIndex, groupIndex, avg }) => {
      position += 1;
      if (lastAvg === null || avg !== lastAvg) {
        currentRank = position;
        lastAvg = avg;
      }
      const groups = items[itemIndex].per_group;
      if (!groups || !groups[groupIndex]) return;
      (groups[groupIndex] as any).group_rank = currentRank;
    });
  });
}

/* ───────── Ranks + stats (API = source de vérité) ───────── */

function computeRanksAndStats(res: BulletinResponse | null): EnrichedBulletin | null {
  if (!res) return null;

  const baseItems = res.items ?? [];

  if (res.official_snapshot_locked) {
    const lockedItems: BulletinItemWithRank[] = baseItems.map((item) => ({
      ...item,
      rank:
        item.rank !== null && item.rank !== undefined && Number.isFinite(Number(item.rank))
          ? Number(item.rank)
          : null,
    }));
    return {
      response: res,
      items: lockedItems,
      stats: res.official_stats_snapshot ?? {
        highest: null,
        lowest: null,
        classAvg: null,
      },
    };
  }

  // ✅ Le front ne fabrique plus une moyenne générale quand l’API renvoie null.
  // Nouvelle règle :
  // - moyenne calculable, même partielle => rang autorisé ;
  // - aucune moyenne => NC ;
  // - décision admin centralisée => moyenne générale NC + rang NC,
  //   sans masquer les notes par matière.
  const itemsWithAvg: BulletinItemWithRank[] = baseItems.map((it) => {
    const forcedNc = it.admin_forced_nc === true || it.general_avg_status === "admin_nc";

    const sourceAvg =
      it.general_avg_before_admin_nc !== null &&
      it.general_avg_before_admin_nc !== undefined
        ? it.general_avg_before_admin_nc
        : it.general_avg;

    const apiAvg =
      sourceAvg !== null && sourceAvg !== undefined
        ? Number(sourceAvg)
        : null;

    const finalAvg =
      !forcedNc && apiAvg !== null && Number.isFinite(apiAvg)
        ? round2(apiAvg)
        : null;

    const sourceAnnualAvg =
      it.annual_avg_before_admin_nc !== null &&
      it.annual_avg_before_admin_nc !== undefined
        ? it.annual_avg_before_admin_nc
        : it.annual_avg;

    const apiAnnualAvg =
      sourceAnnualAvg !== null && sourceAnnualAvg !== undefined
        ? Number(sourceAnnualAvg)
        : null;

    const finalAnnualAvg =
      !forcedNc && apiAnnualAvg !== null && Number.isFinite(apiAnnualAvg)
        ? round2(apiAnnualAvg)
        : null;

    return {
      ...it,
      general_avg: finalAvg,
      annual_avg: finalAnnualAvg,
      annual_rank: forcedNc ? null : it.annual_rank ?? null,
      rank: null,
    };
  });

  const withAvg = itemsWithAvg.filter(
    (it) => typeof it.general_avg === "number" && Number.isFinite(it.general_avg)
  );

  const stats: ClassStats = { highest: null, lowest: null, classAvg: null };

  /**
   * Les statistiques de classe doivent refléter les moyennes réellement calculées
   * pour la période officielle.
   *
   * Important : un ancien marquage administratif NC peut mettre general_avg à null
   * tout en conservant general_avg_before_admin_nc. Dans ce cas, le bulletin de
   * l'élève reste NC si l'admin l'a décidé, mais les statistiques globales de
   * classe ne doivent pas perdre ces moyennes calculées. Sinon la moyenne mini
   * et la moyenne de classe deviennent fausses après une réimportation officielle
   * des notes.
   */
  const statsValues = baseItems
    .map((it) => {
      const raw =
        it.general_avg_before_admin_nc !== null &&
        it.general_avg_before_admin_nc !== undefined
          ? it.general_avg_before_admin_nc
          : it.general_avg;

      const n = raw !== null && raw !== undefined ? Number(raw) : null;
      return n !== null && Number.isFinite(n) ? round2(n) : null;
    })
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

  if (statsValues.length) {
    const sortedForStats = [...statsValues].sort((a, b) => b - a);
    const sumAll = statsValues.reduce((acc, n) => acc + n, 0);
    const highest = sortedForStats[0] ?? null;
    const lowest = sortedForStats[sortedForStats.length - 1] ?? null;
    const classAvg = sumAll / statsValues.length;

    stats.highest = highest !== null ? round2(highest) : null;
    stats.lowest = lowest !== null ? round2(lowest) : null;
    stats.classAvg = round2(classAvg);
  }

  // ✅ Rang officiel autorisé dès qu’une moyenne générale existe,
  // même si certaines matières sont manquantes.
  const sortedForRank = [...withAvg].sort(
    (a, b) => (b.general_avg ?? 0) - (a.general_avg ?? 0)
  );

  let lastScore: number | null = null;
  let lastRank = 0;
  const rankByStudent = new Map<string, number>();

  sortedForRank.forEach((it, idx) => {
    const g = it.general_avg ?? 0;
    if (lastScore === null || g !== lastScore) {
      lastRank = idx + 1;
      lastScore = g;
    }
    rankByStudent.set(it.student_id, lastRank);
  });

  const itemsWithRank: BulletinItemWithRank[] = itemsWithAvg.map((it) => ({
    ...it,
    rank: rankByStudent.get(it.student_id) ?? null,
  }));

  applyComponentRanksFront(itemsWithRank);
  applyGroupRanksFront(itemsWithRank);

  return { response: res, items: itemsWithRank, stats };
}

/* ───────── Helpers "bulletin officiel" ───────── */

function periodTitle(period: BulletinResponse["period"]) {
  const t = (period.label || period.short_label || period.code || "").trim();
  return t || "Trimestre";
}

function normalizeDecisionToken(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isThirdGradeClass(classInfo: BulletinResponse["class"]): boolean {
  const c = normalizeDecisionToken(
    `${(classInfo as any)?.level || ""} ${(classInfo as any)?.official_track_code || ""} ${classInfo.code || ""} ${classInfo.label || ""}`
  );

  return (
    c === "3e" ||
    c === "3eme" ||
    c === "troisieme" ||
    c.startsWith("3e") ||
    c.startsWith("3eme") ||
    c.includes("troisieme")
  );
}

function isTerminaleClass(classInfo: BulletinResponse["class"]): boolean {
  const c = normalizeDecisionToken(
    `${(classInfo as any)?.level || ""} ${(classInfo as any)?.official_track_code || ""} ${classInfo.code || ""} ${classInfo.label || ""}`
  );

  return (
    c === "tle" ||
    c === "terminale" ||
    c.startsWith("tle") ||
    c.startsWith("terminale")
  );
}

function endOfYearDecisionLabel(
  avg: number | null | undefined,
  opts?: {
    classInfo?: BulletinResponse["class"] | null;
    item?: BulletinItemBase | null;
  }
): string {
  const classInfo = opts?.classInfo ?? null;
  const item = opts?.item ?? null;

  const isAssigned = Boolean(item?.is_assigned ?? item?.is_affecte ?? false);
  const isRepeater = Boolean(item?.is_repeater ?? false);

  /*
   * Décisions de fin d'année :
   * - pas d'« avis conseil » : le seuil d'admission reste 10/20 ;
   * - pas d'ADMIS en classe d'examen avant les résultats officiels ;
   * - pas de triplement : un redoublant qui échoue ne repart pas en redoublement.
   */

  // 3e : décision conditionnelle liée au BEPC / à l'orientation.
  // Même avec une bonne moyenne annuelle, on n'affiche pas ADMIS avant l'examen.
  if (classInfo && isThirdGradeClass(classInfo)) {
    return isAssigned && !isRepeater ? "RNO" : "ENO";
  }

  // Terminale : décision conditionnelle liée au BAC.
  // REC uniquement pour l'affecté non redoublant ; tous les autres cas => EEC.
  if (classInfo && isTerminaleClass(classInfo)) {
    return isAssigned && !isRepeater ? "REC" : "EEC";
  }

  if (avg === null || avg === undefined || !Number.isFinite(Number(avg))) return "—";

  const average = Number(avg);

  // Autres niveaux : 10 strict pour l'admission.
  if (average >= 10) return "ADMIS";

  // Redoublement autorisé seulement pour les non-redoublants dans la zone 8,50 à 9,99.
  if (average >= 8.5 && !isRepeater) return "REDOUBLE";

  // Moins de 8,50 ou redoublant en échec : exclusion.
  return "EXCLU";
}

function safeUpper(s: string) {
  try {
    return s.toUpperCase();
  } catch {
    return s;
  }
}

function normalizePlainText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isCscaInstitution(institution: InstitutionSettings | null | undefined): boolean {
  const haystack = normalizePlainText(
    [
      institution?.institution_name,
      institution?.institution_code,
      institution?.institution_status,
    ]
      .filter(Boolean)
      .join(" ")
  );

  return (
    haystack.includes("csca") ||
    (haystack.includes("cours secondaire catholique") && haystack.includes("aboisso"))
  );
}

function getHeadVisaLabel(institution: InstitutionSettings | null | undefined): string {
  const haystack = normalizePlainText(
    [institution?.institution_status, institution?.institution_head_title]
      .filter(Boolean)
      .join(" ")
  );

  if (
    haystack.includes("directeur des etudes") ||
    haystack.includes("directrice des etudes") ||
    haystack.includes("prive") ||
    haystack.includes("private")
  ) {
    return "Visa du Directeur des Études";
  }

  return "Visa du chef d’établissement";
}


function normalizeSubjectLabelForConduct(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isConductDisplaySubject(
  subject: { subject_name?: string | null; subject_id?: string | null } | null | undefined,
  conductLabel: string,
): boolean {
  const label = normalizeSubjectLabelForConduct(subject?.subject_name);
  const wanted = normalizeSubjectLabelForConduct(conductLabel || "Conduite");
  if (!label) return false;

  if (label.includes("conduite") || label.includes("conduct")) return true;
  return label === wanted;
}

/* ───────── Student bulletin card ───────── */

type StudentBulletinCardProps = {
  index: number;
  total: number;
  item: BulletinItemWithRank;
  subjects: BulletinSubject[];
  subjectComponents: BulletinSubjectComponent[];
  subjectGroups: BulletinGroup[];
  classInfo: BulletinResponse["class"];
  period: BulletinResponse["period"];
  institution: InstitutionSettings | null;
  stats: ClassStats;
  conduct?: ConductItem | null;
  conductLabel?: string | null;
  conductTeacherName?: string | null;
  conductRank?: number | null;
  conductRubricMax?: ConductRubricMax;
  conductTotalMax?: number;
  signaturesEnabled?: boolean | null;

  // ✅ pour calculer le "fit-to-page" malgré le zoom d’aperçu
  previewZoomForMeasure: number;
};

function StudentBulletinCard({
  index,
  total,
  item,
  subjects,
  subjectComponents,
  subjectGroups,
  classInfo,
  period,
  institution,
  stats,
  conduct,
  conductLabel,
  conductTeacherName,
  conductRank,
  conductRubricMax,
  conductTotalMax,
  signaturesEnabled,
  previewZoomForMeasure,
}: StudentBulletinCardProps) {
  const signaturesActive = !!signaturesEnabled;

  /* ✅ FIT-TO-PAGE : si ça dépasse, on scale automatiquement à l’impression */
  const pageRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [printFitScale, setPrintFitScale] = useState(1);

  const setScale = (s: number) => {
    const v = Number.isFinite(s) ? s : 1;
    setPrintFitScale(v);
    if (pageRef.current) {
      pageRef.current.style.setProperty("--print-fit-scale", String(v));
    }
  };

  const computePrintFit = () => {
    const pageEl = pageRef.current;
    const contentEl = contentRef.current;
    if (!pageEl || !contentEl || typeof window === "undefined") return;

    const zoom = Math.max(0.1, Number(previewZoomForMeasure || 1));

    // Hauteur réelle du CONTENU, corrigée du zoom d’aperçu.
    // Important : on ignore la hauteur minimale artificielle de la page A4,
    // sinon l’impression réduit toujours le bulletin même quand le contenu tient déjà.
    const rect = contentEl.getBoundingClientRect();
    const contentTop = rect.top;
    const realBottom = Array.from(contentEl.children).reduce((bottom, child) => {
      const el = child as HTMLElement;
      if (el.classList.contains("bulletin-watermark")) return bottom;
      const childRect = el.getBoundingClientRect();
      return Math.max(bottom, childRect.bottom - contentTop);
    }, 0);
    const contentStyles = window.getComputedStyle(contentEl);
    const paddingBottom = Number.parseFloat(contentStyles.paddingBottom || "0") || 0;
    const measuredH = realBottom > 0 ? realBottom + paddingBottom : rect.height;
    const naturalH = measuredH / zoom;

    if (!Number.isFinite(naturalH) || naturalH <= 0) return;

    // Zone utile A4 imprimée : 297 mm - marges @page 4 mm x 2 = 289 mm.
    // On garde une petite réserve, mais on évite de réduire inutilement la police.
    const targetPx = (287 / 25.4) * 96;

    if (naturalH <= targetPx) {
      setScale(1);
      return;
    }

    const raw = Math.min(1, targetPx / naturalH);
    const safe = Math.min(1, raw * 0.995);

    // En dessous de 0.55, le bulletin deviendrait illisible : on préfère garder
    // le maximum possible tout en évitant les coupes ordinaires.
    const clamped = Math.max(0.55, safe);

    setScale(clamped);
  };

  useLayoutEffect(() => {
    computePrintFit();

    // recalcul après images / signatures
    const t1 = window.setTimeout(computePrintFit, 150);
    const t2 = window.setTimeout(computePrintFit, 650);
    const t3 = window.setTimeout(computePrintFit, 1400);

    const onResize = () => computePrintFit();
    window.addEventListener("resize", onResize);

    // ✅ recalcul juste avant impression + sur demande explicite
    const onBeforePrint = () => computePrintFit();
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("bulletins:recalc-fit" as any, onBeforePrint as any);

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
      window.removeEventListener(
        "bulletins:recalc-fit" as any,
        onBeforePrint as any
      );
      if (ro) ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    previewZoomForMeasure,
    signaturesActive,
    subjects.length,
    subjectComponents.length,
    subjectGroups.length,
    item.student_id,
  ]);

  const academicYear = classInfo.academic_year || period.academic_year || "";
  const rawSex = item.sex ?? item.gender ?? null;
  const sexLabel = rawSex ? String(rawSex).toUpperCase() : "—";

  const rawBirth = item.birthdate ?? item.birth_date ?? null;
  const birthdateLabel = formatDateFR(rawBirth);

  const birthPlaceLabel = item.birth_place || "—";
  const nationalityLabel = item.nationality || "—";
  const regimeLabel =
    item.regime ||
    (item.is_scholarship === true
      ? "Boursier"
      : item.is_scholarship === false
      ? "Non boursier"
      : "—");

  const boarderLabel =
    item.is_boarder == null ? "—" : item.is_boarder ? "Interne" : "Externe";
  const repeaterLabel = formatYesNo(item.is_repeater);
  const assignedLabel = formatYesNo(item.is_assigned ?? item.is_affecte ?? null);

  const photoUrl = item.photo_url || (item as any).student_photo_url || null;

  const rawConductTotal =
    conduct && typeof conduct.total === "number" ? conduct.total : null;
  const conductNoteOn20 = clampTo20(
    rawConductTotal !== null ? Number(rawConductTotal) : null
  );

  // ✅ ANNUEL (affiché seulement si l’API le remplit = dernière période)
  const annualAvgOn20 = clampTo20(
    item.annual_avg !== undefined && item.annual_avg !== null
      ? Number(item.annual_avg)
      : null
  );
  const annualRank = item.annual_rank ?? null;
  const showAnnual = annualAvgOn20 !== null;
  const previousPeriodAverages = useMemo(() => {
    const rows = Array.isArray(item.previous_period_avgs)
      ? item.previous_period_avgs
      : [];

    return rows
      .map((row, idx) => ({
        ...row,
        avg20: clampTo20(row.avg20 ?? null),
        fallbackLabel: idx === 0 ? "1er trimestre" : idx === 1 ? "2e trimestre" : `${idx + 1}e trimestre`,
      }))
      .slice(0, 2);
  }, [item.previous_period_avgs]);
  const isLastPeriodForDisplay = period.is_last === true || showAnnual;
  const showPreviousPeriodAverages =
    isLastPeriodForDisplay && previousPeriodAverages.length > 0;

  // Bulletin : on garde UNE SEULE ligne de conduite.
  // Même au CSCA, « Discipline » reste la composante issue des 4 rubriques ;
  // elle ne remplace pas le libellé final du bulletin et ne doit pas créer
  // une deuxième ligne de conduite.
  const conductDisplayLabel = "Conduite";
  const conductResponsibleName =
    String(conductTeacherName || conduct?.conduct_teacher_name || "").trim() || null;

  const existingConductSubject = useMemo(
    () => subjects.find((s) => isConductDisplaySubject(s, conductDisplayLabel)) || null,
    [subjects, conductDisplayLabel],
  );

  const conductSubject: BulletinSubject | null =
    conductNoteOn20 !== null
      ? {
          subject_id: existingConductSubject?.subject_id || "__CONDUCT__",
          subject_name: conductDisplayLabel,
          coeff_bulletin: existingConductSubject?.coeff_bulletin || 1,
          include_in_average: true,
        }
      : null;

  const perSubjectBase = item.per_subject ?? [];

  const perSubject: PerSubjectAvg[] = useMemo(() => {
    const base: PerSubjectAvg[] = [...perSubjectBase];
    if (conductSubject && conductNoteOn20 !== null) {
      const existing = base.find(
        (ps) => ps.subject_id === conductSubject.subject_id
      );
      if (existing) {
        existing.avg20 = conductNoteOn20;
        existing.subject_rank = conductRank ?? null;
        if (!existing.teacher_name && conductResponsibleName) {
          existing.teacher_name = conductResponsibleName;
        }
      } else {
        base.push({
          subject_id: conductSubject.subject_id,
          avg20: conductNoteOn20,
          subject_rank: conductRank ?? null,
          teacher_name: conductResponsibleName || "",
          teacher_signature_png: null,
        });
      }
    }
    return base;
  }, [perSubjectBase, conductSubject, conductNoteOn20, conductResponsibleName, conductRank]);

  const subjectCompsBySubject = useMemo(() => {
    const map = new Map<string, BulletinSubjectComponent[]>();
    subjectComponents.forEach((c) => {
      const arr = map.get(c.subject_id) ?? [];
      arr.push(c);
      map.set(c.subject_id, arr);
    });
    map.forEach((arr) =>
      arr.sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    );
    return map;
  }, [subjectComponents]);

  const perSubjectComponentMap = useMemo(() => {
    const m = new Map<
      string,
      { avg20: number | null; component_rank?: number | null }
    >();
    const per = item.per_subject_components ?? [];
    per.forEach((psc) => {
      const key = `${psc.subject_id}__${psc.component_id}`;
      m.set(key, {
        avg20: psc.avg20 ?? null,
        component_rank:
          psc.component_rank !== undefined ? psc.component_rank : null,
      });
    });
    return m;
  }, [item.per_subject_components]);

  const perGroupMap = useMemo(() => {
    const m = new Map<
      string,
      { group_avg: number | null; group_rank?: number | null }
    >();
    const per = item.per_group ?? [];
    per.forEach((g) => {
      m.set(g.group_id, {
        group_avg: g.group_avg ?? null,
        group_rank: g.group_rank !== undefined ? g.group_rank : null,
      });
    });
    return m;
  }, [item.per_group]);

  const allSubjects = useMemo(() => {
    if (conductSubject) return [...subjects, conductSubject];
    return [...subjects];
  }, [subjects, conductSubject]);

  const subjectsForTable = useMemo(() => {
    return allSubjects.filter((s) => {
      // La conduite ajoutée côté front n’apparaît que si elle existe.
      if (s.subject_id === conductSubject?.subject_id) return conductNoteOn20 !== null;
      // Les autres matières viennent de l’API bulletin : elles sont déjà filtrées côté API
      // pour exclure les matières non affectées. Si elles n’ont pas de note, on affiche NC.
      return true;
    });
  }, [allSubjects, conductSubject, conductNoteOn20]);

  const effectiveCoeffBySubjectId = useMemo(() => {
    const map = new Map<string, number>();

    subjectGroups.forEach((g) => {
      if (!g.is_active) return;

      g.items.forEach((it) => {
        const subj = subjectsForTable.find((s) => s.subject_id === it.subject_id);
        if (!subj) return;

        const officialCoeff = Number(subj.coeff_bulletin ?? 0);
        const override = Number(it.subject_coeff_override ?? NaN);
        const coeff =
          Number.isFinite(officialCoeff) && officialCoeff > 0
            ? officialCoeff
            : Number.isFinite(override) && override > 0
              ? override
              : 0;

        if (Number.isFinite(coeff) && coeff > 0 && !map.has(subj.subject_id)) {
          map.set(subj.subject_id, coeff);
        }
      });
    });

    subjectsForTable.forEach((s) => {
      if (map.has(s.subject_id)) return;

      const coeff =
        s.subject_id === conductSubject?.subject_id
          ? 1
          : Number(s.coeff_bulletin ?? 0);

      if (Number.isFinite(coeff) && coeff > 0) {
        map.set(s.subject_id, coeff);
      }
    });

    return map;
  }, [subjectGroups, subjectsForTable, conductSubject]);

  const coeffTotal = useMemo(
    () =>
      subjectsForTable.reduce((acc, s) => {
        if (
          s.include_in_average === false &&
          s.subject_id !== conductSubject?.subject_id
        ) {
          return acc;
        }
        return acc + (effectiveCoeffBySubjectId.get(s.subject_id) ?? 0);
      }, 0),
    [subjectsForTable, conductSubject, effectiveCoeffBySubjectId]
  );

  const moyCoeffTotal = useMemo(() => {
    let sum = 0;
    let hasAtLeastOneValue = false;

    subjectsForTable.forEach((subject) => {
      if (
        subject.include_in_average === false &&
        subject.subject_id !== conductSubject?.subject_id
      ) {
        return;
      }

      const cell = perSubject.find((ps) => ps.subject_id === subject.subject_id);
      const avg = cell?.avg20;
      if (avg === null || avg === undefined || !Number.isFinite(Number(avg))) {
        return;
      }

      const coeff =
        effectiveCoeffBySubjectId.get(subject.subject_id) ??
        (subject.subject_id === conductSubject?.subject_id
          ? 1
          : Number(subject.coeff_bulletin ?? 0));

      if (!Number.isFinite(coeff) || coeff <= 0) return;

      sum += Number(avg) * coeff;
      hasAtLeastOneValue = true;
    });

    return hasAtLeastOneValue ? round2(sum) : null;
  }, [subjectsForTable, conductSubject, effectiveCoeffBySubjectId, perSubject]);

  const computeDisplayedGroupStats = (
    groupSubjects: BulletinSubject[]
  ) => {
    let sum = 0;
    let sumCoeff = 0;

    groupSubjects.forEach((s) => {
      // Les matières configurées uniquement pour la conduite (ex. Religion/Latin)
      // restent visibles au bulletin, mais ne doivent pas être recomptées dans le
      // bilan du groupe si elles sont déjà intégrées à la ligne Conduite.
      if (
        s.include_in_average === false &&
        s.subject_id !== conductSubject?.subject_id
      ) {
        return;
      }

      const cell = perSubject.find((ps) => ps.subject_id === s.subject_id);
      const val = cell?.avg20;

      if (val === null || val === undefined || !Number.isFinite(Number(val))) {
        return;
      }

      const coeff =
        effectiveCoeffBySubjectId.get(s.subject_id) ??
        (s.subject_id === conductSubject?.subject_id
          ? 1
          : Number(s.coeff_bulletin ?? 0));

      if (!Number.isFinite(coeff) || coeff <= 0) return;

      sum += Number(val) * coeff;
      sumCoeff += coeff;
    });

    const groupAvgRaw = sumCoeff > 0 ? sum / sumCoeff : null;

    return {
      groupAvg: groupAvgRaw !== null ? round2(groupAvgRaw) : null,
      groupCoeff: sumCoeff,
      groupTotal: sumCoeff > 0 ? round2(sum) : null,
    };
  };

  const subjectsById = useMemo(() => {
    const m = new Map<string, BulletinSubject>();
    subjectsForTable.forEach((s) => m.set(s.subject_id, s));
    return m;
  }, [subjectsForTable]);

  const generalAvgHasValue = hasNumericValue(item.general_avg);
  const annualAvgHasValue = showAnnual && hasNumericValue(annualAvgOn20);

  // ✅ Plus d’étoile.
  // Une moyenne calculable, même partielle, peut être classée.
  // Si l’admin a coché l’élève NC au général, item.general_avg / annual_avg sont déjà null.
  const showGeneralIncompleteMarker = false;
  const showAnnualIncompleteMarker = false;

  const showEndOfYearDecision = showAnnual && annualAvgHasValue;
  const endOfYearDecision = showEndOfYearDecision
    ? endOfYearDecisionLabel(annualAvgOn20, { classInfo, item })
    : "—";

  const isCscaSchool = isCscaInstitution(institution);

  const mentions = generalAvgHasValue
    ? computeCouncilMentions(item.general_avg, conductNoteOn20, isCscaSchool)
    : computeCouncilMentions(null, conductNoteOn20, isCscaSchool);

  const councilText = generalAvgHasValue
    ? computeCouncilAppreciationText(mentions, item.general_avg, conductNoteOn20)
    : "Conseil à compléter.";

  const tick = (checked: boolean) => (
    <span
      className={[
        "mr-1 inline-flex h-[14px] w-[14px] items-center justify-center",
        "border-2 border-black text-[12px] font-black leading-none",
        checked ? "bg-white" : "bg-white",
      ].join(" ")}
      aria-label={checked ? "Coché" : "Non coché"}
    >
      {checked ? "✓" : ""}
    </span>
  );

  const qrText = useMemo(() => {
    const apiUrl = (item.qr_url || "").trim();
    if (apiUrl) return apiUrl;

    const payload = {
      v: 1,
      inst: (institution?.institution_code || "").trim() || undefined,
      year: academicYear || undefined,
      class_id: classInfo.id,
      from: period.from,
      to: period.to,
      student_id: item.student_id,
      matricule: item.matricule || undefined,
    };
    return JSON.stringify(payload);
  }, [
    item.qr_url,
    institution?.institution_code,
    academicYear,
    classInfo.id,
    period.from,
    period.to,
    item.student_id,
    item.matricule,
  ]);

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = await generateQrDataUrl(qrText, QR_SIZE);
      if (!cancelled) setQrDataUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [qrText]);

  const qrImgSrc = item.qr_png || qrDataUrl;

  const totalTableRows = useMemo(() => {
    const subjectRows = subjectsForTable.reduce((acc, s) => {
      const comps = subjectCompsBySubject.get(s.subject_id) ?? [];
      return acc + 1 + comps.length;
    }, 0);

    let groupTotalRows = 0;
    const hasGroups = subjectGroups && subjectGroups.length > 0;
    if (hasGroups) {
      subjectGroups.forEach((g) => {
        if (!g.is_active) return;
        const groupSubjects: BulletinSubject[] = [];
        g.items.forEach((it) => {
          const subj = subjectsById.get(it.subject_id);
          if (subj) groupSubjects.push(subj);
        });

        const groupIsAutres = isAutresGroup(g);
        if (
          groupIsAutres &&
          conductSubject &&
          conductNoteOn20 !== null &&
          !groupSubjects.some((s) => s.subject_id === conductSubject.subject_id)
        ) {
          groupSubjects.push(conductSubject);
        }

        if (groupSubjects.length > 0) groupTotalRows += 1;
      });
    }

    const totalsRow = 1;
    return subjectRows + groupTotalRows + totalsRow;
  }, [
    subjectsForTable,
    subjectCompsBySubject,
    subjectGroups,
    subjectsById,
    conductSubject,
    conductNoteOn20,
  ]);

  const sigBoxHeightPx = useMemo(() => {
    if (totalTableRows <= 14) return 26;
    if (totalTableRows <= 18) return 24;
    if (totalTableRows <= 22) return 22;
    if (totalTableRows <= 26) return 20;
    if (totalTableRows <= 30) return 18;
    return 16;
  }, [totalTableRows]);

  const renderSignatureLine = (signaturePng?: string | null) => {
    return (
      <div className="sig-box">
        <div className="sig-ink">
          {signaturePng ? (
            <SignatureInk src={signaturePng} className="sig-ink-img" />
          ) : null}
        </div>
        <div className="sig-line" />
      </div>
    );
  };

  const renderSubjectBlock = (s: BulletinSubject) => {
    const cell = perSubject.find((ps) => ps.subject_id === s.subject_id);
    const avg = cell?.avg20 ?? null;
    const hasAvg = avg !== null && avg !== undefined && Number.isFinite(Number(avg));

    const excludedFromTermAverage = s.is_conduct_component_only === true;

    const effectiveCoeff =
      effectiveCoeffBySubjectId.get(s.subject_id) ??
      (s.subject_id === conductSubject?.subject_id
        ? 1
        : Number(s.coeff_bulletin ?? 0));

    const moyCoeff =
      hasAvg && Number.isFinite(effectiveCoeff)
        ? round2(Number(avg) * effectiveCoeff)
        : null;

    const subjectRankLabel =
      hasAvg && cell && cell.subject_rank != null ? `${cell.subject_rank}e` : "NC";
    const subjectTeacher = cell?.teacher_name || "";
    const appreciationLabel = hasAvg ? computeSubjectAppreciation(avg) : "Non classé";

    const signaturePng =
      signaturesActive && cell && (cell as any).teacher_signature_png
        ? String((cell as any).teacher_signature_png)
        : null;

    const subComps = subjectCompsBySubject.get(s.subject_id) ?? [];

    const specialRowClass = excludedFromTermAverage
      ? "bg-slate-50 text-slate-700 italic"
      : "";

    return (
      <React.Fragment key={s.subject_id}>
        <tr className={specialRowClass}>
          <td className="bdr px-1 py-[1px]">
            <span className={excludedFromTermAverage ? "font-semibold italic" : undefined}>
              {s.subject_name}
            </span>
          </td>
          <td className="bdr px-1 py-[1px] text-center">
            {hasAvg ? formatNumber(avg) : "NC"}
          </td>
          <td className="bdr px-1 py-[1px] text-center">
            {excludedFromTermAverage ? "—" : formatNumber(effectiveCoeff, 0)}
          </td>
          <td className="bdr px-1 py-[1px] text-center">
            {excludedFromTermAverage ? "—" : hasAvg ? formatNumber(moyCoeff) : "—"}
          </td>
          <td className="bdr px-1 py-[1px] text-center">{subjectRankLabel}</td>
          <td className="bdr px-1 py-[1px]">{appreciationLabel}</td>
          <td className="bdr px-1 py-[1px]">{subjectTeacher}</td>
          <td className="bdr p-0 align-middle sig-cell">
            {renderSignatureLine(signaturePng)}
          </td>
        </tr>

        {subComps.map((comp) => {
          const key = `${s.subject_id}__${comp.id}`;
          const compCell = perSubjectComponentMap.get(key);
          const cAvg = compCell?.avg20 ?? null;
          const cHasAvg = cAvg !== null && cAvg !== undefined && Number.isFinite(Number(cAvg));
          const cRank = compCell?.component_rank ?? null;
          const cMoyCoeff =
            cHasAvg
              ? round2(Number(cAvg) * (comp.coeff_in_subject || 0))
              : null;

          return (
            <tr
              key={`${s.subject_id}-${comp.id}`}
              className="text-[9.5px] text-slate-700"
            >
              <td className="bdr px-1 py-[1px] pl-4">
                {comp.short_label || comp.label}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {cHasAvg ? formatNumber(cAvg) : "NC"}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {formatNumber(comp.coeff_in_subject, 0)}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {cHasAvg ? formatNumber(cMoyCoeff) : "—"}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {cHasAvg && cRank != null ? `${cRank}e` : "NC"}
              </td>
              <td className="bdr px-1 py-[1px]" />
              <td className="bdr px-1 py-[1px]">{subjectTeacher}</td>
              <td className="bdr p-0 align-middle sig-cell">
                {renderSignatureLine(signaturePng)}
              </td>
            </tr>
          );
        })}
      </React.Fragment>
    );
  };

  const groupedSubjectIds = new Set<string>();
  const hasGroups = subjectGroups && subjectGroups.length > 0;

  const countryName = safeUpper(
    String((institution?.country_name || "RÉPUBLIQUE DE CÔTE D'IVOIRE").trim())
  );
  const countryMotto = String(
    (institution?.country_motto || "Union - Discipline - Travail").trim()
  );
  const ministryName = safeUpper(
    String(
      (institution?.ministry_name || "MINISTÈRE DE L'ÉDUCATION NATIONALE").trim()
    )
  );
  const headVisaLabel = getHeadVisaLabel(institution);

  return (
    <div
      ref={pageRef}
      className="print-page print-break bulletin-sheet relative mx-auto overflow-hidden bg-white text-black"
      style={{
        ["--sig-box-h" as any]: `${sigBoxHeightPx}px`,
        ["--print-fit-scale" as any]: String(printFitScale),
      }}
    >
      <div ref={contentRef} className="print-page-content bulletin-content relative flex flex-col text-black">
      {institution?.institution_logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={String(institution.institution_logo_url)}
          alt=""
          aria-hidden="true"
          className="bulletin-watermark"
        />
      ) : null}

      {item.official_print_kind === "duplicate" ? (
        <div
          aria-hidden="true"
          className="bulletin-duplicata-watermark"
        >
          DUPLICATA
        </div>
      ) : null}

      {!item.official_print_kind ? (
        <div className="bulletin-unissued-print-warning mb-1 rounded-md border-2 border-amber-700 bg-white px-3 py-1 text-center text-[10px] font-black uppercase tracking-[0.14em] text-amber-800">
          APERÇU — BULLETIN NON ÉMIS — UTILISER LE BOUTON IMPRIMER
        </div>
      ) : item.official_print_kind === "offline_copy" ? (
        <div className="mb-1 rounded-md border-2 border-amber-700 bg-white px-3 py-1 text-center text-[10px] font-black uppercase tracking-[0.14em] text-amber-800">
          COPIE HORS CONNEXION — ÉMISSION NON ENREGISTRÉE
        </div>
      ) : null}

      {/* ENTÊTE OFFICIEL */}
      <div className="bdr bulletin-header mb-1 p-1">
        <div className="grid grid-cols-3 items-start gap-2">
          <div className="official-block text-center text-[10px] leading-tight">
            <div className="font-semibold uppercase">{countryName}</div>
            <div className="text-[9px]">{countryMotto}</div>
            <div className="mt-1 text-[9px] font-semibold uppercase">
              {ministryName}
            </div>
            <div className="mt-1 text-[9px] uppercase">
              {String((institution?.institution_region || "").trim())}
            </div>
          </div>

          <div className="text-center">
            <div className="official-title text-[13px] font-bold uppercase leading-tight">
              BULLETIN TRIMESTRIEL DE NOTES
            </div>
            <div className="official-subtitle text-[11px] font-semibold">{periodTitle(period)}</div>
            {item.official_document_number ? (
              <div className="mt-[2px] text-[8px] font-semibold uppercase tracking-wide text-slate-600">
                Réf. {item.official_document_number}
              </div>
            ) : null}
          </div>

          <div className="relative flex justify-end gap-2">
            <div className="official-block text-right text-[10px] leading-tight mr-[118px]">
              <div>Année scolaire</div>
              <div className="font-semibold">{academicYear || "—"}</div>
              {institution?.institution_code && (
                <div className="mt-1 text-[9px]">
                  Code :{" "}
                  <span className="font-semibold">
                    {String(institution.institution_code)}
                  </span>
                </div>
              )}
              {(period.from || period.to) && (
                <div className="mt-1 text-[9px]">
                  {period.from ? formatDateFR(period.from) : "—"} →{" "}
                  {period.to ? formatDateFR(period.to) : "—"}
                </div>
              )}
            </div>

            <div className="bdr qr-box absolute right-0 top-0 z-10 flex h-[110px] w-[110px] items-center justify-center overflow-hidden bg-white">
              {qrImgSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrImgSrc}
                  alt="QR"
                  className="h-[104px] w-[104px] object-contain"
                />
              ) : (
                <div className="text-[9px] text-slate-500">QR</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-[2px] grid grid-cols-[110px_1fr_110px] items-start gap-2">
          <div className="school-logo-box flex h-[110px] w-[110px] items-center justify-center overflow-hidden bg-white p-1">
            {institution?.institution_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={String(institution.institution_logo_url)}
                alt="Logo"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="text-[9px] text-slate-500">Logo</div>
            )}
          </div>

          <div className="text-center">
            <div className="institution-title text-[15px] font-bold uppercase leading-tight">
              {safeUpper(
                String((institution?.institution_name || "ÉTABLISSEMENT").trim())
              )}
            </div>
            <div className="institution-info text-[10px]">
              {String(institution?.institution_postal_address || "")}
              {institution?.institution_phone
                ? ` • Tél : ${institution.institution_phone}`
                : ""}
              {institution?.institution_status
                ? ` • ${institution.institution_status}`
                : ""}
            </div>
          </div>

          <div className="h-[110px] w-[110px]" />
        </div>
      </div>

      {/* IDENTITÉ ÉLÈVE */}
      <div className="bdr student-identity mb-1 p-1">
        <div className="grid grid-cols-[1fr_1fr_1fr_86px] gap-2 text-[10px] leading-tight">
          <div className="space-y-[2px]">
            <div>
              <span className="font-semibold">Nom & prénom(s) : </span>
              <span className="font-bold uppercase">{item.full_name}</span>
            </div>
            <div>
              <span className="font-semibold">Matricule : </span>
              <span>{item.matricule || "—"}</span>
            </div>
            <div>
              <span className="font-semibold">Classe : </span>
              <span>{classInfo.label}</span>
            </div>
            <div>
              <span className="font-semibold">Effectif : </span>
              <span>{total}</span>
            </div>
          </div>

          <div className="space-y-[2px]">
            <div>
              <span className="font-semibold">Sexe : </span>
              <span>{sexLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Né(e) le : </span>
              <span>{birthdateLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Lieu de naissance : </span>
              <span>{birthPlaceLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Nationalité : </span>
              <span>{nationalityLabel}</span>
            </div>
          </div>

          <div className="space-y-[2px]">
            <div>
              <span className="font-semibold">Régime : </span>
              <span>{regimeLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Internat : </span>
              <span>{boarderLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Redoublant(e) : </span>
              <span>{repeaterLabel}</span>
            </div>
            <div>
              <span className="font-semibold">Affecté(e) : </span>
              <span>{assignedLabel}</span>
            </div>
          </div>

          <div className="bdr student-photo-box flex h-[96px] w-[86px] items-center justify-center overflow-hidden">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt="Photo élève"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="text-center text-[9px] text-slate-500">Photo</div>
            )}
          </div>
        </div>
      </div>

      {/* TABLEAU DISCIPLINES */}
      <table className="bdr discipline-table w-full text-[10px] leading-tight">
        <thead>
          <tr className="discipline-head">
            <th className="bdr px-1 py-[2px] text-left">DISCIPLINES</th>
            <th className="bdr px-1 py-[2px] text-center">Moy.</th>
            <th className="bdr px-1 py-[2px] text-center">Coef.</th>
            <th className="bdr px-1 py-[2px] text-center">Total</th>
            <th className="bdr px-1 py-[2px] text-center">Rang</th>
            <th className="bdr px-1 py-[2px] text-left">Appréciations</th>
            <th className="bdr px-1 py-[2px] text-left">Professeurs</th>
            <th className="bdr px-1 py-[2px] text-center sig-head">Signature</th>
          </tr>
        </thead>

        <tbody>
          {hasGroups ? (
            <>
              {subjectGroups.map((g) => {
                if (!g.is_active) return null;

                const groupSubjects: BulletinSubject[] = [];
                g.items.forEach((it) => {
                  const subj = subjectsById.get(it.subject_id);
                  if (subj) {
                    groupSubjects.push(subj);
                    groupedSubjectIds.add(subj.subject_id);
                  }
                });

                const groupIsAutres = isAutresGroup(g);

                if (
                  groupIsAutres &&
                  conductSubject &&
                  conductNoteOn20 !== null &&
                  !groupSubjects.some(
                    (s) => s.subject_id === conductSubject.subject_id
                  )
                ) {
                  groupSubjects.push(conductSubject);
                  groupedSubjectIds.add(conductSubject.subject_id);
                }

                if (!groupSubjects.length) return null;

                const baseGroupInfo = perGroupMap.get(g.id);
                const {
                  groupAvg,
                  groupCoeff,
                  groupTotal,
                } = computeDisplayedGroupStats(groupSubjects);

                const groupRankLabel =
                  baseGroupInfo?.group_rank != null
                    ? `${baseGroupInfo.group_rank}e`
                    : "—";

                const bilanLabel = (g.label || g.code || "BILAN").toUpperCase();

                return [
                  ...groupSubjects.map((s) => renderSubjectBlock(s)),
                  <tr key={`group-${g.id}`} className="group-total-row font-bold">
                    <td className="bdr px-1 py-[1px]">{bilanLabel}</td>
                    <td className="bdr px-1 py-[1px] text-center">
                      {formatNumber(groupAvg)}
                    </td>
                    <td className="bdr px-1 py-[1px] text-center">
                      {groupCoeff ? formatNumber(groupCoeff, 0) : ""}
                    </td>
                    <td className="bdr px-1 py-[1px] text-center">
                      {groupCoeff ? formatNumber(groupTotal) : ""}
                    </td>
                    <td className="bdr px-1 py-[1px] text-center">
                      {groupRankLabel}
                    </td>
                    <td className="bdr px-1 py-[1px]" />
                    <td className="bdr px-1 py-[1px]" />
                    <td className="bdr p-0 align-middle sig-cell">
                      {renderSignatureLine()}
                    </td>
                  </tr>,
                ];
              })}

              {subjectsForTable
                .filter((s) => !groupedSubjectIds.has(s.subject_id))
                .map((s) => renderSubjectBlock(s))}
            </>
          ) : (
            subjectsForTable.map((s) => renderSubjectBlock(s))
          )}

          <tr className="totals-row font-bold">
            <td className="bdr px-1 py-[1px] text-right">TOTAUX :</td>
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px] text-center">
              {formatNumber(coeffTotal, 0)}
            </td>
            <td className="bdr px-1 py-[1px] text-center">
              {moyCoeffTotal !== null ? formatNumber(moyCoeffTotal) : "—"}
            </td>
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px]" />
          </tr>
        </tbody>
      </table>

      {/* BLOCS BAS */}
      <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] leading-tight">
        <div className="bdr bottom-card p-1">
          <div className="bottom-card-title font-semibold text-center">Discipline générale</div>
          {conduct ? (
            <div className="mt-[2px] space-y-[2px]">
              <div>
                Absences :{" "}
                <span className="font-semibold">{conduct.absence_count ?? 0}</span>
              </div>
              <div>
                Retards :{" "}
                <span className="font-semibold">{conduct.tardy_count ?? 0}</span>
              </div>
              {conductRubricMax && conduct?.breakdown && (
                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-[2px] text-[9px] text-slate-700">
                  <div>
                    Assiduité : {conduct.breakdown.assiduite} /{" "}
                    {conductRubricMax.assiduite}
                  </div>
                  <div>
                    Tenue : {conduct.breakdown.tenue} / {conductRubricMax.tenue}
                  </div>
                  <div>
                    Moralité : {conduct.breakdown.moralite} /{" "}
                    {conductRubricMax.moralite}
                  </div>
                  <div>
                    Discipline : {conduct.breakdown.discipline} /{" "}
                    {conductRubricMax.discipline}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-[2px] text-[9px] text-slate-600">
              Données de conduite indisponibles.
            </div>
          )}
        </div>

        {/* ✅ Bloc moyennes : ajoute l’annuel quand disponible (dernière période) */}
        {showAnnual ? (
          <div className="bdr bottom-card average-card p-1 text-center">
            <div className="bottom-card-title font-semibold">Moyennes</div>
            <div className="mt-[3px] grid grid-cols-2 gap-2">
              <div>
                <div className="text-[9px] font-semibold uppercase">Trimestre</div>
                <div className="mt-[2px] text-[11px] font-bold">
                  {formatNumberOrNCWithMarker(
                    item.general_avg,
                    showGeneralIncompleteMarker
                  )} / 20
                </div>
                <div className="mt-[1px] text-[9px]">
                  Rang :{" "}
                  <span className="font-semibold">
                    {generalAvgHasValue ? formatRankOrNC(item.rank) : "NC"}
                  </span>{" "}
                  / {total}
                </div>
              </div>

              <div>
                <div className="text-[9px] font-semibold uppercase">Annuel</div>
                <div className="mt-[2px] text-[11px] font-bold">
                  {formatNumberOrNCWithMarker(
                    annualAvgOn20,
                    showAnnualIncompleteMarker
                  )} / 20
                </div>
                <div className="mt-[1px] text-[9px]">
                  Rang :{" "}
                  <span className="font-semibold">
                    {annualAvgHasValue ? formatRankOrNC(annualRank) : "NC"}
                  </span>{" "}
                  / {total}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bdr bottom-card average-card p-1 text-center">
            <div className="bottom-card-title font-semibold">Moyenne trimestrielle</div>
            <div className="mt-[3px] text-[11px] font-bold">
              Moyenne trimestrielle :{" "}
              {formatNumberOrNCWithMarker(
                item.general_avg,
                showGeneralIncompleteMarker
              )} / 20
            </div>
            <div className="mt-[2px]">
              Rang :{" "}
              <span className="font-semibold">
                {generalAvgHasValue ? formatRankOrNC(item.rank) : "NC"}
              </span>{" "}
              / {total}
            </div>
          </div>
        )}

        <div className="bdr bottom-card p-1 text-center">
          <div className="bottom-card-title font-semibold">Résultats de la classe</div>
          <div className="mt-[2px] space-y-[2px]">
            <div>Moyenne générale : {formatNumber(stats.classAvg)}</div>
            <div>Moyenne maxi : {formatNumber(stats.highest)}</div>
            <div>Moyenne mini : {formatNumber(stats.lowest)}</div>
          </div>
        </div>
      </div>

      <div className="mt-1 grid grid-cols-2 items-stretch gap-2 text-[10px] leading-tight">
        <div className="flex flex-col gap-1">
          <div
            className={[
              "grid items-stretch gap-1",
              showPreviousPeriodAverages ? "grid-cols-[1.45fr_0.92fr]" : "grid-cols-1",
            ].join(" ")}
          >
            <div className="bdr council-card flex-1 p-1">
              <div className="bottom-card-title font-semibold uppercase text-center">
                Mentions du conseil de classe
              </div>

              <div className="mentions-grid mt-[2px] grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[9px] font-semibold">DISTINCTIONS</div>
                  <div className="mt-[2px] space-y-[2px] text-[9px]">
                    <div className="flex items-center">
                      {tick(mentions.distinction === "excellence")}
                      <span>TH + Excellence</span>
                    </div>
                    <div className="flex items-center">
                      {tick(mentions.distinction === "honour")}
                      <span>TH + Félicitations</span>
                    </div>
                    <div className="flex items-center">
                      {tick(mentions.distinction === "encouragement")}
                      <span>TH + Encouragement</span>
                    </div>
                  </div>
                </div>

                <div className="mentions-sanctions border-l border-slate-300 pl-2">
                  <div className="text-[9px] font-semibold">SANCTIONS</div>
                  <div className="mt-[2px] space-y-[2px] text-[9px]">
                    <div className="flex items-center">
                      {tick(mentions.sanction === "warningWork")}
                      <span>Avertissement travail</span>
                    </div>
                    <div className="flex items-center">
                      {tick(mentions.sanction === "warningConduct")}
                      <span>Avertissement conduite</span>
                    </div>
                    <div className="flex items-center">
                      {tick(mentions.sanction === "blameWork")}
                      <span>Blâme travail</span>
                    </div>
                    <div className="flex items-center">
                      {tick(mentions.sanction === "blameConduct")}
                      <span>Blâme conduite</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {showPreviousPeriodAverages && (
              <div className="bdr council-card p-1">
                <div className="bottom-card-title font-semibold uppercase text-center">
                  Rappel moyennes
                </div>
                <div className="mt-[3px] space-y-[4px] text-[9px] leading-tight">
                  {previousPeriodAverages.map((row, idx) => {
                    const label = formatReminderPeriodLabel(row, idx);
                    const avgLabel = hasNumericValue(row.avg20)
                      ? `${formatNumber(row.avg20)} / 20`
                      : "NC";
                    const rankLabel = formatReminderRank(row.rank, total);

                    return (
                      <div
                        key={`${row.from || idx}-${row.to || idx}`}
                        className="bdr bg-white px-[5px] py-[4px]"
                      >
                        <div className="font-semibold uppercase text-[8.5px] tracking-[0.02em]">
                          {label}
                        </div>
                        <div className="mt-[2px] flex items-center justify-between gap-2">
                          <span>Moyenne</span>
                          <span className="font-bold">{avgLabel}</span>
                        </div>
                        <div className="mt-[1px] flex items-center justify-between gap-2">
                          <span>Rang</span>
                          <span className="font-semibold">{rankLabel}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div
            className={[
              "bdr visa-card grid min-h-[78px] overflow-hidden p-0",
              showEndOfYearDecision ? "grid-cols-2" : "grid-cols-1",
            ].join(" ")}
          >
            <div className="flex min-h-[78px] flex-col justify-between p-1">
              <div className="font-semibold text-[9px]">Visa du professeur principal</div>
              <div className="h-[50px]" />
              {classInfo.head_teacher?.display_name && (
                <div className="text-center text-[9px]">
                  {classInfo.head_teacher.display_name}
                </div>
              )}
            </div>

            {showEndOfYearDecision && (
              <div className="flex min-h-[78px] flex-col border-l border-black p-1 text-center">
                <div className="text-[8px] font-bold uppercase leading-tight">
                  Décision de fin d’année
                </div>
                <div className="flex flex-1 items-center justify-center">
                  <div className="text-[13px] font-extrabold uppercase tracking-wide text-red-700">
                    {endOfYearDecision}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <div className="bdr council-card p-1">
            <div className="bottom-card-title font-semibold uppercase text-center">
              Appréciations du conseil de classe
            </div>
            <div className="council-appreciation mt-1 flex h-[50px] items-center justify-center bg-white px-1 bdr">
              <div className="text-center text-[11px] font-bold leading-snug">
                {councilText || "\u00A0"}
              </div>
            </div>
          </div>

          <div className="bdr visa-card head-visa-card flex min-h-[128px] flex-1 flex-col justify-between p-1">
            <div className="font-semibold text-[9px]">{headVisaLabel}</div>
            <div className="flex-1" />
            {institution?.institution_head_name && (
              <div className="pb-1 text-center text-[9px]">
                {institution.institution_head_name}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bulletin-footer mt-1 pb-[2mm] text-center text-[9px] leading-tight text-black">
        <div className="font-bold tracking-[0.04em]">www.mon-cahier.com</div>
        <div className="font-semibold">Bulletin sécurisé par code QR</div>
      </div>
      </div>
    </div>
  );
}

/* ───────── Page principale ───────── */

function BulletinsPageContent() {
  const { isOnline } = useOnlineStatus();
  const searchParams = useSearchParams();
  const duplicateIssueId = String(searchParams.get("duplicata") || "").trim();
  const liveDuplicateMode = searchParams.get("duplicata_live") === "1";
  const liveDuplicateStudentId = String(searchParams.get("student_id") || "").trim();
  const liveDuplicateClassId = String(searchParams.get("class_id") || "").trim();
  const liveDuplicateAcademicYear = String(
    searchParams.get("academic_year") || "",
  ).trim();
  const liveDuplicatePeriodId = String(searchParams.get("period_id") || "").trim();
  const isDuplicateRequest = Boolean(duplicateIssueId || liveDuplicateMode);
  const liveDuplicateAutoLoadedRef = useRef(false);
  const [officialSnapshotOverrides, setOfficialSnapshotOverrides] = useState<
    Record<string, any>
  >({});
  const [printPreparing, setPrintPreparing] = useState(false);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);

  const [institution, setInstitution] = useState<InstitutionSettings | null>(null);
  const [institutionLoading, setInstitutionLoading] = useState(false);

  const [signaturesEnabled, setSignaturesEnabled] = useState<boolean | null>(null);
  const [signaturesToggling, setSignaturesToggling] = useState(false);

  const [selectedClassId, setSelectedClassId] = useState<string>(
    liveDuplicateClassId,
  );

  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>(
    liveDuplicateAcademicYear,
  );
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(
    liveDuplicatePeriodId,
  );

  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [bulletinRaw, setBulletinRaw] = useState<BulletinResponse | null>(null);
  const [bulletinLoading, setBulletinLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [conductSummary, setConductSummary] =
    useState<ConductSummaryResponse | null>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState<number>(1);

  const computePreviewZoom = () => {
    if (typeof window === "undefined") return 1;

    // ✅ on se cale sur la largeur "utile" (A4 - marges @page 4mm => 202mm)
    const A4_PX = (202 / 25.4) * 96;

    const vw = window.innerWidth || 0;
    const padding = vw < 768 ? 16 : 64;
    const avail = Math.max(240, vw - padding);
    const z = Math.min(1, avail / A4_PX);
    return Math.max(0.25, Number.isFinite(z) ? z : 1);
  };

  useEffect(() => {
    if (!previewOpen) return;
    const update = () => setPreviewZoom(computePreviewZoom());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [previewOpen]);

  useEffect(() => {
    if (!duplicateIssueId) return;

    let cancelled = false;
    const run = async () => {
      try {
        setBulletinLoading(true);
        setErrorMsg(null);
        const response = await fetch(
          `/api/admin/duplicata/${encodeURIComponent(duplicateIssueId)}`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Duplicata introuvable.");
        }
        if (payload.issue?.document_type !== "bulletin") {
          throw new Error("Ce document n’est pas un bulletin.");
        }

        const snapshot = payload.issue?.snapshot;
        const responseSnapshot = snapshot?.response as BulletinResponse | undefined;
        if (!snapshot || !responseSnapshot || !Array.isArray(responseSnapshot.items)) {
          throw new Error("L’instantané officiel du bulletin est incomplet.");
        }
        if (cancelled) return;

        const sourceId = String(payload.issue?.source_id || "").trim();
        setOfficialSnapshotOverrides(sourceId ? { [sourceId]: snapshot } : {});
        setBulletinRaw(responseSnapshot);
        setInstitution((snapshot.institution || null) as InstitutionSettings | null);
        setConductSummary((snapshot.conduct_summary || null) as ConductSummaryResponse | null);
        if (typeof snapshot.signatures_enabled === "boolean") {
          setSignaturesEnabled(snapshot.signatures_enabled);
        }
        setSelectedClassId(String(responseSnapshot.class?.id || ""));
        setSelectedAcademicYear(String(responseSnapshot.period?.academic_year || ""));
        setDateFrom(String(responseSnapshot.period?.from || ""));
        setDateTo(String(responseSnapshot.period?.to || ""));
        setPreviewOpen(true);
      } catch (error: any) {
        if (!cancelled) {
          setErrorMsg(error?.message || "Impossible de charger le duplicata.");
        }
      } finally {
        if (!cancelled) setBulletinLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [duplicateIssueId]);

  useEffect(() => {
    if (duplicateIssueId) return;
    const run = async () => {
      try {
        setClassesLoading(true);
        const json: any = await getAdminBulletinClasses();
        const items: ClassRow[] = Array.isArray(json)
          ? json
          : Array.isArray(json.items)
          ? json.items
          : [];
        setClasses(items);
        if (items.length > 0 && !selectedClassId) setSelectedClassId(items[0].id);
      } catch (e: any) {
        console.error(e);
        setErrorMsg(e.message || "Erreur lors du chargement des classes.");
      } finally {
        setClassesLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateIssueId]);

  useEffect(() => {
    if (duplicateIssueId || liveDuplicateMode) return;
    const cls = classes.find((c) => c.id === selectedClassId);
    if (cls?.academic_year) {
      setSelectedAcademicYear(cls.academic_year);
      setSelectedPeriodId("");
      setDateFrom("");
      setDateTo("");
    }
  }, [selectedClassId, classes, duplicateIssueId]);

  useEffect(() => {
    if (duplicateIssueId) return;
    const run = async () => {
      try {
        setInstitutionLoading(true);
        const json: any = await getAdminBulletinSettings();
        const inst = json as InstitutionSettings;
        setInstitution(inst);

        const sig =
          (inst as any)?.bulletin_signatures_enabled ??
          (inst as any)?.settings_json?.bulletin_signatures_enabled;

        if (typeof sig === "boolean") setSignaturesEnabled(sig);
      } catch (e) {
        console.error(e);
      } finally {
        setInstitutionLoading(false);
      }
    };
    run();
  }, [duplicateIssueId]);

  useEffect(() => {
    if (duplicateIssueId) return;
    const run = async () => {
      try {
        setPeriodsLoading(true);

        const json: any = await getAdminBulletinPeriods(selectedAcademicYear);
        const items: GradePeriod[] = Array.isArray(json)
          ? json
          : Array.isArray(json.items)
          ? json.items
          : [];
        setPeriods(items);
      } catch (e) {
        console.error("[Bulletins] erreur chargement periods", e);
        setPeriods([]);
      } finally {
        setPeriodsLoading(false);
      }
    };

    run();
  }, [selectedAcademicYear, duplicateIssueId]);

  const academicYears = useMemo(() => {
    const set = new Set<string>();
    classes.forEach((c) => c.academic_year && set.add(c.academic_year));
    periods.forEach((p) => p.academic_year && set.add(p.academic_year));
    return Array.from(set).sort();
  }, [classes, periods]);

  const filteredPeriods = useMemo(() => {
    if (!selectedAcademicYear) return periods;
    return periods.filter((p) => p.academic_year === selectedAcademicYear);
  }, [periods, selectedAcademicYear]);

  useEffect(() => {
    if (!selectedPeriodId) return;
    const p = periods.find((pp) => pp.id === selectedPeriodId);
    if (!p) return;
    setDateFrom(p.start_date || "");
    setDateTo(p.end_date || "");
  }, [selectedPeriodId, periods]);

  const handleLoadBulletin = async () => {
    setErrorMsg(null);

    if (!selectedClassId) {
      setErrorMsg("Veuillez sélectionner une classe.");
      return;
    }
    if (!dateFrom || !dateTo) {
      setErrorMsg("Veuillez choisir une période (dates du bulletin).");
      return;
    }

    try {
      setBulletinLoading(true);
      setConductSummary(null);

      const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

      const params = new URLSearchParams();
      params.set("class_id", selectedClassId);
      params.set("from", dateFrom);
      params.set("to", dateTo);

      /*
       * ✅ Important pour la conduite officielle :
       * l'API conduite utilise academic_year + period_code pour retrouver
       * une éventuelle moyenne finale modifiée par l'administration.
       *
       * On ne change pas la logique du bulletin : on enrichit seulement
       * l'appel conduite avec les informations de période déjà connues ici.
       */
      const effectiveAcademicYear =
        selectedAcademicYear || selectedPeriod?.academic_year || "";
      const effectivePeriodCode = selectedPeriod?.code || "";

      if (effectiveAcademicYear) {
        params.set("academic_year", effectiveAcademicYear);
      }
      if (effectivePeriodCode) {
        params.set("period_code", effectivePeriodCode);
      }
      if (liveDuplicateMode) {
        params.set("active_only", "false");
      }

      const [json, conductJson] = await Promise.all([
        getAdminBulletin<BulletinResponse>(params),
        getAdminBulletinConduct<ConductSummaryResponse>(params).catch(() => null),
      ]);
      if (!json.ok) throw new Error("Réponse bulletin invalide (ok = false).");
      if (
        liveDuplicateMode &&
        liveDuplicateStudentId &&
        !Array.isArray(json.items)
      ) {
        throw new Error("Le bulletin de cet élève est introuvable pour cette période.");
      }
      if (
        liveDuplicateMode &&
        liveDuplicateStudentId &&
        !json.items.some(
          (item: BulletinItemBase) => String(item.student_id || "") === liveDuplicateStudentId,
        )
      ) {
        throw new Error(
          "Cet élève n’était pas inscrit dans cette classe pendant la période sélectionnée.",
        );
      }

      const sigFromApi =
        (json as any)?.signatures &&
        typeof (json as any).signatures.enabled === "boolean"
          ? (json as any).signatures.enabled
          : null;
      if (sigFromApi !== null) setSignaturesEnabled(sigFromApi);

      // L’API bulletin lit déjà les décisions NC centralisées
      // depuis public.bulletin_nc_overrides.
      setBulletinRaw(json);

      if (conductJson && Array.isArray(conductJson.items))
        setConductSummary(conductJson);

      setPreviewOpen(true);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(
        e?.message || "Une erreur est survenue lors du chargement du bulletin."
      );
    } finally {
      setBulletinLoading(false);
    }
  };

  useEffect(() => {
    if (!liveDuplicateMode || liveDuplicateAutoLoadedRef.current) return;
    if (
      !liveDuplicateStudentId ||
      !selectedClassId ||
      !selectedAcademicYear ||
      !selectedPeriodId ||
      !dateFrom ||
      !dateTo ||
      periodsLoading
    ) {
      return;
    }

    liveDuplicateAutoLoadedRef.current = true;
    void handleLoadBulletin();
    // Les paramètres de l'URL identifient un seul duplicata. On ne relance
    // jamais automatiquement le chargement après la première tentative.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    liveDuplicateMode,
    liveDuplicateStudentId,
    selectedClassId,
    selectedAcademicYear,
    selectedPeriodId,
    dateFrom,
    dateTo,
    periodsLoading,
  ]);

  const handleToggleSignatures = async () => {
    try {
      setErrorMsg(null);
      if (!isOnline) {
        throw new Error(
          "Reconnectez Internet pour modifier le réglage des signatures. Les bulletins déjà préparés restent consultables."
        );
      }
      setSignaturesToggling(true);

      const current = !!signaturesEnabled;
      const next = !current;

      const res = await fetch("/api/admin/institution/bulletin-signatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(
          `Impossible de mettre à jour les signatures numérisées (${res.status}). ${
            txt || ""
          }`
        );
      }

      const json = await res.json().catch(() => null);
      const effective =
        json && typeof json.enabled === "boolean" ? json.enabled : next;

      setSignaturesEnabled(effective);
      setInstitution((prev) =>
        prev ? { ...prev, bulletin_signatures_enabled: effective } : prev
      );

      if (bulletinRaw && selectedClassId && dateFrom && dateTo) {
        await handleLoadBulletin();
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(
        e?.message ||
          "Une erreur est survenue lors de la mise à jour des signatures numérisées."
      );
    } finally {
      setSignaturesToggling(false);
    }
  };

  const enriched = useMemo(
    () => computeRanksAndStats(bulletinRaw),
    [bulletinRaw]
  );

  const conductByStudentId = useMemo(() => {
    const map = new Map<string, ConductItem>();
    if (!conductSummary || !Array.isArray(conductSummary.items)) return map;
    conductSummary.items.forEach((it) => map.set(it.student_id, it));
    return map;
  }, [conductSummary]);

  const conductRankByStudentId = useMemo(() => {
    const map = new Map<string, number>();
    const snapshotItems = Array.isArray(conductSummary?.items)
      ? conductSummary.items
      : [];
    for (const item of snapshotItems) {
      if (
        item.official_rank_snapshot !== null &&
        item.official_rank_snapshot !== undefined &&
        Number.isFinite(Number(item.official_rank_snapshot))
      ) {
        map.set(item.student_id, Number(item.official_rank_snapshot));
      }
    }
    if (map.size > 0) return map;

    const entries = Array.isArray(conductSummary?.items)
      ? conductSummary.items
          .map((it) => ({
            student_id: it.student_id,
            total: Number(it.total),
          }))
          .filter(
            (it) =>
              !!it.student_id &&
              Number.isFinite(it.total)
          )
      : [];

    entries.sort((a, b) => b.total - a.total);

    let lastScore: number | null = null;
    let currentRank = 0;

    entries.forEach((it, idx) => {
      if (lastScore === null || it.total !== lastScore) {
        currentRank = idx + 1;
        lastScore = it.total;
      }
      map.set(it.student_id, currentRank);
    });

    return map;
  }, [conductSummary]);

  const conductRubricMax = conductSummary?.rubric_max;
  const conductTotalMax = conductSummary?.total_max;

  const items = useMemo(() => {
    const arr = [...(enriched?.items ?? [])];

    const norm = (s: string) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

    // ✅ Tri par moyenne générale décroissante
    arr.sort((a, b) => {
      const avgA =
        a.general_avg !== null &&
        a.general_avg !== undefined &&
        Number.isFinite(Number(a.general_avg))
          ? Number(a.general_avg)
          : -Infinity;

      const avgB =
        b.general_avg !== null &&
        b.general_avg !== undefined &&
        Number.isFinite(Number(b.general_avg))
          ? Number(b.general_avg)
          : -Infinity;

      // 1) moyenne décroissante
      if (avgB !== avgA) return avgB - avgA;

      // 2) rang croissant si disponible
      const rankA =
        a.rank !== null &&
        a.rank !== undefined &&
        Number.isFinite(Number(a.rank))
          ? Number(a.rank)
          : Infinity;

      const rankB =
        b.rank !== null &&
        b.rank !== undefined &&
        Number.isFinite(Number(b.rank))
          ? Number(b.rank)
          : Infinity;

      if (rankA !== rankB) return rankA - rankB;

      // 3) nom alphabétique pour stabilité
      const an = norm(a.full_name);
      const bn = norm(b.full_name);
      const cmp = an.localeCompare(bn, "fr", { sensitivity: "base" });
      if (cmp !== 0) return cmp;

      // 4) matricule puis id
      const am = norm(a.matricule || "");
      const bm = norm(b.matricule || "");
      const cmp2 = am.localeCompare(bm, "fr", { sensitivity: "base" });
      if (cmp2 !== 0) return cmp2;

      return String(a.student_id).localeCompare(String(b.student_id));
    });

    if (liveDuplicateMode && liveDuplicateStudentId) {
      return arr.filter(
        (item) => String(item.student_id || "") === liveDuplicateStudentId,
      );
    }

    return arr;
  }, [enriched, liveDuplicateMode, liveDuplicateStudentId]);

  const stats = enriched?.stats ?? { highest: null, lowest: null, classAvg: null };
  const classInfo = enriched?.response.class;
  const period = enriched?.response.period ?? { from: null, to: null };
  const subjects = enriched?.response.subjects ?? [];
  const subjectComponents = enriched?.response.subject_components ?? [];
  const subjectGroups = enriched?.response.subject_groups ?? [];

  const displayTotal = Math.max(
    1,
    Number(
      enriched?.response.official_total_students ||
        enriched?.response.items?.length ||
        items.length ||
        1,
    ),
  );

  const handlePrint = async () => {
    if (!items.length || !enriched || !classInfo) return;
    if (typeof window === "undefined") return;

    const launchBrowserPrint = () => {
      window.dispatchEvent(new Event("bulletins:recalc-fit"));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.print();
        });
      });
    };

    if (!isOnline) {
      if (liveDuplicateMode) {
        const message =
          "Reconnectez Internet pour enregistrer et imprimer ce duplicata officiel.";
        setErrorMsg(message);
        window.alert(message);
        return;
      }
      const accepted = window.confirm(
        "Vous êtes hors connexion. Cette impression ne pourra pas être enregistrée comme original ou duplicata. Imprimer une copie hors connexion clairement marquée ?",
      );
      if (!accepted) return;
      setBulletinRaw((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => ({
                ...item,
                official_print_kind: "offline_copy",
                official_duplicate_number: null,
                official_printed_at: new Date().toISOString(),
              })),
            }
          : current,
      );
      window.setTimeout(launchBrowserPrint, 0);
      return;
    }

    const buildDocument = (item: BulletinItemWithRank) => {
      const sourceId = String(item.official_document_source_id || "").trim();
      const officialNumber = String(item.official_document_number || "").trim();
      if (!sourceId || !officialNumber) {
        throw new Error(
          `Le bulletin de ${item.full_name} ne possède pas encore de référence officielle. Rechargez les bulletins en ligne.`,
        );
      }

      const override = officialSnapshotOverrides[sourceId];
      let snapshot = override;

      if (!snapshot) {
        const {
          official_issue_id: _officialIssueId,
          official_print_kind: _officialPrintKind,
          official_duplicate_number: _officialDuplicateNumber,
          official_issued_at: _officialIssuedAt,
          official_printed_at: _officialPrintedAt,
          qr_png: _qrPng,
          ...snapshotItem
        } = item;

        const conductItem = conductByStudentId.get(item.student_id) || null;
        const conductRank = conductRankByStudentId.get(item.student_id) ?? null;

        snapshot = {
          schema_version: 1,
          response: {
            ...enriched.response,
            items: [snapshotItem],
            official_snapshot_locked: true,
            official_total_students: displayTotal,
            official_stats_snapshot: stats,
          },
          institution,
          conduct_summary: conductSummary
            ? {
                ...conductSummary,
                items: conductItem
                  ? [
                      {
                        ...conductItem,
                        official_rank_snapshot: conductRank,
                      },
                    ]
                  : [],
              }
            : null,
          signatures_enabled: signaturesEnabled === true,
        };
      }

      return {
        source_id: sourceId,
        official_number: officialNumber,
        beneficiary_id: item.student_id,
        beneficiary_name: item.full_name,
        academic_year: period.academic_year || classInfo.academic_year || null,
        class_id: classInfo.id,
        class_label: classInfo.label,
        period_key: [period.from || "", period.to || "", period.code || ""].join("|"),
        period_label: periodTitle(period),
        qr_code: item.qr_code || null,
        qr_token: item.qr_token || null,
        snapshot,
      };
    };

    const sendPrepareRequest = async (reason = "") => {
      const documents = items.map(buildDocument);
      const response = await fetch("/api/admin/duplicata/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          document_type: "bulletin",
          documents,
          reason,
          force_duplicate: liveDuplicateMode,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    };

    try {
      setPrintPreparing(true);
      setErrorMsg(null);
      const prepared = await sendPrepareRequest();

      if (!prepared.response.ok || !prepared.payload?.ok) {
        if (prepared.payload?.error === "official_bulletin_changed") {
          throw new Error(
            "Ce bulletin a été modifié depuis son émission. Pour tirer le duplicata de l’original, utilisez Duplicata > Bulletins.",
          );
        }
        throw new Error(
          prepared.payload?.error ||
            "Impossible d’enregistrer l’émission officielle des bulletins.",
        );
      }

      const metadataBySource = new Map<string, any>();
      for (const row of prepared.payload.items || []) {
        metadataBySource.set(String(row.source_id || ""), row);
      }

      setBulletinRaw((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => {
                const meta = metadataBySource.get(
                  String(item.official_document_source_id || ""),
                );
                if (!meta) return item;
                return {
                  ...item,
                  official_issue_id: meta.issue_id || null,
                  official_print_kind: meta.print_kind || null,
                  official_duplicate_number: meta.duplicate_number ?? null,
                  official_issued_at: meta.issued_at || null,
                  official_printed_at: meta.generated_at || null,
                };
              }),
            }
          : current,
      );

      window.setTimeout(launchBrowserPrint, 0);
    } catch (error: any) {
      const message =
        error?.message || "Une erreur est survenue avant l’impression officielle.";
      setErrorMsg(message);
      window.alert(message);
    } finally {
      setPrintPreparing(false);
    }
  };

  return (
    <>
      {/* Styles A4 */}
      <style jsx global>{`
        :root {
          --bulletin-navy: #0b2f57;
          --bulletin-navy-2: #123a63;
          --bulletin-navy-soft: #eef6fc;
          --bulletin-gold: #b7791f;
          --bulletin-gold-soft: #fff3d8;
          --bulletin-green: #0f766e;
          --bulletin-green-soft: #eefdf9;
          --bulletin-border: #1e293b;
          --bulletin-muted-border: #a8b6c8;
          --bulletin-text: #111827;
        }

        .bulletin-unissued-print-warning {
          display: none;
        }

        .bdr {
          border: 1px solid var(--bulletin-border);
        }

        .bulletin-sheet,
        .bulletin-content {
          color: var(--bulletin-text);
        }

        .bulletin-header {
          border: 1px solid var(--bulletin-muted-border);
          border-top: 5px solid var(--bulletin-navy);
          background: linear-gradient(180deg, #f6faff 0%, #ffffff 48%, #fffaf0 100%);
          box-shadow: inset 0 -1px 0 rgba(183, 121, 31, 0.35);
        }

        .official-block {
          color: var(--bulletin-text);
        }

        .official-title {
          display: inline-block;
          padding: 5px 18px 6px;
          color: #ffffff;
          background: var(--bulletin-navy);
          border: 1px solid var(--bulletin-navy);
          border-radius: 2px;
          letter-spacing: 0.035em;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
        }

        .official-subtitle {
          margin-top: 4px;
          color: var(--bulletin-navy);
          letter-spacing: 0.02em;
        }

        .institution-title {
          color: var(--bulletin-navy);
          letter-spacing: 0.025em;
        }

        .institution-title::after {
          content: "";
          display: block;
          width: 56mm;
          max-width: 78%;
          margin: 4px auto 3px;
          border-top: 2px solid var(--bulletin-gold);
        }

        .institution-info {
          color: #334155;
        }

        .qr-box {
          border-color: var(--bulletin-navy);
        }

        .school-logo-box {
          border: 0;
        }

        .student-identity {
          background: linear-gradient(90deg, var(--bulletin-navy-soft) 0%, #ffffff 100%);
          border-color: var(--bulletin-muted-border);
          border-left: 4px solid var(--bulletin-navy);
        }

        .student-identity .font-semibold {
          color: var(--bulletin-navy);
        }

        .student-photo-box {
          background: #ffffff;
          border-color: var(--bulletin-muted-border);
        }

        .discipline-table {
          border-color: var(--bulletin-border);
          border-collapse: collapse;
        }

        .discipline-table .discipline-head th {
          color: #ffffff;
          background: var(--bulletin-navy);
          border-color: #08243f;
          font-weight: 700;
          letter-spacing: 0.015em;
        }

        .discipline-table tbody tr:nth-child(even):not(.group-total-row):not(.totals-row) {
          background: #f8fbff;
        }

        .discipline-table tbody tr.group-total-row {
          background: #e7f1fb;
          color: var(--bulletin-navy);
          border-top: 1.5px solid var(--bulletin-navy-2);
          border-bottom: 1.5px solid var(--bulletin-navy-2);
        }

        .discipline-table tbody tr.totals-row {
          background: var(--bulletin-gold-soft);
          color: var(--bulletin-text);
          border-top: 2px solid var(--bulletin-gold);
          border-bottom: 2px solid var(--bulletin-gold);
        }

        .bottom-card,
        .council-card,
        .visa-card {
          background: #ffffff;
          border-color: var(--bulletin-muted-border);
        }

        .bottom-card,
        .council-card {
          box-shadow: inset 0 2px 0 rgba(11, 47, 87, 0.08);
        }

        .bottom-card-title {
          margin: -4px -4px 4px;
          padding: 2px 4px;
          color: #ffffff;
          background: var(--bulletin-navy);
          border-bottom: 1px solid var(--bulletin-navy);
          letter-spacing: 0.015em;
        }

        .average-card {
          background: var(--bulletin-green-soft);
          border-color: #5eead4;
          border-width: 1.5px;
        }

        .average-card .bottom-card-title {
          color: #ffffff;
          background: var(--bulletin-green);
          border-bottom-color: var(--bulletin-green);
        }

        .average-card .font-bold {
          color: #075e57;
        }

        .council-appreciation {
          border-color: var(--bulletin-muted-border);
          background: #ffffff;
        }

        .visa-card .font-semibold,
        .council-card .font-semibold:not(.bottom-card-title) {
          color: var(--bulletin-navy);
        }

        .head-visa-card {
          min-height: 132px;
        }

        .bulletin-footer {
          color: var(--bulletin-navy);
          border-top: 1.5px solid var(--bulletin-gold);
          padding-top: 3px;
          background: linear-gradient(180deg, #ffffff 0%, #fffaf0 100%);
        }

        .sig-img {
          display: block;
          background: transparent !important;
          opacity: 1 !important;
        }

        .sig-head,
        .sig-cell {
          width: 72px;
          min-width: 72px;
          max-width: 72px;
        }

        .sig-box {
          height: var(--sig-box-h, 22px);
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          overflow: hidden;
        }
        .sig-ink {
          height: calc(var(--sig-box-h, 22px) - 2px);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          overflow: hidden;
          line-height: 0;
        }
        .sig-box .sig-img {
          height: calc(var(--sig-box-h, 22px) - 2px) !important;
          max-height: calc(var(--sig-box-h, 22px) - 2px) !important;
          width: 100% !important;
          object-fit: contain !important;
        }
        .sig-line {
          width: 100%;
          border-top: 1px solid #000;
        }

        /* ✅ Base (hors aperçu) */
        .print-page {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          padding: 0;
          box-sizing: border-box;
          font-family: Arial, Helvetica, sans-serif;
          background: #fff;
        }

        .print-page-content {
          width: 100%;
          min-height: 297mm;
          padding: 8mm;
          box-sizing: border-box;
          transform-origin: top left;
        }

        .bulletin-watermark {
          position: absolute;
          inset: 0;
          z-index: 0;
          width: 165mm;
          height: 165mm;
          margin: auto;
          object-fit: contain;
          opacity: 0.08;
          pointer-events: none;
          user-select: none;
          filter: grayscale(100%) contrast(110%);
        }

        .bulletin-duplicata-watermark {
          position: absolute;
          inset: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          user-select: none;
          color: rgba(190, 24, 93, 0.18);
          font-size: 92px;
          font-weight: 1000;
          letter-spacing: 0.22em;
          transform: rotate(-24deg) scale(1.05);
        }

        .print-page-content > :not(.bulletin-watermark):not(.bulletin-duplicata-watermark) {
          position: relative;
          z-index: 1;
        }

        /* ✅ Aperçu : zone imprimable (A4 - marges @page 4mm => 202mm / 289mm) */
        .preview-overlay .print-page {
          width: 202mm;
          min-height: 289mm;
        }

        .preview-overlay .print-page-content {
          min-height: 289mm;
          padding: 2mm 6mm 4mm;
        }

        @supports (zoom: 1) {
          .preview-overlay .print-page {
            zoom: var(--preview-zoom, 1);
          }
        }

        @supports not (zoom: 1) {
          .preview-overlay .print-page {
            transform: scale(var(--preview-zoom, 1));
            transform-origin: top center;
          }
        }

        @media print {
          .bulletin-unissued-print-warning {
            display: block !important;
          }

          @page {
            size: A4 portrait;
            margin: 4mm;
          }

          html,
          body {
            width: auto !important;
            min-width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* ✅ Le portail d'impression devient le seul contenu imprimable :
             cela supprime la page blanche créée par le layout admin caché. */
          body > *:not(.bulletin-print-portal) {
            display: none !important;
          }

          .bulletin-print-portal,
          .bulletin-print-portal * {
            visibility: visible !important;
          }

          .bulletin-print-portal {
            display: block !important;
            position: static !important;
            inset: auto !important;
            width: 100% !important;
            min-height: 0 !important;
            overflow: visible !important;
            background: transparent !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          .preview-pages {
            display: block !important;
            gap: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          .preview-actions {
            display: none !important;
          }

          /* ✅ La page extérieure reste à taille fixe pour fiabiliser les sauts de page.
             Seul le contenu interne est réduit si nécessaire : plus de bas coupé. */
          .print-page {
            display: block !important;
            position: relative !important;
            width: 202mm !important;
            height: 289mm !important;
            min-height: 289mm !important;
            max-height: 289mm !important;
            padding: 0 !important;
            margin: 0 auto !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
            page-break-inside: avoid !important;
            break-inside: avoid-page !important;
            page-break-after: always !important;
            break-after: page !important;
            zoom: 1 !important;
            transform: none !important;
          }

          .print-page-content {
            width: calc(100% / var(--print-fit-scale, 1)) !important;
            min-height: auto !important;
            padding: 1.5mm 5mm 3.5mm !important;
            box-sizing: border-box !important;
            transform: scale(var(--print-fit-scale, 1)) !important;
            transform-origin: top left !important;
          }

          /* ✅ Lisibilité papier : règles limitées à l’impression du bulletin. */
          .bulletin-print-portal .discipline-table,
          .bulletin-print-portal .discipline-table tr,
          .bulletin-print-portal .discipline-table th,
          .bulletin-print-portal .discipline-table td {
            font-size: 10.4px !important;
            line-height: 1.12 !important;
          }

          .bulletin-print-portal .student-identity,
          .bulletin-print-portal .bottom-card,
          .bulletin-print-portal .council-card,
          .bulletin-print-portal .visa-card {
            font-size: 10.2px !important;
            line-height: 1.12 !important;
          }

          .bulletin-print-portal .official-block {
            font-size: 10.2px !important;
          }

          .bulletin-print-portal .official-title {
            font-size: 13.6px !important;
          }

          .bulletin-print-portal .official-subtitle {
            font-size: 11.4px !important;
          }

          .bulletin-print-portal .institution-title {
            font-size: 15.6px !important;
          }

          .bulletin-print-portal .institution-info,
          .bulletin-print-portal .bulletin-footer {
            font-size: 9.8px !important;
          }

          .print-break:last-of-type,
          .print-page:last-of-type {
            page-break-after: auto !important;
            break-after: auto !important;
          }

          .print\:hidden {
            display: none !important;
          }
        }
      `}</style>

      {previewOpen &&
      items.length > 0 &&
      enriched &&
      classInfo &&
      typeof document !== "undefined" ? (
        createPortal(
        <div
          className="preview-overlay bulletin-print-portal fixed inset-0 z-[60] overflow-y-auto bg-slate-200 p-2 md:p-6"
          style={{ ["--preview-zoom" as any]: previewZoom }}
        >
          <div className="preview-actions sticky top-2 z-10 mb-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setPreviewOpen(false)}
            >
              <X className="h-4 w-4" />
              Fermer
            </Button>

            {!isDuplicateRequest ? (
              <Button
                variant="ghost"
                type="button"
                onClick={handleLoadBulletin}
                disabled={bulletinLoading || !selectedClassId}
              >
                <RefreshCw className="h-4 w-4" />
                Recharger
              </Button>
            ) : null}

            <Button type="button" onClick={handlePrint} disabled={printPreparing}>
              <Printer className="h-4 w-4" />
              {printPreparing ? "Préparation…" : "Imprimer"}
            </Button>
          </div>

          <div className="preview-pages flex flex-col gap-6 pb-6">
            {items.map((it, idx) => (
              <StudentBulletinCard
                key={it.student_id}
                index={idx}
                total={displayTotal}
                item={it}
                subjects={subjects}
                subjectComponents={subjectComponents}
                subjectGroups={subjectGroups}
                classInfo={classInfo}
                period={period}
                institution={institution}
                stats={stats}
                conduct={conductByStudentId.get(it.student_id) || null}
                conductLabel={conductSummary?.conduct_label || null}
                conductTeacherName={conductSummary?.conduct_teacher_name || null}
                conductRank={conductRankByStudentId.get(it.student_id) ?? null}
                conductRubricMax={conductRubricMax}
                conductTotalMax={conductTotalMax}
                signaturesEnabled={signaturesEnabled}
                previewZoomForMeasure={previewZoom}
              />
            ))}
          </div>
        </div>,
        document.body
        )
      ) : (
        <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
          <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                Bulletins de notes
              </h1>
              <p className="text-sm text-slate-500">
                Charger une classe + période, puis ouvrir l’aperçu A4.
              </p>
              <p className={`mt-1 text-xs font-semibold ${isOnline ? "text-emerald-700" : "text-amber-700"}`}>
                {isOnline ? "En ligne" : "Hors connexion — bulletins préparés disponibles"}
              </p>
            </div>

            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <div className="flex items-center justify-end gap-2">
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
                  <span className="font-semibold">
                    Signatures enseignants numérisées :{" "}
                  </span>
                  <span
                    className={
                      signaturesEnabled ? "text-emerald-600" : "text-slate-500"
                    }
                  >
                    {signaturesEnabled === null
                      ? "Non configurées"
                      : signaturesEnabled
                      ? "Activées"
                      : "Désactivées"}
                  </span>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleToggleSignatures}
                  disabled={signaturesToggling || !isOnline}
                >
                  {signaturesToggling
                    ? "Mise à jour…"
                    : signaturesEnabled
                    ? "Désactiver"
                    : "Activer"}
                </Button>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleLoadBulletin}
                  disabled={bulletinLoading || !selectedClassId}
                >
                  <RefreshCw className="h-4 w-4" />
                  Recharger
                </Button>

                <Button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  disabled={!items.length}
                >
                  <Printer className="h-4 w-4" />
                  Aperçu / Imprimer
                </Button>
              </div>
            </div>
          </div>

          <OfflineSyncBar onMessage={setErrorMsg} />
          <OfflineReadinessCard role="admin" />

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden md:grid-cols-6">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Année scolaire
              </label>
              <Select
                value={selectedAcademicYear}
                onChange={(e) => {
                  const year = e.target.value;
                  setSelectedAcademicYear(year);
                  setSelectedPeriodId("");
                  setDateFrom("");
                  setDateTo("");
                }}
                disabled={periodsLoading || academicYears.length === 0}
              >
                <option value="">
                  {academicYears.length === 0 ? "Non configuré" : "Toutes années…"}
                </option>
                {academicYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[0.7rem] text-slate-500">
                Filtre les périodes. Si vous choisissez une période, les dates sont
                remplies automatiquement.
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Période (trimestre / séquence)
              </label>
              <Select
                value={selectedPeriodId}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                disabled={periodsLoading || filteredPeriods.length === 0}
              >
                <option value="">
                  {filteredPeriods.length === 0
                    ? "Aucune période"
                    : "Sélectionner une période…"}
                </option>
                {filteredPeriods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label ||
                      p.short_label ||
                      p.code ||
                      `${p.start_date} → ${p.end_date}`}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[0.7rem] text-slate-500">
                La période positionne automatiquement les dates.
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Classe
              </label>
              <Select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                disabled={classesLoading}
              >
                <option value="">Sélectionner une classe…</option>
                {classes.map((c) => {
                  const label = (c.name || c.label || "").trim();
                  return (
                    <option key={c.id} value={c.id}>
                      {label || "Classe"}
                      {c.level ? ` (${c.level})` : ""}
                    </option>
                  );
                })}
              </Select>
            </div>

            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Date de début
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="md:col-span-3">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Date de fin
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">
              {errorMsg}
            </div>
          )}

          {bulletinLoading && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 print:hidden">
              Chargement du bulletin…
            </div>
          )}

          {!items.length && !bulletinLoading && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600 print:hidden">
              Aucun bulletin à afficher. Choisissez une classe, une période puis
              cliquez sur <span className="font-semibold">Recharger</span>.
            </div>
          )}

          <div className="mt-2 text-center text-[0.7rem] text-slate-400 print:hidden">
            {institutionLoading ? "Chargement établissement…" : ""}
          </div>
        </div>
      )}
    </>
  );
}

export default function BulletinsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm font-semibold text-slate-600">
          Chargement des bulletins…
        </div>
      }
    >
      <BulletinsPageContent />
    </Suspense>
  );
}
