import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import DemoBulletinClient from "./DemoBulletinClient";
import SchoolBulletinSettings from "@/components/admin/SchoolBulletinSettings";

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

  if (!school.enabled) {
    // Existing CSCA/secondary schools stay on their historical bulletin screens.
    return <div className="mx-auto max-w-3xl rounded-xl border bg-white p-6">
      <h1 className="text-xl font-bold">Bulletins de l’établissement</h1>
      <p className="mt-2 text-sm text-slate-700">
        Votre établissement conserve ses modèles historiques. Aucun nouveau
        modèle n'est activé ou imposé.
      </p>
    </div>;
  }

  const hasArabic = school.enabledCycles.some(cycle =>
    school.teachingTracksByCycle[cycle]?.includes("arabic"));

  return <div className="mx-auto max-w-6xl space-y-6">
    <div className="rounded-2xl border bg-white p-5">
      <h1 className="text-2xl font-bold">Modèles et paramètres des bulletins</h1>
      <p className="mt-2 text-sm text-slate-600">
        Configuration réservée à l'administration de votre établissement.
        Les aperçus utilisent des données fictives et ne publient aucune note.
      </p>
    </div>
    <SchoolBulletinSettings />
    <DemoBulletinClient
      hasArabic={hasArabic}
      schoolName={institution.name || "Établissement"}
      schoolCode={institution.code || institution.code_unique || "—"}
    />
  </div>;
}
