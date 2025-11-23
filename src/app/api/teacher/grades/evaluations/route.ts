// src/app/api/teacher/grades/evaluations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── Helpers auth ───────────────── */

async function getCurrentUser() {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return { user: null, error: "Non authentifié" };
  }
  return { user: data.user, error: null as string | null };
}

/**
 * Renvoie le "mode" d'accès de l'utilisateur pour une classe :
 * - "admin"        : admin/super_admin de l'établissement
 * - "teacher"      : enseignant affecté à cette classe
 * - "class_device" : téléphone associé à cette classe
 * - null           : aucun droit
 */
async function getAccessModeForClass(
  svc: SupabaseClient,
  userId: string,
  classId: string
): Promise<"admin" | "teacher" | "class_device" | null> {
  // Profil (institution + téléphone)
  const { data: profile, error: pErr } = await svc
    .from("profiles")
    .select("id,institution_id,phone")
    .eq("id", userId)
    .maybeSingle();

  if (pErr || !profile?.institution_id) return null;

  // Classe (pour vérifier l'établissement + les téléphones associés)
  const { data: cls, error: cErr } = await svc
    .from("classes")
    .select("id,institution_id,class_phone_e164,device_phone_e164")
    .eq("id", classId)
    .maybeSingle();

  if (cErr || !cls) return null;

  // Rôles de l'utilisateur dans cet établissement
  const { data: roles, error: rErr } = await svc
    .from("user_roles")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("institution_id", profile.institution_id);

  if (rErr) {
    console.error("[grades/evaluations] roles error", rErr);
  }

  const roleSet = new Set<string>((roles ?? []).map((r: any) => r.role as string));

  // 1) Admins (super_admin / admin)
  if (roleSet.has("super_admin") || roleSet.has("admin")) {
    return "admin";
  }

  // 2) Prof affecté à la classe
  if (roleSet.has("teacher")) {
    const { data: ct } = await svc
      .from("class_teachers")
      .select("id")
      .eq("class_id", classId)
      .eq("teacher_id", profile.id)
      .eq("institution_id", profile.institution_id)
      .is("end_date", null)
      .maybeSingle();

    if (ct) return "teacher";
  }

  // 3) Compte classe (téléphone associé à la classe)
  if (roleSet.has("class_device")) {
    const phone = profile.phone;
    if (
      phone &&
      (phone === cls.class_phone_e164 || phone === cls.device_phone_e164)
    ) {
      return "class_device";
    }
  }

  return null;
}

// Vérifie que le subject_id existe vraiment dans subjects, sinon retourne null
async function getValidSubjectId(
  svc: SupabaseClient,
  subject_id: string | null
): Promise<string | null> {
  if (!subject_id) return null;
  const trimmed = subject_id.trim();
  if (!trimmed) return null;

  const { data } = await svc
    .from("subjects")
    .select("id")
    .eq("id", trimmed)
    .maybeSingle();

  return data ? (data.id as string) : null;
}

/**
 * Pour la création d'une évaluation :
 * - admin / teacher → on met teacher_id = user.id
 * - class_device    → on va chercher le vrai prof de la classe/matière
 *                     dans class_teachers, sinon fallback user.id
 */
async function resolveTeacherIdForInsert(
  svc: SupabaseClient,
  mode: "admin" | "teacher" | "class_device",
  userId: string,
  classId: string,
  safeSubjectId: string | null
): Promise<string> {
  if (mode === "admin" || mode === "teacher") {
    return userId;
  }

  // mode = class_device → chercher le prof affecté
  let q = svc
    .from("class_teachers")
    .select("teacher_id")
    .eq("class_id", classId)
    .is("end_date", null)
    .limit(1);

  if (safeSubjectId) {
    q = q.eq("subject_id", safeSubjectId);
  }

  const { data: ct } = await q.maybeSingle();
  const teacherId = (ct as any)?.teacher_id as string | undefined;
  return teacherId || userId;
}

/* ========== GET: liste des évaluations pour une classe/matière ========== */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const class_id = url.searchParams.get("class_id");
  const subject_idParam = url.searchParams.get("subject_id");
  const subject_id =
    subject_idParam && subject_idParam.trim() !== "" ? subject_idParam : null;

  if (!class_id) {
    return NextResponse.json(
      { ok: false, error: "class_id manquant" },
      { status: 400 }
    );
  }

  const { user, error: authErr } = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: authErr }, { status: 401 });
  }

  const svc = getSupabaseServiceClient();
  const mode = await getAccessModeForClass(svc, user.id, class_id);

  if (!mode) {
    return NextResponse.json(
      { ok: false, error: "Accès refusé à cette classe" },
      { status: 403 }
    );
  }
  const isAdmin = mode === "admin";

  // On ne filtre par subject_id que s'il est VALIDE dans subjects
  const safeSubjectId = await getValidSubjectId(svc, subject_id);

  let query = svc
    .from("grade_evaluations")
    .select(
      "id, class_id, subject_id, subject_component_id, teacher_id, eval_date, eval_kind, scale, coeff, is_published, published_at"
    )
    .eq("class_id", class_id);

  if (safeSubjectId) {
    query = query.eq("subject_id", safeSubjectId);
  }

  // ⚠️ On NE filtre plus sur teacher_id :
  // - un prof autorisé à cette classe voit toutes les évaluations de la matière
  // - le compte classe aussi
  // - l'admin voit tout (via isAdmin si on veut étendre plus tard)

  const { data, error } = await query
    .order("eval_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("GET /teacher/grades/evaluations error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, items: data ?? [] });
}

