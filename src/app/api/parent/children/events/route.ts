import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { readParentSessionFromReq } from "@/lib/parent-session";

/** Resolve subjects names from subjects / institution_subjects */
async function resolveSubjectNames(srv: any, ids: string[]) {
  const map = new Map<string, string>();
  if (!ids.length) return map;

  const { data: instSubs } = await srv
    .from("institution_subjects")
    .select("id, subject_id, custom_name, subjects:subject_id(name)")
    .in("id", ids);

  for (const r of instSubs || []) {
    const id = String((r as any).id);
    const nm = (r as any).custom_name || (r as any).subjects?.name || null;
    if (nm) map.set(id, nm);
    const baseId = (r as any).subject_id as string | null;
    if (baseId && nm && !map.has(baseId)) map.set(baseId, nm);
  }

  const missingBase = ids.filter((x) => !map.has(x));
  if (missingBase.length) {
    const { data: subs } = await srv.from("subjects").select("id,name").in("id", missingBase);
    for (const s of subs || []) map.set(String((s as any).id), String((s as any).name ?? "(inconnu)"));
  }
  return map;
}

export async function GET(req: Request) {
  const supa = await getSupabaseServerClient();   // RLS
  const srv  = getSupabaseServiceClient();        // service

  const { data: { user } } = await supa.auth.getUser().catch(() => ({ data: { user: null } } as any));
  const url = new URL(req.url);
  const qStudent = url.searchParams.get("student_id") || "";
  const days = Math.max(1, Math.min(120, parseInt(url.searchParams.get("days") || "45", 10)));

  let student_id = qStudent;

  if (user) {
    if (!student_id) return NextResponse.json({ items: [], error: "student_id required" }, { status: 400 });
    const { data: ok } = await srv
      .from("student_guardians")
      .select("student_id")
      .eq("parent_id", user.id)
      .eq("student_id", student_id)
      .limit(1);
    if (!ok || ok.length === 0) return NextResponse.json({ items: [] }, { status: 403 });
  } else {
    const claims = readParentSessionFromReq(req);
    if (!claims) return NextResponse.json({ items: [] }, { status: 401 });
    if (student_id && student_id !== claims.sid) return NextResponse.json({ items: [] }, { status: 403 });
    student_id = claims.sid;
  }

  const fromIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  // 1) jointure directe
  let rows: any[] = [];
  {
    const { data, error } = await srv
      .from("attendance_marks")
      .select(`
        id,
        status,
        minutes_late,
        session:session_id (
          started_at,
          expected_minutes,
          class_id,
          subject_id,
          institution_id
        )
      `)
      .eq("student_id", student_id)
      .gte("session.started_at", fromIso)
      .order("id", { ascending: false })
      .limit(400);
    if (!error) rows = data || [];
  }

  // 2) fallback
  if (!rows.length) {
    const { data: data2, error: e2 } = await srv
      .from("attendance_marks")
      .select(`
        id,
        status,
        minutes_late,
        session:session_id (
          started_at,
          expected_minutes,
          class_id,
          subject_id,
          institution_id
        )
      `)
      .eq("student_id", student_id)
      .order("id", { ascending: false })
      .limit(800);

    if (e2) return NextResponse.json({ items: [], error: e2.message }, { status: 400 });
    rows = (data2 || []).filter((r: any) => r.session?.started_at && String(r.session.started_at) >= fromIso);
  }

  const useful = (rows || []).filter((r: any) => r.status === "absent" || r.status === "late");

  const classIds = Array.from(new Set(useful.map((r: any) => String(r.session?.class_id)).filter(Boolean)));
  const { data: classes } = await srv.from("classes").select("id,label").in("id", classIds.length ? classIds : ["00000000-0000-0000-0000-000000000000"]);
  const className = new Map<string, string>((classes || []).map((c: any) => [String(c.id), String(c.label ?? "")]));

  const subjIds = Array.from(new Set(useful.map((r: any) => String(r.session?.subject_id)).filter(Boolean)));
  const subjName = await resolveSubjectNames(srv, subjIds);

  const items = useful
    .map((r: any) => {
      const s = r.session || {};
      const started = String(s.started_at || new Date().toISOString());
      const type = r.status === "absent" ? "absent" : "late";
      return {
        id: String(r.id),
        when: started,
        expected_minutes: Number(s.expected_minutes ?? 60) || 60,
        type,
        minutes_late: type === "late" ? Number(r.minutes_late || 0) : null,
        class_label: s.class_id ? (className.get(String(s.class_id)) || null) : null,
        subject_name: s.subject_id ? (subjName.get(String(s.subject_id)) || null) : null,
      };
    })
    .sort((a, b) => b.when.localeCompare(a.when));

  return NextResponse.json({ items });
}
