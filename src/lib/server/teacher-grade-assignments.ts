import type { SupabaseClient } from "@supabase/supabase-js";
import { getRequestRoles } from "@/lib/auth/server-context";
import { classDeviceMayAccessClass } from "@/lib/class-device-identity";

type Assignment = {
  class_id: string;
  subject_id: string;
  classes: {
    label: string;
    level: string;
    academic_year: string;
    education_type: string | null;
    formation_code: string | null;
    formation_level_code: string | null;
  };
  institution_subjects: {
    subject_id: string;
    custom_name: string | null;
    subjects: { name: string };
  };
};

export async function loadTeacherGradeAssignments(
  service: SupabaseClient,
  institutionId: string,
  teacherId: string,
  classId?: string,
  canonicalSubjectId?: string,
) {
  const year = await service.from("academic_years").select("code")
    .eq("institution_id", institutionId).eq("is_current", true).maybeSingle();
  if (year.error) throw year.error;
  if (!year.data?.code) return [];

  const today = new Date().toISOString().slice(0, 10);
  let query = service.from("class_teachers")
    .select("class_id,subject_id,classes!inner(label,level,academic_year,education_type,formation_code,formation_level_code),institution_subjects!inner(subject_id,custom_name,subjects!inner(name))")
    .eq("institution_id", institutionId).eq("teacher_id", teacherId)
    .eq("classes.institution_id", institutionId).eq("classes.academic_year", year.data.code)
    .eq("institution_subjects.institution_id", institutionId).eq("institution_subjects.is_active", true)
    .lte("start_date", today).or(`end_date.is.null,end_date.gt.${today}`);
  if (classId) query = query.eq("class_id", classId);
  if (canonicalSubjectId) query = query.eq("institution_subjects.subject_id", canonicalSubjectId).limit(1);

  const result = await query;
  if (result.error) throw result.error;
  return (result.data || []) as unknown as Assignment[];
}

export async function teacherHasGradeAssignment(
  service: SupabaseClient,
  institutionId: string,
  teacherId: string,
  classId: string,
  canonicalSubjectId: string | null,
) {
  return !!canonicalSubjectId && (await loadTeacherGradeAssignments(
    service, institutionId, teacherId, classId, canonicalSubjectId,
  )).length > 0;
}

export async function resolveTeacherGradeSubject(
  service: SupabaseClient,
  institutionId: string,
  rawSubjectId: string,
) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(rawSubjectId)) return null;
  const { data, error } = await service.from("institution_subjects")
    .select("subject_id").eq("institution_id", institutionId)
    .or(`id.eq.${rawSubjectId},subject_id.eq.${rawSubjectId}`).maybeSingle();
  if (error) throw error;
  return typeof data?.subject_id === "string" ? data.subject_id : null;
}

export async function gradeClassAccess(
  authClient: SupabaseClient,
  service: SupabaseClient,
  userId: string,
  institutionId: string,
  classId: string,
  canonicalSubjectId: string | null,
  options?: { evaluationOwner?: string | null; allowFileCorrespondent?: boolean },
) {
  const { data, error } = await getRequestRoles(authClient, service, userId);
  if (error) throw error;
  const roles = new Set((data || []).filter(row => row.institution_id === institutionId).map(row => row.role));
  if (["super_admin", "admin", "educator"].some(role => roles.has(role))) return "staff";
  if (options?.allowFileCorrespondent && roles.has("file_correspondent")) return "staff";
  if (roles.has("teacher")) {
    if (options && "evaluationOwner" in options && options.evaluationOwner !== userId) return null;
    return await teacherHasGradeAssignment(service, institutionId, userId, classId, canonicalSubjectId)
      ? "teacher" : null;
  }
  if (roles.has("class_device") && await classDeviceMayAccessClass({ service, userId, classId })) return "class_device";
  return null;
}
