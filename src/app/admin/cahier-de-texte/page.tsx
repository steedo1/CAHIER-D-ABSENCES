"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import EducationScopeFilter from "@/components/admin/EducationScopeFilter";
import {
  ALL_EDUCATION_TYPES,
  classMatchesEducationScope,
  type EducationScopedClass,
  type EducationScopeValue,
} from "@/lib/education-scope";
import {
  combineMetrics,
  groupCards,
  subjectKey,
  type MonitorItem,
  type MonitorView,
  type PeriodFilter,
} from "@/lib/textbook/monitor-cards";
import {
  BookOpenCheck,
  ClipboardList,
  Loader2,
  RefreshCw,
  School,
} from "lucide-react";

type ClassRow = EducationScopedClass & { academic_year?: string | null };
type MonitorPayload = {
  ok: boolean;
  items: MonitorItem[];
  academic_year: string;
  academic_years: string[];
  error?: string;
};
const INITIAL_SCOPE: EducationScopeValue = {
  educationType: ALL_EDUCATION_TYPES,
  formationCode: "",
  levelCode: "",
  classId: "",
};

function formatPercent(value: number) {
  return Number(value || 0).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  }) + " %";
}

function ExecutionRate({
  value,
  available,
}: {
  value: number;
  available: boolean;
}) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="mt-4">
      <div
        className="text-3xl font-black tabular-nums tracking-tight text-emerald-700"
        aria-label={available ? "Taux d’exécution : " + formatPercent(safe) : "Taux d’exécution indisponible"}
      >
        {available ? formatPercent(safe) : "—"}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-emerald-600"
          style={{ width: (available ? safe : 0) + "%" }}
        />
      </div>
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
    <label className="block space-y-1.5">
      <span className="block text-xs font-bold text-slate-600">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      >
        {children}
      </select>
    </label>
  );
}

