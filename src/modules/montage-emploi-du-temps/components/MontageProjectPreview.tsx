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
  Printer,
  RefreshCw,
  School,
  UserRound,
} from "lucide-react";

type AnyRecord = Record<string, any>;

type Assignment = {
  id?: string;
  block_id?: string;
  lesson_block_id?: string;
  class_id?: string;
  class_label?: string;
  teacher_id?: string;
  teacher_name?: string;
  subject_id?: string;
  subject_label?: string;
  scheduler_subject_id?: string;
  catalog_subject_id?: string;
  weekday?: number;
  period_no?: number;
  period_label?: string;
  start_time?: string | null;
  end_time?: string | null;
  duration_units?: number;
  duration_min?: number;
  duration_slot_index?: number;
  duration_slots?: number;
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

type SourceSnapshot = {
  periods?: AnyRecord[];
  rooms?: AnyRecord[];
  classes?: AnyRecord[];
  teachers?: AnyRecord[];
  subjects?: AnyRecord[];
  service_assignments?: AnyRecord[];
};

type Project = {
  id: string;
  name: string;
  status: "draft" | "ready" | "published" | "archived";
  source_snapshot?: SourceSnapshot | null;
  engine_input?: AnyRecord | null;
  engine_result?: EngineResult | null;
  diagnostics?: Array<{ level?: string; message?: string }>;
  created_at: string;
  updated_at: string;
};

type ProjectResponse =
  | { ok: true; item: Project }
  | { ok: false; error: string; message?: string };

type ViewMode = "class" | "teacher";
type DisplayMode = "grid" | "list";

type PeriodRow = {
  type: "period";
  period_no: number;
  label: string;
  start_time: string;
  end_time: string;
};

type SeparatorRow = {
  type: "break" | "interclass";
  key: string;
  label: string;
};

type TimetableRow = PeriodRow | SeparatorRow;

const WEEKDAYS: Record<number, string> = {
  1: "LUNDI",
  2: "MARDI",
  3: "MERCREDI",
  4: "JEUDI",
  5: "VENDREDI",
  6: "SAMEDI",
  7: "DIMANCHE",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function emptyToBlank(value: unknown) {
  const text = String(value ?? "").trim();
  return text;
}

function dayLabel(value?: number) {
  const day = Number(value || 0);
  return WEEKDAYS[day] || `JOUR ${day || "?"}`;
}

function shortTime(value: string) {
  const text = emptyToBlank(value);
  return text ? text.replace(":", "H") : "";
}

function timeLabel(period: PeriodRow) {
  if (period.start_time && period.end_time) return `${shortTime(period.start_time)}-${shortTime(period.end_time)}`;
  return period.label;
}

function timeToMinutes(value: string) {
  const match = emptyToBlank(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
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
    .sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));
}

function getSnapshotPeriods(snapshot?: SourceSnapshot | null): PeriodRow[] {
  const raw = Array.isArray(snapshot?.periods) ? snapshot?.periods || [] : [];
  const byNo = new Map<number, PeriodRow>();

  for (const item of raw) {
    const periodNo = Number(item.period_no || item.periodNo || 0);
    if (!periodNo || byNo.has(periodNo)) continue;

    byNo.set(periodNo, {
      type: "period",
      period_no: periodNo,
      label: clean(item.label, `Séance ${periodNo}`),
      start_time: emptyToBlank(item.start_time || item.startTime),
      end_time: emptyToBlank(item.end_time || item.endTime),
    });
  }

  return Array.from(byNo.values()).sort((a, b) => a.period_no - b.period_no);
}

function getDays(items: Assignment[], snapshot?: SourceSnapshot | null) {
  const snapshotDays = uniqueBy(
    (Array.isArray(snapshot?.periods) ? snapshot?.periods || [] : [])
      .map((item) => Number(item.weekday || 0))
      .filter((day) => day >= 1 && day <= 7),
    (day) => String(day),
  ).sort((a, b) => a - b);

  if (snapshotDays.length > 0) return snapshotDays;

  return uniqueBy(
    items
      .filter((item) => Number(item.weekday || 0) >= 1)
      .map((item) => Number(item.weekday)),
    (day) => String(day),
  ).sort((a, b) => a - b);
}

function getPeriods(items: Assignment[], snapshot?: SourceSnapshot | null) {
  const snapshotPeriods = getSnapshotPeriods(snapshot);
  if (snapshotPeriods.length > 0) return snapshotPeriods;

  return uniqueBy(
    items
      .filter((item) => Number(item.period_no || 0) > 0)
      .map((item) => ({
        type: "period" as const,
        period_no: Number(item.period_no || 0),
        label: item.period_label || `Séance ${item.period_no}`,
        start_time: emptyToBlank(item.start_time),
        end_time: emptyToBlank(item.end_time),
      })),
    (item) => String(item.period_no),
  ).sort((a, b) => {
    if (a.period_no !== b.period_no) return a.period_no - b.period_no;
    return a.start_time.localeCompare(b.start_time);
  });
}

function buildRows(periods: PeriodRow[]): TimetableRow[] {
  const rows: TimetableRow[] = [];

  periods.forEach((period, index) => {
    rows.push(period);

    const next = periods[index + 1];
    if (!next) return;

    const end = timeToMinutes(period.end_time);
    const start = timeToMinutes(next.start_time);
    const gap = start - end;

    if (gap >= 10) {
      const isInterclass = gap >= 40 || (end <= 13 * 60 + 30 && start >= 13 * 60 + 30);
      rows.push({
        type: isInterclass ? "interclass" : "break",
        key: `${period.period_no}-${next.period_no}-${gap}`,
        label: isInterclass ? "INTERCLASSE" : "R É C R É A T I O N",
      });
    }
  });

  return rows;
}

function makeRoomMap(snapshot?: SourceSnapshot | null) {
  const map = new Map<string, string>();
  const rooms = Array.isArray(snapshot?.rooms) ? snapshot?.rooms || [] : [];

  for (const room of rooms) {
    const id = emptyToBlank(room.id || room.room_id || room.resource_id);
    const name = emptyToBlank(room.name || room.label || room.room_label);
    if (id && name) map.set(id, name);
  }

  return map;
}

function getRoomName(item: Assignment, roomMap: Map<string, string>) {
  const label = emptyToBlank(item.room_label);
  if (label && !UUID_RE.test(label)) return label;

  const id = emptyToBlank(item.room_id);
  if (!id) return "";

  const mapped = roomMap.get(id);
  if (mapped) return mapped;

  // Surtout ne jamais afficher un UUID brut dans la grille officielle.
  return UUID_RE.test(id) ? "" : id;
}

function getBlockKey(item: Assignment) {
  return emptyToBlank(item.block_id || item.lesson_block_id || item.id || `${item.class_id}-${item.teacher_id}-${item.subject_id}-${item.weekday}-${item.period_no}`);
}

function getSpan(item: Assignment) {
  const durationSlots = Number(item.duration_slots || 0);
  if (durationSlots > 0) return Math.max(1, Math.ceil(durationSlots));

  const durationUnits = Number(item.duration_units || 0);
  if (durationUnits > 0) return Math.max(1, Math.ceil(durationUnits));

  return 1;
}

function makeBlockStartMap(items: Assignment[]) {
  const map = new Map<string, number>();

  for (const item of items) {
    const key = getBlockKey(item);
    const periodNo = Number(item.period_no || 0);
    if (!key || !periodNo) continue;

    const current = map.get(key);
    if (!current || periodNo < current) map.set(key, periodNo);
  }

  return map;
}

function getCellItems(items: Assignment[], blockStartMap: Map<string, number>, day: number, periodNo: number) {
  return items.filter((item) => {
    if (Number(item.weekday || 0) !== day) return false;
    const key = getBlockKey(item);
    return (blockStartMap.get(key) || Number(item.period_no || 0)) === periodNo;
  });
}

function isCoveredByPrevious(items: Assignment[], blockStartMap: Map<string, number>, day: number, periodNo: number) {
  return items.some((item) => {
    if (Number(item.weekday || 0) !== day) return false;
    const key = getBlockKey(item);
    const start = blockStartMap.get(key) || Number(item.period_no || 0);
    const span = getSpan(item);
    return start < periodNo && periodNo < start + span;
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

function CourseBlock({ item, mode, roomMap }: { item: Assignment; mode: ViewMode; roomMap: Map<string, string> }) {
  const roomName = getRoomName(item, roomMap);
  const isTandem = Boolean(item.tandem_group_id || item.tandem_role || item.tandem_mode);

  return (
    <div className="flex h-full min-h-[58px] flex-col items-center justify-center px-1 py-1 text-center leading-tight">
      <strong className="block max-w-full truncate text-[13px] font-black text-slate-950">
        {clean(item.subject_label, "Matière")}
      </strong>
      <span className="mt-1 block max-w-full truncate text-[11px] font-bold text-slate-800">
        {getSecondaryLabel(item, mode)}
      </span>
      {roomName ? (
        <em className="mt-1 block max-w-full truncate text-[10px] font-bold not-italic text-slate-700">
          {roomName}
        </em>
      ) : null}
      {isTandem ? (
        <small className="mt-1 rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-black text-violet-700">
          Tandem {item.tandem_mode || ""}
        </small>
      ) : null}
    </div>
  );
}

function OfficialTimetableGrid({
  items,
  mode,
  snapshot,
}: {
  items: Assignment[];
  mode: ViewMode;
  snapshot?: SourceSnapshot | null;
}) {
  const days = getDays(items, snapshot);
  const periods = getPeriods(items, snapshot);
  const rows = buildRows(periods);
  const roomMap = React.useMemo(() => makeRoomMap(snapshot), [snapshot]);
  const blockStartMap = React.useMemo(() => makeBlockStartMap(items), [items]);

  if (days.length === 0 || periods.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
        Impossible de construire la grille : jours ou créneaux officiels manquants.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-white">
      <table className="w-full min-w-[940px] border-collapse text-[12px] text-slate-950">
        <thead>
          <tr>
            <th className="w-[130px] border border-slate-900 bg-white px-2 py-3 text-center text-[12px] font-black uppercase">
              HORAIRES
            </th>
            {days.map((day) => (
              <th key={day} className="min-w-[150px] border border-slate-900 bg-white px-2 py-3 text-center text-[12px] font-black uppercase">
                {dayLabel(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.type === "break" || row.type === "interclass") {
              return (
                <tr key={row.key}>
                  <td colSpan={days.length + 1} className="border border-slate-900 bg-sky-100 py-1 text-center text-[11px] font-black uppercase tracking-[0.35em]">
                    {row.label}
                  </td>
                </tr>
              );
            }

            return (
              <tr key={row.period_no} className="align-middle">
                <th className="border border-slate-900 bg-white px-2 py-3 text-center text-[12px] font-black">
                  {timeLabel(row)}
                </th>
                {days.map((day) => {
                  if (isCoveredByPrevious(items, blockStartMap, day, row.period_no)) {
                    return null;
                  }

                  const cellItems = getCellItems(items, blockStartMap, day, row.period_no);
                  const rowSpan = Math.max(1, ...cellItems.map(getSpan));

                  return (
                    <td key={`${day}-${row.period_no}`} rowSpan={rowSpan} className="h-[76px] border border-slate-900 bg-white p-1 text-center align-middle">
                      {cellItems.length === 0 ? null : (
                        <div className="flex h-full flex-col items-center justify-center gap-1">
                          {cellItems.map((item, index) => (
                            <CourseBlock key={`${getBlockKey(item)}-${index}`} item={item} mode={mode} roomMap={roomMap} />
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function buildTeacherRows(items: Assignment[]) {
  const map = new Map<string, string>();

  for (const item of items) {
    const subject = clean(item.subject_label, "Matière");
    const teacher = clean(item.teacher_name, "Enseignant");
    if (!map.has(subject)) map.set(subject, teacher);
  }

  const rows = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "fr", { numeric: true }));
  while (rows.length < 14) rows.push(["", ""]);
  return rows;
}

function OfficialClassSheet({
  label,
  items,
  mode,
  snapshot,
}: {
  label: string;
  items: Assignment[];
  mode: ViewMode;
  snapshot?: SourceSnapshot | null;
}) {
  const teacherRows = buildTeacherRows(items);
  const isClassMode = mode === "class";

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
      <div className="border-b border-slate-200 bg-white px-4 py-4 print:border-0 print:pb-2">
        <div className="hidden print:block">
          <div className="mb-3 flex flex-wrap gap-8 text-[11px] text-black">
            <span>Établissement : ....................................</span>
            <span>Année scolaire : 20.... / 20......</span>
            <span>BP : ............</span>
            <span>Tél : ............</span>
            <span>Fax : ............</span>
            <span>Email : ....................</span>
          </div>
          <div className="mx-auto mb-2 w-fit border-2 border-black px-8 py-1 text-center text-xl font-black uppercase tracking-wide">
            {isClassMode ? "EMPLOI DU TEMPS DE CLASSE" : "EMPLOI DU TEMPS PROFESSEUR"}
          </div>
          <p className="text-center text-sm font-black">{isClassMode ? `Classe : ${label}` : `Professeur : ${label}`}</p>
        </div>

        <div className="flex items-center justify-between gap-3 print:hidden">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              {isClassMode ? "Emploi du temps de classe" : "Emploi du temps professeur"}
            </p>
            <h3 className="mt-1 text-xl font-black text-slate-950">{label}</h3>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
            {items.length} cours
          </span>
        </div>
      </div>

      <div className={isClassMode ? "grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_288px] print:grid-cols-[minmax(0,1fr)_72mm] print:gap-4 print:p-0" : "p-4 print:p-0"}>
        <OfficialTimetableGrid items={items} mode={mode} snapshot={snapshot} />

        {isClassMode ? (
          <aside className="rounded-2xl border border-slate-900 bg-white p-0 print:rounded-none">
            <div className="border-b border-slate-900 px-2 py-2 text-center">
              <h4 className="text-sm font-black uppercase text-slate-950">PROFESSEURS DE LA CLASSE</h4>
              <p className="text-[10px] font-semibold text-slate-600">Ou équipe pédagogique</p>
            </div>
            <table className="w-full border-collapse text-[11px]">
              <tbody>
                {teacherRows.map(([subject, teacher], index) => (
                  <tr key={`${subject}-${teacher}-${index}`}>
                    <td className="w-8 border border-slate-900 px-2 py-1 text-center">{index + 1}</td>
                    <td className="border border-slate-900 px-2 py-1 font-black">{subject}</td>
                    <td className="border border-slate-900 px-2 py-1">{teacher}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </aside>
        ) : null}
      </div>

      {isClassMode ? (
        <div className="mx-4 mb-4 hidden print:block">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <th className="border border-black py-1 text-center font-black">PERSONNEL D’ENCADREMENT</th>
                <th className="border border-black py-1 text-center font-black">TÉLÉPHONE</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="border border-black px-2 py-1">Inspecteur d’Éducation</td><td className="border border-black" /></tr>
              <tr><td className="border border-black px-2 py-1">Éducateur</td><td className="border border-black" /></tr>
              <tr><td className="border border-black px-2 py-1">PP (chef équipe péda.)</td><td className="border border-black" /></tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ListView({ groups, mode, snapshot }: { groups: Array<{ label: string; items: Assignment[] }>; mode: ViewMode; snapshot?: SourceSnapshot | null }) {
  const roomMap = React.useMemo(() => makeRoomMap(snapshot), [snapshot]);

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
                  <th className="px-4 py-3">Horaire</th>
                  <th className="px-4 py-3">Matière</th>
                  <th className="px-4 py-3">{mode === "class" ? "Professeur" : "Classe"}</th>
                  <th className="px-4 py-3">Salle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortAssignments(group.items).map((item, index) => (
                  <tr key={`${item.id || index}-list`}>
                    <td className="px-4 py-3 font-bold text-slate-900">{dayLabel(Number(item.weekday || 0))}</td>
                    <td className="px-4 py-3 text-slate-600">{item.start_time && item.end_time ? `${shortTime(item.start_time)}-${shortTime(item.end_time)}` : item.period_label || `Séance ${item.period_no || "?"}`}</td>
                    <td className="px-4 py-3 font-black text-slate-950">{clean(item.subject_label, "Matière")}</td>
                    <td className="px-4 py-3 text-slate-700">{getSecondaryLabel(item, mode)}</td>
                    <td className="px-4 py-3 text-slate-700">{getRoomName(item, roomMap) || "—"}</td>
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
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<ViewMode>("class");
  const [display, setDisplay] = React.useState<DisplayMode>("grid");
  const [selectedTarget, setSelectedTarget] = React.useState("all");

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/montage-emploi-du-temps/projects/${projectId}`, { cache: "no-store" });
      const data = (await res.json()) as ProjectResponse;

      if (!res.ok || !data.ok) {
        throw new Error(data.ok ? "Erreur inconnue." : data.message || "Impossible de charger le brouillon.");
      }

      setProject(data.item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger le brouillon.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const result = project?.engine_result || null;
  const assignments = Array.isArray(result?.assignments) ? result.assignments : [];
  const unplaced = Array.isArray(result?.unplaced) ? result.unplaced : [];
  const diagnostics = Array.isArray(result?.diagnostics)
    ? result.diagnostics
    : Array.isArray(project?.diagnostics)
      ? project?.diagnostics || []
      : [];
  const snapshot = project?.source_snapshot || null;

  const groups = React.useMemo(() => groupTargets(assignments, mode), [assignments, mode]);

  React.useEffect(() => {
    setSelectedTarget("all");
  }, [mode, project?.id]);

  const visibleItems = React.useMemo(() => {
    if (selectedTarget === "all") return sortAssignments(assignments);
    return sortAssignments(assignments.filter((item) => getTargetLabel(item, mode) === selectedTarget));
  }, [assignments, mode, selectedTarget]);

  function handlePrint() {
    window.print();
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 print:bg-white print:px-0 print:py-0">
      <section className="mx-auto max-w-7xl space-y-6 print:max-w-none print:space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <Link href="/admin/montage-emploi-du-temps" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-slate-950">
            <ArrowLeft className="h-4 w-4" />
            Retour au montage
          </Link>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-800 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              <Printer className="h-4 w-4" />
              Imprimer / PDF
            </button>
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
        </div>

        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 shadow-xl print:hidden">
          <div className="relative p-6 sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.20),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.17),transparent_32%)]" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-sky-100">
                <CalendarDays className="h-4 w-4" />
                Grille HoraClasse officielle
              </div>
              <h1 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">
                {project?.name || "Emploi du temps généré"}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                Présentation rapprochée du rendu HoraClasse : grille administrative, blocs fusionnés sur 2h, pas d’UUID affiché, tableau des professeurs pour les classes.
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
          <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-700 shadow-sm print:hidden">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement de l’aperçu...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm print:hidden">
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
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 print:hidden">
              <StatBox label="Cours placés" value={result?.summary?.assignments_count ?? assignments.length} />
              <StatBox label="Blocs non placés" value={result?.summary?.unplaced_count ?? unplaced.length} />
              <StatBox label="Score" value={`${result?.summary?.score ?? 0}%`} />
              <StatBox label="Moteur" value={result?.status === "generated_real_scheduler" ? "HoraClasse" : "En attente"} />
            </div>

            {assignments.length === 0 ? (
              <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm print:hidden">
                <div className="flex items-start gap-3">
                  <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-black">Aucun emploi du temps généré</p>
                    <p className="mt-1 text-sm">Retourne sur la page Montage emploi du temps, puis clique sur “Générer avec HoraClasse”.</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between print:hidden">
                  <div>
                    <h2 className="flex items-center gap-2 text-xl font-black">
                      <Grid3X3 className="h-5 w-5 text-slate-500" />
                      Aperçu emploi du temps
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Grille officielle : les blocs de 2h sont fusionnés et les salles affichent leur nom, jamais leur identifiant technique.
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

                <div className="mt-6 print:mt-0">
                  {display === "grid" ? (
                    selectedTarget === "all" ? (
                      <div className="space-y-6 print:space-y-8">
                        {groups.map((group) => (
                          <OfficialClassSheet key={group.label} label={group.label} items={group.items} mode={mode} snapshot={snapshot} />
                        ))}
                      </div>
                    ) : (
                      <OfficialClassSheet label={selectedTarget} items={visibleItems} mode={mode} snapshot={snapshot} />
                    )
                  ) : (
                    <ListView groups={selectedTarget === "all" ? groups : groupTargets(visibleItems, mode)} mode={mode} snapshot={snapshot} />
                  )}
                </div>
              </div>
            )}

            {(unplaced.length > 0 || diagnostics.length > 0) && (
              <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm print:hidden">
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
