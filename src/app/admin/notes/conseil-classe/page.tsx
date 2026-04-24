// src/app/admin/notes/conseil-classe/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Printer, RefreshCw, FileText, X } from "lucide-react";

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
  bulletin_signatures_enabled?: boolean | null;
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
  photo_url?: string | null;

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


type CurrentAffectationItem = {
  teacher: {
    id: string;
    display_name: string | null;
    email: string | null;
    phone: string | null;
  };
  subject: {
    id: string | null;
    label: string;
  };
  classes: Array<{
    id: string;
    name: string | null;
    level: string | null;
  }>;
};

/* ───────── Helpers ───────── */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function formatPercent(part: number, total: number): string {
  if (!total) return "0.00%";
  return `${formatNumber((part * 100) / total)}%`;
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

function normalizeLabelForMatch(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  const [currentAffectations, setCurrentAffectations] = useState<CurrentAffectationItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [councilDate, setCouncilDate] = useState(todayISO());
  const [chairName, setChairName] = useState("");
  const [headTeacherName, setHeadTeacherName] = useState("");
  const [generalObservation, setGeneralObservation] = useState("");
  const [problemsText, setProblemsText] = useState("");
  const [solutionsText, setSolutionsText] = useState("");
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
      setCurrentAffectations([]);
      setYearPeriodBulletins({});

      const params = new URLSearchParams();
      params.set("class_id", selectedClassId);
      params.set("from", dateFrom);
      params.set("to", dateTo);

      const [resBulletin, resConduct, resAffectations] = await Promise.all([
        fetch(`/api/admin/grades/bulletin?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/admin/conduite/averages?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/admin/affectations/current`, { cache: "no-store" }),
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

      if (resAffectations.ok) {
        try {
          const affectationsJson = (await resAffectations.json()) as {
            items?: CurrentAffectationItem[];
          };
          setCurrentAffectations(
            Array.isArray(affectationsJson?.items) ? affectationsJson.items : []
          );
        } catch (err) {
          console.warn("[ConseilClasse] lecture affectations impossible", err);
          setCurrentAffectations([]);
        }
      } else {
        console.warn("[ConseilClasse] affectations/current indisponible", resAffectations.status);
        setCurrentAffectations([]);
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

    const between85And10 = validGeneral.filter((v) => v >= 8.5 && v < 10).length;

    return {
      effectif,
      classed: validGeneral.length,
      girls,
      boys,
      classAvg: enriched?.stats.classAvg ?? null,
      highest: enriched?.stats.highest ?? null,
      lowest: enriched?.stats.lowest ?? null,
      above10: validGeneral.filter((v) => v >= 10).length,
      between85And10,
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

  const effectiveSubjects = useMemo<BulletinSubject[]>(() => {
    const subjectMetaById = new Map<string, BulletinSubject>(
      (enriched?.response.subjects ?? []).map((subject) => [subject.subject_id, subject])
    );
    const seen = new Set<string>();
    const subjects: BulletinSubject[] = [];

    councilRows.forEach((row) => {
      (row.per_subject ?? []).forEach((ps) => {
        const subjectId = String(ps?.subject_id ?? "").trim();
        const avg = ps?.avg20;
        if (avg === null || avg === undefined || !Number.isFinite(Number(avg))) return;
        if (!subjectId || seen.has(subjectId)) return;
        seen.add(subjectId);

        const meta = subjectMetaById.get(subjectId);
        subjects.push({
          subject_id: subjectId,
          subject_name: meta?.subject_name || "Discipline",
          coeff_bulletin: Number(meta?.coeff_bulletin ?? 0),
          include_in_average: meta?.include_in_average,
        });
      });
    });

    return subjects.sort((a, b) =>
      a.subject_name.localeCompare(b.subject_name, undefined, {
        sensitivity: "base",
        numeric: true,
      })
    );
  }, [enriched, councilRows]);

  const subjectStats = useMemo<SubjectCouncilStat[]>(() => {
    const effectif = councilRows.length;

    return effectiveSubjects
      .map((subject) => {
        const values = councilRows
          .map((row) => {
            const cell = row.per_subject?.find((ps) => ps.subject_id === subject.subject_id);
            const value = cell?.avg20;
            return value === null || value === undefined ? null : Number(value);
          })
          .filter((v): v is number => v !== null && Number.isFinite(v));

        let teacher_name: string | null = null;
        let teacher_signature_png: string | null = null;
        for (const row of councilRows) {
          const cell = row.per_subject?.find((ps) => ps.subject_id === subject.subject_id);
          const cellAvg = cell?.avg20;
          if (cellAvg === null || cellAvg === undefined || !Number.isFinite(Number(cellAvg))) continue;
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
      .filter((stat) => stat.noted_count > 0);
  }, [effectiveSubjects, councilRows]);

  const councilTeacherRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        teacherName: string;
        subjects: Set<string>;
      }
    >();

    const addTeacherSubject = (teacherNameRaw: string | null | undefined, subjectRaw: string | null | undefined) => {
      const teacherName = String(teacherNameRaw || "").trim();
      const subjectLabel = String(subjectRaw || "").trim();
      if (!teacherName) return;

      const key = normalizeLabelForMatch(teacherName) || teacherName;
      const existing = grouped.get(key);
      if (existing) {
        if (subjectLabel) existing.subjects.add(subjectLabel);
        return;
      }

      grouped.set(key, {
        teacherName,
        subjects: new Set(subjectLabel ? [subjectLabel] : []),
      });
    };

    const notedSubjectLabels = new Set(
      subjectStats
        .map((subject) => normalizeLabelForMatch(subject.subject_name))
        .filter(Boolean)
    );

    subjectStats.forEach((subject) => {
      addTeacherSubject(subject.teacher_name, subject.subject_name);
    });

    currentAffectations
      .filter((item) =>
        Array.isArray(item.classes)
          ? item.classes.some((cls) => String(cls?.id || "") === String(selectedClassId || ""))
          : false
      )
      .forEach((item) => {
        const subjectLabel = String(item.subject?.label || "").trim();
        if (!subjectLabel || !notedSubjectLabels.has(normalizeLabelForMatch(subjectLabel))) return;

        const teacherName = String(
          item.teacher?.display_name || item.teacher?.email || item.teacher?.phone || ""
        ).trim();
        addTeacherSubject(teacherName, subjectLabel);
      });

    return Array.from(grouped.values())
      .map((row) => ({
        teacherName: row.teacherName,
        subjectsLabel: Array.from(row.subjects)
          .filter(Boolean)
          .sort((a, b) =>
            a.localeCompare(b, undefined, {
              sensitivity: "base",
              numeric: true,
            })
          )
          .join(", "),
      }))
      .filter((row) => row.teacherName.trim() && row.subjectsLabel.trim())
      .sort((a, b) =>
        a.teacherName.localeCompare(b.teacherName, undefined, {
          sensitivity: "base",
          numeric: true,
        })
      );
  }, [currentAffectations, selectedClassId, subjectStats]);

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

  const periodTopThreeGroups = useMemo(() => {
    if (!annualPeriods.length || !annualRecapRows.length) return [];

    return annualPeriods
      .map((period, periodIndex) => {
        const rows = annualRecapRows
          .map((row) => {
            const periodCell = row.periods.find((p) => p.period_id === period.id) || null;
            const avg = periodCell?.avg ?? null;
            const rank = periodCell?.rank ?? null;

            return {
              student_id: row.student_id,
              full_name: row.full_name,
              matricule: row.matricule,
              avg,
              rank,
            };
          })
          .filter((row) => row.avg !== null && row.avg !== undefined && Number.isFinite(Number(row.avg)))
          .sort((a, b) => {
            const rankA =
              a.rank !== null && a.rank !== undefined
                ? Number(a.rank)
                : Number.POSITIVE_INFINITY;
            const rankB =
              b.rank !== null && b.rank !== undefined
                ? Number(b.rank)
                : Number.POSITIVE_INFINITY;
            if (rankA !== rankB) return rankA - rankB;

            const avgA = a.avg !== null && a.avg !== undefined ? Number(a.avg) : -Infinity;
            const avgB = b.avg !== null && b.avg !== undefined ? Number(b.avg) : -Infinity;
            if (avgB !== avgA) return avgB - avgA;

            return a.full_name.localeCompare(b.full_name, undefined, {
              sensitivity: "base",
              numeric: true,
            });
          })
          .slice(0, 3);

        return {
          period_id: period.id,
          label: shortPeriodLabel(period, periodIndex),
          rows,
        };
      })
      .filter((group) => group.rows.length > 0);
  }, [annualPeriods, annualRecapRows]);

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
    const isRep = (r: CouncilStudentRow) => !!r.is_repeater;
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

  return (
    <>
      <style jsx global>{`
        :root {
          --pv-ink: #0f274f;
          --pv-grid: #9fb0c8;
          --pv-head: #dfe6ef;
          --pv-band: #6e809d;
          --pv-soft: #f6f8fb;
        }

        .pv-screen-wrap {
          max-width: 1200px;
          margin: 0 auto;
          padding: 16px;
        }

        .pv-page {
          width: 210mm;
          min-height: 297mm;
          padding: 7mm 8mm 8mm;
          box-sizing: border-box;
          background: #fff;
          color: #10233f;
          font-family: Arial, Helvetica, sans-serif;
          box-shadow: 0 10px 30px rgba(15, 39, 79, 0.12);
          page-break-after: always;
          break-after: page;
          display: flex;
          flex-direction: column;
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
          overflow-wrap: anywhere;
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

        .pv-xs {
          font-size: 9.5px;
        }

        .pv-center {
          text-align: center;
        }

        .pv-right {
          text-align: right;
        }

        .pv-ruled {
          min-height: 126px;
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

        .pv-sign-empty {
          min-height: 120px;
        }

        .pv-line-field {
          min-height: 28px;
          border-bottom: 1px solid #7e8ea8;
        }

        .pv-manual-lines {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .pv-manual-lines > div {
          border-bottom: 1px solid #8fa1ba;
          min-height: 18px;
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
                Version impression optimisée, très proche du modèle papier, sans pages parasites.
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
              <Button
                type="button"
                onClick={() => {
                  if (!previewOpen) setPreviewOpen(true);
                  setTimeout(() => window.print(), 50);
                }}
                disabled={!bulletinRaw || councilRows.length === 0}
              >
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
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Chef d'établissement / Directeur</label>
              <Input value={chairName} onChange={(e) => setChairName(e.target.value)} />
            </div>

            <div className="md:col-span-6">
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Observation générale</label>
              <Input value={generalObservation} onChange={(e) => setGeneralObservation(e.target.value)} placeholder="Observation générale de la séance…" />
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
                  <div><strong>{institution?.institution_head_title || "Directeur"} :</strong> {chairName || institution?.institution_head_name || "—"}</div>
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
                        <th rowSpan={2}>TOTAL</th>
                        <th rowSpan={2}>Classés</th>
                        <th colSpan={2}>Moy ≥ 10</th>
                        <th colSpan={2}>10 &gt; M ≥ 8,5</th>
                        <th colSpan={2}>Moy &lt; 8,5</th>
                        <th colSpan={3}>Moyenne de la classe</th>
                      </tr>
                      <tr>
                        <th>Nombre</th>
                        <th>%</th>
                        <th>Nombre</th>
                        <th>%</th>
                        <th>Nombre</th>
                        <th>%</th>
                        <th>Mini</th>
                        <th>Maxi</th>
                        <th>Moy.</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <OfficialTd center>{classStats.effectif}</OfficialTd>
                        <OfficialTd center>{classStats.classed}</OfficialTd>
                        <OfficialTd center>{classStats.above10}</OfficialTd>
                        <OfficialTd center>{formatPercent(classStats.above10, classStats.classed)}</OfficialTd>
                        <OfficialTd center>{classStats.between85And10}</OfficialTd>
                        <OfficialTd center>{formatPercent(classStats.between85And10, classStats.classed)}</OfficialTd>
                        <OfficialTd center>{classStats.below85}</OfficialTd>
                        <OfficialTd center>{formatPercent(classStats.below85, classStats.classed)}</OfficialTd>
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
                        <tr><OfficialTd>TH + Félicitations</OfficialTd><OfficialTd center>{classStats.excellence}</OfficialTd></tr>
                        <tr><OfficialTd>TH + Encouragements</OfficialTd><OfficialTd center>{classStats.encouragement}</OfficialTd></tr>
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <OfficialBand>Avertissements et sanctions</OfficialBand>
                    <table className="pv-grid-table mt-1 pv-mini">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th style={{ width: "18%" }}>Nombre</th>
                          <th>Type</th>
                          <th style={{ width: "18%" }}>Nombre</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <OfficialTd>Avertissement Travail</OfficialTd>
                          <OfficialTd center>{classStats.warningWork}</OfficialTd>
                          <OfficialTd>Avert. Conduite</OfficialTd>
                          <OfficialTd center>{classStats.warningConduct}</OfficialTd>
                        </tr>
                        <tr>
                          <OfficialTd>Blâme Travail</OfficialTd>
                          <OfficialTd center>{classStats.blameWork}</OfficialTd>
                          <OfficialTd>Blâme Conduite</OfficialTd>
                          <OfficialTd center>{classStats.blameConduct}</OfficialTd>
                        </tr>
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
                    <th style={{ width: "24%" }}>Matière</th>
                    <th style={{ width: "9%" }}>Effectif</th>
                    <th style={{ width: "9%" }}>N ≥ 10</th>
                    <th style={{ width: "9%" }}>%</th>
                    <th style={{ width: "11%" }}>10 &gt; M ≥ 8,5</th>
                    <th style={{ width: "9%" }}>%</th>
                    <th style={{ width: "9%" }}>M &lt; 8,5</th>
                    <th style={{ width: "9%" }}>%</th>
                    <th style={{ width: "11%" }}>Moy.</th>
                  </tr>
                </thead>
                <tbody>
                  {subjectStats.map((s) => {
                    const base = s.noted_count || 0;
                    return (
                      <tr key={s.subject_id}>
                        <OfficialTd strong>{s.subject_name}</OfficialTd>
                        <OfficialTd center>{s.noted_count}</OfficialTd>
                        <OfficialTd center>{s.gte10}</OfficialTd>
                        <OfficialTd center>{formatPercent(s.gte10, base)}</OfficialTd>
                        <OfficialTd center>{s.between85And10}</OfficialTd>
                        <OfficialTd center>{formatPercent(s.between85And10, base)}</OfficialTd>
                        <OfficialTd center>{s.lt85}</OfficialTd>
                        <OfficialTd center>{formatPercent(s.lt85, base)}</OfficialTd>
                        <OfficialTd center>{formatNumber(s.avg20)}</OfficialTd>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-3">
                <OfficialBand>Analyse</OfficialBand>
                <div className="mt-1 grid grid-cols-2 gap-3">
                  <div>
                    <div className="pv-band">Problèmes de la classe</div>
                    <div className="pv-ruled p-3 text-[11px] leading-6">{problemsText?.trim() || " "}</div>
                  </div>
                  <div>
                    <div className="pv-band">Propositions de solution</div>
                    <div className="pv-ruled p-3 text-[11px] leading-6">{solutionsText?.trim() || " "}</div>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <OfficialBand>Membres du conseil</OfficialBand>
                <div className="mt-1 border p-3 text-[11px]" style={{ borderColor: "var(--pv-grid)", background: "var(--pv-soft)" }}>
                  <div className="mb-2 font-semibold uppercase"></div>
                  <div className="pv-line-field" />
                </div>

                <table className="pv-grid-table mt-2 pv-mini">
                  <thead>
                    <tr>
                      <th style={{ width: "7%" }}>No</th>
                      <th style={{ width: "34%" }}>Enseignant</th>
                      <th style={{ width: "33%" }}>Discipline(s)</th>
                      <th style={{ width: "26%" }}>Émargement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {councilTeacherRows.map((row, index) => (
                      <tr key={`${row.teacherName}-${index}`}>
                        <OfficialTd center>{index + 1}</OfficialTd>
                        <OfficialTd strong>{row.teacherName}</OfficialTd>
                        <OfficialTd>{row.subjectsLabel || "—"}</OfficialTd>
                        <OfficialTd>
                          <div className="min-h-[36px] flex items-end">
                            <div className="w-full border-b border-slate-400" />
                          </div>
                        </OfficialTd>
                      </tr>
                    ))}

                    {Array.from({ length: Math.max(0, 2 - councilTeacherRows.length) }).map((_, idx) => (
                      <tr key={`blank-member-${idx}`}>
                        <OfficialTd center>{councilTeacherRows.length + idx + 1}</OfficialTd>
                        <OfficialTd>&nbsp;</OfficialTd>
                        <OfficialTd>&nbsp;</OfficialTd>
                        <OfficialTd>
                          <div className="min-h-[36px] flex items-end">
                            <div className="w-full border-b border-slate-400" />
                          </div>
                        </OfficialTd>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-auto pt-4">
                <div className="grid grid-cols-2 items-end gap-10 text-[12px]">
                  <div>
                    <div className="mb-1 font-semibold">Professeur principal</div>
                    <div className="h-16 border-b border-slate-400" />
                    <div className="pt-2 text-[13px]">{currentHeadTeacher || "—"}</div>
                  </div>

                  <div className="text-right">
                    <div className="mb-2">
                      {(institution?.institution_region || "").trim()
                        ? `${institution?.institution_region}, le ${formatDateFR(councilDate)}`
                        : formatDateFR(councilDate)}
                    </div>
                    <div className="mb-1 font-semibold">{institution?.institution_head_title || "Le Directeur"}</div>
                    <div className="ml-auto h-16 w-full border-b border-slate-400" />
                    <div className="pt-2 text-[13px]">{chairName || institution?.institution_head_name || "—"}</div>
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
                  <QuickCell label="Meilleure moy." value={formatNumber(annualRecapStats.highest)} />
                  <QuickCell label="Plus faible moy." value={formatNumber(annualRecapStats.lowest)} />
                  <QuickCell label="TH" value={String(annualRecapStats.honour)} />
                  <QuickCell label="TH + Enc./Fél." value={String(annualRecapStats.encouragement + annualRecapStats.excellence)} />
                </div>

                {periodTopThreeGroups.length > 0 ? (
                  <div className="mt-3">
                    <OfficialBand>Les 3 premiers de la classe par trimestre</OfficialBand>
                    <div className="mt-1 grid grid-cols-3 gap-2">
                      {periodTopThreeGroups.map((group) => (
                        <div key={`period-top-${group.period_id}`} className="min-w-0">
                          <div className="border border-slate-300 bg-slate-100 px-2 py-1 text-center text-[10px] font-bold uppercase text-slate-800">
                            {group.label}
                          </div>
                          <table className="pv-grid-table pv-xs">
                            <thead>
                              <tr>
                                <th style={{ width: "16%" }}>Rg</th>
                                <th>Nom et prénom</th>
                                <th style={{ width: "22%" }}>Moy.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rows.map((row) => (
                                <tr key={`${group.period_id}-${row.student_id}`}>
                                  <OfficialTd center strong>{row.rank ?? "—"}</OfficialTd>
                                  <OfficialTd strong>{row.full_name}</OfficialTd>
                                  <OfficialTd center strong>{formatNumber(row.avg)}</OfficialTd>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-3">
                  <OfficialBand>Récapitulatif des moyennes générales et annuelles</OfficialBand>
                  <table className="pv-grid-table mt-1 pv-xs">
                    <thead>
                      <tr>
                        <th style={{ width: "4%" }}>No</th>
                        <th style={{ width: "22%" }}>Nom et prénom</th>
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
                        : "Cette fiche récapitulative est ajoutée au conseil du dernier trimestre afin d’afficher toutes les périodes et la moyenne annuelle."}
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

        <div className="flex flex-col items-center justify-center">
          {institution?.institution_logo_url ? (
            <img
              src={institution.institution_logo_url}
              alt="Logo établissement"
              className="h-16 w-16 object-contain"
            />
          ) : (
            <div className="h-16 w-16 rounded-full border border-slate-300" />
          )}
          <div className="mt-1 text-center text-[9px] font-semibold uppercase tracking-[0.03em] text-slate-600">
            {institution?.institution_name || classLabel}
          </div>
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

function QuickCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border px-2 py-2 text-center text-[11px]" style={{ borderColor: "var(--pv-grid)", background: "var(--pv-soft)" }}>
      <div className="font-semibold uppercase">{label}</div>
      <div className="mt-1 text-[13px] font-bold">{value}</div>
    </div>
  );
}
