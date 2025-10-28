// src/app/api/teacher/attendance/bulk/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type Mark = {
  student_id: string;
  status: "present" | "absent" | "late";
  minutes_late?: number;
  reason?: string | null; // FACULTATIF
};

export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const session_id = body?.session_id as string;
  const marks = Array.isArray(body?.marks) ? (body.marks as Mark[]) : [];

  if (!session_id)
    return NextResponse.json({ error: "missing_session" }, { status: 400 });

  // v�rifier propri�taire de la s�ance
  const { data: sess } = await supa
    .from("teacher_sessions")
    .select("id,teacher_id,class_id")
    .eq("id", session_id)
    .maybeSingle();
  if (!sess || (sess as any).teacher_id !== user.id)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // onUpsert pour absent/late ; onDelete si pr�sent
  const toUpsert: any[] = [];
  const toDelete: string[] = []; // student_id list

  for (const m of marks) {
    if (!m?.student_id) continue;
    if (m.status === "present") {
      toDelete.push(m.student_id);
      continue;
    }
    if (m.status !== "absent" && m.status !== "late") continue;

    toUpsert.push({
      session_id,
      student_id: m.student_id,
      status: m.status,
      minutes_late: m.status === "late" ? Math.max(0, Math.round(m.minutes_late || 0)) : 0,
      reason: m.reason ?? null,
    });
  }

  let upserted = 0,
    deleted = 0;

  if (toUpsert.length) {
    const { error, count } = await srv
      .from("attendance_marks")
      .upsert(toUpsert, { onConflict: "session_id,student_id", count: "exact" });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    upserted = count || toUpsert.length;
  }

  if (toDelete.length) {
    const { error, count } = await srv
      .from("attendance_marks")
      .delete({ count: "exact" })
      .eq("session_id", session_id)
      .in("student_id", toDelete);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    deleted = count || toDelete.length;
  }

  return NextResponse.json({ ok: true, upserted, deleted });
}


