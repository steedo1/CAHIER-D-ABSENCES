//src/app/api/teacher/sessions/open/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { resolveAttendanceEducationContext } from "@/lib/education-attendance";

export async function GET() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ item: null });

  const sessionSelect = `
    id, institution_id, class_id, subject_id, started_at, actual_call_at,
    expected_minutes, presence_method, presence_distance_m, origin, created_by,
    cls:class_id(label,level,education_type,formation_code,formation_level_code),
    subj:subject_id(custom_name)
  `;

  // Compte enseignant normal : la séance est rattachée à teacher_id.
  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  const profileInstitutionId = String(me?.institution_id || "").trim();

  let data: any = null;
  const teacherQuery = supa
    .from("teacher_sessions")
    .select(sessionSelect)
    .eq("teacher_id", user.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);

  if (profileInstitutionId) {
    teacherQuery.eq("institution_id", profileInstitutionId);
  }

  const teacherResult = await teacherQuery.maybeSingle();
  if (teacherResult.error) {
    return NextResponse.json(
      { error: teacherResult.error.message },
      { status: 400 },
    );
  }
  data = teacherResult.data;

  // Téléphone de classe : la séance Cloud est créée pour l'enseignant prévu,
  // mais son propriétaire technique reste le compte du téléphone.
  if (!data) {
    const classDeviceResult = await srv
      .from("teacher_sessions")
      .select(sessionSelect)
      .eq("created_by", user.id)
      .eq("origin", "class_device")
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (classDeviceResult.error) {
      return NextResponse.json(
        { error: classDeviceResult.error.message },
        { status: 400 },
      );
    }
    data = classDeviceResult.data;
  }

  if (!data) return NextResponse.json({ item: null });

  const institutionId = String(data.institution_id || profileInstitutionId || "");
  const { data: institution } = institutionId
    ? await srv
        .from("institutions")
        .select("settings_json")
        .eq("id", institutionId)
        .maybeSingle()
    : { data: null };

  const classMeta = data.cls || {};
  const education = resolveAttendanceEducationContext({
    educationType: classMeta.education_type,
    formationCode: classMeta.formation_code,
    formationLevelCode: classMeta.formation_level_code,
    classLevel: classMeta.level,
    settingsJson: (institution as any)?.settings_json,
  });

  const classDeviceOrigin = String(data.origin || "") === "class_device";
  const item = {
    id: data.id as string,
    class_id: data.class_id as string,
    class_label: data.cls?.label ?? "",
    subject_id: (data.subject_id as string) ?? null,
    subject_name: data.subj?.custom_name ?? null,
    started_at: data.started_at as string,
    actual_call_at: data.actual_call_at as string | null,
    expected_minutes: (data.expected_minutes as number) ?? null,
    presence_method: data.presence_method as string | null,
    presence_distance_m: data.presence_distance_m as number | null,
    local_relay: false,
    delivery_origin: classDeviceOrigin ? "cloud_fallback" : undefined,
    education_type: education.education_type,
    education_label: education.education_label,
    education_short_label: education.education_short_label,
    formation_code: education.formation_code,
    formation_label: education.formation_label,
    formation_level_code: education.formation_level_code,
    formation_level_label: education.formation_level_label,
    education_context_key: education.context_key,
    education_context_label: education.context_label,
  };

  return NextResponse.json({ item });
}
