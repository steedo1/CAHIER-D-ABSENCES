// src/app/api/teacher/penalties/bulk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { triggerPushDispatch } from "@/lib/push-dispatch"; // ✅ déclencheur temps réel (fire-and-forget)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  class_id: string;
  subject_id?: string | null; // peut être subjects.id OU institution_subjects.id
  rubric: string;             // 'discipline' | 'tenue' | 'moralite'
  items: Array<{ student_id: string; points: number; reason?: string | null }>;
};

const ALLOWED_RUBRICS = new Set(["discipline", "tenue", "moralite"]);
const RUBRIC_MAX: Record<"discipline" | "tenue" | "moralite", number> = {
  discipline: 7,
  tenue: 3,
  moralite: 4,
};

function coerceRubric(x: unknown): "discipline" | "tenue" | "moralite" {
  let s = String(x ?? "").normalize("NFKC").trim().toLowerCase();
  if (s.includes("moralit")) s = "moralite";
  else if (s.includes("tenue")) s = "tenue";
  else if (!ALLOWED_RUBRICS.has(s)) s = "discipline";
  return s as any;
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Résout un identifiant “souple” vers l’ID canonique subjects.id
 * - Cas 1: maybeId est déjà un subjects.id -> {canonicalId=subjects.id, displayName}
 * - Cas 2: maybeId est un institution_subjects.id -> {canonicalId=subject_id, displayName=custom_name || subjects.name}
 * - Cas 3: rien trouvé -> {null, null}
 */
async function resolveCanonicalSubject(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  maybeId: string | null
): Promise<{ canonicalId: string | null; displayName: string | null; origin: "subjects" | "institution_subjects" | "none" }> {
  if (!maybeId) return { canonicalId: null, displayName: null, origin: "none" };

  // Essai direct sur subjects
  const { data: subj, error: subjErr } = await srv
    .from("subjects")
    .select("id,name,code,subject_key")
    .eq("id", maybeId)
    .maybeSingle();
  if (subjErr) console.warn("[teacher.penalties.bulk] resolveCanonicalSubject subjects error", subjErr);
  if (subj?.id) {
    const nm = subj.name || subj.code || subj.subject_key || null;
    return { canonicalId: subj.id, displayName: nm, origin: "subjects" };
  }

  // Essai sur institution_subjects → canonical = subject_id
  const { data: inst, error: instErr } = await srv
    .from("institution_subjects")
    .select("id, custom_name, subject_id")
    .eq("id", maybeId)
    .maybeSingle();
  if (instErr) console.warn("[teacher.penalties.bulk] resolveCanonicalSubject inst error", instErr);

  if (inst?.id) {
    let nm: string | null = inst.custom_name || null;
    let canonicalId: string | null = inst.subject_id ?? null;

    if (!nm || !canonicalId) {
      const { data: base, error: baseErr } = await srv
        .from("subjects")
        .select("id,name,code,subject_key")
        .eq("id", inst.subject_id)
        .maybeSingle();
      if (baseErr) console.warn("[teacher.penalties.bulk] resolveCanonicalSubject base subject error", baseErr);
      canonicalId = base?.id ?? canonicalId;
      if (!nm) nm = base?.name || base?.code || base?.subject_key || null;
    }
    return { canonicalId, displayName: nm, origin: "institution_subjects" };
  }

  return { canonicalId: null, displayName: null, origin: "none" };
}

/** Fallback: récupérer la matière active via class_teachers (id peut être subjects.id OU institution_subjects.id) */
async function fallbackCanonicalFromClassTeacher(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  class_id: string,
  teacher_profile_id: string
): Promise<{ canonicalId: string | null; displayName: string | null; origin: "subjects" | "institution_subjects" | "none" }> {
  const nowIso = new Date().toISOString();
  const { data: ct, error: ctErr } = await srv
    .from("class_teachers")
    .select("subject_id")
    .eq("class_id", class_id)
    .eq("teacher_id", teacher_profile_id)
    .lte("start_date", nowIso)
    .or(`end_date.is.null,end_date.gt.${nowIso}`)
    .limit(1)
    .maybeSingle();
  if (ctErr) {
    console.warn("[teacher.penalties.bulk] fallback class_teachers error", ctErr);
    return { canonicalId: null, displayName: null, origin: "none" };
  }
  if (!ct?.subject_id) return { canonicalId: null, displayName: null, origin: "none" };
  return resolveCanonicalSubject(srv, String(ct.subject_id));
}

export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient(); // RLS
  const srv  = getSupabaseServiceClient();      // service

  try {
    const { data: { user } } = await supa.auth.getUser();
    if (!user) {
      console.warn("[teacher.penalties.bulk] unauthorized");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch (e) {
      console.error("[teacher.penalties.bulk] invalid_json", e);
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const class_id = String(body?.class_id || "").trim();
    const requested_subject_id = (body?.subject_id ? String(body.subject_id) : null) || null;
    const rubric = coerceRubric(body?.rubric);
    const rawItems = Array.isArray(body?.items) ? body.items : [];

    console.log("[teacher.penalties.bulk] payload", {
      class_id,
      requested_subject_id,
      rubric,
      raw_count: rawItems.length,
      user_id: user.id,
    });

    const items = rawItems
      .map((it) => ({
        student_id: String(it?.student_id || "").trim(),
        points: clamp(Math.floor(Number(it?.points || 0)), 0, RUBRIC_MAX[rubric]),
        reason: (it?.reason ?? null) ? String(it.reason).trim() : null,
      }))
      .filter((it) => it.student_id && it.points > 0);

    if (!class_id) {
      console.warn("[teacher.penalties.bulk] missing_class_id");
      return NextResponse.json({ error: "missing_class_id" }, { status: 400 });
    }
    if (items.length === 0) {
      console.log("[teacher.penalties.bulk] no positive items to insert", { dropped: rawItems.length });
      return NextResponse.json({ ok: true, inserted: 0, dropped: rawItems.length }, { status: 200 });
    }

    // Classe -> institution
    const { data: klass, error: kErr } = await srv
      .from("classes")
      .select("id,institution_id,label")
      .eq("id", class_id)
      .maybeSingle();
    if (kErr || !klass?.institution_id) {
      console.error("[teacher.penalties.bulk] classes lookup failed", { kErr, klass });
      return NextResponse.json({ error: "class_or_institution_missing" }, { status: 400 });
    }
    const institution_id = String(klass.institution_id);
    console.log("[teacher.penalties.bulk] class_ok", { institution_id, class_label: klass.label });

    // Auteur (profile = même id que user dans ton schéma)
    const { data: prof, error: profErr } = await srv
      .from("profiles")
      .select("id, display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profErr) console.warn("[teacher.penalties.bulk] profiles lookup warn", profErr);

    const author_id = user.id;
    const author_profile_id = prof?.id ?? user.id;
    const author_display_name = prof?.display_name ?? null;

    // Résolution canonique de la matière demandée
    const resolved = await resolveCanonicalSubject(srv, requested_subject_id);
    let subject_id: string | null = resolved.canonicalId;      // ✅ toujours subjects.id si trouvé
    let author_subject_name: string | null = resolved.displayName;

    // Fallback via class_teachers si rien
    if (!subject_id) {
      const fb = await fallbackCanonicalFromClassTeacher(srv, class_id, author_profile_id);
      if (fb.canonicalId) subject_id = fb.canonicalId;
      if (fb.displayName) author_subject_name = fb.displayName || author_subject_name;
      console.log("[teacher.penalties.bulk] subject fallback", fb);
    }

    // Libellé de rôle (juste pour le front)
    const author_role_label = (subject_id || author_subject_name) ? "Enseignant" : "Administration";
    console.log("[teacher.penalties.bulk] author labels", {
      author_role_label,
      author_profile_id,
      author_display_name,
      subject_id,                  // 👈 DOIT être rempli si resolve OK
      author_subject_name,
    });

    // INSERT
    const nowIso = new Date().toISOString();
    const rows = items.map((v) => ({
      institution_id,
      class_id,
      subject_id,                // ✅ CANONIQUE (subjects.id) ou NULL si introuvable
      student_id: v.student_id,
      rubric,
      points: v.points,
      reason: v.reason,
      author_id,
      author_profile_id,
      author_role_label,
      author_subject_name,
      occurred_at: nowIso,
      created_at: nowIso,
    }));

    console.log("[teacher.penalties.bulk] insert attempt", {
      row_count: rows.length,
      sample: rows[0] ? {
        class_id: rows[0].class_id,
        student_id: rows[0].student_id,
        rubric: rows[0].rubric,
        points: rows[0].points,
        subject_id: rows[0].subject_id,
      } : null,
    });

    const { data: inserted, error: insErr } = await srv
      .from("conduct_penalties")
      .insert(rows)
      .select("id");

    if (insErr) {
      console.error("[teacher.penalties.bulk] insert error", insErr);
      if ((insErr as any)?.message?.toString?.().includes("s.full_name")) {
        console.error("[teacher.penalties.bulk] HINT: trigger/function in DB uses alias 's' without FROM");
      }
      return NextResponse.json(
        { ok: false, inserted: 0, error: insErr.message, code: (insErr as any)?.code ?? null },
        { status: 400 }
      );
    }

    const count = inserted?.length || 0;
    console.log("[teacher.penalties.bulk] inserted_ok", { count });

    // ✅ temps réel — déclenche immédiatement si on a inséré des sanctions
    if (count > 0) {
      void triggerPushDispatch({ req, reason: "teacher_penalties_bulk" });
    }

    return NextResponse.json({ ok: true, inserted: count }, { status: 200 });
  } catch (e: any) {
    console.error("[teacher.penalties.bulk] fatal", e);
    return NextResponse.json({ ok: false, error: e?.message || "penalties_failed" }, { status: 500 });
  }
}
