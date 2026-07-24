//src/app/api/teacher/sessions/open/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { resolveAttendanceEducationContext } from "@/lib/education-attendance";

export async function GET() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ item: null });

  // R�cup�re l�"�tablissement du prof
  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const inst = me?.institution_id as string | null;

  const { data, error } = await supa
    .from("teacher_sessions")
    .select(`
      id, class_id, subject_id, started_at, actual_call_at, expected_minutes,
      presence_method, presence_distance_m,
      cls:class_id(label,level,education_type,formation_code,formation_level_code),
      subj:subject_id(custom_name)
    `)
    .eq("teacher_id", user.id)
    .eq(inst ? "institution_id" : "teacher_id", inst ?? user.id) // filtre �tablissement si dispo
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ item: null });

  const { data: institution } = inst
    ? await srv
        .from("institutions")
        .select("settings_json")
        .eq("id", inst)
        .maybeSingle()
    : { data: null };

  const classMeta = (data as any).cls || {};
  const education = resolveAttendanceEducationContext({
    educationType: classMeta.education_type,
    formationCode: classMeta.formation_code,
    formationLevelCode: classMeta.formation_level_code,
    classLevel: classMeta.level,
    settingsJson: (institution as any)?.settings_json,
  });

  const item = {
    id: data.id as string,
    class_id: data.class_id as string,
    class_label: (data as any).cls?.label ?? "",
    subject_id: (data.subject_id as string) ?? null,
    subject_name: (data as any).subj?.custom_name ?? null,
    started_at: data.started_at as string,
    actual_call_at: (data as any).actual_call_at as string | null,
    expected_minutes: (data.expected_minutes as number) ?? null,
    presence_method: (data as any).presence_method as string | null,
    presence_distance_m: (data as any).presence_distance_m as number | null,
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

