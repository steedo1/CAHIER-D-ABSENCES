// src/app/api/super/create-admin/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

function genTempPass(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export async function POST(req: Request) {
  const { institution_id, email, phone } = await req.json();

  if (!institution_id || !email) {
    return NextResponse.json(
      { error: "institution_id et email requis" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServiceClient();

  // Mot de passe temporaire = DEFAULT_TEMP_PASSWORD (sinon fallback généré)
  const password = process.env.DEFAULT_TEMP_PASSWORD || genTempPass(12);

  // 1) Crée l'utilisateur Auth avec mot de passe (email déjÃ  confirmé)
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

  // 3) Rôle admin (idempotent)
  const { error: rErr } = await supabase.from("user_roles").upsert(
    { profile_id: uid, institution_id, role: "admin" as const },
    { onConflict: "profile_id,institution_id,role" }
  );
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 400 });

  // On NE renvoie PAS le mot de passe (sécurité). Tu le connais via l'env.
  return NextResponse.json({ ok: true, user: { id: uid, email } }, { status: 200 });
}


