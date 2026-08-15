"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenCheck,
  CalendarDays,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  UserRound,
  X,
} from "lucide-react";

type ClassRow = {
  id: string;
  label?: string | null;
  name?: string | null;
  level?: string | null;
  academic_year?: string | null;
  education_type?: string | null;
  formation_level_code?: string | null;
};

type GradePeriod = {
  id: string;
  academic_year?: string | null;
  code?: string | null;
  label?: string | null;
  short_label?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  order_index?: number | null;
  is_active?: boolean | null;
};

type AffectationItem = {
  teacher?: {
    id?: string | null;
    display_name?: string | null;
    email?: string | null;
  } | null;
  subject?: {
    id?: string | null;
    label?: string | null;
  } | null;
  classes?: Array<{
    id?: string | null;
    name?: string | null;
    level?: string | null;
  }>;
};

type RosterItem = {
  id: string;
  full_name: string;
  matricule?: string | null;
};

type RegisterEvaluation = {
  id: string;
  eval_date: string;
  eval_kind: "devoir" | "interro_ecrite" | "interro_orale" | string;
  scale: number;
  coeff: number;
  is_published: boolean;
  publication_status?: string | null;
  subject_component_id?: string | null;
  component_label?: string | null;
  column_label?: string | null;
  is_locked?: boolean;
  editable?: boolean;
};

type RegisterScore = {
  evaluation_id: string;
  student_id: string;
  score: number | null;
};

type SubjectComponent = {
  id: string;
  label?: string | null;
  short_label?: string | null;
};

type RegisterResponse = {
  ok: boolean;
  error?: string;
  class?: {
    id: string;
    label?: string | null;
    level?: string | null;
    academic_year?: string | null;
  };
  period?: GradePeriod;
  subject?: {
    id: string;
    raw_id?: string | null;
    label?: string | null;
  };
  teacher_id?: string;
  roster?: RosterItem[];
  evaluations?: RegisterEvaluation[];
  scores?: RegisterScore[];
  components?: SubjectComponent[];
};

type NewEvaluationForm = {
  eval_date: string;
  eval_kind: "devoir" | "interro_ecrite" | "interro_orale";
  scale: 5 | 10 | 20 | 40 | 60;
  coeff: number;
  subject_component_id: string;
};

function classLabel(row?: ClassRow | null) {
  return row?.label || row?.name || "Classe";
}

function periodLabel(row?: GradePeriod | null) {
  return row?.short_label || row?.label || row?.code || "Période";
}

function levelLabel(row?: ClassRow | null) {
  return row?.formation_level_code || row?.level || "Sans niveau";
}

function teacherLabel(item?: AffectationItem | null) {
  return (
    item?.teacher?.display_name ||
    item?.teacher?.email ||
    "Enseignant"
  );
}

function subjectLabel(item?: AffectationItem | null) {
  return item?.subject?.label || "Discipline";
}

function evalKindLabel(kind: string) {
  if (kind === "interro_ecrite") return "Interro écrite";
  if (kind === "interro_orale") return "Interro orale";
  return "Devoir";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function parseGradeInput(value: string): number | null {
  const normalized = String(value || "").trim().replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function displayScore(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "";
  }
  return String(Number(value)).replace(".", ",");
}

function currentDateForPeriod(period?: GradePeriod | null) {
  const today = new Date().toISOString().slice(0, 10);
  const start = String(period?.start_date || "");
  const end = String(period?.end_date || "");
  if (start && today < start) return start;
  if (end && today > end) return end;
  return today;
}

function evaluationStatus(ev: RegisterEvaluation) {
  if (ev.is_locked) return { label: "Verrouillé", className: "bg-slate-100 text-slate-600" };
  const status = String(ev.publication_status || "");
  if (ev.is_published || status === "published") {
    return { label: "Publié", className: "bg-emerald-50 text-emerald-700" };
  }
  if (status === "submitted") {
    return { label: "Soumis", className: "bg-amber-50 text-amber-700" };
  }
  if (status === "changes_requested") {
    return { label: "À corriger", className: "bg-rose-50 text-rose-700" };
  }
  return { label: "Brouillon", className: "bg-sky-50 text-sky-700" };
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </span>
  );
}

