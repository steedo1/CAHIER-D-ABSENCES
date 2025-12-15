// src/app/admin/notes/bulletins/page.tsx
"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Printer, RefreshCw, X } from "lucide-react";

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

  // 🆕 option signatures électroniques
  bulletin_signatures_enabled?: boolean | null;

  // (compat éventuelle)
  settings_json?: any;
};

type BulletinSubject = {
  subject_id: string;
  subject_name: string;
  coeff_bulletin: number;
  include_in_average?: boolean;
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
  teacher_name?: string | null;

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

type BulletinItemBase = {
  student_id: string;
  full_name: string;
  matricule: string | null;

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

  // ✅ QR PNG généré côté serveur (PRIORITAIRE pour l’affichage)
  qr_png?: string | null;

  per_subject: PerSubjectAvg[];
  per_group: PerGroupAvg[];
  general_avg: number | null;
  per_subject_components?: PerSubjectComponentAvg[];
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
  };
  subjects: BulletinSubject[];
  subject_groups: BulletinGroup[];
  subject_components?: BulletinSubjectComponent[];
  items: BulletinItemBase[];

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
  appreciation: string;
  absence_count?: number;
  tardy_count?: number;
  absence_minutes?: number;
  tardy_minutes?: number;
};

type ConductSummaryResponse = {
  class_label: string;
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
  conductOn20: number | null | undefined
): CouncilMentions {
  let distinction: CouncilMentions["distinction"] = null;
  let sanction: CouncilMentions["sanction"] = null;

  if (
    generalAvg !== null &&
    generalAvg !== undefined &&
    Number.isFinite(generalAvg)
  ) {
    const g = Number(generalAvg);
    if (g >= 16) distinction = "excellence";
    else if (g >= 14) distinction = "honour";
    else if (g >= 12) distinction = "encouragement";
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
    conductOn20 !== null && conductOn20 !== undefined
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDateFR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR");
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
  type Entry = { itemIndex: number; groupIndex: number; avg: number; groupId: string };
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

/* ───────── Ranks + stats (intègre CONDUITE coef 1) ───────── */

function computeRanksAndStats(
  res: BulletinResponse | null,
  conductSummary: ConductSummaryResponse | null
): EnrichedBulletin | null {
  if (!res) return null;

  const baseItems = res.items ?? [];

  const conductMap = new Map<string, number>();
  if (conductSummary && Array.isArray(conductSummary.items)) {
    conductSummary.items.forEach((it) => {
      if (!it.student_id) return;
      const note = clampTo20(it.total);
      if (note !== null) conductMap.set(it.student_id, note);
    });
  }

  const itemsWithAvg: BulletinItemWithRank[] = baseItems.map((it) => {
    const perSubject = it.per_subject ?? [];

    let sum = 0;
    let sumCoeff = 0;

    res.subjects.forEach((s) => {
      const cell = perSubject.find((ps) => ps.subject_id === s.subject_id);
      const val = cell?.avg20;
      if (val === null || val === undefined) return;
      const avg = Number(val);
      if (!Number.isFinite(avg)) return;

      if (s.include_in_average === false) return;

      const coeff = Number(s.coeff_bulletin ?? 0);
      if (!Number.isFinite(coeff) || coeff <= 0) return;

      sum += avg * coeff;
      sumCoeff += coeff;
    });

    let baseAvg: number | null = null;
    if (sumCoeff > 0) baseAvg = sum / sumCoeff;

    const conductNote = conductMap.get(it.student_id) ?? null;

    let finalAvg: number | null;
    if (conductNote !== null) {
      const totalSum = sum + conductNote * 1;
      const totalCoeff = sumCoeff + 1;
      finalAvg = totalCoeff > 0 ? totalSum / totalCoeff : it.general_avg ?? baseAvg;
    } else {
      finalAvg = baseAvg ?? it.general_avg ?? null;
    }

    const rounded =
      finalAvg !== null && Number.isFinite(finalAvg) ? round2(finalAvg) : null;

    return { ...it, general_avg: rounded, rank: null };
  });

  const withAvg = itemsWithAvg.filter(
    (it) => it.general_avg !== null && Number.isFinite(it.general_avg as number)
  );

  const stats: ClassStats = { highest: null, lowest: null, classAvg: null };

  if (!withAvg.length) {
    applyComponentRanksFront(itemsWithAvg);
    applyGroupRanksFront(itemsWithAvg);
    return { response: res, items: itemsWithAvg, stats };
  }

  const sorted = [...withAvg].sort(
    (a, b) => (b.general_avg ?? 0) - (a.general_avg ?? 0)
  );

  let lastScore: number | null = null;
  let lastRank = 0;
  const rankByStudent = new Map<string, number>();

  sorted.forEach((it, idx) => {
    const g = it.general_avg ?? 0;
    if (lastScore === null || g !== lastScore) {
      lastRank = idx + 1;
      lastScore = g;
    }
    rankByStudent.set(it.student_id, lastRank);
  });

  const sumAll = withAvg.reduce((acc, it) => acc + (it.general_avg ?? 0), 0);
  const highest = sorted[0].general_avg ?? null;
  const lowest = sorted[sorted.length - 1].general_avg ?? null;
  const classAvg = sumAll / withAvg.length;

  stats.highest = highest !== null ? round2(highest) : null;
  stats.lowest = lowest !== null ? round2(lowest) : null;
  stats.classAvg = round2(classAvg);

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

function safeUpper(s: string) {
  try {
    return s.toUpperCase();
  } catch {
    return s;
  }
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
  conductRubricMax,
  conductTotalMax,
  signaturesEnabled,
  previewZoomForMeasure,
}: StudentBulletinCardProps) {
  const signaturesActive = !!signaturesEnabled;

  /* ✅ FIT-TO-PAGE : si ça dépasse, on scale automatiquement à l’impression */
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [printFitScale, setPrintFitScale] = useState(1);

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

    // hauteur réelle du bloc (corrigée du zoom d’aperçu)
    const rect = el.getBoundingClientRect();
    const naturalH = rect.height / zoom;

    const cs = window.getComputedStyle(el);
    const minHPx = parseFloat(cs.minHeight || "0");

    if (!Number.isFinite(naturalH) || naturalH <= 0) return;
    if (!Number.isFinite(minHPx) || minHPx <= 0) {
      setScale(1);
      return;
    }

    // ✅ Si le bloc ne dépasse PAS la zone A4 utile → pas de scale
    if (naturalH <= minHPx + 0.5) {
      setScale(1);
      return;
    }

    // ✅ marge de sécurité anti-arrondis / imprimantes (sinon 1px peut créer une 2e page)
    const cushion = Math.max(10, Math.round(minHPx * 0.012)); // ~1.2% (≈ 13px sur A4 utile)
    const usable = Math.max(1, minHPx - cushion);

    // scale < 1 si dépasse
    const raw = Math.min(1, usable / naturalH);

    // ✅ garde une micro marge en plus
    const safe = Math.min(1, raw * 0.99);

    // ✅ plus de blocage à 0.82 (c’était la cause du débordement)
    // on autorise à descendre plus bas pour GARANTIR 1 page
    const clamped = Math.max(0.45, safe);

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

  const conductSubject: BulletinSubject | null =
    conductNoteOn20 !== null
      ? {
          subject_id: "__CONDUCT__",
          subject_name: "Conduite",
          coeff_bulletin: 1,
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
      } else {
        base.push({
          subject_id: conductSubject.subject_id,
          avg20: conductNoteOn20,
          subject_rank: null,
          teacher_name: "",
          teacher_signature_png: null,
        });
      }
    }
    return base;
  }, [perSubjectBase, conductSubject, conductNoteOn20]);

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

  const subjectsWithGrades = useMemo(() => {
    return allSubjects.filter((s) => {
      const cell = perSubject.find((ps) => ps.subject_id === s.subject_id);
      const val = cell?.avg20;
      return val !== null && val !== undefined && Number.isFinite(Number(val));
    });
  }, [allSubjects, perSubject]);

  const coeffTotal = useMemo(
    () =>
      subjectsWithGrades.reduce((acc, s) => {
        const c = Number(s.coeff_bulletin ?? 0);
        return acc + (Number.isFinite(c) ? c : 0);
      }, 0),
    [subjectsWithGrades]
  );

  const subjectsById = useMemo(() => {
    const m = new Map<string, BulletinSubject>();
    subjectsWithGrades.forEach((s) => m.set(s.subject_id, s));
    return m;
  }, [subjectsWithGrades]);

  const mentions = computeCouncilMentions(item.general_avg, conductNoteOn20);
  const councilText = computeCouncilAppreciationText(
    mentions,
    item.general_avg,
    conductNoteOn20
  );

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
    const subjectRows = subjectsWithGrades.reduce((acc, s) => {
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
    subjectsWithGrades,
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

    if (avg === null || avg === undefined || !Number.isFinite(Number(avg)))
      return null;

    const moyCoeff =
      avg !== null && Number.isFinite(Number(avg))
        ? round2(Number(avg) * (s.coeff_bulletin || 0))
        : null;

    const subjectRankLabel =
      cell && cell.subject_rank != null ? `${cell.subject_rank}e` : "—";
    const subjectTeacher = cell?.teacher_name || "";
    const appreciationLabel = computeSubjectAppreciation(avg);

    const signaturePng =
      signaturesActive && cell && (cell as any).teacher_signature_png
        ? String((cell as any).teacher_signature_png)
        : null;

    const subComps = subjectCompsBySubject.get(s.subject_id) ?? [];

    return (
      <React.Fragment key={s.subject_id}>
        <tr>
          <td className="bdr px-1 py-[1px]">{s.subject_name}</td>
          <td className="bdr px-1 py-[1px] text-center">{formatNumber(avg)}</td>
          <td className="bdr px-1 py-[1px] text-center">
            {formatNumber(s.coeff_bulletin, 0)}
          </td>
          <td className="bdr px-1 py-[1px] text-center">{formatNumber(moyCoeff)}</td>
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
          const cRank = compCell?.component_rank ?? null;
          const cMoyCoeff =
            cAvg !== null && Number.isFinite(Number(cAvg))
              ? round2(Number(cAvg) * (comp.coeff_in_subject || 0))
              : null;

          return (
            <tr
              key={`${s.subject_id}-${comp.id}`}
              className="text-[9px] text-slate-700"
            >
              <td className="bdr px-1 py-[1px] pl-4">
                {comp.short_label || comp.label}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {formatNumber(cAvg)}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {formatNumber(comp.coeff_in_subject, 0)}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {formatNumber(cMoyCoeff)}
              </td>
              <td className="bdr px-1 py-[1px] text-center">
                {cRank != null ? `${cRank}e` : "—"}
              </td>
              <td className="bdr px-1 py-[1px]" />
              <td className="bdr px-1 py-[1px]" />
              <td className="bdr px-1 py-[1px] sig-cell" />
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

  return (
    <div
      ref={pageRef}
      className="print-page print-break mx-auto flex flex-col bg-white text-black"
      style={{
        ["--sig-box-h" as any]: `${sigBoxHeightPx}px`,
        ["--print-fit-scale" as any]: String(printFitScale),
      }}
    >
      {/* ENTÊTE OFFICIEL */}
      <div className="bdr mb-1 p-1">
        <div className="grid grid-cols-3 items-start gap-2">
          <div className="text-center text-[9px] leading-tight">
            <div className="font-semibold uppercase">{countryName}</div>
            <div className="text-[8px]">{countryMotto}</div>
            <div className="mt-1 text-[8px] font-semibold uppercase">
              {ministryName}
            </div>
            <div className="mt-1 text-[8px] uppercase">
              {String((institution?.institution_region || "").trim())}
            </div>
          </div>

          <div className="text-center">
            <div className="text-[12px] font-bold uppercase leading-tight">
              BULLETIN TRIMESTRIEL DE NOTES
            </div>
            <div className="text-[10px] font-semibold">{periodTitle(period)}</div>
          </div>

          <div className="flex justify-end gap-2">
            <div className="text-right text-[9px] leading-tight">
              <div>Année scolaire</div>
              <div className="font-semibold">{academicYear || "—"}</div>
              {institution?.institution_code && (
                <div className="mt-1 text-[8px]">
                  Code :{" "}
                  <span className="font-semibold">
                    {String(institution.institution_code)}
                  </span>
                </div>
              )}
              {(period.from || period.to) && (
                <div className="mt-1 text-[8px]">
                  {period.from ? formatDateFR(period.from) : "—"} →{" "}
                  {period.to ? formatDateFR(period.to) : "—"}
                </div>
              )}
            </div>

            <div className="bdr flex h-[110px] w-[110px] items-center justify-center overflow-hidden bg-white">
              {qrImgSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrImgSrc}
                  alt="QR"
                  className="h-[104px] w-[104px] object-contain"
                />
              ) : (
                <div className="text-[8px] text-slate-500">QR</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-1 grid grid-cols-[110px_1fr_110px] items-center gap-2">
          <div className="bdr flex h-[110px] w-[110px] items-center justify-center overflow-hidden bg-white">
            {institution?.institution_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={String(institution.institution_logo_url)}
                alt="Logo"
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="text-[8px] text-slate-500">Logo</div>
            )}
          </div>

          <div className="text-center">
            <div className="text-[11px] font-bold uppercase">
              {safeUpper(
                String((institution?.institution_name || "ÉTABLISSEMENT").trim())
              )}
            </div>
            <div className="text-[9px]">
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
      <div className="bdr mb-1 p-1">
        <div className="grid grid-cols-[1fr_1fr_1fr_86px] gap-2 text-[9px] leading-tight">
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

          <div className="bdr flex h-[96px] w-[86px] items-center justify-center overflow-hidden">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt="Photo élève"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="text-center text-[8px] text-slate-500">Photo</div>
            )}
          </div>
        </div>
      </div>

      {/* TABLEAU DISCIPLINES */}
      <table className="bdr w-full text-[9px] leading-tight">
        <thead>
          <tr className="bg-slate-100">
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
                let groupAvg = baseGroupInfo?.group_avg ?? null;
                let groupCoeff = g.annual_coeff ?? 0;
                let groupTotal: number | null =
                  groupAvg !== null && groupCoeff
                    ? round2(groupAvg * groupCoeff)
                    : null;

                if (groupIsAutres) {
                  let sum = 0;
                  let sumCoeff = 0;

                  groupSubjects.forEach((s) => {
                    const cell = perSubject.find(
                      (ps) => ps.subject_id === s.subject_id
                    );
                    const val = cell?.avg20;
                    if (
                      val === null ||
                      val === undefined ||
                      !Number.isFinite(Number(val))
                    )
                      return;

                    const avg = Number(val);
                    const coeff =
                      s.subject_id === conductSubject?.subject_id
                        ? 1
                        : Number(s.coeff_bulletin ?? 0);

                    if (!Number.isFinite(coeff) || coeff <= 0) return;

                    sum += avg * coeff;
                    sumCoeff += coeff;
                  });

                  if (sumCoeff > 0) {
                    groupAvg = sum / sumCoeff;
                    groupCoeff = sumCoeff;
                    groupTotal = round2(groupAvg * groupCoeff);
                  }
                }

                const groupRankLabel =
                  baseGroupInfo?.group_rank != null
                    ? `${baseGroupInfo.group_rank}e`
                    : "—";

                const bilanLabel = (g.label || g.code || "BILAN").toUpperCase();

                return [
                  ...groupSubjects.map((s) => renderSubjectBlock(s)),
                  <tr key={`group-${g.id}`} className="bg-slate-50 font-bold">
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

              {subjectsWithGrades
                .filter((s) => !groupedSubjectIds.has(s.subject_id))
                .map((s) => renderSubjectBlock(s))}
            </>
          ) : (
            subjectsWithGrades.map((s) => renderSubjectBlock(s))
          )}

          <tr className="bg-slate-50 font-bold">
            <td className="bdr px-1 py-[1px] text-right">TOTAUX :</td>
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px] text-center">
              {formatNumber(coeffTotal, 0)}
            </td>
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px]" />
            <td className="bdr px-1 py-[1px]" />
          </tr>
        </tbody>
      </table>

      {/* BLOCS BAS */}
      <div className="mt-1 grid grid-cols-3 gap-2 text-[9px] leading-tight">
        <div className="bdr p-1">
          <div className="font-semibold text-center">Assiduité</div>
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
              <div className="pt-[2px]">
                Note de conduite :{" "}
                <span className="font-semibold">
                  {conductNoteOn20 !== null
                    ? `${formatNumber(conductNoteOn20)} / 20`
                    : "—"}
                </span>
              </div>

              {conductRubricMax && conduct?.breakdown && (
                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-[2px] text-[8px] text-slate-700">
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
            <div className="mt-[2px] text-[8px] text-slate-600">
              Données de conduite indisponibles.
            </div>
          )}
        </div>

        <div className="bdr p-1 text-center">
          <div className="font-semibold">Moyenne trimestrielle</div>
          <div className="mt-[3px] text-[10px] font-bold">
            {formatNumber(item.general_avg)} / 20
          </div>
          <div className="mt-[2px]">
            Rang :{" "}
            <span className="font-semibold">
              {item.rank ? `${item.rank}e` : "—"}
            </span>{" "}
            / {total}
          </div>
        </div>

        <div className="bdr p-1 text-center">
          <div className="font-semibold">Résultats de la classe</div>
          <div className="mt-[2px] space-y-[2px]">
            <div>Moyenne générale : {formatNumber(stats.classAvg)}</div>
            <div>Moyenne maxi : {formatNumber(stats.highest)}</div>
            <div>Moyenne mini : {formatNumber(stats.lowest)}</div>
          </div>
        </div>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-2 text-[9px] leading-tight">
        <div className="bdr p-1">
          <div className="font-semibold uppercase text-center">
            Mentions du conseil de classe
          </div>
          <div className="mt-[2px] text-[8px] font-semibold">DISTINCTIONS</div>
          <div className="mt-[2px] space-y-[2px] text-[8px]">
            <div className="flex items-center">
              {tick(mentions.distinction === "honour")}
              <span>Tableau d&apos;honneur / Félicitations</span>
            </div>
            <div className="flex items-center">
              {tick(mentions.distinction === "excellence")}
              <span>Tableau d&apos;excellence</span>
            </div>
            <div className="flex items-center">
              {tick(mentions.distinction === "encouragement")}
              <span>Tableau d&apos;encouragement</span>
            </div>
          </div>

          <div className="mt-2 text-[8px] font-semibold">SANCTIONS</div>
          <div className="mt-[2px] space-y-[2px] text-[8px]">
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

        <div className="bdr p-1">
          <div className="font-semibold uppercase text-center">
            Appréciations du conseil de classe
          </div>
          <div className="mt-2 flex h-[62px] items-center justify-center bg-white px-1 bdr">
            <div className="text-center text-[10px] font-bold leading-snug">
              {councilText || "\u00A0"}
            </div>
          </div>
        </div>
      </div>

      {/* VISAS (un peu plus compact pour gagner de la place) */}
      <div className="mt-1 grid grid-cols-2 gap-2 text-[9px] leading-tight">
        <div className="bdr flex flex-col justify-between p-1">
          <div className="font-semibold text-[8px]">Visa du professeur principal</div>
          <div className="h-[34px]" />
          {classInfo.head_teacher?.display_name && (
            <div className="text-center text-[8px]">
              {classInfo.head_teacher.display_name}
            </div>
          )}
        </div>

        <div className="bdr flex flex-col justify-between p-1">
          <div className="font-semibold text-[8px]">
            Visa du chef d&apos;établissement
          </div>
          <div className="h-[34px]" />
          {institution?.institution_head_name && (
            <div className="text-center text-[8px]">
              {institution.institution_head_name}
              {institution?.institution_head_title ? (
                <div className="text-[7px] text-slate-600">
                  {institution.institution_head_title}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="mt-1 text-center text-[8px] text-black">
        Conçu et développé par <span className="font-semibold">Nexa Digital SARL</span>
      </div>
    </div>
  );
}

/* ───────── Page principale ───────── */

export default function BulletinsPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);

  const [institution, setInstitution] = useState<InstitutionSettings | null>(null);
  const [institutionLoading, setInstitutionLoading] = useState(false);

  const [signaturesEnabled, setSignaturesEnabled] = useState<boolean | null>(null);
  const [signaturesToggling, setSignaturesToggling] = useState(false);

  const [selectedClassId, setSelectedClassId] = useState<string>("");

  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedAcademicYear, setSelectedAcademicYear] = useState<string>("");
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

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
    const run = async () => {
      try {
        setClassesLoading(true);
        const res = await fetch("/api/admin/classes");
        if (!res.ok) throw new Error(`Erreur classes: ${res.status}`);
        const json = await res.json();
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
  }, []);

  useEffect(() => {
    const cls = classes.find((c) => c.id === selectedClassId);
    if (cls?.academic_year) {
      setSelectedAcademicYear(cls.academic_year);
      setSelectedPeriodId("");
      setDateFrom("");
      setDateTo("");
    }
  }, [selectedClassId, classes]);

  useEffect(() => {
    const run = async () => {
      try {
        setInstitutionLoading(true);
        const res = await fetch("/api/admin/institution/settings");
        if (!res.ok) return;
        const json = await res.json();
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
  }, []);

  useEffect(() => {
    const run = async () => {
      try {
        setPeriodsLoading(true);

        const params = new URLSearchParams();
        if (selectedAcademicYear) params.set("academic_year", selectedAcademicYear);

        const qs = params.toString();
        const url = "/api/admin/institution/grading-periods" + (qs ? `?${qs}` : "");

        const res = await fetch(url);
        if (!res.ok) {
          console.warn("[Bulletins] grading-periods non disponible", res.status);
          setPeriods([]);
          return;
        }

        const json = await res.json();
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
  }, [selectedAcademicYear]);

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

      const params = new URLSearchParams();
      params.set("class_id", selectedClassId);
      params.set("from", dateFrom);
      params.set("to", dateTo);

      const [resBulletin, resConduct] = await Promise.all([
        fetch(`/api/admin/grades/bulletin?${params.toString()}`),
        fetch(`/api/admin/conduite/averages?${params.toString()}`),
      ]);

      if (!resBulletin.ok) {
        const txt = await resBulletin.text();
        throw new Error(
          `Erreur bulletin (${resBulletin.status}) : ${
            txt || "Impossible de générer le bulletin."
          }`
        );
      }

      const json = (await resBulletin.json()) as BulletinResponse;
      if (!json.ok) throw new Error("Réponse bulletin invalide (ok = false).");

      const sigFromApi =
        (json as any)?.signatures &&
        typeof (json as any).signatures.enabled === "boolean"
          ? (json as any).signatures.enabled
          : null;
      if (sigFromApi !== null) setSignaturesEnabled(sigFromApi);

      setBulletinRaw(json);

      if (resConduct.ok) {
        try {
          const conductJson = (await resConduct.json()) as ConductSummaryResponse;
          if (conductJson && Array.isArray(conductJson.items))
            setConductSummary(conductJson);
        } catch (err) {
          console.warn("[Bulletins] Impossible de lire le résumé de conduite", err);
        }
      } else {
        console.warn(
          "[Bulletins] /api/admin/conduite/averages a renvoyé",
          resConduct.status
        );
      }

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

  const handleToggleSignatures = async () => {
    try {
      setErrorMsg(null);
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
          `Impossible de mettre à jour les signatures électroniques (${res.status}). ${
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
          "Une erreur est survenue lors de la mise à jour des signatures électroniques."
      );
    } finally {
      setSignaturesToggling(false);
    }
  };

  const enriched = useMemo(
    () => computeRanksAndStats(bulletinRaw, conductSummary),
    [bulletinRaw, conductSummary]
  );

  const conductByStudentId = useMemo(() => {
    const map = new Map<string, ConductItem>();
    if (!conductSummary || !Array.isArray(conductSummary.items)) return map;
    conductSummary.items.forEach((it) => map.set(it.student_id, it));
    return map;
  }, [conductSummary]);

  const conductRubricMax = conductSummary?.rubric_max;
  const conductTotalMax = conductSummary?.total_max;

  const items = enriched?.items ?? [];
  const stats = enriched?.stats ?? { highest: null, lowest: null, classAvg: null };
  const classInfo = enriched?.response.class;
  const period = enriched?.response.period ?? { from: null, to: null };
  const subjects = enriched?.response.subjects ?? [];
  const subjectComponents = enriched?.response.subject_components ?? [];
  const subjectGroups = enriched?.response.subject_groups ?? [];

  const handlePrint = () => {
    if (!items.length) return;
    if (typeof window === "undefined") return;

    // ✅ force recalcul fit-to-page AVANT print (tous les bulletins)
    window.dispatchEvent(new Event("bulletins:recalc-fit"));

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  };

  return (
    <>
      {/* Styles A4 */}
      <style jsx global>{`
        .bdr {
          border: 1px solid #000;
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

          /* marge intérieure par défaut écran */
          padding: 8mm;

          box-sizing: border-box;
          font-family: Arial, Helvetica, sans-serif;
          background: #fff;
        }

        /* ✅ Aperçu : zone imprimable (A4 - marges @page 4mm => 202mm / 289mm) + MARGES GAUCHE/DROITE */
        .preview-overlay .print-page {
          width: 202mm;
          min-height: 289mm;

          /* ✅ marge intérieure visible (gauche/droite) sans casser la hauteur */
          padding: 2mm 6mm;
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
          @page {
            size: A4 portrait;
            margin: 4mm; /* ✅ conserve la place utile */
          }

          html,
          body {
            background: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          body * {
            visibility: hidden !important;
          }
          .preview-overlay,
          .preview-overlay * {
            visibility: visible !important;
          }

          .preview-overlay {
            position: static !important;
            inset: auto !important;
            overflow: visible !important;
            background: transparent !important;
            padding: 0 !important;
          }

          .preview-actions {
            display: none !important;
          }

          /* ✅ PRINT FIT : 1 SEULE PAGE GARANTIE + marges intérieures gauche/droite */
          .print-page {
            width: 202mm;
            height: 289mm; /* ✅ fixe la page utile */
            max-height: 289mm; /* ✅ sécurité */
            overflow: hidden; /* ✅ jamais de 2e page */

            margin: 0 auto;

            /* ✅ marge intérieure (gauche/droite) tout en gardant la couleur */
            padding: 2mm 6mm;

            box-sizing: border-box;

            page-break-inside: avoid;
            break-inside: avoid-page;

            zoom: var(--print-fit-scale, 1) !important;
            transform: none !important;
          }

          @supports not (zoom: 1) {
            .print-page {
              transform: scale(var(--print-fit-scale, 1)) !important;
              transform-origin: top left !important;
            }
          }

          .print-break {
            page-break-after: always;
            break-after: page;
          }

          .print-break:last-of-type {
            page-break-after: auto;
            break-after: auto;
          }

          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>

      {previewOpen && items.length > 0 && enriched && classInfo ? (
        <div
          className="preview-overlay fixed inset-0 z-[60] overflow-y-auto bg-slate-200 p-2 md:p-6"
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

            <Button
              variant="ghost"
              type="button"
              onClick={handleLoadBulletin}
              disabled={bulletinLoading || !selectedClassId}
            >
              <RefreshCw className="h-4 w-4" />
              Recharger
            </Button>

            <Button type="button" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              Imprimer
            </Button>
          </div>

          <div className="flex flex-col gap-6 pb-6">
            {items.map((it, idx) => (
              <StudentBulletinCard
                key={it.student_id}
                index={idx}
                total={items.length}
                item={it}
                subjects={subjects}
                subjectComponents={subjectComponents}
                subjectGroups={subjectGroups}
                classInfo={classInfo}
                period={period}
                institution={institution}
                stats={stats}
                conduct={conductByStudentId.get(it.student_id) || null}
                conductRubricMax={conductRubricMax}
                conductTotalMax={conductTotalMax}
                signaturesEnabled={signaturesEnabled}
                previewZoomForMeasure={previewZoom}
              />
            ))}
          </div>
        </div>
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
            </div>

            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <div className="flex items-center justify-end gap-2">
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
                  <span className="font-semibold">
                    Signatures électroniques :{" "}
                  </span>
                  <span
                    className={signaturesEnabled ? "text-emerald-600" : "text-slate-500"}
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
                  disabled={signaturesToggling}
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
