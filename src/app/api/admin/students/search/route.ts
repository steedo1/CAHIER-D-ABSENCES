// src/app/api/admin/students/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const inst = (me?.institution_id ?? null) as string | null;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const url = new URL(req.url);
  const qRaw = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));

  if (qRaw.length < 2) return NextResponse.json({ items: [] }); // on évite les requêtes trop vagues

  // Échappe % et _ pour ILIKE
  const q = qRaw.replace(/[%_]/g, (m) => `\\${m}`);
  const like = `%${q}%`;

  // 1) On cherche dans students (nom, prénom, matricule)
  const { data: studs, error: sErr } = await srv
    .from("students")
    .select("id, first_name, last_name, matricule")
    .eq("institution_id", inst)
    .or(
      [
        `first_name.ilike.${like}`,
        `last_name.ilike.${like}`,
        `matricule.ilike.${like}`,
      ].join(",")
    )
    .order("last_name", { ascending: true, nullsFirst: true })
    .order("first_name", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });

  const ids = (studs ?? []).map((s) => s.id);
  let mapClass = new Map<string, { class_id: string | null; class_label: string | null }>();

  if (ids.length) {
    // 2) Classe active (end_date IS NULL) pour afficher le contexte
    const { data: enr, error: eErr } = await srv
      .from("class_enrollments")
      .select("student_id, class_id, classes(name,label)")
      .in("student_id", ids)
      .eq("institution_id", inst)
      .is("end_date", null);

    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 400 });

    for (const r of enr ?? []) {
      const label = (r as any)?.classes?.name || (r as any)?.classes?.label || null;
      mapClass.set((r as any).student_id, {
        class_id: (r as any).class_id ?? null,
        class_label: label,
      });
    }
  }

  const items = (studs ?? []).map((s) => {
    const c = mapClass.get(s.id) ?? { class_id: null, class_label: null };
    return {
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      matricule: s.matricule,
      class_id: c.class_id,
      class_label: c.class_label,
    };
  });

  return NextResponse.json({ items });
}
