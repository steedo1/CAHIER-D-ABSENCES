import type { SchoolCycle } from "@/lib/school-cycles";

/** School-wide counts: one individual remains one person even with multiple classes/tracks. */
export type CycleRosterTotals = {
  uniqueStudents: number;
  uniqueTeachers: number;
  byCycle: Record<SchoolCycle, { students: number; teachers: number }>;
};

export type ClassCyclePair = { id: string; cycle: SchoolCycle };
export type StudentClassRelation = { class_id: string; student_id: string; end_date?: string | null };
export type TeacherClassRelation = { class_id: string; teacher_id: string; end_date?: string | null };

/**
 * Pure aggregation over *server-scoped* classes and their relations.
 * The class index filters out memberships from unrelated classes.
 * Clients cannot use this helper to assert permissions.
 */
export function aggregateSchoolCycleRoster(
  classes: readonly ClassCyclePair[],
  studentMemberships: readonly StudentClassRelation[],
  teacherMemberships: readonly TeacherClassRelation[],
): CycleRosterTotals {
  const cycleByClass = new Map(classes.map((row) => [row.id, row.cycle]));
  const allStudents = new Set<string>();
  const allTeachers = new Set<string>();
  const byCycle = {
    preschool: { studentIds: new Set<string>(), teacherIds: new Set<string>() },
    primary: { studentIds: new Set<string>(), teacherIds: new Set<string>() },
    secondary: { studentIds: new Set<string>(), teacherIds: new Set<string>() },
  } satisfies Record<SchoolCycle, { studentIds: Set<string>; teacherIds: Set<string> }>;

  for (const row of studentMemberships) {
    if (row.end_date) continue;
    const cycle = cycleByClass.get(row.class_id);
    if (!cycle || !row.student_id) continue;
    allStudents.add(row.student_id);
    byCycle[cycle].studentIds.add(row.student_id);
  }
  for (const row of teacherMemberships) {
    if (row.end_date) continue;
    const cycle = cycleByClass.get(row.class_id);
    if (!cycle || !row.teacher_id) continue;
    allTeachers.add(row.teacher_id);
    byCycle[cycle].teacherIds.add(row.teacher_id);
  }

  return {
    uniqueStudents: allStudents.size,
    uniqueTeachers: allTeachers.size,
    byCycle: {
      preschool: {
        students: byCycle.preschool.studentIds.size,
        teachers: byCycle.preschool.teacherIds.size,
      },
      primary: {
        students: byCycle.primary.studentIds.size,
        teachers: byCycle.primary.teacherIds.size,
      },
      secondary: {
        students: byCycle.secondary.studentIds.size,
        teachers: byCycle.secondary.teacherIds.size,
      },
    },
  };
}
