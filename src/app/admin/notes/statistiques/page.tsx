// src/app/admin/notes/stats/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
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

type BulletinSubject = {
  subject_id: string;
  subject_name: string;
  coeff_bulletin?: number | null;
  include_in_average?: boolean | null;
};

type PerSubjectAvg = {
  subject_id: string;
  avg20: number | null;
  subject_rank?: number | null;
  teacher_name?: string | null;
  teacher_signature_png?: string | null;
};

type BulletinItem = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  per_subject?: PerSubjectAvg[];
  general_avg?: number | null;
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
  subjects?: BulletinSubject[];
  items?: BulletinItem[];
};

type CurrentAffectationItem = {
  teacher?: {
    id?: string | null;
    display_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  subject?: {
    id?: string | null;
    label?: string | null;
    name?: string | null;
  } | null;
  subject_id?: string | null;
  subject_name?: string | null;
  subject_label?: string | null;
  class_id?: string | null;
  classes?: Array<{
    id?: string | null;
    name?: string | null;
    label?: string | null;
    level?: string | null;
  }>;
};

type AffectationsResponse = {
  ok?: boolean;
  items?: CurrentAffectationItem[];
  error?: string;
};

type SubjectOption = {
  id: string;
  name: string;
  notes_count: number;
};

type MatrixCell = {
  avg: number | null;
  rank: number | null;
};

type AnnualStatus = "complete" | "partial" | "empty";

type MatrixRow = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  periods: Record<string, MatrixCell>;

  // Annuel matière : calculé uniquement avec les périodes ayant une moyenne publiée.
  // Le rang annuel n'est attribué que si l'élève est complet sur toutes les périodes affichées.
  annual_avg: number | null;
  annual_rank: number | null;
  annual_status: AnnualStatus;
  annual_available_periods: number;
  annual_expected_periods: number;
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

function formatAnnualAverage(row: MatrixRow, digits = 2) {
  if (row.annual_avg === null || row.annual_avg === undefined) return "—";
  if (!Number.isFinite(Number(row.annual_avg))) return "—";
  const value = Number(row.annual_avg).toFixed(digits);
  return row.annual_status === "partial" ? `${value}*` : value;
}

function formatAnnualRank(row: MatrixRow) {
  if (row.annual_status !== "complete") return "NC";
  return formatRank(row.annual_rank);
}

function formatDateFR(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
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

function csvCell(value: unknown) {
  const v = value === null || value === undefined ? "" : String(value);
  return `"${v.replace(/"/g, '""')}"`;
}

function cleanAvg(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function normalizeLabelForMatch(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function subjectAliasesForMatch(value: string | null | undefined): Set<string> {
  const normalized = normalizeLabelForMatch(value);
  const aliases = new Set<string>();

  if (!normalized) return aliases;

  const compact = normalized.replace(/\s+/g, "");
  aliases.add(normalized);
  aliases.add(compact);

  const stopWords = new Set([
    "a",
    "au",
    "aux",
    "d",
    "de",
    "des",
    "du",
    "et",
    "la",
    "le",
    "les",
    "l",
    "education",
    "enseignement",
    "science",
    "sciences",
  ]);

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const usefulTokens = tokens.filter((token) => !stopWords.has(token));

  usefulTokens.forEach((token) => {
    if (token.length >= 3) aliases.add(token);
  });

  const acronym = usefulTokens.map((token) => token[0]).join("");
  if (acronym.length >= 2) aliases.add(acronym);

  if (normalized.includes("mathem")) {
    aliases.add("math");
    aliases.add("maths");
    aliases.add("mathematique");
    aliases.add("mathematiques");
  }

  if (normalized.includes("francais")) aliases.add("francais");
  if (normalized.includes("anglais")) aliases.add("anglais");
  if (normalized.includes("espagnol")) aliases.add("espagnol");
  if (normalized.includes("allemand")) aliases.add("allemand");

  if (
    normalized.includes("histoire") &&
    (normalized.includes("geo") || normalized.includes("geographie"))
  ) {
    aliases.add("hg");
    aliases.add("histoire geographie");
  }

  if (normalized.includes("physique") && normalized.includes("chimie")) {
    aliases.add("pc");
    aliases.add("pct");
    aliases.add("physique chimie");
  }

  if (
    normalized === "svt" ||
    (normalized.includes("science") &&
      normalized.includes("vie") &&
      normalized.includes("terre"))
  ) {
    aliases.add("svt");
    aliases.add("science vie terre");
    aliases.add("sciences vie terre");
  }

  if (
    normalized === "eps" ||
    (normalized.includes("education") && normalized.includes("physique"))
  ) {
    aliases.add("eps");
  }

  if (
    normalized === "edhc" ||
    normalized.includes("droits humains") ||
    normalized.includes("citoyennete")
  ) {
    aliases.add("edhc");
  }

  if (normalized.includes("art") && normalized.includes("plastique")) {
    aliases.add("arts plastiques");
    aliases.add("art plastique");
  }

  if (normalized.includes("musique")) aliases.add("musique");
  if (normalized.includes("conduite")) aliases.add("conduite");

  return aliases;
}

function subjectLabelsMatch(a: string | null | undefined, b: string | null | undefined) {
  const aliasesA = subjectAliasesForMatch(a);
  const aliasesB = subjectAliasesForMatch(b);

  if (aliasesA.size === 0 || aliasesB.size === 0) return false;

  for (const alias of aliasesA) {
    if (aliasesB.has(alias)) return true;
  }

  const normalizedA = normalizeLabelForMatch(a);
  const normalizedB = normalizeLabelForMatch(b);

  if (!normalizedA || !normalizedB) return false;

  const compactA = normalizedA.replace(/\s+/g, "");
  const compactB = normalizedB.replace(/\s+/g, "");

  if (compactA.length >= 4 && compactB.length >= 4) {
    if (compactA.includes(compactB) || compactB.includes(compactA)) return true;
  }

  return false;
}

function findSubjectCell(
  item: BulletinItem,
  subject: BulletinSubject | { subject_id: string; subject_name?: string | null }
) {
  const cells = item.per_subject ?? [];
  const subjectId = String(subject.subject_id || "").trim();

  return cells.find((cell) => String(cell.subject_id || "").trim() === subjectId) || null;
}

function findBulletinSubject(
  subjects: BulletinSubject[],
  selectedSubjectId: string,
  selectedSubjectName: string
): BulletinSubject | null {
  const exact =
    subjects.find(
      (subject) =>
        String(subject.subject_id || "").trim() === String(selectedSubjectId || "").trim()
    ) || null;

  if (exact) return exact;

  return (
    subjects.find((subject) =>
      subjectLabelsMatch(subject.subject_name, selectedSubjectName)
    ) || null
  );
}

function buildRankMap(rows: Array<{ student_id: string; avg: number | null }>) {
  const valid = rows
    .filter((r) => typeof r.avg === "number" && Number.isFinite(r.avg))
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

function getAffectationSubjectId(item: CurrentAffectationItem) {
  const direct = String(item.subject?.id || item.subject_id || "").trim();
  const label = String(
    item.subject?.label || item.subject?.name || item.subject_name || item.subject_label || ""
  ).trim();

  if (direct) return direct;
  if (label) return `label:${normalizeLabelForMatch(label)}`;
  return "";
}

function getAffectationSubjectName(item: CurrentAffectationItem) {
  return String(
    item.subject?.label || item.subject?.name || item.subject_name || item.subject_label || ""
  ).trim();
}

function affectationMatchesClass(item: CurrentAffectationItem, classId: string) {
  const directClassId = String(item.class_id || "").trim();

  if (directClassId && directClassId === classId) return true;

  const classes = Array.isArray(item.classes) ? item.classes : [];
  return classes.some((c) => String(c.id || "").trim() === classId);
}

export default function AdminNotesStatsPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState("");

  const [selectedAcademicYear, setSelectedAcademicYear] = useState("");
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");

  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [subjectsMsg, setSubjectsMsg] = useState<string | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");

  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([]);
  const [loadedPeriods, setLoadedPeriods] = useState<GradePeriod[]>([]);
  const [periodStates, setPeriodStates] = useState<PeriodLoadState[]>([]);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [institution, setInstitution] = useState<InstitutionSettings | null>(null);

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) || null,
    [classes, selectedClassId]
  );

  const selectedSubject = useMemo(
    () => subjectOptions.find((s) => s.id === selectedSubjectId) || null,
    [subjectOptions, selectedSubjectId]
  );

  const selectedSubjectName = selectedSubject?.name || "Matière";

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

  const selectedPeriod = useMemo(
    () => matrixPeriods.find((p) => p.id === selectedPeriodId) || null,
    [matrixPeriods, selectedPeriodId]
  );

  const selectedPeriodIsLast = useMemo(() => {
    if (!selectedPeriodId || !matrixPeriods.length) return false;
    return matrixPeriods[matrixPeriods.length - 1]?.id === selectedPeriodId;
  }, [matrixPeriods, selectedPeriodId]);

  const periodsToDisplay = useMemo(() => {
    if (!selectedPeriod) return [];

    if (selectedPeriodIsLast && matrixPeriods.length > 1) {
      const selectedIndex = matrixPeriods.findIndex((p) => p.id === selectedPeriod.id);
      return matrixPeriods.slice(0, selectedIndex + 1);
    }

    return [selectedPeriod];
  }, [matrixPeriods, selectedPeriod, selectedPeriodIsLast]);

  const showAnnualColumns = selectedPeriodIsLast && periodsToDisplay.length > 1;

  const matrixPeriodsKey = useMemo(
    () =>
      matrixPeriods
        .map((p) => `${p.id}:${p.start_date}:${p.end_date}:${p.coeff ?? ""}`)
        .join("|"),
    [matrixPeriods]
  );

  const periodsToDisplayKey = useMemo(
    () =>
      periodsToDisplay
        .map((p) => `${p.id}:${p.start_date}:${p.end_date}:${p.coeff ?? ""}`)
        .join("|"),
    [periodsToDisplay]
  );

  const stats = useMemo(() => {
    const valid = matrixRows
      .map((r) => {
        if (showAnnualColumns) return r.annual_avg;
        const onlyPeriod = periodsToDisplay[0];
        return onlyPeriod ? r.periods[onlyPeriod.id]?.avg ?? null : null;
      })
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

    if (!valid.length) {
      return {
        count: matrixRows.length,
        classAvg: null,
        highest: null,
        lowest: null,
      };
    }

    const sum = valid.reduce((acc, n) => acc + n, 0);

    return {
      count: matrixRows.length,
      classAvg: Math.round((sum / valid.length) * 100) / 100,
      highest: Math.round(Math.max(...valid) * 100) / 100,
      lowest: Math.round(Math.min(...valid) * 100) / 100,
    };
  }, [matrixRows, periodsToDisplay, showAnnualColumns]);

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
        console.warn("[Stats] paramètres établissement indisponibles", e);
      }
    }

    loadInstitutionSettings();

    return () => {
      cancelled = true;
    };
  }, []);

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
          if (items[0].academic_year) {
            setSelectedAcademicYear(items[0].academic_year);
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setErrorMsg(e?.message || "Impossible de charger les classes.");
        }
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
    const cls = classes.find((c) => c.id === selectedClassId);

    if (cls?.academic_year) {
      setSelectedAcademicYear(cls.academic_year);
    }
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
          setSelectedPeriodId("");
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

  useEffect(() => {
    if (!matrixPeriods.length) {
      setSelectedPeriodId("");
      return;
    }

    setSelectedPeriodId((prev) => {
      if (prev && matrixPeriods.some((p) => p.id === prev)) return prev;
      return matrixPeriods[0]?.id || "";
    });
  }, [matrixPeriodsKey, matrixPeriods]);

  useEffect(() => {
    setMatrixRows([]);
    setLoadedPeriods([]);
    setPeriodStates([]);
    setErrorMsg(null);
  }, [selectedClassId, selectedAcademicYear, selectedPeriodId, selectedSubjectId]);

  useEffect(() => {
    if (!selectedClassId) {
      setSubjectOptions([]);
      setSelectedSubjectId("");
      setSubjectsMsg(null);
      return;
    }

    loadSubjectOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId, selectedAcademicYear]);

  async function fetchBulletinForPeriod(classId: string, period: GradePeriod) {
    const params = new URLSearchParams();

    params.set("class_id", classId);
    params.set("from", period.start_date);
    params.set("to", period.end_date);
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

  async function fetchAssignedSubjectsForClass(classId: string): Promise<SubjectOption[]> {
    const res = await fetch("/api/admin/affectations/current", { cache: "no-store" });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Erreur affectations ${res.status}`);
    }

    const json = (await res.json().catch(() => null)) as AffectationsResponse | null;
    const items = Array.isArray(json?.items) ? json.items : [];

    const map = new Map<string, SubjectOption>();

    for (const item of items) {
      if (!affectationMatchesClass(item, classId)) continue;

      const id = getAffectationSubjectId(item);
      const name = getAffectationSubjectName(item);

      if (!id || !name) continue;

      if (!map.has(id)) {
        map.set(id, {
          id,
          name,
          notes_count: 0,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      })
    );
  }

  async function loadSubjectOptions() {
    setSubjectsLoading(true);
    setSubjectsMsg(null);
    setSubjectOptions([]);

    if (!selectedClassId) {
      setSelectedSubjectId("");
      setSubjectsLoading(false);
      return;
    }

    try {
      const options = await fetchAssignedSubjectsForClass(selectedClassId);

      setSubjectOptions(options);

      setSelectedSubjectId((prev) => {
        if (prev && options.some((o) => o.id === prev)) return prev;
        return options[0]?.id || "";
      });

      if (!options.length) {
        setSubjectsMsg(
          "Aucune matière affectée n’a été trouvée pour cette classe. Vérifiez les attributions des enseignants."
        );
      }
    } catch (e: any) {
      setSubjectOptions([]);
      setSelectedSubjectId("");
      setSubjectsMsg(e?.message || "Impossible de charger les matières affectées.");
    } finally {
      setSubjectsLoading(false);
    }
  }

  async function loadMatrix() {
    setErrorMsg(null);
    setMatrixRows([]);
    setLoadedPeriods([]);

    if (!selectedClassId) {
      setErrorMsg("Veuillez sélectionner une classe.");
      return;
    }

    if (!selectedPeriodId || !selectedPeriod) {
      setErrorMsg("Veuillez sélectionner une période.");
      return;
    }

    if (!selectedSubjectId) {
      setErrorMsg("Veuillez sélectionner une matière affectée à la classe.");
      return;
    }

    if (!periodsToDisplay.length) {
      setErrorMsg("Aucune période valide n’est disponible pour cette sélection.");
      return;
    }

    setLoadingMatrix(true);
    setLoadedPeriods(periodsToDisplay);

    setPeriodStates(
      periodsToDisplay.map((p) => ({
        period_id: p.id,
        label: periodLabel(p),
        status: "pending",
      }))
    );

    try {
      const students = new Map<string, MatrixRow>();

      for (const period of periodsToDisplay) {
        try {
          const bulletin = await fetchBulletinForPeriod(selectedClassId, period);
          const subjects = Array.isArray(bulletin.subjects) ? bulletin.subjects : [];
          const items = Array.isArray(bulletin.items) ? bulletin.items : [];

          const subject = findBulletinSubject(
            subjects,
            selectedSubjectId,
            selectedSubjectName
          );

          if (!subject) {
            for (const item of items) {
              if (!students.has(item.student_id)) {
                students.set(item.student_id, {
                  student_id: item.student_id,
                  full_name: item.full_name || "Élève",
                  matricule: item.matricule ?? null,
                  periods: {},
                  annual_avg: null,
                  annual_rank: null,
                  annual_status: "empty",
                  annual_available_periods: 0,
                  annual_expected_periods: 0,
                });
              }

              const row = students.get(item.student_id)!;
              row.full_name = item.full_name || row.full_name;
              row.matricule = item.matricule ?? row.matricule;
              row.periods[period.id] = { avg: null, rank: null };
            }

            setPeriodStates((prev) =>
              prev.map((s) =>
                s.period_id === period.id
                  ? {
                      ...s,
                      status: "empty",
                      message: "Aucune moyenne publiée",
                    }
                  : s
              )
            );
            continue;
          }

          const subjectRows = items.map((item) => ({
            student_id: item.student_id,
            avg: cleanAvg(findSubjectCell(item, subject)?.avg20),
          }));

          const ranks = buildRankMap(subjectRows);

          const notedCount = subjectRows.filter(
            (r) => typeof r.avg === "number" && Number.isFinite(r.avg)
          ).length;

          for (const item of items) {
            if (!students.has(item.student_id)) {
              students.set(item.student_id, {
                student_id: item.student_id,
                full_name: item.full_name || "Élève",
                matricule: item.matricule ?? null,
                periods: {},
                annual_avg: null,
                annual_rank: null,
                annual_status: "empty",
                annual_available_periods: 0,
                annual_expected_periods: 0,
              });
            }

            const row = students.get(item.student_id)!;
            const avg = cleanAvg(findSubjectCell(item, subject)?.avg20);

            row.full_name = item.full_name || row.full_name;
            row.matricule = item.matricule ?? row.matricule;

            row.periods[period.id] = {
              avg,
              rank: ranks.get(item.student_id) ?? null,
            };
          }

          setPeriodStates((prev) =>
            prev.map((s) =>
              s.period_id === period.id
                ? {
                    ...s,
                    status: notedCount ? "ok" : "empty",
                    message: notedCount
                      ? `${notedCount} moyenne(s) publiée(s)`
                      : "Aucune moyenne publiée",
                  }
                : s
            )
          );
        } catch (e: any) {
          setPeriodStates((prev) =>
            prev.map((s) =>
              s.period_id === period.id
                ? {
                    ...s,
                    status: "error",
                    message: e?.message || "Erreur",
                  }
                : s
            )
          );
        }
      }

      const rows = Array.from(students.values());

      if (showAnnualColumns) {
        const expectedPeriods = periodsToDisplay.length;

        for (const row of rows) {
          let num = 0;
          let den = 0;
          let availablePeriods = 0;

          for (const period of periodsToDisplay) {
            const avg = row.periods[period.id]?.avg;

            // IMPORTANT : absence de note publiée = NC / —, jamais 0.
            // Une vraie note 0 reste un nombre et sera donc bien prise en compte.
            if (avg === null || avg === undefined || !Number.isFinite(avg)) continue;

            const coeffRaw = Number(period.coeff ?? 1);
            const coeff = Number.isFinite(coeffRaw) && coeffRaw > 0 ? coeffRaw : 1;

            num += avg * coeff;
            den += coeff;
            availablePeriods += 1;
          }

          row.annual_available_periods = availablePeriods;
          row.annual_expected_periods = expectedPeriods;
          row.annual_avg = den > 0 ? Math.round((num / den) * 100) / 100 : null;
          row.annual_status =
            availablePeriods === 0
              ? "empty"
              : availablePeriods === expectedPeriods
              ? "complete"
              : "partial";
        }

        // Rang annuel officiel uniquement si l'élève est complet sur toutes les périodes affichées.
        // Les moyennes annuelles partielles restent visibles avec astérisque et Rang = NC.
        const annualRanks = buildRankMap(
          rows.map((r) => ({
            student_id: r.student_id,
            avg: r.annual_status === "complete" ? r.annual_avg : null,
          }))
        );

        rows.forEach((row) => {
          row.annual_rank =
            row.annual_status === "complete" ? annualRanks.get(row.student_id) ?? null : null;
        });
      } else {
        rows.forEach((row) => {
          row.annual_avg = null;
          row.annual_rank = null;
          row.annual_status = "empty";
          row.annual_available_periods = 0;
          row.annual_expected_periods = 0;
        });
      }

      rows.sort((a, b) => {
        if (showAnnualColumns) {
          const order: Record<AnnualStatus, number> = {
            complete: 0,
            partial: 1,
            empty: 2,
          };

          const ao = order[a.annual_status ?? "empty"] ?? 2;
          const bo = order[b.annual_status ?? "empty"] ?? 2;
          if (ao !== bo) return ao - bo;

          const ar = a.annual_rank ?? 99999;
          const br = b.annual_rank ?? 99999;
          if (ar !== br) return ar - br;

          const aa = a.annual_avg ?? -1;
          const ba = b.annual_avg ?? -1;
          if (aa !== ba) return ba - aa;
        } else {
          const period = periodsToDisplay[0];
          const ar = period ? a.periods[period.id]?.rank ?? 99999 : 99999;
          const br = period ? b.periods[period.id]?.rank ?? 99999 : 99999;

          if (ar !== br) return ar - br;
        }

        return a.full_name.localeCompare(b.full_name, "fr", {
          sensitivity: "base",
          numeric: true,
        });
      });

      setMatrixRows(rows);

      if (!rows.length) {
        setErrorMsg("Aucun élève n’a été trouvé pour cette classe.");
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

    if (showAnnualColumns) {
      headers.push("Moyenne annuelle matière", "Rang annuel matière");
    }

    const lines = [headers.map(csvCell).join(";")];

    matrixRows.forEach((row, idx) => {
      const cells: Array<string | number | null> = [
        idx + 1,
        row.matricule || "",
        row.full_name,
      ];

      for (const p of loadedPeriods) {
        const cell = row.periods[p.id] || { avg: null, rank: null };

        cells.push(cell.avg !== null ? cell.avg.toFixed(2) : "", cell.rank ?? "");
      }

      if (showAnnualColumns) {
        cells.push(
          formatAnnualAverage(row),
          formatAnnualRank(row)
        );
      }

      lines.push(cells.map(csvCell).join(";"));
    });

    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const safeClass = clsLabel(selectedClass).replace(/[^a-z0-9_-]+/gi, "_");
    const safeSubject = selectedSubjectName.replace(/[^a-z0-9_-]+/gi, "_");
    const safeYear = (selectedAcademicYear || "annee").replace(/[^a-z0-9_-]+/gi, "_");
    const safePeriod = (selectedPeriod ? periodLabel(selectedPeriod) : "periode").replace(
      /[^a-z0-9_-]+/gi,
      "_"
    );

    const a = document.createElement("a");
    a.href = url;
    a.download = `matrice_matiere_${safeSubject}_${safeClass}_${safeYear}_${safePeriod}.csv`;

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
    const title = `Matrice matière — ${selectedSubjectName}`;
    const periodText = selectedPeriod ? periodLabel(selectedPeriod) : "Période";
    const subtitle = `${className || "Classe"} • ${selectedAcademicYear || "—"} • ${periodText}`;
    const generatedAt = generatedAtLabel();

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

    const institutionMeta = institutionMetaParts
      .map((x) => escapeHtml(x))
      .join(" • ");

    const logoHtml = logoUrl
      ? `<img src="${escapeAttr(logoUrl)}" alt="Logo établissement" />`
      : `<span>Logo</span>`;

    const periodHeader = loadedPeriods
      .map(
        (p) => `
          <th colspan="2">
            ${escapeHtml(periodLabel(p))}
            <br/>
            <span>${escapeHtml(formatDateFR(p.start_date))} — ${escapeHtml(
          formatDateFR(p.end_date)
        )}</span>
          </th>`
      )
      .join("");

    const secondHeader = loadedPeriods
      .map(() => `<th>Moy.</th><th>Rang</th>`)
      .join("");

    const annualHeader = showAnnualColumns ? `<th colspan="2">Annuel matière</th>` : "";
    const annualSecondHeader = showAnnualColumns
      ? `<th>Moy.</th><th>Rang</th>`
      : "";

    const body = matrixRows
      .map((row, idx) => {
        const periodCells = loadedPeriods
          .map((p) => {
            const cell = row.periods[p.id] || { avg: null, rank: null };

            return `<td class="num">${escapeHtml(formatNumber(cell.avg))}</td><td class="num">${escapeHtml(formatRank(
              cell.rank
            ))}</td>`;
          })
          .join("");

        const annualCells = showAnnualColumns
          ? `<td class="num strong">${escapeHtml(formatAnnualAverage(row))}</td>
             <td class="num strong">${escapeHtml(formatAnnualRank(row))}</td>`
          : "";

        return `<tr>
          <td class="num">${idx + 1}</td>
          <td>${escapeHtml(row.matricule || "")}</td>
          <td class="student-name">${escapeHtml(row.full_name)}</td>
          ${periodCells}
          ${annualCells}
        </tr>`;
      })
      .join("");

    const noteHtml = showAnnualColumns
      ? '<div class="note">* Moyenne calculée sur les périodes publiées disponibles. Rang annuel NC tant que l’année matière est incomplète.</div>'
      : "";

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
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
    height: 76px;
    width: 76px;
    border: 1px solid #cbd5e1;
    border-radius: 14px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: #94a3b8;
    font-size: 10px;
    font-weight: 800;
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
    line-height: 1.1;
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
    font-size: 10px;
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
    font-size: 9.5px;
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
    text-transform: uppercase;
    letter-spacing: 0.03em;
    text-align: center;
  }

  th span {
    color: #475569;
    font-size: 7.5px;
    font-weight: 650;
    text-transform: none;
    letter-spacing: 0;
  }

  tbody tr:nth-child(even) td {
    background: #f8fafc;
  }

  .student-name {
    font-weight: 750;
    color: #0f172a;
  }

  td.num {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  td.strong {
    font-weight: 950;
    background: #ecfdf5 !important;
    color: #065f46;
  }

  .note {
    margin-top: 8px;
    padding: 7px 9px;
    border: 1px solid #fde68a;
    border-radius: 11px;
    background: #fffbeb;
    color: #92400e;
    font-size: 9px;
    font-weight: 800;
  }

  .footer {
    margin-top: 10px;
    display: flex;
    justify-content: space-between;
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
          <span>${escapeHtml(generatedAt)}</span>
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
        <div class="summary-note">Classe concernée</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Matière</div>
        <div class="summary-value">${escapeHtml(selectedSubjectName)}</div>
        <div class="summary-note">Discipline évaluée</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Élèves</div>
        <div class="summary-value">${escapeHtml(matrixRows.length)}</div>
        <div class="summary-note">Lignes affichées</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Moyenne matière</div>
        <div class="summary-value">${escapeHtml(formatNumber(stats.classAvg))}</div>
        <div class="summary-note">Sur la sélection</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Plus forte / faible</div>
        <div class="summary-value">${escapeHtml(formatNumber(stats.highest))} / ${escapeHtml(formatNumber(stats.lowest))}</div>
        <div class="summary-note">Extrêmes observés</div>
      </div>
    </section>

    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th rowspan="2">N°</th>
            <th rowspan="2">Matricule</th>
            <th rowspan="2">Nom et prénoms</th>
            ${periodHeader}
            ${annualHeader}
          </tr>
          <tr>${secondHeader}${annualSecondHeader}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>

    ${noteHtml}

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
              Cahier de notes • Matrice matière
            </p>

            <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
              Matrice des moyennes par matière
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
              Seules les matières affectées à la classe sont proposées. Choisissez la
              période à produire ; le récap annuel apparaît uniquement sur la dernière période. Un astérisque signale une moyenne annuelle calculée avec des périodes publiées manquantes.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center text-xs text-slate-200 sm:min-w-[520px] md:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Élèves
              </div>
              <div className="mt-1 text-xl font-bold text-white">{stats.count}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Moy. matière
              </div>
              <div className="mt-1 text-xl font-bold text-white">
                {formatNumber(stats.classAvg)}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Plus forte
              </div>
              <div className="mt-1 text-xl font-bold text-white">
                {formatNumber(stats.highest)}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Périodes
              </div>
              <div className="mt-1 text-xl font-bold text-white">
                {loadedPeriods.length || periodsToDisplay.length || matrixPeriods.length}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-3">
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

          <div className="lg:col-span-2">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <CalendarDays className="h-4 w-4" /> Année
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

          <div className="lg:col-span-3">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <CalendarDays className="h-4 w-4" /> Période
            </label>

            <Select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              disabled={periodsLoading || !matrixPeriods.length}
            >
              <option value="">— Sélectionner une période —</option>

              {matrixPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodLabel(p)} • {formatDateFR(p.start_date)} →{" "}
                  {formatDateFR(p.end_date)}
                </option>
              ))}
            </Select>
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <BookOpen className="h-4 w-4" /> Matière
            </label>

            <Select
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              disabled={!selectedClassId || subjectsLoading || !subjectOptions.length}
            >
              <option value="">
                {subjectsLoading
                  ? "Chargement…"
                  : "— Matière affectée —"}
              </option>

              {subjectOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap gap-2 lg:col-span-2 lg:justify-end">
            <Button
              onClick={loadMatrix}
              disabled={
                !selectedClassId ||
                !selectedPeriodId ||
                !selectedSubjectId ||
                loadingMatrix
              }
            >
              {loadingMatrix ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {loadingMatrix ? "Chargement…" : "Charger"}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <GhostButton
            type="button"
            onClick={loadSubjectOptions}
            disabled={!selectedClassId || subjectsLoading}
          >
            {subjectsLoading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <BookOpen className="h-4 w-4" />
            )}
            Actualiser matières
          </GhostButton>

          <GhostButton onClick={exportCsv} disabled={!matrixRows.length}>
            <Download className="h-4 w-4" /> CSV
          </GhostButton>

          <GhostButton onClick={exportPdf} disabled={!matrixRows.length}>
            <Printer className="h-4 w-4" /> PDF
          </GhostButton>

          <span className="text-xs text-slate-500">
            {selectedClass ? clsLabel(selectedClass) : "Aucune classe"} •{" "}
            {selectedAcademicYear || "année courante"} •{" "}
            {selectedPeriod ? periodLabel(selectedPeriod) : "période"} •{" "}
            {selectedSubjectName}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {periodsToDisplay.length ? (
            periodsToDisplay.map((p) => (
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
              Sélectionnez une période pour produire le fichier.
            </span>
          )}

          {selectedPeriodIsLast && matrixPeriods.length > 1 && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
              Dernière période : récap annuel activé
            </span>
          )}

          {showAnnualColumns && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
              Annuel : 15.00* = calcul sur périodes publiées disponibles • rang annuel NC si incomplet
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

        {subjectsMsg && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {subjectsMsg}
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
            <h2 className="text-base font-bold text-slate-900">Tableau matière</h2>
            <p className="text-sm text-slate-500">
              {selectedSubjectName} •{" "}
              {selectedClass ? clsLabel(selectedClass) : "Aucune classe"} •{" "}
              {selectedAcademicYear || "année courante"} •{" "}
              {selectedPeriod ? periodLabel(selectedPeriod) : "période"}
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

                {showAnnualColumns && (
                  <th
                    colSpan={2}
                    className="border-b border-slate-200 bg-emerald-50 px-3 py-3 text-center text-emerald-800"
                  >
                    Annuel matière
                  </th>
                )}
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

                {showAnnualColumns && (
                  <>
                    <th className="border-b border-r border-slate-200 px-3 py-2 text-right">
                      Moy.
                    </th>
                    <th className="border-b border-slate-200 px-3 py-2 text-right">
                      Rang
                    </th>
                  </>
                )}
              </tr>
            </thead>

            <tbody>
              {matrixRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={3 + loadedPeriods.length * 2 + (showAnnualColumns ? 2 : 0)}
                    className="px-6 py-14 text-center text-sm text-slate-500"
                  >
                    Sélectionnez une classe, une période et une matière affectée, puis chargez la matrice.
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
                      const cell = row.periods[p.id] || { avg: null, rank: null };

                      return (
                        <React.Fragment key={`${row.student_id}-${p.id}`}>
                          <td className="border-b border-r border-slate-100 px-3 py-2 text-right tabular-nums">
                            {formatNumber(cell.avg)}
                          </td>
                          <td className="border-b border-r border-slate-100 px-3 py-2 text-right tabular-nums">
                            {formatRank(cell.rank)}
                          </td>
                        </React.Fragment>
                      );
                    })}

                    {showAnnualColumns && (
                      <>
                        <td
                          className="border-b border-r border-slate-100 bg-emerald-50/60 px-3 py-2 text-right font-bold tabular-nums text-emerald-900"
                          title={
                            row.annual_status === "partial"
                              ? `Moyenne calculée sur ${row.annual_available_periods}/${row.annual_expected_periods} période(s) publiée(s). Rang annuel NC tant que l’année matière est incomplète.`
                              : undefined
                          }
                        >
                          {formatAnnualAverage(row)}
                        </td>

                        <td className="border-b border-slate-100 bg-emerald-50/60 px-3 py-2 text-right font-bold tabular-nums text-emerald-900">
                          {formatAnnualRank(row)}
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {showAnnualColumns && matrixRows.some((row) => row.annual_status === "partial") && (
          <div className="border-t border-slate-100 px-5 py-3 text-xs font-medium text-amber-700">
            * Moyenne calculée sur les périodes publiées disponibles.
          </div>
        )}
      </section>
    </main>
  );
}