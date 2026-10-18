import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import {
  FRANCO_ARABIC_REPORTS_SETTINGS_KEY,
  isReportFormat,
  readFrancoArabicReportsForEditing,
  validateFrancoArabicReportsInput,
} from "@/lib/franco-arabic-reporting";
import { isSchoolCycle, parseSchoolCyclesSettings } from "@/lib/school-cycles";
import { schoolSettingsRevision, writeSchoolSettings } from "@/lib/school-settings-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const response = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * An isolated presentation-only update: never changes the bulletin engine,
 * grading scales, subject coefficients, enrolment, or academic marks.
 * The school uses the chosen layout on real bulletins if and only if the
 * independently configured specialized calculation engine is already active.
 */
export async function PATCH(req: NextRequest) {
  const browser = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireInstitutionRole(browser, service, ["admin"]);
  if ("error" in access) {
    return response({ ok: false, error: access.error }, access.error === "unauthorized" ? 401 : 403);
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return response({ ok: false, error: "invalid_origin" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return response({ ok: false, error: "expected_json" }, 415);
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !isSchoolCycle(body.cycle) || !isReportFormat(body.format) ||
      typeof body.revision !== "string") {
    return response({ ok: false, error: "invalid_model_selection" }, 400);
  }
  // Le secondaire conserve le bulletin historique. Refus aussi côté API.
  if (body.cycle === "secondary") {
    return response({ ok: false, error: "secondary_uses_historical_bulletin" }, 400);
  }
  const { data: institution, error } = await service.from("institutions")
    .select("settings_json").eq("id", access.instId).maybeSingle();
  if (error || !institution) return response({ ok: false, error: "school_unavailable" }, 503);
  const previous = institution.settings_json;
  if (body.revision !== schoolSettingsRevision(previous)) {
    return response({ ok: false, error: "settings_changed_reload_required" }, 409);
  }
  const school = parseSchoolCyclesSettings(previous);
  if (!school.enabled || !school.enabledCycles.includes(body.cycle)) {
    return response({ ok: false, error: "cycle_not_available" }, 400);
  }
  // JSON fields are untyped at runtime; narrow the validated cycle before
  // indexing the type-safe school teaching mapping.
  const cycle = body.cycle as import("@/lib/school-cycles").SchoolCycle;
  const bilingual = school.teachingTracksByCycle[cycle]?.includes("arabic") &&
    school.teachingTracksByCycle[cycle]?.includes("french");
  if (!bilingual && body.format !== "separate") {
    return response({ ok: false, error: "one_teaching_only" }, 400);
  }
  const original = previous && typeof previous === "object" && !Array.isArray(previous)
    ? previous as Record<string, unknown> : {};
  const oldPolicy = original[FRANCO_ARABIC_REPORTS_SETTINGS_KEY];
  // Refuse to turn a damaged saved policy into a fresh one. The editor
  // must not erase coefficients or scales because of a model choice.
  if (oldPolicy && (typeof oldPolicy !== "object" || Array.isArray(oldPolicy) ||
      !validateFrancoArabicReportsInput({ ...oldPolicy, enabled: true }))) {
    return response({ ok: false, error: "existing_bulletin_rules_need_review" }, 409);
  }
  const old = readFrancoArabicReportsForEditing(previous);
  const requested = validateFrancoArabicReportsInput({
    ...old, enabled: true,
    formatsByCycle: { ...(old.formatsByCycle || {}), [body.cycle]: body.format },
  });
  if (!requested) return response({ ok: false, error: "invalid_bulletin_settings" }, 409);
  // Preserve the independent activation status and every calculation field.
  const reporting = { ...requested, enabled: old.enabled };
  const next = { ...original, [FRANCO_ARABIC_REPORTS_SETTINGS_KEY]: reporting };
  const written = await writeSchoolSettings(service, access.instId, previous, next);
  if ("error" in written) return response({ ok: false, error: written.error }, written.status);
  return response({
    ok: true, reporting, revision: written.revision,
    active: reporting.enabled && reporting.engine === "specialized" && body.cycle !== "preschool",
  });
}
