// src/app/api/admin/create-users/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type NewUserInput = {
  email: string;
  role: "teacher" | "parent" | "educator" | "admin" | "student";
  display_name?: string;
};

type Body = {
  institution_id: string;
  users: NewUserInput[];
};

export async function POST(req: Request) {
  const supabase = getSupabaseServiceClient();
  const { institution_id, users }: Body = await req.json();

  if (!institution_id || !Array.isArray(users))
    return NextResponse.json({ error: "payload invalide" }, { status: 400 });

  const results: Array<{ email: string; ok: boolean; user_id?: string; error?: string }> = [];

  for (const u of users) {
    // 1) créer l'utilisateur Auth (email confirmé)
    const { data: created, error: aErr } = await supabase.auth.admin.createUser({
      email: u.email,
      email_confirm: true,
      // si tu veux générer un mot de passe:
      // password: crypto.randomUUID(),
    });

    if (aErr || !created?.user) {
      results.push({ email: u.email, ok: false, error: aErr?.message ?? "createUser failed" });
      continue;
    }

    const uid = created.user.id;

    // 2) upsert profil
    await supabase.from("profiles").upsert(
      {
        id: uid,
        institution_id,
        email: u.email,
        display_name: u.display_name ?? u.email.split("@")[0],
      },
      { onConflict: "id" }
    );

    // 3) insérer le rôle
    const { error: rErr } = await supabase.from("user_roles").insert({
      profile_id: uid,
      institution_id,
      role: u.role,
    });

    if (rErr) {
      results.push({ email: u.email, ok: false, error: rErr.message });
      continue;
    }

    results.push({ email: u.email, ok: true, user_id: uid });
  }

  return NextResponse.json({ results });
}


