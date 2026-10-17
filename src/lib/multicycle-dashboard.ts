import type { SchoolNavigationContext } from "./school-navigation";
import type { SchoolCycle, TeachingTrack } from "./school-cycles";

/**
 * The school-cycles endpoint returns authoritative per-cycle unique people,
 * and the independently configured school-student program memberships.
 * Never re-label a cycle-wide count as a French/Arabic count.
 */
export type CycleDashboardSummary = {
  ok?: boolean;
  enabled?: boolean;
  academicYear?: string | null;
  cycles?: Partial<Record<SchoolCycle, {
    count: number;
    students: number;
    teachers: number;
  }>>;
  programs?: Partial<Record<SchoolCycle, Partial<Record<TeachingTrack, {
    uniqueTeachers: number;
    subjects?: Array<{ id: string; name: string }>;
  }>>>>;
  studentPrograms?: Partial<Record<SchoolCycle, Partial<Record<TeachingTrack, {
    students: number;
    classes: number;
    complete: boolean;
    unclassifiedStudents: number;
  }>>>>;
  studentProgramTotals?: Partial<Record<TeachingTrack, {
    students: number; classes: number; complete: boolean; unclassifiedStudents: number;
  }>>;
  programTeacherTotals?: Partial<Record<TeachingTrack, { uniqueTeachers: number | null }>>;
};

export type ScopedDashboardCounts = {
  classes: number | null;
  students: number | null;
  teachers: number | null;
};

const countOrUnknown = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value : null;

export function isScopedDashboardSelection(
  selection: SchoolNavigationContext,
): boolean {
  return selection.cycle !== "all" || selection.track !== "all" ||
    Boolean(selection.level || selection.classId);
}

export function resolveScopedDashboardCounts(
  selection: SchoolNavigationContext,
  summary: CycleDashboardSummary | null,
): ScopedDashboardCounts {
  const unknown = { classes: null, students: null, teachers: null };
  if (!summary?.ok || !summary.enabled) return unknown;
  // A cycle aggregate cannot be filtered further by level or class.
  if (selection.classId || selection.level) return unknown;
  if (selection.cycle === "all") {
    if (selection.track === "all") return unknown; // Original school-wide dashboard owns those numbers.
    const total = summary.studentProgramTotals?.[selection.track];
    return {
      students: total?.complete ? countOrUnknown(total.students) : null,
      classes: total?.complete ? countOrUnknown(total.classes) : null,
      teachers: countOrUnknown(summary.programTeacherTotals?.[selection.track]?.uniqueTeachers),
    };
  }

  const cycle = summary.cycles?.[selection.cycle];
  if (!cycle) return unknown;
  if (selection.track === "all") {
    return {
      classes: countOrUnknown(cycle.count),
      students: countOrUnknown(cycle.students),
      teachers: countOrUnknown(cycle.teachers),
    };
  }
  // A student can follow both programs; each program count comes only
  // from explicitly configured active memberships for this academic year.
  // If one student is not classified, do not claim a complete total.
  const program = summary.programs?.[selection.cycle]?.[selection.track];
  const students = summary.studentPrograms?.[selection.cycle]?.[selection.track];
  return {
    classes: students?.complete ? countOrUnknown(students.classes) : null,
    students: students?.complete ? countOrUnknown(students.students) : null,
    teachers: program?.subjects?.length ? countOrUnknown(program.uniqueTeachers) : null,
  };
}
