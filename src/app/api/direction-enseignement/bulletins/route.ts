import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireTeachingDirector } from "@/lib/auth/teaching-director";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import { readStudentProgramSettings } from "@/lib/school-student-programs";
import { loadSpecializedBulletin } from "@/lib/server/specialized-bulletin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * Specialized official bulletins for a verified teaching director.
 * No client-supplied role, institution or teaching track is trusted.
 * Dual-track classes are forbidden until evaluation records disambiguate them.
 * Classic bulletin endpoint is not changed by this route.
 */
export async function GET(req: NextRequest) {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireTeachingDirector(client, service);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  const { institutionId, teachingTrack, cycles } = access.principal;
  const classId = req.nextUrl.searchParams.get("class_id") || "";
  const periodId = req.nextUrl.searchParams.get("period_id") || "";
  if (!UUID.test(classId) || !UUID.test(periodId)) {
    return json({ ok: false, error: "class_and_period_required" }, 400);
  }
  const [institution, schoolClass, currentYear] = await Promise.all([
    service.from("institutions")
      .select("name,code_unique,logo_url,phone,email,postal_address,regional_direction,settings_json")
      .eq("id", institutionId).maybeSingle(),
    service.from("classes")
      .select("id,institution_id,level,label,academic_year,education_type,formation_code")
      .eq("id", classId).eq("institution_id", institutionId).maybeSingle(),
    service.from("academic_years").select("code")
      .eq("institution_id", institutionId).eq("is_current", true).limit(1).maybeSingle(),
  ]);
  if (institution.error || schoolClass.error || currentYear.error) {
    return json({ ok: false, error: "director_bulletin_context_unavailable" }, 503);
  }
  if (!institution.data || !schoolClass.data || !currentYear.data ||
      schoolClass.data.academic_year !== currentYear.data.code) {
    return json({ ok: false, error: "director_class_not_found" }, 404);
  }
  const school = parseSchoolCyclesSettings(institution.data.settings_json);
  const cycle = school.classCycleById[classId];
  const policy = readStudentProgramSettings(institution.data.settings_json)
    .years[schoolClass.data.academic_year]?.classes[classId];
  if (!cycle || !cycles.includes(cycle) ||
      policy?.tracks.length !== 1 || policy.tracks[0] !== teachingTrack) {
    return json({ ok: false, error: "director_class_scope_forbidden" }, 403);
  }
  const result = await loadSpecializedBulletin({
    service, institutionId, schoolClass: schoolClass.data,
    settingsJson: institution.data.settings_json,
    institutionName: institution.data.name,
    institutionCode: institution.data.code_unique,
    institutionContacts: {
      logoUrl: institution.data.logo_url,
      phone: institution.data.phone,
      email: institution.data.email,
      address: institution.data.postal_address,
      regionalDirection: institution.data.regional_direction,
    },
    role: "teaching_director",
    authorizedTrack: teachingTrack,
    searchParams: new URLSearchParams({ class_id: classId, period_id: periodId,
      academic_year: schoolClass.data.academic_year }),
  });
  if (!result) return json({
    ok: false, error: "specialized_bulletins_not_enabled",
    message: "Le moteur spécialisé de bulletins doit être activé par l'administration.",
  }, 409);
  return result;
}
