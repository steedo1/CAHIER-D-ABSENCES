"use client";

import React, { useEffect, useMemo, useState } from "react";
import EducationScopeFilter from "@/components/admin/EducationScopeFilter";
import {
  buildEducationScopeSearchParams,
  classMatchesEducationScope,
  DEFAULT_EDUCATION_SCOPE,
  type EducationScopedClass,
  type EducationScopeValue,
} from "@/lib/education-scope";
import {
  BookOpenCheck,
  Loader2,
  RefreshCw,
  School,
} from "lucide-react";

type PeriodCode = "T1" | "T2" | "T3";
type PeriodFilter = "ALL" | PeriodCode;
type MonitorView = "class" | "subject";

type Metric = {
  expected_items: number;
  completed_items: number;
  planned_minutes: number;
  completed_planned_minutes: number;
  completion_rate: number;
  sessions_count: number;
  realized_minutes: number;
  realized_hours: number;
};

type MonitorItem = Metric & {
  assignment_id: string;
  progression_id?: string | null;
  progression_title: string;
  academic_year: string;
  class_id: string;
  class_label: string;
  level?: string | null;
  education_type?: EducationScopedClass["education_type"];
  formation_code?: string | null;
  formation_level_code?: string | null;
  subject_id?: string | null;
  subject_name: string;
  teacher_id?: string | null;
  teacher_name: string;
  periods: Record<PeriodCode, Metric>;
};

type MonitorPayload = {
  ok: boolean;
  academic_year: string;
  academic_years: string[];
  items: MonitorItem[];
  error?: string;
};

type TableRow = {
  key: string;
  primary: string;
  teacher: string;
  metric: Metric;
};

const EMPTY_METRIC: Metric = {
  expected_items: 0,
  completed_items: 0,
  planned_minutes: 0,
  completed_planned_minutes: 0,
  completion_rate: 0,
  sessions_count: 0,
  realized_minutes: 0,
  realized_hours: 0,
};

function pct(done: number, total: number) {
  if (!total) return 0;
  return Math.round((done / total) * 1000) / 10;
}

function metricFor(item: MonitorItem, period: PeriodFilter): Metric {
  if (period === "ALL") return item;
  return item.periods?.[period] || EMPTY_METRIC;
}

function combineMetrics(rows: MonitorItem[], period: PeriodFilter): Metric {
  const totals = rows.reduce(
    (acc, item) => {
      const metric = metricFor(item, period);
      acc.expected_items += Number(metric.expected_items || 0);
      acc.completed_items += Number(metric.completed_items || 0);
      acc.planned_minutes += Number(metric.planned_minutes || 0);
      acc.completed_planned_minutes += Number(
        metric.completed_planned_minutes || 0,
      );
      acc.sessions_count += Number(metric.sessions_count || 0);
      acc.realized_minutes += Number(metric.realized_minutes || 0);
      return acc;
    },
    {
      expected_items: 0,
      completed_items: 0,
      planned_minutes: 0,
      completed_planned_minutes: 0,
      sessions_count: 0,
      realized_minutes: 0,
    },
  );

  return {
    ...totals,
    completion_rate: totals.planned_minutes
      ? pct(totals.completed_planned_minutes, totals.planned_minutes)
      : pct(totals.completed_items, totals.expected_items),
    realized_hours:
      Math.round((totals.realized_minutes / 60) * 10) / 10,
  };
}

function subjectKey(item: MonitorItem) {
  return String(item.subject_id || item.subject_name || "").trim();
}

