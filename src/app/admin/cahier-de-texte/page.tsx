"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  GraduationCap,
  Layers3,
  Loader2,
  RefreshCw,
  School,
  Users,
} from "lucide-react";

type PeriodCode = "T1" | "T2" | "T3";
type PeriodFilter = "ALL" | PeriodCode;
type MonitorTab = "overview" | "levels" | "classes" | "subjects" | "teachers";

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

type Aggregate = Metric & {
  key: string;
  label: string;
  detail: string;
  rows: MonitorItem[];
};

const TABS: Array<{
  id: MonitorTab;
  label: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}> = [
  { id: "overview", label: "Vue d’ensemble", Icon: BarChart3 },
  { id: "levels", label: "Niveaux", Icon: Layers3 },
  { id: "classes", label: "Classes", Icon: School },
  { id: "subjects", label: "Disciplines", Icon: BookOpenCheck },
  { id: "teachers", label: "Enseignants", Icon: Users },
];

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function pct(done: number, total: number) {
  if (!total) return 0;
  return Math.round((done / total) * 1000) / 10;
}

function metricFor(item: MonitorItem, period: PeriodFilter): Metric {
  return period === "ALL" ? item : item.periods?.[period] || {
    expected_items: 0,
    completed_items: 0,
    planned_minutes: 0,
    completed_planned_minutes: 0,
    completion_rate: 0,
    sessions_count: 0,
    realized_minutes: 0,
    realized_hours: 0,
  };
}

function aggregateRows(
  rows: MonitorItem[],
  keyOf: (row: MonitorItem) => string,
  labelOf: (row: MonitorItem) => string,
  detailOf: (rows: MonitorItem[]) => string,
  period: PeriodFilter,
): Aggregate[] {
  const groups = new Map<string, MonitorItem[]>();

  for (const row of rows) {
    const key = keyOf(row) || "non-renseigne";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const totals = group.reduce(
        (acc, item) => {
          const metric = metricFor(item, period);
          acc.expected_items += metric.expected_items;
          acc.completed_items += metric.completed_items;
          acc.planned_minutes += metric.planned_minutes;
          acc.completed_planned_minutes += metric.completed_planned_minutes;
          acc.sessions_count += metric.sessions_count;
          acc.realized_minutes += metric.realized_minutes;
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
        key,
        label: labelOf(group[0]),
        detail: detailOf(group),
        rows: group,
        ...totals,
        completion_rate: totals.planned_minutes
          ? pct(totals.completed_planned_minutes, totals.planned_minutes)
          : pct(totals.completed_items, totals.expected_items),
        realized_hours:
          Math.round((totals.realized_minutes / 60) * 10) / 10,
      };
    })
    .sort((a, b) =>
      a.label.localeCompare(b.label, "fr", { numeric: true }),
    );
}

