//src/app/api/teacher/signature/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function b64ToBuffer(dataUrlOrB64: string): Buffer {
  // accepte "data:image/png;base64,...." ou juste base64
  const b64 = dataUrlOrB64.includes(",")
    ? dataUrlOrB64.split(",").pop() || ""
    : dataUrlOrB64;
  return Buffer.from(b64, "base64");
}

async function getRoleAndInstitution(supabase: any, profileId: string) {
  const { data: roleRow, error } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", profileId)
    .limit(1)
    .maybeSingle();

  if (error) return { roleRow: null, error: error.message };
  return { roleRow, error: null };
}

function forbidNotTeacher() {
  return NextResponse.json(
    { ok: false, error: "FORBIDDEN_NOT_TEACHER" },
    { status: 403 }
  );
}

export async function GET() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { roleRow } = await getRoleAndInstitution(supabase, user.id);

  if (!roleRow?.institution_id) {
    return NextResponse.json({ ok: false, error: "NO_INSTITUTION" }, { status: 400 });
  }

  // 🔒 Réservé au compte individuel enseignant
  if (roleRow.role !== "teacher") {
    return forbidNotTeacher();
  }

  const { data } = await supabase
    .from("teacher_signatures")
    .select("storage_path, sha256, updated_at")
    .eq("institution_id", roleRow.institution_id)
    .eq("teacher_id", user.id)
    .maybeSingle();

  return NextResponse.json({ ok: true, signature: data || null });
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient(); // service role
  const srvStorage = srv.storage;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { roleRow } = await getRoleAndInstitution(supabase, user.id);

  const institutionId = roleRow?.institution_id;
  if (!institutionId) {
    return NextResponse.json({ ok: false, error: "NO_INSTITUTION" }, { status: 400 });
  }

  // 🔒 Réservé au compte individuel enseignant
  if (roleRow.role !== "teacher") {
    return forbidNotTeacher();
  }

  const body = await req.json().catch(() => null);
  const pngBase64 = String(body?.png_base64 || "").trim();
  if (!pngBase64) {
    return NextResponse.json({ ok: false, error: "MISSING_SIGNATURE" }, { status: 400 });
  }

  const buf = b64ToBuffer(pngBase64);
  if (!buf.length) {
    return NextResponse.json({ ok: false, error: "INVALID_IMAGE" }, { status: 400 });
  }

  // ✅ garde-fou taille (évite uploads énormes)
  // ~1.5MB max, largement suffisant pour une signature
  if (buf.length > 1_500_000) {
    return NextResponse.json({ ok: false, error: "IMAGE_TOO_LARGE" }, { status: 413 });
  }

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const path = `${institutionId}/${user.id}/signature.png`;

  // upload (overwrite)
  const up = await srvStorage.from("signatures").upload(path, buf, {
    contentType: "image/png",
    upsert: true,
    cacheControl: "3600",
  });

  if (up.error) {
    return NextResponse.json(
      { ok: false, error: "UPLOAD_FAILED", details: up.error.message },
      { status: 500 }
    );
  }

  // upsert db (signature associée AU PROF CONNECTÉ)
  const { error: dbErr } = await srv
    .from("teacher_signatures")
    .upsert(
      {
        institution_id: institutionId,
        teacher_id: user.id,
        storage_path: path,
        sha256,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "institution_id,teacher_id" }
    );

  if (dbErr) {
    return NextResponse.json(
      { ok: false, error: "DB_FAILED", details: dbErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, storage_path: path, sha256 });
}
