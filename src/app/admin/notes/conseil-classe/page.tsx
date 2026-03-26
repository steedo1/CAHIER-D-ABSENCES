
// src/app/admin/notes/conseil-classe/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Printer, RefreshCw, FileText, School } from "lucide-react";

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

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={[
        "w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm",
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
  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    primary:
      "bg-emerald-500 text-white hover:bg-emerald-600 focus:ring-emerald-500/30 disabled:bg-emerald-300",
    ghost:
      "bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 focus:ring-slate-400/30 disabled:opacity-60",
  };
  return (
    <button
      {...props}
      className={[base, variants[variant], props.className ?? ""].join(" ")}
    />
  );
}

/* ───────── Types ───────── */

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
  coeff: number | null;
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
};

type BulletinSubject = {
  subject_id: string;
  subject_name: string;
  coeff_bulletin: number;
  include_in_average?: boolean;
};

type PerSubjectAvg = {
  subject_id: string;
  avg20: number | null;
  subject_rank?: number | null;
  teacher_name?: string | null;
  teacher_signature_png?: string | null;
};

type BulletinItemBase = {
  student_id: string;
  full_name: string;
  matricule: string | null;

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

  per_subject: PerSubjectAvg[];
  general_avg: number | null;

  annual_avg?: number | null;
  annual_rank?: number | null;
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
  items: BulletinItemBase[];
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

type CouncilMentions = {
  distinction: "excellence" | "honour" | "encouragement" | null;
  sanction:
    | "warningWork"
    | "warningConduct"
    | "blameWork"
    | "blameConduct"
    | null;
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

type CouncilStudentRow = BulletinItemWithRank & {
  conduct: ConductItem | null;
  conductOn20: number | null;
  mentions: CouncilMentions;
  appreciation: string;
};

type SubjectCouncilStat = {
  subject_id: string;
  subject_name: string;
  coeff: number;
  teacher_name: string | null;
  noted_count: number;
  not_noted_count: number;
  avg20: number | null;
  gte10: number;
  between85And10: number;
  lt85: number;
};

type PeriodSnapshot = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  valuesByStudent: Map<string, number | null>;
  ranksByStudent: Map<string, number | null>;
};

/* ───────── Helpers ───────── */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function formatDateFR(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeSex(v?: string | null): "M" | "F" | null {
  const x = String(v ?? "").trim().toLowerCase();
  if (!x) return null;
  if (["m", "masculin", "male", "garçon", "garcon", "homme"].includes(x)) return "M";
  if (["f", "féminin", "feminin", "female", "fille", "femme"].includes(x)) return "F";
  return null;
}

function periodTitle(
  period:
    | {
        code?: string | null;
        label?: string | null;
        short_label?: string | null;
      }
    | null
    | undefined
) {
  if (!period) return "Période";
  const t = (period.label || period.short_label || period.code || "").trim();
  return t || "Période";
}

function clampTo20(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 20) return 20;
  return n;
}

function ratioPct(part: number, total: number): string {
  if (!total) return "0.00%";
  return `${((part * 100) / total).toFixed(2)}%`;
}

function shortPeriodLabel(period: GradePeriod | PeriodSnapshot): string {
  const source: any = period;
  return String(source.short_label || source.label || source.code || "").trim() || "Période";
}

function sortPeriodsByDate<T extends { start_date?: string | null; end_date?: string | null }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    const sa = new Date(a.start_date || "").getTime();
    const sb = new Date(b.start_date || "").getTime();
    if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
    const ea = new Date(a.end_date || "").getTime();
    const eb = new Date(b.end_date || "").getTime();
    if (Number.isFinite(ea) && Number.isFinite(eb) && ea !== eb) return ea - eb;
    return 0;
  });
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function computeCouncilMentions(
  generalAvg: number | null | undefined,
  conductOn20: number | null | undefined
): CouncilMentions {
  let distinction: CouncilMentions["distinction"] = null;
  let sanction: CouncilMentions["sanction"] = null;

  if (generalAvg !== null && generalAvg !== undefined && Number.isFinite(generalAvg)) {
    const g = Number(generalAvg);
    if (g >= 16) distinction = "excellence";
    else if (g >= 14) distinction = "honour";
    else if (g >= 12) distinction = "encouragement";
    else if (g < 8) sanction = "blameWork";
    else if (g < 10) sanction = "warningWork";
  }

  if (conductOn20 !== null && conductOn20 !== undefined && Number.isFinite(conductOn20)) {
    const ratio = Number(conductOn20) / 20;
    if (ratio <= 0.4) sanction = "blameConduct";
    else if (ratio <= 0.6 && !sanction) sanction = "warningConduct";
  }

  return { distinction, sanction };
}

