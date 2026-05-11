// src/app/super/drenaets/page.tsx
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import DrenaetsManager from "./ui/DrenaetsManager";

export const dynamic = "force-dynamic";

export default async function SuperDrenaetsPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id);

  if (!(roles ?? []).some((r) => r.role === "super_admin")) {
    redirect("/(errors)/forbidden");
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-slate-950 via-violet-950 to-slate-900 p-6 text-white shadow-sm">
        <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-violet-100">
          Supervision régionale
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Accès DRENAET</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-violet-100">
          Créez les comptes des directions régionales et rattachez-les à leurs zones. Chaque compte DRENAET
          accède ensuite à son tableau de bord régional en lecture seule.
        </p>
      </div>

      <DrenaetsManager />
    </div>
  );
}
