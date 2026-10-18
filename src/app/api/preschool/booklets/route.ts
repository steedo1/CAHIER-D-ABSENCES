import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole, getRequestRoles } from "@/lib/auth/server-context";
import { listApplicableGradePeriods } from "@/lib/education-grading-periods";
import { resolveEvaluationTeachingTrack } from "@/lib/pedagogical-engine";
import { parseSchoolCyclesSettings, resolveSchoolCycleForClass, isTeachingTrack, type TeachingTrack } from "@/lib/school-cycles";
import {
  expandPedagogicalEnrollments, programsForStudent, readStudentProgramSettings,
} from "@/lib/school-student-programs";
import { readSchoolTeachingSignatories } from "@/lib/school-teaching-signatories";
import {
  validPreschoolCatalog, validPreschoolRecord, preschoolRecordReady,
} from "@/lib/preschool-booklet-store";
import {
  readPrivatePreschoolRecord, writePrivatePreschoolRecord,
  readPreschoolCatalogs, writePreschoolCatalog,
} from "@/lib/preschool-private-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (data: unknown, status = 200) => NextResponse.json(data, {
  status, headers: { "Cache-Control": "private, no-store" },
});
const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
type SchoolClass = { id: string; level: string | null; label: string | null; academic_year: string };
type Enrollment = { class_id: string; student_id: string; end_date?: string | null };

