// src/app/admin/notes/matrice-annuelle/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Download,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  School,
  Search,
} from "lucide-react";

type ClassRow = {
  id: string;
  name?: string;
  label?: string | null;
  level?: string | null;
  academic_year?: string | null;
};

type GradePeriod = {
  id: string;
  academic_year: string | null;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string;
  end_date: string;
  order_index?: number | null;
  coeff?: number | null;
  is_active?: boolean | null;
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

type BulletinItem = {
  student_id: string;
  full_name: string;
  matricule: string | null;

  // Moyenne générale de la période.
  // 0 = vraie moyenne publiée ; null = NC / pas de moyenne.
  general_avg: number | null;

  // Métadonnées renvoyées par l’API bulletin NC.
  coverage?: BulletinCoverage | null;
  general_avg_is_complete?: boolean | null;
  general_avg_status?: "complete" | "partial" | "empty" | "admin_nc" | string | null;

  // Décision NC admin centralisée via public.bulletin_nc_overrides.
  admin_forced_nc?: boolean | null;
  general_avg_before_admin_nc?: number | null;
  rank_before_admin_nc?: number | null;
  admin_nc_reason?: string | null;
  admin_nc_missing_subjects_snapshot?: BulletinMissingSubject[] | null;

  // Annuel renvoyé par l’API sur la dernière période, si disponible.
  annual_avg?: number | null;
  annual_rank?: number | null;
  annual_coverage?: BulletinAnnualCoverage | null;
  annual_avg_is_complete?: boolean | null;
  annual_avg_status?:
    | "complete"
    | "partial"
    | "empty"
    | "not_last_period"
    | "admin_nc"
    | string
    | null;

  // Réservé au cas où l’admin force NC sur l’annuel.
  admin_annual_forced_nc?: boolean | null;
  annual_avg_before_admin_nc?: number | null;
  annual_rank_before_admin_nc?: number | null;
  admin_annual_nc_reason?: string | null;
};

type BulletinResponse = {
  ok: boolean;
  class?: {
    id: string;
    label?: string | null;
    academic_year?: string | null;
  };
  period?: {
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
    coeff?: number | null;
  };
  items?: BulletinItem[];
};

type MatrixCell = {
  avg: number | null;
  rank: number | null;
  is_complete: boolean;
  status: string | null;
  admin_forced_nc?: boolean;
};

type MatrixRow = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  periods: Record<string, MatrixCell>;

  // Annuel affiché.
  // Nouvelle règle : si une moyenne est calculable, le rang est autorisé.
  // Plus d’étoile et plus de rang bloqué automatiquement sur une moyenne partielle.
  // Si admin_annual_forced_nc=true, l’annuel reste NC même si des périodes existent.
  annual_avg: number | null;
  annual_rank: number | null;
  annual_is_complete: boolean;
  annual_has_star: boolean; // conservé pour compatibilité, toujours false dans cette version
  annual_source_period_count: number;
  annual_expected_period_count: number;
  admin_annual_forced_nc: boolean;
};

type PeriodLoadState = {
  period_id: string;
  label: string;
  status: "pending" | "ok" | "empty" | "error";
  message?: string;
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
  country_name?: string | null;
  country_motto?: string | null;
  ministry_name?: string | null;
  institution_code?: string | null;
  settings_json?: any;
};

const BRAND_COMPANY = "Nexa Digital SARL";
const BRAND_SITE = "www.mon-cahier.com";

function clsLabel(c: ClassRow | null | undefined) {
  if (!c) return "";
  return c.label || c.name || "Classe";
}

function periodLabel(p: GradePeriod) {
  return p.short_label || p.label || p.code || "Période";
}

