import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  parseSchoolCyclesSettings,
  resolveSchoolCycleForClass,
} from "@/lib/school-cycles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "no-store" };
type SchoolClass = { id: string; code: string; label: string | null; level: string | null; academic_year: string };

function normalizePrimaryPhone(raw: string) {
  const s = raw.trim().replace(/[^+0-9]/g, "");
  // Numéro ivoirien à 10 chiffres : conserver impérativement son premier 0.
  if (/^0[0-9]{9}$/.test(s)) return "+225" + s;
  if (/^2250[0-9]{9}$/.test(s)) return "+" + s;
  if (/^\+2250[0-9]{9}$/.test(s)) return s;
  return /^\+[1-9][0-9]{5,14}$/.test(s) ? s : null;
}

async function authorizedSchool() {
  const userClient = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile?.institution_id) {
    return { ok: false as const, response: NextResponse.json({ error: "no_institution" }, { status: 403 }) };
  }

  const institutionId: string = String(profile.institution_id);
  const { data: roles, error: roleError } = await service
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);
  const authorized = !roleError && (roles || []).some((row) =>
    String(row.role) === "super_admin" ||
    (String(row.role) === "admin" && String(row.institution_id) === institutionId)
  );
  if (!authorized) {
    return { ok: false as const, response: NextResponse.json({ error: "admin_required" }, { status: 403 }) };
  }

  const { data: institution, error: institutionError } = await service
    .from("institutions")
    .select("settings_json")
    .eq("id", institutionId)
    .maybeSingle();
  if (institutionError || !institution) {
    return { ok: false as const, response: NextResponse.json({ error: "school_configuration_unavailable" }, { status: 503 }) };
  }
  return {
    ok: true as const,
    service,
    institutionId,
    settings: parseSchoolCyclesSettings(institution.settings_json),
  };
}

export async function GET() {
  const access = await authorizedSchool();
  if (!access.ok) return access.response;
  const { service, institutionId, settings } = access;

  // N'expose pas l'outil dans les établissements exclusivement secondaires.
  if (!settings.enabled || !settings.enabledCycles.includes("primary")) {
    return NextResponse.json({ ok: true, enabled: false, classes: [], items: [] }, { headers: noStore });
  }

  const { data: currentYear } = await service.from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  let query = service.from("classes")
    .select("id,code,label,level,academic_year")
    .eq("institution_id", institutionId)
    .order("academic_year", { ascending: false })
    .order("code", { ascending: true })
    .limit(500);
  if (currentYear?.code) query = query.eq("academic_year", String(currentYear.code));
  const { data: schoolClasses, error: classError } = await query;
  if (classError) {
    return NextResponse.json({ error: "classes_unavailable" }, { status: 500 });
  }
  const classes = ((schoolClasses || []) as SchoolClass[])
    .filter((row) => resolveSchoolCycleForClass(row, settings) === "primary");

  const { data: teacherRows, error: teacherError } = await service.from("primary_class_teachers")
    .select("id,class_id,display_name,phone_e164,account_profile_id")
    .eq("institution_id", institutionId)
    .in("class_id", classes.length ? classes.map((row) => row.id) : ["00000000-0000-0000-0000-000000000000"]);
  if (teacherError) {
    return NextResponse.json({ error: "primary_teachers_unavailable" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    academic_year: currentYear?.code || classes[0]?.academic_year || null,
    classes,
    items: (teacherRows || []).map((row) => ({
      id: row.id,
      class_id: row.class_id,
      display_name: row.display_name,
      phone_e164: row.phone_e164,
      account_linked: Boolean(row.account_profile_id),
    })),
  }, { headers: noStore });
}

export async function POST(req: NextRequest) {
  const access = await authorizedSchool();
  if (!access.ok) return access.response;
  const { service, institutionId, settings } = access;

  if (!settings.enabled || !settings.enabledCycles.includes("primary")) {
    return NextResponse.json({ error: "primary_not_enabled" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const classId = String(body?.class_id || "").trim();
  const displayName = String(body?.display_name || "").normalize("NFC").trim().replace(/\s+/g, " ");
  const rawPhone = String(body?.phone || "").trim();
  const phone = rawPhone ? normalizePrimaryPhone(rawPhone) : null;
  if (rawPhone && !phone) return NextResponse.json({ error: "Numéro de téléphone invalide." }, { status: 400 });
  if (!UUID.test(classId) || displayName.length < 2 || displayName.length > 160) {
    return NextResponse.json({ error: "class_and_teacher_name_required" }, { status: 400 });
  }

  const { data: schoolClass, error: classError } = await service.from("classes")
    .select("id,level,academic_year")
    .eq("institution_id", institutionId)
    .eq("id", classId)
    .maybeSingle();
  if (classError || !schoolClass || resolveSchoolCycleForClass(schoolClass, settings) !== "primary") {
    return NextResponse.json({ error: "primary_class_not_found" }, { status: 404 });
  }

  const { data: existing, error: existingError } = await service.from("primary_class_teachers")
    .select("id,display_name,phone_e164,account_profile_id")
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: "primary_teacher_lookup_failed" }, { status: 500 });
  }
  if (existing?.account_profile_id && existing.display_name.trim() !== displayName) {
    return NextResponse.json({ error: "Compte actif : transfert administratif requis pour changer de titulaire." }, { status: 409 });
  }
  if (existing?.account_profile_id && phone && phone !== existing.phone_e164) {
    return NextResponse.json({ error: "Compte déjà actif : modifiez le téléphone depuis la gestion des comptes." }, { status: 409 });
  }
  if (existing) {
    // Un changement de titulaire ne doit pas conserver l'accès de l'ancien.
    const changed = String(existing.display_name).trim() !== displayName;
    const { error } = await service.from("primary_class_teachers")
      .update({
        display_name: displayName,
        phone_e164: phone || existing.phone_e164,
        updated_at: new Date().toISOString(),
        ...(changed ? { account_profile_id: null } : {}),
      })
      .eq("id", existing.id)
      .eq("institution_id", institutionId);
    if (error) return NextResponse.json({ error: "primary_teacher_update_failed" }, { status: 500 });
  } else {
    const { error } = await service.from("primary_class_teachers").insert({
      institution_id: institutionId,
      class_id: classId,
      display_name: displayName,
      phone_e164: phone,
    });
    if (error) return NextResponse.json({ error: "primary_teacher_insert_failed" }, { status: 500 });
  }

  // Pas d'écriture Auth, class_teachers, teacher_subjects ni teacher_timetables.
  // L'accès enseignant sera lié séparément avec un identifiant vérifié.
  return NextResponse.json({ ok: true, class_id: classId, display_name: displayName, account_linked: Boolean(existing?.account_profile_id) }, { headers: noStore });
}
