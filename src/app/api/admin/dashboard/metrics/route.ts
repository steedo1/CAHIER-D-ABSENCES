// src/app/api/admin/dashboard/metrics/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function GET() {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401 });

  const { data: me, error: meErr } = await supa
    .from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
  if (meErr) return NextResponse.json({ ok:false, error:meErr.message }, { status:400 });

  const institution_id = me?.institution_id as string | null;
  if (!institution_id) return NextResponse.json({ ok:false, error:"NO_INSTITUTION" }, { status:400 });

  // Compteurs (�l�ves via vue d�dupliqu�e)
  const [classesQ, teachersQ, parentsQ, studentsQ] = await Promise.all([
    srv.from("classes")
       .select("id", { count: "exact", head: true })
       .eq("institution_id", institution_id),

    srv.from("user_roles")
       .select("profile_id", { count: "exact", head: true })
       .eq("institution_id", institution_id).eq("role","teacher"),

    srv.from("user_roles")
       .select("profile_id", { count: "exact", head: true })
       .eq("institution_id", institution_id).eq("role","parent"),

    // �! compte 1 ligne par �Spersonne �l�ve
    srv.from("v_student_person")
       .select("*", { count: "exact", head: true })
       .eq("institution_id", institution_id),
  ]);

  // KPIs 30 jours (via vue normalis�e)
  const since = new Date(Date.now() - 30*24*3600*1000).toISOString();

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
      classes:  classesQ.count  ?? 0,
      teachers: teachersQ.count ?? 0,
      parents:  parentsQ.count  ?? 0,
      students: studentsQ.count ?? 0,   // � � d�doublonn�
    },
    kpis: {
      absences: absencesQ.count ?? 0,
      retards:  retardsQ.count  ?? 0,
    }
  });
}


