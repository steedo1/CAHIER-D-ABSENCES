import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { inferSchoolCycleFromLevel, parseSchoolCyclesSettings, type SchoolCycle, type TeachingTrack } from "@/lib/school-cycles";
import { isBilingualSchool, readStudentProgramSettings } from "@/lib/school-student-programs";
import { SCHOOL_CLASS_SUBJECTS_KEY, readClassSubjects } from "@/lib/school-class-subjects";
import { asSettingsObject, schoolSettingsRevision, writeSchoolSettings } from "@/lib/school-settings-write";
import { planCiPrimaryFrenchReference } from "@/lib/primary-french-reference-ci";
import { FRANCO_ARABIC_REPORTS_SETTINGS_KEY, readFrancoArabicReportsForEditing } from "@/lib/franco-arabic-reporting";

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


async function loadSubjects(context: Exclude<Awaited<ReturnType<typeof scope>>, { error: NextResponse }>, selected: ClassItem) {
  const { data: active, error } = await context.service.from("institution_subjects")
    .select("subject_id,custom_name").eq("institution_id", context.institutionId)
    .eq("is_active", true).limit(501);
  if (error || !active || active.length >= 501) return { error: "subjects_load_failed" } as const;
  const ids = active.filter(row => context.settings.subjectTracksByCycle[selected.cycle!]?.[row.subject_id]?.includes(selected.track!))
    .map(row => row.subject_id);
  if (!ids.length) return { subjects: [] as Array<{ id: string; name: string }> };
  const { data: global, error: namesError } = await context.service.from("subjects").select("id,name")
    .in("id", ids).limit(501);
  if (namesError || !global) return { error: "subject_names_load_failed" } as const;
  const names = new Map(global.map(row => [row.id, row.name]));
  const subjects = active.filter(row => ids.includes(row.subject_id)).map(row => ({
    id: row.subject_id, name: String(row.custom_name || names.get(row.subject_id) || row.subject_id),
  })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return { subjects };
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
    const catalog = await loadSubjects(context, selected);
    if ("error" in catalog) return json({ error: catalog.error }, 503);
    subjects = catalog.subjects;
  }
  // The EPC already has real teacher assignments. Before the administrator
  // explicitly edits a class curriculum, show those assignments as selected.
  // Once a list has been saved, including [], its selection takes precedence.
  let selectedSubjectIds: string[] = [];
  if (selected) {
    const saved = stored?.years[context.year]?.classes;
    if (saved && Object.prototype.hasOwnProperty.call(saved, selected.id)) {
      selectedSubjectIds = saved[selected.id] || [];
    } else if (selected.cycle && selected.track && subjects.length) {
      const assigned = await context.service.from("class_teachers")
        .select("subject_id").eq("institution_id", context.institutionId)
        .eq("class_id", selected.id).is("end_date", null).limit(151);
      if (assigned.error) return json({ error: "class_assignments_load_failed" }, 503);
      const institutionIds = [...new Set((assigned.data || [])
        .map(row => String(row.subject_id || "")).filter(Boolean))];
      if (institutionIds.length) {
        const rows = await context.service.from("institution_subjects")
          .select("id,subject_id").eq("institution_id", context.institutionId)
          .in("id", institutionIds).eq("is_active", true).limit(151);
        if (rows.error) return json({ error: "class_subjects_load_failed" }, 503);
        const assignedCanonicalIds = new Set((rows.data || []).map(row => row.subject_id));
        selectedSubjectIds = subjects.filter(subject => assignedCanonicalIds.has(subject.id))
          .map(subject => subject.id);
      }
    }
  }
  return json({ ok: true, academicYear: context.year,
    revision: schoolSettingsRevision(context.rawSettings),
    classes: loaded.classes, selectedClassId: selected?.id || null, subjects,
    selectedSubjectIds,
    ciPrimaryFrenchApplied: selected
      ? stored?.years[context.year]?.ciPrimaryFrenchClasses?.includes(selected.id) === true : false,
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
      [context.year]: { ...stored.years[context.year], classes: yearClasses } } } };
  const write = await writeSchoolSettings(context.service, context.institutionId, context.rawSettings, next);
  if ("error" in write) return json({ error: write.error }, write.status);
  return json({ ok: true, revision: write.revision });
}

