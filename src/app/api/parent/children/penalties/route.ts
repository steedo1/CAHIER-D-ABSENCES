// src/app/api/parent/children/penalties/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { readParentSessionFromReq } from "@/lib/parent-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── helpers ───────────────── */
const rid = () => Math.random().toString(36).slice(2, 8);

async function buildSubjectNameMap(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  ids: string[]
) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const out = new Map<string, string>();
  if (!uniq.length) return out;

  // 1) Essayer via institution_subjects (id spécifique à l’établissement)
  const { data: insRows, error: insErr } = await srv
    .from("institution_subjects")
    .select("id, custom_name, subject_id")
    .in("id", uniq);

  if (insErr) console.error("[penalties] institution_subjects error:", insErr);
  for (const r of insRows || []) {
    if ((r as any).custom_name) out.set(String((r as any).id), String((r as any).custom_name));
  }

  // 2) Compléter avec subjects (id générique national)
  const stillMissing = uniq.filter((k) => !out.has(k));
  if (stillMissing.length) {
    const { data: subs, error: subErr } = await srv
      .from("subjects")
      .select("id, name, code, subject_key")
      .in("id", stillMissing);
    if (subErr) console.error("[penalties] subjects error:", subErr);

    for (const s of subs || []) {
      const nm =
        (s as any).name ||
        (s as any).code ||
        (s as any).subject_key ||
        null;
      if (nm) out.set(String((s as any).id), String(nm));
    }
  }
  return out;
}

/* ───────────────── handler ───────────────── */
export async function GET(req: NextRequest) {
  const trace = rid();
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  try {
    const url = new URL(req.url);
    const qStudent = url.searchParams.get("student_id") || "";
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";

    let student_id = qStudent;

    // A) Parent connecté (compte guardian)
    const { data: { user } } = await supa.auth.getUser().catch(() => ({ data: { user: null } } as any));
    if (user) {
      if (!student_id) {
        console.warn(`[penalties:${trace}] guardian mode without student_id`);
        return NextResponse.json({ items: [] });
      }
      const { data: link, error: gErr } = await srv
        .from("student_guardians")
        .select("id")
        .eq("student_id", student_id)
        .or(`guardian_profile_id.eq.${user.id},parent_id.eq.${user.id}`)
        .limit(1)
        .maybeSingle();

      if (gErr) {
        console.error(`[penalties:${trace}] guardians query error`, gErr);
        return NextResponse.json({ error: gErr.message }, { status: 400 });
      }
      if (!link) {
        console.warn(`[penalties:${trace}] forbidden guardian/student link`, { user_id: user.id, student_id });
        return NextResponse.json({ items: [] }, { status: 403 });
      }
    } else {
      // B) Appareil parent (cookie/JWT maison)
      const claims = readParentSessionFromReq(req);
      if (!claims) {
        console.warn(`[penalties:${trace}] unauthorized (no parent session)`);
        return NextResponse.json({ items: [] }, { status: 401 });
      }
      if (student_id && student_id !== claims.sid) {
        console.warn(`[penalties:${trace}] forbidden: sid mismatch`, { q: student_id, sid: claims.sid });
        return NextResponse.json({ items: [] }, { status: 403 });
      }
      student_id = claims.sid;
    }

    // 1) Pénalités (tri décroissant)
    let pq = srv
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
      .eq("student_id", student_id)
      .order("occurred_at", { ascending: false })
      .limit(limit);

    if (from) pq = pq.gte("occurred_at", from);
    if (to) pq = pq.lte("occurred_at", to);

    const { data: rows, error: pErr } = await pq;
    if (pErr) {
      console.error(`[penalties:${trace}] penalties error`, pErr);
      return NextResponse.json({ error: pErr.message }, { status: 400 });
    }
    if (!rows?.length) {
      console.info(`[penalties:${trace}] no penalties`, { student_id });
      return NextResponse.json({ items: [] });
    }

    // 2) Maps classes / auteurs / matières
    const classIds = Array.from(new Set(rows.map((r: any) => r.class_id).filter(Boolean))) as string[];
    const subjIds = Array.from(new Set(rows.map((r: any) => r.subject_id).filter(Boolean))) as string[];
    const authorIds = Array.from(new Set(rows.map((r: any) => r.author_profile_id).filter(Boolean))) as string[];

    const [clRes, auRes] = await Promise.all([
      classIds.length
        ? srv.from("classes").select("id,label").in("id", classIds)
        : Promise.resolve({ data: [] as any[] }),
      authorIds.length
        ? srv.from("profiles").select("id,display_name").in("id", authorIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const classMap = new Map((clRes.data || []).map((c: any) => [String(c.id), String(c.label ?? "")]));
    const authorMap = new Map(
      (auRes.data || []).map((p: any) => [String(p.id), { name: (p.display_name as string | null) ?? null }])
    );

    const penaltySubjectNameMap = await buildSubjectNameMap(srv, subjIds);

    // 3) Fallback matière via class_teachers (si pas d’info côté pénalité)
    const needFallback = rows.some(
      (r: any) => !r.author_subject_name && !r.subject_id && r.class_id && r.author_profile_id
    );

    let fallbackCT = new Map<string, string>(); // `${class_id}|${teacher_id}` -> subject_name
    if (needFallback && classIds.length && authorIds.length) {
      const nowIso = new Date().toISOString();
      const { data: cts, error: ctErr } = await srv
        .from("class_teachers")
        .select("class_id, teacher_id, subject_id")
        .in("class_id", classIds)
        .in("teacher_id", authorIds)
        .lte("start_date", nowIso)
        .or(`end_date.is.null,end_date.gte.${nowIso}`);

      if (ctErr) console.error(`[penalties:${trace}] class_teachers error`, ctErr);

      const ctSubjectIds = Array.from(
        new Set((cts || []).map((r: any) => r.subject_id).filter(Boolean))
      ) as string[];
      const ctSubjectNameMap = await buildSubjectNameMap(srv, ctSubjectIds);

      for (const r of cts || []) {
        const key = `${r.class_id}|${r.teacher_id}`;
        const nm = r.subject_id ? (ctSubjectNameMap.get(String(r.subject_id)) || null) : null;
        if (nm) fallbackCT.set(key, nm);
      }
    }

    // 4) Projection
    const items = (rows || []).map((r: any) => {
      const a = authorMap.get(String(r.author_profile_id));
      const penaltySubjectName = r.subject_id
        ? (penaltySubjectNameMap.get(String(r.subject_id)) || null)
        : null;

      let authorSubjectName = r.author_subject_name || penaltySubjectName;
      if (!authorSubjectName && r.class_id && r.author_profile_id) {
        const key = `${r.class_id}|${r.author_profile_id}`;
        authorSubjectName = fallbackCT.get(key) || null;
      }

      const author_role_label =
        r.author_role_label ??
        ((authorSubjectName || penaltySubjectName) ? "Enseignant" : "Administration");

      return {
        id: r.id,
        when: r.occurred_at,
        rubric: r.rubric as "discipline" | "tenue" | "moralite",
        points: Number(r.points || 0),
        reason: r.reason || null,
        class_label: classMap.get(String(r.class_id)) || null,
        subject_name: penaltySubjectName,
        author_subject_name: authorSubjectName,
        author_name: a?.name || null,
        author_role_label,
      };
    });

    console.info(`[penalties:${trace}] ok`, { student_id, count: items.length });
    return NextResponse.json({ items });
  } catch (e: any) {
    console.error(`[penalties:${trace}] fatal`, e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
