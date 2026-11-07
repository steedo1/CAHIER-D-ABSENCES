import { NextRequest, NextResponse } from "next/server";
import { requireInstitutionAccess } from "@/app/api/admin/_helpers/institutionAccess";
import { parseSchoolCyclesSettings, inferSchoolCycleFromLevel } from "@/lib/school-cycles";
import { sameSchoolLevel } from "@/lib/school-levels";
import {
  EPC_DIMBOKRO_CODE,
  SCHOOL_STUDENT_PROGRAMS_KEY,
  isBilingualSchool,
  programsForStudent,
  canLinkTeachingClass,
  readStudentProgramSettings,
} from "@/lib/school-student-programs";
import { asSettingsObject } from "@/lib/school-settings-write";
import { isTrustedAppOrigin } from "@/lib/request-origin";

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
 * Add or move a pedagogical membership while keeping the administrative
 * enrollment in the other teaching. Administrative moves use the assign API.
 */
export async function POST(request: NextRequest) {
  if (!isTrustedAppOrigin(request)) {
    return reply({ error: "invalid_origin" }, 403);
  }
  const access = await requireInstitutionAccess({ allowedRoles: ALLOWED_ROLES });
  if ("error" in access) return access.error;
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return reply({ error: "expected_json" }, 415);
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply({ error: "invalid_payload" }, 400);
  }
  // Cached clients may still send the original combined operation.
  const operation = body.operation;
  if (operation !== undefined && operation !== "add" && operation !== "transfer") {
    return reply({ error: "invalid_teaching_operation" }, 400);
  }
  const teaching = body.teaching ?? "arabic";
  if ((teaching !== "arabic" && teaching !== "french") || (teaching === "french" && !operation)) {
    return reply({ error: "invalid_teaching_operation" }, 400);
  }
  const otherTeaching = teaching === "arabic" ? "french" : "arabic";
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
    srv.from("institutions").select("code_unique,settings_json").eq("id", institutionId).maybeSingle(),
  ]);
  const target = targetResult.data;
  const rawSettings = institutionResult.data?.settings_json;
  if (targetResult.error || institutionResult.error) return reply({ error: "school_load_failed" }, 503);
  if (!target) return reply({ error: "class_not_found" }, 404);
  if (!institutionResult.data) return reply({ error: "school_unavailable" }, 503);

  const epc = institutionResult.data.code_unique === EPC_DIMBOKRO_CODE;
  if (teaching === "french" && !epc) return reply({ error: "french_class_not_configured" }, 409);
  const school = parseSchoolCyclesSettings(rawSettings);
  if (!isBilingualSchool(school)) return reply({ error: "not_bilingual_school" }, 404);
  const cycle = school.classCycleById[classId] || inferSchoolCycleFromLevel(target.level);
  const year = String(target.academic_year || "");
  const policy = readStudentProgramSettings(rawSettings);
  const yearPolicy = policy.years[year];
  const targetPolicy = yearPolicy?.classes[classId];
  if (!cycle || !school.enabledCycles.includes(cycle) ||
    !school.teachingTracksByCycle[cycle]?.includes(teaching) ||
    targetPolicy?.tracks.length !== 1 || targetPolicy.tracks[0] !== teaching) {
    return reply({ error: `${teaching}_class_not_configured` }, 409);
  }

  const pupilQuery = srv.from("students")
    .select("id,first_name,last_name,matricule")
    .eq("institution_id", institutionId)
    .or("lifecycle_status.is.null,lifecycle_status.eq.active");
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
  if (!sourceCycle || !school.enabledCycles.includes(sourceCycle)) {
    return reply({ error: "student_not_same_cycle_or_eligible_level" }, 409);
  }
  const homeTracks = programsForStudent(
    yearPolicy?.classes[source.id], pupil.id, school.teachingTracksByCycle[sourceCycle] || [],
  );
  if (epc && operation && homeTracks.length === 1 && homeTracks[0] === teaching) {
    if (teaching === "arabic" && !canLinkTeachingClass({ ...source, cycle: sourceCycle }, { ...target, cycle }, teaching)) {
      return reply({ error: "student_not_same_cycle_or_eligible_level" }, 409);
    }
    if (operation === "add") return reply({ error: `${teaching}_transfer_required` }, 409);
    const otherClasses = Object.entries(yearPolicy?.classes || {})
      .filter(([, value]) => value.tracks[0] === otherTeaching && value.linkedStudentIds?.includes(pupil.id))
      .map(([id]) => id);
    if (otherClasses.length) {
      const { data: links, error } = await srv.from("classes").select("id,level")
        .eq("institution_id", institutionId).eq("academic_year", year).in("id", otherClasses);
      const targetTracks = programsForStudent(targetPolicy, pupil.id, school.teachingTracksByCycle[cycle] || []);
      if (error || links?.length !== otherClasses.length || targetTracks.length !== 1 ||
        targetTracks[0] !== teaching || links.some(link => {
          const linkCycle = school.classCycleById[link.id] || inferSchoolCycleFromLevel(link.level);
          return !linkCycle || !school.enabledCycles.includes(linkCycle) ||
            !school.teachingTracksByCycle[linkCycle]?.includes(otherTeaching) ||
            !canLinkTeachingClass({ ...target, cycle }, { ...link, cycle: linkCycle }, otherTeaching,
              yearPolicy?.classes[link.id]?.independentFrenchLevels);
        })) {
        return reply({ error: "other_teaching_would_be_lost" }, 409);
      }
    }
    return reply({
      error: `${teaching}_administrative_transfer_required`,
      student_id: pupil.id,
      source_class_id: source.id,
    }, 409);
  }
  if (homeTracks.length !== 1 || homeTracks[0] !== otherTeaching) {
    return reply({ error: `${otherTeaching}_home_not_configured` }, 409);
  }
  if (!canLinkTeachingClass({ ...source, cycle: sourceCycle }, { ...target, cycle }, teaching, epc)) {
    return reply({ error: "student_not_same_cycle_or_eligible_level" }, 409);
  }
  const links = targetPolicy.linkedStudentIds || [];
  if (links.includes(pupil.id)) return reply({ ok: true, already_present: true, student: pupil });
  if (links.length >= 700) return reply({ error: `${teaching}_class_full` }, 409);

  // Move only the pedagogical membership in the selected teaching.
  const oldIds = Object.entries(yearPolicy?.classes || {})
    .filter(([id, value]) => id !== classId && value.tracks.length === 1 &&
      value.tracks[0] === teaching && value.linkedStudentIds?.includes(pupil.id))
    .map(([id]) => id);
  if (oldIds.length > 1) return reply({ error: `multiple_${teaching}_links_require_review` }, 409);
  if (operation === "add" && oldIds.length) {
    return reply({ error: `${teaching}_transfer_required` }, 409);
  }
  if (operation === "transfer" && !oldIds.length) {
    return reply({ error: `${teaching}_add_required` }, 409);
  }
  if (oldIds.length) {
    const { data: previous, error } = await srv.from("classes")
      .select("id,level,academic_year").eq("institution_id", institutionId)
      .eq("academic_year", year).in("id", oldIds);
    if (error || !previous || previous.length !== oldIds.length ||
      previous.some(row => {
        const previousCycle = school.classCycleById[row.id] || inferSchoolCycleFromLevel(row.level);
        return !previousCycle || !school.enabledCycles.includes(previousCycle) ||
          !school.teachingTracksByCycle[previousCycle]?.includes(teaching) ||
          !canLinkTeachingClass({ ...row, cycle: previousCycle }, { ...target, cycle }, teaching, epc);
      })) {
      return reply({ error: `prior_${teaching}_class_requires_review` }, 409);
    }
  }

  const classes = { ...(yearPolicy?.classes || {}) };
  for (const id of oldIds) {
    const old = classes[id];
    classes[id] = { ...old, linkedStudentIds: (old.linkedStudentIds || []).filter(id => id !== pupil.id) };
  }
  classes[classId] = {
    ...targetPolicy,
    linkedStudentIds: [...links, pupil.id],
    ...(teaching === "french" ? { independentFrenchLevels: true } : {}),
  };
  const next = {
    ...asSettingsObject(rawSettings),
    [SCHOOL_STUDENT_PROGRAMS_KEY]: {
      ...policy, years: { ...policy.years, [year]: { classes } },
    },
  };
  // A large whole-document PostgREST CAS generated an overlong URL on EPC.
  // Compare only the program policy, and update only that JSONB key atomically.
  // The database function is invoker-security and service_role-only.
  const { data: saved, error: saveError } = await srv.rpc("cas_school_student_programs_v1", {
    p_institution_id: institutionId,
    p_previous: asSettingsObject(rawSettings)[SCHOOL_STUDENT_PROGRAMS_KEY] ?? null,
    p_next: next[SCHOOL_STUDENT_PROGRAMS_KEY],
  });
  if (saveError) return reply({ error: "save_failed" }, 503);
  if (saved !== true) return reply({ error: "settings_changed_reload_required" }, 409);
  return reply({
    ok: true, student: pupil, transferred: oldIds.length > 0,
    french_level: teaching === "french" ? target.level : source.level,
    arabic_level: teaching === "arabic" ? target.level : source.level,
    french_cycle: teaching === "french" ? cycle : sourceCycle,
    arabic_cycle: teaching === "arabic" ? cycle : sourceCycle,
    cross_cycle: sourceCycle !== cycle,
    cross_level: !sameSchoolLevel(source.level, target.level, cycle),
  });
}
