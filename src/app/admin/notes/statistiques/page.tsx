"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Download,
  FileSpreadsheet,
  Filter,
  Printer,
  RefreshCw,
  School,
  Search,
} from "lucide-react";

/* ───────── UI helpers ───────── */
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium shadow",
        p.disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-emerald-700 transition",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function GhostButton(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium",
        "hover:bg-slate-50 transition",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
/* ───────── Types ───────── */

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type ClassItem = {
  id: string;
  label: string;
  level: string | null;
};

type MatrixEval = {
  id: string;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  title: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
};

type MatrixStudent = {
  student_id: string;
  full_name: string;
  matricule: string | null;
};

type MatrixMarks = Record<
  string,
  Record<
    string,
    {
      raw: number | null;
      mark_20: number | null;
    }
  >
>;

type MatrixOk = {
  ok: true;
  meta: {
    class_id: string;
    subject_id: string;
    class_label: string;
    subject_name: string | null;
    level: string | null;
    from: string | null;
    to: string | null;
  };
  evaluations: MatrixEval[];
  students: MatrixStudent[];
  marks: MatrixMarks;
};
type MatrixErr = { ok: false; error: string };

/* stats /api/admin/notes/stats → on ne garde que ce dont on a besoin */
type ClassSubjectStat = {
  class_id: string;
  class_label: string;
  level: string | null;
  subject_id: string | null;
  subject_name: string | null;
  evals_count: number;
  notes_count: number;
  avg_score_20: number | null;
};
type StatsOk = {
  ok: true;
  by_class_subject: ClassSubjectStat[];
};
type StatsErr = { ok: false; error: string };

/* Calcul client pour la matrice par classe */
type SubjectMatrixStat = {
  subject_id: string;
  subject_name: string;
  evals_count: number;
  notes_count: number;
  avg_20_class: number | null;
};

type ClassMatrixComputed = {
  class_id: string;
  class_label: string;
  level: string | null;
  students: MatrixStudent[];
  subjects: { subject_id: string; subject_name: string }[];
  averages: Record<
    string,
    Record<
      string,
      {
        avg_20: number | null;
        nb_evals: number;
        nb_notes: number;
      }
    >
  >;
  generalAverages: Record<string, number | null>;
  global: {
    class_avg_20: number | null;
    class_min_20: number | null;
    class_max_20: number | null;
    dist: {
      lt5: number;
      between5_10: number;
      between10_12: number;
      between12_15: number;
      gte15: number;
    };
    subjectStats: SubjectMatrixStat[];
  };
  ranks: {
    general: Record<string, number | null>;
    bySubject: Record<string, Record<string, number | null>>;
  };
};

/* Calcul client pour la section par matière (vue agrégée par classe) */
type SubjectView = {
  subject_id: string;
  subject_name: string;
  global: {
    avg_20: number | null;
    min_20: number | null;
    max_20: number | null;
    evals_count: number;
    notes_count: number;
    dist_classes: {
      lt5: number;
      between5_10: number;
      between10_12: number;
      between12_15: number;
      gte15: number;
    };
  };
  rows: ClassSubjectStat[];
};

/* Matrice élèves pour une matière donnée dans UNE classe */
type SubjectClassMatrix = {
  class_id: string;
  class_label: string;
  level: string | null;
  subject_id: string;
  subject_name: string | null;
  teacher_names: string | null;
  students: MatrixStudent[];
  averages: Record<
    string,
    {
      avg_20: number | null;
      nb_evals: number;
      nb_notes: number;
      rank: number | null;
    }
  >;
  global: {
    class_avg_20: number | null;
    class_min_20: number | null;
    class_max_20: number | null;
    dist: {
      lt5: number;
      between5_10: number;
      between10_12: number;
      between12_15: number;
      gte15: number;
    };
    evals_count: number;
    notes_count: number;
  };
};

