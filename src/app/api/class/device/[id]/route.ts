// src/app/api/class/device/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const supa = await getSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const srv = getSupabaseServiceClient();

  // ✅ Téléphone du compte connecté (téléphone de la classe)
  let phone = String(user.phone || "").trim();
  if (!phone) {
    const { data: au, error: auErr } = await srv
      .schema("auth")
      .from("users")
      .select("phone")
      .eq("id", user.id)
      .maybeSingle();
    if (auErr) return NextResponse.json({ error: auErr.message }, { status: 400 });
    phone = String(au?.phone || "").trim();
  }
  if (!phone) return NextResponse.json({ error: "no_phone" }, { status: 404 });

  // ✅ Classe demandée
  const { data: cls, error: cErr } = await srv
    .from("classes")
    .select("id,label,level,institution_id,class_phone_e164")
    .eq("id", id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });
  if (!cls) return NextResponse.json({ error: "class_not_found" }, { status: 404 });

  // ✅ Sécurité : ce compte correspond-il au téléphone de la classe ?
  if (String(cls.class_phone_e164 || "").trim() !== phone) {
    return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });
  }

  // ✅ Disciplines (affectations)
  const { data: aff } = await srv
    .from("class_teachers")
    .select("teacher_id, subject_id")
    .eq("class_id", cls.id);

  const subjectIds = Array.from(new Set((aff || []).map(a => a.subject_id).filter(Boolean))) as string[];
  const teacherIds = Array.from(new Set((aff || []).map(a => a.teacher_id).filter(Boolean))) as string[];

  const subjectsMap = new Map<string,string>();
  if (subjectIds.length) {
    const { data: subs } = await srv.from("subjects").select("id,name").in("id", subjectIds);
    for (const s of subs || []) subjectsMap.set(s.id, s.name);
  }

  const teachersMap = new Map<string,string>();
  if (teacherIds.length) {
    const { data: profs } = await srv.from("profiles").select("id,display_name").in("id", teacherIds);
    for (const t of profs || []) teachersMap.set(t.id, t.display_name || "");
  }

  const disciplines = (aff || []).map(a => ({
    subject_id: a.subject_id,
    subject_name: a.subject_id ? subjectsMap.get(a.subject_id) || null : null,
    teacher_id: a.teacher_id,
    teacher_name: a.teacher_id ? teachersMap.get(a.teacher_id) || null : null,
  }));

  return NextResponse.json({ class: cls, disciplines });
}
