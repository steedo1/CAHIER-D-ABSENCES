// src/app/api/teacher/sessions/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  class_id?: string;
  subject_id?: string | null; // côté front = subjects.id (canonique) ou anciennement institution_subjects.id
  started_at?: string;
  expected_minutes?: number | null;
};

async function getAuthUser() {
  const supa = await getSupabaseServerClient();
  const { data, error } = await supa.auth.getUser();
  if (error || !data?.user) {
    return { user: null, error: "Non authentifié" as string | null };
  }
  return { user: data.user, error: null as string | null };
}

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await getAuthUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;

    const class_id = body.class_id ?? null;
    const raw_subject_id = body.subject_id ?? null;
    const started_at = body.started_at ?? null;
    const expected_minutes = body.expected_minutes ?? null;

    if (!class_id || !raw_subject_id || !started_at) {
      return NextResponse.json(
        { error: "Paramètres manquants (classe / matière / horaire)." },
        { status: 400 }
      );
    }

    const svc = getSupabaseServiceClient();

    /* 1) Récupérer la classe pour avoir institution_id + label */
    const { data: cls, error: clsErr } = await svc
      .from("classes")
      .select("id, label, institution_id")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr || !cls) {
      return NextResponse.json(
        { error: "Classe introuvable pour démarrer la séance." },
        { status: 400 }
      );
    }

    /* 2) Résoudre subject_id → institution_subjects.id (instSubjectId) */

    let instSubjectId: string | null = null;

    // 2.a) D’abord, on regarde si raw_subject_id est déjà un institution_subjects.id
    const { data: asInst, error: asInstErr } = await svc
      .from("institution_subjects")
      .select("id")
      .eq("id", raw_subject_id)
      .maybeSingle();

    if (asInst && !asInstErr) {
      instSubjectId = asInst.id;
    } else {
      // 2.b) Sinon, on interprète raw_subject_id comme un subjects.id canonique
      const { data: viaCanonical, error: viaCanonicalErr } = await svc
        .from("institution_subjects")
        .select("id")
        .eq("institution_id", cls.institution_id)
        .eq("subject_id", raw_subject_id)
        .eq("is_active", true)
        .maybeSingle();

      if (viaCanonical && !viaCanonicalErr) {
        instSubjectId = viaCanonical.id;
      }
    }

    if (!instSubjectId) {
      return NextResponse.json(
        {
          error:
            "La matière sélectionnée n’est pas correctement affectée à cet établissement. " +
            "Vérifiez les disciplines dans les paramètres de l’établissement.",
        },
        { status: 400 }
      );
    }

    /* 3) Insérer la séance dans teacher_sessions
          → institution_id + created_by obligatoires */
    const { data: session, error: insErr } = await svc
      .from("teacher_sessions")
      .insert({
        institution_id: cls.institution_id, // ✅ NOT NULL
        class_id,
        subject_id: instSubjectId, // ✅ FK vers institution_subjects.id
        teacher_id: user.id,
        created_by: user.id,       // ✅ NOT NULL (nouveau)
        started_at,
        expected_minutes,
      })
      .select(
        `
        id,
        class_id,
        subject_id,
        started_at,
        expected_minutes,
        classes!inner (
          label
        ),
        institution_subjects!teacher_sessions_subject_id_fkey (
          id,
          subject:subjects (
            id,
            name
          )
        )
      `
      )
      .maybeSingle();

    if (insErr || !session) {
      const pgCode = (insErr as any)?.code;
      const msg = (insErr as any)?.message || "";

      if (
        pgCode === "23503" &&
        msg.includes("teacher_sessions_subject_id_fkey")
      ) {
        return NextResponse.json(
          {
            error:
              "Impossible de démarrer la séance : la matière n’est pas liée aux disciplines de l’établissement.",
          },
          { status: 400 }
        );
      }

      console.error("[teacher/sessions/start] insert error", insErr);
      return NextResponse.json(
        { error: "Échec du démarrage de la séance." },
        { status: 500 }
      );
    }

    /* 4) Normalisation de la réponse pour le front (OpenSession) */

    const item = {
      id: session.id as string,
      class_id: session.class_id as string,
      class_label:
        (session.classes && (session.classes as any).label) || cls.label || "",
      // On renvoie côté front le subject_id CANONIQUE si on le connaît,
      // sinon on renvoie ce qui était dans le body (fall-back).
      subject_id:
        (session.institution_subjects &&
          (session.institution_subjects as any).subject?.id) ||
        raw_subject_id,
      subject_name:
        (session.institution_subjects &&
          (session.institution_subjects as any).subject?.name) || null,
      started_at: session.started_at as string,
      expected_minutes: session.expected_minutes as number | null,
    };

    return NextResponse.json({ item }, { status: 200 });
  } catch (e: any) {
    console.error("[teacher/sessions/start] fatal error", e);
    return NextResponse.json(
      { error: "Erreur inattendue lors du démarrage de la séance." },
      { status: 500 }
    );
  }
}
