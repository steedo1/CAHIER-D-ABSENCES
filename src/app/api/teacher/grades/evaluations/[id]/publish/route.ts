// src/app/api/teacher/grades/evaluations/[id]/publish/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

/**
 * PATCH /api/teacher/grades/evaluations/:id/publish
 * Body JSON:
 *  { "is_published": true }  // défaut: true
 *
 * Note: le passage de false->true déclenche le trigger SQL
 * qui remplit published_at et met en file les notifications parents.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await getSupabaseServerClient();

    // Auth
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return bad("UNAUTHENTICATED", 401);

    const id = String(params?.id || "").trim();
    if (!id) return bad("MISSING_ID");

    const body = (await req.json().catch(() => ({}))) as { is_published?: boolean };
    const is_published = body.is_published === undefined ? true : Boolean(body.is_published);

    // Vérifier accès/présence de l'évaluation (RLS)
    const { data: row, error: qErr } = await supabase
      .from("grade_evaluations")
      .select("id, is_published")
      .eq("id", id)
      .single();

    if (qErr) {
      // PGRST116 = row not found
      // 404 si non trouvée, 403 si RLS bloque
      return bad(
        qErr.message || "EVALUATION_NOT_FOUND_OR_FORBIDDEN",
        (qErr as any).code === "PGRST116" ? 404 : 403
      );
    }

    // Update (idempotent)
    const { data: upd, error: uErr } = await supabase
      .from("grade_evaluations")
      .update({ is_published }) // published_at géré par trigger côté DB (false->true)
      .eq("id", id)
      .select("*")
      .single();

    if (uErr) return bad(uErr.message || "UPDATE_FAILED", 400);

    return NextResponse.json({ ok: true, item: upd });
  } catch (e: any) {
    return bad(e?.message || "INTERNAL_ERROR", 500);
  }
}
