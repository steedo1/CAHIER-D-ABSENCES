"use client";

import Link from "next/link";
import React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Grid3X3,
  Loader2,
  RefreshCw,
  School,
  UserRound,
} from "lucide-react";

type Assignment = {
  id?: string;
  class_id?: string;
  class_label?: string;
  teacher_id?: string;
  teacher_name?: string;
  subject_id?: string;
  subject_label?: string;
  scheduler_subject_id?: string;
  weekday?: number;
  period_no?: number;
  period_label?: string;
  start_time?: string | null;
  end_time?: string | null;
  duration_units?: number;
  duration_min?: number;
  room_id?: string | null;
  room_label?: string | null;
  source?: string;
  tandem_group_id?: string | null;
  tandem_role?: string | null;
  tandem_mode?: string | null;
};

type EngineResult = {
  status?: string;
  generated_at?: string;
  summary?: {
    assignments_count?: number;
    placements_count?: number;
    unplaced_count?: number;
    score?: number;
  };
  assignments?: Assignment[];
  unplaced?: Assignment[];
  diagnostics?: Array<{ level?: string; message?: string }>;
};

type Project = {
  id: string;
  name: string;
  status: "draft" | "ready" | "published" | "archived";
  engine_result?: EngineResult | null;
  diagnostics?: Array<{ level?: string; message?: string }>;
  created_at: string;
  updated_at: string;
};

type ProjectResponse =
  | { ok: true; item: Project }
  | { ok: false; error: string; message?: string };

type ViewMode = "class" | "teacher";

const WEEKDAYS: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  7: "Dimanche",
};

