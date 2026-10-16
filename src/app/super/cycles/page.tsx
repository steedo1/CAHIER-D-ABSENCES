import { redirect } from "next/navigation";
import { getSupabaseServerClient, getVerifiedServerUser } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import CycleConfigClient from "./CycleConfigClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SuperCycleSettingsPage() {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await getVerifiedServerUser(supa);
  if (!user) redirect("/login");

  const srv = getSupabaseServiceClient();
  const { data: roles, error } = await srv.from("user_roles")
    .select("role").eq("profile_id", user.id);
  if (error || !roles?.some((r) => r.role === "super_admin")) {
    redirect("/super/dashboard");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Cycles et enseignements</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Activez les cycles uniquement pour les établissements concernés.
          Les autres écoles conservent automatiquement leur navigation actuelle.
        </p>
      </div>
      <CycleConfigClient />
    </div>
  );
}
