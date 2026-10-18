import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Historical preview links must not show invented grades. */
export default async function AdminBulletinTemplatesPage() {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireInstitutionRole(client, service, ["admin"]);
  if ("error" in access) redirect("/admin/dashboard");

  const { data: institution, error } = await service.from("institutions")
    .select("settings_json").eq("id", access.instId).maybeSingle();
  if (error || !institution) return (
    <p role="alert" className="rounded-xl border bg-white p-6">
      Impossible de charger la configuration de votre établissement.
    </p>
  );

  const school = parseSchoolCyclesSettings(institution.settings_json);
  if (!school.enabled || !school.enabledCycles.some(cycle =>
    cycle === "primary" || cycle === "preschool")) {
    redirect("/admin/bulletins");
  }
  redirect("/admin/parametres?tab=bulletin-models");
}
