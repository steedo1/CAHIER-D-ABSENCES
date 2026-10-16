import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminAccess } from "@/lib/super-admin-access";
import {
  SCHOOL_CYCLES_SETTINGS_KEY,
  getDefaultSchoolCyclesSettings,
  isSchoolCycle,
  isTeachingTrack,
  parseSchoolCyclesSettings,
  type SchoolCycle,
  type SchoolCyclesSettings,
  type TeachingTrack,
} from "@/lib/school-cycles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: Params) {
  const access = await requireSuperAdminAccess();
  if ("error" in access) return access.error;
  const { id } = await context.params;
  if (!UUID.test(id)) return reply({ error: "invalid_institution" }, 400);

  const { data, error } = await access.srv
    .from("institutions")
    .select("id,name,code_unique,settings_json")
    .eq("id", id)
    .maybeSingle();

  if (error) return reply({ error: "institution_load_failed" }, 503);
  if (!data) return reply({ error: "institution_not_found" }, 404);

  const yearResult = await access.srv.from("academic_years")
    .select("code")
    .eq("institution_id", id)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (yearResult.error) return reply({ error: "academic_year_load_failed" }, 503);
  const academicYear = String(yearResult.data?.code || "");
  let classRows: Array<{ id: string; label: string; level: string | null }> = [];
  if (academicYear) {
    const result = await access.srv.from("classes")
      .select("id,label,level")
      .eq("institution_id", id)
      .eq("academic_year", academicYear)
      .order("level", { ascending: true })
      .limit(501);
    if (result.error) return reply({ error: "classes_load_failed" }, 503);
    if ((result.data || []).length > 500) {
      return reply({ error: "too_many_classes_for_cycle_editor" }, 503);
    }
    classRows = result.data || [];
  }

  return reply({ error: "too_many_subjects_for_editor" }, 503);
  }
  const subjectIds = Array.from(new Set(
    (assignedSubjects.data || []).map((row) => row.subject_id).filter(Boolean)));
  let subjectRows: Array<{ id: string; name: string; code: string | null }> = [];
  if (subjectIds.length) {
    const subjects = await access.srv.from("subjects")
      .select("id,name,code").in("id", subjectIds).limit(501);
    if (subjects.error) return reply({ error: "subjects_load_failed" }, 503);
    const globalById = new Map((subjects.data || []).map((row) => [row.id, row]));
    subjectRows = (assignedSubjects.data || []).map((row) => {
      const global = globalById.get(row.subject_id);
      return {
        id: row.subject_id,
        name: String(row.custom_name || global?.name || global?.code || row.subject_id),
        code: global?.code || null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }

  return reply({
    ok: true,
    institution: { id: data.id, name: data.name, code_unique: data.code_unique },
    configuration: parseSchoolCyclesSettings(data.settings_json),
    academicYear: academicYear || null,
    classes: classRows,
  });
}

function parsePayload(value: unknown): SchoolCyclesSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.enabled !== "boolean") return null;
  if (!Array.isArray(input.enabledCycles) || !input.enabledCycles.every(isSchoolCycle)) {
    return null;
  }

  const enabledCycles = Array.from(new Set(input.enabledCycles as SchoolCycle[]));
  if (input.enabled && enabledCycles.length === 0) return null;
  if (!input.enabled) return getDefaultSchoolCyclesSettings();

  if (!input.teachingTracksByCycle ||
    typeof input.teachingTracksByCycle !== "object" ||
    Array.isArray(input.teachingTracksByCycle)) {
    return null;
  }

  const provided = input.teachingTracksByCycle as Record<string, unknown>;
  const teachingTracksByCycle: SchoolCyclesSettings["teachingTracksByCycle"] = {};
  for (const cycle of enabledCycles) {
    const raw = provided[cycle];
    if (!Array.isArray(raw) || !raw.length || !raw.every(isTeachingTrack)) {
      return null;
    }
    teachingTracksByCycle[cycle] = Array.from(new Set(raw as TeachingTrack[]));
  }
  if (Object.keys(provided).some((cycle) => !enabledCycles.includes(cycle as SchoolCycle))) {
    return null;
  }

  const classCycleById: Record<string, SchoolCycle> = {};
  if (input.classCycleById !== undefined) {
    if (!input.classCycleById || typeof input.classCycleById !== "object" ||
      Array.isArray(input.classCycleById)) return null;
    const provided = input.classCycleById as Record<string, unknown>;
    const entries = Object.entries(provided);
    if (entries.length > 250) return null;
    for (const [classId, cycle] of entries) {
      if (!UUID.test(classId) || !isSchoolCycle(cycle) || !enabledCycles.includes(cycle)) {
        return null;
      }
      classCycleById[classId] = cycle;
    }
  }

  const subjectTracksByCycle: SchoolCyclesSettings["subjectTracksByCycle"] = {};
  const perCycleSubjects = input.subjectTracksByCycle;
  if (perCycleSubjects !== undefined &&
      (!perCycleSubjects || typeof perCycleSubjects !== "object" ||
       Array.isArray(perCycleSubjects))) return null;
  const rawSubjectMappings = (perCycleSubjects || {}) as Record<string, unknown>;
  if (Object.keys(rawSubjectMappings).some((cycle) =>
    !enabledCycles.includes(cycle as SchoolCycle))) return null;
  for (const cycle of enabledCycles) {
    const records = rawSubjectMappings[cycle] || {};
    if (typeof records !== "object" || Array.isArray(records)) return null;
    const assignments = Object.entries(records as Record<string, unknown>);
    if (assignments.length > 250) return null;
    const configured: Record<string, TeachingTrack[]> = {};
    for (const [subjectId, tracks] of assignments) {
      if (!UUID.test(subjectId) || !Array.isArray(tracks) || !tracks.length ||
        !tracks.every(isTeachingTrack) || tracks.some((track) =>
          !teachingTracksByCycle[cycle]?.includes(track))) return null;
      configured[subjectId] = Array.from(new Set(tracks as TeachingTrack[]));
    }
    subjectTracksByCycle[cycle] = configured;
  }

  const defaultView = input.defaultView;
  if (defaultView !== "all" &&
    !(isSchoolCycle(defaultView) && enabledCycles.includes(defaultView))) {
    return null;
  }

  if (input.preferredLanguage !== "fr" && input.preferredLanguage !== "ar") {
    return null;
  }

  return {
    version: 1,
    enabled: true,
    enabledCycles,
    teachingTracksByCycle,
    subjectTracksByCycle,
    classCycleById,
    defaultView,
    preferredLanguage: input.preferredLanguage,
  };
}

