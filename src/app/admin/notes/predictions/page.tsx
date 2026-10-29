import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getAiModuleState } from "@/lib/mon-cahier-ai/module";
import AiModuleOffer from "@/components/admin/AiModuleOffer";
import PredictionsClient from "./PredictionsClient";

export const dynamic = "force-dynamic";
export default async function PredictionsPage() {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supa.from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
  const { data: roles } = await supa.from("user_roles").select("role,institution_id").eq("profile_id", user.id);
  const institutionId = profile?.institution_id;
  if (!institutionId || !roles?.some(r => r.institution_id === institutionId && ["admin", "super_admin", "file_correspondent"].includes(r.role))) redirect("/(errors)/forbidden");
  const module = await getAiModuleState(getSupabaseServiceClient(), institutionId);
  if (module.reason === "unavailable") return <p role="alert">L’autorisation Mon Cahier IA est momentanément indisponible.</p>;
  return module.enabled ? <PredictionsClient /> : <div className="mx-auto max-w-2xl p-4"><AiModuleOffer /></div>;
}