async function collect<T>(query: (from: number, to: number) =>
  PromiseLike<{ data: T[] | null; error: unknown }>, maxRows = 10000): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < maxRows; i += 500) {
    const page = await query(i, i + 499);
    if (page.error) throw Error("school_data_unavailable");
    all.push(...(page.data || []));
    if ((page.data || []).length < 500) return all;
  }
  throw Error("too_many_school_rows");
}
async function context() {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const auth = await requireInstitutionRole(client, service, [
    "admin", "super_admin", "teacher", "file_correspondent",
  ]);
  if ("error" in auth) return { error: response({ ok: false, error: auth.error },
    auth.error === "unauthorized" ? 401 : 403) } as const;
  const [roles, institution] = await Promise.all([
    getRequestRoles(client, service, auth.user.id),
    service.from("institutions").select("settings_json,name,code_unique").eq("id", auth.instId).maybeSingle(),
  ]);
  if (roles.error || institution.error || !institution.data) {
    return { error: response({ ok: false, error: "school_unavailable" }, 503) } as const;
  }
  const school = parseSchoolCyclesSettings(institution.data.settings_json);
  if (!school.enabled || !school.enabledCycles.includes("preschool")) {
    return { error: response({ ok: false, error: "not_preschool_school" }, 404) } as const;
  }
  const applicable = (roles.data || []).filter(row =>
    !row.institution_id || row.institution_id === auth.instId);
  const admin = applicable.some(row => row.role === "admin" || row.role === "super_admin");
  const teacher = applicable.some(row => row.role === "teacher");
  const read = admin || teacher || applicable.some(row => row.role === "file_correspondent");
  if (!read) return { error: response({ ok: false, error: "forbidden" }, 403) } as const;
  return {
    service, school, admin, teacher, instId: auth.instId, userId: auth.user.id,
    settings: institution.data.settings_json,
    schoolName: institution.data.name, schoolCode: institution.data.code_unique,
  } as const;
}
async function getScope(scoped: Exclude<Awaited<ReturnType<typeof context>>, { error: NextResponse }>,
  year: string, classId: string) {
  if (!/^\d{4}-\d{4}$/.test(year)) throw Error("invalid_year");
  const classes = await collect<SchoolClass>((from, to) => scoped.service.from("classes")
    .select("id,level,label,academic_year").eq("institution_id", scoped.instId)
    .eq("academic_year", year).order("id").range(from, to), 1000);
  const available = classes.filter(row => resolveSchoolCycleForClass(row, scoped.school) === "preschool");
  const teacherTracks = new Map<string, Set<"french" | "arabic">>();
  if (!scoped.admin && scoped.teacher) {
    const matches = await collect<{ class_id: string; subject_id: string | null }>(
      (from, to) => scoped.service.from("class_teachers")
        .select("class_id,subject_id").eq("institution_id", scoped.instId)
        .eq("teacher_id", scoped.userId).is("end_date", null).order("id").range(from, to), 1000);
    for (const row of matches) {
      const granted = teacherTracks.get(row.class_id) || new Set<"french" | "arabic">();
      const ownTrack = row.subject_id
        ? resolveEvaluationTeachingTrack(scoped.settings, "preschool", row.subject_id)
        : null;
      if (ownTrack) granted.add(ownTrack);
      // A single-track preschool can have a homeroom assignment with no
      // subject. Never extend such an implicit assignment to a bilingual school.
      if (!row.subject_id && scoped.school.teachingTracksByCycle.preschool?.length === 1) {
        granted.add(scoped.school.teachingTracksByCycle.preschool[0]);
      }
      teacherTracks.set(row.class_id, granted);
    }
  }
  const permittedClasses = scoped.admin || !scoped.teacher ? available :
    available.filter(row => (teacherTracks.get(row.id)?.size || 0) > 0);
  if (classId && !permittedClasses.some(row => row.id === classId)) {
    throw Error("class_forbidden");
  }
  return { classes: permittedClasses, selected: available.find(row => row.id === classId) || null,
    allClasses: classes, teacherTracks };
}
async function getBookletScope(scoped: Exclude<Awaited<ReturnType<typeof context>>, { error: NextResponse }>,
  year: string, classId: string) {
  const selectedScope = await getScope(scoped, year, classId);
  if (!selectedScope.selected) throw Error("class_forbidden");
  const enrollment = await collect<Enrollment>((from, to) => scoped.service.from("class_enrollments")
    .select("class_id,student_id,end_date").eq("institution_id", scoped.instId)
    .is("end_date", null).order("id").range(from, to));
  const policies = readStudentProgramSettings(scoped.settings).years[year];
  const mapped = expandPedagogicalEnrollments(scoped.school, policies,
    selectedScope.allClasses.map(row => ({
      id: row.id, level: row.level, cycle: resolveSchoolCycleForClass(row, scoped.school),
    })), enrollment);
  const members = mapped.filter(row => row.class_id === classId);
  const ids = [...new Set(members.map(row => row.student_id))];
  const students: Array<{ id: string; name: string; matricule: string | null; tracks: Array<"french" | "arabic"> }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const result = await scoped.service.from("students")
      .select("id,full_name,matricule,institution_id").eq("institution_id", scoped.instId)
      .in("id", batch);
    if (result.error) throw Error("students_unavailable");
    for (const row of result.data || []) {
      const allowed = scoped.school.teachingTracksByCycle.preschool || [];
      const tracks = programsForStudent(policies?.classes[classId], row.id, allowed)
        .filter(track => scoped.admin || !scoped.teacher ||
          selectedScope.teacherTracks.get(classId)?.has(track) === true);
      students.push({ id: row.id, name: String(row.full_name || "Élève"),
        matricule: row.matricule, tracks });
    }
  }
  const periods = await listApplicableGradePeriods(scoped.service, scoped.instId, year, classId);
  return {
    ...selectedScope, students: students.sort((a, b) => a.name.localeCompare(b.name, "fr")),
    periods: periods.items.filter(row => row.is_active !== false && row.start_date && row.end_date),
  };
}
function statusFor(error: string): number {
  if (error.includes("forbidden")) return 403;
  if (error.startsWith("invalid_")) return 400;
  if (error.includes("too_many")) return 422;
  return 503;
}
export async function GET(request: NextRequest) {
  const scoped = await context();
  if ("error" in scoped) return scoped.error;
  const url = request.nextUrl;
  const year = url.searchParams.get("year") || "";
  const classId = url.searchParams.get("class_id") || "";
  const periodId = url.searchParams.get("period_id") || "";
  const studentId = url.searchParams.get("student_id") || "";
  let store: Awaited<ReturnType<typeof readPreschoolCatalogs>>;
  try {
    store = await readPreschoolCatalogs(scoped.service, scoped.instId);
  } catch {
    return response({ ok: false, error: "preschool_catalog_storage_unavailable" }, 503);
  }
  if (!year || !classId) {
    // The school is already verified and the caller is authenticated.
    // List classes from a single year without ever showing another institution.
    const today = new Date();
    const start = today.getUTCMonth() >= 7 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    const selectedYear = year || `${start}-${start + 1}`;
    try {
      const classes = await getScope(scoped, selectedYear, "");
      return response({ ok: true, year: selectedYear, classes: classes.classes,
        catalogs: store.catalogs, catalogRevisions: store.revisions, admin: scoped.admin });
    } catch (error) {
      return response({ ok: false, error: String(error) }, 503);
    }
  }
  if (!UUID.test(classId) || (periodId && !UUID.test(periodId)) ||
      (studentId && !UUID.test(studentId))) {
    return response({ ok: false, error: "invalid_ids" }, 400);
  }
  try {
    const full = await getBookletScope(scoped, year, classId);
    if (periodId && !full.periods.some(row => row.id === periodId)) {
      return response({ ok: false, error: "invalid_period" }, 400);
    }
    const records: Record<string, Record<string, unknown>> = {};
    if (studentId && periodId) {
      const student = full.students.find(row => row.id === studentId);
      if (!student) return response({ ok: false, error: "student_program_forbidden" }, 403);
      for (const track of student.tracks) {
        const record = await readPrivatePreschoolRecord(scoped.service, {
          institutionId: scoped.instId, year, classId, periodId, track, studentId,
        });
        (records[student.id] ||= {})[track] = {
          record, ready: preschoolRecordReady(store.catalogs[track] || [], record),
        };
      }
    }
    return response({ ok: true, year, schoolClass: full.selected,
      students: full.students, periods: full.periods,
      programs: scoped.school.teachingTracksByCycle.preschool || [],
      format: (scoped.settings as Record<string, any>)?.franco_arabic_reports_v1?.formatsByCycle?.preschool || "separate",
      catalogs: store.catalogs, catalogRevisions: store.revisions,
      records, schoolName: scoped.schoolName,
      schoolCode: scoped.schoolCode,
      signatories: readSchoolTeachingSignatories(scoped.settings),
      admin: scoped.admin, editable: scoped.admin || scoped.teacher,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "school_data_unavailable";
    return response({ ok: false, error: message }, statusFor(message));
  }
}
export async function PUT(request: NextRequest) {
  const scoped = await context();
  if ("error" in scoped) return scoped.error;
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return response({ ok: false, error: "invalid_origin" }, 403);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return response({ ok: false, error: "expected_json" }, 415);
  }
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return response({ ok: false, error: "invalid_request" }, 400);
  }
  if (!isTeachingTrack(data.track) ||
      !(scoped.school.teachingTracksByCycle.preschool || []).includes(data.track)) {
    return response({ ok: false, error: "invalid_preschool_track" }, 400);
  }
  const selectedTrack = data.track as TeachingTrack;
  if (data.mode === "catalog") {
    if (!scoped.admin) return response({ ok: false, error: "forbidden" }, 403);
    if (!validPreschoolCatalog(data.competencies)) {
      return response({ ok: false, error: "invalid_competency_catalog" }, 400);
    }
    try {
      const current = await readPreschoolCatalogs(scoped.service, scoped.instId);
      const ids = new Set((data.competencies as Array<{ id: string }>).map(row => row.id));
      if ((current.catalogs[selectedTrack] || []).some(row => !ids.has(row.id))) {
        return response({ ok: false, error: "competency_removal_requires_archival" }, 409);
      }
      const revision = await writePreschoolCatalog(scoped.service, scoped.instId, selectedTrack,
        data.competencies, scoped.userId, data.expectedCatalogRevision);
      return response({ ok: true, catalogRevision: revision });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "preschool_catalog_save_failed";
      return response({ ok: false, error: message },
        message === "catalog_changed_reload_required" ? 409 :
        message === "invalid_preschool_catalog" ? 400 : 503);
    }
  } else if (data.mode === "record") {
    if (!scoped.admin && !scoped.teacher) return response({ ok: false, error: "forbidden" }, 403);
    if (![data.class_id, data.period_id, data.student_id].every((v: unknown) =>
      typeof v === "string" && UUID.test(v)) || !/^\d{4}-\d{4}$/.test(data.year)) {
      return response({ ok: false, error: "invalid_context" }, 400);
    }
    let catalog;
    try {
      const current = await readPreschoolCatalogs(scoped.service, scoped.instId);
      catalog = current.catalogs[selectedTrack] || [];
    } catch {
      return response({ ok: false, error: "preschool_catalog_storage_unavailable" }, 503);
    }
    if (!catalog.length || !validPreschoolRecord(data.record, catalog)) {
      return response({ ok: false, error: "invalid_preschool_observations" }, 400);
    }
    try {
      const full = await getBookletScope(scoped, data.year, data.class_id);
      if (!full.periods.some(row => row.id === data.period_id)) {
        return response({ ok: false, error: "invalid_period" }, 400);
      }
      if (!full.students.some(row => row.id === data.student_id && row.tracks.includes(selectedTrack))) {
        return response({ ok: false, error: "student_program_forbidden" }, 403);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "school_data_unavailable";
      return response({ ok: false, error: message }, statusFor(message));
    }
    try {
      const saved = await writePrivatePreschoolRecord(scoped.service, {
        institutionId: scoped.instId, year: data.year, classId: data.class_id,
        periodId: data.period_id, track: selectedTrack, studentId: data.student_id,
      }, data.record, scoped.userId, typeof data.expectedEditedAt === "string"
        ? data.expectedEditedAt : null);
      return response({ ok: true, editedAt: saved.editedAt });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "preschool_record_save_failed";
      return response({ ok: false, error: message },
        message === "record_changed_reload_required" ? 409 :
        message === "preschool_record_too_large" ? 422 : 503);
    }
  }
  return response({ ok: false, error: "invalid_mode" }, 400);
}
