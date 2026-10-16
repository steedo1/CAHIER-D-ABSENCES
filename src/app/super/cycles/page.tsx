import { redirect } from "next/navigation";
import Link from "next/link";
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
      <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Maquettes professionnelles de bulletins</h2>
        <p className="mt-1 text-sm text-slate-600">
          Prévisualisez les modèles français, arabe et regroupé au format A4,
          avec deux moyennes indépendantes et sans bandeau d'avertissement.
          Données fictives uniquement ; les vrais bulletins restent inchangés.
        </p>
        <Link href="/super/cycles/bulletins-preview"
          className="mt-3 inline-flex rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white">
          Voir les trois maquettes A4
        </Link>
      </div>
      <CycleConfigClient />
    </div>
  );
}
