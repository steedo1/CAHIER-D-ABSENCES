import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";
type ActionKind = "approve" | "reject";

function normalize(v: unknown) {
  return String(v ?? "").trim();
}

async function getAdminContext() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Non authentifié", status: 401 };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, institution_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return { error: "Profil introuvable", status: 400 };
  }

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("institution_id", profile.institution_id);

  const allowed = (roles ?? []).some(
    (r) => r.role === "admin" || r.role === "super_admin"
  );

  if (!allowed) {
    return { error: "Accès refusé", status: 403 };
  }

  return {
    supabase,
    user,
    profile,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext();

  if ("error" in ctx) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
  }

  const { supabase, profile } = ctx;

  const params = req.nextUrl.searchParams;
  const status = normalize(params.get("status"));
  const teacher = normalize(params.get("teacher"));

  let query = supabase
    .from("teacher_absence_requests")
    .select("*")
    .eq("institution_id", profile.institution_id)
    .order("created_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status as RequestStatus);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = data ?? [];

  // 🔥 récupération noms enseignants
  const teacherIds = [...new Set(rows.map((r) => r.teacher_profile_id))];

  let nameMap = new Map<string, string>();

  if (teacherIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", teacherIds);

    nameMap = new Map(
      (profiles ?? []).map((p) => [p.id, p.display_name || ""])
    );
  }

  let items = rows.map((r) => ({
    ...r,
    teacher_name: nameMap.get(r.teacher_profile_id) || null,
  }));

  if (teacher) {
    const q = teacher.toLowerCase();
    items = items.filter((i) =>
      String(i.teacher_name ?? "").toLowerCase().includes(q)
    );
  }

  return NextResponse.json({
    ok: true,
    items,
  });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext();

  if ("error" in ctx) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
  }

  const { supabase, profile } = ctx;

  const body = await req.json().catch(() => null);

  const id = normalize(body?.id);
  const action = normalize(body?.action) as ActionKind;
  const comment = normalize(body?.admin_comment) || null;

  if (!id) {
    return NextResponse.json({ ok: false, error: "ID manquant" }, { status: 400 });
  }

  if (!["approve", "reject"].includes(action)) {
    return NextResponse.json({ ok: false, error: "Action invalide" }, { status: 400 });
  }

  const now = new Date().toISOString();

  const updateData =
    action === "approve"
      ? {
          status: "approved",
          admin_comment: comment,
          approved_at: now,
          approved_by: profile.id,
          rejected_at: null,
          rejected_by: null,
        }
      : {
          status: "rejected",
          admin_comment: comment,
          rejected_at: now,
          rejected_by: profile.id,
          approved_at: null,
          approved_by: null,
        };

  const { data, error } = await supabase
    .from("teacher_absence_requests")
    .update(updateData)
    .eq("id", id)
    .eq("institution_id", profile.institution_id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const { data: teacherProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", data.teacher_profile_id)
    .single();

  return NextResponse.json({
    ok: true,
    item: {
      ...data,
      teacher_name: teacherProfile?.display_name || null,
    },
  });
}