import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import {
  FRANCO_ARABIC_REPORTS_SETTINGS_KEY,
  parseFrancoArabicReportsSettings,
  validateFrancoArabicReportsInput,
} from "@/lib/franco-arabic-reporting";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (payload: unknown, status = 200) => NextResponse.json(payload, {
  status,
  headers: { "Cache-Control": "no-store" },
});

async function schoolAdmin() {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  // Bulletin settings belong to the pedagogical ADMIN, not to Super Admin.
  const access = await requireInstitutionRole(client, service, ["admin"]);
  if ("error" in access) return { error: json({ error: access.error }, access.error === "unauthorized" ? 401 : 403) } as const;
  return { service, institutionId: access.instId } as const;
}

function asSettingsJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET() {
  const auth = await schoolAdmin();
  if ("error" in auth) return auth.error;

  const { data: institution, error } = await auth.service.from("institutions")
    .select("id,name,code,code_unique,settings_json")
    .eq("id", auth.institutionId)
    .maybeSingle();
  if (error) return json({ error: "institution_load_failed" }, 503);
  if (!institution) return json({ error: "institution_not_found" }, 404);
  const configuration = parseSchoolCyclesSettings(institution.settings_json);

  // No invented subject lists: only disciplines actually activated for this school.
  let subjects: Array<{ id: string; name: string }> = [];
  if (configuration.enabled) {
    const relation = await auth.service.from("institution_subjects")
      .select("subject_id").eq("institution_id", auth.institutionId)
      .eq("is_active", true).limit(501);
    if (relation.error) return json({ error: "subjects_load_failed" }, 503);
    if ((relation.data || []).length >= 501) return json({ error: "too_many_subjects" }, 503);
    const ids = [...new Set((relation.data || []).map((row) => row.subject_id))];
    if (ids.length) {
      const results = await auth.service.from("subjects").select("id,name")
        .in("id", ids).limit(501);
      if (results.error) return json({ error: "subjects_load_failed" }, 503);
      subjects = results.data || [];
    }
  }

  return json({
    ok: true,
    institution: { name: institution.name, code: institution.code || institution.code_unique },
    configuration,
    reporting: parseFrancoArabicReportsSettings(institution.settings_json),
    subjects,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await schoolAdmin();
  if ("error" in auth) return auth.error;
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return json({ error: "invalid_origin" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) return json({ error: "expected_json" }, 415);

  const incoming = validateFrancoArabicReportsInput(await req.json().catch(() => null));
  if (!incoming) return json({ error: "invalid_bulletin_settings" }, 400);

  const { data: school, error } = await auth.service.from("institutions")
    .select("settings_json").eq("id", auth.institutionId).maybeSingle();
  if (error) return json({ error: "institution_load_failed" }, 503);
  if (!school) return json({ error: "institution_not_found" }, 404);
  const oldSettings = asSettingsJson(school.settings_json);
  const cycles = parseSchoolCyclesSettings(oldSettings);

  // The new templates are opt-in only; legacy CSCA/other schools stay unchanged.
  if (!cycles.enabled) return json({ error: "school_cycles_not_enabled" }, 409);
  if (incoming.enabled) {
    const hasArabic = cycles.enabledCycles.some(cycle =>
      cycles.teachingTracksByCycle[cycle]?.includes("arabic"));
    if (!hasArabic && incoming.format !== "separate") {
      return json({ error: "single_language_school_requires_ordinary_bulletin" }, 400);
    }
    if (incoming.scales.some(row =>
      !cycles.enabledCycles.includes(row.cycle) ||
      !cycles.teachingTracksByCycle[row.cycle]?.includes(row.track))) {
      return json({ error: "scale_outside_school_program" }, 400);
    }
    for (const row of incoming.coefficients) {
      if (!cycles.subjectTracksByCycle[row.cycle]?.[row.subjectId]?.includes(row.track)) {
        return json({ error: "subject_not_configured_for_program" }, 400);
      }
    }
    const ids = [...new Set(incoming.coefficients.map(row => row.subjectId))];
    if (ids.length) {
      const active = await auth.service.from("institution_subjects").select("subject_id")
        .eq("institution_id", auth.institutionId).eq("is_active", true)
        .in("subject_id", ids).limit(501);
      if (active.error) return json({ error: "subject_scope_check_failed" }, 503);
      const validIds = new Set((active.data || []).map(row => row.subject_id));
      if (ids.some(id => !validIds.has(id))) return json({ error: "subject_outside_institution" }, 403);
    }
  }

  const updated = await auth.service.from("institutions")
    .update({
      settings_json: { ...oldSettings, [FRANCO_ARABIC_REPORTS_SETTINGS_KEY]: incoming },
    })
    .eq("id", auth.institutionId).select("id").single();
  if (updated.error) return json({ error: "save_failed" }, 503);
  return json({ ok: true, reporting: incoming });
}
