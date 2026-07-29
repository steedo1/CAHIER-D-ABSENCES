export const dynamic = "force-dynamic";
export const revalidate = 0;

import { redirect } from "next/navigation";
import AdminDashboardClient from "./client";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export default async function AdminDashboard() {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (user) {
    const srv = getSupabaseServiceClient();
    const { data: roleRows } = await srv
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id);

    const roles = new Set(
      (roleRows || []).map((row: any) => String(row.role || "").trim()),
    );
    const isFinanceManager =
      roles.has("finance_manager") || roles.has("finance");
    const hasAdministrativeDashboardRole =
      roles.has("admin") || roles.has("super_admin") || roles.has("founder");

    if (isFinanceManager && !hasAdministrativeDashboardRole) {
      redirect("/admin/finance");
    }
  }

  return <AdminDashboardClient />;
}
