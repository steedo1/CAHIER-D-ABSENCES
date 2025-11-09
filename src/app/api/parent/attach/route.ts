import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { student_id?: string; matricule?: string };

export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient();   // RLS (parent connecté)
  const srv  = getSupabaseServiceClient();        // service (upsert fiable)

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const explicitId = (body?.student_id || "").trim();
  const matricule  = (body?.matricule  || "").trim();
  if (!explicitId && !matricule) return NextResponse.json({ error: "missing_student" }, { status: 400 });

  // Résoudre l’élève
  let studentId = explicitId || null;
  if (!studentId) {
    const { data: st, error: sErr } = await srv
      .from("students")
      .select("id")
      .eq("matricule", matricule)
      .maybeSingle();
    if (sErr)  return NextResponse.json({ error: sErr.message }, { status: 400 });
    if (!st)   return NextResponse.json({ error: "student_not_found" }, { status: 404 });
    studentId = String(st.id);
  }

  // Lien parent ↔ élève (idempotent)
  const row = {
    student_id: studentId,
    parent_id:  user.id,
    notifications_enabled: true,
    updated_at: new Date().toISOString(),
  };

  const up = await srv
    .from("student_guardians")
    .upsert(row, { onConflict: "student_id,parent_id", ignoreDuplicates: false });

  if (up.error) {
    // Fallback UPDATE puis INSERT si l’index/constraint manque encore
    await srv.from("student_guardians")
      .update(row)
      .match({ student_id: studentId, parent_id: user.id });

    const ins = await srv
      .from("student_guardians")
      .insert({ ...row, created_at: new Date().toISOString() })
      .select("student_id")
      .limit(1);

    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, student_id: studentId });
}
