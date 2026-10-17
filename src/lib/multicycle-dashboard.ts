import type { SchoolNavigationContext } from "./school-navigation";
import type { SchoolCycle, TeachingTrack } from "./school-cycles";

/**
 * The school-cycles endpoint returns authoritative per-cycle unique people,
 * but has NO track-specific student enrollment relation. Never re-label a
 * cycle-wide count as a French/Arabic count.
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
  // The cycle aggregate cannot be filtered by level or administrative class.
  if (selection.classId || selection.level || selection.cycle === "all") return unknown;

  const cycle = summary.cycles?.[selection.cycle];
  if (!cycle) return unknown;
  if (selection.track === "all") {
    return {
      classes: countOrUnknown(cycle.count),
      students: countOrUnknown(cycle.students),
      teachers: countOrUnknown(cycle.teachers),
    };
  }
  // Class identity and enrollment can be shared across both teachings.
  // A teacher is counted only when a mapped subject assignment exists.
  return {
    classes: null,
    students: null,
    teachers: summary.programs?.[selection.cycle]?.[selection.track]?.subjects?.length
      ? countOrUnknown(summary.programs[selection.cycle]?.[selection.track]?.uniqueTeachers)
      : null,
  };
}
