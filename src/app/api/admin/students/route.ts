// src/app/api/admin/students/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const supa = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const inst = (me?.institution_id ?? null) as string | null;
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

  // ⚖️ Dédoublonnage défensif (au cas où)
  const seen = new Set<string>(); // student_id
  const items: Array<{
    id: string;
    full_name: string;
    matricule: string | null;
    class_id: string;
    class_label: string | null;
  }> = [];

  for (const row of data ?? []) {
    const s = (row as any).students ?? {};
    const c = (row as any).classes ?? {};
    const sid = s.id as string | undefined;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);

    const full = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || "—";
    items.push({
      id: sid,
      full_name: full,
      matricule: (s.matricule ?? null) as string | null,
      class_id: (row as any).class_id as string,
      class_label: (c.label ?? null) as string | null,
    });
  }

  return NextResponse.json({ items });
}
