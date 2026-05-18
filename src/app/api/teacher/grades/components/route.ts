// src/app/api/teacher/grades/components/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubjectComponentRow = {
  id: string;
  subject_id: string | null;
  code: string | null;
  label: string;
  short_label: string | null;
  level: string | null;
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

function normalizeLevelKey(value: unknown): string | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_\-.]/g, "");

  if (!raw) return null;

  if (["6", "6e", "6eme", "sixieme"].includes(raw)) return "6e";
  if (["5", "5e", "5eme", "cinquieme"].includes(raw)) return "5e";
  if (["4", "4e", "4eme", "quatrieme"].includes(raw)) return "4e";
  if (["3", "3e", "3eme", "troisieme"].includes(raw)) return "3e";

  return raw;
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

    const { data: cls, error: classError } = await supaService
      .from("classes")
      .select("id, institution_id, level, official_track_code")
      .eq("id", classId)
      .eq("institution_id", institutionId)
      .maybeSingle();

    if (classError) {
      console.error("[TeacherGradesComponents] GET -> erreur classe", {
        classId,
        institutionId,
        classError,
      });
      return NextResponse.json(
        { error: "Erreur lors de la vérification de la classe." },
        { status: 500 }
      );
    }

    if (!cls) {
      return NextResponse.json(
        { error: "Classe introuvable pour cet établissement." },
        { status: 403 }
      );
    }

    const classLevel = String((cls as any).level ?? "").trim();
    const normalizedClassLevel = normalizeLevelKey(classLevel);

    const globalSubjectId = await resolveSubjectIdToGlobal(
      supaService,
      institutionId,
      rawSubjectId
    );

    console.log("[TeacherGradesComponents] GET -> paramètres résolus", {
      classId,
      classLevel,
      normalizedClassLevel,
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
        "id, subject_id, code, label, short_label, level, coeff_in_subject, order_index, is_active"
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
      code: row.code ? String(row.code) : null,
      label: String(row.label || ""),
      short_label: row.short_label ? String(row.short_label) : null,
      level: row.level ? String(row.level) : null,
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

    const activeRows = rows.filter((row) => row.is_active ?? true);
    const exactLevelRows = normalizedClassLevel
      ? activeRows.filter(
          (row) => normalizeLevelKey(row.level) === normalizedClassLevel
        )
      : [];

    // Règle métier : pour une classe de collège, on privilégie STRICTEMENT
    // les sous-rubriques du niveau réel de la classe. Les anciennes lignes
    // sans niveau ne servent que de fallback si aucun référentiel niveau n'existe.
    const filteredRows =
      exactLevelRows.length > 0
        ? exactLevelRows
        : activeRows.filter((row) => !normalizeLevelKey(row.level));

    const seen = new Set<string>();
    const components = filteredRows
      .filter((row) => {
        const key = `${row.code || ""}::${row.label}::${row.level || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((row) => ({
        id: row.id,
        subject_id: row.subject_id,
        code: row.code,
        label: row.label,
        short_label: row.short_label,
        level: row.level,
        coeff_in_subject: row.coeff_in_subject ?? 1,
        order_index: row.order_index,
      }));

    console.log(
      "[TeacherGradesComponents] GET -> sous-matières filtrées par niveau",
      {
        classId,
        classLevel,
        normalizedClassLevel,
        totalRows: rows.length,
        activeRows: activeRows.length,
        exactLevelRows: exactLevelRows.length,
        returnedRows: components.length,
        components,
      }
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
