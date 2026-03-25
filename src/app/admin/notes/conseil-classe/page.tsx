// src/app/admin/notes/conseil-classe/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Printer, RefreshCw, FileText, School, BarChart3, Users } from "lucide-react";

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

          .pv-sheet {
            box-shadow: none !important;
            border: 0 !important;
            margin: 0 !important;
            max-width: none !important;
          }

          .pv-avoid-break {
            page-break-inside: avoid;
            break-inside: avoid;
          }

          table {
            page-break-inside: auto;
          }

          thead {
            display: table-header-group;
          }

          tr,
          td,
          th {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }
      `}</style>

      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 md:p-6">
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
                Version V1 : calcul automatique à partir des bulletins + conduite,
                avec prise en charge de la moyenne annuelle au 3e trimestre.
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
                {filteredPeriods.map((p) => (
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

          <div className="grid gap-3 xl:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Analyse générale
              </label>
              <Textarea
                rows={6}
                value={analysisText}
                onChange={(e) => setAnalysisText(e.target.value)}
                placeholder="Analyse synthétique des résultats et du comportement de la classe…"
              />
            </div>

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
          <div className="pv-sheet overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-6 py-5 md:px-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {institution?.country_name || "République de Côte d’Ivoire"}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {institution?.country_motto || "Union - Discipline - Travail"}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-700">
                    {institution?.ministry_name || "Ministère de l’Éducation Nationale"}
                  </div>
                  <div className="mt-3 text-lg font-bold text-slate-900">
                    {institution?.institution_name || "Établissement"}
                  </div>
                  <div className="text-sm text-slate-600">
                    {institution?.institution_region || ""}
                    {institution?.institution_region && institution?.institution_postal_address
                      ? " • "
                      : ""}
                    {institution?.institution_postal_address || ""}
                  </div>
                  <div className="text-sm text-slate-600">
                    {institution?.institution_phone || ""}
                    {institution?.institution_phone && institution?.institution_email ? " • " : ""}
                    {institution?.institution_email || ""}
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                    Procès-verbal
                  </div>
                  <div className="text-lg font-bold text-emerald-900">
                    Conseil de classe
                  </div>
                  <div className="text-sm text-emerald-800">{currentPeriodLabel}</div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <InfoCard label="Année scolaire" value={currentAcademicYear} />
                <InfoCard label="Classe" value={currentClassLabel} />
                <InfoCard label="Date du conseil" value={formatDateFR(councilDate)} />
                <InfoCard label="Professeur principal" value={currentHeadTeacher} />
                <InfoCard label="Président du conseil" value={chairName || "—"} />
                <InfoCard label="Éducateur / Surveillant" value={educationOfficerName || "—"} />
                <InfoCard label="Délégué de classe" value={classDelegateName || "—"} />
                <InfoCard
                  label="Période couverte"
                  value={`${formatDateFR(dateFrom)} → ${formatDateFR(dateTo)}`}
                />
              </div>

              {generalObservation ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <span className="font-semibold">Observation générale : </span>
                  {generalObservation}
                </div>
              ) : null}
            </div>

            <div className="px-6 py-5 md:px-8">
              <SectionTitle icon={<Users className="h-4 w-4" />} title="Statistiques générales de la classe" />

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <StatCard label="Effectif" value={String(classStats.effectif)} />
                <StatCard label="Garçons" value={String(classStats.boys)} />
                <StatCard label="Filles" value={String(classStats.girls)} />
                <StatCard label="Moyenne de classe" value={formatNumber(classStats.classAvg)} />
                <StatCard label="Moyenne annuelle" value={formatNumber(classStats.annualClassAvg)} />
                <StatCard label="Plus forte moyenne" value={formatNumber(classStats.highest)} />
                <StatCard label="Plus faible moyenne" value={formatNumber(classStats.lowest)} />
                <StatCard label="Élèves ≥ 10" value={String(classStats.above10)} />
                <StatCard label="Élèves < 8,5" value={String(classStats.below85)} />
                <StatCard
                  label="Mode"
                  value={annualMode ? "Annuel activé" : "Trimestriel"}
                />
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">
                    Distinctions
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <MiniStat label="Excellence" value={classStats.excellence} tone="emerald" />
                    <MiniStat
                      label="Tableau d’honneur"
                      value={classStats.honour}
                      tone="blue"
                    />
                    <MiniStat
                      label="Encouragement"
                      value={classStats.encouragement}
                      tone="amber"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">
                    Avertissements / blâmes
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <MiniStat
                      label="Avert. travail"
                      value={classStats.warningWork}
                      tone="orange"
                    />
                    <MiniStat
                      label="Avert. conduite"
                      value={classStats.warningConduct}
                      tone="orange"
                    />
                    <MiniStat label="Blâme travail" value={classStats.blameWork} tone="rose" />
                    <MiniStat
                      label="Blâme conduite"
                      value={classStats.blameConduct}
                      tone="rose"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 pv-avoid-break">
                <SectionTitle
                  icon={<BarChart3 className="h-4 w-4" />}
                  title="Analyse par matière"
                />

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-slate-700">
                        <Th>Matière</Th>
                        <Th>Coeff.</Th>
                        <Th>Professeur</Th>
                        <Th>Notés</Th>
                        <Th>Non notés</Th>
                        <Th>Moy. classe</Th>
                        <Th>≥ 10</Th>
                        <Th>8,5 à 9,99</Th>
                        <Th>&lt; 8,5</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {subjectStats.map((s) => (
                        <tr key={s.subject_id} className="border-t border-slate-200">
                          <Td strong>{s.subject_name}</Td>
                          <Td>{formatNumber(s.coeff, 0)}</Td>
                          <Td>{s.teacher_name || "—"}</Td>
                          <Td>{s.noted_count}</Td>
                          <Td>{s.not_noted_count}</Td>
                          <Td>{formatNumber(s.avg20)}</Td>
                          <Td>{s.gte10}</Td>
                          <Td>{s.between85And10}</Td>
                          <Td>{s.lt85}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6 pv-avoid-break">
                <SectionTitle
                  icon={<FileText className="h-4 w-4" />}
                  title="Majors de la classe"
                />

                <div className="grid gap-3 md:grid-cols-3">
                  {topStudents.length > 0 ? (
                    topStudents.map((row, idx) => (
                      <div
                        key={row.student_id}
                        className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4"
                      >
                        <div className="text-xs font-semibold uppercase text-slate-500">
                          {idx + 1}
                          {idx === 0 ? "er" : "e"} de la classe
                        </div>
                        <div className="mt-1 text-base font-semibold text-slate-900">
                          {row.full_name}
                        </div>
                        <div className="mt-2 text-sm text-slate-600">
                          Matricule : {row.matricule || "—"}
                        </div>
                        <div className="text-sm text-slate-600">
                          Moyenne : {formatNumber(row.general_avg)}
                        </div>
                        <div className="text-sm text-slate-600">
                          Rang : {row.rank ?? "—"}
                        </div>
                        {annualMode ? (
                          <div className="text-sm text-slate-600">
                            Moy. annuelle : {formatNumber(row.annual_avg)}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 md:col-span-3">
                      Aucune moyenne exploitable pour déterminer les majors.
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6">
                <SectionTitle
                  icon={<School className="h-4 w-4" />}
                  title="Liste des élèves et décisions du conseil"
                />

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-[1250px] w-full border-collapse text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-slate-700">
                        <Th>Rang</Th>
                        <Th>Matricule</Th>
                        <Th>Nom &amp; prénoms</Th>
                        <Th>Sexe</Th>
                        <Th>Date naissance</Th>
                        <Th>Moy. trim.</Th>
                        {annualMode ? <Th>Moy. annuelle</Th> : null}
                        {annualMode ? <Th>Rang annuel</Th> : null}
                        <Th>Conduite /20</Th>
                        <Th>Distinction</Th>
                        <Th>Sanction</Th>
                        <Th>Appréciation</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {councilRows.map((row) => (
                        <tr key={row.student_id} className="border-t border-slate-200 align-top">
                          <Td>{row.rank ?? "—"}</Td>
                          <Td>{row.matricule || "—"}</Td>
                          <Td strong>{row.full_name}</Td>
                          <Td>{normalizeSex(row.sex || row.gender || null) || "—"}</Td>
                          <Td>{formatDateFR(row.birthdate || row.birth_date)}</Td>
                          <Td>{formatNumber(row.general_avg)}</Td>
                          {annualMode ? <Td>{formatNumber(row.annual_avg)}</Td> : null}
                          {annualMode ? <Td>{row.annual_rank ?? "—"}</Td> : null}
                          <Td>{formatNumber(row.conductOn20)}</Td>
                          <Td>{labelDistinction(row.mentions.distinction)}</Td>
                          <Td>{labelSanction(row.mentions.sanction)}</Td>
                          <Td>{row.appreciation || "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                <TextBlock title="Analyse générale" content={analysisText} />
                <TextBlock title="Problèmes relevés" content={problemsText} />
                <TextBlock title="Propositions de solutions" content={solutionsText} />
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SignatureBlock title="Président du conseil" name={chairName} />
                <SignatureBlock title="Professeur principal" name={currentHeadTeacher} />
                <SignatureBlock title="Éducateur / Surveillant" name={educationOfficerName} />
                <SignatureBlock title="Délégué / Représentant" name={classDelegateName} />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ───────── Small components ───────── */

function SectionTitle({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
        {icon}
      </div>
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-slate-900">{value || "—"}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-4 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "blue" | "amber" | "orange" | "rose";
}) {
  const tones: Record<"emerald" | "blue" | "amber" | "orange" | "rose", string> = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    orange: "border-orange-200 bg-orange-50 text-orange-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  };

  return (
    <div className={`rounded-xl border px-3 py-3 ${tones[tone]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wide">
      {children}
    </th>
  );
}

function Td({
  children,
  strong = false,
}: {
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <td className={["px-3 py-2.5 text-slate-700", strong ? "font-semibold text-slate-900" : ""].join(" ")}>
      {children}
    </td>
  );
}

function TextBlock({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-900">{title}</h3>
      <div className="min-h-[140px] whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {content?.trim() || "—"}
      </div>
    </div>
  );
}

function SignatureBlock({ title, name }: { title: string; name?: string | null }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-3 min-h-[52px] border-b border-dashed border-slate-300" />
      <div className="mt-2 text-sm text-slate-700">{name?.trim() || "Nom à renseigner"}</div>
    </div>
  );
}