import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { cleanText, cleanUuid, toPositiveInt } from "@/lib/textbook/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ITEM_TYPES = new Set([
  "section",
  "theme",
  "competency",
  "rubric",
  "chapter",
  "lesson",
  "sequence",
  "session",
  "evaluation",
  "remediation",
  "regulation",
  "revision",
  "other",
]);

async function guardSuperAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user?.id) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  }

  const { data: roles, error } = await srv
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id);

  if (error) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: error.message }, { status: 400 }) };
  }

  const isSuper = (roles || []).some((row: any) => String(row?.role) === "super_admin");
  if (!isSuper) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "super_admin_required" }, { status: 403 }) };
  }

  return { ok: true as const, srv, userId: user.id };
}

function normalizeItemType(value: unknown) {
  const s = cleanText(value, 40).toLowerCase();
  return ITEM_TYPES.has(s) ? s : "lesson";
}

function normalizeItem(raw: any, progressionId: string, index: number) {
  const title = cleanText(raw.title ?? raw.titre ?? raw.lesson ?? raw.lecon, 300);
  if (!title) return null;

  const itemType = normalizeItemType(raw.item_type ?? raw.type);
  const sortOrder = Number(raw.sort_order ?? raw.ordre ?? raw.order ?? index + 1);
  const indentLevel = Number(raw.indent_level ?? raw.niveau_retrait ?? 0);

  return {
    id: cleanUuid(raw.id) || crypto.randomUUID(),
    institution_id: null,
    progression_id: progressionId,
    parent_id: cleanUuid(raw.parent_id),
    item_type: itemType,
    title,
    description: cleanText(raw.description, 1500) || null,
    rubric: cleanText(raw.rubric ?? raw.rubrique, 160) || null,
    theme: cleanText(raw.theme, 220) || null,
    competency: cleanText(raw.competency ?? raw.competence, 220) || null,
    trimester: cleanText(raw.trimester ?? raw.trimestre, 60) || null,
    month_label: cleanText(raw.month_label ?? raw.mois, 80) || null,
    week_label: cleanText(raw.week_label ?? raw.semaine, 120) || null,
    planned_duration_minutes: toPositiveInt(
      raw.planned_duration_minutes ?? raw.duree_minutes ?? raw.duration_minutes,
      null,
    ),
    planned_sessions_count: toPositiveInt(
      raw.planned_sessions_count ?? raw.nombre_seances ?? raw.sessions_count,
      null,
    ),
    sort_order: Number.isFinite(sortOrder) ? sortOrder : index + 1,
    indent_level: Number.isFinite(indentLevel)
      ? Math.max(0, Math.min(6, Math.round(indentLevel)))
      : 0,
    metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
    is_customized: false,
  };
}

async function getNationalProgression(srv: ReturnType<typeof getSupabaseServiceClient>, id: string) {
  const { data, error } = await srv
    .from("textbook_progression_templates")
    .select("id,scope")
    .eq("id", id)
    .eq("scope", "national")
    .maybeSingle();

  return { data, error };
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await guardSuperAdmin();
  if (!auth.ok) return auth.response;
  const { srv } = auth;

  const { data: progression, error: progressionErr } = await getNationalProgression(srv, id);
  if (progressionErr) return NextResponse.json({ ok: false, error: progressionErr.message }, { status: 400 });
  if (!progression) return NextResponse.json({ ok: false, error: "national_progression_not_found" }, { status: 404 });

  const { data, error } = await srv
    .from("textbook_progression_items")
    .select("*")
    .eq("progression_id", id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, items: data || [] });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await guardSuperAdmin();
  if (!auth.ok) return auth.response;
  const { srv, userId } = auth;

  const body = await req.json().catch(() => ({}));
  const replace = Boolean(body.replace);
  const sourceItems = Array.isArray(body.items) ? body.items : [];

  if (!sourceItems.length) return NextResponse.json({ ok: false, error: "items_required" }, { status: 400 });

  const { data: progression, error: progressionErr } = await getNationalProgression(srv, id);
  if (progressionErr) return NextResponse.json({ ok: false, error: progressionErr.message }, { status: 400 });
  if (!progression) return NextResponse.json({ ok: false, error: "national_progression_not_found" }, { status: 404 });

  const items = sourceItems
    .map((raw: any, index: number) => normalizeItem(raw, id, index))
    .filter(Boolean);

  if (!items.length) return NextResponse.json({ ok: false, error: "no_valid_item" }, { status: 400 });

  if (replace) {
    const { error: delErr } = await srv
      .from("textbook_progression_items")
      .delete()
      .eq("progression_id", id);

    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 400 });
  }

  const { data, error } = await srv.from("textbook_progression_items").insert(items).select("*");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  await srv
    .from("textbook_progression_templates")
    .update({ updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, items: data || [], inserted: (data || []).length }, { status: 201 });
}
