//src/app/api/admin/teachers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const supabase = getSupabaseServiceClient();
  const { searchParams } = new URL(req.url);
  const subject_id = searchParams.get("subject_id");

  try {
    async function detectFirstExistingTable(cands: string[]) {
      for (const name of cands) {
        const { error } = await supabase.from(name).select("id").limit(1);
        if (!error) return name;
      }
      return null;
    }

    const teachersTable = await detectFirstExistingTable(["teachers", "profiles"]);
    if (!teachersTable) return NextResponse.json({ items: [] });

    const pivotTable = await detectFirstExistingTable(["teacher_subjects", "professor_subjects"]);
    const sessionsTable = await detectFirstExistingTable(["teacher_sessions", "class_sessions", "sessions"]);

    // 1) Pivot direct
    if (pivotTable && subject_id) {
      const { data: links, error: linkErr } = await supabase
        .from(pivotTable)
        .select("teacher_id")
        .eq("subject_id", subject_id);
      if (linkErr) throw linkErr;
      const ids = Array.from(new Set((links || []).map((r: any) => r.teacher_id).filter(Boolean)));
      if (ids.length === 0) return NextResponse.json({ items: [] });

      if (teachersTable === "teachers") {
        const { data: ts } = await supabase.from("teachers").select("id, full_name").in("id", ids).order("full_name", { ascending: true });
        return NextResponse.json({ items: (ts || []).map((t: any) => ({ id: t.id, full_name: String(t.full_name ?? "") })) });
      } else {
        const { data: ts } = await supabase.from("profiles").select("id, display_name, role").in("id", ids);
        const onlyTeachers = (ts || []).filter((p: any) => (p.role ? String(p.role) === "teacher" : true));
        const items = onlyTeachers
          .map((p: any) => ({ id: p.id, full_name: String(p.display_name ?? "") }))
          .sort((a: any, b: any) => a.full_name.localeCompare(b.full_name));
        return NextResponse.json({ items });
      }
    }

    // 2) Fallback via sessions (12 derniers mois)
    if (sessionsTable && subject_id) {
      const from = new Date();
      from.setMonth(from.getMonth() - 12);
      const { data: sess } = await supabase
        .from(sessionsTable)
        .select("teacher_id")
        .eq("subject_id", subject_id)
        .gte("started_at", from.toISOString());
      const ids = Array.from(new Set((sess || []).map((r: any) => r.teacher_id).filter(Boolean)));
      if (ids.length) {
        if (teachersTable === "teachers") {
          const { data: ts } = await supabase.from("teachers").select("id, full_name").in("id", ids).order("full_name", { ascending: true });
          return NextResponse.json({ items: (ts || []).map((t: any) => ({ id: t.id, full_name: String(t.full_name ?? "") })) });
        } else {
          const { data: ts } = await supabase.from("profiles").select("id, display_name, role").in("id", ids);
          const items = (ts || [])
            .filter((p: any) => (p.role ? String(p.role) === "teacher" : true))
            .map((p: any) => ({ id: p.id, full_name: String(p.display_name ?? "") }))
            .sort((a: any, b: any) => a.full_name.localeCompare(b.full_name));
          return NextResponse.json({ items });
        }
      }
    }

    // 3) Tous les enseignants (fallback final)
    if (teachersTable === "teachers") {
      const { data: ts } = await supabase.from("teachers").select("id, full_name").order("full_name", { ascending: true });
      return NextResponse.json({ items: (ts || []).map((t: any) => ({ id: t.id, full_name: String(t.full_name ?? "") })) });
    } else {
      const { data: ts } = await supabase.from("profiles").select("id, display_name, role").eq("role", "teacher");
      const items = (ts || [])
        .map((p: any) => ({ id: p.id, full_name: String(p.display_name ?? "") }))
        .sort((a: any, b: any) => a.full_name.localeCompare(b.full_name));
      return NextResponse.json({ items });
    }
  } catch (e: any) {
    console.error("/api/admin/teachers", e);
    return NextResponse.json({ items: [] });
  }
}


