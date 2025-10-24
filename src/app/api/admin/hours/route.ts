// src/app/api/admin/hours/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from"); // YYYY-MM-DD
  const to = searchParams.get("to");     // YYYY-MM-DD
  const teacher_id = searchParams.get("teacher_id");

  let query = supabase
    .from("teacher_sessions")
    .select("id,teacher_id,started_at,ended_at,expected_minutes,status,institution_id")
    .in("status", ["submitted","validated"]);

  if (from) query = query.gte("started_at", from);
  if (to)   query = query.lte("started_at", to + "T23:59:59Z");
  if (teacher_id) query = query.eq("teacher_id", teacher_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const sessions = (data ?? []).map(s => {
    const real = s.ended_at ? Math.max((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime())/60000, 0) : 0;
    const minutes = Math.max(real, s.expected_minutes ?? 0);
    return { ...s, minutes: Math.round(minutes) };
  });

  const totalMinutes = sessions.reduce((acc, s) => acc + s.minutes, 0);
  return NextResponse.json({ totalMinutes, sessions }, { status: 200 });
}