/* ========== POST: création d’une nouvelle évaluation (NOTE) ========== */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "JSON invalide" },
      { status: 400 }
    );
  }

  const {
    class_id,
    subject_id: rawSubjectId,
    eval_date,
    eval_kind,
    scale,
    coeff,
    subject_component_id: rawSubjectComponentId,
  } = body;

  if (!class_id || !eval_date || !eval_kind || !scale) {
    return NextResponse.json(
      { ok: false, error: "Champs obligatoires manquants" },
      { status: 400 }
    );
  }

  const { user, error: authErr } = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: authErr }, { status: 401 });
  }

  const svc = getSupabaseServiceClient();
  const mode = await getAccessModeForClass(svc, user.id, class_id);

  if (!mode) {
    return NextResponse.json(
      { ok: false, error: "Accès refusé à cette classe" },
      { status: 403 }
    );
  }

  // ⚠️ Sujet sécurisé : seulement si l’ID existe dans subjects, sinon NULL
  const safeSubjectId = await getValidSubjectId(
    svc,
    rawSubjectId && typeof rawSubjectId === "string" ? rawSubjectId : null
  );

  // subject_component_id : optionnel, on accepte une string vide -> null
  const safeSubjectComponentId =
    rawSubjectComponentId && typeof rawSubjectComponentId === "string"
      ? rawSubjectComponentId.trim() || null
      : null;

  // Déterminer le teacher_id à stocker
  const teacherId = await resolveTeacherIdForInsert(
    svc,
    mode,
    user.id,
    class_id,
    safeSubjectId
  );

  const { data, error } = await svc
    .from("grade_evaluations")
    .insert({
      class_id,
      subject_id: safeSubjectId, // ✅ ne casse jamais la FK
      subject_component_id: safeSubjectComponentId, // ✅ nouveau champ (peut être null)
      teacher_id: teacherId,
      eval_date,
      eval_kind,
      scale,
      coeff: coeff ?? 1,
    })
    .select(
      "id, class_id, subject_id, subject_component_id, teacher_id, eval_date, eval_kind, scale, coeff, is_published, published_at"
    )
    .single();

  if (error) {
    console.error("POST /teacher/grades/evaluations error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, item: data });
}

/* ========== PATCH: publier / dépublier une évaluation ========== */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !body.evaluation_id || typeof body.is_published !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "evaluation_id ou is_published manquant" },
      { status: 400 }
    );
  }

  const { evaluation_id, is_published } = body;

  const { user, error: authErr } = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: authErr }, { status: 401 });
  }

  const svc = getSupabaseServiceClient();

  // On récupère l’évaluation pour vérifier la classe
  const { data: ev, error: evErr } = await svc
    .from("grade_evaluations")
    .select("id, class_id")
    .eq("id", evaluation_id)
    .maybeSingle();

  if (evErr || !ev) {
    console.error("PATCH /teacher/grades/evaluations read error:", evErr);
    return NextResponse.json(
      { ok: false, error: "Évaluation introuvable" },
      { status: 404 }
    );
  }

  // Vérifier que l'utilisateur a le droit sur CETTE classe
  const mode = await getAccessModeForClass(svc, user.id, ev.class_id);
  if (!mode) {
    return NextResponse.json(
      { ok: false, error: "Accès refusé à cette évaluation" },
      { status: 403 }
    );
  }

  const { data, error } = await svc
    .from("grade_evaluations")
    .update({
      is_published,
      published_at: is_published ? new Date().toISOString() : null,
    })
    .eq("id", evaluation_id)
    .select(
      "id, class_id, subject_id, subject_component_id, teacher_id, eval_date, eval_kind, scale, coeff, is_published, published_at"
    )
    .single();

  if (error) {
    console.error("PATCH /teacher/grades/evaluations update error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, item: data });
}

/* ========== DELETE: supprimer une évaluation (colonne) ========== */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.evaluation_id) {
      return NextResponse.json(
        { ok: false, error: "evaluation_id manquant" },
        { status: 400 }
      );
    }

    const { evaluation_id } = body;

    const { user, error: authErr } = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: authErr }, { status: 401 });
    }

    const svc = getSupabaseServiceClient();

    // Récupérer l’évaluation pour vérifier la classe
    const { data: ev, error: evErr } = await svc
      .from("grade_evaluations")
      .select("id, class_id")
      .eq("id", evaluation_id)
      .maybeSingle();

    if (evErr || !ev) {
      console.error("DELETE /teacher/grades/evaluations read error:", evErr);
      return NextResponse.json(
        { ok: false, error: "Évaluation introuvable" },
        { status: 404 }
      );
    }

    // Vérifier que l'utilisateur a le droit sur CETTE classe
    const mode = await getAccessModeForClass(svc, user.id, ev.class_id);
    if (!mode) {
      return NextResponse.json(
        { ok: false, error: "Accès refusé à cette évaluation" },
        { status: 403 }
      );
    }

    // On NE TOUCHE PAS à student_grades ici : la FK fait ON DELETE CASCADE.
    const { error: evalErr } = await svc
      .from("grade_evaluations")
      .delete()
      .eq("id", evaluation_id)
      .single();

    if (evalErr) {
      console.error("DELETE /teacher/grades/evaluations eval error:", evalErr);
      return NextResponse.json(
        { ok: false, error: evalErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /teacher/grades/evaluations unexpected error:", err);
    return NextResponse.json(
      { ok: false, error: "Erreur serveur pendant la suppression." },
      { status: 500 }
    );
  }
}
