// src/app/api/admin/dashboard/metrics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401 });

  const { data: me, error: meErr } = await supa
    .from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
  if (meErr) return NextResponse.json({ ok:false, error:meErr.message }, { status:400 });

  const institution_id = me?.institution_id as string | null;
  if (!institution_id) return NextResponse.json({ ok:false, error:"NO_INSTITUTION" }, { status:400 });

  // ----- days depuis l'URL (7/30/90), défaut 30
  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days") || "30");
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 30;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  // ----- Compteurs
  const [classesQ, teachersQ, parentsQ, studentsTotalQ, activeRowsQ] = await Promise.all([
    srv.from("classes")
       .select("id", { count: "exact", head: true })
       .eq("institution_id", institution_id),

    srv.from("user_roles")
       .select("profile_id", { count: "exact", head: true })
       .eq("institution_id", institution_id)
       .eq("role","teacher"),

    srv.from("user_roles")
       .select("profile_id", { count: "exact", head: true })
       .eq("institution_id", institution_id)
       .eq("role","parent"),

    // total profils élèves (tous)
    srv.from("students")
       .select("id", { count: "exact", head: true })
       .eq("institution_id", institution_id),

    // élèves ACTIFS en classe (end_date IS NULL) → on déduplique côté code
    srv.from("class_enrollments")
       .select("student_id, classes!inner(institution_id)", { head: false })
       .eq("classes.institution_id", institution_id)
       .is("end_date", null),
  ]);

  const students_active = new Set(
    (activeRowsQ.data ?? []).map(r => (r as any).student_id)
  ).size;

  // ----- KPIs (période dynamique)
  const absencesQ = await srv
    .from("v_mark_minutes")
    .select("*", { count:"exact", head:true })
    .eq("institution_id", institution_id)
    .eq("status","absent")
    .gte("started_at", since);

  const retardsQ = await srv
    .from("v_mark_minutes")
    .select("*", { count:"exact", head:true })
    .eq("institution_id", institution_id)
    .eq("status","late")
    .gte("started_at", since);

  return NextResponse.json({
    ok: true,
    counts: {
      classes:        classesQ.count  ?? 0,
      teachers:       teachersQ.count ?? 0,
      parents:        parentsQ.count  ?? 0,
      // 👇 on affiche désormais le NOMBRE ACTIF (516)
      students:       students_active,
      // …et on expose aussi le total (520) au besoin pour l’UI
      students_total: studentsTotalQ.count ?? 0,
    },
    kpis: {
      absences: absencesQ.count ?? 0,
      retards:  retardsQ.count  ?? 0,
    },
    meta: { days },
  });
}
