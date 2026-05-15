import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { generateDraftTimetableFromSnapshot } from "@/modules/montage-emploi-du-temps/engine/generateDraftTimetable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// La génération peut être lourde sur un établissement complet.
// On demande à Vercel de laisser respirer cette route quand le plan le permet,
// tout en gardant le moteur borné côté code pour éviter les réponses 504 HTML.
export const maxDuration = 60;

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ ok: false, error: "unauthorized", message: "Utilisateur non connecté." }, { status: 401 }) };
  const { data: me, error: meErr } = await supa.from("profiles").select("id,institution_id").eq("id", user.id).maybeSingle();
  if (meErr) return { ok: false as const, response: NextResponse.json({ ok: false, error: "profile_failed", message: meErr.message }, { status: 400 }) };
  const institutionId = me?.institution_id ? String(me.institution_id) : "";
  if (!institutionId) return { ok: false as const, response: NextResponse.json({ ok: false, error: "no_institution", message: "Aucune institution associée à ce compte." }, { status: 400 }) };
  const { data: roleRow, error: roleErr } = await supa.from("user_roles").select("role").eq("profile_id", user.id).eq("institution_id", institutionId).maybeSingle();
  if (roleErr) return { ok: false as const, response: NextResponse.json({ ok: false, error: "role_failed", message: roleErr.message }, { status: 400 }) };
  if (!["admin", "super_admin"].includes(String(roleRow?.role || ""))) return { ok: false as const, response: NextResponse.json({ ok: false, error: "forbidden", message: "Droits insuffisants." }, { status: 403 }) };
  return { ok: true as const, srv, userId: user.id, institutionId };
}


function getDiagnosticType(item: any): string {
  return String(item?.warning_type || item?.warningType || item?.type || item?.code || item?.kind || "unknown");
}

const STRICT_BLOCKING_WARNING_TYPES = new Set([
  "class_conflict",
  "teacher_conflict",
  "room_conflict",
  "assignment_class_conflict",
  "assignment_teacher_conflict",
  "school_closed_period",
  "break_cut_block",
  "room_requirement_mismatch",
  "eps_not_on_field",
  "eps_field_over_capacity",
  "unplaced_block",
  "student_gap",
  "single_hour_return",
  "same_subject_same_day",
  "same_subject_overlong_block",
]);

function isStrictBlockingDiagnostic(item: any): boolean {
  const level = String(item?.level || item?.severity || "").toLowerCase();
  const warningType = getDiagnosticType(item);
  return level === "critical" || level === "error" || STRICT_BLOCKING_WARNING_TYPES.has(warningType);
}

function getStrictBlockingCount(result: any): number {
  const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
  const unplaced = Array.isArray(result?.unplaced) ? result.unplaced : [];
  return diagnostics.filter(isStrictBlockingDiagnostic).length + unplaced.length;
}

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;
    const { id } = await context.params;
    const projectId = String(id || "").trim();
    if (!projectId) return NextResponse.json({ ok: false, error: "missing_project_id", message: "Identifiant manquant." }, { status: 400 });

    const { data: project, error: fetchError } = await guard.srv
      .from("montage_timetable_projects")
      .select("id,institution_id,name,status,source_snapshot,engine_input,engine_result,diagnostics,created_at,updated_at")
      .eq("id", projectId)
      .eq("institution_id", guard.institutionId)
      .maybeSingle();
    if (fetchError) return NextResponse.json({ ok: false, error: "project_fetch_failed", message: fetchError.message }, { status: 400 });
    if (!project) return NextResponse.json({ ok: false, error: "project_not_found", message: "Brouillon introuvable." }, { status: 404 });
    if (project.status === "published") return NextResponse.json({ ok: false, error: "project_already_published", message: "Ce brouillon est déjà publié." }, { status: 409 });

    const startedAt = Date.now();
    const result = generateDraftTimetableFromSnapshot(project.source_snapshot);
    const generationDurationMs = Date.now() - startedAt;
    const resultWithRuntime = {
      ...result,
      summary: {
        ...(result.summary || {}),
        generation_duration_ms: generationDurationMs,
      },
    };
    // La génération ne publie jamais automatiquement.
    // Elle produit seulement un brouillon : "ready" si l'audit strict est propre,
    // sinon "draft" afin que l'admin corrige avant publication manuelle.
    const strictBlockingCount = getStrictBlockingCount(resultWithRuntime);
    const nextStatus = strictBlockingCount === 0 && resultWithRuntime.status === "generated_real_scheduler" ? "ready" : "draft";
    const { data: updated, error: updateError } = await guard.srv
      .from("montage_timetable_projects")
      .update({ status: nextStatus, published_at: null, engine_result: resultWithRuntime, diagnostics: resultWithRuntime.diagnostics || [] })
      .eq("id", projectId)
      .eq("institution_id", guard.institutionId)
      .select("id,institution_id,name,status,source_snapshot,engine_input,engine_result,diagnostics,created_at,updated_at")
      .single();
    if (updateError) return NextResponse.json({ ok: false, error: "project_update_failed", message: updateError.message }, { status: 400 });
    return NextResponse.json({
      ok: true,
      item: updated,
      result: resultWithRuntime,
      message:
        nextStatus === "ready"
          ? "Génération HoraClasse terminée : brouillon prêt. L’admin doit encore vérifier puis publier manuellement."
          : `Génération terminée : brouillon à revoir (${strictBlockingCount} anomalie(s) bloquante(s)). La publication reste bloquée jusqu’à correction.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur serveur pendant la génération.";
    const stack = process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      { ok: false, error: "server_error", message, stack },
      { status: 500 },
    );
  }
}
