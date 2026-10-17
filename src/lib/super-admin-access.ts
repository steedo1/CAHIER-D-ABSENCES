import { NextResponse } from "next/server";
import { getSupabaseServerClient, getVerifiedServerUser } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

/** Request-scoped super-admin authorization, checked before service role queries. */
export async function requireSuperAdminAccess() {
  const supa = await getSupabaseServerClient();
  const { data: { user }, error } = await getVerifiedServerUser(supa);
  if (error || !user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }

  const srv = getSupabaseServiceClient();
  const roles = await srv.from("user_roles")
    .select("role").eq("profile_id", user.id);
  if (roles.error) {
    return {
      error: NextResponse.json(
        { error: "permission_check_unavailable" }, { status: 503 },
      ),
    } as const;
  }
  if (!roles.data?.some((role) => role.role === "super_admin")) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;
  }

  return { srv, user } as const;
}