function formatDate(value?: string) {
  if (!value) return "—";

  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function clean(value: unknown, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function dayLabel(value?: number) {
  const day = Number(value || 0);
  return WEEKDAYS[day] || `Jour ${day || "?"}`;
}

function timeLabel(item: Assignment) {
  if (item.start_time && item.end_time) return `${item.start_time} - ${item.end_time}`;
  return item.period_label || `Créneau ${item.period_no || "?"}`;
}

function sortAssignments(items: Assignment[]) {
  return [...items].sort((a, b) => {
    const aw = Number(a.weekday || 0);
    const bw = Number(b.weekday || 0);
    if (aw !== bw) return aw - bw;

    const ap = Number(a.period_no || 0);
    const bp = Number(b.period_no || 0);
    if (ap !== bp) return ap - bp;

    return clean(a.subject_label).localeCompare(clean(b.subject_label));
  });
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function getTargetLabel(item: Assignment, mode: ViewMode) {
  return mode === "class" ? clean(item.class_label, "Classe") : clean(item.teacher_name, "Enseignant");
}

function getSecondaryLabel(item: Assignment, mode: ViewMode) {
  return mode === "class" ? clean(item.teacher_name, "Enseignant") : clean(item.class_label, "Classe");
}

function groupTargets(items: Assignment[], mode: ViewMode) {
  const map = new Map<string, Assignment[]>();

  for (const item of items) {
    const label = getTargetLabel(item, mode);
    const current = map.get(label) || [];
    current.push(item);
    map.set(label, current);
  }

  return Array.from(map.entries())
    .map(([label, values]) => ({ label, items: sortAssignments(values) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function getDays(items: Assignment[]) {
  return uniqueBy(
    items
      .filter((item) => Number(item.weekday || 0) >= 1)
      .map((item) => Number(item.weekday)),
    (day) => String(day),
  ).sort((a, b) => a - b);
}

function getPeriods(items: Assignment[]) {
  return uniqueBy(
    items
      .filter((item) => Number(item.period_no || 0) > 0)
      .map((item) => ({
        period_no: Number(item.period_no || 0),
        label: item.period_label || `Créneau ${item.period_no}`,
        start_time: item.start_time || "",
        end_time: item.end_time || "",
      })),
    (item) => String(item.period_no),
  ).sort((a, b) => {
    if (a.period_no !== b.period_no) return a.period_no - b.period_no;
    return a.start_time.localeCompare(b.start_time);
  });
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
    </div>
  );
}

function CourseCard({ item, mode }: { item: Assignment; mode: ViewMode }) {
  const isTandem = Boolean(item.tandem_group_id || item.tandem_role || item.tandem_mode);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-slate-950">{clean(item.subject_label, "Matière")}</p>
          <p className="mt-1 truncate text-xs font-semibold text-slate-600">
            {getSecondaryLabel(item, mode)}
          </p>
        </div>
        {item.duration_units && Number(item.duration_units) > 1 ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">
            {item.duration_units} créneaux
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {item.room_label || item.room_id ? (
          <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700">
            {clean(item.room_label || item.room_id, "Salle")}
          </span>
        ) : null}
        {isTandem ? (
          <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">
            Tandem {item.tandem_mode || ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TimetableGrid({ items, mode }: { items: Assignment[]; mode: ViewMode }) {
  const days = getDays(items);
  const periods = getPeriods(items);

  if (days.length === 0 || periods.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
        Impossible de construire la grille : jours ou créneaux manquants dans le résultat.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-950 text-white">
              <th className="w-40 border-r border-white/10 px-4 py-4 text-left text-xs font-black uppercase tracking-wide">
                Créneau
              </th>
              {days.map((day) => (
                <th key={day} className="min-w-44 border-r border-white/10 px-4 py-4 text-left text-xs font-black uppercase tracking-wide">
                  {dayLabel(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => (
              <tr key={period.period_no} className="border-b border-slate-100 align-top">
                <td className="border-r border-slate-100 bg-slate-50 px-4 py-4">
                  <p className="font-black text-slate-950">{period.label}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {period.start_time && period.end_time ? `${period.start_time} - ${period.end_time}` : "Horaire non renseigné"}
                  </p>
                </td>
                {days.map((day) => {
                  const cellItems = items.filter(
                    (item) => Number(item.weekday || 0) === day && Number(item.period_no || 0) === period.period_no,
                  );

                  return (
                    <td key={`${day}-${period.period_no}`} className="border-r border-slate-100 px-3 py-3">
                      {cellItems.length === 0 ? (
                        <div className="min-h-20 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70" />
                      ) : (
                        <div className="space-y-2">
                          {cellItems.map((item, index) => (
                            <CourseCard key={`${item.id || index}-${day}-${period.period_no}`} item={item} mode={mode} />
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListView({ groups, mode }: { groups: Array<{ label: string; items: Assignment[] }>; mode: ViewMode }) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.label} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="font-black text-slate-950">{group.label}</p>
            <p className="text-xs font-semibold text-slate-500">
              {group.items.length} ligne{group.items.length > 1 ? "s" : ""}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-white">
                <tr className="text-left text-xs font-black uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Jour</th>
                  <th className="px-4 py-3">Heure</th>
                  <th className="px-4 py-3">Matière</th>
                  <th className="px-4 py-3">{mode === "class" ? "Enseignant" : "Classe"}</th>
                  <th className="px-4 py-3">Salle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {group.items.map((item, index) => (
                  <tr key={`${group.label}-${item.id || index}`} className="bg-white">
                    <td className="px-4 py-3 font-bold">{dayLabel(item.weekday)}</td>
                    <td className="px-4 py-3 text-slate-600">{timeLabel(item)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-950">{clean(item.subject_label, "Matière")}</td>
                    <td className="px-4 py-3 text-slate-700">{getSecondaryLabel(item, mode)}</td>
                    <td className="px-4 py-3 text-slate-500">{clean(item.room_label || item.room_id, "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MontageProjectPreview({ projectId }: { projectId: string }) {
  const [project, setProject] = React.useState<Project | null>(null);
  const [mode, setMode] = React.useState<ViewMode>("class");
  const [display, setDisplay] = React.useState<"grid" | "list">("grid");
  const [selectedTarget, setSelectedTarget] = React.useState<string>("all");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/projects/${projectId}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ProjectResponse | null;

      if (!json) {
        setError("Réponse serveur invalide.");
        return;
      }

      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }

      setProject(json.item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger l’aperçu.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const result = project?.engine_result || null;
  const assignments = Array.isArray(result?.assignments) ? result.assignments : [];
  const unplaced = Array.isArray(result?.unplaced) ? result.unplaced : [];
  const diagnostics = Array.isArray(result?.diagnostics)
    ? result.diagnostics
    : Array.isArray(project?.diagnostics)
      ? project?.diagnostics || []
      : [];

  const groups = React.useMemo(() => groupTargets(assignments, mode), [assignments, mode]);

  React.useEffect(() => {
    setSelectedTarget("all");
  }, [mode, project?.id]);

  const visibleItems = React.useMemo(() => {
    if (selectedTarget === "all") return sortAssignments(assignments);
    return sortAssignments(assignments.filter((item) => getTargetLabel(item, mode) === selectedTarget));
  }, [assignments, mode, selectedTarget]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/admin/montage-emploi-du-temps" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-slate-950">
            <ArrowLeft className="h-4 w-4" />
            Retour au montage
          </Link>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Recharger
          </button>
        </div>

        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 shadow-xl">
          <div className="relative p-6 sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.20),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.17),transparent_32%)]" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-sky-100">
                <CalendarDays className="h-4 w-4" />
                Grille HoraClasse
              </div>
              <h1 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">
                {project?.name || "Emploi du temps généré"}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                Aperçu en grille par classe ou par enseignant, avec matières, horaires, salle et informations de bloc.
              </p>
              {project && (
                <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
                  <span className="rounded-full bg-white px-3 py-1 text-slate-950">Statut : {project.status}</span>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200 ring-1 ring-white/10">Modifié le {formatDate(project.updated_at)}</span>
                  {result?.generated_at ? (
                    <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200 ring-1 ring-white/10">Généré le {formatDate(result.generated_at)}</span>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700 shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement de l’aperçu...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-black">Impossible de charger l’aperçu</p>
                <p className="mt-1 text-sm">{error}</p>
              </div>
            </div>
          </div>
        )}

        {!loading && project && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatBox label="Cours placés" value={result?.summary?.assignments_count ?? assignments.length} />
              <StatBox label="Blocs non placés" value={result?.summary?.unplaced_count ?? unplaced.length} />
              <StatBox label="Score" value={`${result?.summary?.score ?? 0}%`} />
              <StatBox label="Moteur" value={result?.status === "generated_real_scheduler" ? "HoraClasse" : "En attente"} />
            </div>

            {assignments.length === 0 ? (
              <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
                <div className="flex items-start gap-3">
                  <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-black">Aucun emploi du temps généré</p>
                    <p className="mt-1 text-sm">Retourne sur la page Montage emploi du temps, puis clique sur “Générer avec HoraClasse”.</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <h2 className="flex items-center gap-2 text-xl font-black">
                      <Grid3X3 className="h-5 w-5 text-slate-500" />
                      Aperçu emploi du temps
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      La grille utilise les créneaux administratifs et le résultat retourné par HoraClasse.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      value={selectedTarget}
                      onChange={(event) => setSelectedTarget(event.target.value)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    >
                      <option value="all">Tous</option>
                      {groups.map((group) => (
                        <option key={group.label} value={group.label}>
                          {group.label}
                        </option>
                      ))}
                    </select>

                    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => setMode("class")}
                        className={[
                          "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition",
                          mode === "class" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950",
                        ].join(" ")}
                      >
                        <School className="h-4 w-4" />
                        Par classe
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("teacher")}
                        className={[
                          "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition",
                          mode === "teacher" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950",
                        ].join(" ")}
                      >
                        <UserRound className="h-4 w-4" />
                        Par enseignant
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => setDisplay("grid")}
                        className={[
                          "rounded-xl px-4 py-2 text-sm font-black transition",
                          display === "grid" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950",
                        ].join(" ")}
                      >
                        Grille
                      </button>
                      <button
                        type="button"
                        onClick={() => setDisplay("list")}
                        className={[
                          "rounded-xl px-4 py-2 text-sm font-black transition",
                          display === "list" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950",
                        ].join(" ")}
                      >
                        Liste
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  {display === "grid" ? (
                    selectedTarget === "all" ? (
                      <div className="space-y-6">
                        {groups.map((group) => (
                          <div key={group.label} className="space-y-3">
                            <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                              <div>
                                <p className="font-black text-slate-950">{group.label}</p>
                                <p className="text-xs font-semibold text-slate-500">{group.items.length} cours placé{group.items.length > 1 ? "s" : ""}</p>
                              </div>
                              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            </div>
                            <TimetableGrid items={group.items} mode={mode} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <TimetableGrid items={visibleItems} mode={mode} />
                    )
                  ) : (
                    <ListView groups={selectedTarget === "all" ? groups : groupTargets(visibleItems, mode)} mode={mode} />
                  )}
                </div>
              </div>
            )}

            {(unplaced.length > 0 || diagnostics.length > 0) && (
              <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <h2 className="font-black">Diagnostics HoraClasse</h2>
                    <div className="mt-3 space-y-2 text-sm">
                      {diagnostics.map((item, index) => (
                        <p key={`diagnostic-${index}`}>• {item.message || "Alerte sans message"}</p>
                      ))}
                      {unplaced.map((item, index) => (
                        <p key={`unplaced-${index}`}>• Non placé : {clean(item.class_label, "Classe")} — {clean(item.subject_label, "Matière")} — {clean(item.teacher_name, "Enseignant")}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
