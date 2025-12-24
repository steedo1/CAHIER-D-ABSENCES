// src/app/api/teacher/grades/locks/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

/* -------- Contexte (user + profil + service client) -------- */
async function getContext() {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { user: null as any, profile: null as any, srv: null as any };
  }

  const { data: profile, error } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile?.institution_id) {
    return { user, profile: null as any, srv: null as any };
  }

  const srv = getSupabaseServiceClient();
  return { user, profile, srv };
}

/**
 * Vérifie que la classe appartient à l'établissement.
 */
async function ensureClassAccess(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classId: string,
  institutionId: string
): Promise<boolean> {
  if (!classId || !institutionId) return false;

  const { data: cls, error } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", classId)
    .maybeSingle();

  if (error) return false;
  return !!cls && cls.institution_id === institutionId;
}

/* -------- PIN hashing -------- */
function normalizePin(pin: unknown): string | null {
  const s = String(pin ?? "").trim();
  if (!/^\d{4,8}$/.test(s)) return null;
  return s;
}

function hashPin(pin: string, saltHex?: string) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const derived = crypto.scryptSync(pin, salt, 32);
  return { hashHex: derived.toString("hex"), saltHex: salt.toString("hex") };
}

function verifyPin(pin: string, hashHex: string, saltHex: string) {
  const { hashHex: test } = hashPin(pin, saltHex);
  return crypto.timingSafeEqual(Buffer.from(test, "hex"), Buffer.from(hashHex, "hex"));
}

/* ==========================================
   GET : statut lock
========================================== */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const evaluation_id = String(url.searchParams.get("evaluation_id") || "").trim();
  if (!evaluation_id) return NextResponse.json({ ok: true, locked: false });

  const { user, profile, srv } = await getContext();
  if (!user || !profile || !srv) {
    return NextResponse.json({ ok: true, locked: false }, { status: 401 });
  }

  // Charger l'évaluation pour vérifier accès
  const { data: ev, error: evErr } = await srv
    .from("grade_evaluations")
    .select("id,class_id,teacher_id")
    .eq("id", evaluation_id)
    .maybeSingle();

  if (evErr || !ev) return NextResponse.json({ ok: true, locked: false }, { status: 200 });

  const allowed = await ensureClassAccess(srv, ev.class_id, profile.institution_id);
  if (!allowed) return NextResponse.json({ ok: true, locked: false }, { status: 200 });

  // Si teacher_id est renseigné et différent, on cache l'info
  if (ev.teacher_id && ev.teacher_id !== user.id) {
    return NextResponse.json({ ok: true, locked: false }, { status: 200 });
  }

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

/* ==========================================
   POST : lock/unlock
========================================== */
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

  // Si l'éval appartient explicitement à un autre prof → interdit
  if (ev.teacher_id && ev.teacher_id !== user.id) return bad("FORBIDDEN", 403);

  // Lire lock row (si table absente: on renvoie enabled=false)
  let lockRow:
    | { is_locked: boolean; pin_hash: string | null; pin_salt: string | null }
    | null = null;

  const { data: existing, error: readErr } = await srv
    .from("grade_evaluation_locks")
    .select("evaluation_id,is_locked,pin_hash,pin_salt")
    .eq("evaluation_id", evaluation_id)
    .maybeSingle();

  if (readErr) {
    const msg = String(readErr.message || "");
    const missingTable =
      msg.includes('relation "grade_evaluation_locks" does not exist') || msg.includes("42P01");
    if (missingTable) {
      return NextResponse.json({ ok: true, enabled: false, locked: false });
    }
    return bad("LOCK_READ_FAILED", 500);
  }

  lockRow = existing ?? null;

  if (action === "lock") {
    const { hashHex, saltHex } = hashPin(pin);

    const { error: upErr } = await srv.from("grade_evaluation_locks").upsert(
      {
        evaluation_id,
        is_locked: true,
        pin_hash: hashHex,
        pin_salt: saltHex,
        teacher_id: user.id,
        locked_at: new Date().toISOString(),
      },
      { onConflict: "evaluation_id" }
    );

    if (upErr) return bad(upErr.message || "LOCK_FAILED", 400);

    return NextResponse.json({
      ok: true,
      enabled: true,
      locked: true,
      locked_at: new Date().toISOString(),
      teacher_id: user.id,
    });
  }

  // unlock
  if (!lockRow?.pin_hash || !lockRow?.pin_salt) {
    // pas de PIN enregistré → on refuse
    return bad("PIN_REQUIRED", 403);
  }

  const ok = verifyPin(pin, lockRow.pin_hash, lockRow.pin_salt);
  if (!ok) return bad("PIN_INVALID", 403);

  const { error: upErr } = await srv.from("grade_evaluation_locks").upsert(
    {
      evaluation_id,
      is_locked: false,
      teacher_id: user.id,
      locked_at: null,
    },
    { onConflict: "evaluation_id" }
  );

  if (upErr) return bad(upErr.message || "UNLOCK_FAILED", 400);

  return NextResponse.json({
    ok: true,
    enabled: true,
    locked: false,
    locked_at: null,
    teacher_id: user.id,
  });
}
