// app/api/admin/classes/[id]/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

/** RÃ©cupÃ¨re l'institution du user courant, sinon 401/400 */
async function getMyInstitutionId() {
  const supabaseAuth = await getSupabaseServerClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const { data: me, error: meErr } = await supabaseAuth
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };
  if (!me?.institution_id) return { error: NextResponse.json({ error: "no_institution" }, { status: 400 }) };

  return { institution_id: me.institution_id as string };
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const { id } = ctx.params;
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const row: Record<string, any> = {};
  if (typeof body.label === "string") row.label = body.label.trim();
  if (typeof body.level === "string") row.level = body.level.trim();
  if (typeof body.code === "string" || body.code === null) row.code = body.code ?? null;
  if (typeof body.academic_year === "string" || body.academic_year === null) row.academic_year = body.academic_year ?? null;

  if (Object.keys(row).length === 0) {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const { data, error: dbErr } = await supabase
    .from("classes")
    .update(row)
    .eq("id", id)
    .eq("institution_id", institution_id)
    .select("id,label,level,code,academic_year")
    .maybeSingle();

  if (dbErr) {
    // Conflit de contrainte unique (institution_id, label)
    const isUnique = (dbErr as any).code === "23505";
    return NextResponse.json({ error: dbErr.message }, { status: isUnique ? 409 : 400 });
  }
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ item: data });
}

export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  const { id } = ctx.params;
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const supabase = getSupabaseServiceClient();
  const { data, error: dbErr } = await supabase
    .from("classes")
    .delete()
    .eq("id", id)
    .eq("institution_id", institution_id)
    .select("id")
    .maybeSingle();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
