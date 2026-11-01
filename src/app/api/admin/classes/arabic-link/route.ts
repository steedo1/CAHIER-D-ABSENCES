import { NextRequest, NextResponse } from "next/server";
import { requireInstitutionAccess } from "@/app/api/admin/_helpers/institutionAccess";
import { parseSchoolCyclesSettings, inferSchoolCycleFromLevel } from "@/lib/school-cycles";
import { sameSchoolLevel } from "@/lib/school-levels";
import {
  SCHOOL_STUDENT_PROGRAMS_KEY,
  isBilingualSchool,
  programsForStudent,
  readStudentProgramSettings,
} from "@/lib/school-student-programs";
import { asSettingsObject, writeSchoolSettings } from "@/lib/school-settings-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ROLES = [
  "admin", "super_admin", "founder", "file_correspondent", "finance_manager", "finance",
] as const;
const reply = (payload: unknown, status = 200) => NextResponse.json(payload, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * Associate an existing pupil with an Arabic teaching class.
 * Never transfer the administrative enrollment, mutate the pupil or reconcile
 * school fees: the French (home) class remains authoritative.
 */
export async function POST(request: NextRequest) {
  const access = await requireInstitutionAccess({ allowedRoles: ALLOWED_ROLES });
  if ("error" in access) return access.error;
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return reply({ error: "invalid_origin" }, 403);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return reply({ error: "expected_json" }, 415);
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply({ error: "invalid_payload" }, 400);
  }
  const classId = String(body.class_id || "").trim();
  const studentId = String(body.student_id || "").trim();
  const matricule = String(body.matricule || "").trim();
  if (!UUID.test(classId) || (!UUID.test(studentId) && !matricule) ||
    (studentId && !UUID.test(studentId)) || matricule.length > 100) {
    return reply({ error: "invalid_student_or_class" }, 400);
  }

  const { srv, institutionId } = access;
  const [targetResult, institutionResult] = await Promise.all([
    srv.from("classes").select("id,label,level,academic_year,institution_id")
      .eq("institution_id", institutionId).eq("id", classId).maybeSingle(),
    srv.from("institutions").select("settings_json").eq("id", institutionId).maybeSingle(),
  ]);
  const target = targetResult.data;
  const rawSettings = institutionResult.data?.settings_json;
  if (targetResult.error || institutionResult.error) return reply({ error: "school_load_failed" }, 503);
  if (!target) return reply({ error: "class_not_found" }, 404);
  if (!institutionResult.data) return reply({ error: "school_unavailable" }, 503);

  const school = parseSchoolCyclesSettings(rawSettings);
  if (!isBilingualSchool(school)) return reply({ error: "not_bilingual_school" }, 404);
  const cycle = school.classCycleById[classId] || inferSchoolCycleFromLevel(target.level);
  const year = String(target.academic_year || "");
  const policy = readStudentProgramSettings(rawSettings);
  const yearPolicy = policy.years[year];
  const targetPolicy = yearPolicy?.classes[classId];
  if (!cycle || !school.enabledCycles.includes(cycle) ||
    !school.teachingTracksByCycle[cycle]?.includes("arabic") ||
    targetPolicy?.tracks.length !== 1 || targetPolicy.tracks[0] !== "arabic") {
    return reply({ error: "arabic_class_not_configured" }, 409);
  }

  const pupilQuery = srv.from("students")
    .select("id,first_name,last_name,matricule")
    .eq("institution_id", institutionId);
  const { data: pupil, error: pupilError } = studentId
    ? await pupilQuery.eq("id", studentId).maybeSingle()
    : await pupilQuery.eq("matricule", matricule).maybeSingle();
  if (pupilError) return reply({ error: "student_lookup_failed" }, 503);
  if (!pupil) return reply({ error: "student_not_found" }, 404);

  const { data: active, error: enrollmentError } = await srv
    .from("class_enrollments").select("class_id,student_id")
    .eq("institution_id", institutionId).eq("student_id", pupil.id)
    .is("end_date", null).limit(100);
  if (enrollmentError || !active || active.length >= 100) {
    return reply({ error: "enrollments_load_failed" }, 503);
  }
  if (!active.length) return reply({ error: "student_has_no_home_class" }, 409);
  const { data: homes, error: homesError } = await srv
    .from("classes").select("id,level,academic_year")
    .eq("institution_id", institutionId).eq("academic_year", year)
    .in("id", [...new Set(active.map(row => row.class_id))]);
  if (homesError || !homes) return reply({ error: "source_class_unavailable" }, 503);
  const relevant = active.filter(row => homes.some(home => home.id === row.class_id));
  if (relevant.length !== 1) return reply({ error: "student_home_ambiguous_for_year" }, 409);
  const source = homes.find(home => home.id === relevant[0].class_id)!;
  if (source.id === classId) return reply({ ok: true, already_present: true, student: pupil });
  const sourceCycle = school.classCycleById[source.id] || inferSchoolCycleFromLevel(source.level);
  if (!sourceCycle || sourceCycle !== cycle || !source.level || !target.level ||
    !sameSchoolLevel(source.level, target.level, cycle)) {
    return reply({ error: "student_not_same_level_or_cycle" }, 409);
  }
  const homeTracks = programsForStudent(
    yearPolicy?.classes[source.id], pupil.id, school.teachingTracksByCycle[cycle] || [],
  );
  if (homeTracks.length !== 1 || homeTracks[0] !== "french") {
    return reply({ error: "french_home_not_configured" }, 409);
  }
  const links = targetPolicy.linkedStudentIds || [];
  if (links.includes(pupil.id)) return reply({ ok: true, already_present: true, student: pupil });
  if (links.length >= 700) return reply({ error: "arabic_class_full" }, 409);

  // An Arabic-to-Arabic transfer moves the pedagogical link (not the home).
  const oldIds = Object.entries(yearPolicy?.classes || {})
    .filter(([id, value]) => id !== classId && value.tracks.length === 1 &&
      value.tracks[0] === "arabic" && value.linkedStudentIds?.includes(pupil.id))
    .map(([id]) => id);
  if (oldIds.length > 1) return reply({ error: "multiple_arabic_links_require_review" }, 409);
  if (oldIds.length) {
    const { data: previous, error } = await srv.from("classes")
      .select("id,level,academic_year").eq("institution_id", institutionId)
      .eq("academic_year", year).in("id", oldIds);
    if (error || !previous || previous.length !== oldIds.length ||
      previous.some(row => {
        const previousCycle = school.classCycleById[row.id] || inferSchoolCycleFromLevel(row.level);
        return previousCycle !== cycle || !sameSchoolLevel(row.level, target.level, cycle);
      })) {
      return reply({ error: "prior_arabic_class_requires_review" }, 409);
    }
  }

  const classes = { ...(yearPolicy?.classes || {}) };
  for (const id of oldIds) {
    const old = classes[id];
    classes[id] = { ...old, linkedStudentIds: (old.linkedStudentIds || []).filter(id => id !== pupil.id) };
  }
  classes[classId] = { ...targetPolicy, linkedStudentIds: [...links, pupil.id] };
  const next = {
    ...asSettingsObject(rawSettings),
    [SCHOOL_STUDENT_PROGRAMS_KEY]: {
      ...policy, years: { ...policy.years, [year]: { classes } },
    },
  };
  const saved = await writeSchoolSettings(srv, institutionId, rawSettings, next);
  if ("error" in saved) return reply({ error: saved.error }, saved.status);
  return reply({ ok: true, student: pupil, transferred: oldIds.length > 0 });
}
