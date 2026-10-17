import { inferSchoolCycleFromLevel, isTeachingTrack, type SchoolCyclesSettings, type TeachingTrack } from "./school-cycles";
import { createSchoolSubjectResolver } from "./school-subject-identifiers";

export type TeachingImportRow = {
  teacherId?: string; teacherName?: string; subjectId?: string; subjectName?: string;
  classId?: string; classLabel?: string; track?: TeachingTrack;
};
type CatalogItem = { id: string; name: string; institutionSubjectId?: string };
export type TeachingImportCatalog = {
  teachers: CatalogItem[]; subjects: CatalogItem[];
  classes: Array<{ id: string; label: string; level: string | null }>;
  assignments: Array<{ teacher_id: string; subject_id: string | null; class_id: string }>;
};
const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");

function match(items: CatalogItem[], id: string | undefined, name: string | undefined) {
  if (id) {
    const found = items.find(item => item.id === id);
    return found && (!name?.trim() || normalize(found.name) === normalize(name)) ? found : null;
  }
  if (!name?.trim()) return null;
  const matches = items.filter(item => normalize(item.name) === normalize(name));
  return matches.length === 1 ? matches[0] : null;
}

/** Read-only plan. Never creates teachers, login contacts, subjects or classes. */
export function prepareSchoolTeachingImport(
  rows: readonly TeachingImportRow[], school: SchoolCyclesSettings, catalog: TeachingImportCatalog,
) {
  const seen = new Set<string>();
  const resolveSubject = createSchoolSubjectResolver(catalog.subjects.map(row => ({ id: row.institutionSubjectId || row.id, subject_id: row.id })));
  const existing = new Set(catalog.assignments.map(row => [row.teacher_id, resolveSubject(row.subject_id), row.class_id].join("|")));
  const items = rows.map((row, index) => {
    const issues: string[] = [];
    const teacher = match(catalog.teachers, row.teacherId, row.teacherName);
    const subject = match(catalog.subjects, row.subjectId ? resolveSubject(row.subjectId) || row.subjectId : undefined, row.subjectName);
    const targetClass = match(catalog.classes.map(item => ({ id: item.id, name: item.label })), row.classId, row.classLabel);
    if (!teacher) issues.push("teacher_missing_or_ambiguous");
    if (!subject) issues.push("subject_missing_or_ambiguous");
    if (!targetClass) issues.push("class_missing_or_ambiguous");
    if (!isTeachingTrack(row.track)) issues.push("explicit_teaching_track_required");
    const schoolClass = catalog.classes.find(item => item.id === targetClass?.id);
    const cycle = schoolClass ? school.classCycleById[schoolClass.id] || inferSchoolCycleFromLevel(schoolClass.level) : null;
    if (!school.enabled || !cycle || !school.enabledCycles.includes(cycle)) issues.push("class_cycle_not_configured");
    if (cycle && subject && isTeachingTrack(row.track) &&
      (!school.teachingTracksByCycle[cycle]?.includes(row.track) || !school.subjectTracksByCycle[cycle]?.[subject.id]?.includes(row.track))) {
      issues.push("subject_not_in_teaching_program");
    }
    const key = [teacher?.id, subject?.id, targetClass?.id].join("|");
    // The existing class_teachers relation has no program key. Never propose
    // inserting two physical assignments to fake separate program identities.
    if (cycle && subject && (school.subjectTracksByCycle[cycle]?.[subject.id] || []).length > 1) {
      issues.push("shared_subject_requires_program_assignment_schema");
    }
    if (!issues.length && seen.has(key)) issues.push("duplicate_import_row");
    if (!issues.length) seen.add(key);
    return { line: index + 1, teacherId: teacher?.id ?? null, subjectId: subject?.id ?? null,
      classId: targetClass?.id ?? null, cycle, track: isTeachingTrack(row.track) ? row.track : null,
      action: issues.length ? "review" as const : existing.has(key) ? "already_assigned" as const : "propose_assignment" as const,
      issues };
  });
  return { dryRun: true as const, canApply: false as const, items,
    needsReview: items.filter(item => item.issues.length > 0).length,
    proposedAssignments: items.filter(item => item.action === "propose_assignment").length,
    existingAssignments: items.filter(item => item.action === "already_assigned").length };
}
