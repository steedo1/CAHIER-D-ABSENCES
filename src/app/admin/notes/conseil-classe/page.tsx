// src/app/admin/notes/conseil-classe/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Printer, RefreshCw, FileText, School, BarChart3, Users, X } from "lucide-react";

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
  teacher_signature_png?: string | null;
  noted_count: number;
  not_noted_count: number;
  avg20: number | null;
  gte10: number;
  between85And10: number;
  lt85: number;
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


function comparePeriods(a: GradePeriod, b: GradePeriod): number {
  const aStart = a.start_date || "";
  const bStart = b.start_date || "";
  if (aStart !== bStart) return aStart.localeCompare(bStart);
  const aEnd = a.end_date || "";
  const bEnd = b.end_date || "";
  if (aEnd !== bEnd) return aEnd.localeCompare(bEnd);
  return (a.label || a.short_label || a.code || "").localeCompare(
    b.label || b.short_label || b.code || "",
    undefined,
    { sensitivity: "base", numeric: true }
  );
}

function shortPeriodLabel(
  period:
    | {
        code?: string | null;
        label?: string | null;
        short_label?: string | null;
      }
    | null
    | undefined,
  fallbackIndex = 0
): string {
  const raw = (period?.short_label || period?.code || period?.label || "").trim();
  if (!raw) return `T${fallbackIndex + 1}`;
  const compact = raw
    .replace(/trimestre/gi, "T")
    .replace(/semestre/gi, "S")
    .replace(/période/gi, "P")
    .replace(/periode/gi, "P")
    .replace(/\s+/g, " ")
    .trim();
  return compact;
}

function annualDecisionLabel(avg: number | null | undefined): string {
  if (avg === null || avg === undefined || !Number.isFinite(Number(avg))) return "—";
  const g = Number(avg);
  if (g >= 16) return "Excellence";
  if (g >= 14) return "Tableau d’honneur";
  if (g >= 12) return "Encouragement";
  return "—";
}

function safeLine(value?: string | null): string {
  const v = String(value ?? "").trim();
  return v || "................................................";
}

