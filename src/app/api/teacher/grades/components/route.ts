// src/app/api/teacher/grades/components/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubjectComponentRow = {
  id: string;
  subject_id: string | null;
  label: string;
  short_label: string | null;
  coeff_in_subject: number | null;
  order_index: number | null;
  is_active: boolean | null;
};

type Context = {
  profileId: string;
  institutionId: string;
};

/* ───────────────────────────────
   Contexte user / établissement
─────────────────────────────── */
async function getContext(): Promise<Context> {
  const supa = await getSupabaseServerClient();

  const { data: authData, error: authError } = await supa.auth.getUser();
  if (authError || !authData?.user) {
    console.error(
      "[TeacherGradesComponents] getContext -> auth error",
      authError
    );
    throw new Error("Non authentifié.");
  }
  const userId = authData.user.id;

  const { data: profile, error: profileError } = await supa
    .from("profiles")
    .select("id, institution_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile) {
    console.error(
      "[TeacherGradesComponents] getContext -> profil introuvable",
      profileError
    );
    throw new Error("Profil introuvable.");
  }

  if (!profile.institution_id) {
    console.error(
      "[TeacherGradesComponents] getContext -> institution manquante pour le profil",
      profile
    );
    throw new Error("Aucun établissement rattaché au profil.");
  }

  const ctx: Context = {
    profileId: profile.id,
    institutionId: profile.institution_id as string,
  };

  console.log("[TeacherGradesComponents] getContext -> OK", ctx);
  return ctx;
}

/* ───────────────────────────────
   Résolution subject_id → global
   (même principe que /grades/evaluations)
─────────────────────────────── */
async function resolveSubjectIdToGlobal(
  supa: any,
  institutionId: string,
  rawSubjectId: string
): Promise<string> {
  console.log("[TeacherGradesComponents] resolveSubjectIdToGlobal -> entrée", {
    institutionId,
    rawSubjectId,
  });

  const { data, error } = await supa
    .from("institution_subjects")
    .select("id, subject_id")
    .eq("id", rawSubjectId)
    .maybeSingle();

  if (error) {
    console.error(
      "[TeacherGradesComponents] resolveSubjectIdToGlobal -> erreur institution_subjects",
      error
    );
  }

  if (data?.subject_id) {
    const resolved = data.subject_id as string;
    console.log(
      "[TeacherGradesComponents] resolveSubjectIdToGlobal -> via institution_subjects",
      { institutionId, rawSubjectId, resolved }
    );
    return resolved;
  }

  console.log(
    "[TeacherGradesComponents] resolveSubjectIdToGlobal -> aucune correspondance, on garde rawSubjectId tel quel",
    { institutionId, rawSubjectId }
  );
  return rawSubjectId;
}

/* ───────────────────────────────
   GET /api/teacher/grades/components
─────────────────────────────── */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("class_id");
    const rawSubjectId = searchParams.get("subject_id");

    if (!classId || !rawSubjectId) {
      return NextResponse.json(
        { error: "class_id et subject_id sont requis." },
        { status: 400 }
      );
    }

    const { institutionId } = await getContext();
    const supaService = await getSupabaseServiceClient();

    const globalSubjectId = await resolveSubjectIdToGlobal(
      supaService,
      institutionId,
      rawSubjectId
    );

    console.log("[TeacherGradesComponents] GET -> paramètres résolus", {
      classId,
      rawSubjectId,
      globalSubjectId,
      institutionId,
    });

    const subjectIds =
      globalSubjectId === rawSubjectId
        ? [globalSubjectId]
        : [globalSubjectId, rawSubjectId];

    const { data, error } = await supaService
      .from("grade_subject_components")
      .select(
        "id, subject_id, label, short_label, coeff_in_subject, order_index, is_active"
      )
      .in("subject_id", subjectIds)
      .eq("institution_id", institutionId)
      .order("order_index", { ascending: true });

    if (error) {
      console.error(
        "[TeacherGradesComponents] GET -> erreur Supabase grade_subject_components",
        error
      );
      return NextResponse.json(
        { error: "Erreur lors du chargement des sous-matières." },
        { status: 500 }
      );
    }

    const rows: SubjectComponentRow[] = (data || []).map((row: any) => ({
      id: String(row.id),
      subject_id: row.subject_id ? String(row.subject_id) : null,
      label: String(row.label || ""),
      short_label: row.short_label ? String(row.short_label) : null,
      coeff_in_subject:
        row.coeff_in_subject == null
          ? 1
          : Number.isFinite(Number(row.coeff_in_subject))
          ? Number(row.coeff_in_subject)
          : 1,
      order_index:
        row.order_index == null ? null : Number(row.order_index),
      is_active:
        typeof row.is_active === "boolean" ? row.is_active : true,
    }));

    const components = rows
      .filter((row) => row.is_active ?? true)
      .map((row) => ({
        id: row.id,
        subject_id: row.subject_id,
        label: row.label,
        short_label: row.short_label,
        coeff_in_subject: row.coeff_in_subject ?? 1,
        order_index: row.order_index,
      }));

    console.log(
      "[TeacherGradesComponents] GET -> sous-matières trouvées",
      components
    );

    return NextResponse.json({ items: components, components });
  } catch (err: any) {
    console.error("[TeacherGradesComponents] GET -> exception", err);
    return NextResponse.json(
      { error: err?.message ?? "Erreur interne." },
      { status: 500 }
    );
  }
}
