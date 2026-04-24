// src/app/admin/notes/stats/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  FileSpreadsheet,
  Filter,
  NotebookPen,
  RefreshCw,
  School,
  Target,
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
        "inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm",
        p.disabled ? "cursor-not-allowed opacity-60" : "transition hover:bg-emerald-700",
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
        "inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm",
        p.disabled ? "cursor-not-allowed opacity-50" : "transition hover:bg-slate-50",
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-bold text-slate-950">
            {icon}
            <span>{title}</span>
          </div>
          {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/* ───────── Types ───────── */

type ClassItem = {
  id: string;
  label: string;
  level: string | null;
  academic_year?: string | null;
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

type MatrixStudent = {
  student_id: string;
  full_name: string;
  matricule: string | null;
};

type BulletinSubject = {
  subject_id: string;
  subject_name: string;
  coeff_bulletin: number;
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
  general_avg: number | null;
  annual_avg?: number | null;
  annual_rank?: number | null;
};

type BulletinResponse = {
  ok: boolean;
  class?: {
    id: string;
    label?: string | null;
    code?: string | null;
    level?: string | null;
    academic_year?: string | null;
  };
  period?: {
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
  };
  subjects?: BulletinSubject[];
  items?: BulletinItem[];
};

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
    dist: Distribution;
    subjectStats: SubjectMatrixStat[];
  };
  ranks: {
    general: Record<string, number | null>;
    bySubject: Record<string, Record<string, number | null>>;
  };
};

type SubjectView = {
  subject_id: string;
  subject_name: string;
  global: {
    avg_20: number | null;
    min_20: number | null;
    max_20: number | null;
    evals_count: number;
    notes_count: number;
    dist_classes: Distribution;
  };
  rows: ClassSubjectStat[];
};

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
    dist: Distribution;
    evals_count: number;
    notes_count: number;
  };
};

type Distribution = {
  lt5: number;
  between5_10: number;
  between10_12: number;
  between12_15: number;
  gte15: number;
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

function cleanNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return cleanNumber(values.reduce((a, b) => a + b, 0) / values.length);
}

function computeRanks(values: Record<string, number | null | undefined>): Record<string, number> {
  const entries: { id: string; value: number }[] = [];
  for (const [id, value] of Object.entries(values)) {
    if (typeof value === "number" && Number.isFinite(value)) entries.push({ id, value });
  }

  entries.sort((a, b) => b.value - a.value);

  const ranks: Record<string, number> = {};
  let currentRank = 0;
  let lastValue: number | null = null;

  entries.forEach((row, idx) => {
    if (lastValue === null || row.value !== lastValue) {
      currentRank = idx + 1;
      lastValue = row.value;
    }
    ranks[row.id] = currentRank;
  });

  return ranks;
}

function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function formatRank(r: number | null | undefined): string {
  if (!r) return "—";
  if (r === 1) return "1er";
  return `${r}e`;
}

function emptyDist(): Distribution {
  return { lt5: 0, between5_10: 0, between10_12: 0, between12_15: 0, gte15: 0 };
}

function addToDist(dist: Distribution, value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
  const v = Number(value);
  if (v < 5) dist.lt5 += 1;
  else if (v < 10) dist.between5_10 += 1;
  else if (v < 12) dist.between10_12 += 1;
  else if (v < 15) dist.between12_15 += 1;
  else dist.gte15 += 1;
}

