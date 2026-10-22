import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { resolveClassDeviceClassIds } from "@/lib/class-device-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

/**
 * Créneaux Cloud du seul établissement autorisé pour le compte classe.
 * Aucun compte professeur, politique Relais, jeton LAN ou cache inter-école
 * n'est nécessaire pour lire ces données.
 */
export async function GET() {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return noStore({ error: "unauthorized" }, 401);

    const service = getSupabaseServiceClient();
    const classIds = await resolveClassDeviceClassIds({
      service,
      userId: user.id,
      userPhone: user.phone,
    });
    // Un téléphone de classe ne peut charger les créneaux d'une autre classe.
    if (classIds.length !== 1) {
      return noStore({ error: "class_device_scope_missing" }, 403);
    }

    const { data: classRow, error: classError } = await service
      .from("classes")
      .select("id,institution_id")
      .eq("id", classIds[0])
      .maybeSingle();
    if (classError) return noStore({ error: "class_context_unavailable" }, 503);
    const classId = String(classRow?.id || "").trim();
    const institutionId = String(classRow?.institution_id || "").trim();
    if (!classId || classId !== classIds[0] || !institutionId) {
      return noStore({ error: "class_device_scope_missing" }, 403);
    }

    const [institutionResult, periodsResult] = await Promise.all([
      service
        .from("institutions")
        .select("id,name,acronym,tz,default_session_minutes,auto_lateness,settings_json")
        .eq("id", institutionId)
        .maybeSingle(),
      service
        .from("institution_periods")
        .select("id,weekday,label,start_time,end_time")
        .eq("institution_id", institutionId)
        .order("weekday", { ascending: true })
        .order("start_time", { ascending: true }),
    ]);
    if (institutionResult.error || periodsResult.error) {
      return noStore({ error: "class_schedule_unavailable" }, 503);
    }
    const institution = institutionResult.data;
    if (!institution || String(institution.id || "") !== institutionId) {
      return noStore({ error: "class_institution_missing" }, 404);
    }
    const settings = institution.settings_json &&
      typeof institution.settings_json === "object" &&
      !Array.isArray(institution.settings_json)
        ? institution.settings_json as Record<string, unknown>
        : {};
    const year = settings.current_academic_year_label ||
      settings.academic_year_label || settings.academic_year || null;

    return noStore({
      institution_id: institutionId,
      class_id: classId,
      actor_profile_id: user.id,
      institution_name: institution.name || institution.acronym || null,
      academic_year_label: year,
      tz: institution.tz || "Africa/Abidjan",
      default_session_minutes: Number(institution.default_session_minutes ?? 60),
      auto_lateness: institution.auto_lateness !== false,
      periods: periodsResult.data || [],
      attendance_presence: { enabled: false, allow_local_relay: false },
    });
  } catch {
    return noStore({ error: "class_schedule_unavailable" }, 503);
  }
}
