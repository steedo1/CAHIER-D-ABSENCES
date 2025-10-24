import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name,email,institution_id,phone,created_at")
    .eq("id", user.id)
    .maybeSingle();

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-2">Profil</h1>
      <div className="rounded border bg-white p-4 space-y-2">
        <div><b>Nom :</b> {profile?.display_name || "-"}</div>
        <div><b>Email :</b> {profile?.email || user.email}</div>
        <div><b>TÃ©lÃ©phone :</b> {profile?.phone || "-"}</div>
        <div><b>Institution :</b> {profile?.institution_id || "-"}</div>
        <div><b>RÃ´les :</b> {(roles || []).map((r) => r.role).join(", ") || "-"}</div>
      </div>
    </main>
  );
}