function groupRows(
  rows: MonitorItem[],
  period: PeriodFilter,
  mode: MonitorView,
): TableRow[] {
  const groups = new Map<string, MonitorItem[]>();

  for (const row of rows) {
    const teacherKey = String(row.teacher_id || row.teacher_name || "teacher");
    const key =
      mode === "class"
        ? `${subjectKey(row)}|${teacherKey}`
        : `${row.class_id}|${teacherKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      primary:
        mode === "class" ? group[0].subject_name : group[0].class_label,
      teacher: group[0].teacher_name || "Enseignant",
      metric: combineMetrics(group, period),
    }))
    .sort((a, b) =>
      a.primary.localeCompare(b.primary, "fr", { numeric: true }),
    );
}

function periodLabel(period: PeriodFilter) {
  if (period === "ALL") return "Toute l’année";
  return `Trimestre ${period.slice(1)}`;
}

function ProgressValue({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="flex min-w-[150px] items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-emerald-600 transition-all"
          style={{ width: `${safe}%` }}
        />
      </div>
      <span className="w-14 text-right text-sm font-black text-slate-950">
        {safe.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%
      </span>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5">
      <span className="block text-[10px] font-black uppercase tracking-[0.13em] text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
      >
        {children}
      </select>
    </label>
  );
}

export default function AdminTextbookPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<MonitorItem[]>([]);
  const [classes, setClasses] = useState<EducationScopedClass[]>([]);
  const [academicYears, setAcademicYears] = useState<string[]>([]);
  const [academicYear, setAcademicYear] = useState("");
  const [period, setPeriod] = useState<PeriodFilter>("T1");
  const [educationScope, setEducationScope] =
    useState<EducationScopeValue>(DEFAULT_EDUCATION_SCOPE);
  const [subjectId, setSubjectId] = useState("");
  const [view, setView] = useState<MonitorView>("class");

  async function load(
    year?: string,
    silent = false,
    scope: EducationScopeValue = educationScope,
  ) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const params = buildEducationScopeSearchParams(scope);
      if (year) params.set("academic_year", year);
      const query = params.toString();
      const response = await fetch(
        `/api/admin/textbook/monitor${query ? `?${query}` : ""}`,
        { cache: "no-store", credentials: "include" },
      );
      const json = (await response.json().catch(() => null)) as
        | MonitorPayload
        | null;

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || `Erreur HTTP ${response.status}`);
      }

      setItems(Array.isArray(json.items) ? json.items : []);
      setAcademicYears(
        Array.isArray(json.academic_years) ? json.academic_years : [],
      );
      setAcademicYear(json.academic_year || year || "");
    } catch (cause: any) {
      setError(cause?.message || "Chargement du suivi impossible.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    void loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadClasses(year?: string) {
    try {
      const params = new URLSearchParams({
        education_type: "all",
        limit: "5000",
      });
      if (year) params.set("academic_year", year);
      const response = await fetch(`/api/admin/classes?${params.toString()}`, {
        cache: "no-store",
        credentials: "include",
      });
      const json = await response.json().catch(() => null);
      setClasses(
        response.ok && Array.isArray(json?.items)
          ? (json.items as EducationScopedClass[])
          : [],
      );
    } catch {
      setClasses([]);
    }
  }

  const scopedItems = useMemo(
    () =>
      items.filter((item) =>
        classMatchesEducationScope(
          {
            id: item.class_id,
            label: item.class_label,
            level: item.level,
            education_type: item.education_type,
            formation_code: item.formation_code,
            formation_level_code: item.formation_level_code,
          },
          educationScope,
        ),
      ),
    [educationScope, items],
  );

  const subjects = useMemo(() => {
    const map = new Map<string, string>();
    if (!educationScope.levelCode) return [];
    for (const item of scopedItems) {
      const id = subjectKey(item);
      if (id) map.set(id, item.subject_name);
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [educationScope.levelCode, scopedItems]);

  useEffect(() => {
    if (view !== "subject") return;
    if (!subjects.length) {
      if (subjectId) setSubjectId("");
      return;
    }
    if (!subjectId || !subjects.some((item) => item.id === subjectId)) {
      setSubjectId(subjects[0].id);
    }
  }, [subjectId, subjects, view]);

  const selectedRows = useMemo(() => {
    if (view === "class") {
      return scopedItems.filter(
        (item) => item.class_id === educationScope.classId,
      );
    }
    if (!educationScope.levelCode) return [];
    return scopedItems.filter((item) => subjectKey(item) === subjectId);
  }, [educationScope.classId, educationScope.levelCode, scopedItems, subjectId, view]);

  const tableRows = useMemo(
    () => groupRows(selectedRows, period, view),
    [period, selectedRows, view],
  );

  const summary = useMemo(
    () => combineMetrics(selectedRows, period),
    [period, selectedRows],
  );

  const selectedClass =
    classes.find((item) => item.id === educationScope.classId) || null;
  const selectedSubject = subjects.find((item) => item.id === subjectId) || null;

  function changeAcademicYear(value: string) {
    setAcademicYear(value);
    setEducationScope((current) => ({
      ...current,
      levelCode: "",
      classId: "",
    }));
    setSubjectId("");
    setPeriod("T1");
    const nextScope = { ...educationScope, levelCode: "", classId: "" };
    void load(value, false, nextScope);
    void loadClasses(value);
  }

  function changeEducationScope(value: EducationScopeValue) {
    setEducationScope(value);
    setSubjectId("");
    void load(academicYear, false, value);
  }

  function changeView(value: MonitorView) {
    setView(value);
    setSubjectId("");
    if (value === "subject" && educationScope.classId) {
      const nextScope = { ...educationScope, classId: "" };
      setEducationScope(nextScope);
      void load(academicYear, false, nextScope);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-5 text-slate-900">
        <div className="mx-auto flex max-w-7xl items-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          Chargement du suivi des programmes…
        </div>
      </main>
    );
  }

  const summaryTitle =
    view === "class"
      ? selectedClass
        ? `Exécution moyenne de ${selectedClass.label}`
        : "Exécution moyenne de la classe"
      : selectedSubject
        ? `Exécution moyenne de ${selectedSubject.label} en ${educationScope.levelCode || "ce niveau"}`
        : "Exécution moyenne de la discipline";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <header className="rounded-[24px] border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                Cahier de texte
              </div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                Suivi des programmes
              </h1>
              <p className="mt-1 text-sm font-medium text-slate-500">
                Suivre simplement l’exécution par classe ou par discipline.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load(academicYear, true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Actualiser
            </button>
          </div>
        </header>

        <section className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => changeView("class")}
              className={`flex min-h-[66px] items-center gap-3 rounded-2xl px-4 text-left transition ${
                view === "class"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span
                className={`grid h-10 w-10 place-items-center rounded-xl ${
                  view === "class" ? "bg-white/15" : "bg-white"
                }`}
              >
                <School className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-base font-black">Par classe</span>
                <span className="block text-xs font-semibold opacity-80">
                  Voir tous les enseignants d’une classe
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => changeView("subject")}
              className={`flex min-h-[66px] items-center gap-3 rounded-2xl px-4 text-left transition ${
                view === "subject"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span
                className={`grid h-10 w-10 place-items-center rounded-xl ${
                  view === "subject" ? "bg-white/15" : "bg-white"
                }`}
              >
                <BookOpenCheck className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-base font-black">Par discipline</span>
                <span className="block text-xs font-semibold opacity-80">
                  Comparer la même matière dans un niveau
                </span>
              </span>
            </button>
          </div>
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <EducationScopeFilter
            value={educationScope}
            onChange={changeEducationScope}
            classes={classes}
            showLevel
            showClass={view === "class"}
            title="Contexte du suivi"
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              label="Année scolaire"
              value={academicYear}
              onChange={changeAcademicYear}
            >
              {academicYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Trimestre / période"
              value={period}
              onChange={(value) => setPeriod(value as PeriodFilter)}
            >
              <option value="T1">Trimestre 1</option>
              <option value="T2">Trimestre 2</option>
              <option value="T3">Trimestre 3</option>
              <option value="ALL">Toute l’année</option>
            </SelectField>

            {view === "subject" ? (
              <SelectField
                label="Discipline"
                value={subjectId}
                onChange={setSubjectId}
              >
                {subjects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </SelectField>
            ) : null}
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        ) : null}

        <section className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                {periodLabel(period)}
              </div>
              <h2 className="mt-1 text-lg font-black text-slate-950 sm:text-xl">
                {summaryTitle}
              </h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {view === "class"
                  ? `${tableRows.length} discipline(s) / enseignant(s) affiché(s)`
                  : `${tableRows.length} classe(s) concernée(s)`}
              </p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-black tracking-tight text-emerald-700">
                {summary.completion_rate.toLocaleString("fr-FR", {
                  maximumFractionDigits: 1,
                })}%
              </div>
              <div className="text-xs font-bold text-slate-500">
                taux d’exécution moyen
              </div>
            </div>
          </div>

          {tableRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
                    <th className="px-5 py-3.5 sm:px-6">
                      {view === "class" ? "Discipline" : "Classe"}
                    </th>
                    <th className="px-5 py-3.5">Enseignant</th>
                    <th className="px-5 py-3.5 sm:px-6">Exécution</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row) => (
                    <tr
                      key={row.key}
                      className="border-t border-slate-100 text-sm"
                    >
                      <td className="px-5 py-4 font-black text-slate-950 sm:px-6">
                        {row.primary}
                      </td>
                      <td className="px-5 py-4 font-semibold text-slate-700">
                        {row.teacher}
                      </td>
                      <td className="px-5 py-4 sm:px-6">
                        <ProgressValue value={row.metric.completion_rate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-12 text-center">
              <div className="text-base font-black text-slate-800">
                Aucune progression à afficher
              </div>
              <div className="mt-1 text-sm font-medium text-slate-500">
                Vérifiez la période ou les affectations pédagogiques de cette sélection.
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
