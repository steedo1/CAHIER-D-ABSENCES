//src/app/api/teacher/sessions/start/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type Body = {
  class_id: string;
  subject_id?: string | null;
  started_at?: string;            // ISO (UTC) optionnel, sinon maintenant
  expected_minutes?: number | null; // âš ï¸ désormais OBLIGATOIRE (> 0)
};

export async function POST(req: Request) {
  try {
    const supa = await getSupabaseServerClient();   // client (RLS)
    const srv  = getSupabaseServiceClient();        // service (pas de RLS)

    // 1) Auth
    const { data: { user } } = await supa.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 2) Lecture + normalisation du payload
    const b = (await req.json().catch(() => ({}))) as Body;

    const class_id = String(b?.class_id ?? "").trim();
    const subject_id =
      (b?.subject_id && String(b.subject_id).trim()) ? String(b.subject_id).trim() : null;

    if (!class_id) {
      return NextResponse.json({ error: "class_id_required" }, { status: 400 });
    }

    // Heure de début (par défaut: maintenant)
    const startedAt = b?.started_at ? new Date(b.started_at) : new Date();

    // âš ï¸ Durée attendue OBLIGATOIRE (> 0)
    const expected_raw = b?.expected_minutes;
    const expected_minutes = Number.isFinite(expected_raw) ? Math.floor(Number(expected_raw)) : NaN;
    if (!expected_minutes || expected_minutes <= 0) {
      return NextResponse.json({ error: "expected_minutes_required" }, { status: 400 });
    }

    // 3) Récupérer l'établissement du prof
    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

    const institution_id = (me?.institution_id as string) || null;
    if (!institution_id) {
      return NextResponse.json({ error: "no_institution" }, { status: 400 });
    }

    // 4) Vérifier que la classe appartient bien Ã  cet établissement
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,institution_id,label")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
    if (!cls || cls.institution_id !== institution_id) {
      return NextResponse.json({ error: "invalid_class" }, { status: 400 });
    }

    // 5) Insertion de la séance
    const payload = {
      institution_id,
      teacher_id: user.id,
      class_id,
      subject_id,                              // nullable
      started_at: startedAt.toISOString(),
      expected_minutes,                        // âœ… obligatoire
      status: "open" as const,
      created_by: user.id,
    };

    const { data: inserted, error: insErr } = await srv
      .from("teacher_sessions")
      .insert(payload)
      .select("id,class_id,subject_id,started_at,expected_minutes")
      .maybeSingle();

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    return NextResponse.json({ item: inserted });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "start_failed" }, { status: 400 });
  }
}


