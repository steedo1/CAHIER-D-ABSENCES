// src/app/api/teacher/sessions/open/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supa = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ item: null });
  }

  // Institution du profil courant (si dispo)
  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return NextResponse.json({ error: meErr.message }, { status: 400 });
  }

  const institution_id = (me?.institution_id as string | null) ?? null;

  const query = supa
    .from("teacher_sessions")
    .select(`
      id,
      class_id,
      subject_id,
      started_at,
      actual_call_at,
      expected_minutes,
      opened_from,
      cls:class_id(label),
      subj:subject_id(custom_name)
    `)
    .eq("teacher_id", user.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);

  const { data, error } = institution_id
    ? await query.eq("institution_id", institution_id).maybeSingle()
    : await query.maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ item: null });
  }

  const item = {
    id: data.id as string,
    class_id: data.class_id as string,
    class_label: (data as any).cls?.label ?? "",
    subject_id: (data.subject_id as string) ?? null,
    subject_name: (data as any).subj?.custom_name ?? null,
    started_at: data.started_at as string,
    actual_call_at: (data as any).actual_call_at ?? null,
    expected_minutes: (data.expected_minutes as number) ?? null,
    opened_from: ((data as any).opened_from as "teacher" | "class_device" | null) ?? null,
  };

  return NextResponse.json({ item });
}