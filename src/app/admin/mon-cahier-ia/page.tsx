import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getAiModuleState } from "@/lib/mon-cahier-ai/module";
import AiModuleOffer from "@/components/admin/AiModuleOffer";
import Link from "next/link";

export const dynamic = "force-dynamic";
export default async function MonCahierIaPage() {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supa.from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
  const { data: roles } = await supa.from("user_roles").select("role,institution_id").eq("profile_id", user.id);
  const institutionId = profile?.institution_id;
  if (!institutionId || !roles?.some(r => r.institution_id === institutionId && ["admin", "super_admin", "educator"].includes(r.role))) redirect("/(errors)/forbidden");
  const module = await getAiModuleState(getSupabaseServiceClient(), institutionId);
  if (module.reason === "unavailable") return <p role="alert">L’autorisation Mon Cahier IA est momentanément indisponible.</p>;
  return module.enabled ? <section className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-white p-6"><p className="text-sm font-bold text-emerald-700">Module actif</p><h1 className="mt-2 text-2xl font-black">Mon Cahier IA</h1><p className="mt-3 text-slate-700">Posez votre question dans la bulle Cahier IA pour analyser les résultats, préparer un accompagnement ou une note de conseil de classe.</p>{roles?.some(r => r.institution_id === institutionId && ["admin", "super_admin"].includes(r.role)) ? <Link href="/admin/notes/predictions" className="mt-4 inline-flex rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">Ouvrir les analyses par classe</Link> : null}</section> : <div className="mx-auto max-w-2xl p-4"><AiModuleOffer /></div>;
}
