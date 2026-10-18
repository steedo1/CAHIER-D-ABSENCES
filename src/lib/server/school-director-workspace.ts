import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeachingDirectorPrincipal } from "@/lib/auth/teaching-director";
import { parseSchoolCyclesSettings, type SchoolCycle } from "@/lib/school-cycles";
import {
  listDirectorClasses, directorStudentMembership, directorSubjectPermitted,
  type DirectorClass,
} from "@/lib/school-director-resource-scope";

export type WorkspaceClass = {
  id: string; label: string; level: string | null; cycle: SchoolCycle;
  studentCount: number; students: Array<{ id: string; name: string; matricule: string | null }>;
  teachers: Array<{ id: string; name: string; subject: string }>;
  recentEvaluations: Array<{ id: string; title: string; date: string; published: boolean; subject: string }>;
};
export type DirectorWorkspace = {
  schoolName: string; year: string;
  classes: WorkspaceClass[];
  limited: boolean;
};
type ClassRow = DirectorClass & { institution_id: string };
type EnrollmentRow = { class_id: string; student_id: string; end_date: string | null };
type TeacherAssignment = { class_id: string; teacher_id: string; subject_id: string };
type Evaluation = {
  id: string; class_id: string; subject_id: string | null; eval_date: string;
  title: string | null; is_published: boolean;
  publication_status: string | null;
};

/** Returns a program-filtered pedagogical workspace, never school-wide data.
 * Reads are bounded and the endpoint is never enabled for unauthenticated users.
 * No finance tables or the classic administrative controller are queried.
 */