function computeCouncilAppreciationText(
  mentions: CouncilMentions,
  generalAvg: number | null | undefined,
  conductOn20: number | null | undefined
): string {
  const g =
    generalAvg !== null && generalAvg !== undefined ? Number(generalAvg) : null;
  const c =
    conductOn20 !== null && conductOn20 !== undefined && Number.isFinite(conductOn20)
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

function labelDistinction(v: CouncilMentions["distinction"]) {
  switch (v) {
    case "excellence":
      return "Excellence";
    case "honour":
      return "Tableau d’honneur";
    case "encouragement":
      return "Encouragement";
    default:
      return "—";
  }
}

function labelSanction(v: CouncilMentions["sanction"]) {
  switch (v) {
    case "warningWork":
      return "Avert. travail";
    case "warningConduct":
      return "Avert. conduite";
    case "blameWork":
      return "Blâme travail";
    case "blameConduct":
      return "Blâme conduite";
    default:
      return "—";
  }
}

function computeRanksAndStats(res: BulletinResponse | null): EnrichedBulletin | null {
  if (!res) return null;

  const itemsWithAvg: BulletinItemWithRank[] = (res.items ?? []).map((it) => {
    const perSubject = it.per_subject ?? [];
    let sum = 0;
    let sumCoeff = 0;

    (res.subjects ?? []).forEach((s) => {
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

    const fallbackAvg = sumCoeff > 0 ? sum / sumCoeff : null;
    const apiAvg =
      it.general_avg !== null && it.general_avg !== undefined
        ? Number(it.general_avg)
        : null;
    const finalAvg =
      apiAvg !== null && Number.isFinite(apiAvg) ? apiAvg : fallbackAvg;

    return {
      ...it,
      general_avg: finalAvg !== null ? round2(finalAvg) : null,
      rank: null,
    };
  });

  const withAvg = itemsWithAvg.filter(
    (it) => typeof it.general_avg === "number" && Number.isFinite(it.general_avg)
  );

  if (!withAvg.length) {
    return {
      response: res,
      items: itemsWithAvg,
      stats: { highest: null, lowest: null, classAvg: null },
    };
  }

  const sorted = [...withAvg].sort((a, b) => (b.general_avg ?? 0) - (a.general_avg ?? 0));

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

  const sumAll = withAvg.reduce((acc, it) => acc + Number(it.general_avg ?? 0), 0);

  return {
    response: res,
    items: itemsWithAvg.map((it) => ({
      ...it,
      rank: rankByStudent.get(it.student_id) ?? null,
    })),
    stats: {
      highest: sorted[0]?.general_avg ?? null,
      lowest: sorted[sorted.length - 1]?.general_avg ?? null,
      classAvg: round2(sumAll / withAvg.length),
    },
  };
}

function pickSpecificAverage(
  subjectStats: SubjectCouncilStat[],
  keywords: string[]
): string {
  const matches = subjectStats.filter((s) => {
    const name = s.subject_name.toLowerCase();
    return keywords.some((k) => name.includes(k));
  });
  if (matches.length === 0) return "—";
  return matches.map((m) => formatNumber(m.avg20)).join(" / ");
}

function officialMarkColumns(distinction: CouncilMentions["distinction"]) {
  return {
    thfe: distinction === "excellence" ? "X" : "",
    then: distinction === "honour" ? "X" : "",
    th: distinction === "encouragement" ? "X" : "",
  };
}

/* ───────── Page ───────── */

export default function ConseilClassePage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);

  const [institution, setInstitution] = useState<InstitutionSettings | null>(null);
  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);

  const [selectedAcademicYear, setSelectedAcademicYear] = useState("");
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [bulletinRaw, setBulletinRaw] = useState<BulletinResponse | null>(null);
  const [conductSummary, setConductSummary] = useState<ConductSummaryResponse | null>(null);
  const [periodSnapshots, setPeriodSnapshots] = useState<PeriodSnapshot[]>([]);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [councilDate, setCouncilDate] = useState(todayISO());
  const [chairName, setChairName] = useState("");
  const [headTeacherName, setHeadTeacherName] = useState("");
  const [educationOfficerName, setEducationOfficerName] = useState("");
  const [classDelegateName, setClassDelegateName] = useState("");

  const [analysisText, setAnalysisText] = useState("");
  const [problemsText, setProblemsText] = useState("");
  const [solutionsText, setSolutionsText] = useState("");
  const [generalObservation, setGeneralObservation] = useState("");

  useEffect(() => {
    const run = async () => {
      try {
        setClassesLoading(true);
        const res = await fetch("/api/admin/classes", { cache: "no-store" });
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
        setErrorMsg(e?.message || "Erreur lors du chargement des classes.");
      } finally {
        setClassesLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/admin/institution/settings", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        setInstitution(json as InstitutionSettings);
      } catch (e) {
        console.error(e);
      }
    };
    run();
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
        setPeriodsLoading(true);
        const params = new URLSearchParams();
        if (selectedAcademicYear) params.set("academic_year", selectedAcademicYear);
        const qs = params.toString();
        const url = "/api/admin/institution/grading-periods" + (qs ? `?${qs}` : "");
        const res = await fetch(url, { cache: "no-store" });

        if (!res.ok) {
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
        console.error(e);
        setPeriods([]);
      } finally {
        setPeriodsLoading(false);
      }
    };
    run();
  }, [selectedAcademicYear]);

  const academicYears = useMemo(() => {
    const s = new Set<string>();
    classes.forEach((c) => c.academic_year && s.add(c.academic_year));
    periods.forEach((p) => p.academic_year && s.add(p.academic_year));
    return Array.from(s).sort();
  }, [classes, periods]);

  const filteredPeriods = useMemo(() => {
    if (!selectedAcademicYear) return periods;
    return periods.filter((p) => p.academic_year === selectedAcademicYear);
  }, [periods, selectedAcademicYear]);

  const yearPeriodsSorted = useMemo(
    () => sortPeriodsByDate(filteredPeriods),
    [filteredPeriods]
  );

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) || null,
    [periods, selectedPeriodId]
  );

  useEffect(() => {
    if (!selectedPeriodId) return;
    const p = periods.find((pp) => pp.id === selectedPeriodId);
    if (!p) return;
    setDateFrom(p.start_date || "");
    setDateTo(p.end_date || "");
  }, [selectedPeriodId, periods]);

  async function fetchPeriodSnapshotsForYear(classId: string, academicYear: string) {
    const yearPeriods = sortPeriodsByDate(
      periods.filter((p) => (p.academic_year || "") === academicYear)
    );
    if (yearPeriods.length === 0) {
      setPeriodSnapshots([]);
      return;
    }

    const snapshots = await Promise.all(
      yearPeriods.map(async (p): Promise<PeriodSnapshot | null> => {
        try {
          const params = new URLSearchParams();
          params.set("class_id", classId);
          params.set("from", p.start_date);
          params.set("to", p.end_date);

          const res = await fetch(`/api/admin/grades/bulletin?${params.toString()}`, {
            cache: "no-store",
          });
          if (!res.ok) return null;
          const json = (await res.json()) as BulletinResponse;
          if (!json.ok) return null;

          const enriched = computeRanksAndStats(json);
          const valuesByStudent = new Map<string, number | null>();
          const ranksByStudent = new Map<string, number | null>();

          (enriched?.items ?? []).forEach((it) => {
            valuesByStudent.set(it.student_id, it.general_avg ?? null);
            ranksByStudent.set(it.student_id, it.rank ?? null);
          });

          return {
            id: p.id,
            label: shortPeriodLabel(p),
            start_date: p.start_date,
            end_date: p.end_date,
            valuesByStudent,
            ranksByStudent,
          };
        } catch (e) {
          console.warn("[ConseilClasse] snapshot période ignoré", e);
          return null;
        }
      })
    );

    setPeriodSnapshots(snapshots.filter((x): x is PeriodSnapshot => Boolean(x)));
  }

  async function handleLoadCouncilData() {
    setErrorMsg(null);

    if (!selectedClassId) {
      setErrorMsg("Veuillez sélectionner une classe.");
      return;
    }
    if (!dateFrom || !dateTo) {
      setErrorMsg("Veuillez choisir une période.");
      return;
    }

    try {
      setLoading(true);
      setConductSummary(null);
      setPeriodSnapshots([]);

      const params = new URLSearchParams();
      params.set("class_id", selectedClassId);
      params.set("from", dateFrom);
      params.set("to", dateTo);

      const [resBulletin, resConduct] = await Promise.all([
        fetch(`/api/admin/grades/bulletin?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/admin/conduite/averages?${params.toString()}`, { cache: "no-store" }),
      ]);

      if (!resBulletin.ok) {
        const txt = await resBulletin.text().catch(() => "");
        throw new Error(
          `Erreur bulletin (${resBulletin.status}) : ${txt || "Impossible de charger les données."}`
        );
      }

      const json = (await resBulletin.json()) as BulletinResponse;
      if (!json.ok) throw new Error("Réponse bulletin invalide.");

      setBulletinRaw(json);

      if (resConduct.ok) {
        try {
          const conductJson = (await resConduct.json()) as ConductSummaryResponse;
          if (conductJson && Array.isArray(conductJson.items)) {
            setConductSummary(conductJson);
          }
        } catch (err) {
          console.warn("[ConseilClasse] lecture conduite impossible", err);
        }
      }

      if (!headTeacherName) {
        setHeadTeacherName(json.class?.head_teacher?.display_name || "");
      }
      if (!chairName) {
        setChairName(institution?.institution_head_name || "");
      }

      const annualYear =
        selectedAcademicYear ||
        json.class?.academic_year ||
        selectedPeriod?.academic_year ||
        "";
      if (annualYear) {
        await fetchPeriodSnapshotsForYear(selectedClassId, annualYear);
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Erreur lors du chargement des données du conseil.");
    } finally {
      setLoading(false);
    }
  }

  const enriched = useMemo(() => computeRanksAndStats(bulletinRaw), [bulletinRaw]);

  const conductByStudentId = useMemo(() => {
    const map = new Map<string, ConductItem>();
    if (!conductSummary || !Array.isArray(conductSummary.items)) return map;
    conductSummary.items.forEach((it) => map.set(it.student_id, it));
    return map;
  }, [conductSummary]);

  const councilRows = useMemo<CouncilStudentRow[]>(() => {
    const totalMax = conductSummary?.total_max ?? null;
    const items = [...(enriched?.items ?? [])];

    items.sort((a, b) => {
      const avgA =
        a.general_avg !== null && a.general_avg !== undefined
          ? Number(a.general_avg)
          : -Infinity;
      const avgB =
        b.general_avg !== null && b.general_avg !== undefined
          ? Number(b.general_avg)
          : -Infinity;
      if (avgB !== avgA) return avgB - avgA;

      const rankA =
        a.rank !== null && a.rank !== undefined ? Number(a.rank) : Number.POSITIVE_INFINITY;
      const rankB =
        b.rank !== null && b.rank !== undefined ? Number(b.rank) : Number.POSITIVE_INFINITY;
      if (rankA !== rankB) return rankA - rankB;

      return (a.full_name || "").localeCompare(b.full_name || "", undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });

    return items.map((item) => {
      const conduct = conductByStudentId.get(item.student_id) || null;
      const conductOn20 =
        conduct && totalMax && Number(totalMax) > 0
          ? clampTo20(round2((Number(conduct.total || 0) * 20) / Number(totalMax)))
          : null;

      const mentions = computeCouncilMentions(item.general_avg, conductOn20);
      const appreciation = computeCouncilAppreciationText(
        mentions,
        item.general_avg,
        conductOn20
      );

      return {
        ...item,
        conduct,
        conductOn20,
        mentions,
        appreciation,
      };
    });
  }, [enriched, conductByStudentId, conductSummary]);

  const classStats = useMemo(() => {
    const effectif = councilRows.length;
    const girls = councilRows.filter(
      (r) => normalizeSex(r.sex || r.gender || null) === "F"
    ).length;
    const boys = councilRows.filter(
      (r) => normalizeSex(r.sex || r.gender || null) === "M"
    ).length;

    const validGeneral = councilRows
      .map((r) => r.general_avg)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));

    const annualVals = councilRows
      .map((r) => r.annual_avg)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));

    const excellence = councilRows.filter((r) => r.mentions.distinction === "excellence").length;
    const honour = councilRows.filter((r) => r.mentions.distinction === "honour").length;
    const encouragement = councilRows.filter(
      (r) => r.mentions.distinction === "encouragement"
    ).length;

    const warningWork = councilRows.filter((r) => r.mentions.sanction === "warningWork").length;
    const warningConduct = councilRows.filter(
      (r) => r.mentions.sanction === "warningConduct"
    ).length;
    const blameWork = councilRows.filter((r) => r.mentions.sanction === "blameWork").length;
    const blameConduct = councilRows.filter((r) => r.mentions.sanction === "blameConduct").length;

    return {
      effectif,
      girls,
      boys,
      classAvg: enriched?.stats.classAvg ?? null,
      highest: enriched?.stats.highest ?? null,
      lowest: enriched?.stats.lowest ?? null,
      above10: validGeneral.filter((v) => v >= 10).length,
      between85And10: validGeneral.filter((v) => v >= 8.5 && v < 10).length,
      below85: validGeneral.filter((v) => v < 8.5).length,
      annualClassAvg: annualVals.length
        ? round2(annualVals.reduce((a, b) => a + b, 0) / annualVals.length)
        : null,
      annualHighest: annualVals.length ? Math.max(...annualVals) : null,
      annualLowest: annualVals.length ? Math.min(...annualVals) : null,
      excellence,
      honour,
      encouragement,
      warningWork,
      warningConduct,
      blameWork,
      blameConduct,
    };
  }, [councilRows, enriched]);

  const subjectStats = useMemo<SubjectCouncilStat[]>(() => {
    const subjects = enriched?.response.subjects ?? [];
    const effectif = councilRows.length;

    return subjects
      .map((subject) => {
        const values = councilRows
          .map((row) => {
            const cell = row.per_subject?.find((ps) => ps.subject_id === subject.subject_id);
            return cell?.avg20 ?? null;
          })
          .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));

        let teacher_name: string | null = null;
        for (const row of councilRows) {
          const cell = row.per_subject?.find((ps) => ps.subject_id === subject.subject_id);
          if (cell?.teacher_name) {
            teacher_name = cell.teacher_name;
            break;
          }
        }

        return {
          subject_id: subject.subject_id,
          subject_name: subject.subject_name,
          coeff: Number(subject.coeff_bulletin ?? 0),
          teacher_name,
          noted_count: values.length,
          not_noted_count: Math.max(0, effectif - values.length),
          avg20: values.length
            ? round2(values.reduce((a, b) => a + b, 0) / values.length)
            : null,
          gte10: values.filter((v) => v >= 10).length,
          between85And10: values.filter((v) => v >= 8.5 && v < 10).length,
          lt85: values.filter((v) => v < 8.5).length,
        };
      })
      .sort((a, b) =>
        a.subject_name.localeCompare(b.subject_name, undefined, {
          sensitivity: "base",
          numeric: true,
        })
      );
  }, [enriched, councilRows]);

  const topStudents = useMemo(
    () =>
      councilRows
        .filter((r) => r.general_avg !== null && r.general_avg !== undefined)
        .slice(0, 3),
    [councilRows]
  );

  const annualMode = useMemo(
    () => councilRows.some((r) => r.annual_avg !== null && r.annual_avg !== undefined),
    [councilRows]
  );

  const currentClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) || null,
    [classes, selectedClassId]
  );

  const currentClassLabel =
    bulletinRaw?.class?.label || currentClass?.label || currentClass?.name || "Classe";

  const currentAcademicYear =
    selectedAcademicYear ||
    bulletinRaw?.class?.academic_year ||
    currentClass?.academic_year ||
    "—";

  const currentHeadTeacher =
    headTeacherName || bulletinRaw?.class?.head_teacher?.display_name || "—";

  const currentPeriodLabel = periodTitle(bulletinRaw?.period || selectedPeriod);

  const isLastPeriodOfYear = useMemo(() => {
    if (!selectedPeriod) return false;
    const last = yearPeriodsSorted[yearPeriodsSorted.length - 1];
    return Boolean(last && last.id === selectedPeriod.id);
  }, [selectedPeriod, yearPeriodsSorted]);

  const annualSheetEnabled = isLastPeriodOfYear && periodSnapshots.length > 1;

  const studentPopulationStats = useMemo(() => {
    const isAssigned = (r: CouncilStudentRow) => Boolean(r.is_assigned ?? r.is_affecte);
    const isRepeater = (r: CouncilStudentRow) => Boolean(r.is_repeater);

    const totalRepeaters = councilRows.filter(isRepeater).length;
    const girlsRepeaters = councilRows.filter(
      (r) => isRepeater(r) && normalizeSex(r.sex || r.gender || null) === "F"
    ).length;
    const boysRepeaters = councilRows.filter(
      (r) => isRepeater(r) && normalizeSex(r.sex || r.gender || null) === "M"
    ).length;

    const totalAssigned = councilRows.filter(isAssigned).length;
    const girlsAssigned = councilRows.filter(
      (r) => isAssigned(r) && normalizeSex(r.sex || r.gender || null) === "F"
    ).length;
    const boysAssigned = councilRows.filter(
      (r) => isAssigned(r) && normalizeSex(r.sex || r.gender || null) === "M"
    ).length;

    const totalNonAssigned = Math.max(0, councilRows.length - totalAssigned);
    const girlsNonAssigned = Math.max(0, classStats.girls - girlsAssigned);
    const boysNonAssigned = Math.max(0, classStats.boys - boysAssigned);

    return {
      girls: classStats.girls,
      boys: classStats.boys,
      total: councilRows.length,
      girlsRepeaters,
      boysRepeaters,
      totalRepeaters,
      girlsAssigned,
      boysAssigned,
      totalAssigned,
      girlsNonAssigned,
      boysNonAssigned,
      totalNonAssigned,
    };
  }, [councilRows, classStats]);

  const specificSubjects = useMemo(
    () => [
      { label: "FRANÇAIS", value: pickSpecificAverage(subjectStats, ["français", "francais"]) },
      { label: "ANGLAIS", value: pickSpecificAverage(subjectStats, ["anglais", "english"]) },
      { label: "PHILO", value: pickSpecificAverage(subjectStats, ["philo", "philosophie"]) },
      {
        label: "ALLESP",
        value: pickSpecificAverage(subjectStats, ["allemand", "espagnol", "espagnol", "esp"]),
      },
    ],
    [subjectStats]
  );

  const annualRecapRows = useMemo(() => {
    if (!annualSheetEnabled) return [];
    const orderedSnapshots = sortPeriodsByDate(periodSnapshots);
    return councilRows.map((row) => ({
      student_id: row.student_id,
      full_name: row.full_name,
      matricule: row.matricule,
      rank: row.rank,
      annual_avg: row.annual_avg ?? null,
      annual_rank: row.annual_rank ?? null,
      periods: orderedSnapshots.map((snap) => ({
        id: snap.id,
        label: snap.label,
        avg: snap.valuesByStudent.get(row.student_id) ?? null,
        rank: snap.ranksByStudent.get(row.student_id) ?? null,
      })),
    }));
  }, [annualSheetEnabled, councilRows, periodSnapshots]);

  const annualSheetStats = useMemo(() => {
    if (!annualSheetEnabled) return null;

    const annualRows = councilRows
      .map((row) => {
        const annualAvg = row.annual_avg;
        const mentions = computeCouncilMentions(annualAvg, null);
        return { annualAvg, mentions };
      })
      .filter(
        (row): row is { annualAvg: number; mentions: CouncilMentions } =>
          row.annualAvg !== null && row.annualAvg !== undefined && Number.isFinite(row.annualAvg)
      );

    const effectif = annualRows.length;
    const annualVals = annualRows.map((row) => row.annualAvg);

    return {
      effectif,
      above10: annualVals.filter((v) => v >= 10).length,
      between85And10: annualVals.filter((v) => v >= 8.5 && v < 10).length,
      below85: annualVals.filter((v) => v < 8.5).length,
      lowest: annualVals.length ? Math.min(...annualVals) : null,
      highest: annualVals.length ? Math.max(...annualVals) : null,
      classAvg: annualVals.length
        ? round2(annualVals.reduce((a, b) => a + b, 0) / annualVals.length)
        : null,
      excellence: annualRows.filter((row) => row.mentions.distinction === "excellence").length,
      honour: annualRows.filter((row) => row.mentions.distinction === "honour").length,
      encouragement: annualRows.filter((row) => row.mentions.distinction === "encouragement").length,
      warningWork: annualRows.filter((row) => row.mentions.sanction === "warningWork").length,
      blameWork: annualRows.filter((row) => row.mentions.sanction === "blameWork").length,
      warningConduct: 0,
      blameConduct: 0,
    };
  }, [annualSheetEnabled, councilRows]);

  const firstListChunk = useMemo(() => councilRows.slice(0, 16), [councilRows]);
  const continuationListChunks = useMemo(
    () => chunkArray(councilRows.slice(16), 22),
    [councilRows]
  );

  return (
    <>
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }

          html,
          body {
            background: #ffffff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .screen-only {
            display: none !important;
          }

          .cc-page {
            width: auto !important;
            min-height: auto !important;
          }

          .cc-page {
            page-break-after: always;
            break-after: page;
            box-shadow: none !important;
            margin: 0 !important;
            width: auto !important;
            min-height: auto !important;
          }

          .cc-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }

          .cc-table,
          .cc-table tr,
          .cc-table td,
          .cc-table th {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }

        @media screen {
          .cc-page {
            width: min(100%, 210mm);
            min-height: 297mm;
          }
        }
      `}</style>

      <div className="fixed inset-0 z-[80] overflow-auto bg-slate-100 print:static print:inset-auto print:z-auto print:overflow-visible">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 md:p-6 print:max-w-none print:p-0">
        <div className="screen-only flex flex-col gap-3 rounded-3xl border border-slate-200 bg-gradient-to-r from-emerald-50 to-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                <FileText className="h-3.5 w-3.5" />
                Conseil de classe
              </div>
              <h1 className="text-xl font-semibold text-slate-900">
                Procès-verbal du conseil de classe
              </h1>
              <p className="text-sm text-slate-600">
                Version mise à jour : mise en page officielle + fiche complémentaire ajoutée
                au dernier trimestre / semestre.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleLoadCouncilData}
                disabled={loading || !selectedClassId}
              >
                <RefreshCw className="h-4 w-4" />
                Recharger
              </Button>

              <Button
                type="button"
                onClick={() => window.print()}
                disabled={!bulletinRaw || councilRows.length === 0}
              >
                <Printer className="h-4 w-4" />
                Imprimer
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-6">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Année scolaire
              </label>
              <Select
                value={selectedAcademicYear}
                onChange={(e) => {
                  setSelectedAcademicYear(e.target.value);
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
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Période
              </label>
              <Select
                value={selectedPeriodId}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                disabled={periodsLoading || filteredPeriods.length === 0}
              >
                <option value="">
                  {filteredPeriods.length === 0 ? "Aucune période" : "Sélectionner…"}
                </option>
                {yearPeriodsSorted.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label || p.short_label || p.code || `${p.start_date} → ${p.end_date}`}
                  </option>
                ))}
              </Select>
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
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.label || c.name || "").trim() || c.id}
                  </option>
                ))}
              </Select>
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Du
              </label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Au
              </label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            <div className="md:col-span-2 flex items-end">
              <Button
                type="button"
                className="w-full"
                onClick={handleLoadCouncilData}
                disabled={loading || !selectedClassId || !dateFrom || !dateTo}
              >
                {loading ? "Chargement…" : "Charger le procès-verbal"}
              </Button>
            </div>
          </div>

          {errorMsg ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMsg}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Date du conseil
              </label>
              <Input type="date" value={councilDate} onChange={(e) => setCouncilDate(e.target.value)} />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Président du conseil
              </label>
              <Input value={chairName} onChange={(e) => setChairName(e.target.value)} />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Professeur principal
              </label>
              <Input
                value={headTeacherName}
                onChange={(e) => setHeadTeacherName(e.target.value)}
                placeholder="Nom du professeur principal"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Éducateur / Surveillant
              </label>
              <Input
                value={educationOfficerName}
                onChange={(e) => setEducationOfficerName(e.target.value)}
                placeholder="Nom"
              />
            </div>

            <div className="md:col-span-2 xl:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Délégué de classe
              </label>
              <Input
                value={classDelegateName}
                onChange={(e) => setClassDelegateName(e.target.value)}
                placeholder="Nom du délégué / représentant"
              />
            </div>

            <div className="md:col-span-2 xl:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Observation générale
              </label>
              <Input
                value={generalObservation}
                onChange={(e) => setGeneralObservation(e.target.value)}
                placeholder="Ex. Classe sérieuse, ensemble satisfaisant, discipline à renforcer…"
              />
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Problèmes relevés
              </label>
              <Textarea
                rows={6}
                value={problemsText}
                onChange={(e) => setProblemsText(e.target.value)}
                placeholder="Absences, retards, baisse de niveau, difficultés dans certaines matières…"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Propositions de solutions
              </label>
              <Textarea
                rows={6}
                value={solutionsText}
                onChange={(e) => setSolutionsText(e.target.value)}
                placeholder="Renforcement, suivi des parents, tutorat, discipline, remédiation…"
              />
            </div>
          </div>
        </div>

        {!bulletinRaw || councilRows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
              <School className="h-7 w-7 text-slate-500" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">
              Aucun procès-verbal chargé
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Choisis la classe et la période, puis clique sur{" "}
              <span className="font-medium">“Charger le procès-verbal”</span>.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <OfficialPage>
              <OfficialHeader
                institution={institution}
                title="PROCES VERBAL DE CONSEIL DE CLASSE"
                subtitle="COMPTE RENDU"
              />
              <OfficialMainTitle
                title={`PROCES VERBAL DU CONSEIL DE LA CLASSE DE ${String(currentClassLabel).toUpperCase()}`}
              />
              <OfficialPopulationSummary
                stats={studentPopulationStats}
                classLabel={currentClassLabel}
                academicYear={currentAcademicYear}
                periodLabel={currentPeriodLabel}
                councilDate={formatDateFR(councilDate)}
              />

              <OfficialSectionBar title="Liste de classe" />
              <OfficialClassListTable rows={firstListChunk} startIndex={0} />

              {continuationListChunks.length === 0 ? (
                <div className="mt-3">
                  <OfficialClassStatsBlock classStats={classStats} />
                </div>
              ) : null}
            </OfficialPage>

            {continuationListChunks.map((chunk, chunkIndex) => {
              const isLastContinuation = chunkIndex === continuationListChunks.length - 1;
              return (
                <OfficialPage key={`class-list-cont-${chunkIndex}`}>
                  {chunkIndex === 0 ? null : (
                    <div className="mb-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      Suite de la liste de classe
                    </div>
                  )}

                  <OfficialSectionBar title="Liste de classe (suite)" />
                  <OfficialClassListTable rows={chunk} startIndex={16 + chunkIndex * 22} />

                  {isLastContinuation ? (
                    <div className="mt-3">
                      <OfficialClassStatsBlock classStats={classStats} />
                    </div>
                  ) : null}
                </OfficialPage>
              );
            })}

            <OfficialPage>
              <OfficialSectionBar title="Statistiques par discipline" />
              <div className="overflow-hidden border border-slate-500">
                <table className="cc-table w-full border-collapse text-[10px]">
                  <thead>
                    <tr className="bg-slate-200">
                      <OfficialTh>Matière</OfficialTh>
                      <OfficialTh width="52px">Effectif</OfficialTh>
                      <OfficialTh width="62px">N &gt;= 10</OfficialTh>
                      <OfficialTh width="62px">%</OfficialTh>
                      <OfficialTh width="62px">10 &gt; M &gt;= 8,5</OfficialTh>
                      <OfficialTh width="62px">%</OfficialTh>
                      <OfficialTh width="62px">M &lt; 8,5</OfficialTh>
                      <OfficialTh width="62px">%</OfficialTh>
                      <OfficialTh width="60px">Moy.</OfficialTh>
                      <OfficialTh>Enseignant / Emargement</OfficialTh>
                    </tr>
                  </thead>
                  <tbody>
                    {subjectStats.map((s) => (
                      <tr key={s.subject_id} className="border-t border-slate-300">
                        <OfficialTd strong>{s.subject_name}</OfficialTd>
                        <OfficialTd center>{classStats.effectif}</OfficialTd>
                        <OfficialTd center>{s.gte10}</OfficialTd>
                        <OfficialTd center>{ratioPct(s.gte10, classStats.effectif)}</OfficialTd>
                        <OfficialTd center>{s.between85And10}</OfficialTd>
                        <OfficialTd center>{ratioPct(s.between85And10, classStats.effectif)}</OfficialTd>
                        <OfficialTd center>{s.lt85}</OfficialTd>
                        <OfficialTd center>{ratioPct(s.lt85, classStats.effectif)}</OfficialTd>
                        <OfficialTd center>{formatNumber(s.avg20)}</OfficialTd>
                        <OfficialTd>{s.teacher_name || "—"}</OfficialTd>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-[1.18fr_0.82fr]">
                <div>
                  <OfficialSectionBar title="Majors de la classe" />
                  <div className="overflow-hidden border border-slate-500">
                    <table className="cc-table w-full border-collapse text-[10px]">
                      <thead>
                        <tr className="bg-slate-200">
                          <OfficialTh width="42px">No</OfficialTh>
                          <OfficialTh>Nom et prénom</OfficialTh>
                          <OfficialTh width="96px">No matricule</OfficialTh>
                          <OfficialTh width="94px">Date de naissance</OfficialTh>
                          <OfficialTh width="60px">Moyenne</OfficialTh>
                          <OfficialTh width="46px">Rang</OfficialTh>
                        </tr>
                      </thead>
                      <tbody>
                        {topStudents.length > 0 ? (
                          topStudents.map((row, idx) => (
                            <tr key={row.student_id} className="border-t border-slate-300">
                              <OfficialTd center>{idx + 1}</OfficialTd>
                              <OfficialTd strong>{row.full_name}</OfficialTd>
                              <OfficialTd>{row.matricule || "—"}</OfficialTd>
                              <OfficialTd>{formatDateFR(row.birthdate || row.birth_date)}</OfficialTd>
                              <OfficialTd center>{formatNumber(row.general_avg)}</OfficialTd>
                              <OfficialTd center>{row.rank ?? "—"}</OfficialTd>
                            </tr>
                          ))
                        ) : (
                          <tr className="border-t border-slate-300">
                            <OfficialTd center colSpan={6}>
                              Aucun major déterminé.
                            </OfficialTd>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div>
                    <OfficialSectionBar title="Matières spécifiques" />
                    <div className="overflow-hidden border border-slate-500">
                      <table className="cc-table w-full border-collapse text-[10px]">
                        <thead>
                          <tr className="bg-slate-200">
                            {specificSubjects.map((item) => (
                              <OfficialTh key={item.label}>{item.label}</OfficialTh>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-slate-300 bg-white">
                            {specificSubjects.map((item) => (
                              <OfficialTd key={item.label} center strong>
                                {item.value}
                              </OfficialTd>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>
              </div>

              <div className="mt-4">
                <OfficialSectionBar title="Analyse" />
                <div className="mt-1 grid gap-4 md:grid-cols-2">
                  <OfficialNoteBox
                    title="Problèmes de la classe"
                    content={problemsText || "—"}
                    minHeightClass="min-h-[150px]"
                  />
                  <OfficialNoteBox
                    title="Proposition de solutions"
                    content={solutionsText || "—"}
                    minHeightClass="min-h-[150px]"
                  />
                </div>
              </div>

              <div className="mt-5 grid gap-8 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase text-slate-700">
                    Les membres du conseil
                  </div>
                  <SignatureLines count={4} />
                </div>
                <div className="grid gap-6">
                  <SimpleSignature label="Professeur principal" name={currentHeadTeacher} />
                  <SimpleSignature
                    label={institution?.institution_head_title || "Le Directeur"}
                    name={chairName || institution?.institution_head_name || ""}
                  />
                </div>
              </div>
            </OfficialPage>

            {annualSheetEnabled ? (
              <OfficialPage>
                <OfficialHeader
                  institution={institution}
                  title="PROCES VERBAL DE CONSEIL DE CLASSE"
                  subtitle="FICHE COMPLEMENTAIRE DE FIN D'ANNEE"
                />
                <OfficialMainTitle
                  title={`RECAPITULATIF DES MOYENNES GENERALES ET ANNUELLES DE ${String(currentClassLabel).toUpperCase()}`}
                />
                <div className="mb-3 grid gap-2 md:grid-cols-4 text-[10px]">
                  <OfficialMiniInfo label="Année scolaire" value={currentAcademicYear} />
                  <OfficialMiniInfo label="Classe" value={currentClassLabel} />
                  <OfficialMiniInfo label="Période du conseil" value={currentPeriodLabel} />
                  <OfficialMiniInfo label="Date du conseil" value={formatDateFR(councilDate)} />
                </div>

                <OfficialSectionBar title="Moyennes par trimestre / semestre et moyenne annuelle" />
                <div className="overflow-hidden border border-slate-500">
                  <table className="cc-table w-full border-collapse text-[10px]">
                    <thead>
                      <tr className="bg-slate-200">
                        <OfficialTh width="42px">No</OfficialTh>
                        <OfficialTh>Nom et prénom</OfficialTh>
                        <OfficialTh width="90px">Matricule</OfficialTh>
                        {sortPeriodsByDate(periodSnapshots).map((snap) => (
                          <React.Fragment key={snap.id}>
                            <OfficialTh width="66px">{shortPeriodLabel(snap)}</OfficialTh>
                            <OfficialTh width="54px">Rang</OfficialTh>
                          </React.Fragment>
                        ))}
                        <OfficialTh width="74px">Moy. ann.</OfficialTh>
                        <OfficialTh width="60px">Rang ann.</OfficialTh>
                      </tr>
                    </thead>
                    <tbody>
                      {annualRecapRows.map((row, idx) => (
                        <tr key={row.student_id} className="border-t border-slate-300">
                          <OfficialTd center>{idx + 1}</OfficialTd>
                          <OfficialTd strong>{row.full_name}</OfficialTd>
                          <OfficialTd>{row.matricule || "—"}</OfficialTd>
                          {row.periods.map((p) => (
                            <React.Fragment key={p.id}>
                              <OfficialTd center>{formatNumber(p.avg)}</OfficialTd>
                              <OfficialTd center>{p.rank ?? "—"}</OfficialTd>
                            </React.Fragment>
                          ))}
                          <OfficialTd center strong>{formatNumber(row.annual_avg)}</OfficialTd>
                          <OfficialTd center strong>{row.annual_rank ?? "—"}</OfficialTd>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {annualSheetStats ? (
                  <div className="mt-4">
                    <OfficialClassStatsBlock classStats={annualSheetStats} />
                  </div>
                ) : null}
              </OfficialPage>
            ) : null}

            <OfficialPage>
              <div className="pt-4" />
              <div className="grid grid-cols-2 gap-8">
                <SignatureLines count={4} />
                <SignatureLines count={4} />
              </div>

              <div className="mt-24 grid gap-12 md:grid-cols-2 text-[11px]">
                <SimpleSignature label="Professeur principal" name={currentHeadTeacher} />
                <SimpleSignature
                  label={`${institution?.institution_head_title || "Le Directeur"}${institution?.institution_region ? ` - ${institution.institution_region}` : ""}`}
                  name={chairName || institution?.institution_head_name || ""}
                  extra={`Aboisso, le ${formatDateFR(councilDate)}`}
                />
              </div>
            </OfficialPage>
          </div>
        )}
        </div>
      </div>
    </>
  );
}

/* ───────── Small components ───────── */

function OfficialPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="cc-page mx-auto w-full max-w-[860px] bg-white p-4 md:p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
      {children}
    </div>
  );
}

function OfficialHeader({
  institution,
  title,
  subtitle,
}: {
  institution: InstitutionSettings | null;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <div className="text-[11px] leading-5 text-slate-800">
          <div className="font-semibold">
            {institution?.ministry_name || "Ministère de l’Éducation Nationale"}
          </div>
          <div>{institution?.country_name || "République de Côte d’Ivoire"}</div>
          <div>{institution?.country_motto || "Union - Discipline - Travail"}</div>
        </div>

        <div className="flex flex-col items-center gap-1">
          {institution?.institution_logo_url ? (
            <img
              src={institution.institution_logo_url}
              alt="Logo"
              className="h-14 w-14 object-contain"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-300 text-slate-400">
              <School className="h-6 w-6" />
            </div>
          )}
          <div className="bg-slate-500 px-4 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-white">
            {title}
          </div>
          {subtitle ? (
            <div className="bg-slate-300 px-4 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-800">
              {subtitle}
            </div>
          ) : null}
        </div>

        <div className="text-right text-[11px] leading-5 text-slate-800">
          <div className="font-semibold">
            {institution?.institution_name || "Établissement"}
          </div>
          <div>{institution?.institution_region || "—"}</div>
          <div>{institution?.institution_phone || ""}</div>
          <div>{institution?.institution_email || ""}</div>
        </div>
      </div>
    </div>
  );
}

function OfficialMainTitle({ title }: { title: string }) {
  return (
    <div className="mb-3 text-center text-[18px] font-bold uppercase text-slate-900">
      {title}
    </div>
  );
}

function OfficialPopulationSummary({
  stats,
  classLabel,
  academicYear,
  periodLabel,
  councilDate,
}: {
  stats: {
    girls: number;
    boys: number;
    total: number;
    girlsRepeaters: number;
    boysRepeaters: number;
    totalRepeaters: number;
    girlsAssigned: number;
    boysAssigned: number;
    totalAssigned: number;
    girlsNonAssigned: number;
    boysNonAssigned: number;
    totalNonAssigned: number;
  };
  classLabel: string;
  academicYear: string;
  periodLabel: string;
  councilDate: string;
}) {
  return (
    <div className="mb-3 grid gap-3 md:grid-cols-[1.05fr_0.95fr]">
      <div className="border border-slate-500">
        <div className="bg-slate-200 px-2 py-1 text-[10px] font-semibold uppercase">
          Synthèse administrative
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-2 py-2 text-[10px]">
          <div><span className="font-semibold">Classe :</span> {classLabel}</div>
          <div><span className="font-semibold">Année :</span> {academicYear}</div>
          <div><span className="font-semibold">Période :</span> {periodLabel}</div>
          <div><span className="font-semibold">Date :</span> {councilDate}</div>
        </div>
      </div>

      <div className="border border-slate-500">
        <table className="cc-table w-full border-collapse text-[10px]">
          <thead>
            <tr className="bg-slate-200">
              <OfficialTh></OfficialTh>
              <OfficialTh>Filles</OfficialTh>
              <OfficialTh>Garçons</OfficialTh>
              <OfficialTh>Total</OfficialTh>
              <OfficialTh>Filles Red</OfficialTh>
              <OfficialTh>Garçons Red</OfficialTh>
              <OfficialTh>Total Red</OfficialTh>
              <OfficialTh>Filles Aff</OfficialTh>
              <OfficialTh>Garçons Aff</OfficialTh>
              <OfficialTh>Total Aff</OfficialTh>
              <OfficialTh>Filles N. Aff</OfficialTh>
              <OfficialTh>Garçons N. Aff</OfficialTh>
              <OfficialTh>Total N. Aff</OfficialTh>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-300">
              <OfficialTd strong>Total</OfficialTd>
              <OfficialTd center>{stats.girls}</OfficialTd>
              <OfficialTd center>{stats.boys}</OfficialTd>
              <OfficialTd center>{stats.total}</OfficialTd>
              <OfficialTd center>{stats.girlsRepeaters}</OfficialTd>
              <OfficialTd center>{stats.boysRepeaters}</OfficialTd>
              <OfficialTd center>{stats.totalRepeaters}</OfficialTd>
              <OfficialTd center>{stats.girlsAssigned}</OfficialTd>
              <OfficialTd center>{stats.boysAssigned}</OfficialTd>
              <OfficialTd center>{stats.totalAssigned}</OfficialTd>
              <OfficialTd center>{stats.girlsNonAssigned}</OfficialTd>
              <OfficialTd center>{stats.boysNonAssigned}</OfficialTd>
              <OfficialTd center>{stats.totalNonAssigned}</OfficialTd>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OfficialSectionBar({ title }: { title: string }) {
  return (
    <div className="mb-1 bg-slate-500 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
      {title}
    </div>
  );
}

function OfficialClassListTable({
  rows,
  startIndex = 0,
}: {
  rows: CouncilStudentRow[];
  startIndex?: number;
}) {
  return (
    <div className="overflow-hidden border border-slate-500">
      <table className="cc-table w-full border-collapse text-[10px]">
        <thead>
          <tr className="bg-slate-200 text-left">
            <OfficialTh width="36px">No</OfficialTh>
            <OfficialTh>Nom et prénom</OfficialTh>
            <OfficialTh width="96px">No Matr.</OfficialTh>
            <OfficialTh width="94px">Date de naissance</OfficialTh>
            <OfficialTh width="60px">Moyenne</OfficialTh>
            <OfficialTh width="44px">Rang</OfficialTh>
            <OfficialTh width="46px">TH+FE</OfficialTh>
            <OfficialTh width="46px">TH+EN</OfficialTh>
            <OfficialTh width="44px">TH</OfficialTh>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const marks = officialMarkColumns(row.mentions.distinction);
            return (
              <tr key={row.student_id} className="border-t border-slate-300">
                <OfficialTd center>{startIndex + idx + 1}</OfficialTd>
                <OfficialTd strong>{row.full_name}</OfficialTd>
                <OfficialTd>{row.matricule || "—"}</OfficialTd>
                <OfficialTd>{formatDateFR(row.birthdate || row.birth_date)}</OfficialTd>
                <OfficialTd center>{formatNumber(row.general_avg)}</OfficialTd>
                <OfficialTd center>{row.rank ?? "—"}</OfficialTd>
                <OfficialTd center>{marks.thfe}</OfficialTd>
                <OfficialTd center>{marks.then}</OfficialTd>
                <OfficialTd center>{marks.th}</OfficialTd>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OfficialClassStatsBlock({
  classStats,
}: {
  classStats: {
    effectif: number;
    above10: number;
    between85And10: number;
    below85: number;
    lowest: number | null;
    highest: number | null;
    classAvg: number | null;
    excellence: number;
    honour: number;
    encouragement: number;
    warningWork: number;
    blameWork: number;
    warningConduct: number;
    blameConduct: number;
  };
}) {
  return (
    <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
      <div>
        <OfficialSectionBar title="Statistiques de classe" />
        <div className="overflow-hidden border border-slate-500">
          <table className="cc-table w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-slate-200">
                <OfficialTh>Effectif classe</OfficialTh>
                <OfficialTh colSpan={2}>Moy &gt;= 10</OfficialTh>
                <OfficialTh colSpan={2}>10 &gt; M &gt;= 8,5</OfficialTh>
                <OfficialTh colSpan={2}>Moy &lt; 8,5</OfficialTh>
                <OfficialTh>Mini</OfficialTh>
                <OfficialTh>Maxi</OfficialTh>
                <OfficialTh>Moy</OfficialTh>
              </tr>
              <tr className="bg-slate-100">
                <OfficialTh></OfficialTh>
                <OfficialTh>Nombre</OfficialTh>
                <OfficialTh>%</OfficialTh>
                <OfficialTh>Nombre</OfficialTh>
                <OfficialTh>%</OfficialTh>
                <OfficialTh>Nombre</OfficialTh>
                <OfficialTh>%</OfficialTh>
                <OfficialTh></OfficialTh>
                <OfficialTh></OfficialTh>
                <OfficialTh></OfficialTh>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-300">
                <OfficialTd center>{classStats.effectif}</OfficialTd>
                <OfficialTd center>{classStats.above10}</OfficialTd>
                <OfficialTd center>{ratioPct(classStats.above10, classStats.effectif)}</OfficialTd>
                <OfficialTd center>{classStats.between85And10}</OfficialTd>
                <OfficialTd center>{ratioPct(classStats.between85And10, classStats.effectif)}</OfficialTd>
                <OfficialTd center>{classStats.below85}</OfficialTd>
                <OfficialTd center>{ratioPct(classStats.below85, classStats.effectif)}</OfficialTd>
                <OfficialTd center>{formatNumber(classStats.lowest)}</OfficialTd>
                <OfficialTd center>{formatNumber(classStats.highest)}</OfficialTd>
                <OfficialTd center>{formatNumber(classStats.classAvg)}</OfficialTd>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-3">
        <div>
          <OfficialSectionBar title="Distinctions" />
          <div className="overflow-hidden border border-slate-500">
            <table className="cc-table w-full border-collapse text-[10px]">
              <thead>
                <tr className="bg-slate-200">
                  <OfficialTh>Distinctions</OfficialTh>
                  <OfficialTh width="74px">Nombre</OfficialTh>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-300">
                  <OfficialTd>Excellence</OfficialTd>
                  <OfficialTd center>{classStats.excellence}</OfficialTd>
                </tr>
                <tr className="border-t border-slate-300">
                  <OfficialTd>Tableau d'honneur</OfficialTd>
                  <OfficialTd center>{classStats.honour}</OfficialTd>
                </tr>
                <tr className="border-t border-slate-300">
                  <OfficialTd>Encouragements</OfficialTd>
                  <OfficialTd center>{classStats.encouragement}</OfficialTd>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <OfficialSectionBar title="Avertissements et sanctions" />
          <div className="overflow-hidden border border-slate-500">
            <table className="cc-table w-full border-collapse text-[10px]">
              <thead>
                <tr className="bg-slate-200">
                  <OfficialTh>Avertissement / Travail</OfficialTh>
                  <OfficialTh width="74px">Nombre</OfficialTh>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-300">
                  <OfficialTd>Avertissement Travail</OfficialTd>
                  <OfficialTd center>{classStats.warningWork}</OfficialTd>
                </tr>
                <tr className="border-t border-slate-300">
                  <OfficialTd>Blâme Travail</OfficialTd>
                  <OfficialTd center>{classStats.blameWork}</OfficialTd>
                </tr>
                <tr className="border-t border-slate-300">
                  <OfficialTd>Avert. Conduite</OfficialTd>
                  <OfficialTd center>{classStats.warningConduct}</OfficialTd>
                </tr>
                <tr className="border-t border-slate-300">
                  <OfficialTd>Blâme Conduite</OfficialTd>
                  <OfficialTd center>{classStats.blameConduct}</OfficialTd>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function OfficialTh({
  children,
  width,
  colSpan,
}: {
  children?: React.ReactNode;
  width?: string;
  colSpan?: number;
}) {
  return (
    <th
      colSpan={colSpan}
      style={width ? { width } : undefined}
      className="border border-slate-300 px-2 py-1 text-center text-[10px] font-semibold uppercase text-slate-800"
    >
      {children}
    </th>
  );
}

function OfficialTd({
  children,
  center = false,
  strong = false,
  colSpan,
}: {
  children?: React.ReactNode;
  center?: boolean;
  strong?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={[
        "border border-slate-300 px-2 py-1 text-[10px] text-slate-800",
        center ? "text-center" : "text-left",
        strong ? "font-semibold" : "",
      ].join(" ")}
    >
      {children}
    </td>
  );
}

function OfficialNoteBox({
  title,
  content,
  minHeightClass = "min-h-[120px]",
}: {
  title?: string;
  content: string;
  minHeightClass?: string;
}) {
  return (
    <div className="border border-slate-500">
      {title ? <OfficialSectionBar title={title} /> : null}
      <div className={`${minHeightClass} whitespace-pre-wrap px-3 py-2 text-[10px] leading-5 text-slate-800`}>
        {content?.trim() || "—"}
      </div>
    </div>
  );
}

function SignatureLines({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-6">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="border-b border-dotted border-slate-400" />
      ))}
    </div>
  );
}

function SimpleSignature({
  label,
  name,
  extra,
}: {
  label: string;
  name?: string | null;
  extra?: string;
}) {
  return (
    <div className="text-[11px] text-slate-800">
      {extra ? <div className="mb-1 text-right">{extra}</div> : null}
      <div className="mb-8 border-b border-dotted border-transparent" />
      <div className="font-semibold">{label}</div>
      <div className="mt-1 uppercase">{name?.trim() || "................................"}</div>
    </div>
  );
}

function OfficialMiniInfo({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="border border-slate-400 px-2 py-1">
      <div className="text-[9px] font-semibold uppercase text-slate-500">{label}</div>
      <div className="text-[11px] font-semibold text-slate-900">{value || "—"}</div>
    </div>
  );
}
