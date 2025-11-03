//src/app/api/class/subjects/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const srv = getSupabaseServiceClient();
  const url = new URL(req.url);
  const class_id = String(url.searchParams.get("class_id") || "").trim();
  if (!class_id) return NextResponse.json({ items: [] });

  // Récupérer l’établissement de la classe
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("institution_id,label")
    .eq("id", class_id)
    .maybeSingle();
  if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
  if (!cls) return NextResponse.json({ items: [] });

  // Matières configurées sur l’établissement
  const { data, error } = await srv
    .from("institution_subjects")
    .select("id, custom_name, subjects:subject_id(name)")
    .eq("institution_id", cls.institution_id)
    .order("custom_name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const items = (data || []).map((r: any) => ({
    id: r.id as string,
    label: (r.custom_name as string) || (r.subjects?.name as string) || "—",
  }));

  return NextResponse.json({ items });
}
