import { redirect } from "next/navigation";
import TrueLogoutButton from "@/components/auth/TrueLogoutButton";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireTeachingDirector } from "@/lib/auth/teaching-director";
import { loadTeachingDirectorWorkspace } from "@/lib/server/school-director-workspace";
import SchoolGradingPeriodsEditor from "@/components/admin/SchoolGradingPeriodsEditor";
import type { SchoolCycle } from "@/lib/school-cycles";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const LABELS: Record<SchoolCycle, string> = {
  preschool: "Préscolaire", primary: "Primaire", secondary: "Secondaire",
};

export default async function TeachingDirectionHome() {
  const client = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireTeachingDirector(client, service);
  if (!access.ok) {
    if (access.status === 401) redirect("/login");
    return <main className="mx-auto mt-16 max-w-xl rounded-xl border bg-white p-8">
      <h1 className="text-xl font-bold">Accès à la direction indisponible</h1>
      <p className="mt-2 text-sm text-slate-600">
        L'affectation de votre compte doit être vérifiée par la direction générale.
      </p><TrueLogoutButton className="mt-5 rounded-lg border px-4 py-2" />
    </main>;
  }
  const { teachingTrack, cycles } = access.principal;
  const workspace = await loadTeachingDirectorWorkspace(service, access.principal)
    .catch(() => null);
  if (!workspace) return <main className="mx-auto mt-12 max-w-xl space-y-4 p-6">
    <h1 className="text-xl font-bold">Direction pédagogique temporairement indisponible</h1>
    <p className="text-sm">Vérifiez la configuration de l'année scolaire et des affectations.</p>
    <TrueLogoutButton className="rounded-lg border px-4 py-2" />
  </main>;
  const totalStudents = new Set(workspace.classes.flatMap(c => c.students.map(s => s.id))).size;
  const trackLabel = teachingTrack === "arabic" ? "arabe" : "français";
  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-5">
      <div>
        <p className="text-sm font-semibold text-emerald-700">Direction de l'enseignement {trackLabel}</p>
        <h1 className="text-2xl font-bold">{workspace.schoolName}</h1>
        <p className="mt-1 text-sm text-slate-600">Année scolaire : {workspace.year || "Non définie"}</p>
      </div>
      <TrueLogoutButton />
    </header>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Classes</p>
        <p className="text-3xl font-bold">{workspace.classes.length}</p></div>
      <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Élèves distincts</p>
        <p className="text-3xl font-bold">{totalStudents}</p></div>
      <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">Cycles supervisés</p>
        <p className="text-3xl font-bold">{cycles.length}</p></div>
    </div>
    <nav className="rounded-xl border bg-white p-4">
      <a href="/direction-enseignement/bulletins"
        className="inline-flex rounded-lg bg-emerald-800 px-5 py-3 font-semibold text-white">
        Consulter et imprimer les bulletins de mon enseignement
      </a>
    </nav>
    {workspace.year && <SchoolGradingPeriodsEditor
      academicYear={workspace.year}
      allowedPrograms={cycles.map(cycle => ({ cycle, track: teachingTrack }))}
    />}
    {access.principal.hasTeacherRole && <nav className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4">
      <span className="w-full text-sm font-semibold">Mes fonctions d'enseignant</span>
      <a href="/attendance" className="rounded-lg border px-4 py-2 text-sm font-medium">
        Cahier d'absences
      </a>
      <a href="/grades" className="rounded-lg border px-4 py-2 text-sm font-medium">
        Cahier de notes
      </a>
      <p className="w-full text-xs text-slate-500">
        Vos affectations d'enseignant sont conservées. Les données des autres
        enseignements ne sont pas rendues accessibles par ce portail.
      </p>
    </nav>}
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      Les listes, services enseignants et évaluations ci-dessous sont filtrés côté serveur
      sur votre enseignement. La modification des notes, publications, bulletins et autres
      écrans administratifs reste verrouillée en attente de contrôles serveur spécifiques.
      La gestion financière est exclue.
    </div>
    {cycles.map(cycle => <section key={cycle} className="space-y-3">
      <h2 className="text-xl font-bold">{LABELS[cycle]}</h2>
      {workspace.classes.filter(c => c.cycle === cycle).length ? <div className="grid gap-4 lg:grid-cols-2">
        {workspace.classes.filter(c => c.cycle === cycle).map(c => <article key={c.id}
          className="rounded-2xl border bg-white p-5">
          <h3 className="font-bold text-lg">{c.label}</h3>
          <p className="text-sm text-slate-500">
            {c.level || "Niveau non renseigné"} · {c.studentCount} élève(s)
          </p>
          <details className="mt-3 rounded-lg border p-3">
            <summary className="cursor-pointer font-semibold text-sm">Élèves de cet enseignement</summary>
            {c.students.length ? <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
              {c.students.map(s => <li key={s.id} className="flex justify-between gap-3 border-b py-1">
                <span>{s.name}</span><span className="text-slate-500">{s.matricule || "—"}</span>
              </li>)}
            </ul> : <p className="mt-2 text-sm text-slate-500">Aucun élève affecté.</p>}
          </details>
          <details className="mt-2 rounded-lg border p-3">
            <summary className="cursor-pointer font-semibold text-sm">Enseignants et disciplines</summary>
            {c.teachers.length ? <ul className="mt-2 space-y-1 text-sm">
              {c.teachers.map((t,i) => <li key={t.id+"-"+i} className="border-b py-1">
                {t.name} · {t.subject}
              </li>)}
            </ul> : <p className="mt-2 text-sm text-slate-500">
              Aucune affectation confirmée pour cet enseignement.
            </p>}
          </details>
          <details className="mt-2 rounded-lg border p-3">
            <summary className="cursor-pointer font-semibold text-sm">Dernières évaluations</summary>
            {c.recentEvaluations.length ? <ul className="mt-2 space-y-2 text-sm">
              {c.recentEvaluations.map(e => <li key={e.id} className="border-b pb-1">
                <strong>{e.subject}</strong> · {e.title} · {e.date}
                <span className="block text-xs text-slate-500">{e.published ? "Publiée" : "Non publiée"}</span>
              </li>)}
            </ul> : <p className="mt-2 text-sm text-slate-500">
              Aucune évaluation visible dans cet enseignement.
            </p>}
          </details>
        </article>)}
      </div> : <p className="rounded-xl border bg-white p-4 text-sm text-slate-600">
        Aucune classe configurée pour cet enseignement et ce cycle.
      </p>}
    </section>)}
  </main>;
}
