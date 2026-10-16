import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminAccess } from "@/lib/super-admin-access";
import {
  FRANCO_ARABIC_REPORTS_SETTINGS_KEY,
  parseFrancoArabicReportsSettings,
  validateFrancoArabicReportsInput,
} from "@/lib/franco-arabic-reporting";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export async function GET(_req: NextRequest, context: Ctx) {
  const access = await requireSuperAdminAccess();
  if ("error" in access) return access.error;
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "invalid_institution" }, 400);
  const result = await access.srv.from("institutions")
    .select("id,name,settings_json").eq("id", id).maybeSingle();
  if (result.error) return json({ error: "load_failed" }, 503);
  if (!result.data) return json({ error: "not_found" }, 404);
  return json({
    ok: true,
    institution: { id, name: result.data.name },
    reporting: parseFrancoArabicReportsSettings(result.data.settings_json),
  });
}

/**
 * Preparation only. Does not create bulletins, update grades, or grant roles.
 * This keeps the bulletin settings separate from the older coefficients
 * configuration to avoid altering existing academic rules.
 */
export async function PUT(req: NextRequest, context: Ctx) {
  const access = await requireSuperAdminAccess();
  if ("error" in access) return access.error;
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return json({ error: "invalid_origin" }, 403);
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return json({ error: "expected_json" }, 415);
  }
  const { id } = await context.params;
  if (!UUID.test(id)) return json({ error: "invalid_institution" }, 400);
  const body = await req.json().catch(() => null);
  const settings = validateFrancoArabicReportsInput(body);
  if (!settings) return json({ error: "invalid_report_configuration" }, 400);

  const current = await access.srv.from("institutions")
    .select("id,settings_json").eq("id", id).maybeSingle();
  if (current.error) return json({ error: "load_failed" }, 503);
  if (!current.data) return json({ error: "not_found" }, 404);

  const oldJson = current.data.settings_json &&
    typeof current.data.settings_json === "object" &&
    !Array.isArray(current.data.settings_json)
      ? current.data.settings_json as Record<string, unknown>
      : {};

  // It is not safe to attach academic templates to an ordinary/legacy school.
  const cycles = parseSchoolCyclesSettings(oldJson);
  if (settings.enabled && !cycles.enabled) {
    return json({ error: "multicycle_must_be_enabled_first" }, 409);
  }
  if (settings.enabled && settings.scales.some((entry) =>
    !cycles.enabledCycles.includes(entry.cycle) ||
    !cycles.teachingTracksByCycle[entry.cycle]?.includes(entry.track))) {
    return json({ error: "scale_outside_enabled_program" }, 400);
  }

  const nextJson = { ...oldJson, [FRANCO_ARABIC_REPORTS_SETTINGS_KEY]: settings };
  const updated = await access.srv.from("institutions")
    .update({ settings_json: nextJson }).eq("id", id).select("id").single();
  if (updated.error) return json({ error: "save_failed" }, 503);

  return json({ ok: true, reporting: settings });
}
