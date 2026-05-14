// src/app/super/founders/page.tsx
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import FoundersManager from "./ui/FoundersManager";

export const dynamic = "force-dynamic";

export default async function FoundersPage() {
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: roles } = await service
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id);

  if (!(roles ?? []).some((row: any) => row.role === "super_admin")) {
    redirect("/(errors)/forbidden");
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-violet-100 bg-gradient-to-br from-slate-950 via-violet-950 to-slate-900 p-6 text-white shadow-xl">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-200">
            Super administration
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">
            Comptes fondateurs
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-200">
            Le rôle fondateur est créé uniquement par le super admin. Il peut être
            rattaché à une ou plusieurs écoles et recevoir les notifications
            stratégiques de ces établissements.
          </p>
        </div>
      </section>

      <FoundersManager />
    </div>
  );
}
