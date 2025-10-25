import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import AdminsTable from "./ui/AdminsTable";

export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: roles } = await supabase.from("user_roles").select("role").eq("profile_id", user.id);
  if (!(roles ?? []).some(r => r.role === "super_admin")) redirect("/(errors)/forbidden");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Admins dâ€™Ã©tablissement</h1>
      <AdminsTable />
    </div>
  );
}


