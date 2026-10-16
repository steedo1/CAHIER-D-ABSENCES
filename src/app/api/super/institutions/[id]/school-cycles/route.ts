import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient, getVerifiedServerUser } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
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

async function superAccess() {
  const supa = await getSupabaseServerClient();
  const { data: { user }, error } = await getVerifiedServerUser(supa);
  if (error || !user) return { error: reply({ error: "unauthorized" }, 401) } as const;

  const srv = getSupabaseServiceClient();
  const roles = await srv.from("user_roles").select("role").eq("profile_id", user.id);
  if (roles.error) return { error: reply({ error: "permission_check_unavailable" }, 503) } as const;
  if (!roles.data?.some((r) => r.role === "super_admin")) {
    return { error: reply({ error: "forbidden" }, 403) } as const;
  }
  return { srv, user } as const;
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: Params) {
  const access = await superAccess();
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

  return reply({
    ok: true,
    institution: { id: data.id, name: data.name, code_unique: data.code_unique },
    configuration: parseSchoolCyclesSettings(data.settings_json),
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
    classCycleById: {}, // existing class assignments are re-applied server-side only
    defaultView,
    preferredLanguage: input.preferredLanguage,
  };
}

/**
 * Only the super admin can activate cycles.
 * The old JSON settings keys are preserved; no database migration is required.
 */
export async function PUT(req: NextRequest, context: Params) {
  const access = await superAccess();
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
  const previous = parseSchoolCyclesSettings(oldJson);

  // Preserve any explicit per-class assignments that remain within active cycles.
  const classCycleById: Record<string, SchoolCycle> = {};
  if (incoming.enabled) {
    for (const [classId, cycle] of Object.entries(previous.classCycleById)) {
      if (incoming.enabledCycles.includes(cycle)) classCycleById[classId] = cycle;
    }
  }

  const updated: SchoolCyclesSettings = { ...incoming, classCycleById };
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
