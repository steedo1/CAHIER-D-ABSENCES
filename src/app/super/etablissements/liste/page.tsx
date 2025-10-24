// src/app/super/etablissements/liste/page.tsx
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import ListInstitutions from "./ui/ListInstitutions";

export const dynamic = "force-dynamic";

export default async function EtabsListPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: roles } = await supabase.from("user_roles").select("role").eq("profile_id", user.id);
  if (!(roles ?? []).some(r => r.role === "super_admin")) redirect("/(errors)/forbidden");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Liste des Ã©tablissements</h1>
      <ListInstitutions />
    </div>
  );
}
