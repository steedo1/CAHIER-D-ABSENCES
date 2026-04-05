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

function escapeHtml(value?: string | null) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(value?: string | null) {
  return escapeHtml(value).replace(/\n/g, "<br />");
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
const ABSENCE_PREVIEW_ZOOM = 0.72;

const __SIG_INK_CACHE = new Map<string, string>();
const __SIG_INK_PROMISES = new Map<string, Promise<string | null>>();
const __SIG_TINT_CACHE = new Map<string, string>();
const __SIG_TINT_PROMISES = new Map<string, Promise<string | null>>();

function buildPrintMeta(item: TeacherAbsenceRequestItem, institution: InstitutionSettings | null) {
  const instName = item.institution_name || institution?.institution_name || "Établissement";
  const instLogo = item.institution_logo_url || institution?.institution_logo_url || "";
  const instPhone = institution?.institution_phone || "";
  const instEmail = institution?.institution_email || "";
  const instAddress = institution?.institution_postal_address || "";
  const instRegion = institution?.institution_region || "";
  const instStatus = institution?.institution_status || "";

  const teacherName = item.teacher_name?.trim() || "Enseignant concerné";
  const teacherSignature =
    item.teacher_signature_png ||
    item.teacher_signature_url ||
    item.teacher_profile_signature_url ||
    "";

  const adminName =
    item.approved_by_name?.trim() ||
    institution?.institution_head_name?.trim() ||
    "Administration";
  const adminTitle = institution?.institution_head_title?.trim() || "Administration";
  const adminSignature =
    item.administration_signature_png || item.administration_signature_url || "";

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

function ApprovedRequestPrintSheet({
  item,
  institution,
  previewZoomForMeasure,
}: {
  item: TeacherAbsenceRequestItem;
  institution: InstitutionSettings | null;
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
  } = useMemo(() => buildPrintMeta(item, institution), [item, institution]);

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
              // eslint-disable-next-line @next/next/no-img-element
              <img src={instLogo} alt="Logo établissement" className="absence-logo-img" />
            ) : (
              <div className="absence-logo-fallback">Logo<br />établissement</div>
            )}
          </div>

          <div className="min-w-0">
            <div className="absence-inst-name">{instName}</div>
            <div className="absence-inst-meta">{metaLine || ""}</div>
          </div>
        </div>

        <div className="absence-approved-banner">
          <div className="absence-approved-big">DEMANDE APPROUVÉE</div>
          <div className="absence-approved-small">
            Validation administrative enregistrée le {formatDateTime(item.approved_at)}
          </div>
        </div>

        <div className="absence-doc-title">Autorisation d’absence validée</div>

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
                    <span>{cls.lost_hours} h • {cls.lost_sessions} créneau(x)</span>
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
            <div className="absence-signature-role">Nom</div>
            <div className="absence-signature-name">{teacherName}</div>
            <div className="absence-signature-box">
              {teacherSignature ? (
                <SignatureInk src={teacherSignature} alt="Signature enseignant" className="absence-signature-img" />
              ) : (
                <div className="absence-signature-placeholder">Signature de l’enseignant</div>
              )}
            </div>
          </div>

          <div className="absence-signature-card">
            <div className="absence-signature-head">Visa de l’administration</div>
            <div className="absence-signature-role">{adminTitle}</div>
            <div className="absence-signature-name">{adminName}</div>
            <div className="absence-signature-box">
              {adminSignature ? (
                <SignatureInk src={adminSignature} alt="Signature administration" className="absence-signature-img" />
              ) : (
                <div className="absence-signature-placeholder">Signature et cachet</div>
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

      const json =
        (await res.json().catch(() => null)) as ApiListResponse | null;

      if (!res.ok || !json?.ok) {
        throw new Error(
          (json && "error" in json && json.error) ||
            "Impossible de charger vos demandes d’absence."
        );
      }

      setItems(Array.isArray(json.items) ? json.items : []);
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

        if (!res.ok || !json?.ok) {
          if (!cancelled) setImpactPreview(null);
          return;
        }

        if (!cancelled) {
          setImpactPreview(json.impact ?? null);
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

  useEffect(() => {
    let cancelled = false;

    async function loadInstitution() {
      try {
        setInstitutionLoading(true);
        const res = await fetch("/api/admin/institution/settings", {
          method: "GET",
          cache: "no-store",
        });

        if (!res.ok) return;

        const json = (await res.json().catch(() => null)) as InstitutionSettings | null;
        if (!cancelled && json) {
          setInstitution(json);
        }
      } catch {
        // on garde des valeurs de secours si cette route n’est pas accessible côté enseignant
      } finally {
        if (!cancelled) setInstitutionLoading(false);
      }
    }

    void loadInstitution();

    return () => {
      cancelled = true;
    };
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
        REASON_OPTIONS.find((option) => option.value === form.reason_code)
          ?.label ?? form.reason_code;

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

      const json =
        (await res.json().catch(() => null)) as ApiCreateResponse | null;

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

  function handlePrintApprovedRequest(item: TeacherAbsenceRequestItem) {
    if (item.status !== "approved") return;

    setError(null);
    setSuccess(null);
    setPrintingId(item.id);
    setPrintPreviewItem(item);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setPrintingId(null);
      });
    });
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
            <RefreshCw
              className={classNames("h-4 w-4", refreshing && "animate-spin")}
            />
            Actualiser
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total
          </div>
          <div className="mt-2 text-3xl font-extrabold text-slate-950">
            {counts.total}
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            En attente
          </div>
          <div className="mt-2 text-3xl font-extrabold text-amber-900">
            {counts.pending}
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Approuvées
          </div>
          <div className="mt-2 text-3xl font-extrabold text-emerald-900">
            {counts.approved}
          </div>
        </div>

        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Rejetées
          </div>
          <div className="mt-2 text-3xl font-extrabold text-red-900">
            {counts.rejected}
          </div>
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
              <label className="mb-2 block text-sm font-semibold text-slate-800">
                Date de début
              </label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, start_date: e.target.value }))
                }
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-800">
                Date de fin
              </label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, end_date: e.target.value }))
                }
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-bold text-slate-900">
              Impact prévisionnel de l’absence
            </div>

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
                  Vous perdrez des heures dans les classes suivantes :{" "}
                  <strong>{impactPreview.total_lost_hours} h</strong> sur{" "}
                  <strong>{impactPreview.total_lost_sessions}</strong> créneau(x).
                </div>

                <div className="mt-3 space-y-3">
                  {impactPreview.impacted_classes.map((cls) => (
                    <div
                      key={cls.class_id}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-slate-900">
                          {cls.class_label}
                        </div>
                        <div className="text-sm text-slate-600">
                          {cls.lost_hours} h perdues • {cls.lost_sessions} créneau(x)
                        </div>
                      </div>

                      <div className="mt-2 space-y-2 text-sm text-slate-600">
                        {cls.slots.map((slot, index) => (
                          <div
                            key={`${cls.class_id}_${slot.date}_${slot.period_id}_${index}`}
                            className="rounded-xl bg-slate-50 px-3 py-2"
                          >
                            {formatDate(slot.date)} • {slot.subject_name} •{" "}
                            {formatTimeRange(
                              slot.start_time,
                              slot.end_time,
                              slot.period_label
                            )}
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
            <label className="mb-2 block text-sm font-semibold text-slate-800">
              Motif
            </label>
            <select
              value={form.reason_code}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, reason_code: e.target.value }))
              }
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
            <label className="mb-2 block text-sm font-semibold text-slate-800">
              Détails
            </label>
            <textarea
              rows={5}
              value={form.details}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, details: e.target.value }))
              }
              placeholder="Expliquez brièvement le motif de la demande..."
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
            />
          </div>

          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm font-bold text-emerald-900">
              Quand comptez-vous rattraper ces heures ?
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-slate-800">
                Jours, heures et classes de rattrapage
              </label>
              <textarea
                rows={5}
                value={form.makeup_notes}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, makeup_notes: e.target.value }))
                }
                placeholder="Ex. 6e1 : mardi 28/04 de 07:10 à 08:05 ; 6e2 : jeudi 30/04 de 10:15 à 11:10 ; 5e3 : vendredi 01/05 de 08:05 à 09:00."
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>
          </div>

          <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <input
              type="checkbox"
              checked={form.signed}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, signed: e.target.checked }))
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm text-slate-700">
              Je confirme l’exactitude des informations fournies dans cette
              demande.
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
                  <div className="mt-3 text-lg font-bold text-slate-900">
                    Aucune demande pour le moment
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Vos prochaines demandes apparaîtront ici.
                  </p>
                </div>
              ) : (
                items.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={classNames(
                          "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ring-1",
                          statusClasses(item.status)
                        )}
                      >
                        {statusLabel(item.status)}
                      </span>

                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                        <Clock3 className="h-3.5 w-3.5" />
                        {daysLabel(item.requested_days)}
                      </span>

                      {item.signed ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
                          Signée
                        </span>
                      ) : null}

                      {typeof item.lost_hours_total === "number" ? (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                          {item.lost_hours_total} h à rattraper
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                      <div className="rounded-2xl bg-white px-4 py-3">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Période
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {formatDate(item.start_date)} → {formatDate(item.end_date)}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white px-4 py-3">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Motif
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {item.reason_label}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white px-4 py-3 sm:col-span-2">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Détails
                        </div>
                        <div className="mt-1 leading-6 text-slate-700">
                          {item.details}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white px-4 py-3">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Créée le
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {formatDateTime(item.created_at)}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white px-4 py-3">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Décision
                        </div>
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
                        <div className="text-sm font-bold text-amber-900">
                          Classes impactées
                        </div>
                        <div className="mt-2 space-y-3">
                          {item.impact_summary.impacted_classes.map((cls) => (
                            <div
                              key={cls.class_id}
                              className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="font-semibold text-slate-900">
                                  {cls.class_label}
                                </div>
                                <div className="text-slate-600">
                                  {cls.lost_hours} h • {cls.lost_sessions} créneau(x)
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {item.makeup_plan ? (
                      <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-slate-700">
                        <div className="font-bold text-emerald-900">
                          Proposition de rattrapage
                        </div>
                        <div className="mt-2 rounded-2xl bg-white px-4 py-3">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            Notes
                          </div>
                          <div className="mt-1 leading-6 text-slate-700">
                            {item.makeup_plan.notes || "—"}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {item.admin_comment ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                        <div className="font-bold text-slate-900">
                          Commentaire administratif
                        </div>
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
                          onClick={() => handlePrintApprovedRequest(item)}
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
                ))
              )}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Historique masqué.
            </div>
          )}
        </section>
      </section>

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
            <div className="absence-preview-overlay" style={{ ["--preview-zoom" as any]: ABSENCE_PREVIEW_ZOOM }}>
              <ApprovedRequestPrintSheet
                item={printPreviewItem}
                institution={institution}
                previewZoomForMeasure={ABSENCE_PREVIEW_ZOOM}
              />
            </div>
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .sig-img {
          display: block;
          background: transparent !important;
          opacity: 1 !important;
        }

        .absence-print-overlay {
          position: fixed;
          inset: 0;
          z-index: 120;
          background: rgba(15, 23, 42, 0.72);
          backdrop-filter: blur(10px);
          display: flex;
          flex-direction: column;
          padding: 16px;
        }

        .absence-print-toolbar {
          width: min(1200px, 100%);
          margin: 0 auto 14px;
          border-radius: 26px;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(226, 232, 240, 0.9);
          padding: 16px 18px;
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.22);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }

        .absence-print-preview-shell {
          flex: 1;
          min-height: 0;
          overflow: auto;
          border-radius: 28px;
          background: linear-gradient(180deg, #e2e8f0 0%, #cbd5e1 100%);
          padding: 18px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.55);
        }

        .absence-preview-overlay {
          width: max-content;
          min-width: 100%;
          margin: 0 auto;
          padding: 18px 0 24px;
        }

        .absence-print-sheet-wrap {
          width: 210mm;
          margin: 0 auto;
        }

        .absence-print-page {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          padding: 8mm;
          box-sizing: border-box;
          font-family: Arial, Helvetica, sans-serif;
          background: #fff;
          color: #0f172a;
          box-shadow: 0 18px 60px rgba(15, 23, 42, 0.18);
          border-radius: 22px;
          overflow: hidden;
          transform-origin: top center;
        }

        .absence-preview-overlay .absence-print-page {
          width: 202mm;
          min-height: 289mm;
          padding: 2mm 6mm;
        }

        @supports (zoom: 1) {
          .absence-preview-overlay .absence-print-page {
            zoom: var(--preview-zoom, 1);
          }
        }

        @supports not (zoom: 1) {
          .absence-preview-overlay .absence-print-page {
            transform: scale(var(--preview-zoom, 1));
            transform-origin: top center;
          }
        }

        .absence-print-topbar {
          height: 8px;
          margin: -8mm -8mm 0;
          background: linear-gradient(90deg, #0f172a, #065f46);
        }

        .absence-print-header {
          display: grid;
          grid-template-columns: 88px 1fr;
          gap: 16px;
          align-items: center;
          border-bottom: 2px solid #e2e8f0;
          padding: 18px 0 16px;
        }

        .absence-logo-box {
          width: 88px;
          height: 88px;
          border: 1px solid #cbd5e1;
          border-radius: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: #fff;
        }

        .absence-logo-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .absence-logo-fallback {
          font-size: 11px;
          color: #64748b;
          text-align: center;
          padding: 8px;
          line-height: 1.4;
        }

        .absence-inst-name {
          font-size: 24px;
          line-height: 1.15;
          font-weight: 800;
          color: #0f172a;
        }

        .absence-inst-meta {
          margin-top: 6px;
          font-size: 12px;
          color: #475569;
          line-height: 1.6;
        }

        .absence-approved-banner {
          margin-top: 18px;
          border: 2px solid #22c55e;
          background: #f0fdf4;
          color: #166534;
          border-radius: 18px;
          text-align: center;
          padding: 14px 16px;
        }

        .absence-approved-big {
          font-size: 22px;
          font-weight: 900;
          letter-spacing: 0.04em;
        }

        .absence-approved-small {
          margin-top: 4px;
          font-size: 12px;
          font-weight: 700;
        }

        .absence-doc-title {
          margin-top: 20px;
          font-size: 18px;
          font-weight: 800;
          color: #0f172a;
        }

        .absence-grid {
          margin-top: 14px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .absence-card {
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 12px 14px;
          background: #ffffff;
        }

        .absence-card-full {
          grid-column: 1 / -1;
        }

        .absence-label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          color: #64748b;
          text-transform: uppercase;
        }

        .absence-value {
          margin-top: 6px;
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
          line-height: 1.55;
        }

        .absence-value-normal {
          font-weight: 500;
        }

        .absence-impact-section {
          margin-top: 18px;
          border: 1px solid #fde68a;
          background: #fffbeb;
          border-radius: 18px;
          padding: 14px;
        }

        .absence-impact-title {
          font-size: 14px;
          font-weight: 800;
          color: #92400e;
          margin-bottom: 10px;
        }

        .absence-impact-card {
          border: 1px solid #e2e8f0;
          background: #ffffff;
          border-radius: 14px;
          padding: 10px 12px;
        }

        .absence-impact-head {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          font-size: 13px;
          color: #0f172a;
        }

        .absence-impact-slots {
          margin-top: 8px;
        }

        .absence-impact-slot {
          font-size: 12px;
          color: #334155;
          background: #f8fafc;
          border-radius: 10px;
          padding: 7px 9px;
          margin-top: 6px;
        }

        .absence-empty-box {
          border: 1px dashed #cbd5e1;
          border-radius: 12px;
          padding: 12px;
          font-size: 12px;
          color: #64748b;
          background: #ffffff;
        }

        .absence-signature-grid {
          margin-top: 22px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
        }

        .absence-signature-card {
          border: 1px solid #dbeafe;
          border-radius: 18px;
          background: #f8fafc;
          padding: 14px;
          min-height: 190px;
        }

        .absence-signature-head {
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 10px;
        }

        .absence-signature-role {
          font-size: 11px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-weight: 800;
        }

        .absence-signature-name {
          margin-top: 4px;
          font-size: 15px;
          font-weight: 800;
          color: #0f172a;
        }

        .absence-signature-box {
          height: 86px;
          margin-top: 14px;
          border-bottom: 2px solid #94a3b8;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          overflow: hidden;
          padding-bottom: 8px;
        }

        .absence-signature-img {
          max-height: 74px !important;
          max-width: 100% !important;
          object-fit: contain !important;
        }

        .absence-signature-placeholder {
          font-size: 13px;
          color: #64748b;
          font-style: italic;
        }

        .absence-foot {
          margin-top: 22px;
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-end;
          border-top: 1px solid #e2e8f0;
          padding-top: 12px;
          font-size: 12px;
          color: #475569;
        }

        .absence-foot strong {
          color: #0f172a;
        }

        @media (max-width: 920px) {
          .absence-print-overlay {
            padding: 10px;
          }

          .absence-print-toolbar {
            flex-direction: column;
            align-items: stretch;
          }
        }

        @media (max-width: 760px) {
          .absence-signature-grid,
          .absence-grid {
            grid-template-columns: 1fr;
          }

          .absence-card-full {
            grid-column: auto;
          }

          .absence-impact-head,
          .absence-foot,
          .absence-print-header {
            grid-template-columns: 1fr;
            display: grid;
          }

          .absence-foot {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
          }
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 4mm;
          }

          html,
          body {
            background: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          body.absence-print-open * {
            visibility: hidden !important;
          }

          body.absence-print-open .absence-print-sheet-wrap,
          body.absence-print-open .absence-print-sheet-wrap * {
            visibility: visible !important;
          }

          body.absence-print-open .absence-print-overlay {
            position: static !important;
            inset: auto !important;
            display: block !important;
            background: #fff !important;
            padding: 0 !important;
            backdrop-filter: none !important;
          }

          body.absence-print-open .absence-print-toolbar {
            display: none !important;
          }

          body.absence-print-open .absence-print-preview-shell,
          body.absence-print-open .absence-preview-overlay {
            overflow: visible !important;
            background: #fff !important;
            padding: 0 !important;
            box-shadow: none !important;
            min-height: auto !important;
          }

          body.absence-print-open .absence-print-sheet-wrap {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
          }

          body.absence-print-open .absence-print-page {
            width: 202mm !important;
            min-height: 289mm !important;
            padding: 2mm 6mm !important;
            margin: 0 auto !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            zoom: 1 !important;
            transform: none !important;
          }
        }
      `}</style>
    </main>
  );
}