function ProgressBar({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-emerald-600 transition-all"
        style={{ width: `${safe}%` }}
      />
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
  const [academicYears, setAcademicYears] = useState<string[]>([]);
  const [academicYear, setAcademicYear] = useState("");
  const [period, setPeriod] = useState<PeriodFilter>("ALL");
  const [level, setLevel] = useState("");
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [activeTab, setActiveTab] = useState<MonitorTab>("overview");

  async function load(year?: string, silent = false) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (year) params.set("academic_year", year);
      const query = params.toString();
      const response = await fetch(
        `/api/admin/textbook/monitor${query ? `?${query}` : ""}`,
        {
          cache: "no-store",
          credentials: "include",
        },
      );
      const json = (await response.json().catch(() => null)) as
        | MonitorPayload
        | null;

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || `Erreur HTTP ${response.status}`);
      }

      setItems(Array.isArray(json.items) ? json.items : []);
      setAcademicYears(Array.isArray(json.academic_years) ? json.academic_years : []);
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
  }, []);

  const levels = useMemo(
    () =>
      unique(
        items
          .map((item) => String(item.level || "").trim())
          .filter(Boolean),
      ).sort((a, b) => a.localeCompare(b, "fr", { numeric: true })),
    [items],
  );

  const classes = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.class_id) map.set(item.class_id, item.class_label);
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, "fr", { numeric: true }),
      );
  }, [items]);

  const subjects = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      const id = item.subject_id || item.subject_name;
      if (id) map.set(String(id), item.subject_name);
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [items]);

  const teachers = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.teacher_id) map.set(item.teacher_id, item.teacher_name);
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        if (level && String(item.level || "") !== level) return false;
        if (classId && item.class_id !== classId) return false;
        if (
          subjectId &&
          String(item.subject_id || item.subject_name) !== subjectId
        ) {
          return false;
        }
        if (teacherId && item.teacher_id !== teacherId) return false;
        return true;
      }),
    [items, level, classId, subjectId, teacherId],
  );

  const totals = useMemo(() => {
    const values = filtered.reduce(
      (acc, item) => {
        const metric = metricFor(item, period);
        acc.expected += metric.expected_items;
        acc.completed += metric.completed_items;
        acc.planned += metric.planned_minutes;
        acc.completedPlanned += metric.completed_planned_minutes;
        acc.sessions += metric.sessions_count;
        acc.realized += metric.realized_minutes;
        acc.classes.add(item.class_id);
        return acc;
      },
      {
        expected: 0,
        completed: 0,
        planned: 0,
        completedPlanned: 0,
        sessions: 0,
        realized: 0,
        classes: new Set<string>(),
      },
    );

    return {
      completionRate: values.planned
        ? pct(values.completedPlanned, values.planned)
        : pct(values.completed, values.expected),
      classes: values.classes.size,
      sessions: values.sessions,
      realizedHours: Math.round((values.realized / 60) * 10) / 10,
    };
  }, [filtered, period]);

  const groupedRows = useMemo(() => {
    if (activeTab === "levels") {
      return aggregateRows(
        filtered,
        (row) => String(row.level || "Niveau non renseigné"),
        (row) => String(row.level || "Niveau non renseigné"),
        (rows) =>
          `${unique(rows.map((row) => row.class_label)).length} classe(s) · ${unique(
            rows.map((row) => row.subject_name),
          ).length} discipline(s)`,
        period,
      );
    }
    if (activeTab === "classes") {
      return aggregateRows(
        filtered,
        (row) => row.class_id,
        (row) => row.class_label,
        (rows) =>
          unique(
            rows.map(
              (row) => `${row.subject_name} · ${row.teacher_name}`,
            ),
          ).join(" • "),
        period,
      );
    }
    if (activeTab === "subjects") {
      return aggregateRows(
        filtered,
        (row) => String(row.subject_id || row.subject_name),
        (row) => row.subject_name,
        (rows) =>
          `${unique(rows.map((row) => row.class_label)).length} classe(s) · ${unique(
            rows.map((row) => row.teacher_name),
          ).length} enseignant(s)`,
        period,
      );
    }
    if (activeTab === "teachers") {
      return aggregateRows(
        filtered,
        (row) => String(row.teacher_id || row.teacher_name),
        (row) => row.teacher_name,
        (rows) =>
          unique(
            rows.map((row) => `${row.subject_name} · ${row.class_label}`),
          ).join(" • "),
        period,
      );
    }
    return [];
  }, [activeTab, filtered, period]);

  function changeAcademicYear(value: string) {
    setAcademicYear(value);
    setLevel("");
    setClassId("");
    setSubjectId("");
    setTeacherId("");
    setPeriod("ALL");
    void load(value);
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

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
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
                Voir l’exécution du programme, sans gérer les affectations manuellement.
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

        <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
              label="Trimestre"
              value={period}
              onChange={(value) => setPeriod(value as PeriodFilter)}
            >
              <option value="ALL">Toute l’année</option>
              <option value="T1">T1</option>
              <option value="T2">T2</option>
              <option value="T3">T3</option>
            </SelectField>

            <SelectField label="Niveau" value={level} onChange={setLevel}>
              <option value="">Tous</option>
              {levels.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </SelectField>

            <SelectField label="Classe" value={classId} onChange={setClassId}>
              <option value="">Toutes</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Discipline"
              value={subjectId}
              onChange={setSubjectId}
            >
              <option value="">Toutes</option>
              {subjects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Enseignant"
              value={teacherId}
              onChange={setTeacherId}
            >
              <option value="">Tous</option>
              {teachers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </SelectField>
          </div>
        </section>

        <nav className="grid gap-2 rounded-[24px] border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex min-h-[64px] items-center gap-3 rounded-2xl px-4 py-3 text-left transition ${
                activeTab === id
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                  activeTab === id ? "bg-white/15" : "bg-white"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-black">{label}</span>
            </button>
          ))}
        </nav>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Avancement
            </div>
            <div className="mt-3 text-3xl font-black text-slate-950">
              {totals.completionRate}%
            </div>
            <div className="mt-3">
              <ProgressBar value={totals.completionRate} />
            </div>
          </div>

          <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
              <GraduationCap className="h-4 w-4 text-sky-600" />
              Classes suivies
            </div>
            <div className="mt-3 text-3xl font-black text-slate-950">
              {totals.classes}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-500">
              selon les affectations pédagogiques
            </div>
          </div>

          <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
              <Clock3 className="h-4 w-4 text-violet-600" />
              Séances réalisées
            </div>
            <div className="mt-3 text-3xl font-black text-slate-950">
              {totals.sessions}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-500">
              {totals.realizedHours} h enregistrées
            </div>
          </div>
        </section>

        {activeTab === "overview" ? (
          <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-black text-slate-950">
                Exécution par classe et discipline
              </h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                La discipline affichée est celle réellement enseignée dans la classe.
              </p>
            </div>

            {filtered.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Classe</th>
                      <th className="px-4 py-3">Discipline</th>
                      <th className="px-4 py-3">Enseignant</th>
                      <th className="px-4 py-3">Avancement</th>
                      <th className="px-4 py-3 text-center">Séances</th>
                      <th className="px-4 py-3 text-right">Heures</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((item) => {
                      const metric = metricFor(item, period);
                      return (
                        <tr key={item.assignment_id} className="hover:bg-slate-50/70">
                          <td className="px-5 py-4">
                            <div className="font-black text-slate-950">
                              {item.class_label}
                            </div>
                            <div className="mt-0.5 text-xs font-semibold text-slate-400">
                              {item.level || "—"}
                            </div>
                          </td>
                          <td className="px-4 py-4 font-bold text-slate-800">
                            {item.subject_name}
                          </td>
                          <td className="px-4 py-4 font-semibold text-slate-600">
                            {item.teacher_name}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-24">
                                <ProgressBar value={metric.completion_rate} />
                              </div>
                              <span className="font-black text-slate-900">
                                {metric.completion_rate}%
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center font-black text-slate-800">
                            {metric.sessions_count}
                          </td>
                          <td className="px-4 py-4 text-right font-black text-slate-800">
                            {metric.realized_hours} h
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-6 py-12 text-center text-sm font-semibold text-slate-500">
                Aucun suivi ne correspond à cette sélection.
              </div>
            )}
          </section>
        ) : (
          <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-black text-slate-950">
                {TABS.find((tab) => tab.id === activeTab)?.label}
              </h2>
            </div>

            {groupedRows.length ? (
              <div className="divide-y divide-slate-100">
                {groupedRows.map((group) => (
                  <article
                    key={group.key}
                    className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(220px,1fr)_minmax(260px,1.4fr)_180px_110px_110px] lg:items-center"
                  >
                    <div>
                      <div className="text-base font-black text-slate-950">
                        {group.label}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold text-slate-500">
                        {group.detail}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500">
                        <span>Exécution</span>
                        <span className="text-slate-900">
                          {group.completion_rate}%
                        </span>
                      </div>
                      <ProgressBar value={group.completion_rate} />
                    </div>
                    <div className="text-sm font-bold text-slate-600">
                      {group.completed_items}/{group.expected_items} étapes
                    </div>
                    <div className="text-sm font-black text-slate-900">
                      {group.sessions_count} séance(s)
                    </div>
                    <div className="text-sm font-black text-slate-900">
                      {group.realized_hours} h
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="px-6 py-12 text-center text-sm font-semibold text-slate-500">
                Aucun résultat pour cette sélection.
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
