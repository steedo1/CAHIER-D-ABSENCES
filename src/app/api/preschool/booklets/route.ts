import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole, getRequestRoles } from "@/lib/auth/server-context";
import { listApplicableGradePeriods } from "@/lib/education-grading-periods";
import { parseSchoolCyclesSettings, resolveSchoolCycleForClass, isTeachingTrack } from "@/lib/school-cycles";
import {
  expandPedagogicalEnrollments, programsForStudent, readStudentProgramSettings,
} from "@/lib/school-student-programs";
import { schoolSettingsRevision, writeSchoolSettings } from "@/lib/school-settings-write";
import {
  parsePreschoolStore, validPreschoolCatalog, validPreschoolRecord,
  setPreschoolCatalog, setPreschoolRecord, getPreschoolRecord, preschoolRecordReady,
} from "@/lib/preschool-booklet-store";

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
    service.from("institutions").select("settings_json").eq("id", auth.instId).maybeSingle(),
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
  } as const;
}
async function getScope(scoped: Exclude<Awaited<ReturnType<typeof context>>, { error: NextResponse }>,
  year: string, classId: string) {
  if (!/^\d{4}-\d{4}$/.test(year)) throw Error("invalid_year");
  const classes = await collect<SchoolClass>((from, to) => scoped.service.from("classes")
    .select("id,level,label,academic_year").eq("institution_id", scoped.instId)
    .eq("academic_year", year).order("id").range(from, to), 1000);
  const available = classes.filter(row => resolveSchoolCycleForClass(row, scoped.school) === "preschool");
  let assigned = new Set<string>();
  if (!scoped.admin && scoped.teacher) {
    const matches = await collect<{ class_id: string }>((from, to) => scoped.service.from("class_teachers")
      .select("class_id").eq("institution_id", scoped.instId).eq("teacher_id", scoped.userId)
      .is("end_date", null).order("id").range(from, to), 1000);
    assigned = new Set(matches.map(row => row.class_id));
  }
  const permittedClasses = scoped.admin || !scoped.teacher ? available :
    available.filter(row => assigned.has(row.id));
  if (classId && !permittedClasses.some(row => row.id === classId)) {
    throw Error("class_forbidden");
  }
  return { classes: permittedClasses, selected: available.find(row => row.id === classId) || null,
    allClasses: classes };
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
      const tracks = programsForStudent(policies?.classes[classId], row.id, allowed);
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
  const store = parsePreschoolStore(scoped.settings);
  if (!year || !classId) {
    // The school is already verified and the caller is authenticated.
    // List classes from a single year without ever showing another institution.
    const selectedYear = year || `${new Date().getUTCFullYear()}-${new Date().getUTCFullYear() + 1}`;
    try {
      const classes = await getScope(scoped, selectedYear, "");
      return response({ ok: true, year: selectedYear, classes: classes.classes,
        catalogs: store.catalogs, admin: scoped.admin });
    } catch (error) {
      return response({ ok: false, error: String(error) }, 503);
    }
  }
  if (!UUID.test(classId) || (periodId && !UUID.test(periodId))) {
    return response({ ok: false, error: "invalid_ids" }, 400);
  }
  try {
    const full = await getBookletScope(scoped, year, classId);
    if (periodId && !full.periods.some(row => row.id === periodId)) {
      return response({ ok: false, error: "invalid_period" }, 400);
    }
    const records: Record<string, Record<string, unknown>> = {};
    if (periodId) for (const student of full.students) {
      for (const track of student.tracks) {
        const record = getPreschoolRecord(store, year, classId, periodId, track, student.id);
        (records[student.id] ||= {})[track] = {
          record, ready: preschoolRecordReady(store.catalogs[track] || [], record),
        };
      }
    }
    return response({ ok: true, year, schoolClass: full.selected,
      students: full.students, periods: full.periods,
      programs: scoped.school.teachingTracksByCycle.preschool || [],
      format: (scoped.settings as Record<string, any>)?.franco_arabic_reports_v1?.formatsByCycle?.preschool || "separate",
      catalogs: store.catalogs, records,
      revision: schoolSettingsRevision(scoped.settings),
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
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      data.revision !== schoolSettingsRevision(scoped.settings)) {
    return response({ ok: false, error: "settings_changed_reload_required" }, 409);
  }
  const store = parsePreschoolStore(scoped.settings);
  if (!isTeachingTrack(data.track) ||
      !(scoped.school.teachingTracksByCycle.preschool || []).includes(data.track)) {
    return response({ ok: false, error: "invalid_preschool_track" }, 400);
  }
  let next: Record<string, unknown>;
  if (data.mode === "catalog") {
    if (!scoped.admin) return response({ ok: false, error: "forbidden" }, 403);
    if (!validPreschoolCatalog(data.competencies)) {
      return response({ ok: false, error: "invalid_competency_catalog" }, 400);
    }
    const ids = new Set(data.competencies.map((row: { id: string }) => row.id));
    const obsolete = (store.catalogs[data.track] || []).filter(row => !ids.has(row.id));
    if (obsolete.length) {
      // Old answers must not silently disappear when an administrator edits the list.
      return response({ ok: false, error: "competency_removal_requires_archival" }, 409);
    }
    next = setPreschoolCatalog(scoped.settings, data.track, data.competencies);
  } else if (data.mode === "record") {
    if (!scoped.admin && !scoped.teacher) return response({ ok: false, error: "forbidden" }, 403);
    if (![data.class_id, data.period_id, data.student_id].every((v: unknown) =>
      typeof v === "string" && UUID.test(v)) || !/^\d{4}-\d{4}$/.test(data.year)) {
      return response({ ok: false, error: "invalid_context" }, 400);
    }
    const catalog = store.catalogs[data.track] || [];
    if (!catalog.length || !validPreschoolRecord(data.record, catalog)) {
      return response({ ok: false, error: "invalid_preschool_observations" }, 400);
    }
    try {
      const full = await getBookletScope(scoped, data.year, data.class_id);
      if (!full.periods.some(row => row.id === data.period_id)) {
        return response({ ok: false, error: "invalid_period" }, 400);
      }
      if (!full.students.some(row => row.id === data.student_id && row.tracks.includes(data.track))) {
        return response({ ok: false, error: "student_program_forbidden" }, 403);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "school_data_unavailable";
      return response({ ok: false, error: message }, statusFor(message));
    }
    next = setPreschoolRecord(scoped.settings, {
      year: data.year, classId: data.class_id, periodId: data.period_id,
      track: data.track, studentId: data.student_id, record: data.record,
      actor: scoped.userId,
    });
  } else return response({ ok: false, error: "invalid_mode" }, 400);
  // Bounded persistence: prevent JSONB school settings from becoming a large
  // unbounded grade database. Explicitly fail instead of losing data.
  if (JSON.stringify(next).length > 2_000_000) {
    return response({ ok: false, error: "preschool_store_capacity_reached" }, 422);
  }
  const result = await writeSchoolSettings(scoped.service, scoped.instId, scoped.settings, next);
  if ("error" in result) return response({ ok: false, error: result.error }, result.status);
  return response({ ok: true, revision: result.revision });
}