type AcademicYear = {
  id: string;
  code: string;
  label: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

type GradingPeriod = {
  id: string;
  code: string;
  label: string;
  short_label: string;
  start_date: string | null;
  end_date: string | null;
  order_index: number;
  is_active: boolean;
};

/* ───────── Helpers ───────── */

const df = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const nf = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

function computeRanks(values: Record<string, number | null | undefined>): Record<string, number> {
  const entries: { id: string; value: number }[] = [];
  for (const [id, v] of Object.entries(values)) {
    if (v != null && !Number.isNaN(v)) {
      entries.push({ id, value: v });
    }
  }
  if (!entries.length) return {};

  entries.sort((a, b) => b.value - a.value);

  const ranks: Record<string, number> = {};
  let currentRank = 1;
  let prevValue = entries[0].value;
  ranks[entries[0].id] = 1;

  for (let i = 1; i < entries.length; i++) {
    const { id, value } = entries[i];
    if (value !== prevValue) {
      currentRank += 1;
      prevValue = value;
    }
    ranks[id] = currentRank;
  }

  return ranks;
}

function formatRank(r: number | null | undefined): string {
  if (!r) return "—";
  if (r === 1) return "1er";
  return `${r}e`;
}

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function formatDateFR(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("fr-FR");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function openPrintHtml(html: string, onBlocked?: () => void) {
  const win = window.open("", "_blank");
  if (!win) {
    onBlocked?.();
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

function pdfBaseCss(landscape = true): string {
  return `
  @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f172a; margin: 0; }
  h1 { font-size: 18px; margin: 0; text-transform: uppercase; letter-spacing: 0.02em; }
  h2 { font-size: 13px; margin: 14px 0 7px; color: #0f172a; }
  .subtitle { margin-top: 4px; color: #475569; font-size: 12px; }
  .meta { display: flex; gap: 12px; margin: 12px 0; font-size: 11px; color: #334155; flex-wrap: wrap; }
  .meta div { padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 999px; background: #f8fafc; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 6px; vertical-align: middle; }
  th { background: #e2e8f0; font-weight: 800; text-align: center; }
  th span { font-size: 8px; color: #475569; font-weight: 600; }
  td.num { text-align: right; white-space: nowrap; }
  td.strong { font-weight: 800; background: #f8fafc; }
  tr:nth-child(even) td { background: #f8fafc; }
  .footer { margin-top: 10px; font-size: 9px; color: #64748b; text-align: right; }
`;
}

/* ───────── Page principale ───────── */

export default function AdminNotesStatsPage() {
  /* Filtres globaux */
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [status, setStatus] = useState<"all" | "published" | "draft">("all");

  /* Années scolaires + périodes d'évaluation (paramètres établissement) */
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loadingYears, setLoadingYears] = useState(false);
  const [selectedYearCode, setSelectedYearCode] = useState<string>("");

  const [periods, setPeriods] = useState<GradingPeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  /* Classes + stats matières (back) */
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [byClassSubject, setByClassSubject] = useState<ClassSubjectStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  /* Section 1 : matrice par classe (multi-disciplines) */
  const [matrixLevel, setMatrixLevel] = useState<string>("");
  const [matrixClassId, setMatrixClassId] = useState<string>("");
  const [classMatrix, setClassMatrix] = useState<ClassMatrixComputed | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  /* Section 2 : analyse par matière (mono-discipline) */
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [subjectLevelFilter, setSubjectLevelFilter] = useState<string>("");
  const [subjectClassId, setSubjectClassId] = useState<string>("");
  const [subjectClassMatrix, setSubjectClassMatrix] = useState<SubjectClassMatrix | null>(
    null
  );
  const [subjectClassLoading, setSubjectClassLoading] = useState(false);
  const [subjectClassError, setSubjectClassError] = useState<string | null>(null);

  /* Interface : on affiche une matrice à la fois pour garder une page simple et lisible. */
  const [activeTab, setActiveTab] = useState<"class" | "subject">("class");

  /* Charger les classes une fois */
  useEffect(() => {
    fetch("/api/admin/classes?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const arr = (j.items || []) as any[];
        const mapped: ClassItem[] = arr.map((c) => ({
          id: String(c.id),
          label: (c.label || c.name || "Classe").trim(),
          level: (c.level ?? null) ? String(c.level).trim() : null,
        }));
        setAllClasses(mapped);
      })
      .catch((e) => {
        console.error("[admin.notes.stats] load classes error", e);
        setAllClasses([]);
      });
  }, []);

  /* Années scolaires */
  async function loadAcademicYears() {
    setLoadingYears(true);
    try {
      const r = await fetch("/api/admin/institution/academic-years", {
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({} as any));

      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Échec du chargement des années scolaires.");
      }

      const items = Array.isArray(j.items) ? j.items : [];
      const mapped: AcademicYear[] = items.map((y: any) => ({
        id: String(y.id),
        code: String(y.code),
        label: String(y.label || y.code),
        start_date: y.start_date ? String(y.start_date).slice(0, 10) : "",
        end_date: y.end_date ? String(y.end_date).slice(0, 10) : "",
        is_current: !!y.is_current,
      }));
      setYears(mapped);

      const current = mapped.find((y) => y.is_current) || mapped[mapped.length - 1];
      if (current) {
        setSelectedYearCode((prev) => prev || current.code);
      }
    } catch (e: any) {
      console.error("[admin.notes.stats] loadAcademicYears", e);
      setYears([]);
    } finally {
      setLoadingYears(false);
    }
  }

  /* Périodes d'évaluation */
  async function loadPeriods(yearCode: string) {
    if (!yearCode) {
      setPeriods([]);
      setSelectedPeriodId("");
      return;
    }

    setLoadingPeriods(true);
    try {
      const params = new URLSearchParams();
      params.set("academic_year", yearCode);

      const r = await fetch(`/api/admin/institution/grading-periods?${params.toString()}`, {
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({} as any));

      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Échec du chargement des périodes d'évaluation.");
      }

      const items = Array.isArray(j.items) ? j.items : [];
      const mapped: GradingPeriod[] = items.map((p: any, idx: number) => ({
        id: String(p.id),
        code: String(p.code || ""),
        label: String(p.label || ""),
        short_label: String(p.short_label || p.label || ""),
        start_date: p.start_date ? String(p.start_date).slice(0, 10) : null,
        end_date: p.end_date ? String(p.end_date).slice(0, 10) : null,
        order_index: Number(p.order_index ?? idx + 1),
        is_active: p.is_active !== false,
      }));

      mapped.sort((a, b) => a.order_index - b.order_index);
      setPeriods(mapped);

      const def =
        mapped.find((p) => p.is_active && p.start_date && p.end_date) || mapped[0];

      if (def) {
        setSelectedPeriodId(def.id);
        if (def.start_date) setFrom(def.start_date);
        if (def.end_date) setTo(def.end_date);
      }
    } catch (e: any) {
      console.error("[admin.notes.stats] loadPeriods", e);
      setPeriods([]);
      setSelectedPeriodId("");
    } finally {
      setLoadingPeriods(false);
    }
  }

  function handlePeriodChange(id: string) {
    setSelectedPeriodId(id);
    const p = periods.find((x) => x.id === id);
    if (p) {
      if (p.start_date) setFrom(p.start_date);
      if (p.end_date) setTo(p.end_date);
    }
  }

  /* Effet initial : années scolaires */
  useEffect(() => {
    loadAcademicYears();
  }, []);

  /* Quand l'année change, recharger les périodes */
  useEffect(() => {
    if (selectedYearCode) {
      loadPeriods(selectedYearCode);
    } else {
      setPeriods([]);
      setSelectedPeriodId("");
    }
  }, [selectedYearCode]);

  /* Niveaux possibles, d'après les classes */
  const levels = useMemo(() => {
    const s = new Set<string>();
    for (const c of allClasses) if (c.level) s.add(c.level);
    return Array.from(s).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
  }, [allClasses]);

  const classesForLevel = useMemo(() => {
    if (!matrixLevel) return [];
    return allClasses
      .filter((c) => c.level === matrixLevel)
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
  }, [allClasses, matrixLevel]);

  /* Charger les stats par classe × matière (pour la section 2) */
  async function refreshStats() {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (status === "published") qs.set("published", "true");
      if (status === "draft") qs.set("published", "false");

      const res = await fetch("/api/admin/notes/stats?" + qs.toString(), {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as StatsOk | StatsErr | any;
      if (!res.ok || !json || !json.ok) {
        throw new Error((json && json.error) || `HTTP_${res.status}`);
      }
      const data = json as StatsOk;
      setByClassSubject(data.by_class_subject || []);
    } catch (e: any) {
      console.error("[admin.notes.stats] refreshStats error", e);
      setByClassSubject([]);
      setStatsError(e?.message || "Erreur de chargement des statistiques.");
    } finally {
      setStatsLoading(false);
    }
  }

  const currentYear = useMemo(
    () => years.find((y) => y.code === selectedYearCode) || null,
    [years, selectedYearCode]
  );

  const currentPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) || null,
    [periods, selectedPeriodId]
  );

  const periodLabel = useMemo(() => {
    const parts: string[] = [];

    if (currentYear) {
      parts.push(`Année scolaire : ${currentYear.label}`);
    }
    if (currentPeriod) {
      const label = currentPeriod.short_label || currentPeriod.label || currentPeriod.code;
      let dates = "";
      if (currentPeriod.start_date && currentPeriod.end_date) {
        dates = ` (${df.format(new Date(currentPeriod.start_date))} – ${df.format(
          new Date(currentPeriod.end_date)
        )})`;
      }
      parts.push(`Période : ${label}${dates}`);
    } else if (from || to) {
      try {
        if (from && to) {
          parts.push(`Du ${df.format(new Date(from))} au ${df.format(new Date(to))}`);
        } else if (from && !to) {
          parts.push(`À partir du ${df.format(new Date(from))}`);
        } else if (!from && to) {
          parts.push(`Jusqu'au ${df.format(new Date(to))}`);
        }
      } catch {
        // ignore parse errors
      }
    }

    if (!parts.length) {
      return "Toutes les évaluations enregistrées";
    }
    return parts.join(" — ");
  }, [currentYear, currentPeriod, from, to]);

  const currentYearLabelSafe = currentYear?.label ?? "";
  const currentPeriodLabelSafe =
    currentPeriod?.short_label || currentPeriod?.label || currentPeriod?.code || "";
  const currentPeriodStart = currentPeriod?.start_date || null;
  const currentPeriodEnd = currentPeriod?.end_date || null;

  /* ───────── Section 2 : options de matières + classes ───────── */

  const subjectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const cs of byClassSubject) {
      if (!cs.subject_id) continue;
      if (!map.has(cs.subject_id)) {
        map.set(cs.subject_id, cs.subject_name || "Matière");
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [byClassSubject]);

  const subjectView: SubjectView | null = useMemo(() => {
    if (!selectedSubjectId) return null;

    const filteredRows = byClassSubject.filter(
      (cs) =>
        cs.subject_id === selectedSubjectId &&
        (!subjectLevelFilter || cs.level === subjectLevelFilter)
    );
    if (!filteredRows.length) return null;

    const subjectName = filteredRows[0].subject_name || "Matière";

    let totalNotes = 0;
    let totalEvals = 0;
    let sumWeighted = 0;
    let denWeighted = 0;
    let min: number | null = null;
    let max: number | null = null;
    const dist = {
      lt5: 0,
      between5_10: 0,
      between10_12: 0,
      between12_15: 0,
      gte15: 0,
    };

    for (const r of filteredRows) {
      totalNotes += r.notes_count;
      totalEvals += r.evals_count;
      if (r.avg_score_20 != null && r.notes_count > 0) {
        const avg = r.avg_score_20;
        sumWeighted += avg * r.notes_count;
        denWeighted += r.notes_count;

        if (min == null || avg < min) min = avg;
        if (max == null || avg > max) max = avg;

        if (avg < 5) dist.lt5++;
        else if (avg < 10) dist.between5_10++;
        else if (avg < 12) dist.between10_12++;
        else if (avg < 15) dist.between12_15++;
        else dist.gte15++;
      }
    }

    const avg = denWeighted ? sumWeighted / denWeighted : null;

    return {
      subject_id: selectedSubjectId,
      subject_name: subjectName,
      global: {
        avg_20: avg,
        min_20: min,
        max_20: max,
        evals_count: totalEvals,
        notes_count: totalNotes,
        dist_classes: dist,
      },
      rows: filteredRows.sort((a, b) =>
        (a.class_label || "").localeCompare(b.class_label || "", undefined, {
          numeric: true,
          sensitivity: "base",
        })
      ),
    };
  }, [selectedSubjectId, subjectLevelFilter, byClassSubject]);

  const subjectClasses = useMemo(() => {
    if (!selectedSubjectId) return [];
    const map = new Map<string, { id: string; label: string; level: string | null }>();
    for (const cs of byClassSubject) {
      if (cs.subject_id !== selectedSubjectId) continue;
      if (subjectLevelFilter && cs.level !== subjectLevelFilter) continue;
      if (!map.has(cs.class_id)) {
        map.set(cs.class_id, {
          id: cs.class_id,
          label: cs.class_label,
          level: cs.level ?? null,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.label || "").localeCompare(b.label || "", undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  }, [selectedSubjectId, subjectLevelFilter, byClassSubject]);

  /* ───────── Core : calcul de matrice pour UNE classe (multi-disciplines) ───────── */

  const computeClassMatrixForClass = async (
    classId: string
  ): Promise<ClassMatrixComputed | null> => {
    const classInfo = allClasses.find((c) => c.id === classId) || null;

    // 1) matières affectées à la classe
    const subsRes = await fetch(`/api/class/subjects?class_id=${classId}`, {
      cache: "no-store",
    });
    const subsJson = await subsRes.json().catch(() => ({}));
    const rawItems = (subsJson.items || []) as any[];
    const subjectsForClass = rawItems.map((s) => ({
      subject_id: String(s.id),
      subject_name: (s.label || s.name || "").trim() || String(s.id),
    }));

    if (!subjectsForClass.length) {
      return {
        class_id: classId,
        class_label: classInfo?.label || "Classe",
        level: classInfo?.level ?? null,
        students: [],
        subjects: [],
        averages: {},
        generalAverages: {},
        global: {
          class_avg_20: null,
          class_min_20: null,
          class_max_20: null,
          dist: { lt5: 0, between5_10: 0, between10_12: 0, between12_15: 0, gte15: 0 },
          subjectStats: [],
        },
        ranks: {
          general: {},
          bySubject: {},
        },
      };
    }

    const studentsMap = new Map<string, MatrixStudent>();
    const averages: ClassMatrixComputed["averages"] = {};
    const subjectStatsMap = new Map<
      string,
      { subject: string; evals: number; notes: number; sumAvg: number; cntAvg: number }
    >();

    // 2) pour chaque matière : appel /api/admin/notes/matrix
    for (const subj of subjectsForClass) {
      const qs = new URLSearchParams();
      qs.set("class_id", classId);
      qs.set("subject_id", subj.subject_id);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (status === "published") qs.set("published", "true");
      if (status === "draft") qs.set("published", "false");

      const res = await fetch("/api/admin/notes/matrix?" + qs.toString(), {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as MatrixOk | MatrixErr | any;
      if (!res.ok || !json || !json.ok) {
        console.error(
          "[admin.notes.stats] matrix error for subject",
          subj.subject_id,
          json
        );
        continue;
      }

      const data = json as MatrixOk;
      const evaluations = data.evaluations || [];
      const marks = data.marks || {};
      const students = data.students || [];

      for (const st of students) {
        if (!studentsMap.has(st.student_id)) {
          studentsMap.set(st.student_id, st);
        }
      }

      if (!evaluations.length) {
        subjectStatsMap.set(subj.subject_id, {
          subject: subj.subject_name,
          evals: 0,
          notes: 0,
          sumAvg: 0,
          cntAvg: 0,
        });
        continue;
      }

      const metaByEval = new Map<string, { scale: number; coeff: number }>();
      for (const ev of evaluations) {
        metaByEval.set(ev.id, { scale: ev.scale, coeff: ev.coeff });
      }

      let totalNotesForSubj = 0;
      const studentAvgForSubj: number[] = [];

      for (const [studentId, evalMarks] of Object.entries(marks as MatrixMarks)) {
        let weightedSum = 0;
        let weights = 0;
        let nbNotes = 0;

        for (const [evalId, markObj] of Object.entries(evalMarks)) {
          const meta = metaByEval.get(evalId);
          if (!meta) continue;
          if (markObj.raw == null) continue;

          nbNotes++;
          const mark20 =
            markObj.mark_20 != null
              ? Number(markObj.mark_20)
              : (Number(markObj.raw) / meta.scale) * 20;

          weightedSum += mark20 * meta.coeff;
          weights += meta.coeff;
        }

        const avg20 = weights > 0 ? weightedSum / weights : null;

        if (!averages[studentId]) {
          averages[studentId] = {};
        }
        averages[studentId][subj.subject_id] = {
          avg_20: avg20,
          nb_evals: evaluations.length,
          nb_notes: nbNotes,
        };

        if (nbNotes > 0 && avg20 != null) {
          totalNotesForSubj += nbNotes;
          studentAvgForSubj.push(avg20);
        }
      }

      let subjSum = 0;
      let subjCnt = 0;
      for (const v of studentAvgForSubj) {
        subjSum += v;
        subjCnt++;
      }

      subjectStatsMap.set(subj.subject_id, {
        subject: subj.subject_name,
        evals: evaluations.length,
        notes: totalNotesForSubj,
        sumAvg: subjSum,
        cntAvg: subjCnt,
      });
    }

    const studentsList = Array.from(studentsMap.values()).sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, {
        sensitivity: "base",
        numeric: true,
      })
    );

    const generalAverages: Record<string, number | null> = {};
    let sumAll = 0;
    let cntAll = 0;
    let minAll: number | null = null;
    let maxAll: number | null = null;
    const dist = {
      lt5: 0,
      between5_10: 0,
      between10_12: 0,
      between12_15: 0,
      gte15: 0,
    };

    for (const st of studentsList) {
      const perSubj = averages[st.student_id] || {};
      const values = Object.values(perSubj)
        .map((v) => v.avg_20)
        .filter((v): v is number => v != null);

      if (!values.length) {
        generalAverages[st.student_id] = null;
        continue;
      }

      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      generalAverages[st.student_id] = avg;

      sumAll += avg;
      cntAll++;
      if (minAll == null || avg < minAll) minAll = avg;
      if (maxAll == null || avg > maxAll) maxAll = avg;

      if (avg < 5) dist.lt5++;
      else if (avg < 10) dist.between5_10++;
      else if (avg < 12) dist.between10_12++;
      else if (avg < 15) dist.between12_15++;
      else dist.gte15++;
    }

    const subjectStats: SubjectMatrixStat[] = [];
    for (const [subject_id, info] of subjectStatsMap.entries()) {
      subjectStats.push({
        subject_id,
        subject_name: info.subject,
        evals_count: info.evals,
        notes_count: info.notes,
        avg_20_class: info.cntAvg ? info.sumAvg / info.cntAvg : null,
      });
    }

    subjectStats.sort((a, b) => {
      const aVal = a.notes_count;
      const bVal = b.notes_count;
      return bVal - aVal;
    });

    // Rangs : par matière + rang général
    const generalRankValues: Record<string, number | null> = {};
    for (const st of studentsList) {
      generalRankValues[st.student_id] = generalAverages[st.student_id] ?? null;
    }
    const generalRanksRaw = computeRanks(generalRankValues);
    const generalRanks: Record<string, number | null> = {};
    for (const st of studentsList) {
      generalRanks[st.student_id] = generalRanksRaw[st.student_id] ?? null;
    }

    const ranksBySubject: Record<string, Record<string, number | null>> = {};
    for (const subj of subjectsForClass) {
      const vals: Record<string, number | null> = {};
      for (const st of studentsList) {
        const perSubj = averages[st.student_id] || {};
        const avg = perSubj[subj.subject_id]?.avg_20 ?? null;
        vals[st.student_id] = avg;
      }
      const rRaw = computeRanks(vals);
      const map: Record<string, number | null> = {};
      for (const st of studentsList) {
        map[st.student_id] = rRaw[st.student_id] ?? null;
      }
      ranksBySubject[subj.subject_id] = map;
    }

    return {
      class_id: classId,
      class_label: classInfo?.label || "Classe",
      level: classInfo?.level ?? null,
      students: studentsList,
      subjects: subjectsForClass,
      averages,
      generalAverages,
      global: {
        class_avg_20: cntAll ? sumAll / cntAll : null,
        class_min_20: minAll,
        class_max_20: maxAll,
        dist,
        subjectStats,
      },
      ranks: {
        general: generalRanks,
        bySubject: ranksBySubject,
      },
    };
  };

  /* ───────── Section 1 : charger la matrice pour la classe choisie ───────── */

  async function loadClassMatrix() {
    if (!matrixClassId) {
      setMatrixError("Choisissez d'abord une classe.");
      return;
    }
    setMatrixLoading(true);
    setMatrixError(null);
    setClassMatrix(null);
    try {
      const m = await computeClassMatrixForClass(matrixClassId);
      setClassMatrix(m);
    } catch (e: any) {
      console.error("[admin.notes.stats] loadClassMatrix error", e);
      setMatrixError(
        e?.message || "Erreur lors du calcul de la matrice pour cette classe."
      );
      setClassMatrix(null);
    } finally {
      setMatrixLoading(false);
    }
  }

  /* ───────── Calcul de matrice pour UNE matière dans UNE classe ───────── */

  const computeSubjectClassMatrix = async (
    classId: string,
    subjectId: string
  ): Promise<SubjectClassMatrix | null> => {
    const qs = new URLSearchParams();
    qs.set("class_id", classId);
    qs.set("subject_id", subjectId);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (status === "published") qs.set("published", "true");
    if (status === "draft") qs.set("published", "false");

    const res = await fetch("/api/admin/notes/matrix?" + qs.toString(), {
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as MatrixOk | MatrixErr | any;
    if (!res.ok || !json || !json.ok) {
      throw new Error((json && json.error) || `HTTP_${res.status}`);
    }

    const data = json as MatrixOk;
    const evaluations = data.evaluations || [];
    const marks = data.marks || {};
    const students = data.students || [];
    const meta = (data.meta || {}) as any;

    // Fallbacks fiables pour la classe et la matière
    const effectiveClassId = meta.class_id || classId;
    const classInfo =
      allClasses.find((c) => c.id === effectiveClassId) || null;

    const effectiveSubjectId = meta.subject_id || subjectId;
    const subjectRow =
      byClassSubject.find(
        (cs) =>
          cs.class_id === effectiveClassId &&
          cs.subject_id === effectiveSubjectId
      ) || null;

    const effectiveClassLabel =
      meta.class_label || classInfo?.label || "Classe";

    const effectiveLevel =
      meta.level ?? classInfo?.level ?? null;

    const effectiveSubjectName =
      meta.subject_name ?? subjectRow?.subject_name ?? "Matière";

    const metaByEval = new Map<string, { scale: number; coeff: number }>();
    for (const ev of evaluations) {
      metaByEval.set(ev.id, { scale: ev.scale, coeff: ev.coeff });
    }

    const teacherNamesSet = new Set<string>();
    for (const ev of evaluations) {
      if (ev.teacher_name && ev.teacher_name.trim()) {
        teacherNamesSet.add(ev.teacher_name.trim());
      }
    }
    const teacherNames =
      teacherNamesSet.size > 0
        ? Array.from(teacherNamesSet).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
          ).join(" / ")
        : null;

    const averages: SubjectClassMatrix["averages"] = {};
    const dist = {
      lt5: 0,
      between5_10: 0,
      between10_12: 0,
      between12_15: 0,
      gte15: 0,
    };
    let sumAll = 0;
    let cntAll = 0;
    let minAll: number | null = null;
    let maxAll: number | null = null;
    let totalNotes = 0;

    for (const st of students) {
      const evalMarks = (marks as any)[st.student_id] || {};
      let weightedSum = 0;
      let weights = 0;
      let nbNotes = 0;

      for (const [evalId, markObj] of Object.entries(evalMarks) as any) {
        const metaEval = metaByEval.get(evalId);
        if (!metaEval) continue;
        if (markObj.raw == null) continue;

        nbNotes++;
        const mark20 =
          markObj.mark_20 != null
            ? Number(markObj.mark_20)
            : (Number(markObj.raw) / metaEval.scale) * 20;

        weightedSum += mark20 * metaEval.coeff;
        weights += metaEval.coeff;
      }

      const avg = weights > 0 ? weightedSum / weights : null;
      averages[st.student_id] = {
        avg_20: avg,
        nb_evals: evaluations.length,
        nb_notes: nbNotes,
        rank: null,
      };

      if (avg != null) {
        sumAll += avg;
        cntAll++;
        if (minAll == null || avg < minAll) minAll = avg;
        if (maxAll == null || avg > maxAll) maxAll = avg;

        if (avg < 5) dist.lt5++;
        else if (avg < 10) dist.between5_10++;
        else if (avg < 12) dist.between10_12++;
        else if (avg < 15) dist.between12_15++;
        else dist.gte15++;
      }
      totalNotes += nbNotes;
    }

    const rankValues: Record<string, number | null> = {};
    for (const st of students) {
      rankValues[st.student_id] = averages[st.student_id]?.avg_20 ?? null;
    }
    const ranksRaw = computeRanks(rankValues);
    for (const st of students) {
      averages[st.student_id].rank = ranksRaw[st.student_id] ?? null;
    }

    return {
      class_id: effectiveClassId,
      class_label: effectiveClassLabel,
      level: effectiveLevel,
      subject_id: effectiveSubjectId,
      subject_name: effectiveSubjectName,
      teacher_names: teacherNames,
      students,
      averages,
      global: {
        class_avg_20: cntAll ? sumAll / cntAll : null,
        class_min_20: minAll,
        class_max_20: maxAll,
        dist,
        evals_count: evaluations.length,
        notes_count: totalNotes,
      },
    };
  };

  async function loadSubjectClassMatrix() {
    if (!selectedSubjectId) {
      setSubjectClassError("Choisissez d'abord une matière.");
      return;
    }
    if (!subjectClassId) {
      setSubjectClassError("Choisissez d'abord une classe.");
      return;
    }

    setSubjectClassLoading(true);
    setSubjectClassError(null);
    setSubjectClassMatrix(null);
    try {
      const m = await computeSubjectClassMatrix(subjectClassId, selectedSubjectId);
      setSubjectClassMatrix(m);
    } catch (e: any) {
      console.error("[admin.notes.stats] loadSubjectClassMatrix error", e);
      setSubjectClassError(
        e?.message || "Erreur lors du calcul de la matrice pour cette matière."
      );
      setSubjectClassMatrix(null);
    } finally {
      setSubjectClassLoading(false);
    }
  }

  /* ───────── Export CSV : matrice d'une classe (multi-disciplines) ───────── */

  function exportClassMatrixCsv() {
    if (!classMatrix) {
      setMatrixError(
        "Aucune matrice calculée pour la classe sélectionnée. Cliquez d'abord sur « Calculer »."
      );
      return;
    }

    const sep = ";";
    const {
      class_label,
      level,
      students,
      subjects,
      averages,
      generalAverages,
      ranks,
    } = classMatrix;
    const safe = (s: string | null | undefined) => (s ?? "").replace(/"/g, '""');

    const rows: string[] = [];

    if (currentYearLabelSafe) {
      rows.push(`Année scolaire;${safe(currentYearLabelSafe)}`);
    }
    if (currentPeriodLabelSafe) {
      const dates =
        currentPeriodStart && currentPeriodEnd
          ? `;${df.format(new Date(currentPeriodStart))};${df.format(
              new Date(currentPeriodEnd)
            )}`
          : "";
      rows.push(`Période;${safe(currentPeriodLabelSafe)}${dates}`);
    } else if (from || to) {
      rows.push(
        `Période;${from ? df.format(new Date(from)) : ""};${
          to ? df.format(new Date(to)) : ""
        }`
      );
    }

    rows.push(
      `Classe;${safe(class_label)}${level ? `;Niveau;${safe(level)}` : ""}`
    );
    rows.push("");

    const header = [
      "Eleve",
      "Matricule",
      ...subjects.flatMap((s) => [
        `MOY ${safe(s.subject_name)} /20`,
        `Rang ${safe(s.subject_name)}`,
      ]),
      "Moyenne_generale_20",
      "Rang_general",
    ];
    rows.push(header.join(sep));

    for (const st of students) {
      const perSubj = averages[st.student_id] || {};
      const cols: string[] = [];

      cols.push(`"${safe(st.full_name)}"`);
      cols.push(`"${safe(st.matricule)}"`);

      for (const subj of subjects) {
        const cell = perSubj[subj.subject_id];
        const avg = cell?.avg_20 ?? null;
        const rMap = ranks.bySubject[subj.subject_id] || {};
        const r = rMap[st.student_id] ?? null;

        cols.push(avg == null ? "" : nf.format(avg).replace(".", ","));
        cols.push(r == null ? "" : String(r));
      }

      const gen = generalAverages[st.student_id] ?? null;
      const rGen = ranks.general[st.student_id] ?? null;
      cols.push(gen == null ? "" : nf.format(gen).replace(".", ","));
      cols.push(rGen == null ? "" : String(rGen));

      rows.push(cols.join(sep));
    }

    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    a.href = url;
    a.download = `notes_moyennes_classe_${class_label}_${y}${m}${d}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ───────── Export PDF : matrice d'une classe (multi-disciplines) ───────── */

  function exportClassMatrixPdf() {
    if (typeof window === "undefined" || !classMatrix) return;

    const {
      class_label,
      level,
      students,
      subjects,
      averages,
      generalAverages,
      global,
      ranks,
    } = classMatrix;

    const title = `Matrice par classe — ${class_label}`;
    const subtitle = currentYearLabelSafe
      ? `Année scolaire ${currentYearLabelSafe}`
      : "Statistiques des notes";

    const periodText = currentPeriodLabelSafe
      ? `${currentPeriodLabelSafe}${
          currentPeriodStart && currentPeriodEnd
            ? ` (${formatDateFR(currentPeriodStart)} — ${formatDateFR(currentPeriodEnd)})`
            : ""
        }`
      : `${from ? formatDateFR(from) : "début"} — ${to ? formatDateFR(to) : "aujourd'hui"}`;

    const subjectHeader = subjects
      .map(
        (s) => `<th colspan="2">${escapeHtml(s.subject_name || "Matière")}</th>`
      )
      .join("");

    const subjectSubHeader = subjects
      .map(() => `<th>Moy.</th><th>Rang</th>`)
      .join("");

    const rows = students
      .map((st, idx) => {
        const perSubj = averages[st.student_id] || {};
        const cells = subjects
          .map((s) => {
            const cell = perSubj[s.subject_id];
            const avg = cell?.avg_20 ?? null;
            const rMap = ranks.bySubject[s.subject_id] || {};
            const r = rMap[st.student_id] ?? null;
            return `<td class="num">${formatNumber(avg)}</td><td class="num">${formatRank(r)}</td>`;
          })
          .join("");
        const gen = generalAverages[st.student_id] ?? null;
        const rGen = ranks.general[st.student_id] ?? null;
        return `<tr>
          <td class="num">${idx + 1}</td>
          <td>${escapeHtml(st.matricule || "")}</td>
          <td>${escapeHtml(st.full_name)}</td>
          ${cells}
          <td class="num strong">${formatNumber(gen)}</td>
          <td class="num strong">${formatRank(rGen)}</td>
        </tr>`;
      })
      .join("");

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${pdfBaseCss(true)}</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">${escapeHtml(subtitle)}</div>
  <div class="meta">
    <div><strong>Classe :</strong> ${escapeHtml(class_label)}</div>
    <div><strong>Niveau :</strong> ${escapeHtml(level || "—")}</div>
    <div><strong>Période :</strong> ${escapeHtml(periodText)}</div>
    <div><strong>Élèves :</strong> ${students.length}</div>
    <div><strong>Moyenne classe :</strong> ${formatNumber(global.class_avg_20)}</div>
    <div><strong>Plus forte :</strong> ${formatNumber(global.class_max_20)}</div>
    <div><strong>Plus faible :</strong> ${formatNumber(global.class_min_20)}</div>
  </div>

  <h2>Matières — indicateurs</h2>
  <table>
    <thead>
      <tr><th>Matière</th><th>Évals</th><th>Notes</th><th>Moyenne /20</th></tr>
    </thead>
    <tbody>
      ${global.subjectStats
        .map(
          (s) => `<tr>
            <td>${escapeHtml(s.subject_name)}</td>
            <td class="num">${s.evals_count}</td>
            <td class="num">${s.notes_count}</td>
            <td class="num strong">${formatNumber(s.avg_20_class)}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>

  <h2>Matrice des moyennes</h2>
  <table>
    <thead>
      <tr>
        <th rowspan="2">N°</th>
        <th rowspan="2">Matricule</th>
        <th rowspan="2">Nom et prénoms</th>
        ${subjectHeader}
        <th colspan="2">Général</th>
      </tr>
      <tr>${subjectSubHeader}<th>Moy.</th><th>Rang</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">Document généré depuis Mon Cahier — Nexa Digital SARL</div>
</body>
</html>`;

    openPrintHtml(html, () =>
      setMatrixError("Impossible d’ouvrir la fenêtre d’impression. Vérifiez le blocage des popups.")
    );
  }

    /* ───────── Export CSV : matrices pour TOUT un niveau ───────── */

  async function exportLevelMatricesCsv() {
    const levelToUse = matrixLevel;
    if (!levelToUse) {
      setMatrixError("Choisissez d'abord un niveau pour exporter les matrices en masse.");
      return;
    }
    const classesToExport = allClasses.filter((c) => c.level === levelToUse);
    if (!classesToExport.length) {
      setMatrixError("Aucune classe trouvée pour ce niveau.");
      return;
    }

    setMatrixError(null);
    const sep = ";";
    const safe = (s: string | null | undefined) => (s ?? "").replace(/"/g, '""');
    const rows: string[] = [];

    if (currentYearLabelSafe) {
      rows.push(`Année scolaire;${safe(currentYearLabelSafe)}`);
    }
    if (currentPeriodLabelSafe) {
      const dates =
        currentPeriodStart && currentPeriodEnd
          ? `;${df.format(new Date(currentPeriodStart))};${df.format(
              new Date(currentPeriodEnd)
            )}`
          : "";
      rows.push(`Période;${safe(currentPeriodLabelSafe)}${dates}`);
    } else if (from || to) {
      rows.push(
        `Période;${from ? df.format(new Date(from)) : ""};${
          to ? df.format(new Date(to)) : ""
        }`
      );
    }
    rows.push("");

    for (const cls of classesToExport) {
      try {
        const m = await computeClassMatrixForClass(cls.id);
        if (!m) continue;

        const {
          class_label,
          level,
          students,
          subjects,
          averages,
          generalAverages,
          ranks,
        } = m;

        rows.push(
          `Classe;${safe(class_label)}${level ? `;Niveau;${safe(level)}` : ""}`
        );
        rows.push("");

        const header = [
          "Eleve",
          "Matricule",
          ...subjects.flatMap((s) => [
            `MOY ${safe(s.subject_name)} /20`,
            `Rang ${safe(s.subject_name)}`,
          ]),
          "Moyenne_generale_20",
          "Rang_general",
        ];
        rows.push(header.join(sep));

        for (const st of students) {
          const perSubj = averages[st.student_id] || {};
          const cols: string[] = [];

          cols.push(`"${safe(st.full_name)}"`);
          cols.push(`"${safe(st.matricule)}"`);

          for (const subj of subjects) {
            const cell = perSubj[subj.subject_id];
            const avg = cell?.avg_20 ?? null;
            const rMap = ranks.bySubject[subj.subject_id] || {};
            const r = rMap[st.student_id] ?? null;

            cols.push(avg == null ? "" : nf.format(avg).replace(".", ","));
            cols.push(r == null ? "" : String(r));
          }

          const gen = generalAverages[st.student_id] ?? null;
          const rGen = ranks.general[st.student_id] ?? null;
          cols.push(gen == null ? "" : nf.format(gen).replace(".", ","));
          cols.push(rGen == null ? "" : String(rGen));

          rows.push(cols.join(sep));
        }

        rows.push("");
        rows.push("");
      } catch (e) {
        console.error("[admin.notes.stats] exportLevelMatricesCsv error", e);
      }
    }

    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    a.href = url;
    a.download = `notes_moyennes_niveau_${levelToUse}_${y}${m}${d}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ───────── Export PDF : matrices pour tout un niveau ───────── */

  async function exportLevelMatricesPdf() {
    if (typeof window === "undefined") return;
    const levelToUse = matrixLevel;
    if (!levelToUse) {
      setMatrixError("Choisissez d'abord un niveau pour exporter en PDF.");
      return;
    }
    const classesToExport = allClasses.filter((c) => c.level === levelToUse);
    if (!classesToExport.length) {
      setMatrixError("Aucune classe trouvée pour ce niveau.");
      return;
    }

    const periodText = currentPeriodLabelSafe
      ? `${currentPeriodLabelSafe}${
          currentPeriodStart && currentPeriodEnd
            ? ` (${formatDateFR(currentPeriodStart)} — ${formatDateFR(currentPeriodEnd)})`
            : ""
        }`
      : `${from ? formatDateFR(from) : "début"} — ${to ? formatDateFR(to) : "aujourd'hui"}`;

    const htmlParts: string[] = [];
    htmlParts.push(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(`Matrices par niveau — ${levelToUse}`)}</title>
<style>${pdfBaseCss(true)} .page-break { page-break-before: always; }</style>
</head>
<body>
  <h1>${escapeHtml(`Matrices par niveau — ${levelToUse}`)}</h1>
  <div class="subtitle">${escapeHtml(currentYearLabelSafe ? `Année scolaire ${currentYearLabelSafe}` : "Statistiques des notes")}</div>
  <div class="meta">
    <div><strong>Niveau :</strong> ${escapeHtml(levelToUse)}</div>
    <div><strong>Période :</strong> ${escapeHtml(periodText)}</div>
    <div><strong>Classes :</strong> ${classesToExport.length}</div>
  </div>`);

    for (const [idx, cls] of classesToExport.entries()) {
      try {
        const m = await computeClassMatrixForClass(cls.id);
        if (!m) continue;

        const { class_label, level, students, subjects, averages, generalAverages, ranks } = m;
        const subjectHeader = subjects
          .map((s) => `<th colspan="2">${escapeHtml(s.subject_name || "Matière")}</th>`)
          .join("");
        const subjectSubHeader = subjects.map(() => `<th>Moy.</th><th>Rang</th>`).join("");
        const rows = students
          .map((st, rowIdx) => {
            const perSubj = averages[st.student_id] || {};
            const cells = subjects
              .map((s) => {
                const cell = perSubj[s.subject_id];
                const avg = cell?.avg_20 ?? null;
                const rMap = ranks.bySubject[s.subject_id] || {};
                const r = rMap[st.student_id] ?? null;
                return `<td class="num">${formatNumber(avg)}</td><td class="num">${formatRank(r)}</td>`;
              })
              .join("");
            const gen = generalAverages[st.student_id] ?? null;
            const rGen = ranks.general[st.student_id] ?? null;
            return `<tr>
              <td class="num">${rowIdx + 1}</td>
              <td>${escapeHtml(st.matricule || "")}</td>
              <td>${escapeHtml(st.full_name)}</td>
              ${cells}
              <td class="num strong">${formatNumber(gen)}</td>
              <td class="num strong">${formatRank(rGen)}</td>
            </tr>`;
          })
          .join("");

        htmlParts.push(`
          <section class="${idx === 0 ? "" : "page-break"}">
            <h2>Classe ${escapeHtml(class_label)} ${level ? `(${escapeHtml(level)})` : ""}</h2>
            <table>
              <thead>
                <tr>
                  <th rowspan="2">N°</th>
                  <th rowspan="2">Matricule</th>
                  <th rowspan="2">Nom et prénoms</th>
                  ${subjectHeader}
                  <th colspan="2">Général</th>
                </tr>
                <tr>${subjectSubHeader}<th>Moy.</th><th>Rang</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </section>
        `);
      } catch (e) {
        console.error("[admin.notes.stats] exportLevelMatricesPdf class error", e);
      }
    }

    htmlParts.push(`<div class="footer">Document généré depuis Mon Cahier — Nexa Digital SARL</div></body></html>`);
    openPrintHtml(htmlParts.join(""), () =>
      setMatrixError("Impossible d’ouvrir la fenêtre d’impression. Vérifiez le blocage des popups.")
    );
  }

    /* ───────── Export CSV : section par matière (vue agrégée par classe) ───────── */

  function exportSubjectAggregatedCsv() {
    if (!subjectView) return;

    const sep = ";";
    const safe = (s: string | null | undefined) => (s ?? "").replace(/"/g, '""');

    const rows: string[] = [];

    if (currentYearLabelSafe) {
      rows.push(`Année scolaire;${safe(currentYearLabelSafe)}`);
    }
    if (currentPeriodLabelSafe) {
      const dates =
        currentPeriodStart && currentPeriodEnd
          ? `;${df.format(new Date(currentPeriodStart))};${df.format(
              new Date(currentPeriodEnd)
            )}`
          : "";
      rows.push(`Période;${safe(currentPeriodLabelSafe)}${dates}`);
    } else if (from || to) {
      rows.push(
        `Période;${from ? df.format(new Date(from)) : ""};${
          to ? df.format(new Date(to)) : ""
        }`
      );
    }

    rows.push(
      `Matière;${safe(subjectView.subject_name)};ID;${safe(
        subjectView.subject_id
      )}`
    );
    rows.push("");

    rows.push(
      [
        "Évals_totales",
        "Notes_totales",
        "Moyenne_globale_20",
        "Min_moyenne_classe",
        "Max_moyenne_classe",
      ].join(sep)
    );
    rows.push(
      [
        subjectView.global.evals_count.toString(),
        subjectView.global.notes_count.toString(),
        subjectView.global.avg_20 == null
          ? ""
          : nf.format(subjectView.global.avg_20).replace(".", ","),
        subjectView.global.min_20 == null
          ? ""
          : nf.format(subjectView.global.min_20).replace(".", ","),
        subjectView.global.max_20 == null
          ? ""
          : nf.format(subjectView.global.max_20).replace(".", ","),
      ].join(sep)
    );

    rows.push("");
    rows.push(
      ["Classe", "Niveau", "Évals", "Notes", "Moyenne_classe_20"].join(sep)
    );

    for (const r of subjectView.rows) {
      rows.push(
        [
          `"${safe(r.class_label)}"`,
          `"${safe(r.level)}"`,
          r.evals_count.toString(),
          r.notes_count.toString(),
          r.avg_score_20 == null
            ? ""
            : nf.format(r.avg_score_20).replace(".", ","),
        ].join(sep)
      );
    }

    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    a.href = url;
    a.download = `stats_matiere_${subjectView.subject_name}_${y}${m}${d}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ───────── Export PDF : section par matière (vue agrégée par classe) ───────── */

  function exportSubjectAggregatedPdf() {
    if (typeof window === "undefined" || !subjectView) return;

    const periodText = currentPeriodLabelSafe
      ? `${currentPeriodLabelSafe}${
          currentPeriodStart && currentPeriodEnd
            ? ` (${formatDateFR(currentPeriodStart)} — ${formatDateFR(currentPeriodEnd)})`
            : ""
        }`
      : `${from ? formatDateFR(from) : "début"} — ${to ? formatDateFR(to) : "aujourd'hui"}`;

    const title = `Statistiques par matière — ${subjectView.subject_name}`;
    const rows = subjectView.rows
      .map(
        (r) => `<tr>
          <td>${escapeHtml(r.class_label)}</td>
          <td>${escapeHtml(r.level || "")}</td>
          <td class="num">${r.evals_count}</td>
          <td class="num">${r.notes_count}</td>
          <td class="num strong">${formatNumber(r.avg_score_20)}</td>
        </tr>`
      )
      .join("");

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${pdfBaseCss(true)}</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">${escapeHtml(currentYearLabelSafe ? `Année scolaire ${currentYearLabelSafe}` : "Statistiques des notes")}</div>
  <div class="meta">
    <div><strong>Matière :</strong> ${escapeHtml(subjectView.subject_name)}</div>
    <div><strong>Période :</strong> ${escapeHtml(periodText)}</div>
    <div><strong>Classes :</strong> ${subjectView.rows.length}</div>
    <div><strong>Moyenne globale :</strong> ${formatNumber(subjectView.global.avg_20)}</div>
    <div><strong>Plus forte :</strong> ${formatNumber(subjectView.global.max_20)}</div>
    <div><strong>Plus faible :</strong> ${formatNumber(subjectView.global.min_20)}</div>
    <div><strong>Volume :</strong> ${subjectView.global.evals_count} évals · ${subjectView.global.notes_count} notes</div>
  </div>

  <table>
    <thead>
      <tr><th>Classe</th><th>Niveau</th><th>Évals</th><th>Notes</th><th>Moyenne /20</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">Document généré depuis Mon Cahier — Nexa Digital SARL</div>
</body>
</html>`;

    openPrintHtml(html, () =>
      setSubjectClassError("Impossible d’ouvrir la fenêtre d’impression. Vérifiez le blocage des popups.")
    );
  }

    /* ───────── Export CSV : matrice élèves pour une matière donnée (section 2) ───────── */

  function exportSubjectClassCsv() {
    if (!subjectClassMatrix) {
      setSubjectClassError(
        "Aucune matrice élèves pour cette matière. Lancez le calcul d'abord."
      );
      return;
    }

    const sep = ";";
    const { class_label, level, subject_name, teacher_names, students, averages, global } =
      subjectClassMatrix;
    const safe = (s: string | null | undefined) => (s ?? "").replace(/"/g, '""');

    const rows: string[] = [];

    if (currentYearLabelSafe) {
      rows.push(`Année scolaire;${safe(currentYearLabelSafe)}`);
    }
    if (currentPeriodLabelSafe) {
      const dates =
        currentPeriodStart && currentPeriodEnd
          ? `;${df.format(new Date(currentPeriodStart))};${df.format(
              new Date(currentPeriodEnd)
            )}`
          : "";
      rows.push(`Période;${safe(currentPeriodLabelSafe)}${dates}`);
    } else if (from || to) {
      rows.push(
        `Période;${from ? df.format(new Date(from)) : ""};${
          to ? df.format(new Date(to)) : ""
        }`
      );
    }

    rows.push(
      `Classe;${safe(class_label)}${level ? `;Niveau;${safe(level)}` : ""}`
    );
    rows.push(`Matière;${safe(subject_name)}`);
    if (teacher_names) {
      rows.push(`Professeur(s);${safe(teacher_names)}`);
    }
    rows.push("");

    rows.push(
      [
        "Moyenne_classe_20",
        "Min_20",
        "Max_20",
        "Nb_evals",
        "Nb_notes",
      ].join(sep)
    );
    rows.push(
      [
        global.class_avg_20 == null
          ? ""
          : nf.format(global.class_avg_20).replace(".", ","),
        global.class_min_20 == null
          ? ""
          : nf.format(global.class_min_20).replace(".", ","),
        global.class_max_20 == null
          ? ""
          : nf.format(global.class_max_20).replace(".", ","),
        global.evals_count.toString(),
        global.notes_count.toString(),
      ].join(sep)
    );

    rows.push("");
    rows.push(["Élève", "Matricule", "Moyenne_20", "Rang"].join(sep));

    for (const st of students) {
      const a = averages[st.student_id];
      const avg = a?.avg_20 ?? null;
      const r = a?.rank ?? null;
      rows.push(
        [
          `"${safe(st.full_name)}"`,
          `"${safe(st.matricule)}"`,
          avg == null ? "" : nf.format(avg).replace(".", ","),
          r == null ? "" : String(r),
        ].join(sep)
      );
    }

    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    a.href = url;
    a.download = `notes_${subject_name}_${class_label}_${y}${m}${d}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ───────── Export PDF : matrice élèves pour une matière donnée (section 2) ───────── */

  function exportSubjectClassPdf() {
    if (typeof window === "undefined" || !subjectClassMatrix) return;

    const { class_label, level, subject_name, teacher_names, students, averages, global } =
      subjectClassMatrix;

    const periodText = currentPeriodLabelSafe
      ? `${currentPeriodLabelSafe}${
          currentPeriodStart && currentPeriodEnd
            ? ` (${formatDateFR(currentPeriodStart)} — ${formatDateFR(currentPeriodEnd)})`
            : ""
        }`
      : `${from ? formatDateFR(from) : "début"} — ${to ? formatDateFR(to) : "aujourd'hui"}`;

    const title = `Matrice matière — ${subject_name || "Matière"}`;
    const rows = students
      .map((st, idx) => {
        const cell = averages[st.student_id];
        return `<tr>
          <td class="num">${idx + 1}</td>
          <td>${escapeHtml(st.matricule || "")}</td>
          <td>${escapeHtml(st.full_name)}</td>
          <td class="num strong">${formatNumber(cell?.avg_20 ?? null)}</td>
          <td class="num strong">${formatRank(cell?.rank ?? null)}</td>
          <td class="num">${cell?.nb_notes ?? 0}</td>
        </tr>`;
      })
      .join("");

    const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${pdfBaseCss(true)}</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">${escapeHtml(currentYearLabelSafe ? `Année scolaire ${currentYearLabelSafe}` : "Statistiques des notes")}</div>
  <div class="meta">
    <div><strong>Classe :</strong> ${escapeHtml(class_label)}</div>
    <div><strong>Niveau :</strong> ${escapeHtml(level || "—")}</div>
    <div><strong>Matière :</strong> ${escapeHtml(subject_name || "Matière")}</div>
    <div><strong>Professeur :</strong> ${escapeHtml(teacher_names || "—")}</div>
    <div><strong>Période :</strong> ${escapeHtml(periodText)}</div>
    <div><strong>Élèves :</strong> ${students.length}</div>
    <div><strong>Moyenne :</strong> ${formatNumber(global.class_avg_20)}</div>
    <div><strong>Plus forte :</strong> ${formatNumber(global.class_max_20)}</div>
    <div><strong>Plus faible :</strong> ${formatNumber(global.class_min_20)}</div>
  </div>

  <table>
    <thead>
      <tr><th>N°</th><th>Matricule</th><th>Nom et prénoms</th><th>Moyenne /20</th><th>Rang</th><th>Notes</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">Document généré depuis Mon Cahier — Nexa Digital SARL</div>
</body>
</html>`;

    openPrintHtml(html, () =>
      setSubjectClassError("Impossible d’ouvrir la fenêtre d’impression. Vérifiez le blocage des popups.")
    );
  }

    const overviewStats = useMemo(() => {
    const classCount = new Set(byClassSubject.map((r) => r.class_id)).size || allClasses.length;
    const subjectCount = new Set(
      byClassSubject.map((r) => r.subject_id).filter((id): id is string => !!id)
    ).size;
    const notesCount = byClassSubject.reduce((sum, r) => sum + Number(r.notes_count || 0), 0);
    const evalsCount = byClassSubject.reduce((sum, r) => sum + Number(r.evals_count || 0), 0);

    const avgCandidates = byClassSubject
      .filter((r) => r.avg_score_20 != null && r.notes_count > 0)
      .map((r) => ({ avg: Number(r.avg_score_20), weight: Number(r.notes_count || 1) }));

    const weightedSum = avgCandidates.reduce((sum, r) => sum + r.avg * r.weight, 0);
    const weightedDen = avgCandidates.reduce((sum, r) => sum + r.weight, 0);

    return {
      classCount,
      subjectCount,
      notesCount,
      evalsCount,
      avg: weightedDen ? weightedSum / weightedDen : null,
    };
  }, [allClasses.length, byClassSubject]);

  const activeClassAvg =
    activeTab === "class"
      ? classMatrix?.global.class_avg_20 ?? overviewStats.avg
      : subjectClassMatrix?.global.class_avg_20 ?? subjectView?.global.avg_20 ?? overviewStats.avg;

  const activeRowsCount =
    activeTab === "class"
      ? classMatrix?.students.length ?? 0
      : subjectClassMatrix?.students.length ?? subjectView?.rows.length ?? 0;

  const selectedSubjectLabel =
    subjectOptions.find((s) => s.id === selectedSubjectId)?.name ||
    subjectClassMatrix?.subject_name ||
    subjectView?.subject_name ||
    "Matière";

  /* ───────── Rendu ───────── */

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-900 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200/80">
              Cahier de notes • Matrices
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
              Statistiques avancées des notes
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
              Une interface plus simple : choisissez la période, puis travaillez soit par classe, soit par matière.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-200 sm:min-w-[420px]">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Lignes</div>
              <div className="mt-1 text-xl font-bold text-white">{activeRowsCount}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Moyenne</div>
              <div className="mt-1 text-xl font-bold text-white">{formatNumber(activeClassAvg)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Notes</div>
              <div className="mt-1 text-xl font-bold text-white">
                {overviewStats.notesCount.toLocaleString("fr-FR")}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-3">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <CalendarDays className="h-4 w-4" /> Année scolaire
            </label>
            <Select
              value={selectedYearCode}
              onChange={(e) => {
                setSelectedYearCode(e.target.value);
                setSelectedPeriodId("");
                setClassMatrix(null);
                setSubjectClassMatrix(null);
              }}
            >
              <option value="">
                {loadingYears ? "Chargement…" : "— Choisir une année —"}
              </option>
              {years.map((y) => (
                <option key={y.id} value={y.code}>
                  {y.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="lg:col-span-3">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Filter className="h-4 w-4" /> Période
            </label>
            <Select
              value={selectedPeriodId}
              onChange={(e) => {
                handlePeriodChange(e.target.value);
                setClassMatrix(null);
                setSubjectClassMatrix(null);
              }}
              disabled={!selectedYearCode || loadingPeriods}
            >
              <option value="">
                {selectedYearCode
                  ? loadingPeriods
                    ? "Chargement…"
                    : "Toute l'année"
                  : "Sélectionnez d'abord une année"}
              </option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <BarChart3 className="h-4 w-4" /> État
            </label>
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as any);
                setClassMatrix(null);
                setSubjectClassMatrix(null);
              }}
            >
              <option value="all">Toutes</option>
              <option value="published">Publiées</option>
              <option value="draft">Brouillons</option>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2 lg:col-span-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Du
              </label>
              <Input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setClassMatrix(null);
                  setSubjectClassMatrix(null);
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Au
              </label>
              <Input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setClassMatrix(null);
                  setSubjectClassMatrix(null);
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:col-span-2 lg:justify-end">
            <Button type="button" onClick={refreshStats} disabled={statsLoading}>
              {statsLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Actualiser
            </Button>
            <GhostButton
              type="button"
              onClick={() => {
                setFrom("");
                setTo("");
                setStatus("all");
                setByClassSubject([]);
                setStatsError(null);
                setClassMatrix(null);
                setMatrixError(null);
                setSelectedSubjectId("");
                setSubjectLevelFilter("");
                setSubjectClassId("");
                setSubjectClassMatrix(null);
                setSubjectClassError(null);
                setSelectedPeriodId("");
                setSelectedYearCode("");
              }}
            >
              Réinitialiser
            </GhostButton>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
            {periodLabel}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
            {overviewStats.classCount.toLocaleString("fr-FR")} classe(s)
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
            {overviewStats.subjectCount.toLocaleString("fr-FR")} matière(s)
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
            {overviewStats.evalsCount.toLocaleString("fr-FR")} évaluation(s)
          </span>
        </div>

        {statsError && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {statsError}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("class")}
            className={[
              "rounded-2xl px-4 py-3 text-sm font-bold transition",
              activeTab === "class"
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100",
            ].join(" ")}
          >
            <span className="inline-flex items-center gap-2">
              <School className="h-4 w-4" /> Matrice par classe
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("subject")}
            className={[
              "rounded-2xl px-4 py-3 text-sm font-bold transition",
              activeTab === "subject"
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100",
            ].join(" ")}
          >
            <span className="inline-flex items-center gap-2">
              <BookOpen className="h-4 w-4" /> Analyse par matière
            </span>
          </button>
        </div>
      </section>

      {activeTab === "class" ? (
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end">
              <div className="lg:col-span-3">
                <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <School className="h-4 w-4" /> Niveau
                </label>
                <Select
                  value={matrixLevel}
                  onChange={(e) => {
                    setMatrixLevel(e.target.value);
                    setMatrixClassId("");
                    setClassMatrix(null);
                    setMatrixError(null);
                  }}
                >
                  <option value="">— Choisir un niveau —</option>
                  {levels.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="lg:col-span-4">
                <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <FileSpreadsheet className="h-4 w-4" /> Classe
                </label>
                <Select
                  value={matrixClassId}
                  onChange={(e) => {
                    setMatrixClassId(e.target.value);
                    setClassMatrix(null);
                    setMatrixError(null);
                  }}
                  disabled={!matrixLevel}
                >
                  <option value="">— Choisir une classe —</option>
                  {classesForLevel.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-wrap gap-2 lg:col-span-5 lg:justify-end">
                <Button
                  type="button"
                  onClick={loadClassMatrix}
                  disabled={matrixLoading || !matrixClassId}
                >
                  {matrixLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  {matrixLoading ? "Chargement…" : "Charger"}
                </Button>
                <GhostButton
                  type="button"
                  onClick={exportClassMatrixCsv}
                  disabled={!classMatrix || !classMatrix.students.length}
                >
                  <Download className="h-4 w-4" /> CSV classe
                </GhostButton>
                <GhostButton
                  type="button"
                  onClick={exportClassMatrixPdf}
                  disabled={!classMatrix || !classMatrix.students.length}
                >
                  <Printer className="h-4 w-4" /> PDF classe
                </GhostButton>
                <GhostButton type="button" onClick={exportLevelMatricesCsv} disabled={!matrixLevel}>
                  <Download className="h-4 w-4" /> CSV niveau
                </GhostButton>
                <GhostButton type="button" onClick={exportLevelMatricesPdf} disabled={!matrixLevel}>
                  <Printer className="h-4 w-4" /> PDF niveau
                </GhostButton>
              </div>
            </div>

            {matrixError && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {matrixError}
              </div>
            )}
          </div>

          {classMatrix ? (
            <>
              <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-5 md:grid-cols-4">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Classe</div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {classMatrix.class_label} {classMatrix.level ? `• ${classMatrix.level}` : ""}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Moyenne</div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {formatNumber(classMatrix.global.class_avg_20)} /20
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Min / Max</div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {formatNumber(classMatrix.global.class_min_20)} / {formatNumber(classMatrix.global.class_max_20)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Élèves</div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {classMatrix.students.length.toLocaleString("fr-FR")}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <th rowSpan={2} className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left">N°</th>
                      <th rowSpan={2} className="sticky left-12 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left">Matricule</th>
                      <th rowSpan={2} className="sticky left-44 z-20 min-w-[260px] border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left">Nom et prénoms</th>
                      {classMatrix.subjects.map((s) => (
                        <th key={s.subject_id} colSpan={2} className="border-b border-r border-slate-200 bg-indigo-50 px-3 py-3 text-center text-indigo-800">
                          {s.subject_name}
                        </th>
                      ))}
                      <th colSpan={2} className="border-b border-slate-200 bg-emerald-50 px-3 py-3 text-center text-emerald-800">
                        Général
                      </th>
                    </tr>
                    <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      {classMatrix.subjects.map((s) => (
                        <Fragment key={`${s.subject_id}-sub`}>
                          <th className="border-b border-r border-slate-200 px-3 py-2 text-right">Moy.</th>
                          <th className="border-b border-r border-slate-200 px-3 py-2 text-right">Rang</th>
                        </Fragment>
                      ))}
                      <th className="border-b border-r border-slate-200 px-3 py-2 text-right">Moy.</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right">Rang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classMatrix.students.length === 0 ? (
                      <tr>
                        <td colSpan={3 + classMatrix.subjects.length * 2 + 2} className="px-6 py-14 text-center text-sm text-slate-500">
                          Aucune donnée à afficher pour cette sélection.
                        </td>
                      </tr>
                    ) : (
                      classMatrix.students.map((st, idx) => {
                        const perSubj = classMatrix.averages[st.student_id] || {};
                        const gen = classMatrix.generalAverages[st.student_id] ?? null;
                        const rGen = classMatrix.ranks.general[st.student_id] ?? null;
                        return (
                          <tr key={st.student_id} className="group odd:bg-white even:bg-slate-50/70 hover:bg-emerald-50/50">
                            <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-inherit px-3 py-2 font-medium text-slate-600">{idx + 1}</td>
                            <td className="sticky left-12 z-10 border-b border-r border-slate-100 bg-inherit px-3 py-2 text-slate-600">{st.matricule || "—"}</td>
                            <td className="sticky left-44 z-10 min-w-[260px] border-b border-r border-slate-100 bg-inherit px-3 py-2 font-semibold text-slate-900">{st.full_name}</td>
                            {classMatrix.subjects.map((s) => {
                              const cell = perSubj[s.subject_id];
                              const avg = cell?.avg_20 ?? null;
                              const rMap = classMatrix.ranks.bySubject[s.subject_id] || {};
                              const r = rMap[st.student_id] ?? null;
                              return (
                                <Fragment key={`${st.student_id}-${s.subject_id}`}>
                                  <td className="border-b border-r border-slate-100 px-3 py-2 text-right tabular-nums">{formatNumber(avg)}</td>
                                  <td className="border-b border-r border-slate-100 px-3 py-2 text-right tabular-nums">{formatRank(r)}</td>
                                </Fragment>
                              );
                            })}
                            <td className="border-b border-r border-slate-100 bg-emerald-50/60 px-3 py-2 text-right font-bold tabular-nums text-emerald-900">{formatNumber(gen)}</td>
                            <td className="border-b border-slate-100 bg-emerald-50/60 px-3 py-2 text-right font-bold tabular-nums text-emerald-900">{formatRank(rGen)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="px-6 py-14 text-center text-sm text-slate-500">
              Sélectionnez un niveau et une classe, puis cliquez sur « Charger ».
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end">
              <div className="lg:col-span-3">
                <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <BookOpen className="h-4 w-4" /> Matière
                </label>
                <Select
                  value={selectedSubjectId}
                  onChange={(e) => {
                    setSelectedSubjectId(e.target.value);
                    setSubjectClassId("");
                    setSubjectClassMatrix(null);
                    setSubjectClassError(null);
                  }}
                  disabled={statsLoading || !subjectOptions.length}
                >
                  <option value="">
                    {subjectOptions.length ? "— Choisir une matière —" : "Actualisez les statistiques"}
                  </option>
                  {subjectOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="lg:col-span-2">
                <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <School className="h-4 w-4" /> Niveau
                </label>
                <Select
                  value={subjectLevelFilter}
                  onChange={(e) => {
                    setSubjectLevelFilter(e.target.value);
                    setSubjectClassId("");
                    setSubjectClassMatrix(null);
                  }}
                  disabled={!selectedSubjectId}
                >
                  <option value="">Tous niveaux</option>
                  {levels.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="lg:col-span-3">
                <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <FileSpreadsheet className="h-4 w-4" /> Classe
                </label>
                <Select
                  value={subjectClassId}
                  onChange={(e) => {
                    setSubjectClassId(e.target.value);
                    setSubjectClassMatrix(null);
                    setSubjectClassError(null);
                  }}
                  disabled={!selectedSubjectId || !subjectClasses.length}
                >
                  <option value="">— Classe —</option>
                  {subjectClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-wrap gap-2 lg:col-span-4 lg:justify-end">
                <Button
                  type="button"
                  onClick={loadSubjectClassMatrix}
                  disabled={subjectClassLoading || !selectedSubjectId || !subjectClassId}
                >
                  {subjectClassLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  {subjectClassLoading ? "Chargement…" : "Charger"}
                </Button>
                <GhostButton type="button" onClick={exportSubjectAggregatedCsv} disabled={!subjectView}>
                  <Download className="h-4 w-4" /> CSV matière
                </GhostButton>
                <GhostButton type="button" onClick={exportSubjectAggregatedPdf} disabled={!subjectView}>
                  <Printer className="h-4 w-4" /> PDF matière
                </GhostButton>
                <GhostButton type="button" onClick={exportSubjectClassCsv} disabled={!subjectClassMatrix}>
                  <Download className="h-4 w-4" /> CSV classe
                </GhostButton>
                <GhostButton type="button" onClick={exportSubjectClassPdf} disabled={!subjectClassMatrix}>
                  <Printer className="h-4 w-4" /> PDF classe
                </GhostButton>
              </div>
            </div>

            {subjectClassError && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {subjectClassError}
              </div>
            )}
          </div>

          {!subjectOptions.length ? (
            <div className="px-6 py-14 text-center text-sm text-slate-500">
              Cliquez sur « Actualiser » en haut pour charger les matières disponibles sur la période sélectionnée.
            </div>
          ) : !selectedSubjectId ? (
            <div className="px-6 py-14 text-center text-sm text-slate-500">
              Sélectionnez une matière pour afficher les statistiques par classe.
            </div>
          ) : !subjectView ? (
            <div className="px-6 py-14 text-center text-sm text-slate-500">
              Aucune classe n’a de notes pour {selectedSubjectLabel} avec les filtres choisis.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-5 md:grid-cols-4">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Matière</div>
                  <div className="mt-1 text-base font-bold text-slate-900">{subjectView.subject_name}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Moyenne</div>
                  <div className="mt-1 text-base font-bold text-slate-900">{formatNumber(subjectView.global.avg_20)} /20</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Min / Max</div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {formatNumber(subjectView.global.min_20)} / {formatNumber(subjectView.global.max_20)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Volume</div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {subjectView.global.evals_count.toLocaleString("fr-FR")} évals · {subjectView.global.notes_count.toLocaleString("fr-FR")} notes
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto border-b border-slate-100">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <th className="border-b border-r border-slate-200 px-3 py-3 text-left">Classe</th>
                      <th className="border-b border-r border-slate-200 px-3 py-3 text-left">Niveau</th>
                      <th className="border-b border-r border-slate-200 px-3 py-3 text-right">Évals</th>
                      <th className="border-b border-r border-slate-200 px-3 py-3 text-right">Notes</th>
                      <th className="border-b border-slate-200 px-3 py-3 text-right">Moyenne /20</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjectView.rows.map((r) => (
                      <tr key={`${r.class_id}-${r.subject_id}`} className="odd:bg-white even:bg-slate-50/70 hover:bg-emerald-50/50">
                        <td className="border-b border-r border-slate-100 px-3 py-2 font-semibold text-slate-900">{r.class_label}</td>
                        <td className="border-b border-r border-slate-100 px-3 py-2 text-slate-600">{r.level || "—"}</td>
                        <td className="border-b border-r border-slate-100 px-3 py-2 text-right tabular-nums">{r.evals_count.toLocaleString("fr-FR")}</td>
                        <td className="border-b border-r border-slate-100 px-3 py-2 text-right tabular-nums">{r.notes_count.toLocaleString("fr-FR")}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right font-bold tabular-nums text-slate-900">{formatNumber(r.avg_score_20)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {subjectClassMatrix ? (
                <div className="space-y-0">
                  <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-5 md:grid-cols-4">
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Classe</div>
                      <div className="mt-1 text-base font-bold text-slate-900">
                        {subjectClassMatrix.class_label} {subjectClassMatrix.level ? `• ${subjectClassMatrix.level}` : ""}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Moyenne</div>
                      <div className="mt-1 text-base font-bold text-slate-900">
                        {formatNumber(subjectClassMatrix.global.class_avg_20)} /20
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Min / Max</div>
                      <div className="mt-1 text-base font-bold text-slate-900">
                        {formatNumber(subjectClassMatrix.global.class_min_20)} / {formatNumber(subjectClassMatrix.global.class_max_20)}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">Volume</div>
                      <div className="mt-1 text-base font-bold text-slate-900">
                        {subjectClassMatrix.global.evals_count.toLocaleString("fr-FR")} évals · {subjectClassMatrix.global.notes_count.toLocaleString("fr-FR")} notes
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-0 text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <th className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left">N°</th>
                          <th className="sticky left-12 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left">Matricule</th>
                          <th className="sticky left-44 z-20 min-w-[260px] border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-left">Nom et prénoms</th>
                          <th className="border-b border-r border-slate-200 bg-emerald-50 px-3 py-3 text-right text-emerald-800">Moyenne /20</th>
                          <th className="border-b border-r border-slate-200 bg-emerald-50 px-3 py-3 text-right text-emerald-800">Rang</th>
                          <th className="border-b border-slate-200 px-3 py-3 text-right">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subjectClassMatrix.students.map((st, idx) => {
                          const cell = subjectClassMatrix.averages[st.student_id];
                          return (
                            <tr key={st.student_id} className="odd:bg-white even:bg-slate-50/70 hover:bg-emerald-50/50">
                              <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-inherit px-3 py-2 font-medium text-slate-600">{idx + 1}</td>
                              <td className="sticky left-12 z-10 border-b border-r border-slate-100 bg-inherit px-3 py-2 text-slate-600">{st.matricule || "—"}</td>
                              <td className="sticky left-44 z-10 min-w-[260px] border-b border-r border-slate-100 bg-inherit px-3 py-2 font-semibold text-slate-900">{st.full_name}</td>
                              <td className="border-b border-r border-slate-100 bg-emerald-50/60 px-3 py-2 text-right font-bold tabular-nums text-emerald-900">{formatNumber(cell?.avg_20 ?? null)}</td>
                              <td className="border-b border-r border-slate-100 bg-emerald-50/60 px-3 py-2 text-right font-bold tabular-nums text-emerald-900">{formatRank(cell?.rank ?? null)}</td>
                              <td className="border-b border-slate-100 px-3 py-2 text-right tabular-nums">{cell?.nb_notes ?? 0}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="px-6 py-10 text-center text-sm text-slate-500">
                  Choisissez une classe puis cliquez sur « Charger » pour afficher les élèves de cette matière.
                </div>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
