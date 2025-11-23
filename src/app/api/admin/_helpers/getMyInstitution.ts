// src/app/api/admin/_helpers/getMyInstitution.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function getMyInstitutionId() {
  const supabaseAuth = await getSupabaseServerClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supabaseAuth
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };
  }
  if (!me?.institution_id) {
    return { error: NextResponse.json({ error: "no_institution" }, { status: 400 }) };
  }

  return { institution_id: me.institution_id as string };
}
