// src/app/api/admin/classes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Récupérer l'institution de l'utilisateur
  const { data: me, error: meErr } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return NextResponse.json({ error: meErr.message }, { status: 400 });
  }
  if (!me?.institution_id) {
    return NextResponse.json(
      { error: "no_institution" },
      { status: 400 }
    );
  }

  // Optionnel : limite passée en query (ex: ?limit=999)
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  let limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = 999;
  }

  const { data, error } = await supabase
    .from("classes")
    .select("id,label,level,academic_year")
    .eq("institution_id", me.institution_id)
    .order("label")
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Front attend { id, name, level } pour la plupart des écrans,
  // on ajoute simplement academic_year pour la page de prédiction.
  const items = (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.label,
    level: c.level,
    academic_year: c.academic_year,
  }));

  return NextResponse.json({ items });
}
