// src/app/api/parent/children/events/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { readParentSessionFromReq } from "@/lib/parent-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Utilitaire : extrait toujours un tableau depuis une réponse Supabase */
function toArray<T = any>(res: any): T[] {
  return Array.isArray(res?.data) ? (res.data as T[]) : [];
}

/** Résout un tableau d'IDs de matière (subjects.id OU institution_subjects.id) → libellés */
async function resolveSubjectNames(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  ids: string[]
) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, string>();
  if (!uniq.length) return map;

  // institution_subjects
  const instRes = await srv
    .from("institution_subjects")
    .select("id, subject_id, custom_name, subjects:subject_id(name)")
    .in("id", uniq);
  const inst = toArray(instRes);
  for (const r of inst) {
    const id = String((r as any).id);
    const nm =
      (r as any).custom_name ||
      (r as any).subjects?.name ||
      null;
    if (nm) map.set(id, nm);
    const baseId = (r as any).subject_id as string | null;
    if (baseId && nm && !map.has(baseId)) map.set(baseId, nm);
  }

  // subjects (fallback pour les ids encore manquants)
  const missingBase = uniq.filter((x) => !map.has(x));
  if (missingBase.length) {
    const subsRes = await srv
      .from("subjects")
      .select("id,name")
      .in("id", missingBase);
    const subs = toArray(subsRes);
    for (const s of subs)
      map.set(String((s as any).id), String((s as any).name ?? "(inconnu)"));
  }
  return map;
}

type TimelineItem = {
  id: string;
  when: string;
  class_label: string | null;
  subject_name: string | null;
  expected_minutes?: number | null;
  type: "absent" | "late" | "penalty";
  minutes_late?: number | null;

  // Champs spécifiques sanctions (ignorés par l'UI actuelle si non utilisés)
  rubric?: "discipline" | "tenue" | "moralite";
  points?: number | null;
  reason?: string | null;
  author_name?: string | null;
  author_role_label?: string | null;
  author_subject_name?: string | null;
};

export async function GET(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const { data: { user } } =
    (await supa.auth.getUser().catch(() => ({ data: { user: null } } as any))) as any;

  const url = new URL(req.url);
  const qStudent = url.searchParams.get("student_id") || "";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 30)));
  const days = Math.max(1, Math.min(180, parseInt(url.searchParams.get("days") || "45", 10)));

  let student_id = qStudent;
  let institution_id: string | null = null;

  if (user) {
    // Parent connecté (guardian profil) → vérifier le lien tuteur-élève
    if (!student_id) return NextResponse.json({ items: [] }, { status: 400 });

    const linkRes = await srv
      .from("student_guardians")
      .select("institution_id")
      .eq("student_id", student_id)
      .or(`guardian_profile_id.eq.${user.id},parent_id.eq.${user.id}`)
      .limit(1)
      .maybeSingle();

    const link = (linkRes as any)?.data;
    if (!link) return NextResponse.json({ items: [] }, { status: 403 });
    institution_id = (link as any).institution_id ?? null;
  } else {
    // Mode cookie (connexion par matricule)
    const claims = readParentSessionFromReq(req);
    if (!claims) return NextResponse.json({ items: [] }, { status: 401 });
    if (student_id && student_id !== claims.sid)
      return NextResponse.json({ items: [] }, { status: 403 });
    student_id = claims.sid;

    // Trouver institution (inscription active sinon la plus récente)
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

  // Fenêtre temporelle
  const now = new Date();
  const fromISO = new Date(now.getTime() - days * 24 * 3600 * 1000).toISOString();

  /** ───────────────── Absences/retards (attendance_marks + sessions) ───────────────── */
  const marksRes = await srv
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
    .gte("session.started_at", fromISO);
  const marks = toArray(marksRes).filter(
    (r: any) => r?.status === "absent" || r?.status === "late"
  );

  /** ───────────────── Sanctions récentes (conduct_penalties) ───────────────── */
  const penRes = await srv
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
    .gte("occurred_at", fromISO)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  const penalties = toArray(penRes);

  /** ───────────────── Libellés classes/matières/auteurs ───────────────── */
  const classIds = Array.from(
    new Set([
      ...marks.map((r: any) => String(r?.session?.class_id || "")),
      ...penalties.map((p: any) => String(p?.class_id || "")),
    ].filter(Boolean))
  );
  const subjIds = Array.from(
    new Set([
      ...marks.map((r: any) => String(r?.session?.subject_id || "")),
      ...penalties.map((p: any) => String(p?.subject_id || "")),
    ].filter(Boolean))
  );
  const authorIds = Array.from(
    new Set(penalties.map((p: any) => String(p?.author_profile_id || "")).filter(Boolean))
  );

  const classesRes = await srv
    .from("classes")
    .select("id,label")
    .in("id", classIds.length ? classIds : ["00000000-0000-0000-0000-000000000000"]);
  const classesArr = toArray<{ id: string; label: string | null }>(classesRes);
  const className = new Map<string, string>(
    classesArr.map((c) => [String(c.id), String(c.label ?? "")])
  );

  const subjName = await resolveSubjectNames(srv, subjIds);

  let authorMap = new Map<string, { name: string | null }>();
  if (authorIds.length) {
    const auRes = await srv
      .from("profiles")
      .select("id,display_name")
      .in("id", authorIds);
    const auArr = toArray<{ id: string; display_name: string | null }>(auRes);
    authorMap = new Map(
      auArr.map((p) => [String(p.id), { name: (p.display_name as string | null) ?? null }])
    );
  }

  /** ───────────────── Mapping en items ───────────────── */
  const markItems: TimelineItem[] = marks.map((r: any) => {
    const s = r.session || {};
    const started = String(s.started_at || new Date().toISOString());
    const type: "absent" | "late" = r.status === "absent" ? "absent" : "late";
    return {
      id: String(r.id),
      when: started,
      expected_minutes:
        typeof s.expected_minutes === "number" ? Number(s.expected_minutes) : null,
      type,
      minutes_late: type === "late" ? Number(r.minutes_late || 0) : null,
      class_label: s.class_id ? (className.get(String(s.class_id)) || null) : null,
      subject_name: s.subject_id ? (subjName.get(String(s.subject_id)) || null) : null,
    };
  });

  const penItems: TimelineItem[] = penalties.map((p: any) => {
    const a = authorMap.get(String(p.author_profile_id));
    const penaltySubjectName = p.subject_id
      ? (subjName.get(String(p.subject_id)) || null)
      : null;
    const authorSubjectName =
      (p.author_subject_name as string | null) || penaltySubjectName || null;

    const author_role_label: string | null =
      (p.author_role_label as string | null) ??
      (authorSubjectName ? "Enseignant" : "Administration");

    return {
      id: String(p.id),
      when: String(p.occurred_at),
      type: "penalty",
      class_label: p.class_id ? (className.get(String(p.class_id)) || null) : null,
      subject_name: penaltySubjectName,

      rubric: p.rubric as "discipline" | "tenue" | "moralite",
      points: Number(p.points || 0),
      reason: (p.reason as string | null) ?? null,
      author_name: a?.name ?? null,
      author_subject_name: authorSubjectName,
      author_role_label,
    };
  });

  const items = [...markItems, ...penItems]
    .sort((a, b) => b.when.localeCompare(a.when))
    .slice(0, limit);

  return NextResponse.json({ items });
}
