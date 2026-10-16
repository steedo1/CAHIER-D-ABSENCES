// src/app/api/super/create-admin/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminAccess } from "@/lib/super-admin-access";

function genTempPass(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export async function POST(req: NextRequest) {
  const access = await requireSuperAdminAccess();
  if ("error" in access) return access.error;

  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "expected_json" }, { status: 415 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const institution_id = typeof body.institution_id === "string" ? body.institution_id.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(institution_id) ||
      email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
      (phone !== null && phone.length > 32)) {
    return NextResponse.json({ error: "invalid_admin_fields" }, { status: 400 });
  }

  const check = await access.srv.from("institutions")
    .select("id").eq("id", institution_id).maybeSingle();
  if (check.error) return NextResponse.json({ error: "institution_load_failed" }, { status: 503 });
  if (!check.data) return NextResponse.json({ error: "institution_not_found" }, { status: 404 });

  if (!institution_id || !email) {
    return NextResponse.json(
      { error: "institution_id et email requis" },
      { status: 400 }
    );
  }

  const supabase = access.srv;

  // Mot de passe temporaire = DEFAULT_TEMP_PASSWORD (sinon fallback g�n�r�)
  const password = process.env.DEFAULT_TEMP_PASSWORD || genTempPass(12);

  // 1) Cr�e l'utilisateur Auth avec mot de passe (email d�j� confirm�)
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { phone: phone ?? null },
  });
  if (createErr || !created?.user) {
    return NextResponse.json(
      { error: createErr?.message || "CREATE_USER_FAILED" },
      { status: 409 }
    );
  }
  const uid = created.user.id;

  // 2) Upsert profil
  const { error: pErr } = await supabase.from("profiles").upsert(
    {
      id: uid,
      institution_id,
      email,
      phone: phone ?? null,
    },
    { onConflict: "id" }
  );
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });

  // 3) R�le admin (idempotent)
  const { error: rErr } = await supabase.from("user_roles").upsert(
    { profile_id: uid, institution_id, role: "admin" as const },
    { onConflict: "profile_id,institution_id,role" }
  );
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 400 });

  // On NE renvoie PAS le mot de passe (s�curit�). Tu le connais via l'env.
  return NextResponse.json({ ok: true, user: { id: uid, email } }, { status: 200 });
}


