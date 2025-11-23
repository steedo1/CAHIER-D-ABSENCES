// src/app/api/admin/institution/bulletin-subject-groups/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | "teacher" | "parent" | string;

type GuardOk = {
  user: { id: string };
  instId: string;
};
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

// Types de retour
type GroupRow = {
  id: string;
  level: string;
  code: string;
  label: string;
  short_label: string | null;
  order_index: number;
  is_active: boolean;
  annual_coeff: number;
};

type ItemRow = {
  id: string;
  group_id: string;
  institution_subject_id: string;
  subject_id: string;
  subject_name: string;
  level: string;
  order_index: number;
  subject_coeff_override: number | null;
  is_optional: boolean;
};

// ============================
// Helper d’authentification admin
// ============================
async function guard(
  supa: SupabaseClient,
  srv: SupabaseClient
): Promise<GuardOk | GuardErr> {
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" };

  const { data: prof } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId: string | null = (prof?.institution_id as string) || null;
  let roleProfile: Role = (prof?.role as Role) ?? "";

  // Complément via user_roles (super_admin / admin)
  let roleFromUR: Role | null = null;
  if (!instId || !["admin", "super_admin"].includes(roleProfile)) {
    const { data: urRows } = await srv
      .from("user_roles")
      .select("role,institution_id")
      .eq("profile_id", user.id);

    const adminRow = (urRows || []).find((r: any) =>
      ["admin", "super_admin"].includes(String(r.role || ""))
    );
    if (adminRow) {
      roleFromUR = adminRow.role as Role;
      if (!instId && adminRow.institution_id) {
        instId = String(adminRow.institution_id);
      }
    }
  }

  const isAdmin =
    ["admin", "super_admin"].includes(roleProfile) ||
    ["admin", "super_admin"].includes(String(roleFromUR || ""));

  if (!instId) return { error: "no_institution" };
  if (!isAdmin) return { error: "forbidden" };

  return { user: { id: user.id }, instId };
}

// ============================
// GET : liste des groupes + items
// ============================
export async function GET(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const g = await guard(supa, srv);
  if ("error" in g) {
    const status =
      g.error === "unauthorized" ? 401 : g.error === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: g.error }, { status });
  }

  const url = new URL(req.url);
  const levelFilter = (url.searchParams.get("level") ?? "").trim();
  const onlyActive = url.searchParams.get("only_active") === "true";

  // 1) Groupes
  let groupsQuery = srv
    .from("bulletin_subject_groups")
    .select(
      "id, institution_id, level, code, label, short_label, order_index, is_active, annual_coeff"
    )
    .eq("institution_id", g.instId)
    .order("level", { ascending: true })
    .order("order_index", { ascending: true });

  if (levelFilter) {
    groupsQuery = groupsQuery.eq("level", levelFilter);
  }
  if (onlyActive) {
    groupsQuery = groupsQuery.eq("is_active", true);
  }

  const { data: groupsData, error: groupsErr } = await groupsQuery;
  if (groupsErr) {
    return NextResponse.json(
      { error: groupsErr.message },
      { status: 400 }
    );
  }

  const groups: GroupRow[] = (groupsData || []).map((row: any) => ({
    id: String(row.id),
    level: String(row.level),
    code: String(row.code),
    label: String(row.label),
    short_label: row.short_label ? String(row.short_label) : null,
    order_index: Number(row.order_index ?? 1),
    is_active: row.is_active !== false,
    annual_coeff: Number(row.annual_coeff ?? 1),
  }));

  if (groups.length === 0) {
    // Pas de groupes configurés pour ce niveau
    return NextResponse.json({
      ok: true,
      groups: [],
      items: [],
    });
  }

  const groupIds = groups.map((gRow) => gRow.id);

  // 2) Items (sous-disciplines) rattachés
  // On joint institution_subjects + subjects pour récupérer le nom et le subject_id.
  const { data: itemsData, error: itemsErr } = await srv
    .from("bulletin_subject_group_items")
    .select(
      `
      id,
      group_id,
      institution_subject_id,
      order_index,
      subject_coeff_override,
      is_optional,
      institution_subjects (
        id,
        level,
        subject_id,
        subjects (
          id,
          name
        )
      )
    `
    )
    .in("group_id", groupIds);

  if (itemsErr) {
    return NextResponse.json(
      { error: itemsErr.message },
      { status: 400 }
    );
  }

  const items: ItemRow[] = (itemsData || []).map((row: any) => {
    const instSub = row.institution_subjects || row.institution_subject || {};
    const subj = instSub.subjects || instSub.subject || {};
    return {
      id: String(row.id),
      group_id: String(row.group_id),
      institution_subject_id: String(row.institution_subject_id),
      subject_id: subj.id ? String(subj.id) : "",
      subject_name: subj.name ? String(subj.name) : "Matière",
      level: instSub.level ? String(instSub.level) : "",
      order_index: Number(row.order_index ?? 1),
      subject_coeff_override:
        row.subject_coeff_override !== null &&
        row.subject_coeff_override !== undefined
          ? Number(row.subject_coeff_override)
          : null,
      is_optional: row.is_optional === true,
    };
  });

  return NextResponse.json({
    ok: true,
    groups,
    items,
  });
}

