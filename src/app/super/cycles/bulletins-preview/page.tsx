import { redirect } from "next/navigation";
import { getSupabaseServerClient, getVerifiedServerUser } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import DemoBulletinClient from "./DemoBulletinClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PreviewBulletinsPage() {
  // Preview includes fictitious information but is internal until the new
  // bulletin system is fully authorized and connected to real school records.
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await getVerifiedServerUser(supabase);
  if (!user) redirect("/login");
  const service = getSupabaseServiceClient();
  const roles = await service.from("user_roles")
    .select("role").eq("profile_id", user.id);
  if (roles.error || !roles.data?.some(row => row.role === "super_admin")) {
    redirect("/super/dashboard");
  }
  return <DemoBulletinClient />;
}
