"use client";

import Link from "next/link";
import React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
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
  institution?: AnyRecord | null;
  establishment?: AnyRecord | null;
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

type BlockMeta = {
  start: number;
  span: number;
};

type InstitutionInfo = {
  name: string;
  academicYear: string;
  bp: string;
  phone: string;
  fax: string;
  email: string;
};

const WEEKDAYS: Record<number, string> = {
  1: "LUNDI",
  2: "MARDI",
  3: "MERCREDI",
  4: "JEUDI",
  5: "VENDREDI",
  6: "SAMEDI",
  7: "DIMANCHE",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return String(value ?? "").trim();
}

function dayLabel(value?: number) {
  const day = Number(value || 0);
  return WEEKDAYS[day] || `JOUR ${day || "?"}`;
}

function shortTime(value?: string | null) {
  const text = emptyToBlank(value);
  return text ? text.replace(":", "H") : "";
}

function timeLabel(period: PeriodRow) {
  if (period.start_time && period.end_time) {
    return `${shortTime(period.start_time)}-${shortTime(period.end_time)}`;
  }

  return period.label || `Séance ${period.period_no}`;
}

function timeToMinutes(value?: string | null) {
  const match = emptyToBlank(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getNumeric(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function sortPeriods(periods: PeriodRow[]) {
  return [...periods].sort((a, b) => {
    const aStart = timeToMinutes(a.start_time);
    const bStart = timeToMinutes(b.start_time);

    if (aStart && bStart && aStart !== bStart) return aStart - bStart;
    if (a.period_no !== b.period_no) return a.period_no - b.period_no;
    return a.label.localeCompare(b.label, "fr", { numeric: true });
  });
}

function sortAssignments(items: Assignment[]) {
  return [...items].sort((a, b) => {
    const aw = getNumeric(a.weekday);
    const bw = getNumeric(b.weekday);
    if (aw !== bw) return aw - bw;

    const at = timeToMinutes(a.start_time);
    const bt = timeToMinutes(b.start_time);
    if (at && bt && at !== bt) return at - bt;

    const ap = getNumeric(a.period_no);
    const bp = getNumeric(b.period_no);
    if (ap !== bp) return ap - bp;

    return clean(a.subject_label).localeCompare(clean(b.subject_label), "fr", {
      numeric: true,
    });
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
  return mode === "class"
    ? clean(item.class_label, "Classe")
    : clean(item.teacher_name, "Enseignant");
}

function getSecondaryLabel(item: Assignment, mode: ViewMode) {
  return mode === "class"
    ? clean(item.teacher_name, "Enseignant")
    : clean(item.class_label, "Classe");
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
  const byKey = new Map<string, PeriodRow>();

  for (const item of raw) {
    const periodNo = getNumeric(
      item.period_no || item.periodNo || item.no || item.index,
    );
    const start = emptyToBlank(item.start_time || item.startTime || item.start);
    const end = emptyToBlank(item.end_time || item.endTime || item.end);
    const key = periodNo ? `no-${periodNo}` : `${start}-${end}`;

    if (!key || byKey.has(key)) continue;

    byKey.set(key, {
      type: "period",
      period_no: periodNo || byKey.size + 1,
      label: clean(
        item.label || item.name,
        periodNo ? `Séance ${periodNo}` : `Créneau ${byKey.size + 1}`,
      ),
      start_time: start,
      end_time: end,
    });
  }

  return sortPeriods(Array.from(byKey.values()));
}

function getDays(items: Assignment[], snapshot?: SourceSnapshot | null) {
  const fromSnapshot = uniqueBy(
    (Array.isArray(snapshot?.periods) ? snapshot?.periods || [] : [])
      .flatMap((item) => [
        item.weekday,
        item.day,
        item.day_index,
        item.dayIndex,
      ])
      .map((day) => getNumeric(day))
      .filter((day) => day >= 1 && day <= 7),
    (day) => String(day),
  ).sort((a, b) => a - b);

  if (fromSnapshot.length > 0) return fromSnapshot;

  const fromAssignments = uniqueBy(
    items
      .map((item) => getNumeric(item.weekday))
      .filter((day) => day >= 1 && day <= 7),
    (day) => String(day),
  ).sort((a, b) => a - b);

  return fromAssignments.length > 0 ? fromAssignments : [1, 2, 3, 4, 5];
}

function getPeriods(items: Assignment[], snapshot?: SourceSnapshot | null) {
  const snapshotPeriods = getSnapshotPeriods(snapshot);
  if (snapshotPeriods.length > 0) return snapshotPeriods;

  const byKey = new Map<string, PeriodRow>();

  for (const item of items) {
    const periodNo = getNumeric(item.period_no);
    const start = emptyToBlank(item.start_time);
    const end = emptyToBlank(item.end_time);
    const key = periodNo ? `no-${periodNo}` : `${start}-${end}`;

    if (!key || byKey.has(key)) continue;

    byKey.set(key, {
      type: "period",
      period_no: periodNo || byKey.size + 1,
      label: clean(
        item.period_label,
        periodNo ? `Séance ${periodNo}` : `Créneau ${byKey.size + 1}`,
      ),
      start_time: start,
      end_time: end,
    });
  }

  return sortPeriods(Array.from(byKey.values()));
}

function buildRows(periods: PeriodRow[]): TimetableRow[] {
  const rows: TimetableRow[] = [];

  periods.forEach((period, index) => {
    rows.push(period);

    const next = periods[index + 1];
    if (!next) return;

    const end = timeToMinutes(period.end_time);
    const start = timeToMinutes(next.start_time);
    const gap = start && end ? start - end : 0;

    if (gap >= 8) {
      const isInterclass =
        gap >= 35 || (end <= 13 * 60 + 30 && start >= 13 * 60 + 30);
      rows.push({
        type: isInterclass ? "interclass" : "break",
        key: `${period.period_no}-${next.period_no}-${gap}`,
        label: isInterclass ? "INTERCLASSE" : "R É C R É A T I O N",
      });
    }
  });

  return rows;
}

function normalizeRoomName(value: string) {
  const text = value.trim();
  const lower = text.toLowerCase();

  if (!text || UUID_RE.test(text)) return "";
  if (lower.startsWith("room_") || lower.startsWith("room-")) return "";
  if (lower.includes("-02c035c") || lower.includes("-97f1-")) return "";

  if (["pc_lab_default", "pc lab default", "pclabdefault"].includes(lower))
    return "Labo P.C";
  if (["svt_lab_default", "svt lab default", "svtlabdefault"].includes(lower))
    return "Labo SVT";
  if (["computer_lab_default", "computer lab default"].includes(lower))
    return "Salle informatique";
  if (["sports_field_default", "sports field default"].includes(lower))
    return "Terrain EPS";
  if (["ordinary", "ordinary_default", "ordinary room"].includes(lower))
    return "Salle ordinaire";

  return text;
}

function makeRoomMap(snapshot?: SourceSnapshot | null) {
  const map = new Map<string, string>();
  const rooms = Array.isArray(snapshot?.rooms) ? snapshot?.rooms || [] : [];

  for (const room of rooms) {
    const id = emptyToBlank(room.id || room.room_id || room.resource_id);
    const name = normalizeRoomName(
      emptyToBlank(room.name || room.label || room.room_label),
    );
    if (id && name) map.set(id, name);
  }

  return map;
}

function getRoomName(item: Assignment, roomMap: Map<string, string>) {
  const label = normalizeRoomName(emptyToBlank(item.room_label));
  if (label) return label;

  const id = emptyToBlank(item.room_id);
  if (!id) return "";

  const mapped = normalizeRoomName(roomMap.get(id) || "");
  if (mapped) return mapped;

  return normalizeRoomName(id);
}

function getBlockKey(item: Assignment) {
  const explicit = emptyToBlank(item.block_id || item.lesson_block_id);
  if (explicit) return explicit;

  return [
    item.class_id || item.class_label || "class",
    item.teacher_id || item.teacher_name || "teacher",
    item.subject_id || item.subject_label || "subject",
    item.weekday || "day",
    item.room_id || item.room_label || "room",
  ].join("|");
}

function makeBlockMetaMap(items: Assignment[]) {
  const grouped = new Map<string, Assignment[]>();

  for (const item of items) {
    const key = getBlockKey(item);
    const current = grouped.get(key) || [];
    current.push(item);
    grouped.set(key, current);
  }

  const meta = new Map<string, BlockMeta>();

  for (const [key, values] of grouped.entries()) {
    const periods = values
      .map((item) => getNumeric(item.period_no))
      .filter((period) => period > 0)
      .sort((a, b) => a - b);

    const start = periods[0] || 0;
    const durationSlots = Math.max(
      ...values.map((item) => getNumeric(item.duration_slots)),
      0,
    );
    const durationUnits = Math.max(
      ...values.map((item) => getNumeric(item.duration_units)),
      0,
    );
    const inferredSpan =
      periods.length > 0 ? periods[periods.length - 1] - periods[0] + 1 : 1;
    const span = Math.max(
      1,
      Math.ceil(durationSlots || durationUnits || inferredSpan),
    );

    meta.set(key, { start, span });
  }

  return meta;
}

function getCellItems(
  items: Assignment[],
  blockMeta: Map<string, BlockMeta>,
  day: number,
  periodNo: number,
) {
  const seen = new Set<string>();
  const values: Assignment[] = [];

  for (const item of items) {
    if (getNumeric(item.weekday) !== day) continue;

    const key = getBlockKey(item);
    const meta = blockMeta.get(key);
    const start = meta?.start || getNumeric(item.period_no);

    if (start !== periodNo || seen.has(key)) continue;

    seen.add(key);
    values.push(item);
  }

  return sortAssignments(values);
}

function isCoveredByPrevious(
  items: Assignment[],
  blockMeta: Map<string, BlockMeta>,
  day: number,
  periodNo: number,
) {
  return items.some((item) => {
    if (getNumeric(item.weekday) !== day) return false;

    const meta = blockMeta.get(getBlockKey(item));
    const start = meta?.start || getNumeric(item.period_no);
    const span = meta?.span || 1;

    return start < periodNo && periodNo < start + span;
  });
}

function getItemSpan(item: Assignment, blockMeta: Map<string, BlockMeta>) {
  return Math.max(1, blockMeta.get(getBlockKey(item))?.span || 1);
}

function getInstitutionInfo(snapshot?: SourceSnapshot | null): InstitutionInfo {
  const source = snapshot?.institution || snapshot?.establishment || {};

  return {
    name: emptyToBlank(
      source.name || source.school_name || source.institution_name,
    ),
    academicYear: emptyToBlank(
      source.academic_year || source.academicYear || source.school_year,
    ),
    bp: emptyToBlank(source.bp || source.postal_box),
    phone: emptyToBlank(source.phone || source.tel || source.telephone),
    fax: emptyToBlank(source.fax),
    email: emptyToBlank(source.email),
  };
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">
        {value}
      </p>
    </div>
  );
}

function getCellDedupeKey(item: Assignment) {
  return [
    item.class_id || item.class_label || "class",
    item.teacher_id || item.teacher_name || "teacher",
    item.subject_id || item.subject_label || "subject",
    item.room_id || item.room_label || "room",
  ].join("|");
}

function getAssignmentStart(item: Assignment) {
  return getNumeric(item.period_no);
}

function getAssignmentSpan(item: Assignment) {
  const span = Math.ceil(
    getNumeric(item.duration_slots) || getNumeric(item.duration_units) || 1,
  );
  return Math.max(1, span);
}

function getItemsForCell(items: Assignment[], day: number, periodNo: number) {
  const values: Assignment[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (getNumeric(item.weekday) !== day) continue;

    const start = getAssignmentStart(item);
    if (!start) continue;

    const baseKey = getCellDedupeKey(item);
    const hasExplicitCourseAtThisPeriod = items.some((other) => {
      return (
        other !== item &&
        getNumeric(other.weekday) === day &&
        getCellDedupeKey(other) === baseKey &&
        getAssignmentStart(other) === periodNo
      );
    });

    const isExplicitStart = start === periodNo;
    const isCoveredByDuration =
      start < periodNo && periodNo < start + getAssignmentSpan(item);

    if (
      !isExplicitStart &&
      (!isCoveredByDuration || hasExplicitCourseAtThisPeriod)
    )
      continue;
    if (seen.has(baseKey)) continue;

    seen.add(baseKey);
    values.push(item);
  }

  return sortAssignments(values);
}

function CourseBlock({
  item,
  mode,
  roomMap,
}: {
  item: Assignment;
  mode: ViewMode;
  roomMap: Map<string, string>;
}) {
  const roomName = getRoomName(item, roomMap);
  const isTandem = Boolean(
    item.tandem_group_id || item.tandem_role || item.tandem_mode,
  );
  const subject = clean(item.subject_label, "Matière");
  const secondary = getSecondaryLabel(item, mode);

  return (
    <div className="mx-auto flex h-full w-full flex-col items-center justify-center px-1 text-center leading-[1.15] text-black">
      <strong className="block w-full whitespace-normal break-words text-[10px] font-black uppercase text-black print:text-[7.4px]">
        {subject}
      </strong>
      <span className="mt-1 block w-full whitespace-normal break-words text-[8.8px] font-bold text-black print:text-[6.8px]">
        {secondary}
      </span>
      {roomName ? (
        <em className="mt-1 block w-full whitespace-normal break-words text-[8px] font-bold not-italic text-black print:text-[6.2px]">
          {roomName}
        </em>
      ) : null}
      {isTandem ? (
        <small className="mt-1 text-[7px] font-black uppercase tracking-wide text-black print:text-[5.8px]">
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

  if (days.length === 0 || periods.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
        Impossible de construire la grille : jours ou créneaux officiels
        manquants.
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto bg-white print:overflow-visible">
      <table className="w-full min-w-[780px] table-fixed border-collapse text-black print:min-w-0">
        <thead>
          <tr>
            <th className="w-[86px] border border-black bg-white px-1 py-2 text-center text-[9px] font-black uppercase print:w-[20mm] print:text-[6.8px]">
              HORAIRES
            </th>
            {days.map((day) => (
              <th
                key={day}
                className="border border-black bg-white px-1 py-2 text-center text-[9px] font-black uppercase print:text-[6.8px]"
              >
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
                  <td
                    colSpan={days.length + 1}
                    className="border border-black bg-sky-100 py-0.5 text-center text-[8px] font-black uppercase tracking-[0.48em] print:text-[5.8px] print:tracking-[0.34em]"
                  >
                    {row.label}
                  </td>
                </tr>
              );
            }

            const period = row as PeriodRow;

            return (
              <tr key={period.period_no} className="align-middle">
                <th className="border border-black bg-white px-1 py-2 text-center text-[8px] font-black leading-tight print:text-[6.2px]">
                  {timeLabel(period)}
                </th>
                {days.map((day) => {
                  const cellItems = getItemsForCell(
                    items,
                    day,
                    period.period_no,
                  );

                  return (
                    <td
                      key={`${day}-${period.period_no}`}
                      className="h-[76px] border border-black bg-white px-1 py-1 text-center align-middle print:h-[12mm] print:px-0.5 print:py-0.5"
                    >
                      {cellItems.length === 0 ? null : (
                        <div className="flex h-full flex-col items-center justify-center gap-1">
                          {cellItems.map((item, index) => (
                            <CourseBlock
                              key={`${getCellDedupeKey(item)}-${period.period_no}-${index}`}
                              item={item}
                              mode={mode}
                              roomMap={roomMap}
                            />
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

  const rows = Array.from(map.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], "fr", { numeric: true }),
  );
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
  const info = getInstitutionInfo(snapshot);

  return (
    <section className="min-w-[1120px] overflow-x-auto rounded-[18px] border border-slate-300 bg-white shadow-sm print:min-w-0 print:break-after-page print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
      <div className="bg-white px-3 pb-2 pt-3 print:px-0 print:pt-0">
        <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-black print:text-[8px]">
          <span>
            Établissement :{" "}
            {info.name || "...................................."}
          </span>
          <span>
            Année scolaire : {info.academicYear || "20.... / 20......"}
          </span>
          <span>BP : {info.bp || "............"}</span>
          <span>Tél : {info.phone || "............"}</span>
          <span>Fax : {info.fax || "............"}</span>
          <span>Email : {info.email || "...................."}</span>
        </div>
        <div className="mx-auto mb-2 w-fit border-2 border-black px-8 py-1 text-center text-lg font-black uppercase tracking-wide text-black print:text-[14px]">
          {isClassMode
            ? "EMPLOI DU TEMPS DE CLASSE"
            : "EMPLOI DU TEMPS PROFESSEUR"}
        </div>
        <p className="text-center text-sm font-black text-black print:text-[10px]">
          {isClassMode ? `Classe : ${label}` : `Professeur : ${label}`}
        </p>
      </div>

      <div
        className={
          isClassMode
            ? "grid gap-3 px-3 pb-3 xl:grid-cols-[minmax(780px,1fr)_300px] print:grid-cols-[minmax(0,1fr)_54mm] print:gap-3 print:px-0 print:pb-0"
            : "px-3 pb-3 print:px-0 print:pb-0"
        }
      >
        <OfficialTimetableGrid items={items} mode={mode} snapshot={snapshot} />

        {isClassMode ? (
          <aside className="overflow-hidden rounded-none border border-black bg-white print:rounded-none">
            <div className="border-b border-black px-2 py-2 text-center">
              <h4 className="text-[11px] font-black uppercase text-black print:text-[8px]">
                PROFESSEURS DE LA CLASSE
              </h4>
              <p className="text-[9px] font-semibold text-black print:text-[7px]">
                Ou équipe pédagogique
              </p>
            </div>
            <table className="w-full border-collapse text-[9px] text-black print:text-[7px]">
              <tbody>
                {teacherRows.map(([subject, teacher], index) => (
                  <tr key={`${subject}-${teacher}-${index}`}>
                    <td className="w-7 border border-black px-1 py-1 text-center">
                      {index + 1}
                    </td>
                    <td className="border border-black px-1 py-1 font-black leading-tight">
                      {subject}
                    </td>
                    <td className="border border-black px-1 py-1 leading-tight">
                      {teacher}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </aside>
        ) : null}
      </div>

      {isClassMode ? (
        <div className="mx-3 mb-3 print:mx-0 print:mb-0 print:mt-3">
          <table className="w-full border-collapse text-[10px] text-black print:text-[8px]">
            <thead>
              <tr>
                <th className="border border-black py-1 text-center font-black">
                  PERSONNEL D’ENCADREMENT
                </th>
                <th className="w-[30%] border border-black py-1 text-center font-black">
                  TÉLÉPHONE
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-black px-2 py-1">
                  Inspecteur d’Éducation
                </td>
                <td className="border border-black" />
              </tr>
              <tr>
                <td className="border border-black px-2 py-1">Éducateur</td>
                <td className="border border-black" />
              </tr>
              <tr>
                <td className="border border-black px-2 py-1">
                  PP (chef équipe péda.)
                </td>
                <td className="border border-black" />
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ListView({
  groups,
  mode,
  snapshot,
}: {
  groups: Array<{ label: string; items: Assignment[] }>;
  mode: ViewMode;
  snapshot?: SourceSnapshot | null;
}) {
  const roomMap = React.useMemo(() => makeRoomMap(snapshot), [snapshot]);

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div
          key={group.label}
          className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
        >
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
                  <th className="px-4 py-3">
                    {mode === "class" ? "Professeur" : "Classe"}
                  </th>
                  <th className="px-4 py-3">Salle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortAssignments(group.items).map((item, index) => (
                  <tr key={`${item.id || index}-list`}>
                    <td className="px-4 py-3 font-bold text-slate-900">
                      {dayLabel(getNumeric(item.weekday))}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {item.start_time && item.end_time
                        ? `${shortTime(item.start_time)}-${shortTime(item.end_time)}`
                        : item.period_label ||
                          `Séance ${item.period_no || "?"}`}
                    </td>
                    <td className="px-4 py-3 font-black text-slate-950">
                      {clean(item.subject_label, "Matière")}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {getSecondaryLabel(item, mode)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {getRoomName(item, roomMap) || "—"}
                    </td>
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

export default function MontageProjectPreview({
  projectId,
}: {
  projectId: string;
}) {
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
      const res = await fetch(
        `/api/admin/montage-emploi-du-temps/projects/${projectId}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as ProjectResponse;

      if (!res.ok || !data.ok) {
        throw new Error(
          data.ok
            ? "Erreur inconnue."
            : data.message || "Impossible de charger le brouillon.",
        );
      }

      setProject(data.item);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de charger le brouillon.",
      );
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const result = project?.engine_result || null;
  const assignments = Array.isArray(result?.assignments)
    ? result.assignments
    : [];
  const unplaced = Array.isArray(result?.unplaced) ? result.unplaced : [];
  const diagnostics = Array.isArray(result?.diagnostics)
    ? result.diagnostics
    : Array.isArray(project?.diagnostics)
      ? project?.diagnostics || []
      : [];
  const snapshot = project?.source_snapshot || null;

  const groups = React.useMemo(
    () => groupTargets(assignments, mode),
    [assignments, mode],
  );

  React.useEffect(() => {
    setSelectedTarget("all");
  }, [mode, project?.id]);

  const visibleItems = React.useMemo(() => {
    if (selectedTarget === "all") return sortAssignments(assignments);
    return sortAssignments(
      assignments.filter(
        (item) => getTargetLabel(item, mode) === selectedTarget,
      ),
    );
  }, [assignments, mode, selectedTarget]);

  function handlePrint() {
    window.print();
  }

  return (
    <main className="min-h-screen bg-slate-100 px-3 py-5 text-slate-950 print:bg-white print:px-0 print:py-0">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @page { size: A4 landscape; margin: 7mm; }
        @media print {
          body { background: #fff !important; }
          .print\\:break-after-page { break-after: page; page-break-after: always; }
        }
      `,
        }}
      />

      <section className="mx-auto max-w-[1760px] space-y-5 print:max-w-none print:space-y-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <Link
            href="/admin/montage-emploi-du-temps"
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-slate-950"
          >
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
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Recharger
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-slate-950 shadow-xl print:hidden">
          <div className="relative p-6 sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.20),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.17),transparent_32%)]" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-sky-100">
                <CalendarDays className="h-4 w-4" />
                Aperçu officiel HoraClasse
              </div>
              <h1 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">
                {project?.name || "Emploi du temps généré"}
              </h1>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300 sm:text-base">
                Rendu administratif : grille officielle, bordures nettes, blocs
                consécutifs fusionnés, horaires réels, professeurs de la classe
                à droite et aucun identifiant technique affiché dans les
                cellules.
              </p>
              {project && (
                <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
                  <span className="rounded-full bg-white px-3 py-1 text-slate-950">
                    Statut : {project.status}
                  </span>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200 ring-1 ring-white/10">
                    Modifié le {formatDate(project.updated_at)}
                  </span>
                  {result?.generated_at ? (
                    <span className="rounded-full bg-white/10 px-3 py-1 text-slate-200 ring-1 ring-white/10">
                      Généré le {formatDate(result.generated_at)}
                    </span>
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
              <StatBox
                label="Cours placés"
                value={result?.summary?.assignments_count ?? assignments.length}
              />
              <StatBox
                label="Blocs non placés"
                value={result?.summary?.unplaced_count ?? unplaced.length}
              />
              <StatBox
                label="Score"
                value={`${result?.summary?.score ?? 0}%`}
              />
              <StatBox
                label="Moteur"
                value={
                  result?.status === "generated_real_scheduler"
                    ? "HoraClasse"
                    : "En attente"
                }
              />
            </div>

            {assignments.length === 0 ? (
              <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm print:hidden">
                <div className="flex items-start gap-3">
                  <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-black">Aucun emploi du temps généré</p>
                    <p className="mt-1 text-sm">
                      Retourne sur la page Montage emploi du temps, puis clique
                      sur “Générer avec HoraClasse”.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between print:hidden">
                  <div>
                    <h2 className="flex items-center gap-2 text-xl font-black">
                      <Grid3X3 className="h-5 w-5 text-slate-500" />
                      Aperçu officiel
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Grille calée sur HoraClasse : tableau compact, complet et
                      imprimable.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      value={selectedTarget}
                      onChange={(event) =>
                        setSelectedTarget(event.target.value)
                      }
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
                          mode === "class"
                            ? "bg-white text-slate-950 shadow-sm"
                            : "text-slate-500 hover:text-slate-950",
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
                          mode === "teacher"
                            ? "bg-white text-slate-950 shadow-sm"
                            : "text-slate-500 hover:text-slate-950",
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
                          display === "grid"
                            ? "bg-white text-slate-950 shadow-sm"
                            : "text-slate-500 hover:text-slate-950",
                        ].join(" ")}
                      >
                        Grille
                      </button>
                      <button
                        type="button"
                        onClick={() => setDisplay("list")}
                        className={[
                          "rounded-xl px-4 py-2 text-sm font-black transition",
                          display === "list"
                            ? "bg-white text-slate-950 shadow-sm"
                            : "text-slate-500 hover:text-slate-950",
                        ].join(" ")}
                      >
                        Liste
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-5 print:mt-0">
                  {display === "grid" ? (
                    selectedTarget === "all" ? (
                      <div className="space-y-6 print:space-y-0">
                        {groups.map((group) => (
                          <OfficialClassSheet
                            key={group.label}
                            label={group.label}
                            items={group.items}
                            mode={mode}
                            snapshot={snapshot}
                          />
                        ))}
                      </div>
                    ) : (
                      <OfficialClassSheet
                        label={selectedTarget}
                        items={visibleItems}
                        mode={mode}
                        snapshot={snapshot}
                      />
                    )
                  ) : (
                    <ListView
                      groups={
                        selectedTarget === "all"
                          ? groups
                          : groupTargets(visibleItems, mode)
                      }
                      mode={mode}
                      snapshot={snapshot}
                    />
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
                        <p key={`diagnostic-${index}`}>
                          • {item.message || "Alerte sans message"}
                        </p>
                      ))}
                      {unplaced.map((item, index) => (
                        <p key={`unplaced-${index}`}>
                          • Non placé : {clean(item.class_label, "Classe")} —{" "}
                          {clean(item.subject_label, "Matière")} —{" "}
                          {clean(item.teacher_name, "Enseignant")}
                        </p>
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
