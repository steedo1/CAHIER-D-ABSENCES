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

  const { data: me, error: meErr } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return NextResponse.json({ error: meErr.message }, { status: 400 });
  }

  if (!me?.institution_id) {
    return NextResponse.json({ error: "no_institution" }, { status: 400 });
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const academicYear = (url.searchParams.get("academic_year") || "").trim();

  let limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = 999;
  }

  let query = supabase
    .from("classes")
    .select("id,label,level,code,academic_year,official_track_code,class_phone_e164")
    .eq("institution_id", me.institution_id);

  // Si l'écran précise une année scolaire, on n'affiche que les classes de cette année.
  // Si rien n'est passé, on garde le comportement historique pour ne pas casser les autres pages.
  if (academicYear && academicYear !== "all") {
    query = query.eq("academic_year", academicYear);
  }

  const { data, error } = await query
    .order("level", { ascending: true })
    .order("label", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const items = (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.label,
    label: c.label,
    level: c.level,
    code: c.code,
    academic_year: c.academic_year,
    official_track_code: c.official_track_code,
    officialTrackCode: c.official_track_code,
    class_phone_e164: c.class_phone_e164 ?? null,
  }));

  return NextResponse.json({ items });
}
