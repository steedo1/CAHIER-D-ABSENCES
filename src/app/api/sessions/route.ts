// src/app/api/admin/sessions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { institution_id, class_id, discipline_id, expected_minutes } = await req.json();

  // Ouverture
  const { data, error } = await supabase
    .from("teacher_sessions")
    .insert({
      institution_id,
      teacher_id: user.id,
      class_id,
      discipline_id: discipline_id ?? null,
      expected_minutes: expected_minutes ?? 60,
      status: "open",
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Journal
  await supabase.from("worklog_events").insert({
    institution_id,
    session_id: data.id,
    actor_id: user.id,
    type: "session_opened",
    payload: { class_id, discipline_id, expected_minutes: expected_minutes ?? 60 },
  });

  return NextResponse.json({ session: data }, { status: 201 });
}


