//src/app/api/admin/institution/bulletin-subject-structure/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | "teacher" | "parent" | string;

type ProfileRow = {
  id: string;
  role: Role | null;
  institution_id: string | null;
};

type GroupItemRow = {
  id: string;
  subject_id: string;
  subject_name: string;
};

type GroupRow = {
  id: string;
  level: string;
  label: string;
  order_index: number;
  is_active: boolean;
  items: GroupItemRow[];
};

function error(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/* ───────────────────────── GET ───────────────────────── */

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) return error("unauthorized", 401);

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return error(meErr.message, 400);
  if (!me?.institution_id) return error("Profil incomplet (institution manquante).", 400);

  // On autorise seulement super_admin / admin pour ces paramètres
  const role = (me.role || "") as Role;
  if (role !== "super_admin" && role !== "admin") {
    return error("forbidden", 403);
  }

  const url = new URL(req.url);
  const level = (url.searchParams.get("level") || "").trim();
  if (!level) {
    return error("Paramètre 'level' manquant.", 400);
  }

  // On récupère les groupes + items + noms de matières via des jointures
  const { data, error: groupsErr } = await srv
    .from("bulletin_subject_groups")
    .select(
      `
      id,
      level,
      label,
      order_index,
      is_active,
      items:bulletin_subject_group_items (
        id,
        subject_id,
        subject:subjects ( name )
      )
    `
    )
    .eq("institution_id", me.institution_id)
    .eq("level", level)
    .order("order_index", { ascending: true });

  if (groupsErr) return error(groupsErr.message, 400);

  const groups: GroupRow[] = (data || []).map((g: any, idx: number) => ({
    id: String(g.id),
    level: String(g.level || level),
    label: String(g.label || ""),
    order_index: Number(g.order_index ?? idx + 1),
    is_active: g.is_active !== false,
    items: Array.isArray(g.items)
      ? g.items.map((it: any) => ({
          id: String(it.id),
          subject_id: String(it.subject_id),
          subject_name:
            (it.subject?.name && String(it.subject.name)) || "Matière",
        }))
      : [],
  }));

  return NextResponse.json({
    ok: true,
    level,
    groups,
  });
}

/* ───────────────────────── PUT ───────────────────────── */

type PutBody = {
  level: string;
  groups: {
    label?: string;
    order_index?: number;
    is_active?: boolean;
    items?: { subject_id: string }[];
  }[];
};

export async function PUT(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) return error("unauthorized", 401);

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (meErr) return error(meErr.message, 400);
  if (!me?.institution_id) return error("Profil incomplet (institution manquante).", 400);

  const role = (me.role || "") as Role;
  if (role !== "super_admin" && role !== "admin") {
    return error("forbidden", 403);
  }

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return error("Corps JSON invalide.", 400);
  }

  const level = (body.level || "").trim();
  if (!level) return error("Champ 'level' obligatoire.", 400);

  const groupsIn = Array.isArray(body.groups) ? body.groups : [];
  if (groupsIn.length === 0) {
    // On autorise le fait de vider toute la structure
    const { error: delErr } = await srv
      .from("bulletin_subject_groups")
      .delete()
      .eq("institution_id", me.institution_id)
      .eq("level", level);

    if (delErr) return error(delErr.message, 400);
    return NextResponse.json({ ok: true, level, groups_count: 0, items_count: 0 });
  }

  // Normalisation des groupes côté serveur
  const normalized = groupsIn.map((g, idx) => ({
    label: (g.label || "").trim() || `Groupe ${idx + 1}`,
    order_index: idx + 1,
    is_active: g.is_active !== false,
    items: (Array.isArray(g.items) ? g.items : []).filter(
      (it) => it && typeof it.subject_id === "string" && it.subject_id.trim()
    ),
  }));

  // 1) On supprime d'abord tous les groupes de ce niveau pour l'institution (ON DELETE CASCADE sur les items)
  const { error: delErr } = await srv
    .from("bulletin_subject_groups")
    .delete()
    .eq("institution_id", me.institution_id)
    .eq("level", level);

  if (delErr) return error(delErr.message, 400);

  // 2) On insère les groupes
  const { data: insertedGroups, error: insGroupsErr } = await srv
    .from("bulletin_subject_groups")
    .insert(
      normalized.map((g) => ({
        institution_id: me.institution_id,
        level,
        label: g.label,
        order_index: g.order_index,
        is_active: g.is_active,
      }))
    )
    .select("id, order_index");

  if (insGroupsErr) return error(insGroupsErr.message, 400);

  const groupsByOrder: Record<number, string> = {};
  (insertedGroups || []).forEach((g: any) => {
    groupsByOrder[Number(g.order_index)] = String(g.id);
  });

  // 3) On insère les items
  const itemsToInsert: { group_id: string; subject_id: string }[] = [];
  normalized.forEach((g, idx) => {
    const orderIndex = idx + 1;
    const groupId = groupsByOrder[orderIndex];
    if (!groupId) return;

    g.items.forEach((it) => {
      const sid = (it.subject_id || "").trim();
      if (!sid) return;
      itemsToInsert.push({ group_id: groupId, subject_id: sid });
    });
  });

  let itemsCount = 0;
  if (itemsToInsert.length > 0) {
    const { error: insItemsErr, data: insItems } = await srv
      .from("bulletin_subject_group_items")
      .insert(itemsToInsert)
      .select("id");

    if (insItemsErr) return error(insItemsErr.message, 400);
    itemsCount = (insItems || []).length;
  }

  return NextResponse.json({
    ok: true,
    level,
    groups_count: normalized.length,
    items_count: itemsCount,
  });
}
