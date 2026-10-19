import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { schoolSettingsRevision, writeSchoolSettings } from "@/lib/school-settings-write";
import { readStudentProgramSettings } from "@/lib/school-student-programs";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import {
  PRIMARY_EVENTS_SETTINGS_KEY,
  primarySchoolYearIsValid,
  readPrimaryEventsCatalog,
  validatePrimaryEvents, parsePrimaryEventTitle, primaryEventTitle,
  primaryEventsForClass,
} from "@/lib/grades/primary-evaluation-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

async function context(write: boolean) {
  const browser = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const service = getSupabaseServiceClient() as unknown as SupabaseClient;
  const access = await requireInstitutionRole(browser, service,
    write ? ["admin", "super_admin"] : ["admin", "super_admin", "founder", "file_correspondent"]);
  if ("error" in access) return { error: json({ ok: false, error: access.error }, access.error === "unauthorized" ? 401 : 403) };
  const { data, error } = await service.from("institutions").select("settings_json")
    .eq("id", access.instId).maybeSingle();
  if (error || !data) return { error: json({ ok: false, error: "institution_unavailable" }, 503) };
  const settings = data.settings_json && typeof data.settings_json === "object" &&
    !Array.isArray(data.settings_json) ? data.settings_json as Record<string, unknown> : {};
  const school = parseSchoolCyclesSettings(settings);
  if (!school.enabled || !school.enabledCycles.includes("primary")) {
    return { error: json({ ok: false, error: "primary_school_required" }, 403) };
  }
  return { service, institutionId: access.instId, settings, rawSettings: data.settings_json, tracks: school.teachingTracksByCycle.primary || [] };
}

export async function GET(request: NextRequest) {
  const year = request.nextUrl.searchParams.get("academic_year") || "";
  if (!primarySchoolYearIsValid(year)) return json({ ok: false, error: "invalid_year" }, 400);
  const access = await context(false);
  if ("error" in access) return access.error;
  const catalog = readPrimaryEventsCatalog(access.settings);
  let events = catalog.years[year]?.events || [];
  const classId = request.nextUrl.searchParams.get("class_id");
  if (classId) {
    const classroom = await access.service.from("classes").select("id,level")
      .eq("id", classId).eq("institution_id", access.institutionId).eq("academic_year", year).maybeSingle();
    if (classroom.error) return json({ ok: false, error: "class_unavailable" }, 503);
    if (!classroom.data) return json({ ok: false, error: "class_not_found" }, 404);
    const classLevel = classroom.data.level || "";
    const tracks = readStudentProgramSettings(access.settings).years[year]?.classes[classId]?.tracks || access.tracks;
    const codes = new Set(tracks.flatMap(track => primaryEventsForClass(access.settings, year, classLevel, track)).map(event => event.code));
    events = events.filter(event => codes.has(event.code));
  }
  return json({ ok: true, academic_year: year, events, tracks: access.tracks, revision: schoolSettingsRevision(access.rawSettings) });
}

export async function PUT(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return json({ ok: false, error: "invalid_origin" }, 403);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json({ ok: false, error: "expected_json" }, 415);
  }
  const payload = await request.json().catch(() => null);
  const year = String(payload?.academic_year || "");
  const validated = validatePrimaryEvents(payload?.events, year);
  if (!validated.ok) return json({ ok: false, error: validated.error }, 400);
  const access = await context(true);
  if ("error" in access) return access.error;
  if (payload.revision !== schoolSettingsRevision(access.rawSettings)) {
    return json({ ok: false, error: "Les paramètres ont changé. Rechargez avant de réessayer." }, 409);
  }
  if (validated.events.some(event => event.tracks.some(track => !access.tracks.includes(track)))) {
    return json({ ok: false, error: "primary_event_teaching_not_offered" }, 400);
  }
  const catalog = readPrimaryEventsCatalog(access.settings);
  const previous = catalog.years[year]?.events || [];
  if (previous.length) {
    const classes = await access.service.from("classes").select("id")
      .eq("institution_id", access.institutionId).eq("academic_year", year).limit(501);
    if (classes.error || !classes.data || classes.data.length >= 501) return json({ ok: false, error: "primary_event_links_unavailable" }, 503);
    if (classes.data.length) {
      const titles = previous.flatMap(event => [primaryEventTitle(event), primaryEventTitle(event, "french"), primaryEventTitle(event, "arabic")]);
      const evaluations = await access.service.from("grade_evaluations").select("title")
        .in("class_id", classes.data.map(row => row.id)).in("title", titles).limit(20001);
      if (evaluations.error || !evaluations.data || evaluations.data.length >= 20001) return json({ ok: false, error: "primary_event_links_unavailable" }, 503);
      const used = new Set(evaluations.data.map(row => parsePrimaryEventTitle(row.title)?.code));
      const identity = (event: typeof previous[number]) => JSON.stringify([event.kind, event.date, [...event.levels].sort(), [...event.tracks].sort()]);
      if (previous.some(event => used.has(event.code) && !validated.events.some(next => next.code === event.code && identity(next) === identity(event)))) {
        return json({ ok: false, error: "Une évaluation avec des notes doit conserver son code, sa nature, sa date et ses classes." }, 409);
      }
    }
  }
  catalog.years[year] = { events: validated.events };
  const newSettings = { ...access.settings, [PRIMARY_EVENTS_SETTINGS_KEY]: catalog };
  const result = await writeSchoolSettings(access.service, access.institutionId, access.rawSettings, newSettings);
  if ("error" in result) return json({ ok: false, error: result.error }, result.status);
  return json({ ok: true, academic_year: year, events: validated.events, revision: result.revision });
}
