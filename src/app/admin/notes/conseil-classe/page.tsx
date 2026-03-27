"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FileSpreadsheet,
  Filter,
  Printer,
  RefreshCw,
  School,
  ScrollText,
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
        "inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow",
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
        "inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700",
        "transition hover:bg-slate-50",
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
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
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

type InstitutionMeta = {
  institutionName: string;
  logoUrl: string | null;
  contactLine: string | null;
  cityLine: string | null;
  principalName: string | null;
  principalRole: string | null;
};

type SubjectIndicator = {
  subject_id: string;
  subject_name: string;
  teacher_names: string | null;
  effectif: number;
  ge10_count: number;
  ge10_pct: number;
  between85And10_count: number;
  between85And10_pct: number;
  lt85_count: number;
  lt85_pct: number;
  avg_20: number | null;
};

type StudentRow = MatrixStudent & {
  general_avg: number | null;
  general_rank: number | null;
};

type ConseilDocumentData = {
  class_id: string;
  class_label: string;
  level: string | null;
  students: StudentRow[];
  classed_count: number;
  class_avg_20: number | null;
  class_min_20: number | null;
  class_max_20: number | null;
  moy_ge_10_count: number;
  between85And10_count: number;
  lt85_count: number;
  subjectIndicators: SubjectIndicator[];
  majorStudent: StudentRow | null;
  specificSubjects: {
    francais: string;
    anglais: string;
    philo: string;
    allesp: string;
  };
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

function safeLabel(v: string | null | undefined, fallback = "—") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function escapeHtml(v: string | null | undefined) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatScore(v: number | null | undefined) {
  return v == null || Number.isNaN(v) ? "—" : nf.format(v);
}

function percentOf(count: number, total: number) {
  if (!total) return 0;
  return (count / total) * 100;
}

function csvCell(v: string | number | null | undefined) {
  const s = String(v ?? "").replace(/\"/g, '""');
  return `"${s}"`;
}

function pickString(obj: any, keys: string[]) {
  for (const key of keys) {
    const raw = obj?.[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

function findSpecificSubject(indicators: SubjectIndicator[], patterns: string[]) {
  const found = indicators.find((item) => {
    const name = item.subject_name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return patterns.some((p) => name.includes(p));
  });
  return found?.avg_20 ?? null;
}

function buildSpecificSubjects(indicators: SubjectIndicator[]) {
  const francais = findSpecificSubject(indicators, ["francais", "français"]);
  const anglais = findSpecificSubject(indicators, ["anglais", "english"]);
  const philo = findSpecificSubject(indicators, ["philo", "philosophie"]);

  const allemand = findSpecificSubject(indicators, ["allemand"]);
  const espagnol = findSpecificSubject(indicators, ["espagnol"]);
  const allespValues = [allemand, espagnol]
    .filter((v): v is number => v != null)
    .map((v) => nf.format(v));

  return {
    francais: francais == null ? "" : nf.format(francais),
    anglais: anglais == null ? "" : nf.format(anglais),
    philo: philo == null ? "" : nf.format(philo),
    allesp: allespValues.join(" / "),
  };
}

/* ───────── Page principale ───────── */

export default function AdminConseilClassePage() {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [status, setStatus] = useState<"all" | "published" | "draft">("all");

  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loadingYears, setLoadingYears] = useState(false);
  const [selectedYearCode, setSelectedYearCode] = useState<string>("");

  const [periods, setPeriods] = useState<GradingPeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [institutionMeta, setInstitutionMeta] = useState<InstitutionMeta>({
    institutionName: "Établissement",
    logoUrl: null,
    contactLine: null,
    cityLine: null,
    principalName: null,
    principalRole: "Le Directeur",
  });

  const [matrixLevel, setMatrixLevel] = useState<string>("");
  const [matrixClassId, setMatrixClassId] = useState<string>("");
  const [docData, setDocData] = useState<ConseilDocumentData | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingClasses(true);
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
        console.error("[admin.conseil-classe] load classes error", e);
        setAllClasses([]);
      })
      .finally(() => setLoadingClasses(false));
  }, []);

  useEffect(() => {
    async function loadInstitutionSettings() {
      try {
        const r = await fetch("/api/admin/institution/settings", { cache: "no-store" });
        const j = await r.json().catch(() => ({} as any));
        const raw = j?.item || j?.institution || j || {};

        setInstitutionMeta({
          institutionName:
            pickString(raw, [
              "institution_name",
              "school_name",
              "establishment_name",
              "name",
              "label",
            ]) || "Établissement",
          logoUrl: pickString(raw, ["logo_url", "logo", "logoUrl"]),
          contactLine:
            [
              pickString(raw, ["phone", "phone_number", "telephone"]),
              pickString(raw, ["email", "contact_email"]),
            ]
              .filter(Boolean)
              .join(" • ") || null,
          cityLine:
            [
              pickString(raw, ["address", "adresse"]),
              pickString(raw, ["city", "ville"]),
            ]
              .filter(Boolean)
              .join(" • ") || null,
          principalName: pickString(raw, [
            "principal_name",
            "head_name",
            "director_name",
            "responsible_name",
          ]),
          principalRole:
            pickString(raw, ["principal_role", "head_role", "director_role"]) ||
            "Le Directeur",
        });
      } catch (e) {
        console.error("[admin.conseil-classe] institution settings", e);
      }
    }

    loadInstitutionSettings();
  }, []);

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
      console.error("[admin.conseil-classe] loadAcademicYears", e);
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

      const def = mapped.find((p) => p.is_active && p.start_date && p.end_date) || mapped[0];
      if (def) {
        setSelectedPeriodId(def.id);
        if (def.start_date) setFrom(def.start_date);
        if (def.end_date) setTo(def.end_date);
      }
    } catch (e: any) {
      console.error("[admin.conseil-classe] loadPeriods", e);
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
    if (selectedYearCode) {
      loadPeriods(selectedYearCode);
    } else {
      setPeriods([]);
      setSelectedPeriodId("");
    }
  }, [selectedYearCode]);

  function handlePeriodChange(id: string) {
    setSelectedPeriodId(id);
    const p = periods.find((x) => x.id === id);
    if (p) {
      if (p.start_date) setFrom(p.start_date);
      if (p.end_date) setTo(p.end_date);
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

  const currentYearLabelSafe = currentYear?.label ?? "";
  const currentPeriodLabelSafe =
    currentPeriod?.short_label || currentPeriod?.label || currentPeriod?.code || "";

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

    return parts.length ? parts.join(" — ") : "Toutes les évaluations enregistrées";
  }, [currentYear, currentPeriod, from, to]);

  async function computeConseilData(classId: string): Promise<ConseilDocumentData | null> {
    const classInfo = allClasses.find((c) => c.id === classId) || null;

    const subsRes = await fetch(`/api/class/subjects?class_id=${classId}`, {
      cache: "no-store",
    });
    const subsJson = await subsRes.json().catch(() => ({}));
    const rawItems = (subsJson.items || []) as any[];
    const subjectsForClass = rawItems.map((s) => ({
      subject_id: String(s.id),
      subject_name: (s.label || s.name || "").trim() || String(s.id),
    }));

    const studentsMap = new Map<string, MatrixStudent>();
    const averages: Record<string, Record<string, number | null>> = {};
    const subjectIndicators: SubjectIndicator[] = [];

    for (const subj of subjectsForClass) {
      const qs = new URLSearchParams();
      qs.set("class_id", classId);
      qs.set("subject_id", subj.subject_id);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (status === "published") qs.set("published", "true");
      if (status === "draft") qs.set("published", "false");

      const res = await fetch(`/api/admin/notes/matrix?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as MatrixOk | MatrixErr | any;
      if (!res.ok || !json || !json.ok) {
        console.error("[admin.conseil-classe] matrix error", subj.subject_id, json);
        subjectIndicators.push({
          subject_id: subj.subject_id,
          subject_name: subj.subject_name,
          teacher_names: null,
          effectif: 0,
          ge10_count: 0,
          ge10_pct: 0,
          between85And10_count: 0,
          between85And10_pct: 0,
          lt85_count: 0,
          lt85_pct: 0,
          avg_20: null,
        });
        continue;
      }

      const data = json as MatrixOk;
      const evaluations = data.evaluations || [];
      const marks = data.marks || {};
      const students = data.students || [];

      for (const st of students) {
        if (!studentsMap.has(st.student_id)) studentsMap.set(st.student_id, st);
      }

      const teacherNames = Array.from(
        new Set(
          evaluations
            .map((ev) => ev.teacher_name?.trim())
            .filter((v): v is string => !!v)
        )
      ).join(" / ");

      const metaByEval = new Map<string, { scale: number; coeff: number }>();
      for (const ev of evaluations) {
        metaByEval.set(ev.id, { scale: ev.scale, coeff: ev.coeff });
      }

      const subjectStudentAverages: number[] = [];

      for (const st of students) {
        const evalMarks = (marks as any)[st.student_id] || {};
        let weightedSum = 0;
        let weights = 0;

        for (const [evalId, markObj] of Object.entries(evalMarks) as any) {
          const meta = metaByEval.get(evalId);
          if (!meta) continue;
          if (markObj.raw == null) continue;

          const mark20 =
            markObj.mark_20 != null
              ? Number(markObj.mark_20)
              : (Number(markObj.raw) / meta.scale) * 20;

          weightedSum += mark20 * meta.coeff;
          weights += meta.coeff;
        }

        const avg20 = weights > 0 ? weightedSum / weights : null;
        if (!averages[st.student_id]) averages[st.student_id] = {};
        averages[st.student_id][subj.subject_id] = avg20;

        if (avg20 != null) subjectStudentAverages.push(avg20);
      }

      const effectif = subjectStudentAverages.length;
      const ge10_count = subjectStudentAverages.filter((v) => v >= 10).length;
      const between85And10_count = subjectStudentAverages.filter((v) => v >= 8.5 && v < 10).length;
      const lt85_count = subjectStudentAverages.filter((v) => v < 8.5).length;
      const avg_20 = effectif
        ? subjectStudentAverages.reduce((sum, value) => sum + value, 0) / effectif
        : null;

      subjectIndicators.push({
        subject_id: subj.subject_id,
        subject_name: subj.subject_name,
        teacher_names: teacherNames || null,
        effectif,
        ge10_count,
        ge10_pct: percentOf(ge10_count, effectif),
        between85And10_count,
        between85And10_pct: percentOf(between85And10_count, effectif),
        lt85_count,
        lt85_pct: percentOf(lt85_count, effectif),
        avg_20,
      });
    }

    const studentsList = Array.from(studentsMap.values()).sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, {
        sensitivity: "base",
        numeric: true,
      })
    );

    const generalAverages: Record<string, number | null> = {};
    let class_avg_20: number | null = null;
    let class_min_20: number | null = null;
    let class_max_20: number | null = null;

    const classAverageList: number[] = [];

    for (const st of studentsList) {
      const values = Object.values(averages[st.student_id] || {}).filter(
        (v): v is number => v != null
      );
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      generalAverages[st.student_id] = avg;
      if (avg != null) classAverageList.push(avg);
    }

    if (classAverageList.length) {
      class_avg_20 = classAverageList.reduce((a, b) => a + b, 0) / classAverageList.length;
      class_min_20 = Math.min(...classAverageList);
      class_max_20 = Math.max(...classAverageList);
    }

    const rankValues: Record<string, number | null> = {};
    for (const st of studentsList) {
      rankValues[st.student_id] = generalAverages[st.student_id] ?? null;
    }
    const ranks = computeRanks(rankValues);

    const studentRows: StudentRow[] = studentsList
      .map((st) => ({
        ...st,
        general_avg: generalAverages[st.student_id] ?? null,
        general_rank: ranks[st.student_id] ?? null,
      }))
      .sort((a, b) => {
        const av = a.general_avg ?? -Infinity;
        const bv = b.general_avg ?? -Infinity;
        if (bv !== av) return bv - av;
        return a.full_name.localeCompare(b.full_name, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      });

    const classedRows = studentRows.filter((st) => st.general_avg != null);
    const moy_ge_10_count = classedRows.filter((st) => (st.general_avg ?? -1) >= 10).length;
    const between85And10_count = classedRows.filter(
      (st) => (st.general_avg ?? -1) >= 8.5 && (st.general_avg ?? -1) < 10
    ).length;
    const lt85_count = classedRows.filter((st) => (st.general_avg ?? 99) < 8.5).length;

    return {
      class_id: classId,
      class_label: classInfo?.label || "Classe",
      level: classInfo?.level ?? null,
      students: studentRows,
      classed_count: classedRows.length,
      class_avg_20,
      class_min_20,
      class_max_20,
      moy_ge_10_count,
      between85And10_count,
      lt85_count,
      subjectIndicators: subjectIndicators.sort((a, b) =>
        a.subject_name.localeCompare(b.subject_name, undefined, {
          sensitivity: "base",
          numeric: true,
        })
      ),
      majorStudent: studentRows[0] || null,
      specificSubjects: buildSpecificSubjects(subjectIndicators),
    };
  }

  async function loadDocument() {
    if (!matrixClassId) {
      setDocError("Choisissez d'abord une classe.");
      return;
    }
    setLoadingDoc(true);
    setDocError(null);
    setDocData(null);
    try {
      const data = await computeConseilData(matrixClassId);
      setDocData(data);
    } catch (e: any) {
      console.error("[admin.conseil-classe] loadDocument", e);
      setDocError(e?.message || "Erreur lors de la préparation du procès-verbal.");
      setDocData(null);
    } finally {
      setLoadingDoc(false);
    }
  }

  function exportIndicatorsCsv() {
    if (!docData) {
      setDocError("Chargez d'abord le document avant l'export CSV.");
      return;
    }

    const rows: string[] = [];
    rows.push([csvCell("Année scolaire"), csvCell(currentYearLabelSafe)].join(";"));
    rows.push([csvCell("Période"), csvCell(currentPeriodLabelSafe || `${from || ""} → ${to || ""}`)].join(";"));
    rows.push([csvCell("Classe"), csvCell(docData.class_label), csvCell("Niveau"), csvCell(docData.level)].join(";"));
    rows.push("");
    rows.push(
      [
        csvCell("Matière"),
        csvCell("Effectif"),
        csvCell("M >= 10 (N)"),
        csvCell("M >= 10 (%)"),
        csvCell("10 > M >= 8,5 (N)"),
        csvCell("10 > M >= 8,5 (%)"),
        csvCell("M < 8,5 (N)"),
        csvCell("M < 8,5 (%)"),
        csvCell("Moyenne"),
        csvCell("Enseignant / Émargement"),
      ].join(";")
    );

    for (const item of docData.subjectIndicators) {
      rows.push(
        [
          csvCell(item.subject_name),
          csvCell(item.effectif),
          csvCell(item.ge10_count),
          csvCell(`${item.ge10_pct.toFixed(2)}%`),
          csvCell(item.between85And10_count),
          csvCell(`${item.between85And10_pct.toFixed(2)}%`),
          csvCell(item.lt85_count),
          csvCell(`${item.lt85_pct.toFixed(2)}%`),
          csvCell(item.avg_20 == null ? "" : nf.format(item.avg_20)),
          csvCell(item.teacher_names || ""),
        ].join(";")
      );
    }

    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conseil-classe-matieres-${docData.class_label}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function buildConseilHtml(data: ConseilDocumentData) {
    const total = data.students.length;
    const classed = data.classed_count;
    const yearText = escapeHtml(currentYearLabelSafe || "—");
    const periodText = escapeHtml(
      currentPeriodLabelSafe || (from || to ? `${from || ""} → ${to || ""}` : "—")
    );
    const institutionName = escapeHtml(institutionMeta.institutionName);
    const contactLine = escapeHtml(institutionMeta.contactLine || "");
    const cityLine = escapeHtml(institutionMeta.cityLine || "");
    const principalRole = escapeHtml(institutionMeta.principalRole || "Le Directeur");
    const principalName = escapeHtml(institutionMeta.principalName || "");
    const logoBlock = institutionMeta.logoUrl
      ? `<img src="${escapeHtml(institutionMeta.logoUrl)}" alt="Logo établissement" class="logo" />`
      : `<div class="logo placeholder-logo">LOGO</div>`;

    const studentRowsHtml = data.students
      .map(
        (student, index) => `
          <tr>
            <td class="center">${index + 1}</td>
            <td>${escapeHtml(student.full_name)}</td>
            <td>${escapeHtml(student.matricule || "")}</td>
            <td class="center">&nbsp;</td>
            <td class="center">${formatScore(student.general_avg)}</td>
            <td class="center">${escapeHtml(formatRank(student.general_rank))}</td>
            <td class="center manual-cell"></td>
            <td class="center manual-cell"></td>
            <td class="center manual-cell"></td>
          </tr>
        `
      )
      .join("");

    const subjectRowsHtml = data.subjectIndicators
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.subject_name)}</td>
            <td class="center">${item.effectif}</td>
            <td class="center">${item.ge10_count}</td>
            <td class="center">${nf.format(item.ge10_pct)}%</td>
            <td class="center">${item.between85And10_count}</td>
            <td class="center">${nf.format(item.between85And10_pct)}%</td>
            <td class="center">${item.lt85_count}</td>
            <td class="center">${nf.format(item.lt85_pct)}%</td>
            <td class="center">${formatScore(item.avg_20)}</td>
            <td>${escapeHtml(item.teacher_names || "")}</td>
          </tr>
        `
      )
      .join("");

    const specificSubjects = `
      <table class="table compact-table">
        <thead>
          <tr>
            <th>FRANÇAIS</th>
            <th>ANGLAIS</th>
            <th>PHILO</th>
            <th>ALLESP</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="center">${escapeHtml(data.specificSubjects.francais || "")}</td>
            <td class="center">${escapeHtml(data.specificSubjects.anglais || "")}</td>
            <td class="center">${escapeHtml(data.specificSubjects.philo || "")}</td>
            <td class="center">${escapeHtml(data.specificSubjects.allesp || "")}</td>
          </tr>
        </tbody>
      </table>
    `;

    const majorRows = data.majorStudent
      ? `
        <tr>
          <td class="center">1</td>
          <td>${escapeHtml(data.majorStudent.full_name)}</td>
          <td>${escapeHtml(data.majorStudent.matricule || "")}</td>
          <td class="center">&nbsp;</td>
          <td class="center">${formatScore(data.majorStudent.general_avg)}</td>
          <td class="center">${escapeHtml(formatRank(data.majorStudent.general_rank))}</td>
        </tr>
      `
      : `
        <tr>
          <td class="center">1</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
        </tr>
      `;

    const manualCouncilMembers = Array.from({ length: 6 })
      .map(
        () => `
        <div class="manual-line-row">
          <span class="manual-line"></span>
          <span class="manual-line"></span>
        </div>
      `
      )
      .join("");

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Procès-verbal de conseil de classe – ${escapeHtml(data.class_label)}</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 10mm;
            }
            * { box-sizing: border-box; }
            body {
              font-family: Arial, Helvetica, sans-serif;
              color: #111827;
              margin: 0;
              font-size: 10px;
            }
            .page {
              width: 100%;
              min-height: 277mm;
              page-break-after: always;
              padding: 0;
            }
            .page:last-child { page-break-after: auto; }
            .header-grid {
              display: grid;
              grid-template-columns: 90px 1fr 90px;
              gap: 10px;
              align-items: start;
              margin-bottom: 10px;
            }
            .header-side {
              font-size: 9px;
              line-height: 1.35;
              text-align: center;
            }
            .header-center {
              text-align: center;
            }
            .logo {
              width: 64px;
              height: 64px;
              object-fit: contain;
              margin: 0 auto 4px;
            }
            .placeholder-logo {
              border: 1px solid #94a3b8;
              border-radius: 999px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 10px;
              font-weight: bold;
            }
            .app-ribbon {
              margin: 6px auto 0;
              display: inline-block;
              padding: 4px 12px;
              border-radius: 999px;
              background: #6b7280;
              color: white;
              font-size: 10px;
              font-weight: bold;
              letter-spacing: 0.03em;
            }
            .document-title {
              margin-top: 10px;
              font-size: 15px;
              font-weight: 700;
              text-align: center;
              letter-spacing: 0.02em;
              text-transform: uppercase;
            }
            .meta-list {
              margin-top: 10px;
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 8px;
              font-size: 10px;
            }
            .meta-box {
              border: 1px solid #94a3b8;
              padding: 6px 8px;
              min-height: 38px;
            }
            .meta-box strong {
              display: block;
              margin-bottom: 3px;
              font-size: 9px;
              text-transform: uppercase;
            }
            .table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 8px;
            }
            .table th,
            .table td {
              border: 1px solid #6b7280;
              padding: 4px 5px;
              vertical-align: middle;
            }
            .table th {
              background: #d1d5db;
              font-weight: 700;
            }
            .table .center { text-align: center; }
            .section-title {
              margin-top: 10px;
              font-size: 12px;
              font-weight: 700;
            }
            .stats-grid {
              display: grid;
              grid-template-columns: 2fr 1fr 1fr 1fr 1.2fr 1.2fr 1.2fr;
              margin-top: 8px;
            }
            .stats-grid > div {
              border: 1px solid #6b7280;
              padding: 5px 6px;
              min-height: 46px;
            }
            .stats-grid .head {
              background: #d1d5db;
              font-weight: 700;
              font-size: 9px;
            }
            .mini-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 10px;
              margin-top: 10px;
            }
            .boxed-title {
              background: #6b7280;
              color: #fff;
              padding: 5px 8px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.02em;
              font-size: 10px;
            }
            .boxed-content {
              border: 1px solid #6b7280;
              border-top: none;
              min-height: 82px;
              padding: 8px;
            }
            .manual-line-row {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 14px;
              margin-bottom: 8px;
            }
            .manual-line {
              display: block;
              border-bottom: 1px dotted #6b7280;
              min-height: 18px;
            }
            .analysis-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 8px;
              margin-top: 8px;
            }
            .analysis-box {
              border: 1px solid #6b7280;
              min-height: 150px;
            }
            .analysis-box .head {
              background: #6b7280;
              color: white;
              padding: 6px 8px;
              font-weight: 700;
              text-transform: uppercase;
            }
            .analysis-box .body {
              padding: 8px;
              min-height: 118px;
            }
            .signature-grid-top,
            .signature-grid-bottom {
              display: grid;
              gap: 20px;
            }
            .signature-grid-top {
              grid-template-columns: 1fr 1fr;
              margin-top: 12px;
            }
            .signature-grid-bottom {
              grid-template-columns: 1fr 1fr;
              margin-top: 42px;
            }
            .signature-box {
              min-height: 120px;
              position: relative;
            }
            .signature-label {
              position: absolute;
              bottom: 0;
              left: 0;
              font-weight: 700;
            }
            .signature-name {
              position: absolute;
              bottom: 16px;
              left: 0;
              font-weight: 700;
              text-transform: uppercase;
            }
            .signature-lines {
              position: absolute;
              top: 8px;
              left: 0;
              right: 0;
            }
            .signature-lines .line {
              border-bottom: 1px dotted #6b7280;
              height: 22px;
            }
            .footer-note {
              position: absolute;
              bottom: 6mm;
              left: 0;
              right: 0;
              text-align: center;
              font-size: 8.5px;
              color: #6b7280;
            }
            .page-frame {
              position: relative;
              min-height: 255mm;
            }
            .compact-table th,
            .compact-table td {
              text-align: center;
              padding: 6px 4px;
            }
            .manual-cell { min-width: 24px; }
            .summary-row {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 8px;
              margin-top: 10px;
            }
            .summary-box {
              border: 1px solid #6b7280;
              padding: 6px 8px;
            }
            .summary-box .label {
              display: block;
              font-size: 8.5px;
              color: #374151;
              text-transform: uppercase;
              margin-bottom: 3px;
            }
            .summary-box .value {
              font-size: 11px;
              font-weight: 700;
            }
          </style>
        </head>
        <body>
          <section class="page">
            <div class="page-frame">
              <div class="header-grid">
                <div class="header-side">
                  <div><strong>République de Côte d'Ivoire</strong></div>
                  <div>Union - Discipline - Travail</div>
                  <div style="margin-top:8px;"><strong>Ministère de l'Éducation Nationale</strong></div>
                </div>
                <div class="header-center">
                  ${logoBlock}
                  <div style="font-weight:700; font-size:12px;">${institutionName}</div>
                  ${contactLine ? `<div style="margin-top:3px;">${contactLine}</div>` : ""}
                  ${cityLine ? `<div style="margin-top:2px;">${cityLine}</div>` : ""}
                  <div class="app-ribbon">PROCÈS VERBAL DE CONSEIL DE CLASSE</div>
                </div>
                <div class="header-side">
                  <div><strong>Année scolaire</strong></div>
                  <div>${yearText}</div>
                  <div style="margin-top:8px;"><strong>Période</strong></div>
                  <div>${periodText}</div>
                </div>
              </div>

              <div class="document-title">Procès verbal du conseil de la classe de ${escapeHtml(data.class_label)}</div>

              <div class="meta-list">
                <div class="meta-box"><strong>Filles</strong>—</div>
                <div class="meta-box"><strong>Garçons</strong>—</div>
                <div class="meta-box"><strong>Total</strong>${total}</div>
                <div class="meta-box"><strong>Niveau</strong>${escapeHtml(data.level || "—")}</div>
                <div class="meta-box"><strong>Filles red.</strong>—</div>
                <div class="meta-box"><strong>Garçons red.</strong>—</div>
                <div class="meta-box"><strong>Total red.</strong>—</div>
                <div class="meta-box"><strong>Classés</strong>${classed}</div>
                <div class="meta-box"><strong>Filles aff.</strong>—</div>
                <div class="meta-box"><strong>Garçons aff.</strong>—</div>
                <div class="meta-box"><strong>Total aff.</strong>—</div>
                <div class="meta-box"><strong>Total non aff.</strong>—</div>
              </div>

              <div class="section-title">Liste de classe</div>
              <table class="table">
                <thead>
                  <tr>
                    <th class="center" style="width:32px;">No</th>
                    <th>Nom et prénom</th>
                    <th style="width:105px;">No Matr.</th>
                    <th class="center" style="width:95px;">Date de naissance</th>
                    <th class="center" style="width:65px;">Moyenne</th>
                    <th class="center" style="width:55px;">Rang</th>
                    <th class="center" style="width:45px;">TH+FE</th>
                    <th class="center" style="width:45px;">TH+EN</th>
                    <th class="center" style="width:45px;">TH</th>
                  </tr>
                </thead>
                <tbody>
                  ${studentRowsHtml}
                </tbody>
              </table>

              <div class="section-title">Statistiques de classe</div>
              <div class="stats-grid">
                <div class="head">Effectif classe</div>
                <div class="head center">Classés</div>
                <div class="head center">Moy ≥ 10<br/>Nombre / %</div>
                <div class="head center">Élèves avec une moyenne<br/>8,5 ≤ Moy &lt; 10</div>
                <div class="head center">Moy &lt; 8,5<br/>Nombre / %</div>
                <div class="head center">Mini</div>
                <div class="head center">Maxi / Moy</div>

                <div><strong>TOTAL</strong></div>
                <div class="center">${classed}</div>
                <div class="center">${data.moy_ge_10_count}<br/>${nf.format(percentOf(data.moy_ge_10_count, classed))}%</div>
                <div class="center">${data.between85And10_count}<br/>${nf.format(percentOf(data.between85And10_count, classed))}%</div>
                <div class="center">${data.lt85_count}<br/>${nf.format(percentOf(data.lt85_count, classed))}%</div>
                <div class="center">${formatScore(data.class_min_20)}</div>
                <div class="center">${formatScore(data.class_max_20)} / ${formatScore(data.class_avg_20)}</div>
              </div>

              <div class="mini-grid">
                <div>
                  <div class="boxed-title">Distinctions</div>
                  <div class="boxed-content">
                    <div style="display:grid; grid-template-columns: 1fr 70px; gap:8px; margin-bottom:8px;">
                      <div>TH</div><div class="center">&nbsp;</div>
                      <div>TH + Encouragements</div><div class="center">&nbsp;</div>
                      <div>Tableau d'honneur</div><div class="center">&nbsp;</div>
                    </div>
                  </div>
                </div>
                <div>
                  <div class="boxed-title">Avertissements et sanctions</div>
                  <div class="boxed-content">
                    <div style="display:grid; grid-template-columns: 1fr 70px; gap:8px; margin-bottom:8px;">
                      <div>Avertissement Travail</div><div class="center">&nbsp;</div>
                      <div>Avert. Conduite</div><div class="center">&nbsp;</div>
                      <div>Blâme Travail</div><div class="center">&nbsp;</div>
                      <div>Blâme Conduite</div><div class="center">&nbsp;</div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="section-title">Statistiques par discipline</div>
              <table class="table">
                <thead>
                  <tr>
                    <th>Matière</th>
                    <th class="center" style="width:62px;">Effectif</th>
                    <th class="center" style="width:70px;">M ≥ 10<br/>Nbre</th>
                    <th class="center" style="width:70px;">M ≥ 10<br/>%</th>
                    <th class="center" style="width:80px;">10 &gt; M ≥ 8,5<br/>Nbre</th>
                    <th class="center" style="width:80px;">10 &gt; M ≥ 8,5<br/>%</th>
                    <th class="center" style="width:70px;">M &lt; 8,5<br/>Nbre</th>
                    <th class="center" style="width:70px;">M &lt; 8,5<br/>%</th>
                    <th class="center" style="width:60px;">Moy.</th>
                    <th>Enseignant / Émargement</th>
                  </tr>
                </thead>
                <tbody>
                  ${subjectRowsHtml}
                </tbody>
              </table>

              <div class="footer-note">Document généré depuis Mon Cahier – zones blanches conservées pour remplissage manuel après impression.</div>
            </div>
          </section>

          <section class="page">
            <div class="page-frame">
              <div class="section-title">Majors de la classe</div>
              <table class="table">
                <thead>
                  <tr>
                    <th class="center" style="width:36px;">No</th>
                    <th>Nom et prénom</th>
                    <th style="width:110px;">No matricule</th>
                    <th class="center" style="width:95px;">Date de naissance</th>
                    <th class="center" style="width:65px;">Moyenne</th>
                    <th class="center" style="width:55px;">Rang</th>
                  </tr>
                </thead>
                <tbody>
                  ${majorRows}
                </tbody>
              </table>

              <div class="section-title">Matières spécifiques</div>
              ${specificSubjects}

              <div class="analysis-grid">
                <div class="analysis-box">
                  <div class="head">Problèmes de la classe</div>
                  <div class="body"></div>
                </div>
                <div class="analysis-box">
                  <div class="head">Proposition de solutions</div>
                  <div class="body"></div>
                </div>
              </div>

              <div style="margin-top: 12px;">
                <div class="boxed-title">Les membres du conseil</div>
                <div class="boxed-content">
                  ${manualCouncilMembers}
                </div>
              </div>

              <div class="footer-note">Procès-verbal du conseil de classe – page 2</div>
            </div>
          </section>

          <section class="page">
            <div class="page-frame">
              <div class="signature-grid-top">
                <div class="signature-box">
                  <div class="signature-lines">
                    <div class="line"></div>
                    <div class="line"></div>
                    <div class="line"></div>
                    <div class="line"></div>
                  </div>
                </div>
                <div class="signature-box">
                  <div class="signature-lines">
                    <div class="line"></div>
                    <div class="line"></div>
                    <div class="line"></div>
                    <div class="line"></div>
                  </div>
                </div>
              </div>

              <div class="signature-grid-bottom">
                <div class="signature-box">
                  <div class="signature-name">Professeur principal</div>
                  <div class="signature-label">Nom / Signature</div>
                </div>
                <div class="signature-box">
                  <div style="position:absolute; top:0; right:0; font-size:10px;">
                    ${cityLine ? `${cityLine.split("•").pop()?.trim() || ""}, ` : ""}${new Date().toLocaleDateString("fr-FR")}
                  </div>
                  ${principalName ? `<div class="signature-name">${principalName}</div>` : ""}
                  <div class="signature-label">${principalRole}</div>
                </div>
              </div>

              <div class="footer-note">Procès-verbal du conseil de classe – page 3</div>
            </div>
          </section>
        </body>
      </html>
    `;
  }

  function printDocument() {
    if (typeof window === "undefined" || !docData) {
      setDocError("Chargez d'abord le document avant impression.");
      return;
    }

    const html = buildConseilHtml(docData);
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">Procès-verbal de conseil de classe</h1>
        <p className="text-sm text-slate-600">
          Nouveau rendu basé sur la page fonctionnelle des statistiques, avec les champs du modèle
          papier et uniquement le tableau <strong>matières indicateurs</strong> conservé côté
          données automatiques.
        </p>
      </div>

      <Card
        title="Filtres globaux"
        subtitle="Année scolaire, période d'évaluation, état de publication et classe ciblée."
        icon={<Filter className="h-4 w-4 text-emerald-600" />}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5 mb-3">
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

          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Période d'évaluation</div>
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

          <div className="md:col-span-1">
            <div className="mb-1 text-xs text-slate-500">État de publication</div>
            <Select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="all">Toutes les évaluations</option>
              <option value="published">Publié pour les parents</option>
              <option value="draft">Brouillon uniquement</option>
            </Select>
          </div>
        </div>

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

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Select
              value={matrixLevel}
              onChange={(e) => {
                setMatrixLevel(e.target.value);
                setMatrixClassId("");
                setDocData(null);
                setDocError(null);
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
                setDocData(null);
                setDocError(null);
              }}
              disabled={!matrixLevel || loadingClasses}
            >
              <option value="">
                {loadingClasses ? "Chargement..." : "— Choisir une classe —"}
              </option>
              {classesForLevel.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" onClick={loadDocument} disabled={loadingDoc || !matrixClassId}>
            {loadingDoc ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <ScrollText className="h-4 w-4" />
            )}
            Générer le procès-verbal
          </Button>
          <GhostButton
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
              setStatus("all");
              setSelectedYearCode("");
              setSelectedPeriodId("");
              setMatrixLevel("");
              setMatrixClassId("");
              setDocData(null);
              setDocError(null);
            }}
          >
            Réinitialiser
          </GhostButton>
          <span className="text-xs text-slate-500">{periodLabel}</span>
        </div>

        {docError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {docError}
          </div>
        )}
      </Card>

      <Card
        title="Aperçu du document"
        subtitle="Les zones manuelles restent volontairement vides pour être complétées après impression."
        icon={<School className="h-4 w-4 text-emerald-600" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <GhostButton type="button" onClick={exportIndicatorsCsv} disabled={!docData}>
              <FileSpreadsheet className="h-4 w-4" />
              Export CSV (matières indicateurs)
            </GhostButton>
            <GhostButton type="button" onClick={printDocument} disabled={!docData}>
              <Printer className="h-4 w-4" />
              Imprimer le procès-verbal
            </GhostButton>
          </div>
        }
      >
        {!docData ? (
          <p className="text-sm text-slate-500">
            Choisissez une classe puis cliquez sur <strong>Générer le procès-verbal</strong>.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4 text-xs">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">Classe</div>
                <div className="text-sm font-semibold text-slate-900">
                  {docData.class_label} {docData.level ? `(${docData.level})` : ""}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">Effectif / Classés</div>
                <div className="text-sm font-semibold text-slate-900">
                  {docData.students.length} / {docData.classed_count}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">Moyenne de classe</div>
                <div className="text-sm font-semibold text-slate-900">
                  {docData.class_avg_20 == null ? "—" : `${nf.format(docData.class_avg_20)} /20`}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">Major</div>
                <div className="text-sm font-semibold text-slate-900">
                  {docData.majorStudent?.full_name || "—"}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Les blocs <strong>analyse</strong>, <strong>membres du conseil</strong> et les
              <strong> zones de signature</strong> sont gardés vides exprès pour le remplissage
              manuscrit après impression, comme sur ton modèle papier.
            </div>

            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-xs sm:text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-2 text-left">Matière</th>
                    <th className="px-2 py-2 text-center">Effectif</th>
                    <th className="px-2 py-2 text-center">M ≥ 10</th>
                    <th className="px-2 py-2 text-center">%</th>
                    <th className="px-2 py-2 text-center">10 &gt; M ≥ 8,5</th>
                    <th className="px-2 py-2 text-center">%</th>
                    <th className="px-2 py-2 text-center">M &lt; 8,5</th>
                    <th className="px-2 py-2 text-center">%</th>
                    <th className="px-2 py-2 text-center">Moy.</th>
                    <th className="px-2 py-2 text-left">Enseignant / Émargement</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {docData.subjectIndicators.map((item) => (
                    <tr key={item.subject_id} className="hover:bg-slate-50/60">
                      <td className="px-2 py-2 text-slate-800">{item.subject_name}</td>
                      <td className="px-2 py-2 text-center">{item.effectif}</td>
                      <td className="px-2 py-2 text-center">{item.ge10_count}</td>
                      <td className="px-2 py-2 text-center">{nf.format(item.ge10_pct)}%</td>
                      <td className="px-2 py-2 text-center">{item.between85And10_count}</td>
                      <td className="px-2 py-2 text-center">{nf.format(item.between85And10_pct)}%</td>
                      <td className="px-2 py-2 text-center">{item.lt85_count}</td>
                      <td className="px-2 py-2 text-center">{nf.format(item.lt85_pct)}%</td>
                      <td className="px-2 py-2 text-center">{formatScore(item.avg_20)}</td>
                      <td className="px-2 py-2 text-slate-700">{item.teacher_names || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
