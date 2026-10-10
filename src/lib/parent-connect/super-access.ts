import { NextResponse } from "next/server";
import { getSupabaseServerClient, getVerifiedServerUser } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export async function requireParentConnectSuper() {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await getVerifiedServerUser(supa);
  if (!user) return { error: NextResponse.json({ error: "Connexion requise." }, { status: 401 }) } as const;
  const srv = getSupabaseServiceClient();
  const roles = await srv.from("user_roles").select("role").eq("profile_id", user.id);
  if (roles.error) return { error: NextResponse.json({ error: "Vérification des droits indisponible." }, { status: 503 }) } as const;
  if (!(roles.data || []).some((r) => r.role === "super_admin")) return { error: NextResponse.json({ error: "Réservé au super admin." }, { status: 403 }) } as const;
  return { srv, user } as const;
}
