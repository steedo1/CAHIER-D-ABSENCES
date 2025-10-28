import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET() {
  const supa = await getSupabaseServerClient();
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
      id, class_id, subject_id, started_at, expected_minutes,
      cls:class_id(label),
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

  const item = {
    id: data.id as string,
    class_id: data.class_id as string,
    class_label: (data as any).cls?.label ?? "",
    subject_id: (data.subject_id as string) ?? null,
    subject_name: (data as any).subj?.custom_name ?? null,
    started_at: data.started_at as string,
    expected_minutes: (data.expected_minutes as number) ?? null,
  };

  return NextResponse.json({ item });
}


