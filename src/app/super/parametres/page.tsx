// src/app/super/parametres/page.tsx
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import SettingsPanel from "./ui/SettingsPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: roles } = await supabase.from("user_roles").select("role").eq("profile_id", user.id);
  if (!(roles ?? []).some(r => r.role === "super_admin")) redirect("/(errors)/forbidden");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">ParamÃ¨tres</h1>
      <SettingsPanel />
    </div>
  );
}


