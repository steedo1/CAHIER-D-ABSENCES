// src/app/api/parent/children/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { readParentSessionFromReq } from "@/lib/parent-session";

// Handle both array/object shapes for joined classes
function firstLabel(classes: any): string | null {
  if (!classes) return null;
  if (Array.isArray(classes)) return classes[0]?.label ?? null;
  return classes.label ?? null;
}

export async function GET(req: Request) {
  const supa = await getSupabaseServerClient(); // RLS (cookies)
  const srv  = getSupabaseServiceClient();      // service (no RLS)

  const { data: { user } } = await supa.auth.getUser().catch(() => ({ data: { user: null } } as any));

  if (user) {
    // ── Mode A: liste multi-enfants liée à ce parent Supabase
    const { data: links, error: lErr } = await srv
      .from("student_guardians")
      .select("student_id")
      .eq("parent_id", user.id);

    if (lErr) return NextResponse.json({ items: [], error: lErr.message }, { status: 400 });

    const studentIds = Array.from(new Set((links || []).map((r: any) => String(r.student_id))));
    if (!studentIds.length) return NextResponse.json({ items: [] });

    const [{ data: studs }, { data: enrolls }] = await Promise.all([
      srv.from("students").select("id, first_name, last_name").in("id", studentIds),
      srv
        .from("class_enrollments")
        .select("student_id, classes:class_id(label)")
        .in("student_id", studentIds)
        .is("end_date", null),
    ]);

    const clsByStudent = new Map<string, string>();
    for (const e of enrolls || []) {
      const label = firstLabel((e as any).classes) ?? "";
      clsByStudent.set(String((e as any).student_id), String(label));
    }

    const items = (studs || [])
      .map((s: any) => {
        const full = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() || "(inconnu)";
        return { id: String(s.id), full_name: full, class_label: clsByStudent.get(String(s.id)) || null };
      })
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "fr"));

    return NextResponse.json({ items });
  }

  // ── Mode B: session parent (matricule) → un seul élève = sid
  const claims = readParentSessionFromReq(req);
  if (!claims) return NextResponse.json({ items: [] }, { status: 401 });
  const { sid } = claims;

  const [{ data: s }, { data: enr }] = await Promise.all([
    srv.from("students").select("id, first_name, last_name").eq("id", sid).maybeSingle(),
    srv
      .from("class_enrollments")
      .select("student_id, classes:class_id(label)")
      .eq("student_id", sid)
      .is("end_date", null),
  ]);

  if (!s) return NextResponse.json({ items: [] });

  const full = `${(s as any).first_name ?? ""} ${(s as any).last_name ?? ""}`.trim() || "(inconnu)";
  const class_label = firstLabel(enr?.[0]?.classes) ?? null;

  return NextResponse.json({
    items: [{ id: String((s as any).id), full_name: full, class_label }],
  });
}
