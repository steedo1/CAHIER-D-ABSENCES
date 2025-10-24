import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // ðŸ” super_admin requis
  const s = await getSupabaseServerClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: roles } = await s.from("user_roles").select("role").eq("profile_id", user.id);
  if (!(roles ?? []).some(r => r.role === "super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit  = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")  ?? 20)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  const q      = (url.searchParams.get("q") ?? "").trim();

  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("user_roles")
    .select(`
      profile_id,
      institution_id,
      role,
      profiles:profiles!user_roles_profile_id_fkey ( display_name, email, phone ),
      institutions:institutions!user_roles_institution_id_fkey ( name, code_unique )
    `, { count: "exact" })
    .eq("role", "admin")
    .order("institution_id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (q) {
    const like = `%${q}%`;
    query = query.or([
      `profiles.display_name.ilike.${like}`,
      `profiles.email.ilike.${like}`,
      `profiles.phone.ilike.${like}`,
      `institutions.name.ilike.${like}`,
      `institutions.code_unique.ilike.${like}`
    ].join(","));
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ items: data ?? [], total: count ?? 0 });
}
