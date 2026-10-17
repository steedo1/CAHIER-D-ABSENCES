import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { isSchoolCycle, isTeachingTrack, parseSchoolCyclesSettings } from "@/lib/school-cycles";
import {
  SCHOOL_PROGRAM_PERIODS_KEY,
  periodsForProgram,
  readProgramPeriods,
  validateProgramPeriods,
} from "@/lib/school-program-periods";
import { asSettingsObject, schoolSettingsRevision, writeSchoolSettings } from "@/lib/school-settings-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const respond = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

async function verifiedInstitution() {
  const client = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const access = await requireInstitutionRole(client, srv, ["admin"]);
  if ("error" in access) return { error: respond({ error: access.error },
    access.error === "unauthorized" ? 401 : 403) } as const;
  const [{ data: school, error }, { data: active, error: yearError }] = await Promise.all([
    srv.from("institutions").select("settings_json").eq("id", access.instId).maybeSingle(),
    srv.from("academic_years").select("code").eq("institution_id", access.instId)
      .eq("is_current", true).order("start_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error || !school) return { error: respond({ error: "institution_unavailable" }, 503) } as const;
  const cycles = parseSchoolCyclesSettings(school.settings_json);
  if (!cycles.enabled) return { error: respond({ error: "not_multicycle_school" }, 404) } as const;
  if (yearError || !active?.code) return { error: respond({ error: "active_academic_year_required" }, 409) } as const;
  return { srv, institutionId: access.instId, raw: school.settings_json,
    cycles, year: String(active.code) } as const;
}
function selection(
  cycle: unknown, track: unknown,
  school: ReturnType<typeof parseSchoolCyclesSettings>,
) {
  if (!isSchoolCycle(cycle) || !school.enabledCycles.includes(cycle) ||
      !isTeachingTrack(track) || !school.teachingTracksByCycle[cycle]?.includes(track)) return null;
  return { cycle, track };
}

export async function GET(request: NextRequest) {
  const context = await verifiedInstitution();
  if ("error" in context) return context.error;
  const chosen = selection(
    request.nextUrl.searchParams.get("cycle"), request.nextUrl.searchParams.get("track"),
    context.cycles,
  );
  const programs = context.cycles.enabledCycles.flatMap(cycle =>
    (context.cycles.teachingTracksByCycle[cycle] || []).map(track => ({ cycle, track })));
  if (!chosen) return respond({
    ok: true, year: context.year, programs, revision: schoolSettingsRevision(context.raw),
  });
  return respond({
    ok: true, year: context.year, programs, revision: schoolSettingsRevision(context.raw),
    periods: periodsForProgram(context.raw, context.year, chosen.cycle, chosen.track),
  });
}

export async function PUT(request: NextRequest) {
  const context = await verifiedInstitution();
  if ("error" in context) return context.error;
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return respond({ error: "invalid_origin" }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return respond({ error: "expected_json" }, 415);
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "invalid_payload" }, 400);
  const chosen = selection(body.cycle, body.track, context.cycles);
  if (!chosen) return respond({ error: "program_not_enabled" }, 400);
  if (body.year !== context.year) return respond({ error: "year_changed_reload_required" }, 409);
  if (body.revision !== schoolSettingsRevision(context.raw)) {
    return respond({ error: "settings_changed_reload_required" }, 409);
  }
  const periods = validateProgramPeriods(chosen.cycle, body.periods);
  if (!periods) return respond({ error: "invalid_program_periods" }, 400);
  const stored = readProgramPeriods(context.raw);
  const year = { ...(stored.years[context.year] || {}) };
  year[chosen.cycle] = {
    ...(year[chosen.cycle] || {}),
    [chosen.track]: periods,
  };
  const next = {
    ...asSettingsObject(context.raw),
    [SCHOOL_PROGRAM_PERIODS_KEY]: {
      version: 1, years: { ...stored.years, [context.year]: year },
    },
  };
  const saved = await writeSchoolSettings(context.srv, context.institutionId, context.raw, next);
  if ("error" in saved) return respond({ error: saved.error }, saved.status);
  return respond({
    ok: true, year: context.year, periods,
    revision: saved.revision,
  });
}
