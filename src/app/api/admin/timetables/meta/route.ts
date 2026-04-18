// src/app/api/admin/timetables/meta/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (meErr) {
      return NextResponse.json({ error: meErr.message }, { status: 400 });
    }

    const institution_id = me?.institution_id as string | null;
    if (!institution_id) {
      return NextResponse.json(
        { error: "no_institution", message: "Aucune institution associée à ce compte." },
        { status: 400 }
      );
    }

    const { data: roleRow } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id)
      .eq("institution_id", institution_id)
      .maybeSingle();

    const role = (roleRow?.role as string | undefined) || "";
    if (!["admin", "super_admin"].includes(role)) {
      return NextResponse.json(
        { error: "forbidden", message: "Droits insuffisants pour consulter ces données." },
        { status: 403 }
      );
    }

    const [{ data: classes }, { data: subjects }, { data: teachers }, { data: periods }] =
      await Promise.all([
        srv
          .from("classes")
          .select("id,label")
          .eq("institution_id", institution_id)
          .order("label", { ascending: true }),
        srv
          .from("institution_subjects")
          .select("id,custom_name,subjects:subject_id(name)")
          .eq("institution_id", institution_id)
          .order("custom_name", { ascending: true }),
        srv
          .from("profiles")
          .select("id,display_name,phone")
          .eq("institution_id", institution_id)
          .order("display_name", { ascending: true }),
        srv
          .from("institution_periods")
          .select("id,weekday,period_no,start_time,end_time")
          .eq("institution_id", institution_id)
          .order("weekday", { ascending: true })
          .order("period_no", { ascending: true }),
      ]);

    const outClasses =
      (classes || []).map((c: any) => ({
        id: c.id as string,
        label: String(c.label || "").trim(),
      })) ?? [];

    const outSubjects =
      (subjects || []).map((s: any) => {
        let baseName = "";
        if (Array.isArray(s.subjects)) {
          baseName = s.subjects[0]?.name || "";
        } else if (s.subjects && typeof s.subjects === "object") {
          baseName = (s.subjects as any).name || "";
        }
        const label = String(s.custom_name || baseName || "").trim();
        return {
          id: s.id as string,
          label,
        };
      }) ?? [];

    const outTeachers =
      (teachers || []).map((t: any) => ({
        id: t.id as string,
        display_name: String(t.display_name || "").trim(),
        phone: t.phone ? String(t.phone) : null,
      })) ?? [];

    const outPeriods =
      (periods || []).map((p: any) => ({
        id: p.id as string,
        weekday: typeof p.weekday === "number" ? p.weekday : 0,
        period_no: typeof p.period_no === "number" ? p.period_no : 0,
        start_time: p.start_time ? String(p.start_time) : null,
        end_time: p.end_time ? String(p.end_time) : null,
      })) ?? [];

    return NextResponse.json({
      classes: outClasses,
      subjects: outSubjects,
      teachers: outTeachers,
      periods: outPeriods,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "meta_failed", message: e?.message || "Erreur serveur." },
      { status: 500 }
    );
  }
}
