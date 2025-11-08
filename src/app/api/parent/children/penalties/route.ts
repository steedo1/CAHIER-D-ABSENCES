// src/app/api/parent/children/penalties/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function buildSubjectNameMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  ids: string[]
) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const out = new Map<string, string>();
  if (!uniq.length) return out;

  const { data: insRows } = await srv
    .from("institution_subjects")
    .select("id, custom_name, subject_id")
    .in("id", uniq);
  for (const r of insRows || []) if ((r as any).custom_name) out.set(String((r as any).id), String((r as any).custom_name));

  const still = uniq.filter(k => !out.has(k));
  if (still.length) {
    const { data: subs } = await srv
      .from("subjects")
      .select("id, name, code, subject_key")
      .in("id", still);
    for (const s of subs || []) {
      const nm = (s as any).name || (s as any).code || (s as any).subject_key || null;
      if (nm) out.set(String((s as any).id), String(nm));
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  try {
    const url = new URL(req.url);
    const qStudent = url.searchParams.get("student_id") || "";
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    const from  = url.searchParams.get("from") || "";
    const to    = url.searchParams.get("to")   || "";

    if (!qStudent) return NextResponse.json({ items: [] });

    // ── Cookie d’abord
    const jar = await cookies();
    const deviceId = jar.get("parent_device")?.value || "";
    let allowed = false;
    if (deviceId) {
      const { data: link } = await srv
        .from("parent_device_children")
        .select("student_id")
        .eq("device_id", deviceId)
        .eq("student_id", qStudent)
        .limit(1);
      allowed = !!(link && link.length);
    }

    // ── Fallback guardian
    if (!allowed && !deviceId) {
      const { data: { user } } = await supa.auth.getUser().catch(() => ({ data: { user: null } } as any));
      if (!user) return NextResponse.json({ items: [] }, { status: 401 });

      const { data: link } = await srv
        .from("student_guardians")
        .select("id")
        .eq("student_id", qStudent)
        .or(`guardian_profile_id.eq.${user.id},parent_id.eq.${user.id}`)
        .limit(1);
      if (!link || !link.length) return NextResponse.json({ items: [] }, { status: 403 });
    }

    // ── Pénalités
    let q = srv
      .from("conduct_penalties")
      .select(`
        id,
        occurred_at,
        rubric,
        points,
        reason,
        class_id,
        subject_id,
        author_profile_id,
        author_role_label,
        author_subject_name
      `)
      .eq("student_id", qStudent)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (from) q = q.gte("occurred_at", from);
    if (to)   q = q.lte("occurred_at", to);

    const { data: rows, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!rows?.length) return NextResponse.json({ items: [] });

    const classIds  = Array.from(new Set(rows.map((r: any) => r.class_id).filter(Boolean)));
    const subjIds   = Array.from(new Set(rows.map((r: any) => r.subject_id).filter(Boolean)));
    const authorIds = Array.from(new Set(rows.map((r: any) => r.author_profile_id).filter(Boolean)));

    const [clRes, auRes] = await Promise.all([
      classIds.length ? srv.from("classes").select("id,label").in("id", classIds) : Promise.resolve({ data: [] as any[] }),
      authorIds.length ? srv.from("profiles").select("id,display_name").in("id", authorIds) : Promise.resolve({ data: [] as any[] }),
    ]);

    const classMap  = new Map((clRes.data || []).map((c: any) => [String(c.id), String(c.label ?? "")]));
    const authorMap = new Map((auRes.data || []).map((p: any) => [String(p.id), { name: (p.display_name as string | null) ?? null }]));
    const penaltySubjectNameMap = await buildSubjectNameMap(srv, subjIds);

    // Fallback matière via class_teachers si besoin
    const needFallback = rows.some((r: any) => !r.author_subject_name && !r.subject_id && r.class_id && r.author_profile_id);
    let fallbackCT = new Map<string, string>();
    if (needFallback && classIds.length && authorIds.length) {
      const nowIso = new Date().toISOString();
      const { data: cts } = await srv
        .from("class_teachers")
        .select("class_id, teacher_id, subject_id")
        .in("class_id", classIds)
        .in("teacher_id", authorIds)
        .lte("start_date", nowIso)
        .or(`end_date.is.null,end_date.gte.${nowIso}`);

      const ctSubjectIds = Array.from(new Set((cts || []).map((r: any) => r.subject_id).filter(Boolean)));
      const ctNames = await buildSubjectNameMap(srv, ctSubjectIds);
      for (const r of cts || []) {
        const key = `${r.class_id}|${r.teacher_id}`;
        const nm = r.subject_id ? (ctNames.get(String(r.subject_id)) || null) : null;
        if (nm) fallbackCT.set(key, nm);
      }
    }

    const items = (rows || []).map((r: any) => {
      const a = authorMap.get(String(r.author_profile_id));
      const penaltySubjectName = r.subject_id ? (penaltySubjectNameMap.get(String(r.subject_id)) || null) : null;
      let authorSubjectName = r.author_subject_name || penaltySubjectName;
      if (!authorSubjectName && r.class_id && r.author_profile_id) {
        const key = `${r.class_id}|${r.author_profile_id}`;
        authorSubjectName = fallbackCT.get(key) || null;
      }
      const author_role_label =
        r.author_role_label ?? ((authorSubjectName || penaltySubjectName) ? "Enseignant" : "Administration");

      return {
        id: String(r.id),
        when: String(r.occurred_at),
        rubric: r.rubric as "discipline" | "tenue" | "moralite",
        points: Number(r.points || 0),
        reason: (r.reason as string | null) ?? null,
        class_label: r.class_id ? (classMap.get(String(r.class_id)) || null) : null,
        subject_name: penaltySubjectName,
        author_subject_name: authorSubjectName,
        author_name: a?.name || null,
        author_role_label,
      };
    });

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "penalties_fetch_failed" }, { status: 400 });
  }
}
