// src/app/api/admin/students/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const supa = await getSupabaseServerClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const inst = me?.institution_id as string | null;
  if (!inst) return NextResponse.json({ items: [] });

  const { data, error } = await supa
    .from("class_enrollments")
    .select(`
      student_id,
      class_id,
      students:student_id ( id, first_name, last_name, matricule, institution_id ),
      classes:class_id   ( id, label, institution_id )
    `)
    .eq("institution_id", inst)
    .is("end_date", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const items = (data ?? []).map((row: any) => {
    const s = row.students ?? {};
    const c = row.classes ?? {};
    const full = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || "—";
    return {
      id: s.id as string,
      full_name: full,
      matricule: (s.matricule ?? null) as string | null,   // ✅ renvoyé maintenant
      class_id: row.class_id as string,
      class_label: (c.label ?? null) as string | null,
    };
  });

  return NextResponse.json({ items });
}
