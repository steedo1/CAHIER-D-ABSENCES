import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import { asSettingsObject, schoolSettingsRevision, writeSchoolSettings } from "@/lib/school-settings-write";
import {
  PRIMARY_EVENTS_SETTINGS_KEY, primaryEventTitle, readPrimaryEvents, validatePrimaryEvents,
} from "@/lib/grades/primary-evaluation-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => NextResponse.json(data, {
  status, headers: { "Cache-Control": "no-store" },
});
const validYear = (value: string) => {
  const match = /^(\d{4})-(\d{4})$/.exec(value);
  return !!match && Number(match[2]) === Number(match[1]) + 1;
};
async function schoolContext(write = false) {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const auth = await requireInstitutionRole(client, service,
    write ? ["admin","super_admin"] :
      ["admin","super_admin","teacher","educator","founder","file_correspondent"]);
  if ("error" in auth) return { error: json({ ok: false, error: auth.error },
    auth.error === "unauthorized" ? 401 : 403) } as const;
  const { data: school, error } = await service.from("institutions")
    .select("settings_json").eq("id", auth.instId).maybeSingle();
  if (error || !school) return { error: json({ ok:false, error:"institution_unavailable" },503) } as const;
  const cycles = parseSchoolCyclesSettings(school.settings_json);
  if (!cycles.enabled || !cycles.enabledCycles.includes("primary")) {
    return { error: json({ ok:false, error:"primary_not_configured" },404) } as const;
  }
  return { service, institutionId: auth.instId, settings: school.settings_json } as const;
}
async function schoolYearExists(
  service: ReturnType<typeof getSupabaseServiceClient>, institutionId: string, year: string
) {
  const { data, error } = await service.from("academic_years")
    .select("id").eq("institution_id", institutionId).eq("code", year).limit(1).maybeSingle();
  return !error && !!data;
}
export async function GET(req: NextRequest) {
  const context = await schoolContext();
  if ("error" in context) return context.error;
  const year = req.nextUrl.searchParams.get("academic_year") || "";
  if (!validYear(year)) return json({ ok:false,error:"academic_year_required" },400);
  if (!await schoolYearExists(context.service, context.institutionId, year))
    return json({ ok:false,error:"academic_year_unknown" },404);
  return json({ ok:true, academic_year:year,
    events:readPrimaryEvents(context.settings,year),
    revision:schoolSettingsRevision(context.settings) });
}
export async function PUT(req: NextRequest) {
  const context = await schoolContext(true);
  if ("error" in context) return context.error;
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin)
    return json({ ok:false,error:"invalid_origin" },403);
  const body = await req.json().catch(() => null);
  const year = String(body?.academic_year || "");
  if (!validYear(year) || typeof body?.revision !== "string")
    return json({ ok:false,error:"invalid_request" },400);
  if (!await schoolYearExists(context.service, context.institutionId, year))
    return json({ ok:false,error:"academic_year_unknown" },404);
  if (body.revision !== schoolSettingsRevision(context.settings))
    return json({ ok:false,error:"settings_changed_reload_required" },409);
  let events;
  try { events = validatePrimaryEvents(body.events,year); }
  catch (e) {
    return json({ ok:false,error:e instanceof Error ? e.message : "invalid_events" },400);
  }
  // Les notes existantes restent liées à l'événement original : une évaluation
  // déjà utilisée ne peut ni être supprimée ni changer de date, nature ou niveaux.
  const previous = readPrimaryEvents(context.settings, year);
  const changed = previous.filter(old => {
    const next = events.find(event => event.id === old.id);
    return !next || old.date !== next.date || old.kind !== next.kind ||
      JSON.stringify([...old.levels].sort()) !== JSON.stringify([...next.levels].sort());
  });
  if (changed.length) {
    const classes = await context.service.from("classes").select("id")
      .eq("institution_id", context.institutionId).eq("academic_year", year);
    if (classes.error) return json({ ok:false,error:"primary_event_integrity_check_failed" },503);
    const ids = (classes.data || []).map(row => row.id);
    if (ids.length) {
      const used = await context.service.from("grade_evaluations").select("id")
        .eq("academic_year", year).in("class_id", ids)
        .in("title", changed.map(event => primaryEventTitle(event.id))).limit(1);
      if (used.error) return json({ ok:false,error:"primary_event_integrity_check_failed" },503);
      if (used.data?.length) return json({ ok:false,error:"primary_event_already_used" },409);
    }
  }
  const current = asSettingsObject(context.settings);
  const root = asSettingsObject(current[PRIMARY_EVENTS_SETTINGS_KEY]);
  const years = asSettingsObject(root.years);
  const next = { ...current, [PRIMARY_EVENTS_SETTINGS_KEY]: {
    version:1, years:{ ...years, [year]:events },
  } };
  const saved = await writeSchoolSettings(context.service, context.institutionId,context.settings,next);
  if ("error" in saved) return json({ ok:false,error:saved.error }, saved.status);
  return json({ ok:true, academic_year:year, events, revision:saved.revision });
}