function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & {
    children: React.ReactNode;
  },
) {
  const { className = "", children, ...rest } = props;
  return (
    <div className="relative">
      <select
        {...rest}
        className={[
          "h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 pr-9 text-sm text-slate-800 shadow-sm outline-none transition",
          "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
          className,
        ].join(" ")}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

function Button({
  tone = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "ghost";
}) {
  const toneClass =
    tone === "primary"
      ? "bg-emerald-600 text-white hover:bg-emerald-700"
      : tone === "secondary"
        ? "bg-slate-900 text-white hover:bg-slate-800"
        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50";

  return (
    <button
      {...props}
      className={[
        "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold shadow-sm transition",
        "focus:outline-none focus:ring-4 focus:ring-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50",
        toneClass,
        className,
      ].join(" ")}
    />
  );
}

export default function AdminGradeRegisterPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedLevel, setSelectedLevel] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");

  const [periods, setPeriods] = useState<GradePeriod[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");

  const [affectations, setAffectations] = useState<AffectationItem[]>([]);
  const [affectationsLoading, setAffectationsLoading] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedTeacherId, setSelectedTeacherId] = useState("");

  const [register, setRegister] = useState<RegisterResponse | null>(null);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);

  const [showNewEvaluation, setShowNewEvaluation] = useState(false);
  const [creatingEvaluation, setCreatingEvaluation] = useState(false);
  const [newEvaluation, setNewEvaluation] = useState<NewEvaluationForm>({
    eval_date: new Date().toISOString().slice(0, 10),
    eval_kind: "devoir",
    scale: 20,
    coeff: 1,
    subject_component_id: "",
  });

  const loadSeq = useRef(0);

  const academicYears = useMemo(() => {
    return Array.from(
      new Set(classes.map((row) => String(row.academic_year || "")).filter(Boolean)),
    ).sort((a, b) => b.localeCompare(a, "fr", { numeric: true }));
  }, [classes]);

  const classesForYear = useMemo(
    () => classes.filter((row) => !selectedYear || row.academic_year === selectedYear),
    [classes, selectedYear],
  );

  const levels = useMemo(() => {
    return Array.from(new Set(classesForYear.map((row) => levelLabel(row)))).sort((a, b) =>
      a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" }),
    );
  }, [classesForYear]);

  const classOptions = useMemo(
    () =>
      classesForYear
        .filter((row) => !selectedLevel || levelLabel(row) === selectedLevel)
        .slice()
        .sort((a, b) =>
          classLabel(a).localeCompare(classLabel(b), "fr", {
            numeric: true,
            sensitivity: "base",
          }),
        ),
    [classesForYear, selectedLevel],
  );

  const selectedClass = useMemo(
    () => classes.find((row) => row.id === selectedClassId) || null,
    [classes, selectedClassId],
  );

  const periodOptions = useMemo(
    () =>
      periods
        .filter((row) => row.is_active !== false)
        .slice()
        .sort((a, b) => {
          const ai = Number(a.order_index ?? 999);
          const bi = Number(b.order_index ?? 999);
          if (ai !== bi) return ai - bi;
          return String(a.start_date || "").localeCompare(String(b.start_date || ""));
        }),
    [periods],
  );

  const selectedPeriod = useMemo(
    () => periodOptions.find((row) => row.id === selectedPeriodId) || null,
    [periodOptions, selectedPeriodId],
  );

  const subjectOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    for (const item of affectations) {
      const id = String(item.subject?.id || "").trim();
      const label = subjectLabel(item).trim();
      if (!id || !label) continue;
      if (!map.has(id)) map.set(id, { id, label });
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "fr", { sensitivity: "base" }),
    );
  }, [affectations]);

  const teacherOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    for (const item of affectations) {
      if (String(item.subject?.id || "") !== selectedSubjectId) continue;
      const id = String(item.teacher?.id || "").trim();
      if (!id) continue;
      map.set(id, { id, label: teacherLabel(item) });
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "fr", { sensitivity: "base" }),
    );
  }, [affectations, selectedSubjectId]);

  const selectedSubject = useMemo(
    () => subjectOptions.find((row) => row.id === selectedSubjectId) || null,
    [subjectOptions, selectedSubjectId],
  );

  const selectedTeacher = useMemo(
    () => teacherOptions.find((row) => row.id === selectedTeacherId) || null,
    [teacherOptions, selectedTeacherId],
  );

  const evaluations = register?.evaluations || [];
  const roster = register?.roster || [];
  const originalScoreMap = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const item of register?.scores || []) {
      map.set(`${item.evaluation_id}:${item.student_id}`, item.score);
    }
    return map;
  }, [register?.scores]);

  const filteredRoster = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("fr");
    if (!query) return roster;
    return roster.filter((student) => {
      const haystack = `${student.full_name} ${student.matricule || ""}`.toLocaleLowerCase("fr");
      return haystack.includes(query);
    });
  }, [roster, search]);

  const dirtyCount = useMemo(
    () =>
      Object.values(dirty).reduce(
        (total, perEvaluation) => total + Object.keys(perEvaluation).length,
        0,
      ),
    [dirty],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadClasses() {
      try {
        setClassesLoading(true);
        const response = await fetch(
          "/api/admin/classes?academic_year=all&education_type=all&limit=5000",
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Impossible de charger les classes.");
        if (cancelled) return;
        setClasses(Array.isArray(data?.items) ? data.items : []);
      } catch (reason: any) {
        if (!cancelled) setError(reason?.message || "Impossible de charger les classes.");
      } finally {
        if (!cancelled) setClassesLoading(false);
      }
    }
    void loadClasses();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!academicYears.length) return;
    setSelectedYear((current) =>
      current && academicYears.includes(current) ? current : academicYears[0],
    );
  }, [academicYears]);

  useEffect(() => {
    setSelectedLevel((current) =>
      current && levels.includes(current) ? current : levels[0] || "",
    );
  }, [levels]);

  useEffect(() => {
    setSelectedClassId((current) =>
      current && classOptions.some((row) => row.id === current)
        ? current
        : classOptions[0]?.id || "",
    );
  }, [classOptions]);

  useEffect(() => {
    let cancelled = false;
    setRegister(null);
    setDirty({});
    setMessage(null);
    setError(null);

    if (!selectedClassId || !selectedYear) {
      setPeriods([]);
      setAffectations([]);
      return () => {
        cancelled = true;
      };
    }

    async function loadSelectionData() {
      try {
        setPeriodsLoading(true);
        setAffectationsLoading(true);
        const periodParams = new URLSearchParams({
          academic_year: selectedYear,
          class_id: selectedClassId,
        });
        const affectationParams = new URLSearchParams({
          academic_year: selectedYear,
          class_id: selectedClassId,
          education_type: "all",
        });

        const [periodResponse, affectationResponse] = await Promise.all([
          fetch(`/api/admin/institution/grading-periods?${periodParams.toString()}`, {
            cache: "no-store",
          }),
          fetch(`/api/admin/affectations/current?${affectationParams.toString()}`, {
            cache: "no-store",
          }),
        ]);

        const periodData = await periodResponse.json().catch(() => ({}));
        const affectationData = await affectationResponse.json().catch(() => ({}));

        if (!periodResponse.ok) {
          throw new Error(periodData?.error || "Impossible de charger les périodes.");
        }
        if (!affectationResponse.ok) {
          throw new Error(affectationData?.error || "Impossible de charger les disciplines.");
        }
        if (cancelled) return;

        setPeriods(Array.isArray(periodData?.items) ? periodData.items : Array.isArray(periodData) ? periodData : []);
        setAffectations(Array.isArray(affectationData?.items) ? affectationData.items : []);
      } catch (reason: any) {
        if (!cancelled) {
          setPeriods([]);
          setAffectations([]);
          setError(reason?.message || "Impossible de préparer le registre.");
        }
      } finally {
        if (!cancelled) {
          setPeriodsLoading(false);
          setAffectationsLoading(false);
        }
      }
    }

    void loadSelectionData();
    return () => {
      cancelled = true;
    };
  }, [selectedClassId, selectedYear]);

  useEffect(() => {
    setSelectedPeriodId((current) =>
      current && periodOptions.some((row) => row.id === current)
        ? current
        : periodOptions[0]?.id || "",
    );
  }, [periodOptions]);

  useEffect(() => {
    setSelectedSubjectId((current) =>
      current && subjectOptions.some((row) => row.id === current)
        ? current
        : subjectOptions[0]?.id || "",
    );
  }, [subjectOptions]);

  useEffect(() => {
    setSelectedTeacherId((current) =>
      current && teacherOptions.some((row) => row.id === current)
        ? current
        : teacherOptions[0]?.id || "",
    );
  }, [teacherOptions]);

  async function loadRegister(showBusy = true) {
    const seq = ++loadSeq.current;
    setError(null);
    if (
      !selectedClassId ||
      !selectedPeriodId ||
      !selectedSubjectId ||
      !selectedTeacherId
    ) {
      setRegister(null);
      return;
    }

    try {
      if (showBusy) setRegisterLoading(true);
      const params = new URLSearchParams({
        class_id: selectedClassId,
        grading_period_id: selectedPeriodId,
        subject_id: selectedSubjectId,
        teacher_id: selectedTeacherId,
      });
      const response = await fetch(`/api/admin/grades/register?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as RegisterResponse;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Impossible de charger le registre des notes.");
      }
      if (seq !== loadSeq.current) return;
      setRegister(data);
      setDirty({});
    } catch (reason: any) {
      if (seq !== loadSeq.current) return;
      setRegister(null);
      setError(reason?.message || "Impossible de charger le registre des notes.");
    } finally {
      if (seq === loadSeq.current && showBusy) setRegisterLoading(false);
    }
  }

  useEffect(() => {
    setRegister(null);
    setDirty({});
    setSearch("");
    setMessage(null);
    if (
      selectedClassId &&
      selectedPeriodId &&
      selectedSubjectId &&
      selectedTeacherId
    ) {
      void loadRegister();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId, selectedPeriodId, selectedSubjectId, selectedTeacherId]);

  function getCellValue(evaluationId: string, studentId: string) {
    const dirtyValue = dirty[evaluationId]?.[studentId];
    if (dirtyValue !== undefined) return dirtyValue;
    return displayScore(originalScoreMap.get(`${evaluationId}:${studentId}`));
  }

  function setCellValue(evaluationId: string, studentId: string, value: string) {
    setDirty((current) => ({
      ...current,
      [evaluationId]: {
        ...(current[evaluationId] || {}),
        [studentId]: value,
      },
    }));
    setMessage(null);
  }

  function studentAverage20(studentId: string) {
    let numerator = 0;
    let denominator = 0;

    for (const evaluation of evaluations) {
      const value = parseGradeInput(getCellValue(evaluation.id, studentId));
      if (value === null) continue;
      const scale = Number(evaluation.scale || 20);
      const coeff = Number(evaluation.coeff || 1);
      if (!Number.isFinite(scale) || scale <= 0) continue;
      const weight = Number.isFinite(coeff) && coeff > 0 ? coeff : 1;
      numerator += (value / scale) * 20 * weight;
      denominator += weight;
    }

    return denominator > 0 ? numerator / denominator : null;
  }

  async function saveChanges() {
    const entries = Object.entries(dirty).filter(([, items]) => Object.keys(items).length > 0);
    if (!entries.length) {
      setMessage("Aucune modification à enregistrer.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setMessage(null);

      for (const [evaluationId, values] of entries) {
        const evaluation = evaluations.find((row) => row.id === evaluationId);
        if (!evaluation?.editable) continue;

        const items = Object.entries(values).map(([student_id, raw]) => ({
          student_id,
          score: raw.trim() === "" ? null : parseGradeInput(raw),
        }));

        const invalid = items.find(
          (item) =>
            item.score !== null &&
            (item.score < 0 || item.score > Number(evaluation.scale || 20)),
        );
        if (invalid) {
          const student = roster.find((row) => row.id === invalid.student_id);
          throw new Error(
            `${student?.full_name || "Une note"} doit être comprise entre 0 et ${evaluation.scale}.`,
          );
        }

        const response = await fetch("/api/admin/grades/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_scores",
            evaluation_id: evaluationId,
            items,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || "Échec de l’enregistrement des notes.");
        }
      }

      setMessage("Notes enregistrées.");
      await loadRegister(false);
    } catch (reason: any) {
      setError(reason?.message || "Échec de l’enregistrement des notes.");
    } finally {
      setSaving(false);
    }
  }

  function openNewEvaluation() {
    setNewEvaluation({
      eval_date: currentDateForPeriod(selectedPeriod),
      eval_kind: "devoir",
      scale: 20,
      coeff: 1,
      subject_component_id: "",
    });
    setShowNewEvaluation(true);
    setMessage(null);
    setError(null);
  }

  async function createEvaluation() {
    if (!selectedClassId || !selectedPeriodId || !selectedSubjectId || !selectedTeacherId) {
      setError("Complétez d’abord les sélections du registre.");
      return;
    }

    try {
      setCreatingEvaluation(true);
      setError(null);
      setMessage(null);
      const response = await fetch("/api/admin/grades/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_evaluation",
          class_id: selectedClassId,
          grading_period_id: selectedPeriodId,
          subject_id: selectedSubjectId,
          teacher_id: selectedTeacherId,
          eval_date: newEvaluation.eval_date,
          eval_kind: newEvaluation.eval_kind,
          scale: Number(newEvaluation.scale),
          coeff: Number(newEvaluation.coeff),
          subject_component_id: newEvaluation.subject_component_id || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Impossible d’ajouter la nouvelle note.");
      }

      setShowNewEvaluation(false);
      setMessage("Nouvelle colonne ajoutée. Vous pouvez saisir les notes.");
      await loadRegister(false);
    } catch (reason: any) {
      setError(reason?.message || "Impossible d’ajouter la nouvelle note.");
    } finally {
      setCreatingEvaluation(false);
    }
  }

  const ready = Boolean(
    selectedYear &&
      selectedLevel &&
      selectedClassId &&
      selectedPeriodId &&
      selectedSubjectId &&
      selectedTeacherId,
  );

  return (
    <div className="min-h-screen bg-slate-50/70 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <BookOpenCheck className="h-5 w-5" />
                </span>
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
                    Registre des notes
                  </h1>
                  <p className="text-sm text-slate-500">
                    Consulter et saisir les notes d’un enseignant.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                tone="ghost"
                onClick={() => void loadRegister()}
                disabled={!ready || registerLoading}
              >
                <RefreshCw className={`h-4 w-4 ${registerLoading ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
              <Button type="button" tone="secondary" onClick={openNewEvaluation} disabled={!ready}>
                <Plus className="h-4 w-4" />
                Ajouter une note
              </Button>
              <Button type="button" onClick={() => void saveChanges()} disabled={!dirtyCount || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Enregistrer{dirtyCount ? ` (${dirtyCount})` : ""}
              </Button>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <label>
              <FieldLabel>Année scolaire</FieldLabel>
              <Select
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                disabled={classesLoading || !academicYears.length}
              >
                {academicYears.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </Select>
            </label>

            <label>
              <FieldLabel>Trimestre / période</FieldLabel>
              <Select
                value={selectedPeriodId}
                onChange={(event) => setSelectedPeriodId(event.target.value)}
                disabled={periodsLoading || !periodOptions.length}
              >
                {periodOptions.map((period) => (
                  <option key={period.id} value={period.id}>{periodLabel(period)}</option>
                ))}
              </Select>
            </label>

            <label>
              <FieldLabel>Niveau</FieldLabel>
              <Select
                value={selectedLevel}
                onChange={(event) => setSelectedLevel(event.target.value)}
                disabled={classesLoading || !levels.length}
              >
                {levels.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </Select>
            </label>

            <label>
              <FieldLabel>Classe</FieldLabel>
              <Select
                value={selectedClassId}
                onChange={(event) => setSelectedClassId(event.target.value)}
                disabled={classesLoading || !classOptions.length}
              >
                {classOptions.map((row) => (
                  <option key={row.id} value={row.id}>{classLabel(row)}</option>
                ))}
              </Select>
            </label>

            <label>
              <FieldLabel>Discipline</FieldLabel>
              <Select
                value={selectedSubjectId}
                onChange={(event) => setSelectedSubjectId(event.target.value)}
                disabled={affectationsLoading || !subjectOptions.length}
              >
                {subjectOptions.map((row) => (
                  <option key={row.id} value={row.id}>{row.label}</option>
                ))}
              </Select>
            </label>

            <label>
              <FieldLabel>Professeur</FieldLabel>
              <Select
                value={selectedTeacherId}
                onChange={(event) => setSelectedTeacherId(event.target.value)}
                disabled={affectationsLoading || !teacherOptions.length}
              >
                {teacherOptions.map((row) => (
                  <option key={row.id} value={row.id}>{row.label}</option>
                ))}
              </Select>
            </label>
          </div>
        </section>

        {showNewEvaluation && (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">Nouvelle note</h2>
                <p className="text-xs text-slate-500">
                  La colonne sera attribuée à {selectedTeacher?.label || "l’enseignant sélectionné"}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewEvaluation(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-800"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label>
                <FieldLabel>Date</FieldLabel>
                <input
                  type="date"
                  value={newEvaluation.eval_date}
                  min={selectedPeriod?.start_date || undefined}
                  max={selectedPeriod?.end_date || undefined}
                  onChange={(event) =>
                    setNewEvaluation((current) => ({ ...current, eval_date: event.target.value }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>

              <label>
                <FieldLabel>Type</FieldLabel>
                <Select
                  value={newEvaluation.eval_kind}
                  onChange={(event) =>
                    setNewEvaluation((current) => ({
                      ...current,
                      eval_kind: event.target.value as NewEvaluationForm["eval_kind"],
                    }))
                  }
                >
                  <option value="devoir">Devoir</option>
                  <option value="interro_ecrite">Interro écrite</option>
                  <option value="interro_orale">Interro orale</option>
                </Select>
              </label>

              <label>
                <FieldLabel>Barème</FieldLabel>
                <Select
                  value={newEvaluation.scale}
                  onChange={(event) =>
                    setNewEvaluation((current) => ({
                      ...current,
                      scale: Number(event.target.value) as NewEvaluationForm["scale"],
                    }))
                  }
                >
                  {[5, 10, 20, 40, 60].map((value) => (
                    <option key={value} value={value}>/{value}</option>
                  ))}
                </Select>
              </label>

              <label>
                <FieldLabel>Coefficient</FieldLabel>
                <input
                  type="number"
                  min="0.25"
                  max="20"
                  step="0.25"
                  value={newEvaluation.coeff}
                  onChange={(event) =>
                    setNewEvaluation((current) => ({
                      ...current,
                      coeff: Number(event.target.value),
                    }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>

              {(register?.components || []).length > 0 && (
                <label>
                  <FieldLabel>Rubrique</FieldLabel>
                  <Select
                    value={newEvaluation.subject_component_id}
                    onChange={(event) =>
                      setNewEvaluation((current) => ({
                        ...current,
                        subject_component_id: event.target.value,
                      }))
                    }
                  >
                    <option value="">Aucune</option>
                    {(register?.components || []).map((component) => (
                      <option key={component.id} value={component.id}>
                        {component.short_label || component.label || "Rubrique"}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" tone="ghost" onClick={() => setShowNewEvaluation(false)}>
                Annuler
              </Button>
              <Button type="button" onClick={() => void createEvaluation()} disabled={creatingEvaluation}>
                {creatingEvaluation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Créer la colonne
              </Button>
            </div>
          </section>
        )}

        {(message || error) && (
          <div
            className={[
              "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm",
              error
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800",
            ].join(" ")}
          >
            {error ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            <span>{error || message}</span>
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-bold text-slate-900">{classLabel(selectedClass)}</span>
                <span className="text-slate-300">•</span>
                <span className="font-medium text-slate-700">{selectedSubject?.label || "Discipline"}</span>
                <span className="text-slate-300">•</span>
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <UserRound className="h-3.5 w-3.5" />
                  {selectedTeacher?.label || "Professeur"}
                </span>
                <span className="text-slate-300">•</span>
                <span className="inline-flex items-center gap-1 text-slate-600">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {periodLabel(selectedPeriod)}
                </span>
              </div>
              {register && (
                <p className="mt-1 text-xs text-slate-500">
                  {roster.length} élève{roster.length > 1 ? "s" : ""} · {evaluations.length} note{evaluations.length > 1 ? "s" : ""}
                </p>
              )}
            </div>

            <label className="relative block w-full lg:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher un élève…"
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
              />
            </label>
          </div>

          {registerLoading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Chargement du registre…
            </div>
          ) : !ready ? (
            <div className="flex min-h-64 items-center justify-center px-6 text-center text-sm text-slate-500">
              Sélectionnez l’année, la période, le niveau, la classe, la discipline et le professeur.
            </div>
          ) : register && evaluations.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-2xl bg-slate-50 p-3 text-slate-500">
                <BookOpenCheck className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold text-slate-800">Aucune note pour cette sélection.</p>
                <p className="mt-1 text-sm text-slate-500">
                  Ajoutez la première colonne de notes pour commencer la saisie.
                </p>
              </div>
              <Button type="button" onClick={openNewEvaluation}>
                <Plus className="h-4 w-4" />
                Ajouter une note
              </Button>
            </div>
          ) : register ? (
            <div className="max-h-[68vh] overflow-auto">
              <table className="min-w-max border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur">
                  <tr>
                    <th className="sticky left-0 z-40 min-w-[250px] border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left font-semibold text-slate-700">
                      Élève
                    </th>
                    {evaluations.map((evaluation, index) => {
                      const status = evaluationStatus(evaluation);
                      return (
                        <th
                          key={evaluation.id}
                          className="min-w-[150px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-center align-top"
                        >
                          <div className="font-bold text-slate-800">
                            {evaluation.column_label || `Note ${index + 1}`}
                          </div>
                          <div className="mt-0.5 text-[11px] font-normal text-slate-500">
                            {evalKindLabel(evaluation.eval_kind)} · {formatDate(evaluation.eval_date)} · /{evaluation.scale}
                            {Number(evaluation.coeff || 1) !== 1 ? ` · Coef. ${evaluation.coeff}` : ""}
                          </div>
                          {evaluation.component_label && (
                            <div className="mt-1 truncate text-[10px] font-medium text-violet-600">
                              {evaluation.component_label}
                            </div>
                          )}
                          <span className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>
                            {status.label}
                          </span>
                        </th>
                      );
                    })}
                    <th className="sticky right-0 z-40 min-w-[120px] border-b border-l border-slate-200 bg-slate-100 px-4 py-3 text-center font-bold text-slate-800">
                      Moyenne /20
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRoster.map((student, rowIndex) => {
                    const average = studentAverage20(student.id);
                    return (
                      <tr key={student.id} className={rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                        <td className="sticky left-0 z-20 border-b border-r border-slate-100 bg-inherit px-4 py-2.5">
                          <div className="font-medium text-slate-900">{student.full_name}</div>
                          {student.matricule && (
                            <div className="mt-0.5 text-[11px] text-slate-400">{student.matricule}</div>
                          )}
                        </td>

                        {evaluations.map((evaluation) => {
                          const value = getCellValue(evaluation.id, student.id);
                          const editable = evaluation.editable === true;
                          return (
                            <td key={evaluation.id} className="border-b border-r border-slate-100 px-2 py-1.5 text-center">
                              {editable ? (
                                <input
                                  value={value}
                                  onChange={(event) =>
                                    setCellValue(evaluation.id, student.id, event.target.value)
                                  }
                                  inputMode="decimal"
                                  aria-label={`${evaluation.column_label || "Note"} de ${student.full_name}`}
                                  className="h-9 w-24 rounded-lg border border-slate-200 bg-white px-2 text-center font-semibold tabular-nums text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                                  placeholder="—"
                                />
                              ) : (
                                <span className="inline-flex h-9 min-w-16 items-center justify-center rounded-lg bg-slate-50 px-2 font-semibold tabular-nums text-slate-600">
                                  {value || "—"}
                                </span>
                              )}
                            </td>
                          );
                        })}

                        <td className="sticky right-0 z-20 border-b border-l border-slate-200 bg-slate-100 px-4 py-2.5 text-center font-bold tabular-nums text-slate-900">
                          {average === null ? "—" : average.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredRoster.length === 0 && (
                <div className="px-6 py-12 text-center text-sm text-slate-500">
                  Aucun élève ne correspond à la recherche.
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-64 items-center justify-center px-6 text-center text-sm text-slate-500">
              Le registre apparaîtra ici dès que la sélection sera complète.
            </div>
          )}
        </section>

        <p className="px-1 text-xs leading-5 text-slate-400">
          Les colonnes publiées, soumises ou verrouillées restent consultables mais ne sont pas modifiables depuis ce registre.
        </p>
      </div>
    </div>
  );
}