/**
 * Only the super admin can activate cycles.
 * The old JSON settings keys are preserved; no database migration is required.
 */
export async function PUT(req: NextRequest, context: Params) {
  const access = await requireSuperAdminAccess();
  if ("error" in access) return access.error;

  // Same-origin browser requests only (defense against cross-site mutations).
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return reply({ error: "invalid_origin" }, 403);
  }
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return reply({ error: "expected_json" }, 415);
  }

  const { id } = await context.params;
  if (!UUID.test(id)) return reply({ error: "invalid_institution" }, 400);

  const body = await req.json().catch(() => null);
  const incoming = parsePayload(body);
  if (!incoming) return reply({ error: "invalid_school_cycle_configuration" }, 400);

  const { data: institution, error: readError } = await access.srv
    .from("institutions")
    .select("id,settings_json")
    .eq("id", id)
    .maybeSingle();
  if (readError) return reply({ error: "institution_load_failed" }, 503);
  if (!institution) return reply({ error: "institution_not_found" }, 404);

  const oldJson = institution.settings_json &&
    typeof institution.settings_json === "object" &&
    !Array.isArray(institution.settings_json)
    ? institution.settings_json as Record<string, unknown>
    : {};
  // Reject ID mappings for classes belonging to another institution.
  const classIds = Object.keys(incoming.classCycleById);
  if (classIds.length) {
    const rows = await access.srv.from("classes")
      .select("id")
      .eq("institution_id", id)
      .in("id", classIds)
      .limit(251);
    if (rows.error) return reply({ error: "class_scope_check_failed" }, 503);
    if ((rows.data || []).length !== classIds.length) {
      return reply({ error: "class_outside_institution" }, 403);
    }
  }

  // Super Admin provisions available cycles only. Assignment of subjects to
  // French/Arabic teaching programs is a PEDAGOGICAL school-admin decision.
  // Ignore any subject classification submitted via this Super Admin route.
  const previous = parseSchoolCyclesSettings(oldJson);
  const subjectTracksByCycle: SchoolCyclesSettings["subjectTracksByCycle"] = {};
  for (const cycle of incoming.enabledCycles) {
    const supported = incoming.teachingTracksByCycle[cycle] || [];
    subjectTracksByCycle[cycle] = Object.fromEntries(
      Object.entries(previous.subjectTracksByCycle[cycle] || {})
        .map(([subjectId, tracks]) => [
          subjectId, tracks.filter(track => supported.includes(track)),
        ]).filter(([, tracks]) => (tracks as TeachingTrack[]).length > 0),
    ) as Record<string, TeachingTrack[]>;
  }
  const updated: SchoolCyclesSettings = { ...incoming, subjectTracksByCycle };
  const settings_json = { ...oldJson, [SCHOOL_CYCLES_SETTINGS_KEY]: updated };

  const { error: writeError } = await access.srv
    .from("institutions")
    .update({ settings_json })
    .eq("id", id)
    .select("id")
    .single();
  if (writeError) return reply({ error: "save_failed" }, 503);

  return reply({ ok: true, configuration: updated });
}
