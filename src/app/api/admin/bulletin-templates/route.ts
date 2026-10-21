import { isTrustedAppOrigin } from "@/lib/request-origin";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import {
  FRANCO_ARABIC_REPORTS_SETTINGS_KEY,
  readFrancoArabicReportsForEditing,
  validateFrancoArabicReportsInput,
  validateNewCycleScoringRules,
} from "@/lib/franco-arabic-reporting";
import {
  SCHOOL_CYCLES_SETTINGS_KEY,
  isTeachingTrack,
  parseSchoolCyclesSettings,
  type SchoolCycle,
  type SchoolCyclesSettings,
  type TeachingTrack,
} from "@/lib/school-cycles";
import { schoolSettingsRevision, writeSchoolSettings } from "@/lib/school-settings-write";

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
      .select("subject_id,custom_name").eq("institution_id", auth.institutionId)
      .eq("is_active", true).limit(501);
    if (relation.error) return json({ error: "subjects_load_failed" }, 503);
    if ((relation.data || []).length >= 501) return json({ error: "too_many_subjects" }, 503);
    const ids = [...new Set((relation.data || []).map((row) => row.subject_id))];
    if (ids.length) {
      const results = await auth.service.from("subjects").select("id,name")
        .in("id", ids).limit(501);
      if (results.error) return json({ error: "subjects_load_failed" }, 503);
      const byId = new Map((results.data || []).map(row => [row.id, row.name]));
      subjects = (relation.data || []).map(row => ({
        id: row.subject_id,
        name: String(row.custom_name || byId.get(row.subject_id) || row.subject_id),
      })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    }
  }

  return json({
    ok: true,
    institution: { name: institution.name, code: institution.code || institution.code_unique },
    configuration,
    reporting: readFrancoArabicReportsForEditing(institution.settings_json),
    revision: schoolSettingsRevision(institution.settings_json),
    subjects,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await schoolAdmin();
  if ("error" in auth) return auth.error;
  if (!isTrustedAppOrigin(req)) return json({ error: "invalid_origin" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) return json({ error: "expected_json" }, 415);

  const body = await req.json().catch(() => null);
  const incoming = validateFrancoArabicReportsInput(body);
  if (!incoming) return json({ error: "invalid_bulletin_settings" }, 400);

  const { data: school, error } = await auth.service.from("institutions")
    .select("settings_json").eq("id", auth.institutionId).maybeSingle();
  if (error) return json({ error: "institution_load_failed" }, 503);
  if (!school) return json({ error: "institution_not_found" }, 404);
  if (body?.revision !== schoolSettingsRevision(school.settings_json)) {
    return json({ error: "settings_changed_reload_required" }, 409);
  }
  const oldSettings = asSettingsJson(school.settings_json);
  const cycles = parseSchoolCyclesSettings(oldSettings);

  // The new templates are opt-in only; legacy CSCA/other schools stay unchanged.
  if (!cycles.enabled) return json({ error: "school_cycles_not_enabled" }, 409);
  if (incoming.enabled) {
    const oldReporting = readFrancoArabicReportsForEditing(oldSettings);
    const validity = validateNewCycleScoringRules(oldReporting, incoming);
    if (validity !== "ok") return json({ error: validity }, 400);
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
    for (const row of incoming.primarySubjectScales || []) {
      if (!cycles.enabledCycles.includes("primary") ||
        !cycles.teachingTracksByCycle.primary?.includes("arabic") ||
        !cycles.subjectTracksByCycle.primary?.[row.subjectId]?.includes("arabic")) {
        return json({ error: "primary_arabic_subject_not_configured_for_program" }, 400);
      }
    }
    const ids = [...new Set([...incoming.coefficients.map(row => row.subjectId),
      ...(incoming.primarySubjectScales || []).map(row => row.subjectId)])];
    if (ids.length) {
      const active = await auth.service.from("institution_subjects").select("subject_id")
        .eq("institution_id", auth.institutionId).eq("is_active", true)
        .in("subject_id", ids).limit(501);
      if (active.error) return json({ error: "subject_scope_check_failed" }, 503);
      const validIds = new Set((active.data || []).map(row => row.subject_id));
      if (ids.some(id => !validIds.has(id))) return json({ error: "subject_outside_institution" }, 403);
    }
  }

  const reporting = incoming.enabled ? incoming
    : { ...readFrancoArabicReportsForEditing(oldSettings), enabled: false };
  const next = { ...oldSettings, [FRANCO_ARABIC_REPORTS_SETTINGS_KEY]: reporting };
  const updated = await writeSchoolSettings(auth.service, auth.institutionId, school.settings_json, next);
  if ("error" in updated) return json({ error: updated.error }, updated.status);
  return json({ ok: true, reporting, revision: updated.revision });
}

/**
 * School-only assignment of disciplines to the available teaching tracks.
 * Super Admin can open school cycles during onboarding, but cannot configure
 * these curricular mappings. No mutation of class/student/grade tables.
 */
export async function PATCH(req: NextRequest) {
  const auth = await schoolAdmin();
  if ("error" in auth) return auth.error;
  if (!isTrustedAppOrigin(req)) return json({ error: "invalid_origin" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return json({ error: "expected_json" }, 415);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_subject_classification" }, 400);
  }
  const root = (body as Record<string, unknown>).subjectTracksByCycle;
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return json({ error: "invalid_subject_classification" }, 400);
  }

  const { data: school, error } = await auth.service.from("institutions")
    .select("settings_json").eq("id", auth.institutionId).maybeSingle();
  if (error) return json({ error: "institution_load_failed" }, 503);
  if (!school) return json({ error: "institution_not_found" }, 404);
  if ((body as Record<string, unknown>).revision !== schoolSettingsRevision(school.settings_json)) {
    return json({ error: "settings_changed_reload_required" }, 409);
  }
  const stored = asSettingsJson(school.settings_json);
  const current = parseSchoolCyclesSettings(stored);
  if (!current.enabled) return json({ error: "school_cycles_not_enabled" }, 409);

  const supplied = root as Record<string, unknown>;
  if (Object.keys(supplied).some(key => !current.enabledCycles.includes(key as SchoolCycle))) {
    return json({ error: "cycle_not_allowed" }, 400);
  }
  const mapping: SchoolCyclesSettings["subjectTracksByCycle"] = {};
  const referenced = new Set<string>();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const cycle of current.enabledCycles) {
    const perCycle = supplied[cycle] ?? current.subjectTracksByCycle[cycle] ?? {};
    if (!perCycle || typeof perCycle !== "object" || Array.isArray(perCycle)) {
      return json({ error: "invalid_cycle_subjects" }, 400);
    }
    const rows = Object.entries(perCycle as Record<string, unknown>);
    if (rows.length > 250) return json({ error: "too_many_cycle_subjects" }, 400);
    const items: Record<string, TeachingTrack[]> = {};
    for (const [subjectId, tracks] of rows) {
      if (!uuid.test(subjectId) || !Array.isArray(tracks) || !tracks.length ||
          !tracks.every(isTeachingTrack) ||
          tracks.some(track => !current.teachingTracksByCycle[cycle]?.includes(track))) {
        return json({ error: "invalid_program_subject" }, 400);
      }
      referenced.add(subjectId);
      items[subjectId] = [...new Set(tracks)];
    }
    mapping[cycle] = items;
  }

  if (referenced.size) {
    const ids = Array.from(referenced);
    const result = await auth.service.from("institution_subjects")
      .select("subject_id").eq("institution_id", auth.institutionId)
      .eq("is_active", true).in("subject_id", ids).limit(501);
    if (result.error) return json({ error: "subjects_load_failed" }, 503);
    const allowed = new Set((result.data || []).map(row => row.subject_id));
    if (ids.some(id => !allowed.has(id))) {
      return json({ error: "foreign_or_inactive_subject" }, 403);
    }
  }

  // Maintain stable cycle provision, class assignments and unrelated settings.
  const rawCycles = asSettingsJson(stored[SCHOOL_CYCLES_SETTINGS_KEY]);
  const savedMapping = asSettingsJson(rawCycles.subjectTracksByCycle);
  const updated = { ...rawCycles, ...current, subjectTracksByCycle: { ...savedMapping, ...mapping } };
  const next = { ...stored, [SCHOOL_CYCLES_SETTINGS_KEY]: updated };
  const write = await writeSchoolSettings(auth.service, auth.institutionId, school.settings_json, next);
  if ("error" in write) return json({ error: write.error }, write.status);

  return json({ ok: true, configuration: parseSchoolCyclesSettings(next), revision: write.revision });
}
