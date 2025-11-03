//src/app/api/public/classes/by-phone/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const srv = getSupabaseServiceClient();
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("phone") || "").trim();
  const phone = normalizePhone(raw);
  if (!phone) return NextResponse.json({ error: "phone_invalid" }, { status: 400 });

  // 1) Trouver la classe par numéro
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,label,level,institution_id,class_phone_e164")
    .eq("class_phone_e164", phone)
    .maybeSingle();

  if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
  if (!cls) return NextResponse.json({ error: "class_not_found" }, { status: 404 });

  // 2) Récupérer les affectations classe-prof-matière
  // Hypothèse: table `class_teachers`(class_id, teacher_id, subject_id)
  const { data: aff, error: affErr } = await srv
    .from("class_teachers")
    .select("teacher_id, subject_id")
    .eq("class_id", cls.id);

  if (affErr) return NextResponse.json({ error: affErr.message }, { status: 400 });

  const subjectIds = Array.from(new Set((aff || []).map(a => a.subject_id).filter(Boolean)));
  const teacherIds = Array.from(new Set((aff || []).map(a => a.teacher_id).filter(Boolean)));

  // 3) Noms des matières
  let subjectsMap = new Map<string, string>();
  if (subjectIds.length) {
    const { data: subjects } = await srv
      .from("subjects")
      .select("id,name")
      .in("id", subjectIds as string[]);
    for (const s of subjects || []) subjectsMap.set(s.id, s.name);
  }

  // 4) Noms des profs
  let teachersMap = new Map<string, string>();
  if (teacherIds.length) {
    const { data: teachers } = await srv
      .from("profiles")
      .select("id,display_name")
      .in("id", teacherIds as string[]);
    for (const t of teachers || []) teachersMap.set(t.id, t.display_name || "");
  }

  // 5) Liste disciplines (matière + prof “attitré” s’il existe)
  const disciplines = (aff || []).map(a => ({
    subject_id: a.subject_id,
    subject_name: subjectsMap.get(a.subject_id) || null,
    teacher_id: a.teacher_id,
    teacher_name: teachersMap.get(a.teacher_id) || null,
  }));

  return NextResponse.json({
    class: {
      id: cls.id,
      label: cls.label,
      level: cls.level,
      institution_id: cls.institution_id,
      phone: cls.class_phone_e164,
    },
    disciplines,
  });
}
