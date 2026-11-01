import { NextRequest, NextResponse } from "next/server";
import { sameSchoolLevel } from "@/lib/school-levels";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import {
  parseSchoolCyclesSettings,
  inferSchoolCycleFromLevel,
  type TeachingTrack,
} from "@/lib/school-cycles";
import {
  SCHOOL_STUDENT_PROGRAMS_KEY,
  isBilingualSchool,
  normalizedProgramTracks,
  readStudentProgramSettings,
  programsForStudent,
} from "@/lib/school-student-programs";
import {
  asSettingsObject, schoolSettingsRevision, writeSchoolSettings,
} from "@/lib/school-settings-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (payload: unknown, status = 200) => NextResponse.json(payload, {
  status, headers: { "Cache-Control": "no-store" },
});

async function authorizedSchool() {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const auth = await requireInstitutionRole(client, service, ["admin"]);
  if ("error" in auth) return {
    error: json({ error: auth.error }, auth.error === "unauthorized" ? 401 : 403),
  } as const;
  const { data: institution, error } = await service.from("institutions")
    .select("settings_json").eq("id", auth.instId).maybeSingle();
  if (error || !institution) return { error: json({ error: "school_unavailable" }, 503) } as const;
  const settings = parseSchoolCyclesSettings(institution.settings_json);
  if (!isBilingualSchool(settings)) return { error: json({ error: "not_bilingual_school" }, 404) } as const;
  const { data: current, error: yearError } = await service.from("academic_years")
    .select("code").eq("institution_id", auth.instId).eq("is_current", true)
    .order("start_date", { ascending: false }).limit(1).maybeSingle();
  if (yearError || !current?.code) return { error: json({ error: "active_year_required" }, 409) } as const;
  if (!/^[0-9]{4}[-/_][0-9]{4}$/.test(String(current.code))) {
    return { error: json({ error: "unsupported_academic_year_code" }, 409) } as const;
  }
  return {
    service, institutionId: auth.instId, rawSettings: institution.settings_json,
    settings, year: String(current.code),
  } as const;
}

async function classInCurrentSchool(
  service: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  academicYear: string,
  classId: string,
) {
  const { data, error } = await service.from("classes")
    .select("id,label,level,institution_id,academic_year")
    .eq("institution_id", institutionId).eq("academic_year", academicYear)
    .eq("id", classId).maybeSingle();
  if (error) return { error: "class_load_failed" } as const;
  if (!data) return { error: "class_not_found" } as const;
  return { schoolClass: data } as const;
}

async function activeClassStudentIds(
  service: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  classId: string,
) {
  const result: string[] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await service.from("class_enrollments")
      .select("student_id").eq("institution_id", institutionId).eq("class_id", classId)
      .is("end_date", null).order("id").range(offset, offset + 499);
    if (error) return { error: "enrollments_load_failed" } as const;
    result.push(...(data || []).map(row => String(row.student_id || "")).filter(Boolean));
    if (!data || data.length < 500) return { studentIds: [...new Set(result)] } as const;
  }
  return { error: "class_roster_too_large" } as const;
}


type SchoolChoice = { id: string; label: string; level: string | null; cycle: "preschool" | "primary" | "secondary" | null };
async function eligibleHomeStudents(
  service: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  selected: SchoolChoice,
  choices: SchoolChoice[],
  primaryArabicCrossGrade: boolean,
) {
  if (!selected.level?.trim()) return { candidates: [] };
  const siblingIds = choices.filter(row =>
    row.id !== selected.id && !!row.level?.trim() && !!row.cycle && row.cycle === selected.cycle &&
    (primaryArabicCrossGrade || sameSchoolLevel(row.level, selected.level, selected.cycle || undefined)))
    .map(row => row.id);
  const candidates: Array<{ student_id: string; class_id: string }> = [];
  if (!siblingIds.length) return { candidates };
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await service.from("class_enrollments")
      .select("student_id,class_id").eq("institution_id", institutionId)
      .in("class_id", siblingIds).is("end_date", null)
      .order("id").range(offset, offset + 499);
    if (error) return { error: "candidate_roster_unavailable" } as const;
    candidates.push(...(data || []));
    if (!data || data.length < 500) return { candidates } as const;
  }
  return { error: "candidate_roster_too_large" } as const;
}

