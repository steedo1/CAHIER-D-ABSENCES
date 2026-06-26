import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | string;

async function getAdminContext() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) return { error: "unauthorized" as const, status: 401 as const };

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return { error: meErr.message, status: 400 as const };

  const institution_id = (me?.institution_id as string) || null;
  if (!institution_id) return { error: "no_institution", status: 400 as const };

  const { data: roleRow } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  const role = ((roleRow?.role as Role | undefined) || "") as Role;
  if (!["admin", "super_admin", "educator"].includes(role)) {
    return { error: "forbidden", status: 403 as const };
  }

  return { srv, user, institution_id, role };
}

function normalizeLimit(value: string | null) {
  const n = Number(value || 12);
  if (!Number.isFinite(n)) return 12;
  return Math.max(1, Math.min(30, Math.trunc(n)));
}

function makePreview(answer: any, question: string) {
  const text = String(answer?.council_note || answer?.summary || question || "").replace(/\s+/g, " ").trim();
  return text.length > 220 ? `${text.slice(0, 220)}…` : text;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAdminContext();
    if ("error" in ctx) {
      return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
    }

    const url = new URL(req.url);
    const academicYear = String(url.searchParams.get("academic_year") || "").trim();
    const onlyNotes = url.searchParams.get("notes") !== "0";
    const limit = normalizeLimit(url.searchParams.get("limit"));

    if (!academicYear) {
      return NextResponse.json(
        { ok: false, error: "academic_year_required", message: "L’année scolaire est obligatoire." },
        { status: 400 },
      );
    }

    const dbLimit = onlyNotes ? Math.min(80, Math.max(limit * 4, limit)) : limit;

    const { data, error } = await ctx.srv
      .from("ai_assistant_interactions")
      .select("id,academic_year,question,intent,model_version,model_source,confidence,answer_json,context_summary_json,created_at")
      .eq("institution_id", ctx.institution_id)
      .eq("academic_year", academicYear)
      .order("created_at", { ascending: false })
      .limit(dbLimit);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    const sourceRows = onlyNotes
      ? (data || []).filter((row: any) => Boolean(row?.answer_json?.council_note)).slice(0, limit)
      : (data || []).slice(0, limit);

    const items = sourceRows.map((row: any) => {
      const answer = row.answer_json || {};
      const summary = row.context_summary_json || {};
      return {
        id: row.id,
        academic_year: row.academic_year,
        question: row.question,
        intent: row.intent,
        title: answer.title || "Analyse Mon Cahier IA",
        preview: makePreview(answer, row.question),
        scope_label: answer.quick_stats?.scope_label || answer.title || "Périmètre non précisé",
        has_council_note: Boolean(answer.council_note),
        confidence: row.confidence ?? answer.confidence ?? null,
        model_version: row.model_version,
        model_source: row.model_source,
        created_at: row.created_at,
        answer,
        context_meta: {
          classes_count: summary.classes_count || 0,
          students_count: summary.students_count || 0,
          subjects_count: summary.subjects_count || 0,
          warnings: summary.warnings || [],
          data_quality: summary.data_quality || null,
        },
      };
    });

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "history_failed", message: e?.message || "Historique indisponible." },
      { status: 500 },
    );
  }
}
