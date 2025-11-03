//src/app/api/class/sessions/open/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/class/sessions/open
 * Body: { class_id, subject_id?, teacher_id?, started_at (ISO), expected_minutes? }
 *
 * Règles:
 * - L'utilisateur Auth courant DOIT être le compte téléphone de la classe (auth.user.phone == classes.class_phone_e164)
 * - subject_id est requis (au moins un des deux: subject_id || teacher_id ; subject_id recommandé)
 * - si teacher_id n'est pas fourni, on tente de le déduire depuis class_teachers pour (class_id, subject_id)
 * - crée une "séance" équivalente à /api/teacher/sessions/start, avec un marqueur opened_from='class_device'
 */
export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient();    // RLS (user)
  const srv  = getSupabaseServiceClient();         // service (no RLS)

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 1) Déterminer la classe par le téléphone du compte
  const userPhone = (user.phone || "").trim();
  if (!userPhone) {
    return NextResponse.json({ error: "no_phone_for_user" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({} as any));
  const class_id = String(body?.class_id || "");
  const subject_id = (body?.subject_id ?? null) as string | null;
  const teacher_id_in = (body?.teacher_id ?? null) as string | null;
  const started_at = String(body?.started_at || "");
  const expected_minutes = typeof body?.expected_minutes === "number" ? body.expected_minutes : 60;

  if (!class_id) return NextResponse.json({ error: "class_id_required" }, { status: 400 });
  if (!subject_id) return NextResponse.json({ error: "subject_id_required" }, { status: 400 });
  if (!started_at) return NextResponse.json({ error: "started_at_required" }, { status: 400 });

  // Vérifier que le téléphone correspond bien à la classe
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id, institution_id, class_phone_e164, label")
    .eq("id", class_id)
    .maybeSingle();

  if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
  if (!cls)   return NextResponse.json({ error: "class_not_found" }, { status: 404 });
  if ((cls.class_phone_e164 || "").trim() !== userPhone) {
    return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });
  }

  // 2) Résoudre teacher_id si manquant
  let teacher_id = teacher_id_in;
  if (!teacher_id) {
    const { data: aff, error: affErr } = await srv
      .from("class_teachers")
      .select("teacher_id")
      .eq("class_id", class_id)
      .eq("subject_id", subject_id);

    if (affErr) return NextResponse.json({ error: affErr.message }, { status: 400 });
    const uniq = Array.from(new Set((aff || []).map((a) => a.teacher_id).filter(Boolean))) as string[];
    if (uniq.length === 1) teacher_id = uniq[0]!;
    else if (uniq.length === 0)
      return NextResponse.json({ error: "no_teacher_for_subject" }, { status: 400 });
    else
      return NextResponse.json({ error: "ambiguous_teacher_for_subject" }, { status: 400 });
  }

  // 3) Ouvrir la séance
  // ⚠️ Adapte les colonnes/nom de table ci-dessous à ton schéma réel (ex: teacher_sessions)
  const row = {
    class_id,
    subject_id,
    teacher_id,
    started_at,             // ISO réel choisi à l’écran
    expected_minutes,       // durée prévue
    opened_from: "class_device" as const,
  };

  // a) Insertion
  const { data: created, error: insErr } = await srv
    .from("teacher_sessions") // ⬅️ adapte si le nom diffère
    .insert(row)
    .select("id, class_id, subject_id, teacher_id, started_at, expected_minutes")
    .maybeSingle();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }
  if (!created) {
    return NextResponse.json({ error: "session_create_failed" }, { status: 400 });
  }

  // b) (Optionnel) initialiser l’horodatage “réel d’appel” au premier marquage plus tard.
  //    Si tu préfères le fixer immédiatement au démarrage, ajoute une colonne `actual_call_at: started_at`.

  // 4) Réponse
  return NextResponse.json({
    item: {
      id: created.id,
      class_id: created.class_id,
      subject_id: created.subject_id,
      teacher_id: created.teacher_id,
      started_at: created.started_at,
      expected_minutes: created.expected_minutes,
    },
  });
}





