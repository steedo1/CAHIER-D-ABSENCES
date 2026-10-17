import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { inferSchoolCycleFromLevel, parseSchoolCyclesSettings, type SchoolCycle, type TeachingTrack } from "@/lib/school-cycles";
import { isBilingualSchool, readStudentProgramSettings } from "@/lib/school-student-programs";
import { SCHOOL_CLASS_SUBJECTS_KEY, readClassSubjects } from "@/lib/school-class-subjects";
import { asSettingsObject, schoolSettingsRevision, writeSchoolSettings } from "@/lib/school-settings-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
type ClassItem = { id: string; label: string; level: string | null; cycle: SchoolCycle | null; track: TeachingTrack | null };

async function scope() {
  const browser = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireInstitutionRole(browser, service, ["admin"]);
  if ("error" in access) return { error: json({ error: access.error }, access.error === "unauthorized" ? 401 : 403) } as const;
  const { data: institution, error } = await service.from("institutions")
    .select("settings_json").eq("id", access.instId).maybeSingle();
  if (error || !institution) return { error: json({ error: "school_unavailable" }, 503) } as const;
  const settings = parseSchoolCyclesSettings(institution.settings_json);
  if (!isBilingualSchool(settings)) return { error: json({ error: "not_bilingual_school" }, 404) } as const;
  const { data: active, error: yearError } = await service.from("academic_years")
    .select("code").eq("institution_id", access.instId).eq("is_current", true)
    .order("start_date", { ascending: false }).limit(1).maybeSingle();
  if (yearError || !active?.code || !/^[0-9]{4}[-/_][0-9]{4}$/.test(active.code)) {
    return { error: json({ error: "active_year_required" }, 409) } as const;
  }
  return { service, institutionId: access.instId,
    rawSettings: institution.settings_json, settings, year: String(active.code) } as const;
}

async function loadClasses(context: Exclude<Awaited<ReturnType<typeof scope>>, { error: NextResponse }>) {
  const classes: ClassItem[] = [];
  const yearPrograms = readStudentProgramSettings(context.rawSettings).years[context.year];
  for (let from = 0; from < 5000; from += 500) {
    const { data, error } = await context.service.from("classes").select("id,label,level")
      .eq("institution_id", context.institutionId).eq("academic_year", context.year)
      .order("id").range(from, from + 499);
    if (error || !data) return { error: "classes_load_failed" } as const;
    for (const row of data) {
      const cycle = context.settings.classCycleById[row.id] || inferSchoolCycleFromLevel(row.level);
      const tracks = yearPrograms?.classes[row.id]?.tracks || [];
      const track = tracks.length === 1 && cycle && context.settings.teachingTracksByCycle[cycle]?.includes(tracks[0])
        ? tracks[0] : null;
      classes.push({ id: row.id, label: row.label, level: row.level, cycle, track });
    }
    if (data.length < 500) return { classes } as const;
  }
  return { error: "too_many_classes" } as const;
}

export async function GET(request: NextRequest) {
  const context = await scope();
  if ("error" in context) return context.error;
  const loaded = await loadClasses(context);
  if ("error" in loaded) return json({ error: loaded.error }, 503);
  const classId = request.nextUrl.searchParams.get("class_id") || "";
  if (classId && !UUID.test(classId)) return json({ error: "invalid_class" }, 400);
  const selected = classId ? loaded.classes.find(row => row.id === classId) : null;
  if (classId && !selected) return json({ error: "class_not_found" }, 404);
  const stored = readClassSubjects(context.rawSettings);
  let subjects: Array<{ id: string; name: string }> = [];
  if (selected?.cycle && selected.track) {
    const { data: active, error } = await context.service.from("institution_subjects")
      .select("subject_id,custom_name").eq("institution_id", context.institutionId)
      .eq("is_active", true).limit(501);
    if (error || !active || active.length >= 501) return json({ error: "subjects_load_failed" }, 503);
    const ids = active.filter(row => context.settings.subjectTracksByCycle[selected.cycle!]?.[row.subject_id]?.includes(selected.track!))
      .map(row => row.subject_id);
    if (ids.length) {
      const { data: global, error: namesError } = await context.service.from("subjects").select("id,name")
        .in("id", ids).limit(501);
      if (namesError || !global) return json({ error: "subject_names_load_failed" }, 503);
      const names = new Map(global.map(row => [row.id, row.name]));
      subjects = active.filter(row => ids.includes(row.subject_id)).map(row => ({
        id: row.subject_id, name: String(row.custom_name || names.get(row.subject_id) || row.subject_id),
      })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    }
  }
  return json({ ok: true, academicYear: context.year,
    revision: schoolSettingsRevision(context.rawSettings),
    classes: loaded.classes, selectedClassId: selected?.id || null, subjects,
    selectedSubjectIds: selected ? stored?.years[context.year]?.classes[selected.id] || [] : [],
  });
}

export async function PUT(request: NextRequest) {
  const context = await scope();
  if ("error" in context) return context.error;
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return json({ error: "invalid_origin" }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "expected_json" }, 415);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_payload" }, 400);
  if (body.revision !== schoolSettingsRevision(context.rawSettings)) {
    return json({ error: "settings_changed_reload_required" }, 409);
  }
  const classId = String(body.classId || "");
  if (!UUID.test(classId)) return json({ error: "invalid_class" }, 400);
  const ids: unknown = body.subjectIds;
  if (!Array.isArray(ids) || ids.length > 150 || !ids.every(id => typeof id === "string" && UUID.test(id)) ||
    new Set(ids).size !== ids.length) return json({ error: "invalid_subject_ids" }, 400);
  const loaded = await loadClasses(context);
  if ("error" in loaded) return json({ error: loaded.error }, 503);
  const selected = loaded.classes.find(row => row.id === classId);
  if (!selected) return json({ error: "class_not_found" }, 404);
  if (!selected.cycle || !selected.track) return json({ error: "class_teaching_requires_configuration" }, 409);
  const subjectIds = ids as string[];
  for (const id of subjectIds) {
    if (!context.settings.subjectTracksByCycle[selected.cycle]?.[id]?.includes(selected.track)) {
      return json({ error: "subject_not_classified_for_teaching" }, 400);
    }
  }
  if (subjectIds.length) {
    const { data: rows, error } = await context.service.from("institution_subjects")
      .select("subject_id").eq("institution_id", context.institutionId)
      .eq("is_active", true).in("subject_id", subjectIds).limit(151);
    if (error || !rows) return json({ error: "subjects_load_failed" }, 503);
    const active = new Set(rows.map(row => row.subject_id));
    if (subjectIds.some(id => !active.has(id))) return json({ error: "subject_outside_institution" }, 403);
  }
  const stored = readClassSubjects(context.rawSettings) || { version: 1 as const, years: {} };
  const yearClasses = { ...(stored.years[context.year]?.classes || {}) };
  if (!Object.hasOwn(yearClasses, classId) && Object.keys(yearClasses).length >= 500) {
    return json({ error: "too_many_classes" }, 409);
  }
  yearClasses[classId] = subjectIds;
  if (Object.keys(stored.years).length >= 8 && !stored.years[context.year]) {
    return json({ error: "too_many_academic_years" }, 409);
  }
  const next = { ...asSettingsObject(context.rawSettings),
    [SCHOOL_CLASS_SUBJECTS_KEY]: { version: 1, years: { ...stored.years,
      [context.year]: { classes: yearClasses } } } };
  const write = await writeSchoolSettings(context.service, context.institutionId, context.rawSettings, next);
  if ("error" in write) return json({ error: write.error }, write.status);
  return json({ ok: true, revision: write.revision });
}