// ============================
// PUT : remplace tous les groupes d’un niveau
// ============================
//
// Body attendu :
// {
//   "level": "3e",
//   "groups": [
//     { "code":"FR", "label":"Français", "short_label":"Français", "order_index":1, "is_active":true, "annual_coeff":5 },
//     { "code":"MATHS", "label":"Mathématiques", "short_label":"Maths", "order_index":2, "is_active":true, "annual_coeff":6 }
//   ],
//   "items": [
//     { "group_code":"FR", "institution_subject_id":"<uuid>", "order_index":1, "subject_coeff_override":2, "is_optional":false },
//     { "group_code":"FR", "institution_subject_id":"<uuid2>", "order_index":2 },
//     { "group_code":"MATHS", "institution_subject_id":"<uuid3>", "order_index":1 }
//   ]
// }
//
export async function PUT(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;
  const g = await guard(supa, srv);
  if ("error" in g) {
    const status =
      g.error === "unauthorized" ? 401 : g.error === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: g.error }, { status });
  }

  const body = await req.json().catch(() => ({}));

  const level = (body?.level || "").trim();
  if (!level) {
    return NextResponse.json(
      { error: "level requis dans le body (ex: '3e', 'seconde')." },
      { status: 400 }
    );
  }

  const rawGroups: any[] = Array.isArray(body?.groups) ? body.groups : [];
  const rawItems: any[] = Array.isArray(body?.items) ? body.items : [];

  // 1) Normalisation des groupes
  const normalizedGroups = rawGroups.map((grp, idx) => {
    const code = String(grp.code || grp.group_code || `G${idx + 1}`).trim();
    const label = String(
      grp.label || grp.name || `Groupe ${idx + 1}`
    ).trim();
    const shortLabelRaw =
      grp.short_label || grp.shortLabel || grp.code || null;
    const short_label = shortLabelRaw
      ? String(shortLabelRaw).trim()
      : null;

    const ordRaw = Number(grp.order_index ?? idx + 1);
    const order_index =
      Number.isFinite(ordRaw) && ordRaw > 0 ? ordRaw : idx + 1;

    const coeffRaw = Number(grp.annual_coeff ?? grp.coeff ?? 1);
    const annual_coeff =
      Number.isFinite(coeffRaw) && coeffRaw >= 0 ? coeffRaw : 1;

    return {
      code,
      label,
      short_label,
      order_index,
      is_active: grp.is_active !== false,
      annual_coeff,
    };
  });

  // 2) On supprime toutes les lignes existantes pour (institution_id, level)
  const { error: delErr } = await srv
    .from("bulletin_subject_groups")
    .delete()
    .eq("institution_id", g.instId)
    .eq("level", level);

  if (delErr) {
    return NextResponse.json(
      { error: delErr.message },
      { status: 400 }
    );
  }

  if (normalizedGroups.length === 0) {
    // Si aucun groupe → tout est supprimé pour ce niveau, c'est volontaire.
    return NextResponse.json({
      ok: true,
      groups_count: 0,
      items_count: 0,
      level,
    });
  }

  // 3) Insertion des nouveaux groupes
  const { data: insertedGroups, error: insGrpErr } = await srv
    .from("bulletin_subject_groups")
    .insert(
      normalizedGroups.map((grp) => ({
        institution_id: g.instId,
        level,
        code: grp.code,
        label: grp.label,
        short_label: grp.short_label,
        order_index: grp.order_index,
        is_active: grp.is_active,
        annual_coeff: grp.annual_coeff,
        created_by: g.user.id,
      }))
    )
    .select("id, code");

  if (insGrpErr) {
    return NextResponse.json(
      { error: insGrpErr.message },
      { status: 400 }
    );
  }

  const groupsByCode = new Map<string, string>();
  (insertedGroups || []).forEach((row: any) => {
    groupsByCode.set(String(row.code), String(row.id));
  });

  // 4) Normalisation des items avec mapping group_code -> group_id
  type ItemInsert = {
    group_id: string;
    institution_subject_id: string;
    order_index: number;
    subject_coeff_override: number | null;
    is_optional: boolean;
    created_by: string | null;
  };

  const normalizedItems: ItemInsert[] = [];
  rawItems.forEach((it, idx) => {
    const groupCode = String(
      it.group_code || it.groupCode || it.group?.code || ""
    ).trim();
    const groupId = groupsByCode.get(groupCode);
    const instSubIdRaw =
      it.institution_subject_id ||
      it.inst_subject_id ||
      it.institution_subject ||
      "";

    const institution_subject_id = String(instSubIdRaw || "").trim();

    if (!groupId || !institution_subject_id) {
      // Item incomplet → on l'ignore silencieusement
      return;
    }

    const ordRaw = Number(it.order_index ?? idx + 1);
    const order_index =
      Number.isFinite(ordRaw) && ordRaw > 0 ? ordRaw : idx + 1;

    const coeffRaw = it.subject_coeff_override ?? it.coeff_override;
    let subject_coeff_override: number | null = null;
    if (coeffRaw !== null && coeffRaw !== undefined) {
      const n = Number(coeffRaw);
      subject_coeff_override = Number.isFinite(n) ? n : null;
    }

    normalizedItems.push({
      group_id: groupId,
      institution_subject_id,
      order_index,
      subject_coeff_override,
      is_optional: it.is_optional === true,
      created_by: g.user.id,
    });
  });

  let itemsCount = 0;
  if (normalizedItems.length > 0) {
    const { error: insItemsErr, data: insItems } = await srv
      .from("bulletin_subject_group_items")
      .insert(normalizedItems)
      .select("id");

    if (insItemsErr) {
      return NextResponse.json(
        { error: insItemsErr.message },
        { status: 400 }
      );
    }
    itemsCount = (insItems || []).length;
  }

  return NextResponse.json({
    ok: true,
    level,
    groups_count: (insertedGroups || []).length,
    items_count: itemsCount,
  });
}
