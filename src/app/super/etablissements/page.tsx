// src/app/super/etablissements/page.tsx
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import InstitutionsAndAdmins from "./ui/SuperConsole";

export const dynamic = "force-dynamic";

export default async function SuperEtablissementsPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: roles } = await supabase.from("user_roles").select("role").eq("profile_id", user.id);
  const isSuper = (roles ?? []).some(r => r.role === "super_admin");
  if (!isSuper) redirect("/(errors)/forbidden");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">�0tablissements</h1>
        <p className="text-sm text-slate-600">Cr�er et g�rer les �tablissements et leurs administrateurs.</p>
      </div>
      <InstitutionsAndAdmins />
    </div>
  );
}