export async function GET(request: NextRequest) {
  const context = await authorizedSchool();
  if ("error" in context) return context.error;
  const { service, institutionId, rawSettings, settings, year } = context;
  const stored = readStudentProgramSettings(rawSettings);
  const classes: Array<{ id: string; label: string; level: string | null }> = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const { data, error } = await service.from("classes")
      .select("id,label,level")
      .eq("institution_id", institutionId).eq("academic_year", year)
      .order("id").range(offset, offset + 499);
    if (error) return json({ error: "classes_load_failed" }, 503);
    classes.push(...(data || []));
    if (!data || data.length < 500) break;
    if (offset === 4500) return json({ error: "too_many_classes" }, 503);
  }
  // Never silently treat an unfamiliar Franco-Arabic level as secondary.
  // Keep the class visible, but require its cycle to be configured first.
  const recognizedCycle = (row: { id: string; level: string | null }) => {
    const cycle = settings.classCycleById[row.id] || inferSchoolCycleFromLevel(row.level);
    return cycle && settings.enabledCycles.includes(cycle) ? cycle : null;
  };
  const choices = classes.map(row => ({ ...row, cycle: recognizedCycle(row) }));

  const requestedId = request.nextUrl.searchParams.get("class_id") || "";
  if (requestedId && !UUID.test(requestedId)) return json({ error: "invalid_class" }, 400);
  const selected = requestedId ? choices.find(row => row.id === requestedId) : undefined;
  if (requestedId && !selected) return json({ error: "class_not_found" }, 404);
  let students: Array<{ id: string; name: string; matricule: string | null; tracks: TeachingTrack[] | null }> = [];
  let candidates: Array<{ id: string; name: string; matricule: string | null; fromClass: string }> = [];
  if (selected) {
    const enroll = await activeClassStudentIds(service, institutionId, selected.id);
    if ("error" in enroll) return json({ error: enroll.error }, 503);
    const studentIds = enroll.studentIds;
    const targetIsArabicPrimary = selected.cycle === "primary" &&
      stored.years[year]?.classes[selected.id]?.tracks?.length === 1 &&
      stored.years[year]?.classes[selected.id]?.tracks[0] === "arabic";
    const nearby = selected.cycle ? await eligibleHomeStudents(
      service, institutionId, selected, choices, targetIsArabicPrimary,
    ) : { candidates: [] as Array<{ class_id: string; student_id: string }> };
    if ("error" in nearby) return json({ error: nearby.error }, 503);
    const nearbyStudents = nearby.candidates.filter(row => !studentIds.includes(row.student_id));
    const idsToLoad = [...new Set([...studentIds, ...nearbyStudents.map(row => row.student_id)])];
    const profiles: Array<{ id: string; first_name: string | null; last_name: string | null;
      full_name: string | null; matricule: string | null }> = [];
    for (let i = 0; i < idsToLoad.length; i += 100) {
      const { data, error } = await service.from("students")
        .select("id,first_name,last_name,full_name,matricule")
        .eq("institution_id", institutionId).in("id", idsToLoad.slice(i, i + 100));
      if (error) return json({ error: "students_load_failed" }, 503);
      profiles.push(...(data || []));
    }
    const byId = new Map(profiles.map(p => [p.id, p]));
    const policy = stored.years[year]?.classes[selected.id];
    students = studentIds.map(id => {
      const row = byId.get(id);
      return {
        id,
        name: String(row?.full_name || [row?.last_name, row?.first_name].filter(Boolean).join(" ") || "Élève").trim(),
        matricule: row?.matricule || null,
        tracks: policy?.students[id] || null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const classNames = new Map(choices.map(row => [row.id, row.label]));
    candidates = nearbyStudents.map(row => {
      const profile = byId.get(row.student_id);
      return {
        id: row.student_id,
        name: String(profile?.full_name || [profile?.last_name, profile?.first_name].filter(Boolean).join(" ") || "Élève"),
        matricule: profile?.matricule || null,
        fromClass: classNames.get(row.class_id) || "",
      };
    }).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }

  return json({
    ok: true, academicYear: year, revision: schoolSettingsRevision(rawSettings),
    classes: choices, selectedClassId: selected?.id || null,
    availableTracks: selected?.cycle ? settings.teachingTracksByCycle[selected.cycle] || [] : [],
    defaultTracks: selected ? stored.years[year]?.classes[selected.id]?.tracks || [] : [],
    students,
    candidates,
    linkedStudentIds: selected ? stored.years[year]?.classes[selected.id]?.linkedStudentIds || [] : [],
  });
}

export async function PUT(request: NextRequest) {
  const context = await authorizedSchool();
  if ("error" in context) return context.error;
  const { service, institutionId, rawSettings, settings, year } = context;
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return json({ error: "invalid_origin" }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "expected_json" }, 415);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_payload" }, 400);
  }
  if (body.revision !== schoolSettingsRevision(rawSettings)) {
    return json({ error: "settings_changed_reload_required" }, 409);
  }
  const classId = String(body.classId || "");
  if (!UUID.test(classId)) return json({ error: "invalid_class" }, 400);
  const found = await classInCurrentSchool(service, institutionId, year, classId);
  if ("error" in found) return json({ error: found.error }, found.error === "class_not_found" ? 404 : 503);
  const cycle = settings.classCycleById[classId] ||
    inferSchoolCycleFromLevel(found.schoolClass.level);
  if (!cycle || !settings.enabledCycles.includes(cycle)) {
    return json({ error: "class_cycle_requires_configuration" }, 409);
  }
  const allowed = settings.teachingTracksByCycle[cycle] || [];
  const defaultTracks = normalizedProgramTracks(body.defaultTracks);
  if (!defaultTracks || defaultTracks.some(track => !allowed.includes(track))) {
    return json({ error: "invalid_default_tracks" }, 400);
  }
  if (!body.overrides || typeof body.overrides !== "object" || Array.isArray(body.overrides)) {
    return json({ error: "invalid_student_overrides" }, 400);
  }
  const entries = Object.entries(body.overrides as Record<string, unknown>);
  if (entries.length > 700) return json({ error: "too_many_student_overrides" }, 400);
  const overrides: Record<string, TeachingTrack[]> = {};
  for (const [id, tracks] of entries) {
    const list = normalizedProgramTracks(tracks);
    if (!UUID.test(id) || !list?.length || list.some(track => !allowed.includes(track))) {
      return json({ error: "invalid_student_override" }, 400);
    }
    if (JSON.stringify(list.slice().sort()) !== JSON.stringify(defaultTracks.slice().sort())) {
      overrides[id] = list;
    }
  }
  const enrolled = await activeClassStudentIds(service, institutionId, classId);
  if ("error" in enrolled) return json({ error: enrolled.error }, 503);
  const eligible = new Set(enrolled.studentIds);
  if (Object.keys(overrides).some(id => !eligible.has(id))) {
    return json({ error: "student_outside_class" }, 403);
  }

  const existing = readStudentProgramSettings(rawSettings);
  const previousLinks = existing.years[year]?.classes[classId]?.linkedStudentIds || [];
  const inputLinks: unknown = body.linkedStudentIds === undefined ? previousLinks : body.linkedStudentIds;
  if (!Array.isArray(inputLinks) || inputLinks.length > 700 ||
    inputLinks.some(id => typeof id !== "string" || !UUID.test(id)) ||
    new Set(inputLinks).size !== inputLinks.length) {
    return json({ error: "invalid_linked_students" }, 400);
  }
  const linkedStudentIds = inputLinks as string[];
  if (linkedStudentIds.length) {
    if (defaultTracks.length !== 1) {
      return json({ error: "linked_class_needs_one_teaching" }, 400);
    }
    const choices: SchoolChoice[] = [];
    for (let offset = 0; offset < 5000; offset += 500) {
      const { data, error } = await service.from("classes")
        .select("id,label,level").eq("institution_id", institutionId)
        .eq("academic_year", year).order("id").range(offset, offset + 499);
      if (error) return json({ error: "classes_load_failed" }, 503);
      choices.push(...(data || []).map(row => ({
        ...row, cycle: settings.classCycleById[row.id] || inferSchoolCycleFromLevel(row.level),
      })));
      if (!data || data.length < 500) break;
      if (offset === 4500) return json({ error: "too_many_classes" }, 503);
    }
    const target = choices.find(row => row.id === classId);
    if (!target) return json({ error: "class_not_found" }, 404);
    const eligibleHome = await eligibleHomeStudents(
      service, institutionId, target, choices, cycle === "primary" && defaultTracks[0] === "arabic",
    );
    if ("error" in eligibleHome) return json({ error: eligibleHome.error }, 503);
    const homeByStudent = new Map(eligibleHome.candidates.map(row => [row.student_id, row.class_id]));
    for (const id of linkedStudentIds) {
      const sourceClassId = homeByStudent.get(id);
      const sourceTracks = sourceClassId && programsForStudent(
        existing.years[year]?.classes[sourceClassId], id, allowed);
      if (!sourceClassId || sourceTracks?.length !== 1 ||
        sourceTracks[0] === defaultTracks[0] || eligible.has(id)) {
        return json({ error: "linked_student_not_eligible" }, 403);
      }
      // Do not place the same pupil into two distinct classes of one teaching.
      for (const [otherId, policy] of Object.entries(existing.years[year]?.classes || {})) {
        if (otherId === classId || !policy.linkedStudentIds?.includes(id) ||
          !policy.tracks.includes(defaultTracks[0])) continue;
        const otherClass = choices.find(row => row.id === otherId);
        if (otherClass?.cycle === cycle &&
          (cycle === "primary" && defaultTracks[0] === "arabic" ||
            sameSchoolLevel(otherClass.level, target.level, cycle))) {
          return json({ error: "duplicate_teaching_class" }, 409);
        }
      }
    }
  }
  if (!existing.years[year] && Object.keys(existing.years).length >= 6) {
    return json({ error: "too_many_academic_years" }, 409);
  }
  const classes = { ...(existing.years[year]?.classes || {}) };
  if (!classes[classId] && Object.keys(classes).length >= 500) return json({ error: "too_many_classes" }, 409);
  if (!defaultTracks.length && !Object.keys(overrides).length && !linkedStudentIds.length) delete classes[classId];
  else classes[classId] = {
    tracks: defaultTracks, students: overrides,
    ...(linkedStudentIds.length ? { linkedStudentIds } : {}),
  };
  const next = {
    ...asSettingsObject(rawSettings),
    [SCHOOL_STUDENT_PROGRAMS_KEY]: {
      ...existing,
      years: { ...existing.years, [year]: { classes } },
    },
  };
  const saved = await writeSchoolSettings(service, institutionId, rawSettings, next);
  if ("error" in saved) return json({ error: saved.error }, saved.status);
  return json({ ok: true, revision: saved.revision });
}