function formatNumber(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function formatRank(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "NC";
  return String(n);
}

function formatAnnualNumber(row: Pick<MatrixRow, "annual_avg">) {
  if (row.annual_avg === null || row.annual_avg === undefined) return "—";
  if (!Number.isFinite(Number(row.annual_avg))) return "—";
  return Number(row.annual_avg).toFixed(2);
}

function formatAnnualRank(row: Pick<MatrixRow, "annual_rank">) {
  return formatRank(row.annual_rank);
}

function formatMaybeStar(n: number | null | undefined, _hasStar: boolean, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function formatDateFR(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
}

function generatedAtLabel() {
  try {
    return new Date().toLocaleString("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return new Date().toLocaleString("fr-FR");
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: unknown) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function csvCell(value: unknown) {
  const v = value === null || value === undefined ? "" : String(value);
  return `"${v.replace(/"/g, '""')}"`;
}

function cleanAvg(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function cleanRank(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function isPeriodAverageComplete(item: BulletinItem): boolean {
  if (item.general_avg === null || item.general_avg === undefined) return false;

  if (typeof item.general_avg_is_complete === "boolean") {
    return item.general_avg_is_complete;
  }

  if (item.coverage && typeof item.coverage.is_complete === "boolean") {
    return item.coverage.is_complete;
  }

  // Compatibilité avec l’ancienne API :
  // si l’API ne renvoie pas encore la couverture, on conserve l’ancien comportement.
  return true;
}

function periodAverageStatus(item: BulletinItem): string | null {
  return item.general_avg_status ?? item.coverage?.status ?? null;
}

function isAnnualAverageCompleteFromApi(item: BulletinItem): boolean | null {
  if (item.annual_avg === null || item.annual_avg === undefined) return null;

  if (typeof item.annual_avg_is_complete === "boolean") {
    return item.annual_avg_is_complete;
  }

  if (item.annual_coverage && typeof item.annual_coverage.is_complete === "boolean") {
    return item.annual_coverage.is_complete;
  }

  return null;
}

function isAdminForcedNc(item: BulletinItem | null | undefined): boolean {
  if (!item) return false;
  return item.admin_forced_nc === true || item.general_avg_status === "admin_nc";
}

function isAdminAnnualForcedNc(item: BulletinItem | null | undefined): boolean {
  if (!item) return false;
  return item.admin_annual_forced_nc === true || item.annual_avg_status === "admin_nc";
}

function displayCellRank(cell: MatrixCell | undefined) {
  if (!cell) return "NC";
  if (cell.admin_forced_nc) return "NC";
  return cell.avg !== null ? formatRank(cell.rank) : "NC";
}

function exportCellRank(cell: MatrixCell | undefined) {
  if (!cell) return "NC";
  if (cell.admin_forced_nc) return "NC";
  return cell.avg !== null ? cell.rank ?? "" : "NC";
}

function buildRankMap(
  rows: Array<{ student_id: string; avg: number | null; is_complete?: boolean }>
) {
  // Nouvelle règle : toute moyenne calculable est classable.
  // is_complete est conservé pour compatibilité, mais ne bloque plus le rang.
  const valid = rows
    .filter(
      (r) =>
        typeof r.avg === "number" &&
        Number.isFinite(r.avg)
    )
    .map((r) => ({ student_id: r.student_id, avg: Number(r.avg) }))
    .sort((a, b) => b.avg - a.avg);

  const map = new Map<string, number>();
  let lastAvg: number | null = null;
  let currentRank = 0;
  let position = 0;

  for (const row of valid) {
    position += 1;
    if (lastAvg === null || row.avg !== lastAvg) {
      currentRank = position;
      lastAvg = row.avg;
    }
    map.set(row.student_id, currentRank);
  }

  return map;
}

function normalizeInstitutionSettings(json: any): InstitutionSettings {
  const raw = json?.institution || json?.settings || json?.item || json || {};
  const settingsJson = raw?.settings_json || {};

  return {
    ...settingsJson,
    ...raw,
    institution_name:
      raw?.institution_name ||
      raw?.name ||
      settingsJson?.institution_name ||
      settingsJson?.name ||
      null,
    institution_logo_url:
      raw?.institution_logo_url ||
      raw?.logo_url ||
      settingsJson?.institution_logo_url ||
      settingsJson?.logo_url ||
      null,
    institution_phone:
      raw?.institution_phone ||
      raw?.phone ||
      settingsJson?.institution_phone ||
      settingsJson?.phone ||
      null,
    institution_email:
      raw?.institution_email ||
      raw?.email ||
      settingsJson?.institution_email ||
      settingsJson?.email ||
      null,
    institution_region:
      raw?.institution_region ||
      raw?.region ||
      settingsJson?.institution_region ||
      settingsJson?.region ||
      null,
    institution_postal_address:
      raw?.institution_postal_address ||
      raw?.postal_address ||
      raw?.address ||
      settingsJson?.institution_postal_address ||
      settingsJson?.postal_address ||
      settingsJson?.address ||
      null,
    institution_status:
      raw?.institution_status ||
      raw?.status ||
      settingsJson?.institution_status ||
      settingsJson?.status ||
      null,
    institution_code:
      raw?.institution_code ||
      raw?.code ||
      settingsJson?.institution_code ||
      settingsJson?.code ||
      null,
  };
}

function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "emerald" | "slate" | "amber";
  }
) {
  const { tone = "emerald", className = "", ...rest } = props;
  const tones = {
    emerald:
      "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/30",
    slate: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-500/30",
    amber: "bg-amber-500 text-slate-950 hover:bg-amber-600 focus:ring-amber-500/30",
  } as const;

  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition",
        "focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
        tones[tone],
        className,
      ].join(" ")}
    />
  );
}

function GhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition",
        "hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-400/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      ].join(" ")}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return (
    <select
      {...rest}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20 disabled:bg-slate-50 disabled:text-slate-400",
        className,
      ].join(" ")}
    />
  );
}

