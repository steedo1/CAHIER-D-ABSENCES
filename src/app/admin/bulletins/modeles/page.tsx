import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import DemoBulletinClient from "./DemoBulletinClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Pedagogical bulletin templates are owned by the current school's admin. */
export default async function AdminBulletinTemplatesPage() {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireInstitutionRole(client, service, ["admin"]);
  if ("error" in access) redirect("/admin/dashboard");

  const { data: institution, error } = await service.from("institutions")
    .select("id,name,code,code_unique,settings_json")
    .eq("id", access.instId)
    .maybeSingle();
  if (error || !institution) return (
    <p role="alert" className="rounded-xl border bg-white p-6">
      Impossible de charger la configuration de votre établissement.
    </p>
  );
  const school = parseSchoolCyclesSettings(institution.settings_json);

  if (!school.enabled) redirect("/admin/bulletins");
  // Both the historic direct link and the preview link must show the
  // templates. The editor itself remains in Paramètres.


  const hasArabic = school.enabledCycles.some(cycle =>
    school.teachingTracksByCycle[cycle]?.includes("arabic"));

  return <div className="mx-auto max-w-6xl space-y-6">
    <div className="rounded-2xl border bg-white p-5">
      <h1 className="text-2xl font-bold">Prévisualisation des modèles de bulletins</h1>
      <p className="mt-2 text-sm text-slate-600">
        Ces aperçus utilisent des données fictives. Les réglages sont regroupés
        dans Paramètres de l’établissement et ne publient aucune note.
      </p>
    </div>
    <DemoBulletinClient
      hasArabic={hasArabic}
      enabledCycles={school.enabledCycles}
      tracksByCycle={school.teachingTracksByCycle}
      schoolName={institution.name || "Établissement"}
      schoolCode={institution.code || institution.code_unique || "—"}
    />
  </div>;
}
