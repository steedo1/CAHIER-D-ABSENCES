//src/app/api/penalties/score/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ items: [] });

  const url = new URL(req.url);
  const class_id = String(url.searchParams.get("class_id") || "");
  if (!class_id) return NextResponse.json({ items: [] });

  // élèves de la classe
  const { data: enr, error: e1 } = await supa
    .from("class_enrollments")
    .select("student_id")
    .eq("class_id", class_id)
    .is("end_date", null);

  if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

  const ids = (enr || []).map((r: any) => r.student_id as string);
  if (ids.length === 0) return NextResponse.json({ items: [] });

  // breakdown
  const { data, error } = await supa
    .from("v_conduct_breakdown")
    .select("*")
    .in("student_id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ items: data || [] });
}


