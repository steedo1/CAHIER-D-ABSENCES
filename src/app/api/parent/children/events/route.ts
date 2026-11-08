import { parentConnectDenial } from "@/lib/parent-connect/server";
// src/app/api/parent/children/events/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toArray<T = any>(res: any): T[] { return Array.isArray(res?.data) ? (res.data as T[]) : []; }

async function resolveSubjectNames(srv: ReturnType<typeof getSupabaseServiceClient>, ids: string[]) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, string>();
  if (!uniq.length) return map;

  const instRes = await srv
    .from("institution_subjects")
    .select("id, subject_id, custom_name, subjects:subject_id(name)")
    .in("id", uniq);
  const inst = toArray(instRes);
  for (const r of inst) {
    const id = String((r as any).id);
    const nm = (r as any).custom_name || (r as any).subjects?.name || null;
    if (nm) map.set(id, nm);
    const baseId = (r as any).subject_id as string | null;
    if (baseId && nm && !map.has(baseId)) map.set(baseId, nm);
  }

  const missing = uniq.filter((x) => !map.has(x));
  if (missing.length) {
    const subsRes = await srv.from("subjects").select("id,name").in("id", missing);
    const subs = toArray(subsRes);
    for (const s of subs) map.set(String((s as any).id), String((s as any).name ?? "(inconnu)"));
  }
  return map;
}

type TimelineItem = {
  id: string;
  when: string;
  class_label: string | null;
  subject_name: string | null;
  expected_minutes?: number | null;
  type: "absent" | "late";
  minutes_late?: number | null;
};

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const url = new URL(req.url);
  const qStudent = url.searchParams.get("student_id") || "";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 30)));
  const days  = Math.max(1, Math.min(180, parseInt(url.searchParams.get("days") || "45", 10)));

  if (!qStudent) return NextResponse.json({ items: [], error: "student_id required" }, { status: 400 });

  // ────────── MODE 1 : Appareil parent (cookie) ──────────
  const jar = await cookies();
  const deviceId = jar.get("parent_device")?.value || "";
  let student_id = qStudent;
  let allow = false;
  let institution_id: string | null = null;

  if (deviceId) {
    // Autoriser seulement si l’élève est lié à cet appareil
    const { data: link } = await srv
      .from("parent_device_children")
      .select("student_id")
      .eq("device_id", deviceId)
      .eq("student_id", student_id)
      .limit(1);

    allow = !!(link && link.length);

    if (allow) {
      // Institution = inscription active sinon la plus récente
      const enrActiveRes = await srv
        .from("class_enrollments")
        .select("institution_id")
        .eq("student_id", student_id)
        .is("end_date", null)
        .limit(1);
      const enrActive = toArray(enrActiveRes);
      institution_id = (enrActive[0]?.institution_id as string | undefined) ?? null;

      if (!institution_id) {
        const anyEnrRes = await srv
          .from("class_enrollments")
          .select("institution_id, start_date")
          .eq("student_id", student_id)
          .order("start_date", { ascending: false })
          .limit(1);
        const anyEnr = toArray(anyEnrRes);
        institution_id = (anyEnr[0]?.institution_id as string | undefined) ?? null;
      }
      if (!institution_id) return NextResponse.json({ items: [] }, { status: 404 });
    }
  }

  // ────────── MODE 2 : Guardian supabase (fallback) ──────────
  if (!allow && !deviceId) {
    const { data: { user } } = await supa.auth.getUser().catch(() => ({ data: { user: null } } as any));
    if (!user) return NextResponse.json({ items: [] }, { status: 401 });

    const okRes = await srv
      .from("student_guardians")
      .select("institution_id")
      .eq("student_id", qStudent)
      .or(`guardian_profile_id.eq.${user.id},parent_id.eq.${user.id}`)
      .limit(1)
      .maybeSingle();

    const ok = (okRes as any)?.data;
    if (!ok) return NextResponse.json({ items: [] }, { status: 403 });

    student_id = qStudent;
    institution_id = (ok as any).institution_id ?? null;
  }

  if (!institution_id) return NextResponse.json({ items: [] }, { status: 403 });

    const subscriptionDenied = await parentConnectDenial(srv, student_id);
    if (subscriptionDenied) return subscriptionDenied;

  // Fenêtre
  const fromISO = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  // The embedded relation must use an INNER join: otherwise PostgREST can
  // return a mark with session=null when the date filter rejects its session.
  const { data, error: marksError } = await srv
    .from("attendance_marks")
    .select(`
      id,
      status,
      minutes_late,
      session:session_id!inner (
        started_at,
        expected_minutes,
        class_id,
        subject_id,
        institution_id
      )
    `)
    .eq("student_id", student_id)
    .in("status", ["absent", "late"])
    .gte("session.started_at", fromISO)
    .order("created_at", { ascending: false })
    .limit(400);

  if (marksError) {
    console.error("[parent.children.events] attendance query failed", marksError);
    return NextResponse.json({ items: [], error: marksError.message }, { status: 400 });
  }

  // Never invent the current time for an old or unlinked attendance mark.
  const minTime = Date.parse(fromISO);
  const useful = (data || []).filter((row: any) => {
    const sessionTime = row?.session?.started_at ? Date.parse(String(row.session.started_at)) : NaN;
    return (row.status === "absent" || row.status === "late") &&
      Number.isFinite(sessionTime) && sessionTime >= minTime;
  });

  const classIds = Array.from(new Set(useful.map((r: any) => String(r.session?.class_id || "")).filter(Boolean)));
  const className = new Map<string, string>();
  if (classIds.length) {
    const { data: classes } = await srv
      .from("classes")
      .select("id,label")
      .in("id", classIds);
    for (const cls of classes || []) className.set(String(cls.id), String(cls.label ?? ""));
  }

  const subjIds = Array.from(new Set(useful.map((r: any) => String(r.session?.subject_id || "")).filter(Boolean)));
  const subjName = await resolveSubjectNames(srv, subjIds);

  // Sanctions have their own endpoint and screen. Never label them "Retard".
  const items: TimelineItem[] = useful.map((r: any) => {
    const s = r.session;
    const type: "absent" | "late" = r.status === "absent" ? "absent" : "late";
    return {
      id: String(r.id),
      when: String(s.started_at),
      expected_minutes: typeof s.expected_minutes === "number" ? Number(s.expected_minutes) : null,
      type,
      minutes_late: type === "late" ? Number(r.minutes_late || 0) : null,
      class_label: s.class_id ? (className.get(String(s.class_id)) || null) : null,
      subject_name: s.subject_id ? (subjName.get(String(s.subject_id)) || null) : null,
    };
  });

  items.sort((a, b) => b.when.localeCompare(a.when));
  return NextResponse.json({ items: items.slice(0, limit) });
}