/** Same class-curriculum resource as the existing manual editor.
 * Preview is read-only; apply only adds recognized, ACTIVE school subjects.
 * No teacher assignment, subject catalog or numeric coefficient is modified.
 */
export async function POST(request: NextRequest) {
  const context = await scope();
  if ("error" in context) return context.error;
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return json({ error: "invalid_origin" }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "expected_json" }, 415);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      (body.action !== "preview_ci_primary_french" && body.action !== "apply_ci_primary_french")) {
    return json({ error: "invalid_reference_action" }, 400);
  }
  const classId = String(body.classId || "");
  if (!UUID.test(classId)) return json({ error: "invalid_class" }, 400);
  if (body.revision !== schoolSettingsRevision(context.rawSettings)) {
    return json({ error: "settings_changed_reload_required" }, 409);
  }
  const classes = await loadClasses(context);
  if ("error" in classes) return json({ error: classes.error }, 503);
  const selected = classes.classes.find(row => row.id === classId);
  if (!selected) return json({ error: "class_not_found" }, 404);
  if (selected.cycle !== "primary" || selected.track !== "french" || !selected.level) {
    return json({ error: "ci_reference_requires_primary_french_class" }, 400);
  }
  const catalog = await loadSubjects(context, selected);
  if ("error" in catalog) return json({ error: catalog.error }, 503);
  const stored = readClassSubjects(context.rawSettings) || { version: 1 as const, years: {} };
  const alreadySelected = stored.years[context.year]?.classes[classId] || [];
  let plan: ReturnType<typeof planCiPrimaryFrenchReference>;
  try {
    plan = planCiPrimaryFrenchReference(selected.level, catalog.subjects, alreadySelected);
  } catch {
    return json({ error: "ci_primary_invalid_level" }, 400);
  }
  const preview = { ...plan, classId, level: selected.level,
    alreadyApplied: stored.years[context.year]?.ciPrimaryFrenchClasses?.includes(classId) === true };
  if (body.action === "preview_ci_primary_french") return json({ ok: true, preview });
  if (!plan.matches.length) return json({ error: "ci_reference_no_known_school_subject", preview }, 409);

  const currentYear = stored.years[context.year];
  if (Object.keys(stored.years).length >= 8 && !currentYear) return json({ error: "too_many_academic_years" }, 409);
  const yearClasses = { ...(currentYear?.classes || {}) };
  if (!Object.hasOwn(yearClasses, classId) && Object.keys(yearClasses).length >= 500) return json({ error: "too_many_classes" }, 409);
  yearClasses[classId] = plan.proposedSubjectIds;
  const applied = [...new Set([...(currentYear?.ciPrimaryFrenchClasses || []), classId])];

  // A /10 report mean is the common configured primary scale; individual CM
  // examination denominators (/20, /50) are resolved by subject at grade entry.
  const reports = readFrancoArabicReportsForEditing(context.rawSettings);
  const otherScales = reports.scales.filter(row => !(row.cycle === "primary" &&
    row.track === "french" && row.level.replace(/[\\s.-]/g, "").toLowerCase() === selected.level!.replace(/[\\s.-]/g, "").toLowerCase()));
  const scales = [...otherScales, { cycle: "primary" as const, level: selected.level,
    track: "french" as const, maxScore: 10 }];
  if (scales.length > 120) return json({ error: "too_many_scales" }, 409);
  const next = { ...asSettingsObject(context.rawSettings),
    [SCHOOL_CLASS_SUBJECTS_KEY]: { version: 1, years: { ...stored.years,
      [context.year]: { ...currentYear, classes: yearClasses, ciPrimaryFrenchClasses: applied } } },
    [FRANCO_ARABIC_REPORTS_SETTINGS_KEY]: { ...reports, scales } };
  const write = await writeSchoolSettings(context.service, context.institutionId, context.rawSettings, next);
  if ("error" in write) return json({ error: write.error }, write.status);
  return json({ ok: true, preview: { ...preview, alreadyApplied: true },
    associated: plan.newlyAssociated.length, revision: write.revision });
}
