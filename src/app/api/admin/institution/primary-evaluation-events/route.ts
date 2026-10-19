import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import {
  PRIMARY_EVENTS_SETTINGS_KEY,
  primarySchoolYearIsValid,
  readPrimaryEventsCatalog,
  validatePrimaryEvents,
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
  if ("error" in access) return { error: json({ ok: false, error: access.error }, 403) };
  const { data, error } = await service.from("institutions").select("settings_json")
    .eq("id", access.instId).maybeSingle();
  if (error || !data) return { error: json({ ok: false, error: "institution_unavailable" }, 503) };
  const settings = data.settings_json && typeof data.settings_json === "object" &&
    !Array.isArray(data.settings_json) ? data.settings_json as Record<string, unknown> : {};
  const school = parseSchoolCyclesSettings(settings);
  if (!school.enabled || !school.enabledCycles.includes("primary")) {
    return { error: json({ ok: false, error: "primary_school_required" }, 403) };
  }
  return { service, institutionId: access.instId, settings };
}

export async function GET(request: NextRequest) {
  const year = request.nextUrl.searchParams.get("academic_year") || "";
  if (!primarySchoolYearIsValid(year)) return json({ ok: false, error: "invalid_year" }, 400);
  const access = await context(false);
  if ("error" in access) return access.error;
  const catalog = readPrimaryEventsCatalog(access.settings);
  return json({ ok: true, academic_year: year, events: catalog.years[year]?.events || [] });
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
  const catalog = readPrimaryEventsCatalog(access.settings);
  catalog.years[year] = { events: validated.events };
  const newSettings = { ...access.settings, [PRIMARY_EVENTS_SETTINGS_KEY]: catalog };
  // Scope to this institution only. Never change grade_periods or secondary settings.
  const { data, error } = await access.service.from("institutions")
    .update({ settings_json: newSettings })
    .eq("id", access.institutionId)
    .select("id");
  if (error || !data?.length) return json({ ok: false, error: "primary_events_save_failed" }, 503);
  return json({ ok: true, academic_year: year, events: validated.events });
}
