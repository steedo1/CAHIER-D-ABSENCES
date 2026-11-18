// src/app/api/admin/students/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const inst = me?.institution_id as string | null;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  // Les modifications d'identité sont réservées à la direction de l'établissement.
  const { data: roles, error: rolesErr } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);
  if (rolesErr) return NextResponse.json({ error: rolesErr.message }, { status: 400 });
  const canEdit = (roles || []).some((r: any) =>
    r.role === "super_admin" ||
    (r.role === "admin" && (!r.institution_id || r.institution_id === inst)),
  );
  if (!canEdit) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = (await params).id;
  const rawBody = await req.json().catch(() => ({}));
  const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? rawBody : {};
  const patch: Record<string, any> = {};

  if ("first_name" in body) patch.first_name = body.first_name ?? null;
  if ("last_name" in body)  patch.last_name  = body.last_name ?? null;
  if ("matricule" in body)  patch.matricule  = (body.matricule ?? null) ? String(body.matricule).trim().toUpperCase() : null;
  if ("full_name_ar" in body) patch.full_name_ar = String(body.full_name_ar ?? "").trim() || null;
  if ("birth_place" in body) patch.birth_place = String(body.birth_place ?? "").trim() || null;
  if ("nationality" in body) patch.nationality = String(body.nationality ?? "").trim() || null;
  if ("gender" in body) {
    const gender = String(body.gender ?? "").trim().toUpperCase();
    if (gender && gender !== "M" && gender !== "F") {
      return NextResponse.json({ error: "invalid_gender" }, { status: 400 });
    }
    patch.gender = gender || null;
  }
  if ("birthdate" in body) {
    const birthdate = String(body.birthdate ?? "").trim();
    if (birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
      return NextResponse.json({ error: "invalid_birthdate" }, { status: 400 });
    }
    if (birthdate && Number.isNaN(Date.parse(birthdate))) {
      return NextResponse.json({ error: "invalid_birthdate" }, { status: 400 });
    }
    patch.birthdate = birthdate || null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_changes" }, { status: 400 });
  }

  // Vérifier que l’élève appartient à la même institution
  const { data: s, error: sErr } = await srv
    .from("students")
    .select("id,institution_id")
    .eq("id", id)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });
  if (!s || (s as any).institution_id !== inst) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Unicité du matricule dans l’établissement (si fourni)
  if (patch.matricule) {
    const { data: dup, error: dErr } = await srv
      .from("students")
      .select("id")
      .eq("institution_id", inst)
      .eq("matricule", patch.matricule)
      .neq("id", id);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 400 });
    if ((dup ?? []).length) {
      return NextResponse.json({ error: "duplicate_matricule" }, { status: 400 });
    }
  }

  const { data: upd, error: uErr } = await srv
    .from("students")
    .update(patch)
    .eq("id", id)
    .select("id, first_name, last_name, matricule, full_name_ar, birthdate, birth_place, nationality, gender")
    .maybeSingle();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });
  if (!upd) return NextResponse.json({ error: "student_not_updated" }, { status: 409 });
  return NextResponse.json({ item: upd });
}
