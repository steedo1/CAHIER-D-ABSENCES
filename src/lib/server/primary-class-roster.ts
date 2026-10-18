import type { SupabaseClient } from "@supabase/supabase-js";
import { classSubjectIds } from "@/lib/school-class-subjects";
import { parseSchoolCyclesSettings, resolveSchoolCycleForClass } from "@/lib/school-cycles";
import { loadLinkedClassEnrollments } from "./school-linked-class-roster";
import { primarySubjectScale, primarySubjectTeachingTrack } from "@/lib/grades/primary-subject-scale";
import { classListSubjectShortName, type ClassListMarkSubject } from "@/lib/class-list-subjects";

/** Read-only extension of the authorized roster. Linked pupils retain ONE
 * administrative enrollment and are reverified against the same school/year. */
export async function loadPrimaryClassRoster(service: SupabaseClient, institutionId: string,
  classroom: { id: string; level?: string | null; academic_year?: string | null }, settings: unknown) {
  const school = parseSchoolCyclesSettings(settings);
  const cycle = resolveSchoolCycleForClass(classroom, school);
  if (cycle !== "primary") return null;
  const year = classroom.academic_year || "";
  const ids = classSubjectIds(settings, year, classroom.id) || [];
  const { data: catalog, error } = ids.length ? await service.from("institution_subjects")
    .select("subject_id,custom_name,subjects:subject_id(name)").eq("institution_id", institutionId)
    .eq("is_active", true).in("subject_id", ids).limit(501) : { data: [], error: null };
  if (error || !catalog) throw Error("primary_subjects_unavailable");
  const subjects: ClassListMarkSubject[] = ids.flatMap(id => {
    const row = catalog.find(item => item.subject_id === id);
    if (!row) return [];
    const relation = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
    const name = String(row.custom_name || relation?.name || "").trim();
    if (!name) return [];
    const track = primarySubjectTeachingTrack(settings, year, classroom.id, id);
    return [{ id, name, shortName: classListSubjectShortName(name), denominator: track
      ? primarySubjectScale(settings, { year, classId: classroom.id, level: classroom.level || "", track,
          subjectId: id, subjectName: name }) : null }];
  });
  const used = new Map<string, number>();
  for (const subject of subjects) {
    const count = (used.get(subject.shortName) || 0) + 1;
    used.set(subject.shortName, count);
    if (count > 1) subject.shortName += String(count);
  }
  return { subjects, linkedEnrollments: await loadLinkedClassEnrollments(service, institutionId, classroom, settings) };
}
