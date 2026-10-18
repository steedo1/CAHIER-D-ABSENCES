import { redirect } from "next/navigation";
import TrueLogoutButton from "@/components/auth/TrueLogoutButton";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireTeachingDirector } from "@/lib/auth/teaching-director";
import { readStudentProgramSettings } from "@/lib/school-student-programs";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import type { SchoolCycle } from "@/lib/school-cycles";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CYCLE_LABELS: Record<SchoolCycle, string> = {
  preschool: "Préscolaire", primary: "Primaire", secondary: "Secondaire",
};

/**
 * Dedicated, server-authorized director landing page. No historical admin
 * navigation or data APIs are exposed to this role until program isolation is
 * completed. School/class names are selected only from the verified assignment.
 */
export default async function TeachingDirectionHome() {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireTeachingDirector(client, service);
  if (!access.ok) {
    if (access.status === 401) redirect("/login");
    return <main className="mx-auto mt-16 max-w-xl rounded-xl border bg-white p-8">
      <h1 className="text-xl font-bold">Accès à la direction indisponible</h1>
      <p className="mt-2 text-sm text-slate-600">
        L'affectation du compte doit être vérifiée par la direction générale.
      </p><TrueLogoutButton className="mt-5 rounded-lg border px-4 py-2" />
    </main>;
  }
  const { institutionId, teachingTrack, cycles } = access.principal;
  const [institution, classes, years] = await Promise.all([
    service.from("institutions").select("name,settings_json").eq("id", institutionId).maybeSingle(),
    service.from("classes").select("id,label,level,academic_year").eq("institution_id", institutionId)
      .order("academic_year", { ascending: false }).order("label").limit(500),
    service.from("academic_years").select("code").eq("institution_id", institutionId)
      .eq("is_current", true).limit(1).maybeSingle(),
  ]);
  if (institution.error || !institution.data || classes.error || years.error) {
    return <main className="mx-auto mt-12 max-w-xl p-6">
      <h1 className="text-xl font-bold">Informations temporairement indisponibles</h1>
      <TrueLogoutButton className="mt-4 rounded-lg border px-4 py-2" />
    </main>;
  }
  const settings = parseSchoolCyclesSettings(institution.data.settings_json);
  const program = readStudentProgramSettings(institution.data.settings_json);
  const academicYear = years.data?.code || "";
  const permittedClasses = (classes.data || []).filter(row => {
    if (!academicYear || row.academic_year !== academicYear) return false;
    const cycle = settings.classCycleById[row.id];
    if (!cycle || !cycles.includes(cycle)) return false;
    return program.years[academicYear]?.classes[row.id]?.tracks.includes(teachingTrack);
  });
  return <main className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8">
    <header className="flex items-center justify-between gap-3 rounded-2xl border bg-white p-5">
      <div>
        <p className="text-sm text-emerald-700">Direction de l'enseignement {teachingTrack === "arabic" ? "arabe" : "français"}</p>
        <h1 className="text-2xl font-bold">{institution.data.name}</h1>
        <p className="mt-1 text-sm text-slate-600">Année scolaire : {academicYear || "Non définie"}</p>
      </div>
      <TrueLogoutButton />
    </header>
    {access.principal.hasTeacherRole && <nav className="flex flex-wrap gap-3 rounded-xl border bg-white p-4">
      <span className="w-full text-sm font-semibold">Mon compte enseignant existant</span>
      <a href="/attendance" className="rounded-lg border px-4 py-2 text-sm font-medium">
        Cahier d'absences
      </a>
      <a href="/grades" className="rounded-lg border px-4 py-2 text-sm font-medium">
        Cahier de notes
      </a>
      <span className="w-full text-xs text-slate-500">
        Vos anciennes affectations et autorisations d'enseignant restent inchangées.
      </span>
    </nav>}
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      Portail de direction isolé. La gestion des notes, des bulletins et des enseignants sera
      ouverte progressivement après vérification des permissions serveur de chaque module.
      Aucun accès aux finances ni aux données de l'autre enseignement.
    </div>
    {cycles.map(cycle => {
      const rows = permittedClasses.filter(row => settings.classCycleById[row.id] === cycle);
      return <section key={cycle} className="rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-bold">{CYCLE_LABELS[cycle]}</h2>
        <p className="mt-1 text-sm text-slate-600">{rows.length} classe(s) rattachée(s) à cet enseignement</p>
        {rows.length ? <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {rows.map(row => <li key={row.id} className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <strong>{row.label}</strong>{row.level ? ` · ${row.level}` : ""}
          </li>)}
        </ul> : <p className="mt-3 text-sm text-amber-800">
          Aucune classe affectée à cet enseignement pour l'année en cours.
        </p>}
      </section>;
    })}
  </main>;
}