export default function AdminTextbookPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<MonitorItem[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [academicYears, setAcademicYears] = useState<string[]>([]);
  const [academicYear, setAcademicYear] = useState("");
  const [period, setPeriod] = useState<PeriodFilter>("T1");
  const [view, setView] = useState<MonitorView>("subject");
  const [scope, setScope] = useState<EducationScopeValue>(INITIAL_SCOPE);
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const requestSequence = useRef(0);

  async function loadDashboard(year = "", silent = false) {
    const requestId = ++requestSequence.current;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const monitorParams = new URLSearchParams();
      if (year) monitorParams.set("academic_year", year);
      // One institutional summary request. Switching subject/class/period is local.
      const classParams = new URLSearchParams({ education_type: "all", limit: "5000" });
      if (year) classParams.set("academic_year", year);
      const [monitorResponse, classesResponse] = await Promise.all([
        fetch("/api/admin/textbook/monitor?" + monitorParams.toString(), {
          cache: "no-store",
          credentials: "include",
        }),
        fetch("/api/admin/classes?" + classParams.toString(), {
          cache: "no-store",
          credentials: "include",
        }),
      ]);
      const [monitor, classData] = await Promise.all([
        monitorResponse.json().catch(() => null) as Promise<MonitorPayload | null>,
        classesResponse.json().catch(() => null),
      ]);
      if (!monitorResponse.ok || !monitor?.ok) {
        throw new Error(monitor?.error || "Impossible de charger le suivi pédagogique.");
      }
      if (requestId !== requestSequence.current) return;
      setItems(Array.isArray(monitor.items) ? monitor.items : []);
      setAcademicYears(Array.isArray(monitor.academic_years) ? monitor.academic_years : []);
      setAcademicYear(monitor.academic_year || year);
      setClasses(
        classesResponse.ok && Array.isArray(classData?.items)
          ? (classData.items as ClassRow[])
          : [],
      );
    } catch (cause: unknown) {
      if (requestId !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void loadDashboard();
    // The dashboard only reads on mount, explicit year change, or manual refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scopedItems = useMemo(
    () => items.filter((item) =>
      classMatchesEducationScope(
        {
          id: item.class_id,
          label: item.class_label,
          level: item.level,
          education_type: item.education_type as EducationScopedClass["education_type"],
          formation_code: item.formation_code,
          formation_level_code: item.formation_level_code,
        },
        scope,
      )),
    [items, scope],
  );

  const subjectChoices = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of scopedItems) {
      const key = subjectKey(item);
      if (key) byId.set(key, item.subject_name);
    }
    return Array.from(byId.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));
  }, [scopedItems]);

  const classChoices = useMemo(() =>
    classes
      .filter((row) =>
        (!row.academic_year || row.academic_year === academicYear) &&
        classMatchesEducationScope(row, scope),
      )
      .map((row) => ({ id: row.id, label: row.label || row.name || "Classe" }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true })),
    [classes, scope, academicYear],
  );

  const activeSubjectId = subjectChoices.some((subject) => subject.id === subjectId)
    ? subjectId
    : subjectChoices[0]?.id || "";
  const activeClassId = classChoices.some((row) => row.id === classId)
    ? classId
    : classChoices[0]?.id || "";

  const selectedItems = useMemo(() => (
    view === "class"
      ? scopedItems.filter((item) => item.class_id === activeClassId)
      : scopedItems.filter((item) => subjectKey(item) === activeSubjectId)
  ), [view, scopedItems, activeClassId, activeSubjectId]);

  const cards = useMemo(
    () => groupCards(selectedItems, period, view),
    [selectedItems, period, view],
  );
  const summary = useMemo(
    () => combineMetrics(selectedItems, period),
    [selectedItems, period],
  );

  const chosenTitle = view === "class"
    ? classChoices.find((row) => row.id === activeClassId)?.label || "la classe"
    : subjectChoices.find((row) => row.id === activeSubjectId)?.label || "la matière";

  async function synchronizeAssignments() {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const response = await fetch("/api/teacher/textbook/sync", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academic_year: academicYear }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Synchronisation impossible.");
      await loadDashboard(academicYear, true);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Synchronisation impossible.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                Cahier de textes
              </div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                Suivi pédagogique
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Taux d’exécution par classe ou par matière.
              </p>
            </div>
            <button
              type="button"
              disabled={refreshing || loading || syncing}
              onClick={() => void loadDashboard(academicYear, true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              <RefreshCw className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")} />
              Actualiser
            </button>
          </div>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            {(["subject", "class"] as MonitorView[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                aria-pressed={view === mode}
                className={"flex min-h-16 items-center gap-3 rounded-2xl px-4 text-left transition " +
                  (view === mode
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-50 text-slate-700 hover:bg-slate-100")}
              >
                {mode === "subject" ? <BookOpenCheck className="h-6 w-6 shrink-0" /> : <School className="h-6 w-6 shrink-0" />}
                <span>
                  <span className="block font-black">{mode === "subject" ? "Par matière" : "Par classe"}</span>
                  <span className="block text-xs font-medium opacity-80">
                    {mode === "subject" ? "Toutes les classes de la matière" : "Toutes les matières de la classe"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <EducationScopeFilter
            value={scope}
            onChange={setScope}
            classes={classes}
            allowAllEducationTypes
            showLevel={false}
            showClass={false}
            title="Enseignement"
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              label="Année scolaire"
              value={academicYear}
              onChange={(year) => {
                setAcademicYear(year);
                setClassId("");
                setSubjectId("");
                setPeriod("T1");
                void loadDashboard(year);
              }}
            >
              {academicYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </SelectField>
            <SelectField
              label={view === "class" ? "Classe" : "Matière"}
              value={view === "class" ? activeClassId : activeSubjectId}
              onChange={view === "class" ? setClassId : setSubjectId}
            >
              {(view === "class" ? classChoices : subjectChoices).length === 0
                ? <option value="">Aucune sélection disponible</option>
                : (view === "class" ? classChoices : subjectChoices).map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
            </SelectField>
            <SelectField label="Période" value={period} onChange={(value) => setPeriod(value as PeriodFilter)}>
              <option value="T1">Trimestre 1</option>
              <option value="T2">Trimestre 2</option>
              <option value="T3">Trimestre 3</option>
              <option value="ALL">Année scolaire</option>
            </SelectField>
          </div>
        </section>

        {error ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-3 rounded-2xl border bg-white p-6 text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin" /> Chargement du suivi…
          </div>
        ) : (
          <>
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div>
                <h2 className="text-lg font-black text-slate-950">
                  {view === "class" ? "Matières de " : "Classes en "}{chosenTitle}
                </h2>
                <p className="text-sm text-slate-600">
                  {period === "ALL" ? "Année scolaire" : "Trimestre " + period.slice(1)}
                </p>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold text-slate-500">Taux global d’exécution</div>
                <div className="text-2xl font-black tabular-nums text-emerald-700">
                  {summary.expected_items > 0 || summary.planned_minutes > 0
                    ? formatPercent(summary.completion_rate)
                    : "—"}
                </div>
              </div>
            </section>

            {cards.length ? (
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {cards.map((card) => (
                  <article
                    key={card.key}
                    className="min-w-0 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
                  >
                    <h3 className="break-words text-lg font-black text-slate-950">
                      {card.title}
                    </h3>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-600">
                      {card.teacher}
                    </p>
                    <ExecutionRate
                      value={card.metric.completion_rate}
                      available={card.metric.planned_minutes > 0 || card.metric.expected_items > 0}
                    />
                  </article>
                ))}
              </section>
            ) : (
              <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center">
                <ClipboardList className="mx-auto mb-3 h-7 w-7 text-slate-400" />
                <h2 className="font-black text-slate-800">Aucune progression affectée pour cette sélection</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Les classes ou disciplines sans progression affectée ne possèdent pas encore de taux calculable.
                </p>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void synchronizeAssignments()}
                  className="mt-4 min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
                >
                  {syncing ? "Synchronisation…" : "Synchroniser les affectations pédagogiques"}
                </button>
              </section>
            )}

            {cards.length ? (
              <div className="text-right">
                <button
                  type="button"
                  disabled={syncing || refreshing}
                  onClick={() => void synchronizeAssignments()}
                  className="text-xs font-bold text-slate-500 underline underline-offset-2 disabled:opacity-50"
                >
                  {syncing ? "Synchronisation…" : "Mettre à jour les affectations pédagogiques"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
