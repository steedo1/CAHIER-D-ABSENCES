"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Filter,
  NotebookPen,
  RefreshCw,
  School,
  BookOpen,
  FileSpreadsheet,
  Target,
  BarChart3,
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
function Card(props: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { title, subtitle, icon, children, actions } = props;
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
            {icon}
            <span>{title}</span>
          </div>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
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

    const yearHtml = currentYearLabelSafe
      ? `<span><strong>Année scolaire :</strong> ${currentYearLabelSafe}</span>`
      : `<span>&nbsp;</span>`;

    const levelHtml = `<span><strong>Niveau :</strong> ${level ?? "—"}</span>`;
    const classHtml = `<span><strong>Classe :</strong> ${class_label}</span>`;

    const periodHtml = currentPeriodLabelSafe
      ? `<span><strong>Période :</strong> ${currentPeriodLabelSafe}${
          currentPeriodStart && currentPeriodEnd
            ? ` (${df.format(new Date(currentPeriodStart))} – ${df.format(
                new Date(currentPeriodEnd)
              )})`
            : ""
        }</span>`
      : `<span><strong>Période :</strong> ${
          from ? df.format(new Date(from)) : "début"
        } – ${to ? df.format(new Date(to)) : "aujourd'hui"}</span>`;

    const tableHeader = `
      <tr>
        <th style="text-align:left;padding:4px;border:1px solid #ddd;">Élève</th>
        ${subjects
          .map(
            (s) => `
          <th colspan="2" style="text-align:center;padding:4px;border:1px solid #ddd;">
            ${s.subject_name || "Matière"}
          </th>
        `
          )
          .join("")}
        <th colspan="2" style="text-align:center;padding:4px;border:1px solid #ddd;">
          Moyenne générale
        </th>
      </tr>
      <tr>
        ${[0]
          .map(
            () =>
              `<th style="text-align:left;padding:4px;border:1px solid #ddd;"></th>`
          )
          .join("")}
        ${subjects
          .map(
            () => `
          <th style="text-align:right;padding:4px;border:1px solid #ddd;">MOY</th>
          <th style="text-align:right;padding:4px;border:1px solid #ddd;">Rang</th>
        `
          )
          .join("")}
        <th style="text-align:right;padding:4px;border:1px solid #ddd;">MOY</th>
        <th style="text-align:right;padding:4px;border:1px solid #ddd;">Rang</th>
      </tr>
    `;

    const tableRows = students
      .map((st) => {
        const perSubj = averages[st.student_id] || {};
        const gen = generalAverages[st.student_id] ?? null;
        const rGen = ranks.general[st.student_id] ?? null;
        const generalRankLabel = formatRank(rGen);

        const cells = subjects
          .map((s) => {
            const cell = perSubj[s.subject_id];
            const avg = cell?.avg_20 ?? null;
            const rMap = ranks.bySubject[s.subject_id] || {};
            const r = rMap[st.student_id] ?? null;
            const rankLabel = formatRank(r);

            return `
              <td style="text-align:right;padding:4px;border:1px solid #ddd;">${
                avg == null ? "—" : nf.format(avg)
              }</td>
              <td style="text-align:right;padding:4px;border:1px solid #ddd;">${rankLabel}</td>
            `;
          })
          .join("");

        const nameBlock = `
          <div style="display:flex;flex-direction:column;">
            <span style="font-weight:600;">${st.full_name}</span>
            <span style="font-size:10px;color:#6b7280;">${st.matricule ?? ""}</span>
          </div>
        `;

        return `
          <tr>
            <td style="padding:4px;border:1px solid #ddd;">${nameBlock}</td>
            ${cells}
            <td style="text-align:right;padding:4px;border:1px solid #ddd;">${
              gen == null ? "—" : nf.format(gen)
            }</td>
            <td style="text-align:right;padding:4px;border:1px solid #ddd;">${generalRankLabel}</td>
          </tr>
        `;
      })
      .join("");

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Matrice de la classe ${class_label}</title>
          <style>
            body {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              font-size: 11px;
              color: #111827;
              margin: 24px;
            }
            h1 { font-size: 16px; margin-bottom: 6px; }
            h2 { font-size: 13px; margin: 10px 0 4px; }
            table { border-collapse: collapse; width: 100%; margin-top: 6px; }
            th, td { border: 1px solid #ddd; padding: 4px; }
            th { background: #f1f5f9; }
            ul { font-size: 10px; padding-left: 16px; margin-top: 4px; }
            .meta-row {
              display: flex;
              justify-content: space-between;
              gap: 8px;
              font-size: 10px;
              margin-bottom: 4px;
              flex-wrap: wrap;
            }
          </style>
        </head>
        <body>
          <h1>Matrice de notes de la classe ${class_label}</h1>

          <div class="meta-row">
            ${yearHtml}
            ${levelHtml}
            ${classHtml}
            ${periodHtml}
          </div>

          <h2>Statistiques de classe</h2>
          <ul>
            <li>Moyenne de classe : ${
              global.class_avg_20 == null ? "—" : nf.format(global.class_avg_20)
            } /20</li>
            <li>Min / Max des moyennes élèves : ${
              global.class_min_20 == null ? "—" : nf.format(global.class_min_20)
            } / ${
      global.class_max_20 == null ? "—" : nf.format(global.class_max_20)
    }</li>
            <li>
              Répartition des moyennes (élèves) :
              &lt;5 : ${global.dist.lt5} · [5;10[ : ${
      global.dist.between5_10
    } · [10;12[ : ${global.dist.between10_12} · [12;15[ : ${
      global.dist.between12_15
    } · ≥15 : ${global.dist.gte15}
            </li>
          </ul>

          <h2>Matières – Indicateurs</h2>
          <table>
            <tr>
              <th>Matière</th>
              <th style="text-align:right;">Évals</th>
              <th style="text-align:right;">Notes</th>
              <th style="text-align:right;">Moyenne /20</th>
            </tr>
            ${global.subjectStats
              .map(
                (s) => `
              <tr>
                <td>${s.subject_name}</td>
                <td style="text-align:right;">${s.evals_count}</td>
                <td style="text-align:right;">${s.notes_count}</td>
                <td style="text-align:right;">${
                  s.avg_20_class == null ? "—" : nf.format(s.avg_20_class)
                }</td>
              </tr>
            `
              )
              .join("")}
          </table>

          <h2>Matrice des moyennes par élève</h2>
          <table>
            <thead>${tableHeader}</thead>
            <tbody>${tableRows}</tbody>
          </table>
        </body>
      </html>
    `;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
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

    const yearHtml = currentYearLabelSafe
      ? `<span><strong>Année scolaire :</strong> ${currentYearLabelSafe}</span>`
      : `<span>&nbsp;</span>`;
    const periodHtml = currentPeriodLabelSafe
      ? `<span><strong>Période :</strong> ${currentPeriodLabelSafe}${
          currentPeriodStart && currentPeriodEnd
            ? ` (${df.format(new Date(currentPeriodStart))} – ${df.format(
                new Date(currentPeriodEnd)
              )})`
            : ""
        }</span>`
      : `<span><strong>Période :</strong> ${
          from ? df.format(new Date(from)) : "début"
        } – ${to ? df.format(new Date(to)) : "aujourd'hui"}</span>`;

    const htmlParts: string[] = [];
    htmlParts.push(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Matrices de notes – Niveau ${levelToUse}</title>
          <style>
            body {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              font-size: 11px;
              color: #111827;
              margin: 24px;
            }
            h1 { font-size: 16px; margin-bottom: 6px; }
            h2 { font-size: 13px; margin: 14px 0 4px; }
            table { border-collapse: collapse; width: 100%; margin-top: 6px; }
            th, td { border: 1px solid #ddd; padding: 3px; }
            th { background: #f1f5f9; }
            .meta-row {
              display:flex;
              justify-content: space-between;
              gap:8px;
              font-size:10px;
              margin-bottom:8px;
              flex-wrap:wrap;
            }
          </style>
        </head>
        <body>
          <h1>Matrices de notes – Niveau ${levelToUse}</h1>
          <div class="meta-row">
            ${yearHtml}
            ${periodHtml}
          </div>
    `);

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

        const headerRow = `
          <tr>
            <th style="text-align:left;">Élève</th>
            ${subjects
              .map(
                (s) => `
              <th colspan="2" style="text-align:center;">${s.subject_name || "Matière"}</th>
            `
              )
              .join("")}
            <th colspan="2" style="text-align:center;">Moyenne générale</th>
          </tr>
          <tr>
            <th></th>
            ${subjects
              .map(
                () => `
              <th style="text-align:right;">MOY</th>
              <th style="text-align:right;">Rang</th>
            `
              )
              .join("")}
            <th style="text-align:right;">MOY</th>
            <th style="text-align:right;">Rang</th>
          </tr>
        `;
        const rows = students
          .map((st) => {
            const perSubj = averages[st.student_id] || {};
            const gen = generalAverages[st.student_id] ?? null;
            const rGen = ranks.general[st.student_id] ?? null;
            const generalRankLabel = formatRank(rGen);
            const cells = subjects
              .map((s) => {
                const cell = perSubj[s.subject_id];
                const avg = cell?.avg_20 ?? null;
                const rMap = ranks.bySubject[s.subject_id] || {};
                const r = rMap[st.student_id] ?? null;
                const rankLabel = formatRank(r);
                return `
                  <td style="text-align:right;">${avg == null ? "—" : nf.format(avg)}</td>
                  <td style="text-align:right;">${rankLabel}</td>
                `;
              })
              .join("");
            const nameBlock = `
              <div style="display:flex;flex-direction:column;">
                <span style="font-weight:600;">${st.full_name}</span>
                <span style="font-size:10px;color:#6b7280;">${st.matricule ?? ""}</span>
              </div>
            `;
            return `
              <tr>
                <td>${nameBlock}</td>
                ${cells}
                <td style="text-align:right;">${gen == null ? "—" : nf.format(gen)}</td>
                <td style="text-align:right;">${generalRankLabel}</td>
              </tr>
            `;
          })
          .join("");

        htmlParts.push(`
          <h2>Classe ${class_label} (${level ?? "—"})</h2>
          <table>
            <thead>${headerRow}</thead>
            <tbody>${rows}</tbody>
          </table>
        `);
      } catch (e) {
        console.error("[admin.notes.stats] exportLevelMatricesPdf class error", e);
      }
    }

    htmlParts.push(`</body></html>`);
    const html = htmlParts.join("");

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
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

    const yearHtml = currentYearLabelSafe
      ? `<span><strong>Année scolaire :</strong> ${currentYearLabelSafe}</span>`
      : `<span>&nbsp;</span>`;
    const periodHtml = currentPeriodLabelSafe
      ? `<span><strong>Période :</strong> ${currentPeriodLabelSafe}${
          currentPeriodStart && currentPeriodEnd
            ? ` (${df.format(new Date(currentPeriodStart))} – ${df.format(
                new Date(currentPeriodEnd)
              )})`
            : ""
        }</span>`
      : `<span><strong>Période :</strong> ${
          from ? df.format(new Date(from)) : "début"
        } – ${to ? df.format(new Date(to)) : "aujourd'hui"}</span>`;

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Statistiques matière – ${subjectView.subject_name}</title>
          <style>
            body {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              font-size: 11px;
              color: #111827;
              margin: 24px;
            }
            h1 { font-size: 16px; margin-bottom: 6px; }
            h2 { font-size: 13px; margin: 10px 0 4px; }
            table { border-collapse: collapse; width: 100%; margin-top: 6px; }
            th, td { border: 1px solid #ddd; padding: 4px; }
            th { background: #f1f5f9; }
            ul { font-size: 10px; padding-left: 16px; margin-top: 4px; }
            .meta-row {
              display:flex;
              justify-content: space-between;
              gap:8px;
              font-size:10px;
              margin-bottom:4px;
              flex-wrap:wrap;
            }
          </style>
        </head>
        <body>
          <h1>Analyse par matière – ${subjectView.subject_name}</h1>
          <div class="meta-row">
            ${yearHtml}
            ${periodHtml}
          </div>

          <h2>Statistiques globales (par classe)</h2>
          <ul>
            <li>Moyenne globale (pondérée) : ${
              subjectView.global.avg_20 == null
                ? "—"
                : nf.format(subjectView.global.avg_20)
            } /20</li>
            <li>Min / Max des moyennes de classe : ${
              subjectView.global.min_20 == null
                ? "—"
                : nf.format(subjectView.global.min_20)
            } / ${
      subjectView.global.max_20 == null
        ? "—"
        : nf.format(subjectView.global.max_20)
    }</li>
            <li>Volume : ${
              subjectView.global.evals_count
            } évaluations · ${subjectView.global.notes_count} notes</li>
            <li>
              Répartition des classes (selon la moyenne) :
              &lt;5 : ${subjectView.global.dist_classes.lt5} ·
              [5;10[ : ${subjectView.global.dist_classes.between5_10} ·
              [10;12[ : ${subjectView.global.dist_classes.between10_12} ·
              [12;15[ : ${subjectView.global.dist_classes.between12_15} ·
              ≥15 : ${subjectView.global.dist_classes.gte15}
            </li>
          </ul>

          <h2>Détail par classe</h2>
          <table>
            <thead>
              <tr>
                <th>Classe</th>
                <th>Niveau</th>
                <th style="text-align:right;">Évals</th>
                <th style="text-align:right;">Notes</th>
                <th style="text-align:right;">Moyenne /20</th>
              </tr>
            </thead>
            <tbody>
              ${subjectView.rows
                .map(
                  (r) => `
                <tr>
                  <td>${r.class_label}</td>
                  <td>${r.level ?? ""}</td>
                  <td style="text-align:right;">${r.evals_count}</td>
                  <td style="text-align:right;">${r.notes_count}</td>
                  <td style="text-align:right;">${
                    r.avg_score_20 == null ? "—" : nf.format(r.avg_score_20)
                  }</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
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

    const {
      class_label,
      level,
      subject_name,
      teacher_names,
      students,
      averages,
      global,
    } = subjectClassMatrix;

    const fallbackSubjectName =
      subject_name ||
      subjectOptions.find((s) => s.id === selectedSubjectId)?.name ||
      "Matière";
    const fallbackClassLabel = class_label || "Classe";
    const fallbackLevel = level || null;

    const yearHtml = currentYearLabelSafe
      ? `<span><strong>Année scolaire :</strong> ${currentYearLabelSafe}</span>`
      : `<span>&nbsp;</span>`;
    const periodHtml = currentPeriodLabelSafe
      ? `<span><strong>Période :</strong> ${currentPeriodLabelSafe}${
          currentPeriodStart && currentPeriodEnd
            ? ` (${df.format(new Date(currentPeriodStart))} – ${df.format(
                new Date(currentPeriodEnd)
              )})`
            : ""
        }</span>`
      : `<span><strong>Période :</strong> ${
          from ? df.format(new Date(from)) : "début"
        } – ${to ? df.format(new Date(to)) : "aujourd'hui"}</span>`;

    const teacherLine = teacher_names
      ? `<span><strong>Professeur(s) :</strong> ${teacher_names}</span>`
      : "";

    const distributionTable = `
      <table>
        <thead>
          <tr>
            <th>Tranche de moyenne</th>
            <th style="text-align:right;">Nombre d'élèves</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>&lt; 5</td>
            <td style="text-align:right;">${global.dist.lt5}</td>
          </tr>
          <tr>
            <td>[5 ; 10[</td>
            <td style="text-align:right;">${global.dist.between5_10}</td>
          </tr>
          <tr>
            <td>[10 ; 12[</td>
            <td style="text-align:right;">${global.dist.between10_12}</td>
          </tr>
          <tr>
            <td>[12 ; 15[</td>
            <td style="text-align:right;">${global.dist.between12_15}</td>
          </tr>
          <tr>
            <td>≥ 15</td>
            <td style="text-align:right;">${global.dist.gte15}</td>
          </tr>
        </tbody>
      </table>
    `;

    const rows = students
      .map((st) => {
        const a = averages[st.student_id];
        const avg = a?.avg_20 ?? null;
        const r = a?.rank ?? null;
        const rLabel = formatRank(r);
        const nameBlock = `
          <div style="display:flex;flex-direction:column;">
            <span style="font-weight:600;">${st.full_name}</span>
            <span style="font-size:10px;color:#6b7280;">${st.matricule ?? ""}</span>
          </div>
        `;
        return `
          <tr>
            <td>${nameBlock}</td>
            <td style="text-align:right;">${avg == null ? "—" : nf.format(avg)}</td>
            <td style="text-align:right;">${rLabel}</td>
          </tr>
        `;
      })
      .join("");

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Moyennes – ${fallbackSubjectName} – ${fallbackClassLabel}</title>
          <style>
            body {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              font-size: 11px;
              color: #111827;
              margin: 24px;
            }
            h1 { font-size: 16px; margin-bottom: 6px; }
            h2 { font-size: 13px; margin: 10px 0 4px; }
            table { border-collapse: collapse; width: 100%; margin-top: 6px; }
            th, td { border: 1px solid #ddd; padding: 4px; }
            th { background: #f1f5f9; }
            ul { font-size: 10px; padding-left: 16px; margin-top: 4px; }
            .meta-row {
              display:flex;
              justify-content: space-between;
              gap:8px;
              font-size:10px;
              margin-bottom:4px;
              flex-wrap:wrap;
            }
          </style>
        </head>
        <body>
          <h1>${fallbackSubjectName} – Classe ${fallbackClassLabel}</h1>
          <div class="meta-row">
            ${yearHtml}
            <span><strong>Niveau :</strong> ${fallbackLevel ?? "—"}</span>
            ${periodHtml}
            ${teacherLine}
          </div>

          <h2>Statistiques de la matière (élèves)</h2>
          <ul>
            <li>Moyenne de la classe : ${
              global.class_avg_20 == null ? "—" : nf.format(global.class_avg_20)
            } /20</li>
            <li>Min / Max des moyennes élèves : ${
              global.class_min_20 == null ? "—" : nf.format(global.class_min_20)
            } / ${
      global.class_max_20 == null ? "—" : nf.format(global.class_max_20)
    }</li>
            <li>Volume : ${global.evals_count} évaluations · ${
      global.notes_count
    } notes</li>
          </ul>

          <h2>Répartition des moyennes des élèves</h2>
          ${distributionTable}

          <h2>Détail des élèves</h2>
          <table>
            <thead>
              <tr>
                <th>Élève</th>
                <th style="text-align:right;">MOY /20</th>
                <th style="text-align:right;">Rang</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  /* ───────── Rendu ───────── */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">
          Statistiques avancées des notes
        </h1>
        <p className="text-sm text-slate-600">
          Deux vues : matrice par classe (toutes les disciplines) et analyse par matière (une
          discipline à la fois) — avec toujours la liste des élèves et leurs moyennes.
        </p>
      </div>

      {/* Filtres globaux */}
      <Card
        title="Filtres globaux"
        subtitle="Année scolaire, période d'évaluation et filtres appliqués à toutes les statistiques."
        icon={<Filter className="h-4 w-4 text-emerald-600" />}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5 mb-3">
          {/* Année scolaire */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Année scolaire</div>
            <Select
              value={selectedYearCode}
              onChange={(e) => {
                setSelectedYearCode(e.target.value);
                setSelectedPeriodId("");
              }}
            >
              <option value="">
                {loadingYears ? "Chargement..." : "— Choisir une année scolaire —"}
              </option>
              {years.map((y) => (
                <option key={y.id} value={y.code}>
                  {y.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Période d'évaluation */}
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Période d&apos;évaluation</div>
            <Select
              value={selectedPeriodId}
              onChange={(e) => handlePeriodChange(e.target.value)}
              disabled={!selectedYearCode || loadingPeriods}
            >
              <option value="">
                {selectedYearCode
                  ? loadingPeriods
                    ? "Chargement..."
                    : "— Toute l'année —"
                  : "Sélectionnez d'abord une année"}
              </option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>

          {/* État de publication */}
          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">État de publication</div>
            <Select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="all">Toutes les évaluations</option>
              <option value="published">Publié pour les parents</option>
              <option value="draft">Brouillon uniquement</option>
            </Select>
          </div>
        </div>

        {/* Bornes explicites Du / Au si besoin d’ajuster manuellement */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Du</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Au</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" onClick={refreshStats} disabled={statsLoading}>
            {statsLoading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <BarChart3 className="h-4 w-4" />
            )}
            Actualiser les statistiques
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
          <span className="text-xs text-slate-500">{periodLabel}</span>
        </div>

        {statsError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {statsError}
          </div>
        )}
      </Card>

      {/* ───────── Section 1 : Matrice par classe (multi-disciplines) ───────── */}
      <Card
        title="Matrice par classe"
        subtitle="Pour une classe : toutes les disciplines, moyennes par matière, moyenne générale et rangs."
        icon={<School className="h-4 w-4 text-emerald-600" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GhostButton
              type="button"
              onClick={exportClassMatrixCsv}
              disabled={!classMatrix || !classMatrix.students.length}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exporter CSV (classe)
            </GhostButton>
            <GhostButton
              type="button"
              onClick={exportClassMatrixPdf}
              disabled={!classMatrix || !classMatrix.students.length}
            >
              <Target className="h-4 w-4" />
              Exporter PDF (classe)
            </GhostButton>
            <GhostButton
              type="button"
              onClick={exportLevelMatricesCsv}
              disabled={!matrixLevel}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export CSV (niveau)
            </GhostButton>
            <GhostButton
              type="button"
              onClick={exportLevelMatricesPdf}
              disabled={!matrixLevel}
            >
              <Target className="h-4 w-4" />
              Export PDF (niveau)
            </GhostButton>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4 mb-3">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
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
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Classe</div>
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
        </div>

        <div className="mb-3">
          <Button
            type="button"
            onClick={loadClassMatrix}
            disabled={matrixLoading || !matrixClassId}
          >
            {matrixLoading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <NotebookPen className="h-4 w-4" />
            )}
            Calculer la matrice
          </Button>
        </div>

        {matrixError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {matrixError}
          </div>
        )}

        {!classMatrix ? (
          <p className="text-xs text-slate-500">
            Choisissez un niveau, une classe, puis cliquez sur « Calculer la matrice » pour voir
            les moyennes par matière, la moyenne générale et les rangs des élèves.
          </p>
        ) : (
          <>
            {/* Stats de classe */}
            <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-4 text-xs">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">Classe</div>
                <div className="text-sm font-semibold text-slate-900">
                  {classMatrix.class_label}{" "}
                  {classMatrix.level ? `(${classMatrix.level})` : ""}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">Moyenne de classe</div>
                <div className="text-sm font-semibold text-slate-900">
                  {classMatrix.global.class_avg_20 == null
                    ? "—"
                    : `${nf.format(classMatrix.global.class_avg_20)} /20`}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">Min / Max des moyennes élèves</div>
                <div className="text-sm font-semibold text-slate-900">
                  {classMatrix.global.class_min_20 == null
                    ? "—"
                    : nf.format(classMatrix.global.class_min_20)}{" "}
                  /{" "}
                  {classMatrix.global.class_max_20 == null
                    ? "—"
                    : nf.format(classMatrix.global.class_max_20)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500 mb-1">
                  Répartition des moyennes (élèves)
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-slate-700">
                  <span>&lt; 5 : {classMatrix.global.dist.lt5}</span>
                  <span>[5 ; 10[ : {classMatrix.global.dist.between5_10}</span>
                  <span>[10 ; 12[ : {classMatrix.global.dist.between10_12}</span>
                  <span>[12 ; 15[ : {classMatrix.global.dist.between12_15}</span>
                  <span>≥ 15 : {classMatrix.global.dist.gte15}</span>
                </div>
              </div>
            </div>

            {/* Matières clés */}
            {classMatrix.global.subjectStats.length > 0 && (
              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <div className="mb-1 text-[11px] font-semibold text-slate-700">
                  Matières — indicateurs clés (classe)
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-[11px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600">
                        <th className="px-2 py-1 text-left">Matière</th>
                        <th className="px-2 py-1 text-right">Évals</th>
                        <th className="px-2 py-1 text-right">Notes</th>
                        <th className="px-2 py-1 text-right">Moyenne /20</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classMatrix.global.subjectStats.map((s) => (
                        <tr key={s.subject_id} className="border-t">
                          <td className="px-2 py-1 text-slate-700">{s.subject_name}</td>
                          <td className="px-2 py-1 text-right text-slate-700">
                            {s.evals_count.toLocaleString("fr-FR")}
                          </td>
                          <td className="px-2 py-1 text-right text-slate-700">
                            {s.notes_count.toLocaleString("fr-FR")}
                          </td>
                          <td className="px-2 py-1 text-right text-slate-700">
                            {s.avg_20_class == null ? "—" : nf.format(s.avg_20_class)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Matrice élèves × matières */}
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-xs sm:text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th
                      rowSpan={2}
                      className="px-2 py-2 text-left align-bottom"
                    >
                      Élève
                    </th>
                    {classMatrix.subjects.map((s) => (
                      <th
                        key={s.subject_id}
                        colSpan={2}
                        className="px-2 py-2 text-center align-bottom"
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="font-semibold">
                            {s.subject_name || "Matière"}
                          </span>
                        </div>
                      </th>
                    ))}
                    <th colSpan={2} className="px-2 py-2 text-center align-bottom">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-semibold">Moyenne générale</span>
                      </div>
                    </th>
                  </tr>
                  <tr>
                    {classMatrix.subjects.map((s) => (
                      <Fragment key={`${s.subject_id}-sub`}>
                        <th className="px-2 py-1 text-right text-[11px]">MOY</th>
                        <th className="px-2 py-1 text-right text-[11px]">Rang</th>
                      </Fragment>
                    ))}
                    <th className="px-2 py-1 text-right text-[11px]">MOY</th>
                    <th className="px-2 py-1 text-right text-[11px]">Rang</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {classMatrix.students.map((st) => {
                    const perSubj = classMatrix.averages[st.student_id] || {};
                    const gen = classMatrix.generalAverages[st.student_id];
                    const rGen = classMatrix.ranks.general[st.student_id] ?? null;
                    return (
                      <tr key={st.student_id} className="hover:bg-slate-50/60">
                        <td className="px-2 py-2 text-slate-800">
                          <div className="flex flex-col">
                            <span className="font-semibold">{st.full_name}</span>
                            <span className="text-[11px] text-slate-500">
                              {st.matricule || "—"}
                            </span>
                          </div>
                        </td>
                        {classMatrix.subjects.map((s) => {
                          const cell = perSubj[s.subject_id];
                          const avg = cell?.avg_20 ?? null;
                          const rMap = classMatrix.ranks.bySubject[s.subject_id] || {};
                          const r = rMap[st.student_id] ?? null;
                          return (
                            <Fragment key={`${st.student_id}-${s.subject_id}`}>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {avg == null ? "—" : nf.format(avg)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {formatRank(r)}
                              </td>
                            </Fragment>
                          );
                        })}
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">
                          {gen == null ? "—" : nf.format(gen)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">
                          {formatRank(rGen)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* ───────── Section 2 : Analyse par matière (mono-discipline) ───────── */}
      <Card
        title="Analyse par matière"
        subtitle="On choisit une discipline d'abord, puis éventuellement un niveau et une classe pour voir les moyennes et rangs des élèves."
        icon={<BookOpen className="h-4 w-4 text-emerald-600" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GhostButton
              type="button"
              onClick={exportSubjectAggregatedCsv}
              disabled={!subjectView}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exporter CSV (classes)
            </GhostButton>
            <GhostButton
              type="button"
              onClick={exportSubjectAggregatedPdf}
              disabled={!subjectView}
            >
              <Target className="h-4 w-4" />
              Exporter PDF (classes)
            </GhostButton>
          </div>
        }
      >
        {!byClassSubject.length ? (
          <p className="text-xs text-slate-500">
            Lancez d&apos;abord un calcul de statistiques globales avec le bouton
            &laquo; Actualiser les statistiques &raquo; ci-dessus. Cette section utilise les
            données agrégées par classe × matière.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-6 mb-3">
              <div className="md:col-span-3">
                <div className="mb-1 text-xs text-slate-500">Matière (obligatoire)</div>
                <Select
                  value={selectedSubjectId}
                  onChange={(e) => {
                    setSelectedSubjectId(e.target.value);
                    setSubjectLevelFilter("");
                    setSubjectClassId("");
                    setSubjectClassMatrix(null);
                    setSubjectClassError(null);
                  }}
                >
                  <option value="">— Choisir une matière —</option>
                  {subjectOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="md:col-span-2">
                <div className="mb-1 text-xs text-slate-500">Niveau (optionnel)</div>
                <Select
                  value={subjectLevelFilter}
                  onChange={(e) => {
                    setSubjectLevelFilter(e.target.value);
                    setSubjectClassId("");
                    setSubjectClassMatrix(null);
                    setSubjectClassError(null);
                  }}
                  disabled={!selectedSubjectId}
                >
                  <option value="">— Tous les niveaux —</option>
                  {levels.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="md:col-span-1">
                <div className="mb-1 text-xs text-slate-500">
                  Classe (pour détail élèves)
                </div>
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
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={loadSubjectClassMatrix}
                disabled={
                  subjectClassLoading || !selectedSubjectId || !subjectClassId
                }
              >
                {subjectClassLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <NotebookPen className="h-4 w-4" />
                )}
                Calculer la matrice (matière)
              </Button>
              {subjectClassError && (
                <span className="text-xs text-red-600">{subjectClassError}</span>
              )}
            </div>

            {!selectedSubjectId ? (
              <p className="text-xs text-slate-500">
                Sélectionnez d&apos;abord une matière pour voir les statistiques globales, puis
                éventuellement une classe pour afficher la matrice des élèves (MOY + Rang).
              </p>
            ) : !subjectView ? (
              <p className="text-xs text-slate-500">
                Aucune classe n&apos;a de notes pour cette matière avec les filtres choisis.
              </p>
            ) : (
              <>
                {/* Stats globales matière (par classe) */}
                <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-4 text-xs">
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                    <div className="text-[11px] text-slate-500">Moyenne globale (classes)</div>
                    <div className="text-sm font-semibold text-slate-900">
                      {subjectView.global.avg_20 == null
                        ? "—"
                        : `${nf.format(subjectView.global.avg_20)} /20`}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] text-slate-500">
                      Min / Max des moyennes de classe
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      {subjectView.global.min_20 == null
                        ? "—"
                        : nf.format(subjectView.global.min_20)}{" "}
                      /{" "}
                      {subjectView.global.max_20 == null
                        ? "—"
                        : nf.format(subjectView.global.max_20)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] text-slate-500">Volume (toutes classes)</div>
                    <div className="text-sm font-semibold text-slate-900">
                      {subjectView.global.evals_count.toLocaleString("fr-FR")} évals ·{" "}
                      {subjectView.global.notes_count.toLocaleString("fr-FR")} notes
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] text-slate-500 mb-1">
                      Répartition des classes (selon la moyenne)
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-700">
                      <span>&lt; 5 : {subjectView.global.dist_classes.lt5}</span>
                      <span>
                        [5 ; 10[ : {subjectView.global.dist_classes.between5_10}
                      </span>
                      <span>
                        [10 ; 12[ : {subjectView.global.dist_classes.between10_12}
                      </span>
                      <span>
                        [12 ; 15[ : {subjectView.global.dist_classes.between12_15}
                      </span>
                      <span>≥ 15 : {subjectView.global.dist_classes.gte15}</span>
                    </div>
                  </div>
                </div>

                {/* Détail par classe (agrégé) */}
                <div className="overflow-x-auto rounded-xl border mb-5">
                  <table className="min-w-full text-xs sm:text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-2 py-2 text-left">Classe</th>
                        <th className="px-2 py-2 text-left">Niveau</th>
                        <th className="px-2 py-2 text-right">Évals</th>
                        <th className="px-2 py-2 text-right">Notes</th>
                        <th className="px-2 py-2 text-right">Moyenne /20</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {subjectView.rows.map((r) => (
                        <tr
                          key={`${r.class_id}-${r.subject_id}`}
                          className="hover:bg-slate-50/60"
                        >
                          <td className="px-2 py-2 text-slate-800">
                            {r.class_label}
                          </td>
                          <td className="px-2 py-2 text-slate-700">{r.level || "—"}</td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {r.evals_count.toLocaleString("fr-FR")}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {r.notes_count.toLocaleString("fr-FR")}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {r.avg_score_20 == null
                              ? "—"
                              : nf.format(r.avg_score_20)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Matrice élèves pour une classe dans cette matière */}
                {subjectClassMatrix ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4 text-xs">
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                        <div className="text-[11px] text-slate-500">
                          Classe / Matière
                        </div>
                        <div className="text-sm font-semibold text-slate-900">
                          {subjectClassMatrix.class_label}{" "}
                          {subjectClassMatrix.level
                            ? `(${subjectClassMatrix.level})`
                            : ""}{" "}
                          — {subjectClassMatrix.subject_name || "Matière"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-[11px] text-slate-500">
                          Moyenne de la classe (élèves)
                        </div>
                        <div className="text-sm font-semibold text-slate-900">
                          {subjectClassMatrix.global.class_avg_20 == null
                            ? "—"
                            : `${nf.format(subjectClassMatrix.global.class_avg_20)} /20`}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-[11px] text-slate-500">
                          Min / Max des moyennes (élèves)
                        </div>
                        <div className="text-sm font-semibold text-slate-900">
                          {subjectClassMatrix.global.class_min_20 == null
                            ? "—"
                            : nf.format(subjectClassMatrix.global.class_min_20)}{" "}
                          /{" "}
                          {subjectClassMatrix.global.class_max_20 == null
                            ? "—"
                            : nf.format(subjectClassMatrix.global.class_max_20)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-[11px] text-slate-500">
                          Volume pour cette classe
                        </div>
                        <div className="text-sm font-semibold text-slate-900">
                          {subjectClassMatrix.global.evals_count.toLocaleString("fr-FR")}{" "}
                          évals ·{" "}
                          {subjectClassMatrix.global.notes_count.toLocaleString("fr-FR")}{" "}
                          notes
                        </div>
                      </div>
                    </div>

                    {/* Répartition des moyennes (élèves) */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <div className="mb-1 text-[11px] font-semibold text-slate-700">
                        Répartition des moyennes des élèves (matrice mono-discipline)
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-[320px] text-[11px]">
                          <thead>
                            <tr className="bg-slate-100 text-slate-600">
                              <th className="px-2 py-1 text-left">Tranche</th>
                              <th className="px-2 py-1 text-right">Nombre d&apos;élèves</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="px-2 py-1 text-slate-700">&lt; 5</td>
                              <td className="px-2 py-1 text-right text-slate-700">
                                {subjectClassMatrix.global.dist.lt5}
                              </td>
                            </tr>
                            <tr>
                              <td className="px-2 py-1 text-slate-700">[5 ; 10[</td>
                              <td className="px-2 py-1 text-right text-slate-700">
                                {subjectClassMatrix.global.dist.between5_10}
                              </td>
                            </tr>
                            <tr>
                              <td className="px-2 py-1 text-slate-700">[10 ; 12[</td>
                              <td className="px-2 py-1 text-right text-slate-700">
                                {subjectClassMatrix.global.dist.between10_12}
                              </td>
                            </tr>
                            <tr>
                              <td className="px-2 py-1 text-slate-700">[12 ; 15[</td>
                              <td className="px-2 py-1 text-right text-slate-700">
                                {subjectClassMatrix.global.dist.between12_15}
                              </td>
                            </tr>
                            <tr>
                              <td className="px-2 py-1 text-slate-700">≥ 15</td>
                              <td className="px-2 py-1 text-right text-slate-700">
                                {subjectClassMatrix.global.dist.gte15}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Exports élèves matière */}
                    <div className="flex flex-wrap items-center gap-2">
                      <GhostButton
                        type="button"
                        onClick={exportSubjectClassCsv}
                      >
                        <FileSpreadsheet className="h-4 w-4" />
                        Exporter CSV (classe / matière)
                      </GhostButton>
                      <GhostButton
                        type="button"
                        onClick={exportSubjectClassPdf}
                      >
                        <Target className="h-4 w-4" />
                        Exporter PDF (classe / matière)
                      </GhostButton>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Pour voir le détail des élèves, choisissez une classe puis lancez le calcul
                    de la matrice (matière).
                  </p>
                )}
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
