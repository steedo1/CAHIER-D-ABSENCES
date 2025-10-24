// src/app/api/super/stats/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: roles, error: rolesErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id);

  if (rolesErr) return NextResponse.json({ error: rolesErr.message }, { status: 500 });
  const isSuper = (roles ?? []).some((r) => r.role === "super_admin");
  if (!isSuper) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // J+30 (format YYYY-MM-DD sans timezone lib externe)
  const today = new Date();
  const in30UTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 30));
  const in30Str = in30UTC.toISOString().slice(0, 10);

  const [inst, admins, users, exp] = await Promise.all([
    supabase.from("institutions").select("id", { count: "exact", head: true }),
    supabase.from("user_roles").select("profile_id", { count: "exact", head: true }).eq("role", "admin"),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("institutions")
      .select("id", { count: "exact", head: true })
      .lte("subscription_expires_at", in30Str),
  ]);

  return NextResponse.json({
    institutions: inst.count ?? 0,
    admins: admins.count ?? 0,
    users: users.count ?? 0,
    expiringIn30d: exp.count ?? 0,
  });
}
