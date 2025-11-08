//src/app/api/admin/absences/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");
  const class_id = searchParams.get("class_id") || "";
  const student_id = searchParams.get("student_id") || "";
  const teacher_email = searchParams.get("teacher_email") || "";

  let teacher_id: string|undefined;
  if (teacher_email) {
    const { data: t } = await srv.from("profiles").select("id").eq("email", teacher_email).maybeSingle();
    teacher_id = t?.id;
  }

  // jointure marks -> sessions (filtrage par p�riode/classe/teacher)
  let q = supa.from("attendance_marks")
    .select("status, session_id, minutes_late, session:teacher_sessions!inner(class_id,teacher_id,started_at)");

  if (from) q = q.gte("session.started_at", from);
  if (to)   q = q.lte("session.started_at", to + "T23:59:59Z");
  if (class_id)   q = q.eq("session.class_id", class_id);
  if (student_id) q = q.eq("student_id", student_id);
  if (teacher_id) q = q.eq("session.teacher_id", teacher_id);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const absences = (data ?? []).filter((m:any)=>m.status==="absent").length;
  const retards  = (data ?? []).filter((m:any)=>m.status==="late").length;

  return NextResponse.json({ absences, retards }, { status: 200 });
}