function getSubjectScore(
  row: CouncilStudentRow | null | undefined,
  subjects: BulletinSubject[],
  names: string[]
): number | null {
  if (!row) return null;
  const lowered = names.map((n) => n.toLowerCase());
  const nameById = new Map(
    subjects.map((subject) => [subject.subject_id, String(subject.subject_name || "").toLowerCase()])
  );
  for (const cell of row.per_subject || []) {
    const resolved = nameById.get(cell.subject_id) || "";
    if (lowered.some((x) => resolved.includes(x))) {
      if (cell.avg20 !== null && cell.avg20 !== undefined && Number.isFinite(Number(cell.avg20))) {
        return Number(cell.avg20);
      }
    }
  }
  return null;
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [yearPeriodBulletins, setYearPeriodBulletins] = useState<Record<string, EnrichedBulletin>>({});
  const [yearRecapLoading, setYearRecapLoading] = useState(false);

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
    setYearPeriodBulletins({});

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

    const sortedPeriods = [...filteredPeriods].sort(comparePeriods);
    const isLastPeriod =
      !!selectedPeriodId &&
      sortedPeriods.length > 0 &&
      sortedPeriods[sortedPeriods.length - 1]?.id === selectedPeriodId;

    if (isLastPeriod && sortedPeriods.length > 0) {
      setYearRecapLoading(true);
      try {
        const entries = await Promise.all(
          sortedPeriods.map(async (period) => {
            if (period.id === selectedPeriodId) {
              return [period.id, computeRanksAndStats(json)] as const;
            }

            const p = new URLSearchParams();
            p.set("class_id", selectedClassId);
            p.set("from", period.start_date);
            p.set("to", period.end_date);

            try {
              const res = await fetch(`/api/admin/grades/bulletin?${p.toString()}`, {
                cache: "no-store",
              });
              if (!res.ok) return [period.id, null] as const;
              const js = (await res.json()) as BulletinResponse;
              if (!js?.ok) return [period.id, null] as const;
              return [period.id, computeRanksAndStats(js)] as const;
            } catch (err) {
              console.warn("[ConseilClasse] bulletin période ignoré", period.id, err);
              return [period.id, null] as const;
            }
          })
        );

        const map: Record<string, EnrichedBulletin> = {};
        entries.forEach(([id, data]) => {
          if (data) map[id] = data;
        });
        setYearPeriodBulletins(map);
      } finally {
        setYearRecapLoading(false);
      }
    } else {
      setYearPeriodBulletins({});
    }

    setPreviewOpen(true);
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
      let teacher_signature_png: string | null = null;
      for (const row of councilRows) {
        const cell = row.per_subject?.find((ps) => ps.subject_id === subject.subject_id);
        if (cell?.teacher_name && !teacher_name) {
          teacher_name = cell.teacher_name;
        }
        if (cell?.teacher_signature_png && !teacher_signature_png) {
          teacher_signature_png = cell.teacher_signature_png;
        }
      }

      return {
        subject_id: subject.subject_id,
        subject_name: subject.subject_name,
        coeff: Number(subject.coeff_bulletin ?? 0),
        teacher_name,
        teacher_signature_png,
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


const sortedAcademicPeriods = useMemo(
  () => [...filteredPeriods].sort(comparePeriods),
  [filteredPeriods]
);

const isLastSelectedPeriod = useMemo(() => {
  if (!selectedPeriodId) return false;
  if (sortedAcademicPeriods.length === 0) return annualMode;
  return sortedAcademicPeriods[sortedAcademicPeriods.length - 1]?.id === selectedPeriodId;
}, [selectedPeriodId, sortedAcademicPeriods, annualMode]);

const annualPeriods = useMemo(
  () => (isLastSelectedPeriod ? sortedAcademicPeriods : []),
  [isLastSelectedPeriod, sortedAcademicPeriods]
);

const annualRecapRows = useMemo(() => {
  if (!isLastSelectedPeriod || annualPeriods.length === 0) return [];

  const currentMap = new Map<string, CouncilStudentRow>(
    councilRows.map((row) => [row.student_id, row] as [string, CouncilStudentRow])
  );
  const base = new Map<
    string,
    {
      student_id: string;
      full_name: string;
      matricule: string | null;
      birthdate: string | null;
      annual_avg: number | null;
      annual_rank: number | null;
    }
  >();

  annualPeriods.forEach((period) => {
    const bulletin = yearPeriodBulletins[period.id];
    bulletin?.items?.forEach((item) => {
      const existing = base.get(item.student_id);
      const rowCurrent = currentMap.get(item.student_id);
      base.set(item.student_id, {
        student_id: item.student_id,
        full_name: item.full_name,
        matricule: item.matricule,
        birthdate: item.birthdate || item.birth_date || existing?.birthdate || null,
        annual_avg:
          rowCurrent?.annual_avg ??
          item.annual_avg ??
          existing?.annual_avg ??
          null,
        annual_rank:
          rowCurrent?.annual_rank ??
          item.annual_rank ??
          existing?.annual_rank ??
          null,
      });
    });
  });

  const rows = Array.from(base.values()).map((baseRow) => {
    const periods = annualPeriods.map((period) => {
      const item =
        yearPeriodBulletins[period.id]?.items?.find((x) => x.student_id === baseRow.student_id) ||
        null;
      return {
        period_id: period.id,
        label: shortPeriodLabel(period),
        avg: item?.general_avg ?? null,
        rank: item?.rank ?? null,
      };
    });

    const validAvgs = periods
      .map((p) => p.avg)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));

    const annual_avg =
      baseRow.annual_avg !== null && baseRow.annual_avg !== undefined
        ? Number(baseRow.annual_avg)
        : validAvgs.length
        ? round2(validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length)
        : null;

    return {
      ...baseRow,
      periods,
      annual_avg,
      annual_rank: baseRow.annual_rank,
    };
  });

  const withAnnual = rows.filter(
    (row) => row.annual_avg !== null && row.annual_avg !== undefined && Number.isFinite(row.annual_avg)
  );
  const sorted = [...withAnnual].sort((a, b) => Number(b.annual_avg) - Number(a.annual_avg));
  let lastScore: number | null = null;
  let lastRank = 0;
  const rankMap = new Map<string, number>();
  sorted.forEach((row, idx) => {
    const score = Number(row.annual_avg ?? 0);
    if (lastScore === null || score !== lastScore) {
      lastRank = idx + 1;
      lastScore = score;
    }
    rankMap.set(row.student_id, lastRank);
  });

  return rows
    .map((row) => ({
      ...row,
      annual_rank:
        row.annual_rank !== null && row.annual_rank !== undefined
          ? row.annual_rank
          : rankMap.get(row.student_id) ?? null,
    }))
    .sort((a, b) => {
      const rankA =
        a.annual_rank !== null && a.annual_rank !== undefined ? Number(a.annual_rank) : Number.POSITIVE_INFINITY;
      const rankB =
        b.annual_rank !== null && b.annual_rank !== undefined ? Number(b.annual_rank) : Number.POSITIVE_INFINITY;
      if (rankA !== rankB) return rankA - rankB;

      const avgA = a.annual_avg !== null && a.annual_avg !== undefined ? Number(a.annual_avg) : -Infinity;
      const avgB = b.annual_avg !== null && b.annual_avg !== undefined ? Number(b.annual_avg) : -Infinity;
      if (avgB !== avgA) return avgB - avgA;

      return a.full_name.localeCompare(b.full_name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
}, [isLastSelectedPeriod, annualPeriods, yearPeriodBulletins, councilRows]);

const annualRecapStats = useMemo(() => {
  const vals = annualRecapRows
    .map((row) => row.annual_avg)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));

  return {
    effectif: annualRecapRows.length,
    classAvg: vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
    highest: vals.length ? Math.max(...vals) : null,
    lowest: vals.length ? Math.min(...vals) : null,
    excellence: annualRecapRows.filter((row) => (row.annual_avg ?? -Infinity) >= 16).length,
    honour: annualRecapRows.filter(
      (row) => (row.annual_avg ?? -Infinity) >= 14 && (row.annual_avg ?? -Infinity) < 16
    ).length,
    encouragement: annualRecapRows.filter(
      (row) => (row.annual_avg ?? -Infinity) >= 12 && (row.annual_avg ?? -Infinity) < 14
    ).length,
  };
}, [annualRecapRows]);


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

const summaryCounts = useMemo(() => {
  const rows = councilRows;
  const girls = rows.filter((r) => normalizeSex(r.sex || r.gender || null) === "F");
  const boys = rows.filter((r) => normalizeSex(r.sex || r.gender || null) === "M");
  const isRep = (r: CouncilStudentRow) => !!(r.is_repeater);
  const isAff = (r: CouncilStudentRow) => !!(r.is_affecte ?? r.is_assigned);

  return {
    girls: girls.length,
    boys: boys.length,
    total: rows.length,
    girlsRep: girls.filter(isRep).length,
    boysRep: boys.filter(isRep).length,
    totalRep: rows.filter(isRep).length,
    girlsAff: girls.filter(isAff).length,
    boysAff: boys.filter(isAff).length,
    totalAff: rows.filter(isAff).length,
    girlsNonAff: girls.filter((r) => !isAff(r)).length,
    boysNonAff: boys.filter((r) => !isAff(r)).length,
    totalNonAff: rows.filter((r) => !isAff(r)).length,
  };
}, [councilRows]);

const topStudent = topStudents[0] || null;
const specificSubjects = useMemo(
  () => ({
    francais: getSubjectScore(topStudent, enriched?.response.subjects ?? [], ["français", "francais"]),
    anglais: getSubjectScore(topStudent, enriched?.response.subjects ?? [], ["anglais"]),
    philo: getSubjectScore(topStudent, enriched?.response.subjects ?? [], ["philosophie", "philo"]),
    allesp:
      getSubjectScore(topStudent, enriched?.response.subjects ?? [], ["allemand"]) ??
      getSubjectScore(topStudent, enriched?.response.subjects ?? [], ["espagnol"]),
  }),
  [topStudent, enriched]
);

const page2SubjectStats = subjectStats;

return (
  <>
    <style jsx global>{`
      :root {
        --pv-ink: #0f274f;
        --pv-grid: #9fb0c8;
        --pv-head: #dfe6ef;
        --pv-band: #7184a3;
        --pv-soft: #f7f9fc;
      }

      .pv-screen-wrap {
        max-width: 1200px;
        margin: 0 auto;
        padding: 16px;
      }

      .pv-page {
        width: 210mm;
        min-height: 297mm;
        padding: 8mm 8mm 9mm;
        box-sizing: border-box;
        background: #fff;
        color: #10233f;
        font-family: Arial, Helvetica, sans-serif;
        box-shadow: 0 10px 30px rgba(15, 39, 79, 0.12);
        page-break-after: always;
        break-after: page;
      }

      .pv-page:last-of-type {
        page-break-after: auto;
        break-after: auto;
      }

      .pv-page.compact {
        padding-top: 6mm;
      }

      .pv-grid-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 11px;
      }

      .pv-grid-table th,
      .pv-grid-table td {
        border: 1px solid var(--pv-grid);
        padding: 4px 5px;
        vertical-align: middle;
        word-break: break-word;
      }

      .pv-grid-table th {
        background: var(--pv-head);
        text-align: center;
        font-weight: 700;
      }

      .pv-band {
        background: var(--pv-band);
        color: #fff;
        font-weight: 700;
        padding: 5px 8px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.02em;
      }

      .pv-mini {
        font-size: 10px;
      }

      .pv-center {
        text-align: center;
      }

      .pv-right {
        text-align: right;
      }

      .pv-no-shadow {
        box-shadow: none;
      }

      .pv-ruled {
        min-height: 118px;
        border: 1px solid var(--pv-grid);
        background:
          linear-gradient(#ffffff, #ffffff) padding-box,
          repeating-linear-gradient(
            to bottom,
            transparent 0,
            transparent 23px,
            #d3dae5 23px,
            #d3dae5 24px
          );
      }

      .pv-sign-line {
        min-height: 28px;
        border-bottom: 1px solid #7e8ea8;
      }

      .pv-sign-empty {
        min-height: 120px;
      }

      .preview-overlay {
        background: #dfe3ea;
      }

      .preview-overlay .pv-page {
        margin: 0 auto;
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

        .preview-actions,
        .screen-only {
          display: none !important;
        }

        .pv-page {
          box-shadow: none !important;
          margin: 0 auto !important;
          page-break-after: always;
          break-after: page;
        }

        .pv-page:last-of-type {
          page-break-after: auto;
          break-after: auto;
        }
      }
    `}</style>

    <div className="pv-screen-wrap screen-only flex flex-col gap-4">
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-r from-emerald-50 to-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
              <FileText className="h-3.5 w-3.5" />
              Conseil de classe
            </div>
            <h1 className="text-xl font-semibold text-slate-900">Procès-verbal du conseil de classe</h1>
            <p className="text-sm text-slate-600">
              Modèle officiel avec logo, membres du conseil, émargement et fiche annuelle de fin d’année.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={handleLoadCouncilData} disabled={loading || !selectedClassId}>
              <RefreshCw className="h-4 w-4" />
              Recharger
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPreviewOpen(true)} disabled={!bulletinRaw || councilRows.length === 0}>
              Aperçu
            </Button>
            <Button type="button" onClick={() => { if (!previewOpen) setPreviewOpen(true); setTimeout(() => window.print(), 50); }} disabled={!bulletinRaw || councilRows.length === 0}>
              <Printer className="h-4 w-4" />
              Imprimer
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Année scolaire</label>
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
              <option value="">{academicYears.length === 0 ? "Non configuré" : "Toutes années…"}</option>
              {academicYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </Select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Période</label>
            <Select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              disabled={periodsLoading || filteredPeriods.length === 0}
            >
              <option value="">{filteredPeriods.length === 0 ? "Aucune période" : "Sélectionner…"}</option>
              {filteredPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label || p.short_label || p.code || `${p.start_date} → ${p.end_date}`}
                </option>
              ))}
            </Select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Classe</label>
            <Select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)} disabled={classesLoading}>
              <option value="">Sélectionner une classe…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{(c.label || c.name || "").trim() || c.id}</option>
              ))}
            </Select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Du</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Au</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>

          <div className="md:col-span-2 flex items-end">
            <Button type="button" className="w-full" onClick={handleLoadCouncilData} disabled={loading || !selectedClassId || !dateFrom || !dateTo}>
              {loading ? "Chargement…" : "Charger le procès-verbal"}
            </Button>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Date du conseil</label>
            <Input type="date" value={councilDate} onChange={(e) => setCouncilDate(e.target.value)} />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Professeur principal</label>
            <Input value={headTeacherName} onChange={(e) => setHeadTeacherName(e.target.value)} />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Directeur / Président</label>
            <Input value={chairName} onChange={(e) => setChairName(e.target.value)} />
          </div>

          <div className="md:col-span-3">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Problèmes de la classe</label>
            <Textarea rows={5} value={problemsText} onChange={(e) => setProblemsText(e.target.value)} placeholder="Difficultés observées…" />
          </div>

          <div className="md:col-span-3">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Propositions de solutions</label>
            <Textarea rows={5} value={solutionsText} onChange={(e) => setSolutionsText(e.target.value)} placeholder="Mesures proposées…" />
          </div>
        </div>

        {errorMsg ? (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMsg}
          </div>
        ) : null}
      </div>
    </div>

    {previewOpen && bulletinRaw && councilRows.length > 0 ? (
      <div className="preview-overlay fixed inset-0 z-[80] overflow-y-auto p-2 md:p-6">
        <div className="preview-actions sticky top-2 z-10 mb-3 flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={() => setPreviewOpen(false)}>
            <X className="h-4 w-4" />
            Fermer
          </Button>
          <Button variant="ghost" type="button" onClick={handleLoadCouncilData} disabled={loading || !selectedClassId}>
            <RefreshCw className="h-4 w-4" />
            Recharger
          </Button>
          <Button type="button" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Imprimer
          </Button>
        </div>

        <div className="flex flex-col gap-4 pb-8">
          <div className="pv-page">
            <OfficialHeader
              institution={institution}
              classLabel={currentClassLabel}
              title={`PROCES VERBAL DU CONSEIL DE LA CLASSE DE ${String(currentClassLabel || "").toUpperCase()}`}
            />

            <div className="mt-2 grid grid-cols-3 gap-3 text-[11px]">
              <div>
                <div><strong>Prof. principal :</strong> {currentHeadTeacher}</div>
                <div className="mt-1"><strong>Classe :</strong> {currentClassLabel}</div>
                <div className="mt-1"><strong>Période :</strong> {currentPeriodLabel}</div>
              </div>
              <div className="text-center">
                <div><strong>Année :</strong> {currentAcademicYear}</div>
                <div className="mt-1"><strong>Date :</strong> {formatDateFR(councilDate)}</div>
              </div>
              <div>
                <div><strong>Président :</strong> {chairName || institution?.institution_head_name || "—"}</div>
                <div className="mt-1"><strong>Observation :</strong> {generalObservation || "—"}</div>
              </div>
            </div>

            <div className="mt-3">
              <OfficialBand>Compte rendu</OfficialBand>
              <table className="pv-grid-table mt-1 pv-mini">
                <thead>
                  <tr>
                    <th></th>
                    <th>Filles</th>
                    <th>Garçons</th>
                    <th>Total</th>
                    <th>Filles Red.</th>
                    <th>Garçons Red.</th>
                    <th>Total Red.</th>
                    <th>Filles Aff.</th>
                    <th>Garçons Aff.</th>
                    <th>Total Aff.</th>
                    <th>Filles N. Aff.</th>
                    <th>Garçons N. Aff.</th>
                    <th>Total N. Aff.</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <OfficialTd strong>Total</OfficialTd>
                    <OfficialTd center>{summaryCounts.girls}</OfficialTd>
                    <OfficialTd center>{summaryCounts.boys}</OfficialTd>
                    <OfficialTd center>{summaryCounts.total}</OfficialTd>
                    <OfficialTd center>{summaryCounts.girlsRep}</OfficialTd>
                    <OfficialTd center>{summaryCounts.boysRep}</OfficialTd>
                    <OfficialTd center>{summaryCounts.totalRep}</OfficialTd>
                    <OfficialTd center>{summaryCounts.girlsAff}</OfficialTd>
                    <OfficialTd center>{summaryCounts.boysAff}</OfficialTd>
                    <OfficialTd center>{summaryCounts.totalAff}</OfficialTd>
                    <OfficialTd center>{summaryCounts.girlsNonAff}</OfficialTd>
                    <OfficialTd center>{summaryCounts.boysNonAff}</OfficialTd>
                    <OfficialTd center>{summaryCounts.totalNonAff}</OfficialTd>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3">
              <OfficialBand>Liste de classe</OfficialBand>
              <table className="pv-grid-table mt-1">
                <thead>
                  <tr>
                    <th style={{ width: "5%" }}>No</th>
                    <th style={{ width: "32%" }}>Nom et prénom</th>
                    <th style={{ width: "16%" }}>No Matr.</th>
                    <th style={{ width: "15%" }}>Date de naissance</th>
                    <th style={{ width: "9%" }}>Moyenne</th>
                    <th style={{ width: "7%" }}>Rang</th>
                    <th style={{ width: "5%" }}>TH+FE</th>
                    <th style={{ width: "5%" }}>TH+EN</th>
                    <th style={{ width: "6%" }}>TH</th>
                  </tr>
                </thead>
                <tbody>
                  {councilRows.map((row, index) => (
                    <tr key={row.student_id}>
                      <OfficialTd center>{index + 1}</OfficialTd>
                      <OfficialTd strong>{row.full_name}</OfficialTd>
                      <OfficialTd>{row.matricule || "—"}</OfficialTd>
                      <OfficialTd>{formatDateFR(row.birthdate || row.birth_date)}</OfficialTd>
                      <OfficialTd center>{formatNumber(row.general_avg)}</OfficialTd>
                      <OfficialTd center>{row.rank ?? "—"}</OfficialTd>
                      <OfficialTd center>{row.mentions.distinction === "excellence" ? "X" : ""}</OfficialTd>
                      <OfficialTd center>{row.mentions.distinction === "encouragement" ? "X" : ""}</OfficialTd>
                      <OfficialTd center>{row.mentions.distinction === "honour" ? "X" : ""}</OfficialTd>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 grid grid-cols-[1.35fr_0.95fr] gap-3">
              <div>
                <OfficialBand>Statistiques de classe</OfficialBand>
                <table className="pv-grid-table mt-1 pv-mini">
                  <thead>
                    <tr>
                      <th>Effectif classe</th>
                      <th>Moy ≥ 10<br />Nombre</th>
                      <th>Moy ≥ 10<br />%</th>
                      <th>10 &gt; M ≥ 8,5<br />Nombre</th>
                      <th>10 &gt; M ≥ 8,5<br />%</th>
                      <th>Moy &lt; 8,5<br />Nombre</th>
                      <th>Moy &lt; 8,5<br />%</th>
                      <th>Mini</th>
                      <th>Maxi</th>
                      <th>Moy.</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <OfficialTd center>{classStats.effectif}</OfficialTd>
                      <OfficialTd center>{classStats.above10}</OfficialTd>
                      <OfficialTd center>
                        {classStats.effectif ? formatNumber((classStats.above10 * 100) / classStats.effectif) + "%" : "0.00%"}
                      </OfficialTd>
                      <OfficialTd center>{Math.max(0, classStats.effectif - classStats.above10 - classStats.below85)}</OfficialTd>
                      <OfficialTd center>
                        {classStats.effectif
                          ? formatNumber((Math.max(0, classStats.effectif - classStats.above10 - classStats.below85) * 100) / classStats.effectif) + "%"
                          : "0.00%"}
                      </OfficialTd>
                      <OfficialTd center>{classStats.below85}</OfficialTd>
                      <OfficialTd center>
                        {classStats.effectif ? formatNumber((classStats.below85 * 100) / classStats.effectif) + "%" : "0.00%"}
                      </OfficialTd>
                      <OfficialTd center>{formatNumber(classStats.lowest)}</OfficialTd>
                      <OfficialTd center>{formatNumber(classStats.highest)}</OfficialTd>
                      <OfficialTd center>{formatNumber(classStats.classAvg)}</OfficialTd>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <OfficialBand>Distinctions</OfficialBand>
                  <table className="pv-grid-table mt-1 pv-mini">
                    <thead>
                      <tr>
                        <th>Distinctions</th>
                        <th style={{ width: "28%" }}>Nombre</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><OfficialTd>TH</OfficialTd><OfficialTd center>{classStats.honour}</OfficialTd></tr>
                      <tr><OfficialTd>TH + Encouragements</OfficialTd><OfficialTd center>{classStats.encouragement}</OfficialTd></tr>
                      <tr><OfficialTd>TH + Félicitations</OfficialTd><OfficialTd center>{classStats.excellence}</OfficialTd></tr>
                    </tbody>
                  </table>
                </div>

                <div>
                  <OfficialBand>Avertissements et sanctions</OfficialBand>
                  <table className="pv-grid-table mt-1 pv-mini">
                    <thead>
                      <tr>
                        <th>Avertissement / Travail</th>
                        <th style={{ width: "28%" }}>Nombre</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><OfficialTd>Avertissement Travail</OfficialTd><OfficialTd center>{classStats.warningWork}</OfficialTd></tr>
                      <tr><OfficialTd>Blâme Travail</OfficialTd><OfficialTd center>{classStats.blameWork}</OfficialTd></tr>
                      <tr><OfficialTd>Avert. Conduite</OfficialTd><OfficialTd center>{classStats.warningConduct}</OfficialTd></tr>
                      <tr><OfficialTd>Blâme Conduite</OfficialTd><OfficialTd center>{classStats.blameConduct}</OfficialTd></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="pv-page compact">
            <OfficialBand>Statistiques par discipline</OfficialBand>
            <table className="pv-grid-table mt-1 pv-mini">
              <thead>
                <tr>
                  <th style={{ width: "21%" }}>Matière</th>
                  <th style={{ width: "8%" }}>Effectif</th>
                  <th style={{ width: "8%" }}>N ≥ 10</th>
                  <th style={{ width: "8%" }}>%</th>
                  <th style={{ width: "10%" }}>10 &gt; M ≥ 8,5</th>
                  <th style={{ width: "8%" }}>%</th>
                  <th style={{ width: "8%" }}>M &lt; 8,5</th>
                  <th style={{ width: "8%" }}>%</th>
                  <th style={{ width: "8%" }}>Moy.</th>
                  <th style={{ width: "13%" }}>Enseignant / Émargement</th>
                </tr>
              </thead>
              <tbody>
                {page2SubjectStats.map((s) => (
                  <tr key={s.subject_id}>
                    <OfficialTd strong>{s.subject_name}</OfficialTd>
                    <OfficialTd center>{classStats.effectif}</OfficialTd>
                    <OfficialTd center>{s.gte10}</OfficialTd>
                    <OfficialTd center>{classStats.effectif ? formatNumber((s.gte10 * 100) / classStats.effectif) + "%" : "0.00%"}</OfficialTd>
                    <OfficialTd center>{s.between85And10}</OfficialTd>
                    <OfficialTd center>{classStats.effectif ? formatNumber((s.between85And10 * 100) / classStats.effectif) + "%" : "0.00%"}</OfficialTd>
                    <OfficialTd center>{s.lt85}</OfficialTd>
                    <OfficialTd center>{classStats.effectif ? formatNumber((s.lt85 * 100) / classStats.effectif) + "%" : "0.00%"}</OfficialTd>
                    <OfficialTd center>{formatNumber(s.avg20)}</OfficialTd>
                    <OfficialTd>
                      <div className="min-h-[34px]">
                        {s.teacher_signature_png ? (
                          <img src={s.teacher_signature_png} alt="" className="mb-1 h-5 max-w-full object-contain" />
                        ) : null}
                        <div>{s.teacher_name || "—"}</div>
                      </div>
                    </OfficialTd>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3 grid grid-cols-[1.1fr_0.9fr] gap-3">
              <div>
                <OfficialBand>Majors de la classe</OfficialBand>
                <table className="pv-grid-table mt-1">
                  <thead>
                    <tr>
                      <th style={{ width: "8%" }}>No</th>
                      <th>Nom et prénom</th>
                      <th style={{ width: "18%" }}>No matricule</th>
                      <th style={{ width: "18%" }}>Date de naissance</th>
                      <th style={{ width: "12%" }}>Moyenne</th>
                      <th style={{ width: "10%" }}>Rang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topStudent ? (
                      <tr>
                        <OfficialTd center>1</OfficialTd>
                        <OfficialTd strong>{topStudent.full_name}</OfficialTd>
                        <OfficialTd>{topStudent.matricule || "—"}</OfficialTd>
                        <OfficialTd>{formatDateFR(topStudent.birthdate || topStudent.birth_date)}</OfficialTd>
                        <OfficialTd center>{formatNumber(topStudent.general_avg)}</OfficialTd>
                        <OfficialTd center>{topStudent.rank ?? "—"}</OfficialTd>
                      </tr>
                    ) : (
                      <tr>
                        <OfficialTd colSpan={6} center>Aucun major disponible.</OfficialTd>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div>
                <OfficialBand>Matières spécifiques</OfficialBand>
                <table className="pv-grid-table mt-1 pv-mini">
                  <thead>
                    <tr>
                      <th>Français</th>
                      <th>Anglais</th>
                      <th>Philo</th>
                      <th>All/Esp</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <OfficialTd center>{formatNumber(specificSubjects.francais)}</OfficialTd>
                      <OfficialTd center>{formatNumber(specificSubjects.anglais)}</OfficialTd>
                      <OfficialTd center>{formatNumber(specificSubjects.philo)}</OfficialTd>
                      <OfficialTd center>{formatNumber(specificSubjects.allesp)}</OfficialTd>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3">
              <OfficialBand>Analyse</OfficialBand>
              <div className="mt-1 grid grid-cols-2 gap-3">
                <div>
                  <div className="pv-band">Problèmes de la classe</div>
                  <div className="pv-ruled p-3 text-[11px] leading-6">{problemsText?.trim() || "—"}</div>
                </div>
                <div>
                  <div className="pv-band">Proposition de solutions</div>
                  <div className="pv-ruled p-3 text-[11px] leading-6">{solutionsText?.trim() || "—"}</div>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <OfficialBand>Les membres du conseil</OfficialBand>
              <div className="border p-3 text-[11px]" style={{ borderColor: "var(--pv-grid)" }}>
                <div className="grid grid-cols-2 gap-x-10 gap-y-3">
                  <MemberLine label="Président / Directeur" value={chairName || institution?.institution_head_name} />
                  <MemberLine label="Professeur principal" value={currentHeadTeacher} />
                  <MemberLine label="Éducateur / Surveillant" value={educationOfficerName} />
                  <MemberLine label="Délégué / Représentant" value={classDelegateName} />
                </div>
              </div>
            </div>
          </div>

          <div className="pv-page">
            <OfficialHeader
              institution={institution}
              classLabel={currentClassLabel}
              title={`PROCES VERBAL DU CONSEIL DE LA CLASSE DE ${String(currentClassLabel || "").toUpperCase()}`}
            />

            <div className="mt-4 flex min-h-[235mm] flex-col justify-between text-[12px]">
              <div className="flex justify-end">
                <div className="grid w-[42%] grid-cols-2 gap-6">
                  <BlankLines count={4} />
                  <BlankLines count={4} />
                </div>
              </div>

              <div className="grid grid-cols-2 items-end gap-10 pb-8">
                <div>
                  <div className="mb-1 font-semibold">Professeur principal</div>
                  <div className="pv-sign-empty" />
                  <div className="text-[13px]">{currentHeadTeacher || "—"}</div>
                </div>

                <div className="text-right">
                  <div className="mb-6">
                    {(institution?.institution_region || "").trim()
                      ? `${institution?.institution_region}, le ${formatDateFR(councilDate)}`
                      : formatDateFR(councilDate)}
                  </div>
                  <div className="mb-1 font-semibold">
                    {institution?.institution_head_title || "Le Directeur"}
                  </div>
                  <div className="pv-sign-empty" />
                  <div className="text-[13px]">{chairName || institution?.institution_head_name || "—"}</div>
                </div>
              </div>
            </div>
          </div>

          {annualPeriods.length > 0 && annualRecapRows.length > 0 ? (
            <div className="pv-page">
              <OfficialHeader
                institution={institution}
                classLabel={currentClassLabel}
                title={`FICHE RECAPITULATIVE ANNUELLE DE LA CLASSE DE ${String(currentClassLabel || "").toUpperCase()}`}
              />

              <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                <div><strong>Périodes prises en compte :</strong> {annualPeriods.map((p, idx) => shortPeriodLabel(p, idx)).join(" • ")}</div>
                <div className="text-right">
                  <strong>Moyenne annuelle de classe :</strong> {formatNumber(annualRecapStats.classAvg)}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-5 gap-2 text-[11px]">
                <QuickCell label="Effectif" value={String(annualRecapStats.effectif)} />
                <QuickCell label="1re annuelle" value={formatNumber(annualRecapStats.highest)} />
                <QuickCell label="Dernière annuelle" value={formatNumber(annualRecapStats.lowest)} />
                <QuickCell label="TH" value={String(annualRecapStats.honour)} />
                <QuickCell label="TH + Enc./Fél." value={String(annualRecapStats.encouragement + annualRecapStats.excellence)} />
              </div>

              <div className="mt-3">
                <OfficialBand>Récapitulatif des moyennes générales et annuelles</OfficialBand>
                <table className="pv-grid-table mt-1 pv-mini">
                  <thead>
                    <tr>
                      <th style={{ width: "4%" }}>No</th>
                      <th style={{ width: "24%" }}>Nom et prénom</th>
                      <th style={{ width: "12%" }}>No Matr.</th>
                      {annualPeriods.map((p, idx) => (
                        <React.Fragment key={p.id}>
                          <th style={{ width: "7%" }}>{shortPeriodLabel(p, idx)}<br />Moy.</th>
                          <th style={{ width: "5%" }}>{shortPeriodLabel(p, idx)}<br />Rg</th>
                        </React.Fragment>
                      ))}
                      <th style={{ width: "8%" }}>Moy. ann.</th>
                      <th style={{ width: "6%" }}>Rg ann.</th>
                      <th style={{ width: "12%" }}>Décision annuelle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {annualRecapRows.map((row, index) => (
                      <tr key={row.student_id}>
                        <OfficialTd center>{index + 1}</OfficialTd>
                        <OfficialTd strong>{row.full_name}</OfficialTd>
                        <OfficialTd>{row.matricule || "—"}</OfficialTd>
                        {row.periods.map((p) => (
                          <React.Fragment key={p.period_id}>
                            <OfficialTd center>{formatNumber(p.avg)}</OfficialTd>
                            <OfficialTd center>{p.rank ?? "—"}</OfficialTd>
                          </React.Fragment>
                        ))}
                        <OfficialTd center strong>{formatNumber(row.annual_avg)}</OfficialTd>
                        <OfficialTd center>{row.annual_rank ?? "—"}</OfficialTd>
                        <OfficialTd center>{annualDecisionLabel(row.annual_avg)}</OfficialTd>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <OfficialBand>Distinctions annuelles</OfficialBand>
                  <table className="pv-grid-table mt-1 pv-mini">
                    <thead>
                      <tr>
                        <th>Libellé</th>
                        <th style={{ width: "25%" }}>Nombre</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><OfficialTd>Tableau d’honneur</OfficialTd><OfficialTd center>{annualRecapStats.honour}</OfficialTd></tr>
                      <tr><OfficialTd>Encouragement</OfficialTd><OfficialTd center>{annualRecapStats.encouragement}</OfficialTd></tr>
                      <tr><OfficialTd>Excellence</OfficialTd><OfficialTd center>{annualRecapStats.excellence}</OfficialTd></tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <OfficialBand>Observations</OfficialBand>
                  <div className="pv-ruled p-3 text-[11px] leading-6">
                    {yearRecapLoading
                      ? "Calcul du récapitulatif annuel en cours…"
                      : `Cette fiche récapitulative est ajoutée au conseil du dernier trimestre afin d’afficher T1, T2, T3 et la moyenne annuelle.`}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    ) : null}
  </>
  );
}

/* ───────── Small components ───────── */

function OfficialHeader({
  institution,
  classLabel,
  title,
}: {
  institution: InstitutionSettings | null;
  classLabel: string;
  title: string;
}) {
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <div className="text-[10px] leading-4">
          <div className="font-bold uppercase">{institution?.country_name || "République"}</div>
          <div>{institution?.country_motto || ""}</div>
        </div>

        <div className="flex justify-center">
          {institution?.institution_logo_url ? (
            <img
              src={institution.institution_logo_url}
              alt="Logo établissement"
              className="h-16 w-16 object-contain"
            />
          ) : (
            <div className="h-16 w-16 rounded-full border border-slate-300" />
          )}
        </div>

        <div className="text-right text-[10px] leading-4">
          <div className="font-bold uppercase">{institution?.ministry_name || "Ministère"}</div>
          <div>{institution?.institution_name || ""}</div>
          <div>{institution?.institution_code ? `Code : ${institution.institution_code}` : ""}</div>
        </div>
      </div>

      <h1 className="mt-2 text-center text-[16px] font-bold uppercase tracking-[0.02em]">
        {title}
      </h1>
    </div>
  );
}

function OfficialBand({ children }: { children: React.ReactNode }) {
  return <div className="pv-band">{children}</div>;
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
        center ? "pv-center" : "",
        strong ? "font-bold" : "",
      ].join(" ")}
    >
      {children}
    </td>
  );
}

function MemberLine({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="font-semibold">{label}</div>
      <div className="mt-1 border-b border-slate-400 pb-1">{safeLine(value)}</div>
    </div>
  );
}

function BlankLines({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="border-b border-slate-400 pb-3" />
      ))}
    </div>
  );
}

function QuickCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border px-2 py-2 text-center text-[11px]" style={{ borderColor: "var(--pv-grid)", background: "var(--pv-soft)" }}>
      <div className="font-semibold uppercase">{label}</div>
      <div className="mt-1 text-[13px] font-bold">{value}</div>
    </div>
  );
}