function csvCell(value: unknown): string {
  const v = value === null || value === undefined ? "" : String(value);
  return `"${v.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printHtml(html: string, onError: (message: string) => void) {
  const win = window.open("", "_blank");
  if (!win) {
    onError("Impossible d’ouvrir la fenêtre d’impression. Vérifiez le blocage des popups.");
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
  }, 350);
}

function safeFilename(value: string) {
  return String(value || "document")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function classLabel(c: ClassItem | null | undefined) {
  return c?.label || "Classe";
}

function getSubjectCell(item: BulletinItem, subjectId: string): PerSubjectAvg | null {
  const sid = String(subjectId || "").trim();
  if (!sid) return null;
  return (item.per_subject || []).find((ps) => String(ps.subject_id) === sid) || null;
}

function subjectHasAtLeastOneAverage(items: BulletinItem[], subjectId: string) {
  return items.some((it) => {
    const cell = getSubjectCell(it, subjectId);
    return typeof cell?.avg20 === "number" && Number.isFinite(cell.avg20);
  });
}

/* ───────── Page principale ───────── */

export default function AdminNotesStatsPage() {
  /* Filtres globaux */
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [status, setStatus] = useState<"published" | "all" | "draft">("published");

  /* Années scolaires + périodes */
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loadingYears, setLoadingYears] = useState(false);
  const [selectedYearCode, setSelectedYearCode] = useState<string>("");

  const [periods, setPeriods] = useState<GradingPeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  /* Classes + stats */
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [byClassSubject, setByClassSubject] = useState<ClassSubjectStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  /* Section 1 : matrice par classe */
  const [matrixLevel, setMatrixLevel] = useState<string>("");
  const [matrixClassId, setMatrixClassId] = useState<string>("");
  const [classMatrix, setClassMatrix] = useState<ClassMatrixComputed | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  /* Section 2 : matrice par discipline */
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [subjectLevelFilter, setSubjectLevelFilter] = useState<string>("");
  const [subjectClassId, setSubjectClassId] = useState<string>("");
  const [subjectClassMatrix, setSubjectClassMatrix] = useState<SubjectClassMatrix | null>(null);
  const [subjectClassLoading, setSubjectClassLoading] = useState(false);
  const [subjectClassError, setSubjectClassError] = useState<string | null>(null);

  /* Charger les classes */
  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const res = await fetch("/api/admin/classes?limit=500", { cache: "no-store" });
        const json = await res.json().catch(() => ({} as any));
        const arr = Array.isArray(json) ? json : Array.isArray(json.items) ? json.items : [];
        const mapped: ClassItem[] = arr.map((c: any) => ({
          id: String(c.id),
          label: String(c.label || c.name || "Classe").trim(),
          level: c.level == null ? null : String(c.level).trim(),
          academic_year: c.academic_year == null ? null : String(c.academic_year),
        }));
        if (!cancelled) setAllClasses(mapped);
      } catch (e) {
        console.error("[admin.notes.stats] load classes error", e);
        if (!cancelled) setAllClasses([]);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadAcademicYears() {
    setLoadingYears(true);
    try {
      const res = await fetch("/api/admin/institution/academic-years", { cache: "no-store" });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Échec du chargement des années scolaires.");

      const mapped: AcademicYear[] = (Array.isArray(json.items) ? json.items : []).map((y: any) => ({
        id: String(y.id),
        code: String(y.code),
        label: String(y.label || y.code),
        start_date: y.start_date ? String(y.start_date).slice(0, 10) : "",
        end_date: y.end_date ? String(y.end_date).slice(0, 10) : "",
        is_current: !!y.is_current,
      }));

      setYears(mapped);
      const current = mapped.find((y) => y.is_current) || mapped[mapped.length - 1];
      if (current) setSelectedYearCode((prev) => prev || current.code);
    } catch (e) {
      console.error("[admin.notes.stats] loadAcademicYears error", e);
      setYears([]);
    } finally {
      setLoadingYears(false);
    }
  }

  async function loadPeriods(yearCode: string) {
    if (!yearCode) {
      setPeriods([]);
      setSelectedPeriodId("");
      return;
    }

    setLoadingPeriods(true);
    try {
      const params = new URLSearchParams({ academic_year: yearCode });
      const res = await fetch(`/api/admin/institution/grading-periods?${params.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Échec du chargement des périodes.");

      const mapped: GradingPeriod[] = (Array.isArray(json.items) ? json.items : []).map((p: any, idx: number) => ({
        id: String(p.id),
        code: String(p.code || ""),
        label: String(p.label || ""),
        short_label: String(p.short_label || p.label || p.code || ""),
        start_date: p.start_date ? String(p.start_date).slice(0, 10) : null,
        end_date: p.end_date ? String(p.end_date).slice(0, 10) : null,
        order_index: Number(p.order_index ?? idx + 1),
        is_active: p.is_active !== false,
      }));

      mapped.sort((a, b) => a.order_index - b.order_index);
      setPeriods(mapped);

      const current = mapped.find((p) => p.is_active && p.start_date && p.end_date) || mapped[0];
      if (current) {
        setSelectedPeriodId(current.id);
        setFrom(current.start_date || "");
        setTo(current.end_date || "");
      }
    } catch (e) {
      console.error("[admin.notes.stats] loadPeriods error", e);
      setPeriods([]);
      setSelectedPeriodId("");
    } finally {
      setLoadingPeriods(false);
    }
  }

  useEffect(() => {
    loadAcademicYears();
  }, []);

  useEffect(() => {
    if (selectedYearCode) loadPeriods(selectedYearCode);
    else {
      setPeriods([]);
      setSelectedPeriodId("");
    }
  }, [selectedYearCode]);

  function handlePeriodChange(id: string) {
    setSelectedPeriodId(id);
    const p = periods.find((x) => x.id === id);
    if (p) {
      setFrom(p.start_date || "");
      setTo(p.end_date || "");
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
    if (currentYear) parts.push(`Année scolaire : ${currentYear.label}`);
    if (currentPeriod) {
      const label = currentPeriod.short_label || currentPeriod.label || currentPeriod.code;
      const dates =
        currentPeriod.start_date && currentPeriod.end_date
          ? ` (${df.format(new Date(currentPeriod.start_date))} – ${df.format(new Date(currentPeriod.end_date))})`
          : "";
      parts.push(`Période : ${label}${dates}`);
    } else if (from || to) {
      parts.push(`Période : ${from || "—"} → ${to || "—"}`);
    }
    return parts.length ? parts.join(" — ") : "Source bulletin officiel";
  }, [currentYear, currentPeriod, from, to]);

  const currentYearLabelSafe = currentYear?.label ?? selectedYearCode;
  const currentPeriodLabelSafe = currentPeriod?.short_label || currentPeriod?.label || currentPeriod?.code || "Période";
  const currentPeriodStart = currentPeriod?.start_date || from || null;
  const currentPeriodEnd = currentPeriod?.end_date || to || null;

  const levels = useMemo(() => {
    const s = new Set<string>();
    for (const c of allClasses) if (c.level) s.add(c.level);
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }, [allClasses]);

  const classesForLevel = useMemo(() => {
    if (!matrixLevel) return [];
    return allClasses
      .filter((c) => c.level === matrixLevel)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
  }, [allClasses, matrixLevel]);

  const bulletinEligibleClasses = useMemo(() => {
    const selectedYear = selectedYearCode.trim();
    return allClasses.filter((c) => !selectedYear || !c.academic_year || c.academic_year === selectedYear);
  }, [allClasses, selectedYearCode]);

  async function fetchBulletinForClass(classId: string): Promise<BulletinResponse> {
    if (!from || !to) throw new Error("Veuillez choisir une période avec date de début et date de fin.");

    const params = new URLSearchParams();
    params.set("class_id", classId);
    params.set("from", from);
    params.set("to", to);

    const res = await fetch(`/api/admin/grades/bulletin?${params.toString()}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || `BULLETIN_HTTP_${res.status}`);
    }
    return json as BulletinResponse;
  }

  function buildClassMatrixFromBulletin(
    bulletin: BulletinResponse,
    fallbackClass: ClassItem | null,
    classId: string
  ): ClassMatrixComputed {
    const items = Array.isArray(bulletin.items) ? bulletin.items : [];
    const subjectsRaw = Array.isArray(bulletin.subjects) ? bulletin.subjects : [];

    const subjects = subjectsRaw
      .filter((s) => s?.subject_id && subjectHasAtLeastOneAverage(items, s.subject_id))
      .map((s) => ({ subject_id: String(s.subject_id), subject_name: String(s.subject_name || "Matière") }))
      .sort((a, b) => a.subject_name.localeCompare(b.subject_name, undefined, { numeric: true, sensitivity: "base" }));

    const students: MatrixStudent[] = items
      .map((it) => ({
        student_id: String(it.student_id),
        full_name: String(it.full_name || "Élève"),
        matricule: it.matricule ?? null,
      }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, undefined, { numeric: true, sensitivity: "base" }));

    const averages: ClassMatrixComputed["averages"] = {};
    const generalAverages: Record<string, number | null> = {};

    for (const item of items) {
      const sid = String(item.student_id);
      averages[sid] = {};
      generalAverages[sid] = cleanNumber(item.general_avg);

      for (const subject of subjects) {
        const cell = getSubjectCell(item, subject.subject_id);
        const v = cleanNumber(cell?.avg20);
        averages[sid][subject.subject_id] = {
          avg_20: v,
          nb_evals: v === null ? 0 : 1,
          nb_notes: v === null ? 0 : 1,
        };
      }
    }

    const validGeneral = Object.values(generalAverages).filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v)
    );

    const dist = emptyDist();
    validGeneral.forEach((v) => addToDist(dist, v));

    const generalRanksRaw = computeRanks(generalAverages);
    const generalRanks: Record<string, number | null> = {};
    students.forEach((st) => {
      generalRanks[st.student_id] = generalRanksRaw[st.student_id] ?? null;
    });

    const bySubject: Record<string, Record<string, number | null>> = {};
    const subjectStats: SubjectMatrixStat[] = [];

    for (const subject of subjects) {
      const valuesByStudent: Record<string, number | null> = {};
      const values: number[] = [];

      for (const item of items) {
        const v = cleanNumber(getSubjectCell(item, subject.subject_id)?.avg20);
        valuesByStudent[String(item.student_id)] = v;
        if (v !== null) values.push(v);
      }

      const ranksRaw = computeRanks(valuesByStudent);
      bySubject[subject.subject_id] = {};
      students.forEach((st) => {
        bySubject[subject.subject_id][st.student_id] = ranksRaw[st.student_id] ?? null;
      });

      subjectStats.push({
        subject_id: subject.subject_id,
        subject_name: subject.subject_name,
        evals_count: values.length ? 1 : 0,
        notes_count: values.length,
        avg_20_class: avg(values),
      });
    }

    return {
      class_id: bulletin.class?.id || classId,
      class_label: bulletin.class?.label || fallbackClass?.label || "Classe",
      level: bulletin.class?.level || fallbackClass?.level || null,
      students,
      subjects,
      averages,
      generalAverages,
      global: {
        class_avg_20: avg(validGeneral),
        class_min_20: validGeneral.length ? Math.min(...validGeneral) : null,
        class_max_20: validGeneral.length ? Math.max(...validGeneral) : null,
        dist,
        subjectStats,
      },
      ranks: {
        general: generalRanks,
        bySubject,
      },
    };
  }

  async function refreshStats() {
    setStatsLoading(true);
    setStatsError(null);
    setByClassSubject([]);
    setClassMatrix(null);
    setSubjectClassMatrix(null);

    try {
      if (!from || !to) {
        setStatsError("Veuillez sélectionner une période complète avant d'actualiser les statistiques.");
        return;
      }
      if (status === "draft") {
        setStatsError(
          "La matrice officielle s'appuie sur le bulletin : les brouillons ne sont pas intégrés aux moyennes officielles. Choisissez “Publiées / bulletin officiel”."
        );
        return;
      }

      const rows: ClassSubjectStat[] = [];

      for (const cls of bulletinEligibleClasses) {
        try {
          const bulletin = await fetchBulletinForClass(cls.id);
          const matrix = buildClassMatrixFromBulletin(bulletin, cls, cls.id);

          for (const stat of matrix.global.subjectStats) {
            if (!stat.subject_id || !stat.notes_count) continue;
            rows.push({
              class_id: matrix.class_id,
              class_label: matrix.class_label,
              level: matrix.level,
              subject_id: stat.subject_id,
              subject_name: stat.subject_name,
              evals_count: stat.evals_count,
              notes_count: stat.notes_count,
              avg_score_20: stat.avg_20_class,
            });
          }
        } catch (e) {
          console.warn("[admin.notes.stats] bulletin ignored for class", cls.id, e);
        }
      }

      rows.sort((a, b) => {
        const byClass = a.class_label.localeCompare(b.class_label, undefined, { numeric: true, sensitivity: "base" });
        if (byClass !== 0) return byClass;
        return String(a.subject_name || "").localeCompare(String(b.subject_name || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

      setByClassSubject(rows);

      if (!rows.length) {
        setStatsError(
          "Aucune moyenne officielle n'a été trouvée via le bulletin pour cette période. Vérifiez la classe, les notes publiées et la période."
        );
      }
    } catch (e: any) {
      console.error("[admin.notes.stats] refreshStats error", e);
      setStatsError(e?.message || "Erreur de chargement des statistiques officielles.");
    } finally {
      setStatsLoading(false);
    }
  }

  const subjectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of byClassSubject) {
      if (!row.subject_id) continue;
      if (!map.has(row.subject_id)) map.set(row.subject_id, row.subject_name || "Matière");
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }, [byClassSubject]);

  const subjectView: SubjectView | null = useMemo(() => {
    if (!selectedSubjectId) return null;

    const rows = byClassSubject.filter(
      (cs) => cs.subject_id === selectedSubjectId && (!subjectLevelFilter || cs.level === subjectLevelFilter)
    );
    if (!rows.length) return null;

    const values = rows
      .map((r) => cleanNumber(r.avg_score_20))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const dist = emptyDist();
    values.forEach((v) => addToDist(dist, v));

    return {
      subject_id: selectedSubjectId,
      subject_name: rows[0]?.subject_name || "Matière",
      global: {
        avg_20: avg(values),
        min_20: values.length ? Math.min(...values) : null,
        max_20: values.length ? Math.max(...values) : null,
        evals_count: rows.reduce((s, r) => s + Number(r.evals_count || 0), 0),
        notes_count: rows.reduce((s, r) => s + Number(r.notes_count || 0), 0),
        dist_classes: dist,
      },
      rows: [...rows].sort((a, b) =>
        a.class_label.localeCompare(b.class_label, undefined, { numeric: true, sensitivity: "base" })
      ),
    };
  }, [byClassSubject, selectedSubjectId, subjectLevelFilter]);

  const subjectClassOptions = useMemo(() => {
    if (!subjectView) return [];
    return subjectView.rows.map((r) => ({ id: r.class_id, label: r.class_label, level: r.level }));
  }, [subjectView]);

  async function computeClassMatrixForClass(classId: string): Promise<ClassMatrixComputed> {
    const cls = allClasses.find((c) => c.id === classId) || null;
    const bulletin = await fetchBulletinForClass(classId);
    return buildClassMatrixFromBulletin(bulletin, cls, classId);
  }

  async function loadClassMatrix() {
    if (!matrixClassId) {
      setMatrixError("Choisissez d'abord une classe.");
      return;
    }

    setMatrixLoading(true);
    setMatrixError(null);
    setClassMatrix(null);

    try {
      const matrix = await computeClassMatrixForClass(matrixClassId);
      setClassMatrix(matrix);
      if (!matrix.students.length) {
        setMatrixError("Aucun élève n'a été trouvé dans le bulletin officiel pour cette classe et cette période.");
      }
    } catch (e: any) {
      console.error("[admin.notes.stats] loadClassMatrix error", e);
      setMatrixError(e?.message || "Erreur lors du calcul de la matrice officielle.");
    } finally {
      setMatrixLoading(false);
    }
  }

  async function computeSubjectClassMatrix(classId: string, subjectId: string): Promise<SubjectClassMatrix | null> {
    const cls = allClasses.find((c) => c.id === classId) || null;
    const bulletin = await fetchBulletinForClass(classId);
    const matrix = buildClassMatrixFromBulletin(bulletin, cls, classId);
    const subject = matrix.subjects.find((s) => s.subject_id === subjectId) || null;
    if (!subject) return null;

    const items = Array.isArray(bulletin.items) ? bulletin.items : [];
    const students = matrix.students;
    const values: number[] = [];
    const dist = emptyDist();
    const rankValues: Record<string, number | null> = {};
    const averages: SubjectClassMatrix["averages"] = {};
    const teacherSet = new Set<string>();

    for (const item of items) {
      const sid = String(item.student_id);
      const cell = getSubjectCell(item, subjectId);
      const value = cleanNumber(cell?.avg20);
      if (cell?.teacher_name) teacherSet.add(cell.teacher_name);
      rankValues[sid] = value;
      if (value !== null) {
        values.push(value);
        addToDist(dist, value);
      }
    }

    const ranks = computeRanks(rankValues);
    for (const st of students) {
      const item = items.find((it) => String(it.student_id) === st.student_id) || null;
      const value = item ? cleanNumber(getSubjectCell(item, subjectId)?.avg20) : null;
      averages[st.student_id] = {
        avg_20: value,
        nb_evals: value === null ? 0 : 1,
        nb_notes: value === null ? 0 : 1,
        rank: ranks[st.student_id] ?? null,
      };
    }

    return {
      class_id: matrix.class_id,
      class_label: matrix.class_label,
      level: matrix.level,
      subject_id: subject.subject_id,
      subject_name: subject.subject_name,
      teacher_names: Array.from(teacherSet).sort().join(", ") || null,
      students,
      averages,
      global: {
        class_avg_20: avg(values),
        class_min_20: values.length ? Math.min(...values) : null,
        class_max_20: values.length ? Math.max(...values) : null,
        dist,
        evals_count: values.length ? 1 : 0,
        notes_count: values.length,
      },
    };
  }

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
      const matrix = await computeSubjectClassMatrix(subjectClassId, selectedSubjectId);
      setSubjectClassMatrix(matrix);
      if (!matrix) setSubjectClassError("Cette matière n'a pas de moyenne officielle dans cette classe sur la période.");
    } catch (e: any) {
      console.error("[admin.notes.stats] loadSubjectClassMatrix error", e);
      setSubjectClassError(e?.message || "Erreur lors du calcul de la matrice matière.");
    } finally {
      setSubjectClassLoading(false);
    }
  }

  function classMatrixCsv(matrix: ClassMatrixComputed): string {
    const rows: string[] = [];
    rows.push(`Source;Bulletin officiel`);
    rows.push(`Année scolaire;${csvCell(currentYearLabelSafe)}`);
    rows.push(`Période;${csvCell(currentPeriodLabelSafe)};${csvCell(currentPeriodStart || "")};${csvCell(currentPeriodEnd || "")}`);
    rows.push(`Classe;${csvCell(matrix.class_label)};Niveau;${csvCell(matrix.level || "")}`);
    rows.push("");

    const header = ["N°", "Matricule", "Nom et prénoms"];
    for (const subject of matrix.subjects) {
      header.push(`${subject.subject_name} Moy.`, `${subject.subject_name} Rang`);
    }
    header.push("Moyenne générale", "Rang général");
    rows.push(header.map(csvCell).join(";"));

    matrix.students.forEach((st, idx) => {
      const line: Array<string | number | null> = [idx + 1, st.matricule || "", st.full_name];
      for (const subject of matrix.subjects) {
        line.push(
          matrix.averages[st.student_id]?.[subject.subject_id]?.avg_20 ?? "",
          matrix.ranks.bySubject[subject.subject_id]?.[st.student_id] ?? ""
        );
      }
      line.push(matrix.generalAverages[st.student_id] ?? "", matrix.ranks.general[st.student_id] ?? "");
      rows.push(line.map(csvCell).join(";"));
    });

    return "\ufeff" + rows.join("\r\n");
  }

  function exportClassMatrixCsv() {
    if (!classMatrix) {
      setMatrixError("Aucune matrice calculée. Cliquez d'abord sur « Calculer la matrice ».");
      return;
    }
    const filename = `matrice_bulletin_${safeFilename(classMatrix.class_label)}_${safeFilename(currentPeriodLabelSafe)}.csv`;
    downloadTextFile(filename, classMatrixCsv(classMatrix));
  }

  function matrixHtml(matrix: ClassMatrixComputed, title: string) {
    const subjectsHeader = matrix.subjects.map((s) => `<th colspan="2">${escapeHtml(s.subject_name)}</th>`).join("");
    const subjectsSubHeader = matrix.subjects.map(() => `<th>MOY</th><th>Rang</th>`).join("");
    const body = matrix.students
      .map((st, idx) => {
        const subjectCells = matrix.subjects
          .map((s) => {
            const cell = matrix.averages[st.student_id]?.[s.subject_id];
            const rank = matrix.ranks.bySubject[s.subject_id]?.[st.student_id] ?? null;
            return `<td class="num">${formatNumber(cell?.avg_20, 2)}</td><td class="num">${formatRank(rank)}</td>`;
          })
          .join("");
        return `<tr>
          <td class="num">${idx + 1}</td>
          <td>${escapeHtml(st.matricule || "")}</td>
          <td>${escapeHtml(st.full_name)}</td>
          ${subjectCells}
          <td class="num strong">${formatNumber(matrix.generalAverages[st.student_id], 2)}</td>
          <td class="num strong">${formatRank(matrix.ranks.general[st.student_id])}</td>
        </tr>`;
      })
      .join("");

    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 9mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; margin: 0; color: #0f172a; }
  h1 { margin: 0; font-size: 17px; text-transform: uppercase; }
  .sub { margin-top: 4px; font-size: 11px; color: #475569; }
  .meta { margin: 10px 0; display: flex; flex-wrap: wrap; gap: 10px; font-size: 10px; color: #334155; }
  table { width: 100%; border-collapse: collapse; font-size: 8.8px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 5px; vertical-align: middle; }
  th { background: #e2e8f0; text-align: center; font-weight: 800; }
  td.num { text-align: right; white-space: nowrap; }
  td.strong { background: #ecfdf5; font-weight: 800; }
  tr:nth-child(even) td { background: #f8fafc; }
  .footer { margin-top: 8px; text-align: right; font-size: 9px; color: #64748b; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="sub">${escapeHtml(periodLabel)} — Source : bulletin officiel</div>
  <div class="meta">
    <div><strong>Classe :</strong> ${escapeHtml(matrix.class_label)}</div>
    <div><strong>Niveau :</strong> ${escapeHtml(matrix.level || "—")}</div>
    <div><strong>Élèves :</strong> ${matrix.students.length}</div>
    <div><strong>Moy. classe :</strong> ${formatNumber(matrix.global.class_avg_20, 2)}</div>
    <div><strong>Plus forte :</strong> ${formatNumber(matrix.global.class_max_20, 2)}</div>
    <div><strong>Plus faible :</strong> ${formatNumber(matrix.global.class_min_20, 2)}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th rowspan="2">N°</th>
        <th rowspan="2">Matricule</th>
        <th rowspan="2">Nom et prénoms</th>
        ${subjectsHeader}
        <th colspan="2">Moyenne générale</th>
      </tr>
      <tr>${subjectsSubHeader}<th>MOY</th><th>Rang</th></tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
  <div class="footer">Document généré depuis Mon Cahier — Nexa Digital SARL</div>
</body>
</html>`;
  }

  function exportClassMatrixPdf() {
    if (!classMatrix) {
      setMatrixError("Aucune matrice calculée. Cliquez d'abord sur « Calculer la matrice ».");
      return;
    }
    printHtml(matrixHtml(classMatrix, `Matrice officielle des moyennes — ${classMatrix.class_label}`), setMatrixError);
  }

  async function exportLevelMatricesCsv() {
    if (!matrixLevel) {
      setMatrixError("Choisissez d'abord un niveau.");
      return;
    }

    setMatrixLoading(true);
    setMatrixError(null);
    try {
      const matrices: ClassMatrixComputed[] = [];
      for (const cls of classesForLevel) {
        try {
          matrices.push(await computeClassMatrixForClass(cls.id));
        } catch (e) {
          console.warn("[admin.notes.stats] export level class ignored", cls.id, e);
        }
      }

      if (!matrices.length) {
        setMatrixError("Aucune matrice officielle exportable pour ce niveau.");
        return;
      }

      const chunks = matrices.map((m) => classMatrixCsv(m).replace(/^\ufeff/, ""));
      downloadTextFile(
        `matrices_bulletin_niveau_${safeFilename(matrixLevel)}_${safeFilename(currentPeriodLabelSafe)}.csv`,
        "\ufeff" + chunks.join("\r\n\r\n")
      );
    } finally {
      setMatrixLoading(false);
    }
  }

  async function exportLevelMatricesPdf() {
    if (!matrixLevel) {
      setMatrixError("Choisissez d'abord un niveau.");
      return;
    }

    setMatrixLoading(true);
    setMatrixError(null);
    try {
      const matrices: ClassMatrixComputed[] = [];
      for (const cls of classesForLevel) {
        try {
          matrices.push(await computeClassMatrixForClass(cls.id));
        } catch (e) {
          console.warn("[admin.notes.stats] export level PDF class ignored", cls.id, e);
        }
      }

      if (!matrices.length) {
        setMatrixError("Aucune matrice officielle exportable pour ce niveau.");
        return;
      }

      const pages = matrices
        .map((m, idx) => {
          const html = matrixHtml(m, `Matrice officielle des moyennes — ${m.class_label}`);
          const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1] || "";
          return `<section class="page ${idx > 0 ? "break" : ""}">${body}</section>`;
        })
        .join("");

      const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<title>Matrices niveau ${escapeHtml(matrixLevel)}</title>
<style>
@page { size: A4 landscape; margin: 9mm; }
* { box-sizing: border-box; }
body { font-family: Arial, sans-serif; margin: 0; color: #0f172a; }
.break { page-break-before: always; }
h1 { margin: 0; font-size: 17px; text-transform: uppercase; }
.sub { margin-top: 4px; font-size: 11px; color: #475569; }
.meta { margin: 10px 0; display: flex; flex-wrap: wrap; gap: 10px; font-size: 10px; color: #334155; }
table { width: 100%; border-collapse: collapse; font-size: 8.8px; }
th, td { border: 1px solid #cbd5e1; padding: 4px 5px; vertical-align: middle; }
th { background: #e2e8f0; text-align: center; font-weight: 800; }
td.num { text-align: right; white-space: nowrap; }
td.strong { background: #ecfdf5; font-weight: 800; }
tr:nth-child(even) td { background: #f8fafc; }
.footer { margin-top: 8px; text-align: right; font-size: 9px; color: #64748b; }
</style></head><body>${pages}</body></html>`;

      printHtml(html, setMatrixError);
    } finally {
      setMatrixLoading(false);
    }
  }

  function exportSubjectStatsCsv() {
    if (!subjectView) {
      setSubjectClassError("Choisissez une matière et actualisez les statistiques.");
      return;
    }

    const rows = [
      ["Source", "Bulletin officiel"].map(csvCell).join(";"),
      ["Matière", subjectView.subject_name].map(csvCell).join(";"),
      ["Période", currentPeriodLabelSafe, currentPeriodStart || "", currentPeriodEnd || ""].map(csvCell).join(";"),
      "",
      ["Classe", "Niveau", "Moyenne /20", "Moyennes élèves"].map(csvCell).join(";"),
      ...subjectView.rows.map((r) =>
        [r.class_label, r.level || "", r.avg_score_20 ?? "", r.notes_count].map(csvCell).join(";")
      ),
    ];

    downloadTextFile(
      `stat_matiere_bulletin_${safeFilename(subjectView.subject_name)}_${safeFilename(currentPeriodLabelSafe)}.csv`,
      "\ufeff" + rows.join("\r\n")
    );
  }

  function exportSubjectStatsPdf() {
    if (!subjectView) {
      setSubjectClassError("Choisissez une matière et actualisez les statistiques.");
      return;
    }

    const body = subjectView.rows
      .map(
        (r) => `<tr><td>${escapeHtml(r.class_label)}</td><td>${escapeHtml(r.level || "")}</td><td class="num">${formatNumber(
          r.avg_score_20,
          2
        )}</td><td class="num">${r.notes_count}</td></tr>`
      )
      .join("");

    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<title>${escapeHtml(subjectView.subject_name)}</title>
<style>
@page { size: A4 portrait; margin: 12mm; }
body { font-family: Arial, sans-serif; color: #0f172a; }
h1 { font-size: 18px; margin: 0; text-transform: uppercase; }
.sub { margin: 4px 0 12px; color: #475569; font-size: 11px; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th,td { border: 1px solid #cbd5e1; padding: 6px; }
th { background: #e2e8f0; text-align: left; }
.num { text-align: right; }
</style></head><body>
<h1>Statistiques officielles — ${escapeHtml(subjectView.subject_name)}</h1>
<div class="sub">${escapeHtml(periodLabel)} — Source : bulletin officiel</div>
<table><thead><tr><th>Classe</th><th>Niveau</th><th>Moyenne /20</th><th>Moyennes élèves</th></tr></thead><tbody>${body}</tbody></table>
</body></html>`;

    printHtml(html, setSubjectClassError);
  }

  const classStats = classMatrix?.global || null;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 text-slate-950">
      <Card
        title="Filtres des statistiques officielles"
        subtitle="La matrice utilise maintenant les mêmes données que le bulletin officiel."
        icon={<Filter className="h-5 w-5 text-emerald-600" />}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <div className="mb-1 text-xs text-slate-500">Année scolaire</div>
            <Select
              value={selectedYearCode}
              onChange={(e) => {
                setSelectedYearCode(e.target.value);
                setClassMatrix(null);
                setSubjectClassMatrix(null);
              }}
              disabled={loadingYears}
            >
              <option value="">— Année scolaire —</option>
              {years.map((y) => (
                <option key={y.id} value={y.code}>
                  {y.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Période d'évaluation</div>
            <Select
              value={selectedPeriodId}
              onChange={(e) => {
                handlePeriodChange(e.target.value);
                setClassMatrix(null);
                setSubjectClassMatrix(null);
              }}
              disabled={loadingPeriods || !periods.length}
            >
              <option value="">— Période —</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label || p.short_label || p.code}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">État de publication</div>
            <Select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="published">Publiées / bulletin officiel</option>
              <option value="all">Toutes — affichage officiel identique au bulletin</option>
              <option value="draft">Brouillons — non officiel</option>
            </Select>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Du</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Au</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <Button type="button" onClick={refreshStats} disabled={statsLoading || !from || !to}>
              {statsLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
              {statsLoading ? "Actualisation…" : "Actualiser les statistiques"}
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {periodLabel}. Les moyennes, rangs, sous-matières et coefficients viennent de la route bulletin.
        </div>
        {statsError ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{statsError}</div>
        ) : null}
      </Card>

      <Card
        title="Matrice par classe"
        subtitle="Pour une classe : mêmes moyennes et mêmes rangs que le bulletin officiel."
        icon={<School className="h-5 w-5 text-emerald-600" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <GhostButton type="button" onClick={exportClassMatrixCsv} disabled={!classMatrix}>
              <FileSpreadsheet className="h-4 w-4" /> Exporter CSV (classe)
            </GhostButton>
            <GhostButton type="button" onClick={exportClassMatrixPdf} disabled={!classMatrix}>
              <Target className="h-4 w-4" /> Exporter PDF (classe)
            </GhostButton>
            <GhostButton type="button" onClick={exportLevelMatricesCsv} disabled={!matrixLevel || matrixLoading}>
              <FileSpreadsheet className="h-4 w-4" /> Export CSV (niveau)
            </GhostButton>
            <GhostButton type="button" onClick={exportLevelMatricesPdf} disabled={!matrixLevel || matrixLoading}>
              <Target className="h-4 w-4" /> Export PDF (niveau)
            </GhostButton>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
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

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={loadClassMatrix} disabled={matrixLoading || !matrixClassId || !from || !to}>
            {matrixLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <NotebookPen className="h-4 w-4" />}
            {matrixLoading ? "Calcul…" : "Calculer la matrice"}
          </Button>
          <span className="text-xs text-slate-500">Source : /api/admin/grades/bulletin</span>
        </div>

        {matrixError ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{matrixError}</div> : null}

        {classMatrix ? (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="text-xs text-slate-500">Moyenne classe</div>
                <div className="mt-1 text-lg font-bold">{formatNumber(classStats?.class_avg_20, 2)} /20</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Min / Max</div>
                <div className="mt-1 text-lg font-bold">
                  {formatNumber(classStats?.class_min_20, 2)} / {formatNumber(classStats?.class_max_20, 2)}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Élèves classés</div>
                <div className="mt-1 text-lg font-bold">{classMatrix.students.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="text-xs text-slate-500">Répartition</div>
                <div className="mt-1">
                  &lt; 5 : {classStats?.dist.lt5 ?? 0} · [5;10[ : {classStats?.dist.between5_10 ?? 0} · ≥ 15 : {classStats?.dist.gte15 ?? 0}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th rowSpan={2} className="border-b border-r border-slate-200 px-3 py-3 text-left">Élève</th>
                    {classMatrix.subjects.map((s) => (
                      <th key={s.subject_id} colSpan={2} className="border-b border-r border-slate-200 px-3 py-3 text-center">
                        {s.subject_name}
                      </th>
                    ))}
                    <th colSpan={2} className="border-b border-slate-200 bg-emerald-50 px-3 py-3 text-center">Moyenne générale</th>
                  </tr>
                  <tr>
                    {classMatrix.subjects.map((s) => (
                      <>
                        <th key={`${s.subject_id}-moy`} className="border-b border-r border-slate-200 px-3 py-2 text-center text-xs">MOY</th>
                        <th key={`${s.subject_id}-rang`} className="border-b border-r border-slate-200 px-3 py-2 text-center text-xs">Rang</th>
                      </>
                    ))}
                    <th className="border-b border-r border-slate-200 bg-emerald-50 px-3 py-2 text-center text-xs">MOY</th>
                    <th className="border-b border-slate-200 bg-emerald-50 px-3 py-2 text-center text-xs">Rang</th>
                  </tr>
                </thead>
                <tbody>
                  {classMatrix.students.map((st) => (
                    <tr key={st.student_id} className="even:bg-slate-50/60">
                      <td className="border-r border-slate-100 px-3 py-3 font-semibold">
                        {st.full_name}
                        {st.matricule ? <div className="text-xs font-normal text-slate-500">{st.matricule}</div> : null}
                      </td>
                      {classMatrix.subjects.map((s) => {
                        const cell = classMatrix.averages[st.student_id]?.[s.subject_id];
                        const rank = classMatrix.ranks.bySubject[s.subject_id]?.[st.student_id] ?? null;
                        return (
                          <>
                            <td key={`${st.student_id}-${s.subject_id}-m`} className="border-r border-slate-100 px-3 py-3 text-right">
                              {formatNumber(cell?.avg_20, 2)}
                            </td>
                            <td key={`${st.student_id}-${s.subject_id}-r`} className="border-r border-slate-100 px-3 py-3 text-right">
                              {formatRank(rank)}
                            </td>
                          </>
                        );
                      })}
                      <td className="border-r border-slate-100 bg-emerald-50 px-3 py-3 text-right font-bold">
                        {formatNumber(classMatrix.generalAverages[st.student_id], 2)}
                      </td>
                      <td className="bg-emerald-50 px-3 py-3 text-right font-bold">
                        {formatRank(classMatrix.ranks.general[st.student_id])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            Choisissez une classe, puis cliquez sur « Calculer la matrice » pour afficher les moyennes officielles du bulletin.
          </p>
        )}
      </Card>

      <Card
        title="Matrice par discipline"
        subtitle="On choisit une discipline d'abord, puis éventuellement un niveau et une classe."
        icon={<BookOpen className="h-5 w-5 text-emerald-600" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <GhostButton type="button" onClick={exportSubjectStatsCsv} disabled={!subjectView}>
              <FileSpreadsheet className="h-4 w-4" /> Exporter CSV (classes)
            </GhostButton>
            <GhostButton type="button" onClick={exportSubjectStatsPdf} disabled={!subjectView}>
              <Target className="h-4 w-4" /> Exporter PDF (classes)
            </GhostButton>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Matière (obligatoire)</div>
            <Select
              value={selectedSubjectId}
              onChange={(e) => {
                setSelectedSubjectId(e.target.value);
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
          <div>
            <div className="mb-1 text-xs text-slate-500">Classe (détail élèves)</div>
            <Select
              value={subjectClassId}
              onChange={(e) => {
                setSubjectClassId(e.target.value);
                setSubjectClassMatrix(null);
                setSubjectClassError(null);
              }}
              disabled={!subjectView}
            >
              <option value="">— Classe —</option>
              {subjectClassOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={loadSubjectClassMatrix} disabled={subjectClassLoading || !selectedSubjectId || !subjectClassId}>
            {subjectClassLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <NotebookPen className="h-4 w-4" />}
            {subjectClassLoading ? "Calcul…" : "Calculer la matrice (matière)"}
          </Button>
          {!byClassSubject.length ? <span className="text-xs text-slate-500">Cliquez d'abord sur « Actualiser les statistiques ».</span> : null}
        </div>

        {subjectClassError ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{subjectClassError}</div>
        ) : null}

        {subjectView ? (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="text-xs text-slate-500">Moyenne globale (classes)</div>
                <div className="mt-1 text-lg font-bold">{formatNumber(subjectView.global.avg_20, 2)} /20</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Min / Max des moyennes de classe</div>
                <div className="mt-1 text-lg font-bold">
                  {formatNumber(subjectView.global.min_20, 2)} / {formatNumber(subjectView.global.max_20, 2)}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Volume officiel</div>
                <div className="mt-1 text-lg font-bold">{subjectView.global.notes_count} moyenne(s)</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="text-xs text-slate-500">Répartition des classes</div>
                <div className="mt-1">
                  &lt; 5 : {subjectView.global.dist_classes.lt5} · [5;10[ : {subjectView.global.dist_classes.between5_10} · ≥ 15 : {subjectView.global.dist_classes.gte15}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-3 py-3 text-left">Classe</th>
                    <th className="px-3 py-3 text-left">Niveau</th>
                    <th className="px-3 py-3 text-right">Moyennes élèves</th>
                    <th className="px-3 py-3 text-right">Moyenne /20</th>
                  </tr>
                </thead>
                <tbody>
                  {subjectView.rows.map((r) => (
                    <tr key={`${r.class_id}-${r.subject_id}`} className="border-t border-slate-100 even:bg-slate-50/60">
                      <td className="px-3 py-3">{r.class_label}</td>
                      <td className="px-3 py-3">{r.level || "—"}</td>
                      <td className="px-3 py-3 text-right">{r.notes_count}</td>
                      <td className="px-3 py-3 text-right font-semibold">{formatNumber(r.avg_score_20, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Actualisez les statistiques puis choisissez une matière.</p>
        )}

        {subjectClassMatrix ? (
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="font-bold">
                Détail élèves — {subjectClassMatrix.subject_name} · {subjectClassMatrix.class_label}
              </div>
              <div className="text-xs text-slate-500">
                Professeur(s) : {subjectClassMatrix.teacher_names || "—"} · Moyenne classe : {formatNumber(subjectClassMatrix.global.class_avg_20, 2)} /20
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white text-slate-700">
                  <tr>
                    <th className="px-3 py-3 text-left">Élève</th>
                    <th className="px-3 py-3 text-left">Matricule</th>
                    <th className="px-3 py-3 text-right">Moyenne /20</th>
                    <th className="px-3 py-3 text-right">Rang</th>
                  </tr>
                </thead>
                <tbody>
                  {subjectClassMatrix.students.map((st) => {
                    const cell = subjectClassMatrix.averages[st.student_id];
                    return (
                      <tr key={st.student_id} className="border-t border-slate-100 even:bg-slate-50/60">
                        <td className="px-3 py-3 font-semibold">{st.full_name}</td>
                        <td className="px-3 py-3 text-slate-500">{st.matricule || "—"}</td>
                        <td className="px-3 py-3 text-right">{formatNumber(cell?.avg_20, 2)}</td>
                        <td className="px-3 py-3 text-right">{formatRank(cell?.rank)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