export async function loadTeachingDirectorWorkspace(
  service: SupabaseClient, principal: TeachingDirectorPrincipal,
): Promise<DirectorWorkspace> {
  const institutionId = principal.institutionId;
  const [institution, yearResult] = await Promise.all([
    service.from("institutions").select("name,settings_json")
      .eq("id", institutionId).maybeSingle(),
    service.from("academic_years").select("code")
      .eq("institution_id", institutionId).eq("is_current", true).limit(1).maybeSingle(),
  ]);
  if (institution.error || !institution.data || yearResult.error) throw new Error("director_school_unavailable");
  const year = String(yearResult.data?.code || "");
  if (!year) return { schoolName: institution.data.name, year: "", classes: [], limited: false };
  const settingsJson = institution.data.settings_json;
  const school = parseSchoolCyclesSettings(settingsJson);
  if (!school.enabled) throw new Error("not_specialized_school");
  const { data: all, error: classesError } = await service.from("classes")
    .select("id,institution_id,label,level,academic_year")
    .eq("institution_id", institutionId).eq("academic_year", year).order("id").limit(501);
  if (classesError || !all) throw new Error("director_classes_unavailable");
  if (all.length > 500) throw new Error("director_classes_limit");
  const allClasses = all as ClassRow[];
  const permitted = listDirectorClasses(settingsJson, year, principal.teachingTrack, allClasses)
    .filter(row => principal.cycles.includes(row.cycle));
  if (!permitted.length) return { schoolName: institution.data.name, year, classes: [], limited: false };
  const allowedIds = permitted.map(row => row.id);
  const allIds = allClasses.map(row => row.id);
  const [enrollments, subjects, teacherAssignments, evaluations] = await Promise.all([
    service.from("class_enrollments").select("class_id,student_id,end_date")
      .eq("institution_id", institutionId).in("class_id", allIds)
      .is("end_date", null).order("class_id").limit(5001),
    service.from("institution_subjects").select("id,subject_id,custom_name")
      .eq("institution_id", institutionId).eq("is_active", true).limit(501),
    service.from("class_teachers").select("class_id,teacher_id,subject_id")
      .eq("institution_id", institutionId).in("class_id", allowedIds)
      .is("end_date", null).limit(1001),
    service.from("grade_evaluations")
      .select("id,class_id,subject_id,eval_date,title,is_published,publication_status")
      .in("class_id", allowedIds).eq("academic_year", year)
      .order("eval_date", { ascending: false }).limit(1001),
  ]);
  if (enrollments.error || subjects.error || teacherAssignments.error || evaluations.error)
    throw new Error("director_pedagogical_data_unavailable");
  const limited = (enrollments.data || []).length > 5000 ||
    (subjects.data || []).length > 500 ||
    (teacherAssignments.data || []).length > 1000 ||
    (evaluations.data || []).length > 1000;
  // Refuse partial rosters rather than silently expose misleading totals.
  if (limited) throw new Error("director_workspace_limit");
  const membership = directorStudentMembership(
    settingsJson, year, principal.teachingTrack, allClasses,
    (enrollments.data || []) as EnrollmentRow[],
  ).filter(row => principal.cycles.includes(row.cycle));
  const studentIds = [...new Set(membership.map(row => row.studentId))];
  const [studentRows, canonicalSubjects] = await Promise.all([
    studentIds.length ? service.from("students")
      .select("id,full_name,first_name,last_name,matricule")
      .eq("institution_id", institutionId).in("id", studentIds) : Promise.resolve({ data: [], error: null }),
    service.from("subjects").select("id,name").limit(1001),
  ]);
  if (studentRows.error || canonicalSubjects.error) throw new Error("director_metadata_unavailable");
  const studentMap = new Map((studentRows.data || []).map(row => [row.id, {
    id: row.id, name: row.full_name || [row.last_name,row.first_name].filter(Boolean).join(" "),
    matricule: row.matricule,
  }]));
  const institutionSubject = new Map((subjects.data || []).map(row => [row.id, row]));
  const subjectNames = new Map((canonicalSubjects.data || []).map(row => [row.id, row.name]));
  const classCycle = new Map(permitted.map(row => [row.id, row.cycle]));
  const subjectFor = (raw: string | null, classId: string) => {
    if (!raw) return null;
    const canonical = institutionSubject.get(raw)?.subject_id || raw;
    const cycle = classCycle.get(classId);
    if (!cycle || !directorSubjectPermitted(school, cycle, principal.teachingTrack, canonical)) return null;
    return { id: canonical, name: institutionSubject.get(raw)?.custom_name || subjectNames.get(canonical) || "Discipline" };
  };
  const teachers = (teacherAssignments.data || [] as TeacherAssignment[])
    .flatMap(row => {
      const subject = subjectFor(row.subject_id, row.class_id);
      return subject ? [{ classId: row.class_id, id: row.teacher_id, subject: subject.name }] : [];
    });
  const teacherIds = [...new Set(teachers.map(row => row.id))];
  const profiles = teacherIds.length ? await service.from("profiles")
    .select("id,display_name").eq("institution_id", institutionId).in("id", teacherIds)
    : { data: [], error: null };
  if (profiles.error) throw new Error("director_teachers_unavailable");
  const teacherNames = new Map((profiles.data || []).map(row => [row.id, row.display_name || "Enseignant"]));
  const scopedEvaluations = (evaluations.data || [] as Evaluation[]).flatMap(row => {
    const subject = subjectFor(row.subject_id, row.class_id);
    return subject ? [{ classId: row.class_id, id: row.id, title: row.title || "Évaluation",
      date: row.eval_date, published: row.is_published && (!row.publication_status || row.publication_status === "published"),
      subject: subject.name }] : [];
  });
  return {
    schoolName: institution.data.name, year, limited: false,
    classes: permitted.map(row => ({
      id: row.id, label: row.label, level: row.level || null, cycle: row.cycle,
      studentCount: membership.filter(x => x.classId === row.id && studentMap.has(x.studentId)).length,
      students: membership.filter(x => x.classId === row.id).flatMap(x => {
        const student = studentMap.get(x.studentId);
        return student ? [student] : [];
      }),
      teachers: teachers.filter(x => x.classId === row.id)
        .map(x => ({ id: x.id, name: teacherNames.get(x.id) || "Enseignant", subject: x.subject })),
      recentEvaluations: scopedEvaluations.filter(x => x.classId === row.id)
        .slice(0,12).map(x => ({ id: x.id, title: x.title, date: x.date,
          published: x.published, subject: x.subject })),
    })),
  };
}
