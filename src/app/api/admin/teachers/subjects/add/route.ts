import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

// same normalization as DB trigger (remove accents, trim, lower)
function subjectKey(name: string): string {
  const ascii = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return ascii.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { profile_id, subject } = (await req.json()) as { profile_id: string; subject: string };
  if (!profile_id) return NextResponse.json({ error: "profile_id requis" }, { status: 400 });

  const label = (subject || "").trim();
  if (!label) return NextResponse.json({ error: "subject requis" }, { status: 400 });

  // Resolve current admin's institution
  let institution_id: string | null = null;
  {
    const { data: p } = await srv.from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
    institution_id = (p?.institution_id as string) ?? null;
    if (!institution_id) {
      const { data: ur } = await srv
        .from("user_roles")
        .select("institution_id")
        .eq("profile_id", user.id)
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();
      institution_id = (ur?.institution_id as string) ?? null;
    }
  }
  if (!institution_id) {
    return NextResponse.json({ error: "institution inconnue" }, { status: 400 });
  }

  // 1) Resolve or create the global subject (table subjects)
  const key = subjectKey(label);
  let subject_id: string | null = null;

  const found = await srv.from("subjects").select("id").eq("subject_key", key).maybeSingle();
  if (found.data?.id) {
    subject_id = found.data.id as string;
  } else {
    const ins = await srv.from("subjects").insert({ name: label }).select("id").single();
    if (ins.error) {
      const reread = await srv.from("subjects").select("id").eq("subject_key", key).maybeSingle();
      subject_id = reread.data?.id ?? null;
    } else {
      subject_id = ins.data?.id ?? null;
    }
  }
  if (!subject_id) return NextResponse.json({ error: "subject introuvable/création échouée" }, { status: 400 });

  // 2) Ensure the institution <-> subject row exists (this is what class_teachers FK uses)
  const upInst = await srv
    .from("institution_subjects")
    .upsert({ institution_id, subject_id, is_active: true }, { onConflict: "institution_id,subject_id" })
    .select("id")
    .single();

  if (upInst.error) {
    return NextResponse.json({ error: upInst.error.message }, { status: 400 });
  }

  // 3) Link the teacher to the subject for THIS institution (idempotent)
  const upTeach = await srv
    .from("teacher_subjects")
    .upsert({ profile_id, institution_id, subject_id }, { onConflict: "profile_id,institution_id,subject_id" });

  if (upTeach.error) {
    return NextResponse.json({ error: upTeach.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, profile_id, subject_id, institution_subject_id: upInst.data.id });
}
