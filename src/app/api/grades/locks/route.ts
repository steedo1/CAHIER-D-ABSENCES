// src/app/api/grades/locks/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

async function getContext() {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) return { supa, user: null as any, profile: null as any, srv: null as any };

  const { data: profile, error } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile?.institution_id) return { supa, user, profile: null as any, srv: null as any };

  const srv = getSupabaseServiceClient();
  return { supa, user, profile, srv };
}

async function ensureClassAccess(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classId: string,
  institutionId: string,
): Promise<boolean> {
  const { data: cls, error } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", classId)
    .maybeSingle();
  if (error) return false;
  return !!cls && cls.institution_id === institutionId;
}

function hashPin(pin: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pin, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPin(pin: string, stored: string) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(pin, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== computed.length) return false;
  return crypto.timingSafeEqual(expected, computed);
}

function normalizePin(pin: any) {
  const s = String(pin ?? "").trim();
  // PIN simple (4 à 8 chiffres)
  if (!/^\d{4,8}$/.test(s)) return null;
  return s;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const evaluation_id = String(url.searchParams.get("evaluation_id") || "").trim();
  if (!evaluation_id) return NextResponse.json({ ok: true, locked: false });

  const { user, profile, srv } = await getContext();
  if (!user || !profile || !srv) return NextResponse.json({ ok: true, locked: false }, { status: 401 });

  // Vérifier accès à la classe via l'évaluation
  const { data: ev, error: evErr } = await srv
    .from("grade_evaluations")
    .select("id,class_id")
    .eq("id", evaluation_id)
    .maybeSingle();

  if (evErr || !ev) return NextResponse.json({ ok: true, locked: false }, { status: 200 });

  const allowed = await ensureClassAccess(srv, ev.class_id, profile.institution_id);
  if (!allowed) return NextResponse.json({ ok: true, locked: false }, { status: 200 });

  const { data: lockRow, error: lockErr } = await srv
    .from("grade_evaluation_locks")
    .select("is_locked, locked_at, teacher_id")
    .eq("evaluation_id", evaluation_id)
    .maybeSingle();

  if (lockErr) {
    const msg = String(lockErr.message || "");
    const missingTable =
      msg.includes('relation "grade_evaluation_locks" does not exist') || msg.includes("42P01");
    if (missingTable) return NextResponse.json({ ok: true, locked: false, enabled: false });
    return bad("LOCK_READ_FAILED", 500);
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    locked: !!lockRow?.is_locked,
    locked_at: lockRow?.locked_at ?? null,
    teacher_id: lockRow?.teacher_id ?? null,
  });
}

export async function POST(req: NextRequest) {
  const { user, profile, srv } = await getContext();
  if (!user || !profile || !srv) return bad("UNAUTHENTICATED", 401);

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "").trim(); // "lock" | "unlock"
  const evaluation_id = String(body?.evaluation_id || "").trim();
  const pin = normalizePin(body?.pin);

  if (!evaluation_id) return bad("evaluation_id requis");
  if (action !== "lock" && action !== "unlock") return bad("action invalide");
  if (!pin) return bad("PIN invalide (4 à 8 chiffres)");

  // Charger l'évaluation
  const { data: ev, error: evErr } = await srv
    .from("grade_evaluations")
    .select("id,class_id,subject_id,teacher_id")
    .eq("id", evaluation_id)
    .maybeSingle();

  if (evErr || !ev) return bad("EVALUATION_NOT_FOUND", 404);

  const allowed = await ensureClassAccess(srv, ev.class_id, profile.institution_id);
  if (!allowed) return bad("FORBIDDEN", 403);

  // Table absente ? → réponse claire
  const tableCheck = await srv.from("grade_evaluation_locks").select("evaluation_id").limit(1);
  if (tableCheck.error) {
    const msg = String(tableCheck.error.message || "");
    const missingTable =
      msg.includes('relation "grade_evaluation_locks" does not exist') || msg.includes("42P01");
    if (missingTable) return bad("LOCK_FEATURE_NOT_ENABLED (run SQL migration)", 501);
  }

  if (action === "lock") {
    const pin_hash = hashPin(pin);
    const now = new Date().toISOString();

    const { error: upErr } = await srv
      .from("grade_evaluation_locks")
      .upsert(
        {
          evaluation_id,
          institution_id: profile.institution_id,
          class_id: ev.class_id,
          subject_id: ev.subject_id,
          teacher_id: ev.teacher_id,
          is_locked: true,
          pin_hash,
          locked_by: user.id,
          locked_at: now,
          updated_at: now,
        },
        { onConflict: "evaluation_id" },
      );

    if (upErr) return bad(upErr.message || "LOCK_FAILED", 400);
    return NextResponse.json({ ok: true, locked: true, evaluation_id });
  }

  // unlock
  const { data: lockRow, error: lockErr } = await srv
    .from("grade_evaluation_locks")
    .select("evaluation_id,is_locked,pin_hash")
    .eq("evaluation_id", evaluation_id)
    .maybeSingle();

  if (lockErr) return bad(lockErr.message || "LOCK_READ_FAILED", 400);
  if (!lockRow?.is_locked) return NextResponse.json({ ok: true, locked: false, evaluation_id });

  const ok = verifyPin(pin, lockRow.pin_hash);
  if (!ok) return bad("INVALID_PIN", 403);

  const { error: updErr } = await srv
    .from("grade_evaluation_locks")
    .update({ is_locked: false, updated_at: new Date().toISOString() })
    .eq("evaluation_id", evaluation_id);

  if (updErr) return bad(updErr.message || "UNLOCK_FAILED", 400);

  return NextResponse.json({ ok: true, locked: false, evaluation_id });
}
