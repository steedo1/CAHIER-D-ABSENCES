// src/app/api/teacher/grades/components/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const class_id = searchParams.get("class_id");
  const subject_id = searchParams.get("subject_id");

  // Si on n'a pas tout, on ne crashe pas : on renvoie juste une liste vide
  if (!class_id || !subject_id) {
    return NextResponse.json({ items: [] });
  }

  // On vérifie l'établissement via la classe (sécurité + filtrage)
  const { data: cls, error: errCls } = await supabase
    .from("classes")
    .select("id, institution_id")
    .eq("id", class_id)
    .maybeSingle();

  if (errCls || !cls) {
    return NextResponse.json(
      { error: "Classe introuvable pour cette requête." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("grade_subject_components")
    .select(
      "id, code, label, short_label, coeff_in_subject, order_index, is_active"
    )
    .eq("institution_id", cls.institution_id)
    .eq("subject_id", subject_id)
    .eq("is_active", true)
    .order("order_index", { ascending: true })
    .order("label", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Erreur de chargement des rubriques." },
      { status: 400 }
    );
  }

  const items =
    (data ?? []).map((c: any) => ({
      id: c.id as string,
      label: c.label as string,
      short_label: (c.short_label as string | null) ?? null,
      coeff_in_subject: Number(c.coeff_in_subject ?? 1),
      order_index: c.order_index as number | null,
    })) ?? [];

  return NextResponse.json({ items });
}
