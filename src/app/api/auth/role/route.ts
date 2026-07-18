import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { AppRole } from "@/lib/auth/role";
import { ROLE_PRIORITY } from "@/lib/auth/role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ role: null }, { status: 401 });
  }

  const { data: rows, error: rolesErr } = await supabase
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (rolesErr) {
    // On ne casse pas l'UI, on renvoie role=null
    return NextResponse.json({ role: null }, { status: 200 });
  }

  const roles = (rows ?? []).map((r: any) => r.role as AppRole);
  const primary = ROLE_PRIORITY.find((r) => roles.includes(r)) ?? roles[0] ?? null;
  const primaryRow =
    (rows ?? []).find((row: any) => row.role === primary && row.institution_id) ||
    (rows ?? []).find((row: any) => row.institution_id) ||
    null;

  return NextResponse.json({
    user_id: user.id,
    role: primary,
    institution_id: primaryRow?.institution_id ? String(primaryRow.institution_id) : null,
  });
}
