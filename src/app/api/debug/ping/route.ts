// src/app/api/debug/ping/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await getSupabaseServerClient();

  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  let roles: any[] = [];
  let rErr: any = null;

  if (user) {
    const { data, error } = await supabase
      .from("user_roles")
      .select("institution_id, role")
      .eq("profile_id", user.id);
    roles = data || [];
    rErr = error;
  }

  return NextResponse.json({
    user: user ? { id: user.id, email: user.email } : null,
    roles,
    uErr: uErr?.message || null,
    rErr: rErr?.message || null,
  });
}


