// src/app/api/admin/students/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getCurrentAcademicYear(
  institutionId: string,
): Promise<string | null> {
  const srv = getSupabaseServiceClient();

  const { data: current } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (current?.code) return String(current.code);

  const { data: latest } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latest?.code ? String(latest.code) : null;
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr)
    return NextResponse.json({ error: meErr.message }, { status: 400 });

  const inst = (me?.institution_id ?? null) as string | null;
  if (!inst) return NextResponse.json({ items: [] });

  const url = new URL(req.url);
  const classId = String(
    url.searchParams.get("class_id") || url.searchParams.get("classId") || "",
  ).trim();
  const academicYearParam = String(
    url.searchParams.get("academic_year") || "",
  ).trim();
  const academicYear =
    academicYearParam || (await getCurrentAcademicYear(inst));
  const shouldFilterYear = Boolean(academicYear && academicYear !== "all");

  let query = supa
    .from("class_enrollments")
    .select(
      `
      student_id,
      class_id,
      students:student_id ( id, first_name, last_name, full_name, matricule, institution_id, regime, is_affecte, is_boarder ),
      classes:class_id!inner ( id, label, level, institution_id, academic_year )
    `,
    )
    .eq("institution_id", inst)
    .is("end_date", null);

  if (classId) query = query.eq("class_id", classId);
  if (shouldFilterYear) query = query.eq("classes.academic_year", academicYear);

  const { data, error } = await query;

  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  const seen = new Set<string>();
  const items: Array<{
    id: string;
    full_name: string;
    matricule: string | null;
    class_id: string;
    class_label: string | null;
    class_level: string | null;
    academic_year: string | null;
    is_affecte: boolean | null;
    is_boarder: boolean | null;
    regime: string | null;
  }> = [];

  for (const row of data ?? []) {
    const s = (row as any).students ?? {};
    const c = (row as any).classes ?? {};
    const sid = s.id as string | undefined;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);

    const full =
      String(s.full_name || "").trim() ||
      `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() ||
      "—";

    items.push({
      id: sid,
      full_name: full,
      matricule: (s.matricule ?? null) as string | null,
      class_id: (row as any).class_id as string,
      class_label: (c.label ?? null) as string | null,
      class_level: (c.level ?? null) as string | null,
      academic_year: (c.academic_year ?? null) as string | null,
      is_affecte:
        typeof s.is_affecte === "boolean" ? (s.is_affecte as boolean) : null,
      is_boarder:
        typeof s.is_boarder === "boolean" ? (s.is_boarder as boolean) : null,
      regime: (s.regime ?? null) as string | null,
    });
  }

  return NextResponse.json({
    items,
    academic_year: shouldFilterYear ? academicYear : null,
  });
}
