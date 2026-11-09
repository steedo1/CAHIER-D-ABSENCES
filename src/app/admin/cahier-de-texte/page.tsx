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
  type MonitorCard,
  type MonitorItem,
  type MonitorView,
  type PeriodFilter,
} from "@/lib/textbook/monitor-cards";
import {
  BookOpenCheck,
  ChevronDown,
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
type Session = {
  id: string;
  assignment_id: string;
  session_title: string;
  session_date: string;
  duration_minutes: number;
  content?: string | null;
  homework?: string | null;
  observations?: string | null;
};
type DetailState = {
  key: string;
  loading: boolean;
  error: string | null;
  sessions: Session[];
  limited: boolean;
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

function RateLine({
  label,
  rate,
  numerator,
  denominator,
  tone,
  unit,
}: {
  label: string;
  rate: number;
  numerator: number;
  denominator: number;
  tone: "green" | "blue";
  unit: string;
}) {
  const safe = Math.max(0, Math.min(100, Number(rate) || 0));
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-slate-600">{label}</span>
        <span className="font-black tabular-nums text-slate-900">
          {denominator > 0 ? formatPercent(safe) : "—"}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={denominator > 0 ? safe : undefined}
        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
      >
        <div
          className={"h-full rounded-full " + (tone === "green" ? "bg-emerald-600" : "bg-sky-600")}
          style={{ width: String(denominator > 0 ? safe : 0) + "%" }}
        />
      </div>
      <div className="mt-1 text-xs font-medium text-slate-500">
        {denominator > 0
          ? String(numerator) + " / " + String(denominator) + " " + unit
          : "Aucune prévision renseignée"}
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
  const [detail, setDetail] = useState<DetailState | null>(null);
  const requestSequence = useRef(0);
  const detailSequence = useRef(0);

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

  useEffect(() => {
    ++detailSequence.current;
    setDetail(null);
  }, [view, period, activeSubjectId, activeClassId, scope]);

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

  async function toggleDetails(card: MonitorCard) {
    if (detail?.key === card.key) {
      ++detailSequence.current;
      setDetail(null);
      return;
    }
    const token = ++detailSequence.current;
    setDetail({ key: card.key, loading: true, error: null, sessions: [], limited: false });
    try {
      const ids = Array.from(new Set(card.assignments.map((row) => row.assignment_id)));
      const params = new URLSearchParams({ assignment_ids: ids.join(",") });
      const response = await fetch("/api/admin/textbook/details?" + params.toString(), {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Séances indisponibles.");
      if (token === detailSequence.current) {
        setDetail({
          key: card.key,
          loading: false,
          error: null,
          sessions: Array.isArray(data.sessions) ? data.sessions : [],
          limited: Boolean(data.limited),
        });
      }
    } catch (cause: unknown) {
      if (token === detailSequence.current) {
        setDetail({
          key: card.key,
          loading: false,
          error: cause instanceof Error ? cause.message : "Séances indisponibles.",
          sessions: [],
          limited: false,
        });
      }
    }
  }

  const selectedCard = cards.find((card) => card.key === detail?.key);

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
                Progression des enseignements et séances consignées, par classe ou par matière.
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
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-950">
                    {view === "class" ? "Matières de " : "Classes en "}{chosenTitle}
                  </h2>
                  <p className="text-sm text-slate-600">
                    {cards.length} carte(s) · {period === "ALL" ? "Année scolaire" : "Trimestre " + period.slice(1)}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700">
                  {summary.expected_items > 0 || summary.planned_minutes > 0
                    ? formatPercent(summary.completion_rate)
                    : "Progression non définie"}
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <RateLine
                  label="Avancement des progressions"
                  rate={summary.completion_rate}
                  numerator={summary.planned_minutes ? summary.completed_planned_minutes : summary.completed_items}
                  denominator={summary.planned_minutes || summary.expected_items}
                  tone="green"
                  unit={summary.planned_minutes ? "min" : "éléments"}
                />
                <RateLine
                  label="Séances consignées / prévues"
                  rate={summary.recording_rate}
                  numerator={summary.sessions_count}
                  denominator={summary.planned_sessions_count}
                  tone="blue"
                  unit="séances"
                />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-slate-500">
                Le premier taux suit les éléments de progression terminés (pondérés par leur durée prévue).
                Le second compare les séances enregistrées aux séances prévues par la progression.
                Ces indicateurs ne certifient pas la tenue effective des créneaux.
              </p>
            </section>

            {cards.length ? (
              <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {cards.map((card) => (
                  <button
                    key={card.key}
                    type="button"
                    aria-expanded={detail?.key === card.key}
                    onClick={() => void toggleDetails(card)}
                    className={"min-w-0 rounded-3xl border bg-white p-5 text-left shadow-sm transition hover:border-emerald-400 hover:shadow-md " +
                      (detail?.key === card.key ? "border-emerald-500 ring-2 ring-emerald-100" : "border-slate-200")}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words text-lg font-black text-slate-950">{card.title}</h3>
                        <p className="mt-1 break-words text-sm font-semibold text-slate-600">
                          {card.teacher}
                        </p>
                      </div>
                      <ChevronDown className={"mt-1 h-5 w-5 shrink-0 text-slate-500 transition " +
                        (detail?.key === card.key ? "rotate-180" : "")} />
                    </div>
                    <div className="space-y-4">
                      <RateLine
                        label="Progression exécutée"
                        rate={card.metric.completion_rate}
                        numerator={card.metric.planned_minutes ? card.metric.completed_planned_minutes : card.metric.completed_items}
                        denominator={card.metric.planned_minutes || card.metric.expected_items}
                        tone="green"
                        unit={card.metric.planned_minutes ? "min" : "éléments"}
                      />
                      <RateLine
                        label="Séances consignées"
                        rate={card.metric.recording_rate}
                        numerator={card.metric.sessions_count}
                        denominator={card.metric.planned_sessions_count}
                        tone="blue"
                        unit="séances"
                      />
                    </div>
                    <div className="mt-4 border-t border-slate-100 pt-3 text-xs font-bold text-emerald-700">
                      {detail?.key === card.key ? "Masquer les séances" : "Voir les séances"}
                    </div>
                  </button>
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

            {detail && selectedCard ? (
              <section className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-black text-slate-950">
                  Séances enregistrées — {selectedCard.title}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedCard.teacher} · dernières séances, toutes périodes confondues
                </p>
                {detail.loading ? (
                  <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin" /> Chargement des séances…
                  </div>
                ) : detail.error ? (
                  <p role="alert" className="mt-4 text-sm font-bold text-rose-700">{detail.error}</p>
                ) : detail.sessions.length ? (
                  <div className="mt-4 space-y-3">
                    {detail.sessions.map((session) => (
                      <article key={session.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-bold text-slate-900">{session.session_title || "Séance"}</h3>
                          <span className="text-xs font-semibold text-slate-600">
                            {session.session_date} · {session.duration_minutes} min
                          </span>
                        </div>
                        {session.content ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                            <strong>Contenu : </strong>{session.content}
                          </p>
                        ) : null}
                        {session.homework ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                            <strong>Travail à faire : </strong>{session.homework}
                          </p>
                        ) : null}
                        {session.observations ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                            <strong>Observations : </strong>{session.observations}
                          </p>
                        ) : null}
                      </article>
                    ))}
                    {detail.limited ? <p className="text-xs text-slate-500">Affichage limité aux 40 séances les plus récentes.</p> : null}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-600">Aucune séance saisie pour cette carte.</p>
                )}
              </section>
            ) : null}
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