export default function AnnualMatrixPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState("");

  const [selectedAcademicYear, setSelectedAcademicYear] = useState("");
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);

  const [institution, setInstitution] = useState<InstitutionSettings | null>(null);

  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([]);
  const [loadedPeriods, setLoadedPeriods] = useState<GradePeriod[]>([]);
  const [periodStates, setPeriodStates] = useState<PeriodLoadState[]>([]);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) || null,
    [classes, selectedClassId]
  );

  const academicYears = useMemo(() => {
    const set = new Set<string>();
    classes.forEach((c) => c.academic_year && set.add(c.academic_year));
    periods.forEach((p) => p.academic_year && set.add(p.academic_year));
    return Array.from(set).sort().reverse();
  }, [classes, periods]);

  const matrixPeriods = useMemo(() => {
    return periods
      .filter((p) => p.is_active !== false)
      .filter((p) => !selectedAcademicYear || p.academic_year === selectedAcademicYear)
      .filter((p) => !!p.start_date && !!p.end_date)
      .slice()
      .sort((a, b) => {
        const ai = Number(a.order_index ?? 999);
        const bi = Number(b.order_index ?? 999);
        if (ai !== bi) return ai - bi;
        return String(a.start_date).localeCompare(String(b.start_date));
      });
  }, [periods, selectedAcademicYear]);

  const hasPartialAnnualRows = false;

  const stats = useMemo(() => {
    const valid = matrixRows
      .map((r) => r.annual_avg)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

    if (!valid.length) {
      return {
        count: matrixRows.length,
        classAvg: null,
        highest: null,
        lowest: null,
        hasStar: false,
      };
    }

    const sum = valid.reduce((acc, n) => acc + n, 0);

    return {
      count: matrixRows.length,
      classAvg: Math.round((sum / valid.length) * 100) / 100,
      highest: Math.round(Math.max(...valid) * 100) / 100,
      lowest: Math.round(Math.min(...valid) * 100) / 100,
      hasStar: false,
    };
  }, [matrixRows, hasPartialAnnualRows]);

  useEffect(() => {
    let cancelled = false;

    async function loadClasses() {
      setClassesLoading(true);
      setErrorMsg(null);

      try {
        const res = await fetch("/api/admin/classes", { cache: "no-store" });
        if (!res.ok) throw new Error(`Erreur classes : ${res.status}`);

        const json = await res.json().catch(() => null);
        const items: ClassRow[] = Array.isArray(json)
          ? json
          : Array.isArray(json?.items)
          ? json.items
          : [];

        if (cancelled) return;

        setClasses(items);

        if (!selectedClassId && items.length) {
          setSelectedClassId(items[0].id);
          if (items[0].academic_year) setSelectedAcademicYear(items[0].academic_year);
        }
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message || "Impossible de charger les classes.");
      } finally {
        if (!cancelled) setClassesLoading(false);
      }
    }

    loadClasses();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInstitutionSettings() {
      try {
        const res = await fetch("/api/admin/institution/settings", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));
        if (!cancelled) setInstitution(normalizeInstitutionSettings(json));
      } catch (e) {
        console.warn("[Matrice annuelle] paramètres établissement indisponibles", e);
      }
    }

    loadInstitutionSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cls = classes.find((c) => c.id === selectedClassId);
    if (cls?.academic_year) setSelectedAcademicYear(cls.academic_year);
  }, [selectedClassId, classes]);

  useEffect(() => {
    let cancelled = false;

    async function loadPeriods() {
      setPeriodsLoading(true);
      setErrorMsg(null);

      try {
        const params = new URLSearchParams();
        if (selectedAcademicYear) params.set("academic_year", selectedAcademicYear);

        const url = `/api/admin/institution/grading-periods${
          params.toString() ? `?${params.toString()}` : ""
        }`;

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`Erreur périodes : ${res.status}`);

        const json = await res.json().catch(() => null);
        const items: GradePeriod[] = Array.isArray(json)
          ? json
          : Array.isArray(json?.items)
          ? json.items
          : [];

        if (cancelled) return;

        setPeriods(items);

        if (!selectedAcademicYear && typeof json?.academic_year === "string") {
          setSelectedAcademicYear(json.academic_year);
        }
      } catch (e: any) {
        if (!cancelled) {
          setPeriods([]);
          setErrorMsg(e?.message || "Impossible de charger les périodes.");
        }
      } finally {
        if (!cancelled) setPeriodsLoading(false);
      }
    }

    loadPeriods();

    return () => {
      cancelled = true;
    };
  }, [selectedAcademicYear]);

  async function fetchBulletinForPeriod(period: GradePeriod) {
    const params = new URLSearchParams();

    params.set("class_id", selectedClassId);
    params.set("from", period.start_date);
    params.set("to", period.end_date);

    // Matrice officielle : uniquement les notes publiées.
    // Aucun brouillon ne doit entrer dans les moyennes.
    params.set("published", "true");

    const res = await fetch(`/api/admin/grades/bulletin?${params.toString()}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Erreur bulletin ${res.status}`);
    }

    const json = (await res.json().catch(() => null)) as BulletinResponse | null;
    if (!json?.ok) throw new Error("Réponse bulletin invalide.");

    return json;
  }

  async function loadMatrix() {
    setErrorMsg(null);
    setMatrixRows([]);
    setLoadedPeriods([]);

    if (!selectedClassId) {
      setErrorMsg("Veuillez sélectionner une classe.");
      return;
    }

    if (!matrixPeriods.length) {
      setErrorMsg("Aucune période active avec dates n’est configurée pour cette année scolaire.");
      return;
    }

    setLoadingMatrix(true);
    setPeriodStates(
      matrixPeriods.map((p) => ({
        period_id: p.id,
        label: periodLabel(p),
        status: "pending",
      }))
    );

    try {
      const students = new Map<string, MatrixRow>();

      const periodResults: Array<{
        period: GradePeriod;
        items: BulletinItem[];
        ranks: Map<string, number>;
      }> = [];

      for (const period of matrixPeriods) {
        try {
          const res = await fetchBulletinForPeriod(period);
          const items = Array.isArray(res.items) ? res.items : [];

          const periodRowsForRank = items.map((it) => {
            const forcedNc = isAdminForcedNc(it);
            const avg = forcedNc ? null : cleanAvg(it.general_avg);
            const hasAverage = avg !== null;

            return {
              student_id: it.student_id,
              avg,
              is_complete: hasAverage,
            };
          });

          const ranks = buildRankMap(periodRowsForRank);
          periodResults.push({ period, items, ranks });

          const avgCount = periodRowsForRank.filter((row) => row.avg !== null).length;

          for (const it of items) {
            if (!students.has(it.student_id)) {
              students.set(it.student_id, {
                student_id: it.student_id,
                full_name: it.full_name || "Élève",
                matricule: it.matricule ?? null,
                periods: {},
                annual_avg: null,
                annual_rank: null,
                annual_is_complete: false,
                annual_has_star: false,
                annual_source_period_count: 0,
                annual_expected_period_count: matrixPeriods.length,
                admin_annual_forced_nc: false,
              });
            }

            const row = students.get(it.student_id)!;
            const forcedNc = isAdminForcedNc(it);
            const avg = forcedNc ? null : cleanAvg(it.general_avg);
            const hasAverage = avg !== null;
            const annualForcedNc = isAdminAnnualForcedNc(it);

            row.full_name = it.full_name || row.full_name;
            row.matricule = it.matricule ?? row.matricule;

            row.periods[period.id] = {
              avg,
              rank: hasAverage ? ranks.get(it.student_id) ?? null : null,
              is_complete: hasAverage,
              status: forcedNc ? "admin_nc" : periodAverageStatus(it),
              admin_forced_nc: forcedNc,
            };

            if (annualForcedNc) {
              row.admin_annual_forced_nc = true;
              row.annual_avg = null;
              row.annual_rank = null;
              row.annual_is_complete = false;
              row.annual_has_star = false;
            } else {
              const apiAnnualAvg = cleanAvg(it.annual_avg);
              if (apiAnnualAvg !== null) {
                row.annual_avg = apiAnnualAvg;
                const apiAnnualComplete = isAnnualAverageCompleteFromApi(it);
                // Nouvelle règle : si l’annuel est calculable, le rang est autorisé,
                // même si l’annuel est partiel. On garde annual_is_complete en information.
                if (apiAnnualComplete !== null) {
                  row.annual_is_complete = apiAnnualComplete;
                } else {
                  row.annual_is_complete = true;
                }
                row.annual_has_star = false;
                row.annual_rank = cleanRank(it.annual_rank);
              }
            }
          }

          setPeriodStates((prev) =>
            prev.map((s) =>
              s.period_id === period.id
                ? {
                    ...s,
                    status: avgCount ? "ok" : "empty",
                    message: avgCount
                      ? `${avgCount} moyenne(s) calculable(s)`
                      : "Aucune moyenne publiée",
                  }
                : s
            )
          );
        } catch (e: any) {
          setPeriodStates((prev) =>
            prev.map((s) =>
              s.period_id === period.id
                ? { ...s, status: "error", message: e?.message || "Erreur" }
                : s
            )
          );
        }
      }

      const rows = Array.from(students.values());

      for (const row of rows) {
        let num = 0;
        let den = 0;
        let sourceCount = 0;
        let completeCount = 0;

        for (const { period } of periodResults) {
          const cell = row.periods[period.id];
          const avg = cell?.avg ?? null;

          if (avg === null || avg === undefined || !Number.isFinite(avg)) continue;

          const coeffRaw = Number(period.coeff ?? 1);
          const coeff = Number.isFinite(coeffRaw) && coeffRaw > 0 ? coeffRaw : 1;

          num += avg * coeff;
          den += coeff;
          sourceCount += 1;
          if (isPeriodAverageComplete({
            student_id: row.student_id,
            full_name: row.full_name,
            matricule: row.matricule,
            general_avg: avg,
            general_avg_is_complete: cell.is_complete,
            general_avg_status: cell.status,
          })) {
            completeCount += 1;
          }
        }

        row.annual_source_period_count = sourceCount;
        row.annual_expected_period_count = matrixPeriods.length;

        // Si l’API n’a pas déjà fourni annual_avg, on calcule une synthèse sur les périodes publiées disponibles.
        // Important : les périodes sans note restent NC et ne deviennent jamais 0.
        if (row.admin_annual_forced_nc) {
          row.annual_avg = null;
          row.annual_rank = null;
        } else if (row.annual_avg === null) {
          row.annual_avg = den > 0 ? Math.round((num / den) * 100) / 100 : null;
        }

        // Nouvelle règle : dès qu’une moyenne annuelle est calculable, elle est classable.
        // On conserve annual_is_complete comme info technique, mais elle ne bloque plus le rang.
        row.annual_is_complete = row.annual_avg !== null && !row.admin_annual_forced_nc;
        row.annual_has_star = false;
      }

      const annualRanks = buildRankMap(
        rows.map((r) => ({
          student_id: r.student_id,
          avg: r.admin_annual_forced_nc ? null : r.annual_avg,
          is_complete: r.annual_avg !== null && !r.admin_annual_forced_nc,
        }))
      );

      rows.forEach((r) => {
        r.annual_rank =
          r.annual_avg !== null && !r.admin_annual_forced_nc
            ? r.annual_rank ?? annualRanks.get(r.student_id) ?? null
            : null;
      });

      rows.sort((a, b) => {
        const ar =
          a.annual_rank !== null
            ? a.annual_rank
            : Number.POSITIVE_INFINITY;
        const br =
          b.annual_rank !== null
            ? b.annual_rank
            : Number.POSITIVE_INFINITY;

        if (ar !== br) return ar - br;

        const avgA = a.annual_avg !== null ? Number(a.annual_avg) : -Infinity;
        const avgB = b.annual_avg !== null ? Number(b.annual_avg) : -Infinity;
        if (avgB !== avgA) return avgB - avgA;

        return a.full_name.localeCompare(b.full_name, "fr", {
          sensitivity: "base",
          numeric: true,
        });
      });

      setLoadedPeriods(periodResults.map((p) => p.period));
      setMatrixRows(rows);

      if (!rows.length) {
        setErrorMsg("Aucun élève ou aucune moyenne n’a été trouvé pour cette sélection.");
      }
    } finally {
      setLoadingMatrix(false);
    }
  }

  function exportCsv() {
    if (!matrixRows.length) {
      setErrorMsg("Chargez d’abord la matrice avant d’exporter.");
      return;
    }

    const headers = ["N°", "Matricule", "Nom et prénoms"];

    for (const p of loadedPeriods) {
      const label = periodLabel(p);
      headers.push(`${label} moyenne`, `${label} rang`);
    }

    headers.push("Moyenne annuelle", "Rang annuel");

    const lines = [headers.map(csvCell).join(";")];

    matrixRows.forEach((row, idx) => {
      const cells: Array<string | number | null> = [
        idx + 1,
        row.matricule || "",
        row.full_name,
      ];

      for (const p of loadedPeriods) {
        const cell = row.periods[p.id] || {
          avg: null,
          rank: null,
          is_complete: false,
          status: null,
        };

        cells.push(
          cell.avg !== null ? cell.avg.toFixed(2) : "",
          exportCellRank(cell)
        );
      }

      cells.push(formatAnnualNumber(row), formatAnnualRank(row));
      lines.push(cells.map(csvCell).join(";"));
    });

    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const safeClass = clsLabel(selectedClass).replace(/[^a-z0-9_-]+/gi, "_");
    const safeYear = (selectedAcademicYear || "annee").replace(/[^a-z0-9_-]+/gi, "_");

    const a = document.createElement("a");
    a.href = url;
    a.download = `matrice_annuelle_${safeClass}_${safeYear}.csv`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    if (!matrixRows.length) {
      setErrorMsg("Chargez d’abord la matrice avant d’exporter.");
      return;
    }

    const className = clsLabel(selectedClass);
    const title = `Matrice annuelle des moyennes`;
    const subtitle = `Classe : ${className || "—"} • Année scolaire : ${selectedAcademicYear || "—"}`;

    const institutionName = institution?.institution_name || "ÉTABLISSEMENT";
    const logoUrl = String(institution?.institution_logo_url || "").trim();

    const institutionMetaParts = [
      institution?.institution_postal_address,
      institution?.institution_phone ? `Tél : ${institution.institution_phone}` : "",
      institution?.institution_email,
      institution?.institution_status,
      institution?.institution_code ? `Code : ${institution.institution_code}` : "",
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    const institutionMeta = institutionMetaParts.map(escapeHtml).join(" • ");

    const logoHtml = logoUrl
      ? `<img src="${escapeAttr(logoUrl)}" alt="Logo établissement" />`
      : `<span>Logo</span>`;

    const periodHeader = loadedPeriods
      .map(
        (p) => `
          <th colspan="2" class="period-head">${escapeHtml(periodLabel(p))}<br/><span>${escapeHtml(
          formatDateFR(p.start_date)
        )} — ${escapeHtml(formatDateFR(p.end_date))}</span></th>`
      )
      .join("");

    const secondHeader = loadedPeriods
      .map(() => `<th>Moy.</th><th>Rang</th>`)
      .join("");

    const body = matrixRows
      .map((row, idx) => {
        const periodCells = loadedPeriods
          .map((p) => {
            const cell = row.periods[p.id] || {
              avg: null,
              rank: null,
              is_complete: false,
              status: null,
            };

            return `<td class="num">${escapeHtml(formatNumber(cell.avg))}</td><td class="num">${escapeHtml(
              displayCellRank(cell)
            )}</td>`;
          })
          .join("");

        return `<tr>
          <td class="num rank-col">${idx + 1}</td>
          <td class="matricule-col">${escapeHtml(row.matricule || "")}</td>
          <td class="student-col">${escapeHtml(row.full_name)}</td>
          ${periodCells}
          <td class="num strong">${escapeHtml(formatAnnualNumber(row))}</td>
          <td class="num strong">${escapeHtml(formatAnnualRank(row))}</td>
        </tr>`;
      })
      .join("");

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — ${escapeHtml(className || "Classe")}</title>
<style>
  @page {
    size: A4 landscape;
    margin: 9mm;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    padding: 0;
    color: #0f172a;
    background: #f8fafc;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body {
    padding: 14px;
  }

  .sheet {
    min-height: calc(100vh - 28px);
    background: #ffffff;
    border: 1px solid #dbe3ee;
    border-radius: 18px;
    padding: 14px;
    box-shadow: 0 18px 55px rgba(15, 23, 42, 0.08);
  }

  .print-header {
    display: grid;
    grid-template-columns: 88px 1fr 218px;
    gap: 14px;
    align-items: stretch;
    position: relative;
    overflow: hidden;
    padding: 12px;
    border: 1px solid #cbd5e1;
    border-radius: 16px;
    background:
      linear-gradient(135deg, rgba(16, 185, 129, 0.10), rgba(15, 23, 42, 0.02)),
      #ffffff;
  }

  .print-header::before {
    content: "";
    position: absolute;
    inset: 0;
    border-top: 5px solid #059669;
    pointer-events: none;
  }

  .logo-box {
    width: 76px;
    height: 76px;
    border: 1px solid #cbd5e1;
    border-radius: 14px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: #94a3b8;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .logo-box img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 5px;
  }

  .header-main {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
  }

  .institution-name {
    margin: 0;
    color: #0f172a;
    font-size: 18px;
    line-height: 1.12;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .institution-meta {
    margin-top: 4px;
    color: #475569;
    font-size: 9.5px;
    line-height: 1.35;
  }

  .doc-title {
    width: fit-content;
    margin-top: 8px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #064e3b;
    color: #ffffff;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .brand-line {
    margin-top: 6px;
    color: #334155;
    font-size: 9.5px;
  }

  .brand-line strong {
    color: #047857;
    font-weight: 950;
  }

  .header-side {
    border-left: 1px solid #cbd5e1;
    padding-left: 12px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    color: #334155;
    font-size: 9.5px;
  }

  .meta-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px dashed #cbd5e1;
    padding-bottom: 4px;
  }

  .meta-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .meta-row span:first-child {
    color: #64748b;
    font-weight: 800;
  }

  .meta-row span:last-child {
    text-align: right;
    color: #0f172a;
    font-weight: 900;
  }

  .subtitle {
    margin-top: 10px;
    padding: 8px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #f8fafc;
    color: #334155;
    font-size: 10.5px;
    font-weight: 650;
  }

  .summary-grid {
    margin-top: 10px;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
  }

  .summary-card {
    border: 1px solid #dbeafe;
    border-radius: 13px;
    padding: 8px 9px;
    background: linear-gradient(180deg, #ffffff, #f8fafc);
  }

  .summary-label {
    color: #64748b;
    font-size: 7.8px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 950;
  }

  .summary-value {
    margin-top: 3px;
    color: #0f172a;
    font-size: 15px;
    font-weight: 950;
  }

  .summary-note {
    margin-top: 2px;
    color: #64748b;
    font-size: 8px;
  }

  .table-wrap {
    margin-top: 10px;
    border: 1px solid #cbd5e1;
    border-radius: 14px;
    overflow: hidden;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    background: #ffffff;
    font-size: 9px;
  }

  th,
  td {
    border: 1px solid #cbd5e1;
    padding: 4px 5px;
    vertical-align: middle;
  }

  thead th {
    background: #eafaf4;
    color: #064e3b;
    font-size: 8px;
    font-weight: 950;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  th span {
    color: #475569;
    font-size: 7px;
    font-weight: 700;
    text-transform: none;
    letter-spacing: 0;
  }

  tbody tr:nth-child(even) td {
    background: #f8fafc;
  }

  .rank-col {
    width: 34px;
  }

  .matricule-col {
    width: 82px;
  }

  .student-col {
    width: 190px;
    font-weight: 800;
    color: #0f172a;
  }

  .period-head {
    min-width: 70px;
  }

  td.num {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  td.strong {
    background: #fefce8 !important;
    color: #0f172a;
    font-weight: 950;
  }

  .footer {
    margin-top: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    border-top: 1px solid #cbd5e1;
    padding-top: 8px;
    color: #475569;
    font-size: 9px;
  }

  .footer strong {
    color: #047857;
    font-weight: 950;
  }

  .footer-right {
    text-align: right;
    white-space: nowrap;
  }

  @media print {
    body {
      padding: 0;
      background: #ffffff;
    }

    .sheet {
      min-height: auto;
      border: none;
      border-radius: 0;
      box-shadow: none;
      padding: 0;
    }

    .print-header,
    .summary-card,
    .subtitle,
    .table-wrap {
      break-inside: avoid;
    }

    thead {
      display: table-header-group;
    }

    tr {
      break-inside: avoid;
    }
  }
</style>
</head>
<body>
  <main class="sheet">
    <header class="print-header">
      <div class="logo-box">${logoHtml}</div>

      <div class="header-main">
        <h1 class="institution-name">${escapeHtml(institutionName)}</h1>
        ${institutionMeta ? `<div class="institution-meta">${institutionMeta}</div>` : ""}
        <div class="doc-title">${escapeHtml(title)}</div>
        <div class="brand-line">
          <strong>${escapeHtml(BRAND_COMPANY)}</strong> • ${escapeHtml(BRAND_SITE)}
        </div>
      </div>

      <aside class="header-side">
        <div class="meta-row">
          <span>Document</span>
          <span>PDF</span>
        </div>
        <div class="meta-row">
          <span>Généré le</span>
          <span>${escapeHtml(generatedAtLabel())}</span>
        </div>
        <div class="meta-row">
          <span>Solution</span>
          <span>Mon Cahier</span>
        </div>
      </aside>
    </header>

    <section class="subtitle">${escapeHtml(subtitle)}</section>

    <section class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Classe</div>
        <div class="summary-value">${escapeHtml(className || "—")}</div>
        <div class="summary-note">Classe sélectionnée</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Année scolaire</div>
        <div class="summary-value">${escapeHtml(selectedAcademicYear || "—")}</div>
        <div class="summary-note">Référence annuelle</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Élèves</div>
        <div class="summary-value">${escapeHtml(matrixRows.length)}</div>
        <div class="summary-note">Lignes affichées</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Moyenne classe</div>
        <div class="summary-value">${escapeHtml(formatMaybeStar(stats.classAvg, stats.hasStar))}</div>
        <div class="summary-note">Synthèse annuelle</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Périodes</div>
        <div class="summary-value">${escapeHtml(loadedPeriods.length)}</div>
        <div class="summary-note">Périodes exploitées</div>
      </div>
    </section>

    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th rowspan="2" class="rank-col">N°</th>
            <th rowspan="2" class="matricule-col">Matricule</th>
            <th rowspan="2" class="student-col">Nom et prénoms</th>
            ${periodHeader}
            <th colspan="2">Annuel</th>
          </tr>
          <tr>${secondHeader}<th>Moy.</th><th>Rang</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>

    <footer class="footer">
      <div>
        Document généré automatiquement depuis <strong>Mon Cahier</strong>.
      </div>
      <div class="footer-right">
        ${escapeHtml(BRAND_COMPANY)} • <strong>${escapeHtml(BRAND_SITE)}</strong>
      </div>
    </footer>
  </main>
</body>
</html>`;

    const win = window.open("", "_blank");

    if (!win) {
      setErrorMsg(
        "Impossible d’ouvrir la fenêtre d’impression. Vérifiez le blocage des popups."
      );
      return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();

    setTimeout(() => {
      try {
        win.print();
      } catch {
        // silencieux
      }
    }, 400);
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-900 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200/80">
              Cahier de notes • Synthèse annuelle
            </p>

            <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
              Matrice annuelle des moyennes
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
              Les périodes sans notes publiées restent NC. Dès qu’une moyenne est calculable,
              le rang est autorisé, sauf décision NC validée par l’administration.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-200 sm:min-w-[420px]">
            <div className="rounded-2xl border border-white/10 bg-white/8 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Élèves
              </div>
              <div className="mt-1 text-xl font-bold text-white">{stats.count}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/8 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Moy. classe
              </div>
              <div className="mt-1 text-xl font-bold text-white">
                {formatMaybeStar(stats.classAvg, stats.hasStar)}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/8 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Périodes
              </div>
              <div className="mt-1 text-xl font-bold text-white">
                {loadedPeriods.length || matrixPeriods.length}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-5">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <School className="h-4 w-4" /> Classe
            </label>

            <Select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              disabled={classesLoading}
            >
              <option value="">— Sélectionner une classe —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {clsLabel(c)}
                  {c.level ? ` • ${c.level}` : ""}
                  {c.academic_year ? ` • ${c.academic_year}` : ""}
                </option>
              ))}
            </Select>
          </div>

          <div className="lg:col-span-3">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <CalendarDays className="h-4 w-4" /> Année scolaire
            </label>

            <Select
              value={selectedAcademicYear}
              onChange={(e) => setSelectedAcademicYear(e.target.value)}
              disabled={periodsLoading}
            >
              <option value="">Année courante</option>
              {academicYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap gap-2 lg:col-span-4 lg:justify-end">
            <Button onClick={loadMatrix} disabled={!selectedClassId || loadingMatrix}>
              {loadingMatrix ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {loadingMatrix ? "Chargement…" : "Charger la matrice"}
            </Button>

            <GhostButton onClick={exportCsv} disabled={!matrixRows.length}>
              <Download className="h-4 w-4" /> CSV
            </GhostButton>

            <GhostButton onClick={exportPdf} disabled={!matrixRows.length}>
              <Printer className="h-4 w-4" /> PDF
            </GhostButton>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {matrixPeriods.length ? (
            matrixPeriods.map((p) => (
              <span
                key={p.id}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600"
              >
                {periodLabel(p)} : {formatDateFR(p.start_date)} →{" "}
                {formatDateFR(p.end_date)}
              </span>
            ))
          ) : (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
              Aucune période active avec dates pour cette sélection.
            </span>
          )}
        </div>

        {periodStates.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            {periodStates.map((s) => (
              <div
                key={s.period_id}
                className={[
                  "rounded-2xl border px-3 py-2 text-xs",
                  s.status === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : s.status === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : s.status === "empty"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-slate-50 text-slate-600",
                ].join(" ")}
              >
                <div className="font-semibold">{s.label}</div>
                <div>{s.status === "pending" ? "En attente…" : s.message || s.status}</div>
              </div>
            ))}
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Tableau annuel</h2>
            <p className="text-sm text-slate-500">
              {selectedClass ? clsLabel(selectedClass) : "Aucune classe sélectionnée"} •{" "}
              {selectedAcademicYear || "année courante"}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <FileSpreadsheet className="h-4 w-4" /> {matrixRows.length} ligne(s)
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left"
                >
                  N°
                </th>

                <th
                  rowSpan={2}
                  className="sticky left-12 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left"
                >
                  Matricule
                </th>

                <th
                  rowSpan={2}
                  className="sticky left-44 z-20 min-w-[260px] border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left"
                >
                  Nom et prénoms
                </th>

                {loadedPeriods.map((p) => (
                  <th
                    key={p.id}
                    colSpan={2}
                    className="border-b border-r border-slate-200 bg-indigo-50 px-3 py-3 text-center text-indigo-800"
                  >
                    <div className="font-bold">{periodLabel(p)}</div>
                    <div className="text-[10px] font-medium normal-case text-indigo-500">
                      {formatDateFR(p.start_date)} → {formatDateFR(p.end_date)}
                    </div>
                  </th>
                ))}

                <th
                  colSpan={2}
                  className="border-b border-slate-200 bg-emerald-50 px-3 py-3 text-center text-emerald-800"
                >
                  Annuel
                </th>
              </tr>

              <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                {loadedPeriods.map((p) => (
                  <React.Fragment key={`${p.id}-sub`}>
                    <th className="border-b border-r border-slate-200 px-3 py-2 text-right">
                      Moy.
                    </th>
                    <th className="border-b border-r border-slate-200 px-3 py-2 text-right">
                      Rang
                    </th>
                  </React.Fragment>
                ))}

                <th className="border-b border-r border-slate-200 px-3 py-2 text-right">
                  Moy.
                </th>
                <th className="border-b border-slate-200 px-3 py-2 text-right">
                  Rang
                </th>
              </tr>
            </thead>

            <tbody>
              {matrixRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={3 + loadedPeriods.length * 2 + 2}
                    className="px-6 py-14 text-center text-sm text-slate-500"
                  >
                    Chargez une classe pour afficher la matrice annuelle.
                  </td>
                </tr>
              ) : (
                matrixRows.map((row, idx) => (
                  <tr
                    key={row.student_id}
                    className="group odd:bg-white even:bg-slate-50/70 hover:bg-emerald-50/50"
                  >
                    <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-inherit px-3 py-2 font-medium text-slate-600">
                      {idx + 1}
                    </td>

                    <td className="sticky left-12 z-10 border-b border-r border-slate-100 bg-inherit px-3 py-2 text-slate-600">
                      {row.matricule || "—"}
                    </td>

                    <td className="sticky left-44 z-10 min-w-[260px] border-b border-r border-slate-100 bg-inherit px-3 py-2 font-semibold text-slate-900">
                      {row.full_name}
                    </td>

                    {loadedPeriods.map((p) => {
                      const cell = row.periods[p.id] || {
                        avg: null,
                        rank: null,
                        is_complete: false,
                        status: null,
                      };

                      return (
                        <React.Fragment key={`${row.student_id}-${p.id}`}>
                          <td className="border-b border-r border-slate-100 px-3 py-2 text-right tabular-nums">
                            {formatNumber(cell.avg)}
                          </td>
                          <td className="border-b border-r border-slate-100 px-3 py-2 text-right tabular-nums">
                            {displayCellRank(cell)}
                          </td>
                        </React.Fragment>
                      );
                    })}

                    <td className="border-b border-r border-slate-100 bg-emerald-50/60 px-3 py-2 text-right font-bold tabular-nums text-emerald-900">
                      {formatAnnualNumber(row)}
                    </td>

                    <td className="border-b border-slate-100 bg-emerald-50/60 px-3 py-2 text-right font-bold tabular-nums text-emerald-900">
                      {formatAnnualRank(row)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
