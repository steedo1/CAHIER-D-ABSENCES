// src/app/api/admin/students/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
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

  const id = params.id;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, any> = {};

  if ("first_name" in body) patch.first_name = body.first_name ?? null;
  if ("last_name" in body)  patch.last_name  = body.last_name ?? null;
  if ("matricule" in body)  patch.matricule  = (body.matricule ?? null) ? String(body.matricule).trim().toUpperCase() : null;

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
    .select("id, first_name, last_name, matricule")
    .maybeSingle();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });
  return NextResponse.json({ item: upd });
}
